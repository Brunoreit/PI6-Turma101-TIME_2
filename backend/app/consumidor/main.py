"""Processo consumidor: assina os tópicos das células e grava no banco.

Usa sessão persistente (clean_session=False) com um client_id fixo. Assim,
se este processo parar, o broker guarda as mensagens com QoS 1 e entrega
tudo quando ele voltar.

Executar: python -m app.consumidor.main
"""

import logging
import os
import signal
import threading

import paho.mqtt.client as mqtt

from app.banco.conexao import conectar
from app.config import config
from app.consumidor.tratadores import Tratador
from contrato import topicos

logging.basicConfig(level=logging.INFO, format="%(asctime)s consumidor %(levelname)s %(message)s")
log = logging.getLogger("consumidor")

CLIENT_ID = "evolver-consumidor"


def main() -> None:
    tratador = Tratador(conectar())

    cliente = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2, client_id=CLIENT_ID, clean_session=False
    )
    cliente.reconnect_delay_set(min_delay=1, max_delay=5)

    def ao_conectar(cli, _userdata, _flags, codigo, _props):
        if codigo.is_failure:
            log.error("conexão recusada pelo broker: %s", codigo)
            return
        cli.subscribe([(t, topicos.QOS) for t in topicos.ASSINATURAS_CONSUMIDOR])
        log.info("conectado ao broker e assinando %d tópicos", len(topicos.ASSINATURAS_CONSUMIDOR))

    def ao_desconectar(_cli, _userdata, _flags, codigo, _props):
        log.warning("desconectado do broker (%s), reconectando", codigo)

    def ao_receber(_cli, _userdata, msg):
        try:
            tratador.tratar(msg.topic, msg.payload)
        except Exception:
            # Uma exceção aqui mataria a thread do paho e o processo seguiria
            # vivo sem consumir nada. Encerrar sem confirmar (PUBACK) faz o
            # broker guardar a mensagem e reentregar quando o Docker reiniciar.
            log.exception("falha ao gravar mensagem de %s, encerrando", msg.topic)
            os._exit(1)

    cliente.on_connect = ao_conectar
    cliente.on_disconnect = ao_desconectar
    cliente.on_message = ao_receber

    parar = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: parar.set())
    signal.signal(signal.SIGINT, lambda *_: parar.set())

    cliente.connect_async(config.mqtt_host, config.mqtt_port, keepalive=30)
    cliente.loop_start()
    while not parar.wait(30):
        log.info("contagem: %s", tratador.contagem)
    cliente.loop_stop()
    log.info("encerrado, contagem final: %s", tratador.contagem)


if __name__ == "__main__":
    main()
