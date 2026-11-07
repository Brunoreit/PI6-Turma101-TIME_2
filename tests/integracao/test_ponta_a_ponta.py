"""Teste ponta a ponta da arquitetura.

Três células simuladas publicam leituras. O teste derruba, uma de cada vez,
a conexão de uma célula, o consumidor e o broker, e confere que o histórico
no banco ficou completo e sem repetições. Depois envia setpoints e confere
os estados solicitado, recebido, aplicado e atingido, e o alerta quando a
célula não responde. Por fim, confere a colisão de seq, o firmware
anunciado pelas células, o reenvio idêntico de uma leitura, o alerta de pH
fora da faixa do cultivo e o setpoint enviado ao iniciar um cultivo pela API,
inclusive a recusa com o broker parado.

As etapas rodam em ordem e dependem umas das outras, como um roteiro.

Rodar:
  pytest tests/integracao -v                 (com Docker Compose)
  AMBIENTE=local pytest tests/integracao -v  (sem Docker)
"""

import time

import psycopg
import pytest
import requests
from psycopg.rows import dict_row

from tests.integracao.ambiente import CELULAS, criar_ambiente

pytestmark = pytest.mark.integracao


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


def esperar(condicao, timeout: float, descricao: str, intervalo: float = 0.5):
    """Repete a verificação até ela devolver algo verdadeiro ou o tempo acabar."""
    fim = time.time() + timeout
    ultimo = None
    while time.time() < fim:
        ultimo = condicao()
        if ultimo:
            return ultimo
        time.sleep(intervalo)
    pytest.fail(f"tempo esgotado esperando: {descricao} (último valor: {ultimo!r})")


def contagem(banco) -> dict[str, int]:
    return {
        l["id_celula"]: l["leituras"]
        for l in banco.execute("SELECT id_celula, count(*) AS leituras FROM leitura GROUP BY 1").fetchall()
    }


def historico_completo(banco) -> bool:
    linhas = banco.execute(
        """
        SELECT id_celula, count(*) AS leituras, count(DISTINCT seq) AS unicos,
               max(seq) - min(seq) + 1 AS esperado, min(seq) AS primeiro
          FROM leitura GROUP BY id_celula
        """
    ).fetchall()
    return len(linhas) == len(CELULAS) and all(
        l["leituras"] == l["unicos"] == l["esperado"] and l["primeiro"] == 0 for l in linhas
    )


def alerta_aberto(banco, id_celula: str, tipo: str) -> bool:
    return banco.execute(
        "SELECT 1 FROM alerta WHERE id_celula = %s AND tipo = %s AND fechado_em IS NULL",
        (id_celula, tipo),
    ).fetchone() is not None


def estado_celula(banco, id_celula: str) -> str | None:
    linha = banco.execute("SELECT estado FROM celula WHERE id_celula = %s", (id_celula,)).fetchone()
    return linha and linha["estado"]


def entrar(ambiente, email: str) -> dict:
    """Cadastra a pessoa pela API e devolve o cabeçalho com o token."""
    resposta = requests.post(f"{ambiente.url_api}/auth/cadastro", timeout=10,
                             json={"nome": "Ana", "email": email, "senha": "cultura123"})
    assert resposta.status_code == 201, resposta.text
    return {"Authorization": f"Bearer {resposta.json()['token']}"}


def novo_experimento(ambiente, cabecalhos: dict, temperatura_alvo_c: float | None) -> int:
    resposta = requests.post(f"{ambiente.url_api}/experimentos", headers=cabecalhos, timeout=10, json={
        "nome": "Setpoint ao iniciar", "modo": "curva_crescimento", "temperatura_alvo_c": temperatura_alvo_c})
    assert resposta.status_code == 201, resposta.text
    return resposta.json()["id_experimento"]


def cresceu_em_todas(banco, antes: dict[str, int], minimo: int):
    def verificar():
        agora = contagem(banco)
        return all(agora.get(c, 0) >= antes.get(c, 0) + minimo for c in CELULAS) and agora
    return verificar


