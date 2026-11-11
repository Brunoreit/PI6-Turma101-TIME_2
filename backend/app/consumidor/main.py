"""Processo consumidor: assina os tópicos das células e grava no banco.

Usa sessão persistente (clean_session=False) com um client_id fixo. Assim,
se este processo parar, o broker guarda as mensagens com QoS 1 e entrega
tudo quando ele voltar.

Isso só vale depois da primeira inscrição: antes dela o broker não sabe que
o consumidor existe e descarta o que chegar. Por isso, ao ter a inscrição
confirmada, o processo cria ARQUIVO_INSCRITO. O docker-compose usa esse
arquivo no healthcheck e só sobe as células depois dele.

Executar: python -m app.consumidor.main
"""

import logging
import os
import signal
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt
import psycopg

from app.banco import repositorios as repo
from app.banco.conexao import conectar
from app.config import config
from app.consumidor.tratadores import Tratador
from contrato import topicos

logging.basicConfig(level=logging.INFO, format="%(asctime)s consumidor %(levelname)s %(message)s")
log = logging.getLogger("consumidor")

CLIENT_ID = "evolver-consumidor"
# /tmp/consumidor-inscrito no contêiner. Lido pelo healthcheck do docker-compose.yml.
ARQUIVO_INSCRITO = Path(tempfile.gettempdir()) / "consumidor-inscrito"


class SinalDeVida:
    """Grava em processo que o consumidor está vivo e se está conectado ao
    broker. Roda numa thread com conexão própria: um banco lento ou fora do
    ar não atrasa o tratamento das mensagens. Grava a cada SINAL_VIDA_S e
    logo depois de conectar ou cair do broker."""

    def __init__(self):
        self.iniciado_em = datetime.now(timezone.utc)
        self.broker_conectado = False
        self.broker_desde = self.iniciado_em
        self._mudou = threading.Event()
        self._conn = None

    def broker(self, conectado: bool) -> None:
        if conectado != self.broker_conectado:
            self.broker_conectado = conectado
            self.broker_desde = datetime.now(timezone.utc)
            self._mudou.set()

    def gravar(self) -> None:
        try:
            if self._conn is None or self._conn.closed:
                self._conn = conectar(tentativas=1)
            repo.registrar_sinal(self._conn, "consumidor", self.iniciado_em,
                                 self.broker_conectado, self.broker_desde)
        except psycopg.Error as erro:
            log.warning("sinal de vida não gravado (%s), tentando de novo", erro.__class__.__name__)
            self._conn = None

    def rodar(self, parar: threading.Event) -> None:
        while not parar.is_set():
            self.gravar()
            self._mudou.wait(config.sinal_vida_s)
            self._mudou.clear()


def main() -> None:
    ARQUIVO_INSCRITO.unlink(missing_ok=True)
    tratador = Tratador(conectar())
    sinal = SinalDeVida()

    cliente = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2, client_id=CLIENT_ID, clean_session=False
    )
    cliente.reconnect_delay_set(min_delay=1, max_delay=5)

    def ao_conectar(cli, _userdata, _flags, codigo, _props):
        if codigo.is_failure:
            log.error("conexão recusada pelo broker: %s", codigo)
            return
        cli.subscribe([(t, topicos.QOS) for t in topicos.ASSINATURAS_CONSUMIDOR])
        sinal.broker(True)
        log.info("conectado ao broker e assinando %d tópicos", len(topicos.ASSINATURAS_CONSUMIDOR))

    def ao_inscrever(_cli, _userdata, _mid, codigos, _props):
        if any(c.is_failure for c in codigos):
            log.error("inscrição recusada pelo broker: %s", codigos)
            return
        # A partir daqui o broker guarda as mensagens para este client_id.
        ARQUIVO_INSCRITO.touch()

    def ao_desconectar(_cli, _userdata, _flags, codigo, _props):
        sinal.broker(False)
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
    cliente.on_subscribe = ao_inscrever
    cliente.on_disconnect = ao_desconectar
    cliente.on_message = ao_receber

    parar = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: parar.set())
    signal.signal(signal.SIGINT, lambda *_: parar.set())

    cliente.connect_async(config.mqtt_host, config.mqtt_port, keepalive=30)
    cliente.loop_start()
    threading.Thread(target=sinal.rodar, args=(parar,), daemon=True, name="sinal-de-vida").start()
    while not parar.wait(30):
        log.info("contagem: %s", tratador.contagem)
    cliente.loop_stop()
    log.info("encerrado, contagem final: %s", tratador.contagem)


if __name__ == "__main__":
    main()
