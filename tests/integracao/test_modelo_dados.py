"""Testes do esquema do modelo de dados do MVP (infra/postgres/init/03_modelo_mvp.sql).

Conferem direto por SQL, sem API, as restrições que o próprio banco garante,
a visão leitura_cultivo e a aplicação do 03 num banco que já existe. No fim,
as operações de pessoas, experimentos, acessos e cultivos de repositorios.py,
o consumidor, a regra de pH e as rotas de células e calibração da API.

Os testes de restrição rodam numa transação desfeita no final. Os cenários
de banco antigo usam um banco separado no mesmo servidor. Os de repositório
gravam de verdade, com pessoas e células próprias de cada teste.

Rodar:
  pytest tests/integracao/test_modelo_dados.py -v
"""

import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
import pytest
import requests
from psycopg import errors
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.banco import repositorios as repo
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


# ------------------------------------------------------------------ repositórios
#
# Estes gravam de verdade (cada operação na sua transação, como na API),
# porque o início e o fim de cada cultivo vêm do now() do banco. Cada teste
# usa pessoas e células próprias.


class Cenario:
    """Três pessoas, três células e um experimento cadastrado da Ana, com
    nomes únicos para o teste."""

    def __init__(self, conn):
        sufixo = uuid.uuid4().hex[:6]
        self.conn = conn
        self.ana, self.henry, self.bia = (
            repo.criar_pessoa(conn, nome, f"{nome.lower()}-{sufixo}@cnpem.br", "x")["id_pessoa"]
            for nome in ("Ana", "Henry", "Bia"))
        self.celulas = [f"r{sufixo}{n}" for n in range(3)]
        for id_celula in self.celulas:
            repo.registrar_celula(conn, id_celula, "online")
        self.experimento = self.novo_experimento(self.ana)

    def novo_experimento(self, responsavel: int, **campos) -> dict:
        return repo.criar_experimento(self.conn, responsavel, **{
            "nome": "Crescimento de E. coli", "modo": "curva_crescimento", **campos})

    def iniciar(self, n: int, experimento: dict | None = None, **campos) -> dict:
        return repo.iniciar_cultivo(self.conn, (experimento or self.experimento)["id_experimento"],
                                    self.celulas[n], self.henry, **campos)

    def cultivos(self, id_experimento: int) -> list[dict]:
        return self.conn.execute("SELECT * FROM cultivo WHERE id_experimento = %s ORDER BY id_cultivo",
                                 (id_experimento,)).fetchall()


@pytest.fixture
def cenario(banco):
    return Cenario(banco)


def test_pessoa_nunca_sai_com_o_resumo_da_senha_exceto_no_login(cenario):
    pessoa = repo.buscar_pessoa(cenario.conn, cenario.ana)
    assert "senha_hash" not in pessoa
    assert repo.buscar_pessoa_por_email(cenario.conn, pessoa["email"])["senha_hash"] == "x"
    assert repo.buscar_pessoa_por_email(cenario.conn, "ninguem@cnpem.br") is None


def test_experimento_novo_nasce_cadastrado_com_o_responsavel(cenario):
    e = cenario.novo_experimento(cenario.ana, metadados={"organismo": "E. coli K-12"}, ph_ref_min=6.5)
    assert (e["status"], e["id_responsavel"], e["metadados"], e["iniciado_em"]) == (
        "cadastrado", cenario.ana, {"organismo": "E. coli K-12"}, None)
    with pytest.raises(ValueError):
        cenario.novo_experimento(cenario.ana, status="em_andamento")


