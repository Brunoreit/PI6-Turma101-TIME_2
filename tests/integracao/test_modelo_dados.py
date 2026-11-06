"""Testes do esquema do modelo de dados do MVP (infra/postgres/init/03_modelo_mvp.sql).

Conferem direto por SQL, sem API, as restrições que o próprio banco garante,
a visão leitura_cultivo e a aplicação do 03 num banco que já existe.

Cada teste roda numa transação desfeita no final, então nada fica no banco
que as células simuladas estão usando. Os cenários de banco antigo usam um
banco separado no mesmo servidor.

Rodar:
  pytest tests/integracao/test_modelo_dados.py -v
"""

from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest
from psycopg import errors
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from tests.integracao.ambiente import RAIZ, criar_ambiente

pytestmark = pytest.mark.integracao

INIT = RAIZ / "infra" / "postgres" / "init"
T0 = datetime(2026, 11, 1, tzinfo=timezone.utc)
DIA = timedelta(days=1)

# Tabela experimento como era antes do 03, para simular um banco antigo.
EXPERIMENTO_ANTIGO = """
CREATE TABLE experimento (
    id_experimento SERIAL PRIMARY KEY,
    id_celula      TEXT NOT NULL REFERENCES celula,
    nome           TEXT NOT NULL,
    organismo      TEXT,
    inicio         TIMESTAMPTZ NOT NULL DEFAULT now(),
    fim            TIMESTAMPTZ
);
"""


@pytest.fixture(scope="module")
def ambiente():
    amb = criar_ambiente()
    try:
        amb.iniciar()
        yield amb
    finally:
        amb.encerrar()


@pytest.fixture(scope="module")
def banco(ambiente):
    with psycopg.connect(ambiente.url_banco, autocommit=True, row_factory=dict_row) as conn:
        yield conn


@pytest.fixture
def tx(banco):
    """Conexão dentro de uma transação desfeita ao fim do teste, com uma
    pessoa, duas células sem apelido e um experimento cadastrado."""
    with banco.transaction(force_rollback=True):
        id_pessoa = banco.execute(
            "INSERT INTO pessoa (nome, email, senha_hash) VALUES ('Ana', 'ana@cnpem.br', 'x') RETURNING id_pessoa"
        ).fetchone()["id_pessoa"]
        banco.execute("INSERT INTO celula (id_celula) VALUES ('tst-a'), ('tst-b')")
        id_experimento = banco.execute(
            "INSERT INTO experimento (nome, modo, id_responsavel) VALUES ('E', 'curva_crescimento', %s) RETURNING id_experimento",
            (id_pessoa,),
        ).fetchone()["id_experimento"]
        banco.id_pessoa, banco.id_experimento = id_pessoa, id_experimento
        yield banco


def aplicar(conn: psycopg.Connection, *arquivos: str | Path) -> None:
    """Executa scripts SQL inteiros, como o psql faria."""
    for arquivo in arquivos:
        texto = arquivo if isinstance(arquivo, str) else arquivo.read_text(encoding="utf-8")
        conn.execute(texto)


def recusa(conn, sql: str, params: tuple, erro: type[Exception], restricao: str) -> None:
    """Confere que o comando é recusado pela restrição esperada."""
    with pytest.raises(erro) as recusado:
        with conn.transaction():
            conn.execute(sql, params)
    assert recusado.value.diag.constraint_name == restricao


def novo_cultivo(conn, id_celula: str, inicio: datetime, fim: datetime | None = None,
                 status: str | None = None, **campos) -> int:
    colunas = {"id_experimento": conn.id_experimento, "id_celula": id_celula, "iniciado_em": inicio,
               "encerrado_em": fim, "status": status or ("encerrado" if fim else "em_andamento"), **campos}
    return conn.execute(
        f"INSERT INTO cultivo ({', '.join(colunas)}) VALUES ({', '.join(['%s'] * len(colunas))}) RETURNING id_cultivo",
        tuple(colunas.values()),
    ).fetchone()["id_cultivo"]


# ------------------------------------------------------------------ pessoas


