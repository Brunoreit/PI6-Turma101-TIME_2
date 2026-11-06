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


def nova_calibracao(
    conn: psycopg.Connection, id_celula: str, a: float, b: float,
    recalcular: bool = True, desde: datetime | None = None,
) -> dict:
    """Cadastra uma nova versão da curva. Com `recalcular`, refaz a OD das
    leituras já gravadas a partir do valor bruto, que nunca é alterado: todas,
    ou só as de `desde` em diante. Sem, só as próximas leituras usam a versão."""
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
        reprocessadas = 0
        if recalcular:
            reprocessadas = conn.execute(
                """
                UPDATE leitura SET od = round((%s * od_bruto + %s)::numeric, 4), id_calibracao = %s
                 WHERE id_celula = %s AND od_bruto IS NOT NULL
                   AND (%s::timestamptz IS NULL OR ts_origem >= %s::timestamptz)
                """,
                (a, b, nova["id_calibracao"], id_celula, desde, desde),
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


# ---------------------------------------------------------------- pessoas

# Colunas devolvidas ao resto do sistema. O resumo da senha fica de fora:
# só buscar_pessoa_por_email o devolve, para conferir o login.
_PESSOA = "id_pessoa, nome, email, criado_em"


def criar_pessoa(conn: psycopg.Connection, nome: str, email: str, senha_hash: str) -> dict:
    """Cadastra a pessoa. E-mail repetido levanta UniqueViolation."""
    return conn.execute(
        f"INSERT INTO pessoa (nome, email, senha_hash) VALUES (%s, %s, %s) RETURNING {_PESSOA}",
        (nome, email, senha_hash),
    ).fetchone()


def buscar_pessoa_por_email(conn: psycopg.Connection, email: str) -> dict | None:
    """Inclui senha_hash, para conferir o login. Não devolver isto na API."""
    return conn.execute(
        f"SELECT {_PESSOA}, senha_hash FROM pessoa WHERE email = %s", (email,)
    ).fetchone()


def buscar_pessoa(conn: psycopg.Connection, id_pessoa: int) -> dict | None:
    return conn.execute(f"SELECT {_PESSOA} FROM pessoa WHERE id_pessoa = %s", (id_pessoa,)).fetchone()


# ---------------------------------------------------------------- experimentos


class OperacaoRecusada(Exception):
    """A operação não vale para o estado atual do registro, por exemplo
    iniciar um cultivo num experimento encerrado. Nada foi gravado."""


# Campos da ficha que quem cria ou edita o experimento informa.
_CAMPOS_FICHA = ("nome", "descricao", "modo", "duracao_prevista_dias", "temperatura_alvo_c",
                 "ph_ref_min", "ph_ref_max", "metadados")


def _valores_ficha(campos: dict) -> dict:
    desconhecidos = set(campos) - set(_CAMPOS_FICHA)
    if desconhecidos:
        raise ValueError(f"campos fora da ficha do experimento: {sorted(desconhecidos)}")
    return {k: json.dumps(v) if k == "metadados" else v for k, v in campos.items()}


def criar_experimento(conn: psycopg.Connection, id_responsavel: int, **campos) -> dict:
    """Experimento novo, sempre cadastrado e com o responsável informado.
    `campos` são os da ficha (nome e modo obrigatórios)."""
    valores = {**_valores_ficha(campos), "id_responsavel": id_responsavel}
    return conn.execute(
        f"""
        INSERT INTO experimento ({", ".join(valores)})
        VALUES ({", ".join(["%s"] * len(valores))}) RETURNING *
        """,
        tuple(valores.values()),
    ).fetchone()


def buscar_experimento(conn: psycopg.Connection, id_experimento: int) -> dict | None:
    """O experimento com seus cultivos e com quem ele é compartilhado."""
    experimento = conn.execute(
        "SELECT * FROM experimento WHERE id_experimento = %s", (id_experimento,)
    ).fetchone()
    if experimento is None:
        return None
    experimento["cultivos"] = conn.execute(
        "SELECT * FROM cultivo WHERE id_experimento = %s ORDER BY iniciado_em, id_cultivo",
        (id_experimento,),
    ).fetchall()
    experimento["acessos"] = conn.execute(
        """
        SELECT a.id_pessoa, p.nome, p.email, a.permissao, a.concedido_em
          FROM experimento_acesso a JOIN pessoa p USING (id_pessoa)
         WHERE a.id_experimento = %s ORDER BY p.nome
        """,
        (id_experimento,),
    ).fetchall()
    return experimento


def listar_experimentos_visiveis(conn: psycopg.Connection, id_pessoa: int,
                                 filtro: str = "todos") -> list[dict]:
    """Os experimentos de que a pessoa é responsável (`meus`), os
    compartilhados com ela (`compartilhados`) ou os dois (`todos`). Cada um
    diz o acesso da pessoa e quantos cultivos estão abertos."""
    if filtro not in ("todos", "meus", "compartilhados"):
        raise ValueError(f"filtro desconhecido: {filtro!r}")
    return conn.execute(
        """
        SELECT e.*,
               CASE WHEN e.id_responsavel = %(p)s THEN 'responsavel' ELSE a.permissao END AS acesso,
               (SELECT count(*) FROM cultivo c
                 WHERE c.id_experimento = e.id_experimento AND c.status = 'em_andamento') AS cultivos_abertos
          FROM experimento e
          LEFT JOIN experimento_acesso a ON a.id_experimento = e.id_experimento AND a.id_pessoa = %(p)s
         WHERE (e.id_responsavel = %(p)s AND %(f)s IN ('todos', 'meus'))
            OR (e.id_responsavel <> %(p)s AND a.id_pessoa IS NOT NULL AND %(f)s IN ('todos', 'compartilhados'))
         ORDER BY e.criado_em DESC, e.id_experimento DESC
        """,
        {"p": id_pessoa, "f": filtro},
    ).fetchall()


def acesso_de(conn: psycopg.Connection, id_experimento: int, id_pessoa: int) -> str | None:
    """responsavel, edicao, leitura, ou None se a pessoa não tem acesso
    (ou o experimento não existe)."""
    linha = conn.execute(
        """
        SELECT CASE WHEN e.id_responsavel = %s THEN 'responsavel' ELSE a.permissao END AS acesso
          FROM experimento e
          LEFT JOIN experimento_acesso a ON a.id_experimento = e.id_experimento AND a.id_pessoa = %s
         WHERE e.id_experimento = %s
        """,
        (id_pessoa, id_pessoa, id_experimento),
    ).fetchone()
    return linha and linha["acesso"]


def atualizar_experimento(conn: psycopg.Connection, id_experimento: int, **campos) -> dict | None:
    """Altera só os campos da ficha recebidos. O que pode ser alterado em
    cada status é decidido pela API."""
    valores = _valores_ficha(campos)
    if not valores:
        return conn.execute(
            "SELECT * FROM experimento WHERE id_experimento = %s", (id_experimento,)
        ).fetchone()
    return conn.execute(
        f"""
        UPDATE experimento SET {", ".join(f"{coluna} = %s" for coluna in valores)}
         WHERE id_experimento = %s RETURNING *
        """,
        (*valores.values(), id_experimento),
    ).fetchone()


def cancelar_experimento(conn: psycopg.Connection, id_experimento: int, id_pessoa: int,
                         motivo: str) -> dict | None:
    """Cancela o experimento e, junto, os cultivos abertos, com o mesmo
    motivo. Só vale para experimento cadastrado ou em andamento. Nada é
    apagado. None se o experimento não existe."""
    if not motivo or not motivo.strip():
        raise ValueError("cancelar um experimento exige motivo")
    with conn.transaction():
        experimento = conn.execute(
            "SELECT status FROM experimento WHERE id_experimento = %s FOR UPDATE", (id_experimento,)
        ).fetchone()
        if experimento is None:
            return None
        if experimento["status"] not in ("cadastrado", "em_andamento"):
            raise OperacaoRecusada(f"o experimento já está {experimento['status']}")
        conn.execute(
            """
            UPDATE cultivo
               SET status = 'cancelado', encerrado_em = now(),
                   motivo_encerramento = %s, id_encerrado_por = %s
             WHERE id_experimento = %s AND status = 'em_andamento'
            """,
            (motivo, id_pessoa, id_experimento),
        )
        return conn.execute(
            """
            UPDATE experimento SET status = 'cancelado', encerrado_em = now()
             WHERE id_experimento = %s RETURNING *
            """,
            (id_experimento,),
        ).fetchone()


def duplicar_experimento(conn: psycopg.Connection, id_experimento: int, id_pessoa: int) -> dict | None:
    """Cópia cadastrada da ficha, com a pessoa como responsável. Cultivos,
    leituras e acessos não são copiados. None se o original não existe."""
    colunas = ", ".join(_CAMPOS_FICHA)
    return conn.execute(
        f"""
        INSERT INTO experimento ({colunas}, id_responsavel, id_origem)
        SELECT {colunas}, %s, id_experimento FROM experimento WHERE id_experimento = %s
        RETURNING *
        """,
        (id_pessoa, id_experimento),
    ).fetchone()


# ---------------------------------------------------------------- acessos


def conceder_acesso(conn: psycopg.Connection, id_experimento: int, id_pessoa: int,
                    permissao: str) -> dict:
    """Concede o acesso ou, se a pessoa já tem, troca a permissão."""
    return conn.execute(
        """
        INSERT INTO experimento_acesso (id_experimento, id_pessoa, permissao) VALUES (%s, %s, %s)
        ON CONFLICT (id_experimento, id_pessoa) DO UPDATE SET permissao = EXCLUDED.permissao
        RETURNING *
        """,
        (id_experimento, id_pessoa, permissao),
    ).fetchone()


def revogar_acesso(conn: psycopg.Connection, id_experimento: int, id_pessoa: int) -> bool:
    return conn.execute(
        "DELETE FROM experimento_acesso WHERE id_experimento = %s AND id_pessoa = %s",
        (id_experimento, id_pessoa),
    ).rowcount == 1


# ---------------------------------------------------------------- cultivos


def iniciar_cultivo(conn: psycopg.Connection, id_experimento: int, id_celula: str, id_pessoa: int,
                    condicao: str | None = None, replica: int | None = None,
                    continua_de: int | None = None) -> dict | None:
    """Põe a célula no experimento a partir de agora, com a faixa de pH do
    experimento. O primeiro cultivo passa o experimento a em andamento.

    Célula já ocupada levanta ExclusionViolation e nada é gravado.
    Experimento encerrado ou cancelado levanta OperacaoRecusada.
    None se o experimento não existe."""
    with conn.transaction():
        # A trava impede que o experimento seja cancelado no meio do caminho.
        experimento = conn.execute(
            "SELECT status, ph_ref_min, ph_ref_max FROM experimento WHERE id_experimento = %s FOR UPDATE",
            (id_experimento,),
        ).fetchone()
        if experimento is None:
            return None
        if experimento["status"] not in ("cadastrado", "em_andamento"):
            raise OperacaoRecusada(f"o experimento está {experimento['status']}")
        cultivo = conn.execute(
            """
            INSERT INTO cultivo (id_experimento, id_celula, condicao, replica,
                                 ph_ref_min, ph_ref_max, id_iniciado_por, continua_de)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *
            """,
            (id_experimento, id_celula, condicao, replica,
             experimento["ph_ref_min"], experimento["ph_ref_max"], id_pessoa, continua_de),
        ).fetchone()
        conn.execute(
            """
            UPDATE experimento SET status = 'em_andamento', iniciado_em = %s
             WHERE id_experimento = %s AND status = 'cadastrado'
            """,
            (cultivo["iniciado_em"], id_experimento),
        )
    return cultivo


def _fechar_cultivo(conn: psycopg.Connection, id_cultivo: int, status: str, id_pessoa: int,
                    motivo: str | None) -> dict | None:
    return conn.execute(
        """
        UPDATE cultivo
           SET status = %s, encerrado_em = now(), motivo_encerramento = %s, id_encerrado_por = %s
         WHERE id_cultivo = %s AND status = 'em_andamento' RETURNING *
        """,
        (status, motivo, id_pessoa, id_cultivo),
    ).fetchone()


def encerrar_cultivo(conn: psycopg.Connection, id_cultivo: int, id_pessoa: int,
                     motivo: str | None = None) -> dict | None:
    """Tira a célula do experimento a partir de agora. None se o cultivo
    não existe ou não estava em andamento."""
    return _fechar_cultivo(conn, id_cultivo, "encerrado", id_pessoa, motivo)


def cancelar_cultivo(conn: psycopg.Connection, id_cultivo: int, id_pessoa: int,
                     motivo: str) -> dict | None:
    """Como encerrar, marcando que o cultivo não valeu. Sem motivo, o banco
    recusa (CheckViolation). Nada é apagado."""
    return _fechar_cultivo(conn, id_cultivo, "cancelado", id_pessoa, motivo)


_CAMPOS_CULTIVO = ("condicao", "replica", "ph_ref_min", "ph_ref_max")


def atualizar_cultivo(conn: psycopg.Connection, id_cultivo: int, **campos) -> dict | None:
    """Altera só os campos recebidos, e só em cultivo em andamento. None se
    o cultivo não existe ou já foi fechado."""
    desconhecidos = set(campos) - set(_CAMPOS_CULTIVO)
    if desconhecidos:
        raise ValueError(f"campos que não podem ser alterados no cultivo: {sorted(desconhecidos)}")
    if not campos:
        return conn.execute(
            "SELECT * FROM cultivo WHERE id_cultivo = %s AND status = 'em_andamento'", (id_cultivo,)
        ).fetchone()
    return conn.execute(
        f"""
        UPDATE cultivo SET {", ".join(f"{coluna} = %s" for coluna in campos)}
         WHERE id_cultivo = %s AND status = 'em_andamento' RETURNING *
        """,
        (*campos.values(), id_cultivo),
    ).fetchone()


def buscar_cultivo(conn: psycopg.Connection, id_cultivo: int) -> dict | None:
    return conn.execute("SELECT * FROM cultivo WHERE id_cultivo = %s", (id_cultivo,)).fetchone()


def cultivo_aberto_da_celula(conn: psycopg.Connection, id_celula: str) -> dict | None:
    return conn.execute(
        "SELECT * FROM cultivo WHERE id_celula = %s AND status = 'em_andamento'", (id_celula,)
    ).fetchone()


def listar_leituras_do_cultivo(conn: psycopg.Connection, id_cultivo: int,
                               desde: datetime | None = None, limite: int = 1000) -> list[dict]:
    """Leituras medidas no período do cultivo, na mesma forma de listar_leituras."""
    return conn.execute(
        """
        SELECT seq, ts_origem, ts_recebido, temperatura_c, od_bruto, od, ph, id_calibracao
          FROM leitura_cultivo
         WHERE id_cultivo = %s AND (%s::timestamptz IS NULL OR ts_origem >= %s)
         ORDER BY seq DESC
         LIMIT %s
        """,
        (id_cultivo, desde, desde, limite),
    ).fetchall()[::-1]