def test_primeiro_cultivo_inicia_o_experimento_e_copia_a_faixa_de_ph(cenario):
    e = cenario.novo_experimento(cenario.ana, ph_ref_min=6.5, ph_ref_max=7.5)
    primeiro = cenario.iniciar(0, e, condicao="30 °C", replica=1)
    assert (primeiro["status"], primeiro["ph_ref_min"], primeiro["ph_ref_max"], primeiro["id_iniciado_por"]) == (
        "em_andamento", 6.5, 7.5, cenario.henry)
    depois = repo.buscar_experimento(cenario.conn, e["id_experimento"])
    assert depois["status"] == "em_andamento"
    assert depois["iniciado_em"] == primeiro["iniciado_em"]

    segundo = cenario.iniciar(1, e)
    assert segundo["iniciado_em"] > primeiro["iniciado_em"]
    assert repo.buscar_experimento(cenario.conn, e["id_experimento"])["iniciado_em"] == primeiro["iniciado_em"]
    assert repo.cultivo_aberto_da_celula(cenario.conn, cenario.celulas[1])["id_cultivo"] == segundo["id_cultivo"]


@pytest.mark.parametrize("status", ["encerrado", "cancelado"])
def test_cultivo_em_experimento_fechado_e_recusado_sem_gravar(cenario, status):
    e = cenario.experimento
    cenario.iniciar(0)
    if status == "cancelado":
        repo.cancelar_experimento(cenario.conn, e["id_experimento"], cenario.ana, "contaminação")
    else:
        # encerrar_experimento ainda não existe (P-9).
        cenario.conn.execute("UPDATE cultivo SET status = 'encerrado', encerrado_em = now() WHERE id_experimento = %s",
                             (e["id_experimento"],))
        cenario.conn.execute("UPDATE experimento SET status = 'encerrado', encerrado_em = now() WHERE id_experimento = %s",
                             (e["id_experimento"],))
    antes = cenario.cultivos(e["id_experimento"])
    with pytest.raises(repo.OperacaoRecusada):
        cenario.iniciar(1)
    assert cenario.cultivos(e["id_experimento"]) == antes
    assert repo.cultivo_aberto_da_celula(cenario.conn, cenario.celulas[1]) is None


def test_cultivo_em_celula_ocupada_nao_muda_o_experimento(cenario):
    cenario.iniciar(0)
    outro = cenario.novo_experimento(cenario.henry)
    with pytest.raises(errors.ExclusionViolation):
        cenario.iniciar(0, outro)
    depois = repo.buscar_experimento(cenario.conn, outro["id_experimento"])
    assert (depois["status"], depois["iniciado_em"], depois["cultivos"]) == ("cadastrado", None, [])


def test_cultivo_em_experimento_inexistente_devolve_none(cenario):
    assert repo.iniciar_cultivo(cenario.conn, -1, cenario.celulas[0], cenario.ana) is None


def test_encerrar_e_cancelar_so_agem_em_cultivo_em_andamento(cenario):
    conn = cenario.conn
    encerrado = repo.encerrar_cultivo(conn, cenario.iniciar(0)["id_cultivo"], cenario.ana)
    assert (encerrado["status"], encerrado["id_encerrado_por"], encerrado["motivo_encerramento"]) == (
        "encerrado", cenario.ana, None)
    assert encerrado["encerrado_em"] >= encerrado["iniciado_em"]
    assert repo.encerrar_cultivo(conn, encerrado["id_cultivo"], cenario.ana) is None
    assert repo.cancelar_cultivo(conn, encerrado["id_cultivo"], cenario.ana, "x") is None
    assert repo.encerrar_cultivo(conn, -1, cenario.ana) is None

    aberto = cenario.iniciar(1)["id_cultivo"]
    for motivo in (None, "  "):
        with pytest.raises(errors.CheckViolation):
            repo.cancelar_cultivo(conn, aberto, cenario.ana, motivo)
    assert repo.buscar_cultivo(conn, aberto)["status"] == "em_andamento"
    cancelado = repo.cancelar_cultivo(conn, aberto, cenario.ana, "placa queimou")
    assert (cancelado["status"], cancelado["motivo_encerramento"]) == ("cancelado", "placa queimou")
    # A célula fica livre para outro cultivo.
    cenario.iniciar(1)