@pytest.mark.parametrize("email", ["Bia@cnpem.br", " bia@cnpem.br", "bia.cnpem.br", "@cnpem.br"])
def test_email_fora_do_formato_e_recusado(tx, email):
    recusa(tx, "INSERT INTO pessoa (nome, email, senha_hash) VALUES ('Bia', %s, 'x')", (email,),
           errors.CheckViolation, "pessoa_email_check")


def test_email_repetido_e_recusado(tx):
    recusa(tx, "INSERT INTO pessoa (nome, email, senha_hash) VALUES ('Outra Ana', 'ana@cnpem.br', 'x')", (),
           errors.UniqueViolation, "pessoa_email_key")


# ------------------------------------------------------------------ experimentos


@pytest.mark.parametrize("status, iniciado, encerrado, restricao", [
    ("cadastrado", T0, None, "experimento_datas_do_status"),
    ("cadastrado", None, T0, "experimento_datas_do_status"),
    ("em_andamento", None, None, "experimento_datas_do_status"),
    ("em_andamento", T0, T0 + DIA, "experimento_datas_do_status"),
    ("encerrado", T0, None, "experimento_datas_do_status"),
    ("cancelado", None, None, "experimento_datas_do_status"),
    ("encerrado", T0, T0 - DIA, "experimento_ordem_datas"),
])
def test_status_do_experimento_precisa_combinar_com_as_datas(tx, status, iniciado, encerrado, restricao):
    recusa(tx, """INSERT INTO experimento (nome, modo, id_responsavel, status, iniciado_em, encerrado_em)
                  VALUES ('E', 'curva_crescimento', %s, %s, %s, %s)""",
           (tx.id_pessoa, status, iniciado, encerrado), errors.CheckViolation, restricao)


@pytest.mark.parametrize("coluna, valor, restricao", [
    ("modo", "batelada", "experimento_modo_check"),
    ("status", "pausado", "experimento_status_check"),
    ("duracao_prevista_dias", 0, "experimento_duracao_prevista_dias_check"),
    ("nome", "  ", "experimento_nome_check"),
])
def test_campo_invalido_no_experimento_e_recusado(tx, coluna, valor, restricao):
    recusa(tx, f"UPDATE experimento SET {coluna} = %s WHERE id_experimento = %s",
           (valor, tx.id_experimento), errors.CheckViolation, restricao)


@pytest.mark.parametrize("minimo, maximo", [(7.5, 6.5), (7.0, 7.0)])
def test_faixa_de_ph_do_experimento_precisa_ter_minimo_menor(tx, minimo, maximo):
    recusa(tx, "UPDATE experimento SET ph_ref_min = %s, ph_ref_max = %s WHERE id_experimento = %s",
           (minimo, maximo, tx.id_experimento), errors.CheckViolation, "experimento_faixa_ph")


def test_experimento_com_responsavel_inexistente_e_recusado(tx):
    recusa(tx, "INSERT INTO experimento (nome, modo, id_responsavel) VALUES ('E', 'quimiostato', -1)", (),
           errors.ForeignKeyViolation, "experimento_id_responsavel_fkey")


# ------------------------------------------------------------------ acessos


def test_permissao_fora_de_leitura_e_edicao_e_recusada(tx):
    recusa(tx, "INSERT INTO experimento_acesso (id_experimento, id_pessoa, permissao) VALUES (%s, %s, 'dono')",
           (tx.id_experimento, tx.id_pessoa), errors.CheckViolation, "experimento_acesso_permissao_check")


def test_segunda_permissao_para_a_mesma_pessoa_e_recusada(tx):
    sql = "INSERT INTO experimento_acesso (id_experimento, id_pessoa, permissao) VALUES (%s, %s, %s)"
    tx.execute(sql, (tx.id_experimento, tx.id_pessoa, "leitura"))
    recusa(tx, sql, (tx.id_experimento, tx.id_pessoa, "edicao"), errors.UniqueViolation, "experimento_acesso_pkey")


# ------------------------------------------------------------------ cultivos


def test_segundo_cultivo_aberto_na_mesma_celula_e_recusado(tx):
    novo_cultivo(tx, "tst-a", T0)
    with pytest.raises(errors.ExclusionViolation) as recusado:
        with tx.transaction():
            novo_cultivo(tx, "tst-a", T0 + DIA)
    assert recusado.value.diag.constraint_name == "cultivo_sem_sobreposicao"


