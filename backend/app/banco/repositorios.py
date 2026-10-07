"""Todas as consultas ao banco ficam aqui, separadas por assunto.

Os três processos (consumidor, regras e API) usam estas funções, então uma
mudança no modelo de dados se resolve num lugar só.
"""

import json
from datetime import datetime

import psycopg

from app.calibracao.conversao import Curva

# ---------------------------------------------------------------- células


def registrar_celula(conn: psycopg.Connection, id_celula: str, estado: str,
                     sensores: list[str] | None = None) -> bool:
    """Cria a célula se ainda não existe e atualiza o estado.
    Na criação, já cadastra a calibração padrão. Devolve True se a célula é nova."""
    with conn.transaction():
        nova = conn.execute(
            """
            INSERT INTO celula (id_celula, estado, sensores, ultimo_contato)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (id_celula) DO UPDATE
               SET estado = EXCLUDED.estado,
                   sensores = CASE WHEN %s THEN EXCLUDED.sensores ELSE celula.sensores END,
                   ultimo_contato = CASE WHEN EXCLUDED.estado = 'online'
                                         THEN now() ELSE celula.ultimo_contato END
            RETURNING (xmax = 0) AS nova
            """,
            (id_celula, estado, json.dumps(sensores or []), sensores is not None),
        ).fetchone()["nova"]
        if nova:
            conn.execute(
                """
                INSERT INTO calibracao (id_celula, versao, a, b)
                SELECT %s, 1, a, b FROM calibracao_padrao
                """,
                (id_celula,),
            )
    return nova


def listar_celulas(conn: psycopg.Connection) -> list[dict]:
    return conn.execute(
        """
        SELECT c.id_celula, c.estado, c.sensores, c.primeiro_anuncio, c.ultimo_contato,
               u.seq AS ultima_seq, u.ts_origem AS ultima_leitura_em,
               u.temperatura_c, u.od, u.ph,
               (SELECT count(*) FROM alerta a
                 WHERE a.id_celula = c.id_celula AND a.fechado_em IS NULL) AS alertas_abertos
          FROM celula c
          LEFT JOIN LATERAL (
                SELECT * FROM leitura l WHERE l.id_celula = c.id_celula
                 ORDER BY seq DESC LIMIT 1) u ON true
         ORDER BY c.id_celula
        """
    ).fetchall()


def celula_existe(conn: psycopg.Connection, id_celula: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM celula WHERE id_celula = %s", (id_celula,)
    ).fetchone() is not None


# ---------------------------------------------------------------- leituras


def gravar_leitura(conn: psycopg.Connection, id_celula: str, seq: int, ts: datetime,
                   temperatura_c, od_bruto, od, ph, curva: Curva | None) -> bool:
    """Grava a leitura. Devolve False se ela já existia (duplicata descartada)."""
    with conn.transaction():
        gravou = conn.execute(
            """
            INSERT INTO leitura (id_celula, seq, ts_origem, temperatura_c,
                                 od_bruto, od, ph, id_calibracao)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id_celula, seq) DO NOTHING
            """,
            (id_celula, seq, ts, temperatura_c, od_bruto, od, ph,
             curva.id_calibracao if curva else None),
        ).rowcount == 1
        conn.execute(
            "UPDATE celula SET ultimo_contato = now() WHERE id_celula = %s", (id_celula,)
        )
    return gravou


def listar_leituras(conn: psycopg.Connection, id_celula: str,
                    desde: datetime | None = None, limite: int = 1000) -> list[dict]:
    return conn.execute(
        """
        SELECT seq, ts_origem, ts_recebido, temperatura_c, od_bruto, od, ph, id_calibracao
          FROM leitura
         WHERE id_celula = %s AND (%s::timestamptz IS NULL OR ts_origem >= %s)
         ORDER BY seq DESC
         LIMIT %s
        """,
        (id_celula, desde, desde, limite),
    ).fetchall()[::-1]


def iterar_leituras(conn: psycopg.Connection, id_celula: str):
    """Todas as leituras de uma célula, em ordem, sem carregar tudo na memória."""
    yield from conn.cursor().stream(
        """
        SELECT seq, ts_origem, ts_recebido, temperatura_c, od_bruto, od, ph, id_calibracao
          FROM leitura WHERE id_celula = %s ORDER BY seq
        """,
        (id_celula,),
    )


def resumo_integridade(conn: psycopg.Connection) -> list[dict]:
    """Por célula: total de leituras, seq distintos e quantos eram esperados
    entre o primeiro e o último seq. Se os três forem iguais, não há buracos
    nem repetições."""
    return conn.execute(
        """
        SELECT id_celula,
               count(*)                 AS leituras,
               count(DISTINCT seq)      AS seq_unicos,
               max(seq) - min(seq) + 1  AS esperado,
               min(seq) AS primeiro_seq, max(seq) AS ultimo_seq
          FROM leitura GROUP BY id_celula ORDER BY id_celula
        """
    ).fetchall()


# ---------------------------------------------------------------- calibração