def test_cancelar_experimento_cancela_os_cultivos_abertos(cenario):
    conn, e = cenario.conn, cenario.experimento
    repo.atualizar_experimento(conn, e["id_experimento"], metadados={"organismo": "E. coli"})
    ja_encerrado = repo.encerrar_cultivo(conn, cenario.iniciar(0)["id_cultivo"], cenario.henry, "fim")
    cenario.iniciar(1)
    cenario.iniciar(2)
    cancelado = repo.cancelar_experimento(conn, e["id_experimento"], cenario.ana, "contaminação")
    assert cancelado["status"] == "cancelado" and cancelado["encerrado_em"] is not None
    assert cancelado["metadados"] == {"organismo": "E. coli", "motivo_cancelamento": "contaminação"}

    cultivos = {c["id_cultivo"]: c for c in cenario.cultivos(e["id_experimento"])}
    assert cultivos.pop(ja_encerrado["id_cultivo"]) == ja_encerrado
    assert [(c["status"], c["motivo_encerramento"], c["id_encerrado_por"]) for c in cultivos.values()] == [
        ("cancelado", "contaminação", cenario.ana)] * 2

    with pytest.raises(repo.OperacaoRecusada):
        repo.cancelar_experimento(conn, e["id_experimento"], cenario.ana, "de novo")
    assert repo.cancelar_experimento(conn, -1, cenario.ana, "x") is None
    with pytest.raises(ValueError):
        repo.cancelar_experimento(conn, cenario.novo_experimento(cenario.ana)["id_experimento"], cenario.ana, " ")


def test_cancelar_experimento_cadastrado_sem_cultivos(cenario):
    cancelado = repo.cancelar_experimento(cenario.conn, cenario.experimento["id_experimento"], cenario.ana, "desistimos")
    assert (cancelado["status"], cancelado["iniciado_em"], cancelado["metadados"]) == (
        "cancelado", None, {"motivo_cancelamento": "desistimos"})


def test_duplicar_copia_a_ficha_e_nada_mais(cenario):
    conn = cenario.conn
    original = cenario.novo_experimento(
        cenario.ana, descricao="30 e 34 °C", duracao_prevista_dias=30, temperatura_alvo_c=30.0,
        ph_ref_min=6.5, ph_ref_max=7.5, metadados={"organismo": "E. coli K-12"})
    cenario.iniciar(0, original)
    repo.conceder_acesso(conn, original["id_experimento"], cenario.henry, "edicao")

    copia = repo.duplicar_experimento(conn, original["id_experimento"], cenario.henry)
    assert {k: copia[k] for k in repo._CAMPOS_FICHA} == {k: original[k] for k in repo._CAMPOS_FICHA}
    assert (copia["status"], copia["id_origem"], copia["id_responsavel"], copia["iniciado_em"]) == (
        "cadastrado", original["id_experimento"], cenario.henry, None)
    completa = repo.buscar_experimento(conn, copia["id_experimento"])
    assert (completa["cultivos"], completa["acessos"]) == ([], [])
    assert repo.duplicar_experimento(conn, -1, cenario.henry) is None


def test_lista_mostra_so_os_do_responsavel_e_os_compartilhados(cenario):
    conn = cenario.conn
    meu = cenario.experimento["id_experimento"]
    cenario.iniciar(0)
    do_henry = cenario.novo_experimento(cenario.henry)["id_experimento"]
    da_bia = cenario.novo_experimento(cenario.bia)["id_experimento"]
    repo.conceder_acesso(conn, do_henry, cenario.ana, "leitura")

    def ver(filtro):
        return {e["id_experimento"]: (e["acesso"], e["cultivos_abertos"])
                for e in repo.listar_experimentos_visiveis(conn, cenario.ana, filtro)}

    assert ver("todos") == {meu: ("responsavel", 1), do_henry: ("leitura", 0)}
    assert ver("meus") == {meu: ("responsavel", 1)}
    assert ver("compartilhados") == {do_henry: ("leitura", 0)}
    assert da_bia not in {e["id_experimento"] for e in repo.listar_experimentos_visiveis(conn, cenario.bia, "compartilhados")}
    with pytest.raises(ValueError):
        repo.listar_experimentos_visiveis(conn, cenario.ana, "outros")


