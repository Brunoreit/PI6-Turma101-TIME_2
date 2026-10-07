"""Primeiro teste da arquitetura.

Três células simuladas publicam leituras. O teste derruba, uma de cada vez,
a conexão de uma célula, o consumidor e o broker, e confere que o histórico
no banco ficou completo e sem repetições. Depois envia setpoints e confere
os estados solicitado, recebido, aplicado e atingido, e o alerta quando a
célula não responde.

As etapas rodam em ordem e dependem umas das outras, como um roteiro.

Rodar:
  pytest tests/integracao -v                 (com Docker Compose)
  AMBIENTE=local pytest tests/integracao -v  (sem Docker)
"""

import signal
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
    ambiente.sinal("c02", signal.SIGUSR1)
    # O broker percebe a queda em até 1,5 x keepalive e publica offline.
    esperar(lambda: estado_celula(banco, "c02") == "offline", 20, "c02 aparecer offline")
    esperar(lambda: alerta_aberto(banco, "c02", "sem_comunicacao"), 10, "alerta de c02 sem comunicação")
    time.sleep(8)  # a célula continua medindo e guardando localmente


def test_3_reconexao_reenvia_sem_buracos(ambiente, banco):
    antes = contagem(banco)["c02"]
    ambiente.sinal("c02", signal.SIGUSR2)
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


def test_9_leitura_repetida_e_descartada(ambiente, banco):
    """Publica de novo o seq 0 da c01 com valores diferentes, como faria um
    reenvio. O banco precisa manter a leitura original."""
    import paho.mqtt.client as mqtt
    from contrato import Leitura, topicos
    from datetime import datetime, timezone

    original = banco.execute("SELECT * FROM leitura WHERE id_celula = 'c01' AND seq = 0").fetchone()
    cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="teste-duplicata")
    cliente.connect(ambiente.host_mqtt, ambiente.porta_mqtt)
    cliente.loop_start()
    repetida = Leitura(seq=0, ts=datetime.now(timezone.utc), temperatura_c=99.0, od_bruto=1.0, ph=1.0)
    for _ in range(3):
        cliente.publish(topicos.leitura("c01"), repetida.para_json(), qos=1).wait_for_publish(5)
    time.sleep(2)
    cliente.loop_stop()
    cliente.disconnect()

    atual = banco.execute("SELECT * FROM leitura WHERE id_celula = 'c01' AND seq = 0").fetchone()
    assert atual["temperatura_c"] == original["temperatura_c"] != 99.0
    assert historico_completo(banco)


def test_10_integridade_final(ambiente, banco):
    integridade = requests.get(f"{ambiente.url_api}/integridade", timeout=5).json()
    assert len(integridade) == len(CELULAS)
    assert all(linha["completo"] for linha in integridade), integridade