def curva_ativa(conn: psycopg.Connection, id_celula: str) -> Curva | None:
    linha = conn.execute(
        "SELECT id_calibracao, a, b FROM calibracao WHERE id_celula = %s AND ativa",
        (id_celula,),
    ).fetchone()
    return Curva(**linha) if linha else None


def nova_calibracao(conn: psycopg.Connection, id_celula: str, a: float, b: float) -> dict:
    """Cadastra uma nova versão da curva e recalcula a OD de todo o histórico
    da célula a partir do valor bruto, que nunca é alterado."""
    with conn.transaction():
        conn.execute("UPDATE calibracao SET ativa = false WHERE id_celula = %s AND ativa", (id_celula,))
        nova = conn.execute(
            """
            INSERT INTO calibracao (id_celula, versao, a, b)
            VALUES (%s, (SELECT coalesce(max(versao), 0) + 1 FROM calibracao WHERE id_celula = %s), %s, %s)
            RETURNING id_calibracao, versao, a, b, criada_em
            """,
            (id_celula, id_celula, a, b),
        ).fetchone()
        reprocessadas = conn.execute(
            """
            UPDATE leitura SET od = round((%s * od_bruto + %s)::numeric, 4), id_calibracao = %s
             WHERE id_celula = %s AND od_bruto IS NOT NULL
            """,
            (a, b, nova["id_calibracao"], id_celula),
        ).rowcount
    return {**nova, "leituras_reprocessadas": reprocessadas}


# ---------------------------------------------------------------- setpoint


def criar_pedido(conn: psycopg.Connection, id_pedido: str, id_celula: str,
                 temperatura_c: float, solicitado_por: str) -> dict:
    return conn.execute(
        """
        INSERT INTO pedido_setpoint (id_pedido, id_celula, temperatura_c, solicitado_por)
        VALUES (%s, %s, %s, %s) RETURNING *
        """,
        (id_pedido, id_celula, temperatura_c, solicitado_por),
    ).fetchone()


_COLUNA_DO_ESTADO = {"recebido": "recebido_em", "aplicado": "aplicado_em", "atingido": "atingido_em"}
_ORDEM = {"solicitado": 0, "recebido": 1, "aplicado": 2, "atingido": 3, "recusado": 9}


def avancar_pedido(conn: psycopg.Connection, id_pedido: str, estado: str,
                   motivo: str | None = None) -> bool:
    """Registra o novo estado do pedido. Nunca volta um estado para trás,
    porque respostas repetidas ou fora de ordem podem chegar pelo MQTT.

    A comparação fica no próprio UPDATE: consumidor e regras avançam o mesmo
    pedido em processos separados, e um SELECT antes abriria uma corrida."""
    coluna = _COLUNA_DO_ESTADO.get(estado)
    ordem_atual = "CASE estado " + " ".join(
        f"WHEN '{nome}' THEN {posicao}" for nome, posicao in _ORDEM.items()
    ) + " END"
    return conn.execute(
        f"""
        UPDATE pedido_setpoint
           SET estado = %s, motivo = coalesce(%s, motivo)
               {f", {coluna} = coalesce({coluna}, now())" if coluna else ""}
         WHERE id_pedido = %s AND {ordem_atual} < %s
        """,
        (estado, motivo, id_pedido, _ORDEM[estado]),
    ).rowcount == 1


def buscar_pedido(conn: psycopg.Connection, id_pedido: str) -> dict | None:
    return conn.execute(
        "SELECT * FROM pedido_setpoint WHERE id_pedido = %s", (id_pedido,)
    ).fetchone()


def listar_pedidos(conn: psycopg.Connection, id_celula: str) -> list[dict]:
    return conn.execute(
        "SELECT * FROM pedido_setpoint WHERE id_celula = %s ORDER BY solicitado_em DESC",
        (id_celula,),
    ).fetchall()


# ---------------------------------------------------------------- alertas


def abrir_alerta(conn: psycopg.Connection, id_celula: str, tipo: str, mensagem: str) -> bool:
    return conn.execute(
        """
        INSERT INTO alerta (id_celula, tipo, mensagem) VALUES (%s, %s, %s)
        ON CONFLICT (id_celula, tipo) WHERE fechado_em IS NULL DO NOTHING
        """,
        (id_celula, tipo, mensagem),
    ).rowcount == 1


def fechar_alerta(conn: psycopg.Connection, id_celula: str, tipo: str) -> bool:
    return conn.execute(
        """
        UPDATE alerta SET fechado_em = now()
         WHERE id_celula = %s AND tipo = %s AND fechado_em IS NULL
        """,
        (id_celula, tipo),
    ).rowcount == 1


def listar_alertas(conn: psycopg.Connection, somente_abertos: bool = True) -> list[dict]:
    return conn.execute(
        """
        SELECT * FROM alerta
         WHERE NOT %s OR fechado_em IS NULL
         ORDER BY aberto_em DESC LIMIT 500
        """,
        (somente_abertos,),
    ).fetchall()