def test_conceder_de_novo_troca_a_permissao_e_revogar_tira(cenario):
    conn, e = cenario.conn, cenario.experimento["id_experimento"]
    assert repo.acesso_de(conn, e, cenario.ana) == "responsavel"
    assert repo.acesso_de(conn, e, cenario.henry) is None
    repo.conceder_acesso(conn, e, cenario.henry, "leitura")
    assert repo.conceder_acesso(conn, e, cenario.henry, "edicao")["permissao"] == "edicao"
    assert repo.acesso_de(conn, e, cenario.henry) == "edicao"
    acessos = repo.buscar_experimento(conn, e)["acessos"]
    assert [(a["id_pessoa"], a["permissao"]) for a in acessos] == [(cenario.henry, "edicao")]
    assert "senha_hash" not in acessos[0]
    assert repo.revogar_acesso(conn, e, cenario.henry) is True
    assert repo.revogar_acesso(conn, e, cenario.henry) is False
    assert repo.acesso_de(conn, e, cenario.henry) is None
    assert repo.acesso_de(conn, -1, cenario.ana) is None


def test_atualizar_experimento_muda_so_os_campos_recebidos(cenario):
    conn, e = cenario.conn, cenario.experimento
    depois = repo.atualizar_experimento(conn, e["id_experimento"], descricao="nova", metadados={"meio": "LB"})
    assert (depois["descricao"], depois["metadados"], depois["nome"], depois["modo"]) == (
        "nova", {"meio": "LB"}, e["nome"], e["modo"])
    assert repo.atualizar_experimento(conn, e["id_experimento"]) == depois
    assert repo.atualizar_experimento(conn, -1, nome="x") is None
    with pytest.raises(ValueError):
        repo.atualizar_experimento(conn, e["id_experimento"], id_responsavel=cenario.bia)


def test_atualizar_cultivo_so_em_andamento(cenario):
    conn = cenario.conn
    cultivo = cenario.iniciar(0, condicao="30 °C")["id_cultivo"]
    depois = repo.atualizar_cultivo(conn, cultivo, ph_ref_min=6.0, ph_ref_max=7.0)
    assert (depois["ph_ref_min"], depois["ph_ref_max"], depois["condicao"]) == (6.0, 7.0, "30 °C")
    with pytest.raises(errors.CheckViolation):
        repo.atualizar_cultivo(conn, cultivo, ph_ref_min=8.0)
    with pytest.raises(ValueError):
        repo.atualizar_cultivo(conn, cultivo, id_celula=cenario.celulas[1])
    repo.encerrar_cultivo(conn, cultivo, cenario.ana)
    assert repo.atualizar_cultivo(conn, cultivo, condicao="34 °C") is None
    assert repo.buscar_cultivo(conn, cultivo)["condicao"] == "30 °C"


def test_leituras_do_cultivo_sao_as_do_periodo_e_nada_apaga_leituras(cenario):
    conn, celula = cenario.conn, cenario.celulas[0]
    cultivo = cenario.iniciar(0)
    inicio = cultivo["iniciado_em"]
    gravar = lambda seq, ts: repo.gravar_leitura(conn, celula, seq, ts, 30.0, 1000.0, 0.45, 7.0, None)
    gravar(0, inicio - timedelta(minutes=1))
    gravar(1, inicio)
    gravar(2, inicio + timedelta(microseconds=1))
    fim = repo.encerrar_cultivo(conn, cultivo["id_cultivo"], cenario.ana)["encerrado_em"]
    gravar(3, fim)
    gravar(4, fim + timedelta(minutes=1))

    assert [l["seq"] for l in repo.listar_leituras_do_cultivo(conn, cultivo["id_cultivo"])] == [1, 2]
    assert [l["seq"] for l in repo.listar_leituras_do_cultivo(conn, cultivo["id_cultivo"], desde=inicio, limite=1)] == [2]
    assert set(repo.listar_leituras_do_cultivo(conn, cultivo["id_cultivo"])[0]) == set(repo.listar_leituras(conn, celula)[0])

    # Cancelar, duplicar e cancelar o experimento não apagam nada.
    cenario.iniciar(0)
    repo.duplicar_experimento(conn, cenario.experimento["id_experimento"], cenario.ana)
    repo.cancelar_experimento(conn, cenario.experimento["id_experimento"], cenario.ana, "fim")
    assert [l["seq"] for l in repo.listar_leituras(conn, celula)] == [0, 1, 2, 3, 4]