# ------------------------------------------------------------------ etapas


def test_1_celulas_aparecem_sozinhas(banco):
    esperar(lambda: all(estado_celula(banco, c) == "online" for c in CELULAS), 30,
            "as três células se cadastrarem como online")
    esperar(cresceu_em_todas(banco, {}, 10), 30, "10 leituras de cada célula")
    assert historico_completo(banco)


def test_2_queda_da_celula_abre_alerta(ambiente, banco):
    ambiente.sinal("c02", "SIGUSR1")
    # O broker percebe a queda em até 1,5 x keepalive e publica offline.
    esperar(lambda: estado_celula(banco, "c02") == "offline", 20, "c02 aparecer offline")
    esperar(lambda: alerta_aberto(banco, "c02", "sem_comunicacao"), 10, "alerta de c02 sem comunicação")
    time.sleep(8)  # a célula continua medindo e guardando localmente


def test_3_reconexao_reenvia_sem_buracos(ambiente, banco):
    antes = contagem(banco)["c02"]
    ambiente.sinal("c02", "SIGUSR2")
    esperar(lambda: estado_celula(banco, "c02") == "online", 20, "c02 voltar a online")
    # Ao voltar, chegam de uma vez as leituras guardadas durante a queda.
    esperar(lambda: contagem(banco)["c02"] >= antes + 8, 20, "reenvio das leituras guardadas")
    esperar(lambda: historico_completo(banco), 20, "histórico completo e sem repetições")
    esperar(lambda: not alerta_aberto(banco, "c02", "sem_comunicacao"), 10, "alerta de c02 fechado")


def test_4_consumidor_parado_nao_perde_dados(ambiente, banco):
    ambiente.parar("consumidor")
    parado = contagem(banco)
    time.sleep(8)
    assert contagem(banco) == parado, "nada deveria ser gravado com o consumidor parado"
    ambiente.iniciar_servico("consumidor")
    # O broker entrega o que guardou na sessão persistente do consumidor.
    esperar(cresceu_em_todas(banco, parado, 8), 30, "entrega do que ficou no broker")
    esperar(lambda: historico_completo(banco), 20, "histórico completo após o consumidor voltar")


def test_5_broker_parado_nao_perde_dados(ambiente, banco):
    ambiente.parar("broker")
    parado = contagem(banco)
    time.sleep(8)
    ambiente.iniciar_servico("broker")
    esperar(cresceu_em_todas(banco, parado, 8), 40, "reenvio das três células após o broker voltar")
    esperar(lambda: historico_completo(banco), 20, "histórico completo após o broker voltar")


def test_6_setpoint_passa_por_todos_os_estados(ambiente):
    api = ambiente.url_api
    esperar(lambda: requests.get(f"{api}/saude", timeout=5).json()["broker"], 30, "API reconectar ao broker")

    resposta = requests.post(f"{api}/celulas/c01/setpoint", json={"temperatura_c": 37.0}, timeout=10)
    assert resposta.status_code == 202, resposta.text
    pedido = resposta.json()
    assert pedido["estado"] == "solicitado"

    final = esperar(
        lambda: (p := requests.get(f"{api}/setpoints/{pedido['id_pedido']}", timeout=5).json())["estado"] == "atingido" and p,
        40, "setpoint de c01 chegar a atingido",
    )
    instantes = [final["solicitado_em"], final["recebido_em"], final["aplicado_em"], final["atingido_em"]]
    assert all(instantes), final
    assert instantes == sorted(instantes), "os estados devem acontecer em ordem"


def test_7_setpoint_fora_da_faixa_e_recusado_pela_api(ambiente):
    resposta = requests.post(f"{ambiente.url_api}/celulas/c01/setpoint",
                             json={"temperatura_c": 80.0}, timeout=10)
    assert resposta.status_code == 422