def test_cultivos_encerrados_com_periodos_sobrepostos_sao_recusados(tx):
    novo_cultivo(tx, "tst-a", T0, T0 + 2 * DIA)
    with pytest.raises(errors.ExclusionViolation) as recusado:
        with tx.transaction():
            novo_cultivo(tx, "tst-a", T0 + DIA, T0 + 3 * DIA)
    assert recusado.value.diag.constraint_name == "cultivo_sem_sobreposicao"


def test_cultivo_pode_comecar_no_instante_em_que_o_anterior_terminou(tx):
    anterior = novo_cultivo(tx, "tst-a", T0, T0 + DIA)
    seguinte = novo_cultivo(tx, "tst-a", T0 + DIA, continua_de=anterior)
    # A cultura também pode continuar noutra célula, ao mesmo tempo.
    novo_cultivo(tx, "tst-b", T0 + DIA, continua_de=anterior)
    assert tx.execute("SELECT continua_de FROM cultivo WHERE id_cultivo = %s",
                      (seguinte,)).fetchone()["continua_de"] == anterior


@pytest.mark.parametrize("status, fim, motivo, restricao", [
    ("em_andamento", T0 + DIA, None, "cultivo_aberto_sem_fim"),
    ("encerrado", None, None, "cultivo_aberto_sem_fim"),
    ("cancelado", T0 + DIA, None, "cultivo_cancelado_com_motivo"),
    ("cancelado", T0 + DIA, "   ", "cultivo_cancelado_com_motivo"),
    ("encerrado", T0 - DIA, None, "cultivo_ordem_datas"),
    ("pausado", T0 + DIA, None, "cultivo_status_check"),
])
def test_status_do_cultivo_precisa_combinar_com_fim_e_motivo(tx, status, fim, motivo, restricao):
    with pytest.raises(errors.CheckViolation) as recusado:
        with tx.transaction():
            novo_cultivo(tx, "tst-a", T0, fim, status=status, motivo_encerramento=motivo)
    assert recusado.value.diag.constraint_name == restricao


def test_cultivo_cancelado_com_motivo_e_aceito(tx):
    novo_cultivo(tx, "tst-a", T0, T0 + DIA, status="cancelado", motivo_encerramento="contaminação")


@pytest.mark.parametrize("campos, restricao", [
    ({"replica": 0}, "cultivo_replica_check"),
    ({"ph_ref_min": 7.5, "ph_ref_max": 6.5}, "cultivo_faixa_ph"),
])
def test_campo_invalido_no_cultivo_e_recusado(tx, campos, restricao):
    with pytest.raises(errors.CheckViolation) as recusado:
        with tx.transaction():
            novo_cultivo(tx, "tst-a", T0, **campos)
    assert recusado.value.diag.constraint_name == restricao


def test_cultivo_nao_continua_de_si_mesmo(tx):
    id_cultivo = novo_cultivo(tx, "tst-a", T0)
    recusa(tx, "UPDATE cultivo SET continua_de = id_cultivo WHERE id_cultivo = %s", (id_cultivo,),
           errors.CheckViolation, "cultivo_nao_continua_de_si")


def test_cultivo_em_celula_inexistente_e_recusado(tx):
    with pytest.raises(errors.ForeignKeyViolation) as recusado:
        with tx.transaction():
            novo_cultivo(tx, "tst-inexistente", T0)
    assert recusado.value.diag.constraint_name == "cultivo_id_celula_fkey"


# ------------------------------------------------------------------ acréscimos nas tabelas existentes


def test_apelido_de_celula_e_unico_e_varios_nulos_sao_permitidos(tx):
    # tst-a e tst-b já estão sem apelido.
    tx.execute("UPDATE celula SET apelido = 'c08' WHERE id_celula = 'tst-a'")
    recusa(tx, "UPDATE celula SET apelido = 'c08' WHERE id_celula = 'tst-b'", (),
           errors.UniqueViolation, "celula_apelido_unico")