# ------------------------------------------------------------------ consumidor
#
# O tratador do consumidor de verdade, com o banco do teste e sem broker:
# recebe o tópico e o payload como o cliente MQTT os entregaria.


@pytest.fixture
def tratador(banco):
    from app.consumidor.tratadores import Tratador

    return Tratador(banco)


@pytest.fixture
def celula(banco):
    id_celula = f"m{uuid.uuid4().hex[:6]}"
    repo.registrar_celula(banco, id_celula, "online")
    return id_celula


def _leitura(seq: int, ts: datetime, **campos) -> bytes:
    from contrato import Leitura

    return Leitura(seq=seq, ts=ts, **{"temperatura_c": 30.0, "od_bruto": 1000.0, "ph": 7.0, **campos}).para_json()


def test_gravar_leitura_distingue_gravada_duplicada_e_colisao(banco, celula):
    gravar = lambda ts, temperatura: repo.gravar_leitura(banco, celula, 0, ts, temperatura, 1000.0, 0.45, 7.0, None)
    assert gravar(T0, 30.0) == "gravada"
    assert gravar(T0, 30.0) == "duplicada"
    assert not banco.execute("SELECT 1 FROM alerta WHERE id_celula = %s", (celula,)).fetchone()

    # Ainda conta como sinal de vida da célula, como antes (D1).
    banco.execute("UPDATE celula SET ultimo_contato = %s WHERE id_celula = %s", (T0, celula))
    assert gravar(T0, 30.0) == "duplicada"
    assert banco.execute("SELECT ultimo_contato FROM celula WHERE id_celula = %s", (celula,)).fetchone()["ultimo_contato"] > T0

    assert gravar(T0 + DIA, 99.0) == "colisao"
    assert gravar(T0 + 2 * DIA, 98.0) == "colisao"
    alertas = banco.execute("SELECT tipo, mensagem FROM alerta WHERE id_celula = %s AND fechado_em IS NULL",
                            (celula,)).fetchall()
    assert [a["tipo"] for a in alertas] == ["colisao_seq"]
    assert "seq 0" in alertas[0]["mensagem"]
    original = banco.execute("SELECT ts_origem, temperatura_c FROM leitura WHERE id_celula = %s AND seq = 0",
                             (celula,)).fetchone()
    assert (original["ts_origem"], original["temperatura_c"]) == (T0, 30.0)


def test_consumidor_grava_campos_a_mais_em_extras(tratador, banco, celula, caplog):
    from contrato import topicos

    topico = topicos.leitura(celula)
    tratador.tratar(topico, _leitura(0, T0, o2_pct=21.0, agitacao_rpm=300))
    tratador.tratar(topico, _leitura(1, T0 + DIA, o2_pct=20.5))
    linhas = banco.execute("SELECT seq, temperatura_c, extras FROM leitura WHERE id_celula = %s ORDER BY seq",
                           (celula,)).fetchall()
    assert [(l["seq"], l["temperatura_c"], l["extras"]) for l in linhas] == [
        (0, 30.0, {"o2_pct": 21.0, "agitacao_rpm": 300}), (1, 30.0, {"o2_pct": 20.5})]
    assert tratador.contagem == {"gravadas": 2, "duplicadas": 0, "colisoes": 0, "invalidas": 0}
    # Um aviso por campo e célula, não um por leitura.
    avisos = [r.getMessage() for r in caplog.records if "fora do contrato" in r.getMessage()]
    assert avisos == [f"célula {celula} mandou campos fora do contrato, guardados em extras: agitacao_rpm, o2_pct"]