def test_8_celula_que_nao_responde_gera_alerta(ambiente, banco):
    resposta = requests.post(f"{ambiente.url_api}/celulas/c03/setpoint",
                             json={"temperatura_c": 35.0}, timeout=10)
    assert resposta.status_code == 202
    esperar(lambda: alerta_aberto(banco, "c03", "setpoint_sem_confirmacao"), 20,
            "alerta de setpoint sem confirmação em c03")
    pedido = requests.get(f"{ambiente.url_api}/setpoints/{resposta.json()['id_pedido']}", timeout=5).json()
    assert pedido["estado"] == "solicitado"


def publicar_leituras(ambiente, id_celula: str, leitura, vezes: int = 1) -> None:
    """Publica uma leitura como se fosse a célula, e espera o broker confirmar."""
    import paho.mqtt.client as mqtt
    from contrato import topicos

    cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="teste-duplicata")
    cliente.connect(ambiente.host_mqtt, ambiente.porta_mqtt)
    cliente.loop_start()
    for _ in range(vezes):
        cliente.publish(topicos.leitura(id_celula), leitura.para_json(), qos=1).wait_for_publish(5)
    time.sleep(2)
    cliente.loop_stop()
    cliente.disconnect()


def test_9_leitura_repetida_e_descartada(ambiente, banco):
    """Publica de novo o seq 0 da c01 com outro horário e outros valores.
    São duas medições com o mesmo número (colisão): o banco mantém a
    original e abre o alerta colisao_seq."""
    from contrato import Leitura
    from datetime import datetime, timezone

    original = banco.execute("SELECT * FROM leitura WHERE id_celula = 'c01' AND seq = 0").fetchone()
    repetida = Leitura(seq=0, ts=datetime.now(timezone.utc), temperatura_c=99.0, od_bruto=1.0, ph=1.0)
    publicar_leituras(ambiente, "c01", repetida, vezes=3)

    esperar(lambda: alerta_aberto(banco, "c01", "colisao_seq"), 10, "alerta de colisão de seq na c01")
    atual = banco.execute("SELECT * FROM leitura WHERE id_celula = 'c01' AND seq = 0").fetchone()
    assert atual == original
    assert atual["temperatura_c"] != 99.0
    assert banco.execute("SELECT count(*) AS n FROM alerta WHERE id_celula = 'c01' AND tipo = 'colisao_seq'").fetchone()["n"] == 1
    assert historico_completo(banco)