def test_alertas_novos_sao_aceitos_e_tipo_inventado_e_recusado(tx):
    sql = "INSERT INTO alerta (id_celula, tipo, mensagem) VALUES ('tst-a', %s, 'x')"
    tx.execute(sql, ("ph_fora_da_faixa",))
    tx.execute(sql, ("colisao_seq",))
    recusa(tx, sql, ("tipo_inventado",), errors.CheckViolation, "alerta_tipo_check")


def test_leitura_com_extras_e_aceita(tx):
    tx.execute("INSERT INTO leitura (id_celula, seq, ts_origem, extras) VALUES ('tst-a', 0, %s, %s)",
               (T0, Jsonb({"o2_pct": 21.0})))
    assert tx.execute("SELECT extras FROM leitura WHERE id_celula = 'tst-a'").fetchone()["extras"] == {"o2_pct": 21.0}


def test_calibracao_sem_sensor_fica_como_od_e_outro_sensor_e_recusado(tx):
    # Como registrar_celula e nova_calibracao gravam hoje, sem informar o sensor.
    tx.execute("INSERT INTO calibracao (id_celula, versao, a, b) VALUES ('tst-a', 1, 1, 0)")
    assert tx.execute("SELECT sensor FROM calibracao WHERE id_celula = 'tst-a'").fetchone()["sensor"] == "od"
    recusa(tx, "INSERT INTO calibracao (id_celula, versao, a, b, sensor, ativa) VALUES ('tst-a', 2, 1, 0, 'ph', false)",
           (), errors.CheckViolation, "calibracao_sensor_check")


# ------------------------------------------------------------------ visão leitura_cultivo


def test_visao_liga_cada_leitura_ao_cultivo_do_seu_horario(tx):
    primeiro = novo_cultivo(tx, "tst-a", T0 + DIA, T0 + 2 * DIA)
    segundo = novo_cultivo(tx, "tst-a", T0 + 2 * DIA, continua_de=primeiro)
    leituras = {
        0: T0,                              # antes de qualquer cultivo
        1: T0 + DIA,                        # início do primeiro
        2: T0 + DIA + timedelta(hours=12),  # dentro do primeiro
        3: T0 + 2 * DIA,                    # fronteira: já é do segundo
        4: T0 + 3 * DIA,                    # dentro do segundo
    }
    for seq, ts in leituras.items():
        tx.execute("INSERT INTO leitura (id_celula, seq, ts_origem) VALUES ('tst-a', %s, %s)", (seq, ts))
    # Leitura de outra célula no mesmo período não entra.
    tx.execute("INSERT INTO leitura (id_celula, seq, ts_origem) VALUES ('tst-b', 0, %s)", (T0 + DIA,))

    linhas = tx.execute(
        "SELECT seq, id_cultivo FROM leitura_cultivo WHERE id_cultivo IN (%s, %s) ORDER BY seq",
        (primeiro, segundo),
    ).fetchall()
    assert [(l["seq"], l["id_cultivo"]) for l in linhas] == [
        (1, primeiro), (2, primeiro), (3, segundo), (4, segundo)]


# ------------------------------------------------------------------ aplicação do 03


def _retrato(conn) -> dict:
    """O que o 03 cria ou altera, para comparar antes e depois de reaplicar."""
    return {
        "colunas": conn.execute(
            """SELECT table_name, column_name, data_type, is_nullable, column_default
                 FROM information_schema.columns WHERE table_schema = 'public'
                ORDER BY 1, 2""").fetchall(),
        "restricoes": conn.execute(
            """SELECT conrelid::regclass::text AS tabela, conname, pg_get_constraintdef(oid) AS definicao
                 FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2""").fetchall(),
        "indices": conn.execute(
            "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1").fetchall(),
        "visao": conn.execute("SELECT pg_get_viewdef('leitura_cultivo')").fetchone(),
        "linhas": conn.execute(
            """SELECT (SELECT count(*) FROM pessoa) AS pessoa, (SELECT count(*) FROM experimento) AS experimento,
                      (SELECT count(*) FROM experimento_acesso) AS acesso, (SELECT count(*) FROM cultivo) AS cultivo,
                      (SELECT count(*) FROM celula) AS celula, (SELECT count(*) FROM calibracao) AS calibracao""").fetchone(),
    }