def test_consumidor_aceita_ph_fora_de_0_a_14_e_conta_colisao(tratador, banco, celula):
    from contrato import topicos

    topico = topicos.leitura(celula)
    tratador.tratar(topico, _leitura(0, T0, ph=15.2))
    tratador.tratar(topico, _leitura(0, T0, ph=15.2))
    tratador.tratar(topico, _leitura(0, T0 + DIA))
    tratador.tratar(topico, b'{"seq": -1, "ts": "2026-11-01T00:00:00Z"}')
    assert banco.execute("SELECT ph, extras FROM leitura WHERE id_celula = %s", (celula,)).fetchone() == {
        "ph": 15.2, "extras": None}
    assert tratador.contagem == {"gravadas": 1, "duplicadas": 1, "colisoes": 1, "invalidas": 1}


def test_consumidor_grava_o_firmware_e_offline_nao_o_apaga(tratador, banco, celula):
    from contrato import topicos

    firmware = lambda: banco.execute("SELECT firmware FROM celula WHERE id_celula = %s", (celula,)).fetchone()["firmware"]
    tratador.tratar(topicos.estado(celula), b'{"estado": "online", "versao": "fw-1.0"}')
    assert firmware() == "fw-1.0"
    tratador.tratar(topicos.estado(celula), b'{"estado": "offline"}')
    tratador.tratar(topicos.estado(celula), b'{"estado": "online"}')
    assert firmware() == "fw-1.0"
    tratador.tratar(topicos.estado(celula), b'{"estado": "online", "versao": "fw-1.1"}')
    assert firmware() == "fw-1.1"


# ------------------------------------------------------------------ regra ph_fora_da_faixa
#
# Chama a regra direto. O processo de regras do ambiente roda a mesma
# função a cada segundo, então os dois chegam sempre ao mesmo resultado.


def _alertas_ph(conn, id_celula: str) -> list[dict]:
    return conn.execute(
        "SELECT mensagem, fechado_em FROM alerta WHERE id_celula = %s AND tipo = 'ph_fora_da_faixa' ORDER BY id_alerta",
        (id_celula,),
    ).fetchall()


def _ph_aberto(conn, id_celula: str) -> bool:
    return any(a["fechado_em"] is None for a in _alertas_ph(conn, id_celula))


@pytest.fixture
def regra_ph(banco):
    from app.config import config
    from app.regras.verificacoes import ph_fora_da_faixa

    return lambda: ph_fora_da_faixa(banco, config)


def _medir(conn, id_celula: str, seq: int, ph: float | None, ts: datetime | None = None) -> None:
    repo.gravar_leitura(conn, id_celula, seq, ts or datetime.now(timezone.utc), 30.0, 1000.0, 0.45, ph, None)


def test_ph_fora_da_faixa_abre_uma_vez_e_fecha_quando_volta(cenario, regra_ph):
    conn, celula = cenario.conn, cenario.celulas[0]
    e = cenario.novo_experimento(cenario.ana, ph_ref_min=6.5, ph_ref_max=7.5)
    cultivo = cenario.iniciar(0, e)
    _medir(conn, celula, 0, 8.0, cultivo["iniciado_em"] + timedelta(seconds=1))
    regra_ph()
    regra_ph()
    alertas = _alertas_ph(conn, celula)
    assert len(alertas) == 1 and alertas[0]["fechado_em"] is None
    assert alertas[0]["mensagem"] == "pH em 8.00, fora da faixa de referência (de 6.50 a 7.50)."

    _medir(conn, celula, 1, 7.0, cultivo["iniciado_em"] + timedelta(seconds=2))
    regra_ph()
    assert not _ph_aberto(conn, celula)


def test_ph_a_ultima_leitura_e_a_de_maior_ts_origem(cenario, regra_ph):
    conn, celula = cenario.conn, cenario.celulas[0]
    cultivo = cenario.iniciar(0)
    repo.atualizar_cultivo(conn, cultivo["id_cultivo"], ph_ref_max=7.5)
    inicio = cultivo["iniciado_em"]
    # A de seq maior chegou atrasada: foi medida antes.
    _medir(conn, celula, 0, 8.0, inicio + timedelta(seconds=2))
    _medir(conn, celula, 1, 7.0, inicio + timedelta(seconds=1))
    # Leitura sem pH não conta, e leitura de antes do cultivo também não.
    _medir(conn, celula, 2, None, inicio + timedelta(seconds=3))
    _medir(conn, celula, 3, 7.0, inicio - timedelta(seconds=1))
    regra_ph()
    assert _ph_aberto(conn, celula)
    assert "máximo de 7.50" in _alertas_ph(conn, celula)[0]["mensagem"]


