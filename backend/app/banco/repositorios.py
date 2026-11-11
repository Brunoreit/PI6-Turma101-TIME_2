"""Todas as consultas ao banco ficam aqui, separadas por assunto.

Os três processos (consumidor, regras e API) usam estas funções, então uma
mudança no modelo de dados se resolve num lugar só.
"""

import json
from datetime import datetime
from typing import Literal

import psycopg

from app.calibracao.conversao import Curva

# ---------------------------------------------------------------- células


def registrar_celula(conn: psycopg.Connection, id_celula: str, estado: str,
                     sensores: list[str] | None = None, firmware: str | None = None) -> bool:
    """Cria a célula se ainda não existe e atualiza o estado e, quando
    informado, o firmware. Na criação, já cadastra a calibração padrão.
    Devolve True se a célula é nova."""
    with conn.transaction():
        nova = conn.execute(
            """
            INSERT INTO celula (id_celula, estado, sensores, firmware, ultimo_contato)
            VALUES (%s, %s, %s, %s, now())
            ON CONFLICT (id_celula) DO UPDATE
               SET estado = EXCLUDED.estado,
                   sensores = CASE WHEN %s THEN EXCLUDED.sensores ELSE celula.sensores END,
                   firmware = coalesce(EXCLUDED.firmware, celula.firmware),
                   ultimo_contato = CASE WHEN EXCLUDED.estado = 'online'
                                         THEN now() ELSE celula.ultimo_contato END
            RETURNING (xmax = 0) AS nova
            """,
            (id_celula, estado, json.dumps(sensores or []), firmware, sensores is not None),
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


_CULTIVO_ATUAL = ("id_cultivo", "id_experimento", "condicao", "iniciado_em")


def listar_celulas(conn: psycopg.Connection) -> list[dict]:
    """Cada célula com a última leitura, os alertas abertos e o cultivo
    em andamento (cultivo_atual), ou None se ela está livre."""
    celulas = conn.execute(
        """
        SELECT c.id_celula, c.estado, c.sensores, c.primeiro_anuncio, c.ultimo_contato,
               u.seq AS ultima_seq, u.ts_origem AS ultima_leitura_em,
               u.temperatura_c, u.od, u.ph,
               (SELECT count(*) FROM alerta a
                 WHERE a.id_celula = c.id_celula AND a.fechado_em IS NULL) AS alertas_abertos,
               c.descricao, c.apelido, c.modelo, c.firmware,
               k.id_cultivo, k.id_experimento, k.condicao, k.iniciado_em
          FROM celula c
          LEFT JOIN LATERAL (
                SELECT * FROM leitura l WHERE l.id_celula = c.id_celula
                 ORDER BY seq DESC LIMIT 1) u ON true
          LEFT JOIN cultivo k ON k.id_celula = c.id_celula AND k.status = 'em_andamento'
         ORDER BY c.id_celula
        """
    ).fetchall()
    for celula in celulas:
        cultivo = {campo: celula.pop(campo) for campo in _CULTIVO_ATUAL}
        celula["cultivo_atual"] = cultivo if cultivo["id_cultivo"] is not None else None
    return celulas


_CAMPOS_CELULA = ("apelido", "descricao", "modelo")


def atualizar_celula(conn: psycopg.Connection, id_celula: str, **campos) -> dict | None:
    """Altera só os campos recebidos. Apelido repetido levanta
    UniqueViolation. None se a célula não existe."""
    desconhecidos = set(campos) - set(_CAMPOS_CELULA)
    if desconhecidos:
        raise ValueError(f"campos que não podem ser alterados na célula: {sorted(desconhecidos)}")
    if not campos:
        return conn.execute("SELECT * FROM celula WHERE id_celula = %s", (id_celula,)).fetchone()
    return conn.execute(
        f"""
        UPDATE celula SET {", ".join(f"{coluna} = %s" for coluna in campos)}
         WHERE id_celula = %s RETURNING *
        """,
        (*campos.values(), id_celula),
    ).fetchone()


def celula_existe(conn: psycopg.Connection, id_celula: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM celula WHERE id_celula = %s", (id_celula,)
    ).fetchone() is not None


# ---------------------------------------------------------------- leituras


def gravar_leitura(conn: psycopg.Connection, id_celula: str, seq: int, ts: datetime,
                   temperatura_c, od_bruto, od, ph, curva: Curva | None,
                   extras: dict | None = None) -> Literal["gravada", "duplicada", "colisao"]:
    """Grava a leitura e devolve o que aconteceu:

    gravada    leitura nova.
    duplicada  o seq já estava gravado com o mesmo ts: é um reenvio, descartado.
    colisao    o seq já estava gravado com outro ts: são medições diferentes
               com o mesmo número. A original fica e o alerta colisao_seq é aberto.

    Em todos os casos a célula conta como tendo dado sinal de vida."""
    with conn.transaction():
        gravou = conn.execute(
            """
            INSERT INTO leitura (id_celula, seq, ts_origem, temperatura_c,
                                 od_bruto, od, ph, id_calibracao, extras)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id_celula, seq) DO NOTHING
            """,
            (id_celula, seq, ts, temperatura_c, od_bruto, od, ph,
             curva.id_calibracao if curva else None, json.dumps(extras) if extras else None),
        ).rowcount == 1
        conn.execute(
            "UPDATE celula SET ultimo_contato = now() WHERE id_celula = %s", (id_celula,)
        )
        if gravou:
            return "gravada"
        original = conn.execute(
            "SELECT ts_origem, ts_origem = %s AS mesmo_ts FROM leitura WHERE id_celula = %s AND seq = %s",
            (ts, id_celula, seq),
        ).fetchone()
        if original["mesmo_ts"]:
            return "duplicada"
        abrir_alerta(
            conn, id_celula, "colisao_seq",
            f"A leitura seq {seq} chegou de novo com outro horário "
            f"({ts.isoformat()}, a gravada é de {original['ts_origem'].isoformat()}). "
            "A original foi mantida.",
        )
        return "colisao"


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


def ultimas_leituras_od(conn: psycopg.Connection, id_celula: str, quantidade: int) -> list[dict]:
    """As últimas `quantidade` leituras com OD bruta da célula, em ordem de
    seq (seq, ts_origem, od_bruto). Leituras sem od_bruto ficam de fora."""
    return conn.execute(
        """
        SELECT seq, ts_origem, od_bruto
          FROM leitura
         WHERE id_celula = %s AND od_bruto IS NOT NULL
         ORDER BY seq DESC
         LIMIT %s
        """,
        (id_celula, quantidade),
    ).fetchall()[::-1]


def od_bruto_no_intervalo(conn: psycopg.Connection, id_celula: str, seq_inicio: int, seq_fim: int) -> list[float]:
    """Os od_bruto da célula com seq entre `seq_inicio` e `seq_fim`, inclusive.
    Usado para conferir e recalcular a média de um padrão lido ao vivo."""
    linhas = conn.execute(
        """
        SELECT od_bruto FROM leitura
         WHERE id_celula = %s AND seq BETWEEN %s AND %s AND od_bruto IS NOT NULL
         ORDER BY seq
        """,
        (id_celula, seq_inicio, seq_fim),
    ).fetchall()
    return [linha["od_bruto"] for linha in linhas]


def listar_calibracoes(conn: psycopg.Connection, id_celula: str) -> list[dict]:
    """Todas as versões da curva da célula, da mais nova para a mais antiga,
    com o nome de quem calibrou (None na versão padrão do sistema)."""
    return conn.execute(
        """
        SELECT c.id_calibracao, c.versao, c.a, c.b, c.ativa, c.criada_em, c.sensor,
               c.pontos, c.r2, c.organismo, c.id_pessoa, p.nome AS calibrado_por
          FROM calibracao c
          LEFT JOIN pessoa p ON p.id_pessoa = c.id_pessoa
         WHERE c.id_celula = %s
         ORDER BY c.versao DESC
        """,
        (id_celula,),
    ).fetchall()


def nova_calibracao(
    conn: psycopg.Connection, id_celula: str, a: float, b: float,
    recalcular: bool = True, desde: datetime | None = None,
    pontos: list[dict] | None = None, r2: float | None = None,
    organismo: str | None = None, id_pessoa: int | None = None,
) -> dict:
    """Cadastra uma nova versão da curva. Com `recalcular`, refaz a OD das
    leituras já gravadas a partir do valor bruto, que nunca é alterado: todas,
    ou só as de `desde` em diante. Sem, só as próximas leituras usam a versão.
    `pontos`, `r2`, `organismo` e `id_pessoa` só são guardados, não mudam a conta.
    Numa calibração com branco, `b` já vem com o branco embutido
    (b − a·branco), então a conta aqui é sempre a·od_bruto + b."""
    with conn.transaction():
        conn.execute("UPDATE calibracao SET ativa = false WHERE id_celula = %s AND ativa", (id_celula,))
        nova = conn.execute(
            """
            INSERT INTO calibracao (id_celula, versao, a, b, pontos, r2, organismo, id_pessoa)
            VALUES (%s, (SELECT coalesce(max(versao), 0) + 1 FROM calibracao WHERE id_celula = %s),
                    %s, %s, %s, %s, %s, %s)
            RETURNING id_calibracao, versao, a, b, criada_em, sensor, pontos, r2, organismo, id_pessoa
            """,
            (id_celula, id_celula, a, b, json.dumps(pontos) if pontos is not None else None,
             r2, organismo, id_pessoa),
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
                 temperatura_c: float, solicitado_por: str, id_pessoa: int | None = None) -> dict:
    """`id_pessoa` só vem quando o pedido é de alguém logado."""
    return conn.execute(
        """
        INSERT INTO pedido_setpoint (id_pedido, id_celula, temperatura_c, solicitado_por, id_pessoa)
        VALUES (%s, %s, %s, %s, %s) RETURNING *
        """,
        (id_pedido, id_celula, temperatura_c, solicitado_por, id_pessoa),
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


def abrir_alerta(conn: psycopg.Connection, id_celula: str | None, tipo: str, mensagem: str) -> bool:
    """id_celula None só nos alertas do sistema (consumidor_parado e broker_inacessivel)."""
    return conn.execute(
        """
        INSERT INTO alerta (id_celula, tipo, mensagem) VALUES (%s, %s, %s)
        ON CONFLICT (id_celula, tipo) WHERE fechado_em IS NULL DO NOTHING
        """,
        (id_celula, tipo, mensagem),
    ).rowcount == 1


def fechar_alerta(conn: psycopg.Connection, id_celula: str | None, tipo: str) -> bool:
    return conn.execute(
        """
        UPDATE alerta SET fechado_em = now()
         WHERE id_celula IS NOT DISTINCT FROM %s::text AND tipo = %s AND fechado_em IS NULL
        """,
        (id_celula, tipo),
    ).rowcount == 1


# ---------------------------------------------------------------- sinal de vida


def registrar_sinal(conn: psycopg.Connection, nome: str, iniciado_em: datetime,
                    broker_conectado: bool | None = None, broker_desde: datetime | None = None) -> None:
    """Sinal de vida de um processo do backend ('consumidor' ou 'regras')."""
    conn.execute(
        """
        INSERT INTO processo (nome, iniciado_em, ultimo_sinal, broker_conectado, broker_desde)
        VALUES (%s, %s, now(), %s, %s)
        ON CONFLICT (nome) DO UPDATE
           SET iniciado_em = EXCLUDED.iniciado_em, ultimo_sinal = now(),
               broker_conectado = EXCLUDED.broker_conectado, broker_desde = EXCLUDED.broker_desde
        """,
        (nome, iniciado_em, broker_conectado, broker_desde),
    )


def listar_processos(conn: psycopg.Connection) -> list[dict]:
    """Cada processo com o último sinal e há quantos segundos ele chegou."""
    return conn.execute(
        """
        SELECT nome, iniciado_em, ultimo_sinal, broker_conectado, broker_desde,
               extract(epoch FROM now() - ultimo_sinal)::float AS segundos_sem_sinal
          FROM processo ORDER BY nome
        """
    ).fetchall()


def listar_alertas(conn: psycopg.Connection, somente_abertos: bool = True) -> list[dict]:
    return conn.execute(
        """
        SELECT * FROM alerta
         WHERE NOT %s OR fechado_em IS NULL
         ORDER BY aberto_em DESC LIMIT 500
        """,
        (somente_abertos,),
    ).fetchall()


# ---------------------------------------------------------------- relatório de falhas


def alertas_no_periodo(conn: psycopg.Connection, desde: datetime, ate: datetime) -> list[dict]:
    """Alertas que estiveram abertos em algum momento do período, do mais antigo."""
    return conn.execute(
        """
        SELECT id_alerta, id_celula, tipo, mensagem, aberto_em, fechado_em
          FROM alerta
         WHERE aberto_em <= %s AND (fechado_em IS NULL OR fechado_em >= %s)
         ORDER BY aberto_em, id_alerta
        """,
        (ate, desde),
    ).fetchall()


def leituras_por_celula(conn: psycopg.Connection, desde: datetime, ate: datetime,
                        celulas: list[str] | None = None, atraso_s: float = 5) -> list[dict]:
    """Por célula, as leituras medidas no período (pelo horário da célula):
    quantas, o primeiro e o último seq, quantas chegaram ao banco depois do
    fim do período (guardadas e reenviadas), quantas levaram mais que
    atraso_s para chegar e o maior atraso de entrega."""
    return conn.execute(
        """
        SELECT id_celula, count(*) AS leituras,
               min(seq) AS primeiro_seq, max(seq) AS ultimo_seq,
               count(*) FILTER (WHERE ts_recebido > %(ate)s) AS chegaram_depois,
               count(*) FILTER (WHERE ts_recebido - ts_origem > make_interval(secs => %(atraso)s)) AS atrasadas,
               extract(epoch FROM max(ts_recebido - ts_origem))::float AS maior_atraso_s
          FROM leitura
         WHERE ts_origem BETWEEN %(desde)s AND %(ate)s
           AND (%(celulas)s::text[] IS NULL OR id_celula = ANY(%(celulas)s::text[]))
         GROUP BY id_celula ORDER BY id_celula
        """,
        {"desde": desde, "ate": ate, "celulas": celulas, "atraso": atraso_s},
    ).fetchall()


def buracos_de_seq(conn: psycopg.Connection, desde: datetime, ate: datetime,
                   celulas: list[str] | None = None) -> list[dict]:
    """Intervalos de seq que faltam entre as leituras medidas no período.
    Como o seq é contínuo por célula, cada intervalo é uma leitura perdida
    (ou ainda guardada na célula, se ela continua sem comunicação)."""
    return conn.execute(
        """
        SELECT id_celula, anterior + 1 AS de, seq - 1 AS ate, seq - anterior - 1 AS faltam
          FROM (SELECT id_celula, seq, lag(seq) OVER (PARTITION BY id_celula ORDER BY seq) AS anterior
                  FROM leitura
                 WHERE ts_origem BETWEEN %(desde)s AND %(ate)s
                   AND (%(celulas)s::text[] IS NULL OR id_celula = ANY(%(celulas)s::text[]))) s
         WHERE seq - anterior > 1
         ORDER BY id_celula, de
        """,
        {"desde": desde, "ate": ate, "celulas": celulas},
    ).fetchall()


def agora_no_banco(conn: psycopg.Connection) -> datetime:
    return conn.execute("SELECT now() AS agora").fetchone()["agora"]


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
    """A operação não vale para o status atual do experimento, por exemplo
    iniciar um cultivo num experimento encerrado. Nada foi gravado."""

    def __init__(self, status: str):
        super().__init__(f"o experimento está {status}")
        self.status = status


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
    """O experimento, com o nome do responsável, seus cultivos e com quem
    ele é compartilhado."""
    experimento = conn.execute(
        """
        SELECT e.*, p.nome AS responsavel_nome
          FROM experimento e JOIN pessoa p ON p.id_pessoa = e.id_responsavel
         WHERE e.id_experimento = %s
        """,
        (id_experimento,),
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


def travar_experimento(conn: psycopg.Connection, id_experimento: int) -> dict | None:
    """A linha do experimento, travada até o fim da transação de quem
    chama (sem transação, a trava se solta na hora). Serve para decidir
    pelo status e gravar sem que ele mude no meio."""
    return conn.execute(
        "SELECT * FROM experimento WHERE id_experimento = %s FOR UPDATE", (id_experimento,)
    ).fetchone()


def listar_experimentos_visiveis(conn: psycopg.Connection, id_pessoa: int,
                                 filtro: str = "todos") -> list[dict]:
    """Os experimentos de que a pessoa é responsável (`meus`), os
    compartilhados com ela (`compartilhados`) ou os dois (`todos`). Cada um
    diz o nome do responsável, o acesso da pessoa e quantos cultivos estão
    abertos."""
    if filtro not in ("todos", "meus", "compartilhados"):
        raise ValueError(f"filtro desconhecido: {filtro!r}")
    return conn.execute(
        """
        SELECT e.*, r.nome AS responsavel_nome,
               CASE WHEN e.id_responsavel = %(p)s THEN 'responsavel' ELSE a.permissao END AS acesso,
               (SELECT count(*) FROM cultivo c
                 WHERE c.id_experimento = e.id_experimento AND c.status = 'em_andamento') AS cultivos_abertos
          FROM experimento e
          JOIN pessoa r ON r.id_pessoa = e.id_responsavel
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
          JOIN pessoa r ON r.id_pessoa = e.id_responsavel
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


def encerrar_experimento(conn: psycopg.Connection, id_experimento: int,
                         id_pessoa: int) -> dict | None:
    """Encerra o experimento e, junto, os cultivos abertos. Só vale para
    experimento em andamento: um cadastrado nunca começou e deve ser
    cancelado. None se o experimento não existe."""
    with conn.transaction():
        experimento = conn.execute(
            "SELECT status FROM experimento WHERE id_experimento = %s FOR UPDATE", (id_experimento,)
        ).fetchone()
        if experimento is None:
            return None
        if experimento["status"] != "em_andamento":
            raise OperacaoRecusada(experimento["status"])
        conn.execute(
            """
            UPDATE cultivo SET status = 'encerrado', encerrado_em = now(), id_encerrado_por = %s
             WHERE id_experimento = %s AND status = 'em_andamento'
            """,
            (id_pessoa, id_experimento),
        )
        return conn.execute(
            """
            UPDATE experimento SET status = 'encerrado', encerrado_em = now()
             WHERE id_experimento = %s RETURNING *
            """,
            (id_experimento,),
        ).fetchone()


def cancelar_experimento(conn: psycopg.Connection, id_experimento: int, id_pessoa: int,
                         motivo: str) -> dict | None:
    """Cancela o experimento e, junto, os cultivos abertos, com o mesmo
    motivo. O motivo fica também em metadados.motivo_cancelamento. Só vale
    para experimento cadastrado ou em andamento. Nada é apagado. None se o
    experimento não existe."""
    if not motivo or not motivo.strip():
        raise ValueError("cancelar um experimento exige motivo")
    with conn.transaction():
        experimento = conn.execute(
            "SELECT status FROM experimento WHERE id_experimento = %s FOR UPDATE", (id_experimento,)
        ).fetchone()
        if experimento is None:
            return None
        if experimento["status"] not in ("cadastrado", "em_andamento"):
            raise OperacaoRecusada(experimento["status"])
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
            UPDATE experimento
               SET status = 'cancelado', encerrado_em = now(),
                   metadados = metadados || jsonb_build_object('motivo_cancelamento', %s::text)
             WHERE id_experimento = %s RETURNING *
            """,
            (motivo, id_experimento),
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
            raise OperacaoRecusada(experimento["status"])
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