def test_reaplicar_o_03_no_banco_do_teste_nao_muda_nada(banco):
    antes = _retrato(banco)
    aplicar(banco, INIT / "03_modelo_mvp.sql", INIT / "03_modelo_mvp.sql")
    assert _retrato(banco) == antes


@pytest.fixture
def outro_banco(ambiente, banco):
    """Banco vazio e separado no mesmo servidor, apagado ao fim do teste."""
    banco.execute("DROP DATABASE IF EXISTS evolver_teste_03")
    banco.execute("CREATE DATABASE evolver_teste_03")
    url = ambiente.url_banco.rsplit("/", 1)[0] + "/evolver_teste_03"
    try:
        with psycopg.connect(url, autocommit=True, row_factory=dict_row) as conn:
            yield conn
    finally:
        banco.execute("DROP DATABASE IF EXISTS evolver_teste_03")


def test_03_em_banco_antigo_com_dados_preserva_tudo(outro_banco):
    conn = outro_banco
    aplicar(conn, INIT / "01_tabelas.sql", EXPERIMENTO_ANTIGO, INIT / "02_calibracao_padrao.sql")
    conn.execute("INSERT INTO celula (id_celula) VALUES ('c01')")
    conn.execute("INSERT INTO calibracao (id_celula, versao, a, b) VALUES ('c01', 1, 0.0005, -0.05)")
    conn.execute("""INSERT INTO leitura (id_celula, seq, ts_origem, od_bruto, od)
                    SELECT 'c01', g, %s + g * interval '1 min', 1000 + g, 0.45 FROM generate_series(0, 99) g""", (T0,))
    conn.execute("INSERT INTO pedido_setpoint (id_pedido, id_celula, temperatura_c) VALUES ('sp-1', 'c01', 30)")
    conn.execute("INSERT INTO alerta (id_celula, tipo, mensagem) VALUES ('c01', 'sem_comunicacao', 'x')")
    leituras = conn.execute("SELECT * FROM leitura ORDER BY seq").fetchall()

    aplicar(conn, INIT / "03_modelo_mvp.sql", INIT / "03_modelo_mvp.sql")

    assert [{k: l[k] for k in leituras[0]} for l in conn.execute("SELECT * FROM leitura ORDER BY seq").fetchall()] == leituras
    assert conn.execute("SELECT count(*) AS n FROM pedido_setpoint").fetchone()["n"] == 1
    assert conn.execute("SELECT count(*) AS n FROM alerta").fetchone()["n"] == 1
    assert conn.execute("SELECT sensor FROM calibracao").fetchone()["sensor"] == "od"
    # A tabela antiga, vazia, foi trocada pela nova.
    assert conn.execute("""SELECT count(*) AS n FROM information_schema.columns
                            WHERE table_name = 'experimento' AND column_name = 'id_celula'""").fetchone()["n"] == 0
    assert conn.execute("SELECT to_regclass('cultivo') AS t").fetchone()["t"] == "cultivo"


def test_03_para_sem_mudar_nada_se_a_tabela_antiga_tem_dados(outro_banco):
    conn = outro_banco
    aplicar(conn, INIT / "01_tabelas.sql", EXPERIMENTO_ANTIGO, INIT / "02_calibracao_padrao.sql")
    conn.execute("INSERT INTO celula (id_celula) VALUES ('c01')")
    conn.execute("INSERT INTO experimento (id_celula, nome) VALUES ('c01', 'antigo')")

    with pytest.raises(errors.RaiseException, match="tabela experimento antiga tem dados"):
        aplicar(conn, INIT / "03_modelo_mvp.sql")

    assert conn.execute("SELECT nome FROM experimento").fetchone()["nome"] == "antigo"
    assert conn.execute("SELECT to_regclass('pessoa') AS t").fetchone()["t"] is None
    assert conn.execute("""SELECT count(*) AS n FROM information_schema.columns
                            WHERE table_name = 'celula' AND column_name = 'apelido'""").fetchone()["n"] == 0
    assert conn.execute("SELECT count(*) AS n FROM pg_extension WHERE extname = 'btree_gist'").fetchone()["n"] == 0