def test_ph_so_com_minimo(cenario, regra_ph):
    conn, celula = cenario.conn, cenario.celulas[0]
    cultivo = cenario.iniciar(0)
    repo.atualizar_cultivo(conn, cultivo["id_cultivo"], ph_ref_min=6.5)
    _medir(conn, celula, 0, 9.0, cultivo["iniciado_em"] + timedelta(seconds=1))
    regra_ph()
    assert not _ph_aberto(conn, celula)
    _medir(conn, celula, 1, 6.0, cultivo["iniciado_em"] + timedelta(seconds=2))
    regra_ph()
    assert _ph_aberto(conn, celula)


def test_ph_encerrar_o_cultivo_fecha_o_alerta(cenario, regra_ph):
    conn, celula = cenario.conn, cenario.celulas[0]
    cultivo = cenario.iniciar(0, cenario.novo_experimento(cenario.ana, ph_ref_min=6.5, ph_ref_max=7.5))
    _medir(conn, celula, 0, 8.0, cultivo["iniciado_em"] + timedelta(seconds=1))
    regra_ph()
    assert _ph_aberto(conn, celula)
    repo.encerrar_cultivo(conn, cultivo["id_cultivo"], cenario.ana)
    regra_ph()
    assert not _ph_aberto(conn, celula)


def test_ph_cultivo_novo_sem_leitura_de_ph_fecha_o_alerta_herdado(cenario, regra_ph):
    """D7: o alerta do cultivo anterior não fica aberto no seguinte."""
    conn, celula = cenario.conn, cenario.celulas[0]
    faixa = cenario.novo_experimento(cenario.ana, ph_ref_min=6.5, ph_ref_max=7.5)
    anterior = cenario.iniciar(0, faixa)
    _medir(conn, celula, 0, 8.0, anterior["iniciado_em"] + timedelta(microseconds=1))
    regra_ph()
    assert _ph_aberto(conn, celula)
    repo.encerrar_cultivo(conn, anterior["id_cultivo"], cenario.ana)
    seguinte = cenario.iniciar(0, faixa, continua_de=anterior["id_cultivo"])
    regra_ph()
    assert not _ph_aberto(conn, celula)
    # Quando o cultivo novo medir pH fora da faixa, o alerta volta a abrir.
    _medir(conn, celula, 1, 8.0, seguinte["iniciado_em"] + timedelta(seconds=1))
    regra_ph()
    assert _ph_aberto(conn, celula)


def test_ph_cultivo_sem_faixa_nunca_abre(cenario, regra_ph):
    conn, celula = cenario.conn, cenario.celulas[0]
    cultivo = cenario.iniciar(0)
    for seq, ph in enumerate((1.0, 14.5, -2.0)):
        _medir(conn, celula, seq, ph, cultivo["iniciado_em"] + timedelta(seconds=seq + 1))
        regra_ph()
    assert _alertas_ph(conn, celula) == []


# ------------------------------------------------------------------ API: células e calibração


# Campos de GET /celulas antes do modelo de dados do MVP (interface/src/api/tipos.ts).
CAMPOS_CELULA_ANTES = {"id_celula", "estado", "sensores", "primeiro_anuncio", "ultimo_contato", "ultima_seq",
                       "ultima_leitura_em", "temperatura_c", "od", "ph", "alertas_abertos"}
CAMPOS_CELULA_NOVOS = {"descricao", "apelido", "modelo", "firmware", "cultivo_atual"}


def _celulas_da_api(ambiente) -> dict[str, dict]:
    resposta = requests.get(f"{ambiente.url_api}/celulas", timeout=10)
    assert resposta.status_code == 200, resposta.text
    return {c["id_celula"]: c for c in resposta.json()}