def test_10_calibracao_recalcula_so_o_pedido(ambiente, banco):
    """Nova calibração da c02 sem recalcular e depois a partir de um instante.
    As leituras de antes ficam como estavam; o valor bruto nunca muda."""
    url = f"{ambiente.url_api}/celulas/c02/calibracoes"
    antes = {l["seq"]: l for l in banco.execute(
        "SELECT seq, ts_origem, od_bruto::float8 AS od_bruto, od::float8 AS od FROM leitura WHERE id_celula = 'c02' ORDER BY seq").fetchall()}

    resposta = requests.post(url, json={"a": 0.001, "b": 0.0, "recalcular": False}, timeout=10)
    assert resposta.status_code == 201, resposta.text
    assert resposta.json()["leituras_reprocessadas"] == 0
    depois = {l["seq"]: l for l in banco.execute(
        "SELECT seq, od_bruto::float8 AS od_bruto, od::float8 AS od FROM leitura WHERE id_celula = 'c02' AND seq <= %s", (max(antes),)).fetchall()}
    assert all(depois[s]["od"] == antes[s]["od"] and depois[s]["od_bruto"] == antes[s]["od_bruto"] for s in antes)

    # Recalcula só a segunda metade das leituras que já existiam.
    meio = sorted(antes)[len(antes) // 2]
    desde = antes[meio]["ts_origem"]
    resposta = requests.post(url, json={"a": 0.002, "b": 0.01, "recalcular_desde": desde.isoformat()}, timeout=10)
    assert resposta.status_code == 201, resposta.text
    linhas = banco.execute(
        "SELECT seq, ts_origem, od_bruto::float8 AS od_bruto, od::float8 AS od FROM leitura WHERE id_celula = 'c02' AND od_bruto IS NOT NULL").fetchall()
    recalculadas = [l for l in linhas if l["ts_origem"] >= desde]
    assert resposta.json()["leituras_reprocessadas"] == len(recalculadas) > 0
    assert all(abs(l["od"] - (0.002 * l["od_bruto"] + 0.01)) <= 0.00005 + 1e-9 for l in recalculadas)
    assert all(l["od"] == antes[l["seq"]]["od"] for l in linhas if l["ts_origem"] < desde)


def test_11_estado_grava_o_firmware(banco):
    """O simulador anuncia versao "sim-0.1" na mensagem de estado."""
    firmwares = {l["id_celula"]: l["firmware"] for l in banco.execute("SELECT id_celula, firmware FROM celula").fetchall()}
    assert firmwares == {c: "sim-0.1" for c in CELULAS}


def test_12_reenvio_identico_nao_abre_alerta(ambiente, banco):
    """Publica de novo uma leitura da c02 exatamente como foi gravada, como
    faria uma placa reenviando o que guardou. É só descartada."""
    from contrato import Leitura

    original = banco.execute("SELECT * FROM leitura WHERE id_celula = 'c02' AND seq = 1").fetchone()
    reenvio = Leitura(seq=1, ts=original["ts_origem"], temperatura_c=original["temperatura_c"],
                      od_bruto=original["od_bruto"], ph=original["ph"])
    publicar_leituras(ambiente, "c02", reenvio, vezes=2)

    assert banco.execute("SELECT * FROM leitura WHERE id_celula = 'c02' AND seq = 1").fetchone() == original
    assert not alerta_aberto(banco, "c02", "colisao_seq")
    assert historico_completo(banco)


def test_13_ph_fora_da_faixa_do_cultivo_abre_alerta(banco):
    """Põe a c01 num cultivo com faixa de pH que exclui o pH simulado (entre
    6,7 e 7,0) e espera o processo de regras abrir o alerta. Depois só muda
    a faixa, e o alerta fecha; volta a faixa, e o alerta reabre; encerrar o
    cultivo fecha. O simulador não muda. A API de experimentos ainda não
    existe, então o cultivo é criado pelos repositórios."""
    from app.banco import repositorios as repo

    pessoa = repo.criar_pessoa(banco, "Teste", "teste-ph@cnpem.br", "x")["id_pessoa"]
    experimento = repo.criar_experimento(banco, pessoa, nome="pH", modo="curva_crescimento",
                                         ph_ref_min=7.5, ph_ref_max=8.0)
    cultivo = repo.iniciar_cultivo(banco, experimento["id_experimento"], "c01", pessoa)["id_cultivo"]
    esperar(lambda: alerta_aberto(banco, "c01", "ph_fora_da_faixa"), 15, "alerta de pH fora da faixa na c01")

    repo.atualizar_cultivo(banco, cultivo, ph_ref_min=6.0, ph_ref_max=7.5)
    esperar(lambda: not alerta_aberto(banco, "c01", "ph_fora_da_faixa"), 15, "alerta de pH fechar com a faixa nova")

    repo.atualizar_cultivo(banco, cultivo, ph_ref_min=7.5, ph_ref_max=8.0)
    esperar(lambda: alerta_aberto(banco, "c01", "ph_fora_da_faixa"), 15, "alerta de pH reabrir")
    repo.encerrar_cultivo(banco, cultivo, pessoa)
    esperar(lambda: not alerta_aberto(banco, "c01", "ph_fora_da_faixa"), 15, "alerta de pH fechar ao encerrar o cultivo")
    assert not any(alerta_aberto(banco, c, "ph_fora_da_faixa") for c in CELULAS)


def test_14_cultivo_com_temperatura_alvo_envia_o_setpoint(ambiente, banco):
    """G.8: iniciar o cultivo pela API publica a temperatura alvo do
    experimento, com a pessoa logada no pedido, e o pedido avança até
    aplicado numa célula normal (c02)."""
    api = ambiente.url_api
    cabecalhos = entrar(ambiente, "ana-setpoint@cnpem.br")
    e = novo_experimento(ambiente, cabecalhos, 33.0)

    resposta = requests.post(f"{api}/experimentos/{e}/cultivos", json={"id_celula": "c02"},
                             headers=cabecalhos, timeout=15)
    assert resposta.status_code == 201, resposta.text
    corpo = resposta.json()
    assert corpo["setpoint_confirmado"] is True
    pedido = corpo["pedido_setpoint"]
    id_pessoa = requests.get(f"{api}/auth/eu", headers=cabecalhos, timeout=5).json()["id_pessoa"]
    assert (pedido["id_celula"], pedido["temperatura_c"], pedido["solicitado_por"], pedido["id_pessoa"]) == (
        "c02", 33.0, "Ana", id_pessoa)

    final = esperar(
        lambda: (p := requests.get(f"{api}/setpoints/{pedido['id_pedido']}", timeout=5).json())["estado"]
        in ("aplicado", "atingido") and p,
        30, "setpoint do cultivo chegar a aplicado na c02",
    )
    assert final["recebido_em"] and final["aplicado_em"] and final["id_pessoa"] == id_pessoa


def test_15_broker_parado_recusa_cultivo_com_temperatura_alvo(ambiente, banco):
    """RN-03: com o broker parado, iniciar um cultivo de experimento com
    temperatura alvo dá 503 e nada é gravado. Sem temperatura alvo, o
    cultivo começa normalmente."""
    api = ambiente.url_api
    cabecalhos = entrar(ambiente, "ana-broker@cnpem.br")
    com_temperatura = novo_experimento(ambiente, cabecalhos, 33.0)
    sem_temperatura = novo_experimento(ambiente, cabecalhos, None)
    pedidos = lambda: banco.execute("SELECT count(*) AS n FROM pedido_setpoint").fetchone()["n"]
    cultivos = lambda: banco.execute("SELECT count(*) AS n FROM cultivo").fetchone()["n"]
    antes = (pedidos(), cultivos())

    ambiente.parar("broker")
    parado = contagem(banco)
    esperar(lambda: not requests.get(f"{api}/saude", timeout=5).json()["broker"], 30, "API perceber o broker parado")
    recusado = requests.post(f"{api}/experimentos/{com_temperatura}/cultivos", json={"id_celula": "c03"},
                             headers=cabecalhos, timeout=15)
    assert recusado.status_code == 503, recusado.text
    assert (pedidos(), cultivos()) == antes
    status = requests.get(f"{api}/experimentos/{com_temperatura}", headers=cabecalhos, timeout=5).json()["status"]
    assert status == "cadastrado"

    aceito = requests.post(f"{api}/experimentos/{sem_temperatura}/cultivos", json={"id_celula": "c03"},
                           headers=cabecalhos, timeout=15)
    assert aceito.status_code == 201, aceito.text
    assert (aceito.json()["pedido_setpoint"], aceito.json()["setpoint_confirmado"]) == (None, None)
    assert pedidos() == antes[0]

    ambiente.iniciar_servico("broker")
    esperar(lambda: requests.get(f"{api}/saude", timeout=5).json()["broker"], 30, "API reconectar ao broker")
    esperar(cresceu_em_todas(banco, parado, 8), 40, "reenvio das três células após o broker voltar")
    esperar(lambda: historico_completo(banco), 20, "histórico completo após o broker voltar")


def test_16_integridade_final(ambiente, banco):
    integridade = requests.get(f"{ambiente.url_api}/integridade", timeout=5).json()
    assert len(integridade) == len(CELULAS)
    assert all(linha["completo"] for linha in integridade), integridade