def test_get_celulas_mantem_os_campos_e_acrescenta_os_novos(ambiente, cenario):
    conn = cenario.conn
    livre, ocupada = cenario.celulas[0], cenario.celulas[1]
    conn.execute("UPDATE celula SET descricao = 'bancada 2', apelido = %s, modelo = 'ESP32' WHERE id_celula = %s",
                 (f"apelido-{livre}", livre))
    repo.registrar_celula(conn, livre, "online", firmware="fw-2.0")
    _medir(conn, livre, 0, 7.0)
    cultivo = cenario.iniciar(1, condicao="30 °C")

    celulas = _celulas_da_api(ambiente)
    assert all(set(c) == CAMPOS_CELULA_ANTES | CAMPOS_CELULA_NOVOS for c in celulas.values())
    assert {k: celulas[livre][k] for k in ("descricao", "apelido", "modelo", "firmware", "cultivo_atual", "ultima_seq", "ph")} == {
        "descricao": "bancada 2", "apelido": f"apelido-{livre}", "modelo": "ESP32", "firmware": "fw-2.0",
        "cultivo_atual": None, "ultima_seq": 0, "ph": 7.0}
    atual = celulas[ocupada]["cultivo_atual"]
    assert set(atual) == {"id_cultivo", "id_experimento", "condicao", "iniciado_em"}
    assert (atual["id_cultivo"], atual["id_experimento"], atual["condicao"]) == (
        cultivo["id_cultivo"], cenario.experimento["id_experimento"], "30 °C")
    assert datetime.fromisoformat(atual["iniciado_em"]) == cultivo["iniciado_em"]

    repo.encerrar_cultivo(conn, cultivo["id_cultivo"], cenario.ana)
    assert _celulas_da_api(ambiente)[ocupada]["cultivo_atual"] is None


def test_calibracao_sem_os_campos_novos_funciona_como_antes(ambiente, cenario):
    conn, celula = cenario.conn, cenario.celulas[0]
    for seq in range(3):
        repo.gravar_leitura(conn, celula, seq, T0 + seq * DIA, 30.0, 1000.0 + seq, 0.45, 7.0, None)
    resposta = requests.post(f"{ambiente.url_api}/celulas/{celula}/calibracoes",
                             json={"a": 0.001, "b": 0.0, "recalcular_desde": (T0 + DIA).isoformat()}, timeout=10)
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert (corpo["versao"], corpo["a"], corpo["b"], corpo["leituras_reprocessadas"]) == (2, 0.001, 0.0, 2)
    assert {"id_calibracao", "criada_em"} <= set(corpo)
    assert {k: corpo[k] for k in ("sensor", "pontos", "r2", "organismo", "id_pessoa")} == {
        "sensor": "od", "pontos": None, "r2": None, "organismo": None, "id_pessoa": None}
    od = [l["od"] for l in repo.listar_leituras(conn, celula)]
    assert od == [0.45, 1.001, 1.002]


def test_calibracao_guarda_pontos_r2_e_organismo(ambiente, cenario):
    celula = cenario.celulas[0]
    pontos = [{"od_referencia": 0.0, "bruto": 100.0}, {"od_referencia": 1.0, "bruto": 2100.0}]
    resposta = requests.post(f"{ambiente.url_api}/celulas/{celula}/calibracoes", timeout=10, json={
        "a": 0.0005, "b": -0.05, "recalcular": False, "pontos": pontos, "r2": 0.998, "organismo": "E. coli K-12"})
    assert resposta.status_code == 201, resposta.text
    gravada = cenario.conn.execute(
        "SELECT pontos, r2, organismo, ativa FROM calibracao WHERE id_calibracao = %s",
        (resposta.json()["id_calibracao"],)).fetchone()
    assert gravada == {"pontos": pontos, "r2": 0.998, "organismo": "E. coli K-12", "ativa": True}

    for invalido in ([{"od_referencia": 0.0}], [{"od_referencia": "x", "bruto": 1}], {"od_referencia": 0, "bruto": 1}):
        resposta = requests.post(f"{ambiente.url_api}/celulas/{celula}/calibracoes", timeout=10,
                                 json={"a": 1, "b": 0, "pontos": invalido})
        assert resposta.status_code == 422, resposta.text
