"""Célula de cultivo simulada.

Faz o papel de uma placa ESP32 para testar o sistema central sem hardware:
anuncia-se ao conectar, publica leituras numeradas, guarda tudo localmente
quando a conexão cai e reenvia depois, e responde aos pedidos de setpoint.

Configuração por variáveis de ambiente (ver .env.example):
  ID_CELULA    identificador da célula, por exemplo c01
  CENARIO      normal | ignorar_setpoint | falha_aquecimento
  INTERVALO_S  segundos entre leituras (20 no uso normal, 1 nos testes)

Falha de rede sob comando, para os testes:
  SIGUSR1  corta a rede sem desconectar de forma limpa (o broker publica offline)
  SIGUSR2  restaura a rede

Executar: python celula.py
"""

import logging
import os
import signal
import socket
import threading
import time
from datetime import datetime, timezone

import paho.mqtt.client as mqtt

from buffer import Buffer
from contrato import Estado, Leitura, PedidoSetpoint, RespostaSetpoint, topicos
from modelo import ModeloCultivo

ID = os.environ.get("ID_CELULA", "c01")
CENARIO = os.environ.get("CENARIO", "normal")
MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", 1883))
INTERVALO_S = float(os.environ.get("INTERVALO_S", 20))
KEEPALIVE_S = int(os.environ.get("KEEPALIVE_S", 30))
BUFFER_DIR = os.environ.get("BUFFER_DIR", "/dados")
TEMP_MIN_C, TEMP_MAX_C = 20.0, 45.0
SENSORES = ["temperatura", "od", "ph"]

logging.basicConfig(level=logging.INFO, format=f"%(asctime)s {ID} %(levelname)s %(message)s")
log = logging.getLogger(ID)


class Celula:
    def __init__(self):
        self.buffer = Buffer(os.path.join(BUFFER_DIR, f"{ID}.db"))
        setpoint = float(self.buffer.ler("setpoint_c", os.environ.get("TEMP_INICIAL_C", "30")))
        self.modelo = ModeloCultivo(
            temperatura_c=float(os.environ.get("TEMP_INICIAL_C", 30)),
            setpoint_c=setpoint,
            tau_s=float(os.environ.get("TAU_S", 120)),
            escala_tempo=float(os.environ.get("ESCALA_TEMPO", 1)),
            falha_aquecimento=CENARIO == "falha_aquecimento",
        )
        self.conectado = threading.Event()
        self.rede_cortada = False
        self.em_voo: list[tuple[int, mqtt.MQTTMessageInfo]] = []
        self.pedido_corte: str | None = None

        self.cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"evolver-celula-{ID}")
        self.cliente.will_set(topicos.estado(ID), Estado(estado="offline").para_json(),
                              qos=topicos.QOS, retain=True)
        self.cliente.reconnect_delay_set(min_delay=1, max_delay=5)
        self.cliente.max_inflight_messages_set(100)
        self.cliente.on_connect = self._ao_conectar
        self.cliente.on_disconnect = self._ao_desconectar
        self.cliente.message_callback_add(topicos.setpoint(ID), self._ao_receber_setpoint)

    # ------------------------------------------------------------- MQTT

    def _ao_conectar(self, cli, _u, _f, codigo, _p):
        if codigo.is_failure:
            log.error("conexão recusada: %s", codigo)
            return
        cli.publish(topicos.estado(ID), Estado(estado="online", sensores=SENSORES, versao="sim-0.1").para_json(),
                    qos=topicos.QOS, retain=True)
        cli.subscribe(topicos.setpoint(ID), qos=topicos.QOS)
        self.em_voo.clear()
        self.conectado.set()
        log.info("conectado, %d leituras guardadas para reenviar", self.buffer.quantidade())

    def _ao_desconectar(self, _cli, _u, _f, codigo, _p):
        self.conectado.clear()
        log.warning("desconectado (%s), leituras ficam guardadas", codigo)

    def _ao_receber_setpoint(self, cli, _u, msg):
        try:
            pedido = PedidoSetpoint.de_json(msg.payload)
        except ValueError as erro:
            log.warning("pedido de setpoint inválido: %s", erro)
            return
        if pedido.id == self.buffer.ler("ultimo_pedido"):
            return  # mensagem retida reentregue ao reconectar, já tratada
        if CENARIO == "ignorar_setpoint":
            log.info("cenário ignorar_setpoint: pedido %s não será respondido", pedido.id)
            return

        def responder(estado, motivo=None):
            cli.publish(topicos.setpoint_resposta(ID),
                        RespostaSetpoint(id=pedido.id, estado=estado, motivo=motivo).para_json(),
                        qos=topicos.QOS)

        self.buffer.salvar("ultimo_pedido", pedido.id)
        responder("recebido")
        if not TEMP_MIN_C <= pedido.temperatura_c <= TEMP_MAX_C:
            responder("recusado", f"fora da faixa {TEMP_MIN_C:.0f} a {TEMP_MAX_C:.0f} °C")
            return
        self.modelo.setpoint_c = pedido.temperatura_c
        self.buffer.salvar("setpoint_c", str(pedido.temperatura_c))
        responder("aplicado")
        log.info("setpoint %s aplicado: %.1f °C", pedido.id, pedido.temperatura_c)

    # ------------------------------------------------------------- envio

    def _medir(self) -> None:
        seq = self.buffer.proximo_seq()
        leitura = Leitura(seq=seq, ts=datetime.now(timezone.utc), **self.modelo.medir())
        self.buffer.guardar(seq, leitura.para_json())

    def _enviar_pendentes(self) -> None:
        # Tira do buffer o que o broker já confirmou.
        confirmadas = [(s, i) for s, i in self.em_voo if i.is_published()]
        for seq, _ in confirmadas:
            self.buffer.remover(seq)
        self.em_voo = [(s, i) for s, i in self.em_voo if not i.is_published()]

        if not self.conectado.is_set() or self.rede_cortada:
            return
        ja_enviadas = {s for s, _ in self.em_voo}
        for seq, payload in self.buffer.pendentes():
            if seq in ja_enviadas:
                continue
            info = self.cliente.publish(topicos.leitura(ID), payload, qos=topicos.QOS)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                break
            self.em_voo.append((seq, info))

    # ------------------------------------------------------------- falha de rede simulada

    def _cortar_rede(self) -> None:
        log.warning("REDE CORTADA: sem aviso ao broker, leituras passam a ser guardadas")
        self.rede_cortada = True
        self.conectado.clear()
        self.cliente.loop_stop()  # para os pings: o broker vai notar a falta e publicar offline
        self.em_voo.clear()

    def _restaurar_rede(self) -> None:
        log.warning("REDE RESTAURADA")
        sock = self.cliente.socket()
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.rede_cortada = False
        self.cliente.loop_start()

    # ------------------------------------------------------------- laço principal

    def rodar(self) -> None:
        parar = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: parar.set())
        signal.signal(signal.SIGINT, lambda *_: parar.set())
        signal.signal(signal.SIGUSR1, lambda *_: setattr(self, "pedido_corte", "cortar"))
        signal.signal(signal.SIGUSR2, lambda *_: setattr(self, "pedido_corte", "restaurar"))

        log.info("iniciando, cenário %s, leitura a cada %.1f s", CENARIO, INTERVALO_S)
        self.cliente.connect_async(MQTT_HOST, MQTT_PORT, keepalive=KEEPALIVE_S)
        self.cliente.loop_start()

        proxima = time.monotonic()
        ultimo = time.monotonic()
        while not parar.is_set():
            if self.pedido_corte == "cortar" and not self.rede_cortada:
                self._cortar_rede()
            elif self.pedido_corte == "restaurar" and self.rede_cortada:
                self._restaurar_rede()
            self.pedido_corte = None

            agora = time.monotonic()
            if agora >= proxima:
                self.modelo.avancar(agora - ultimo)
                ultimo = agora
                self._medir()
                proxima += INTERVALO_S
            self._enviar_pendentes()
            parar.wait(min(0.2, max(0.0, proxima - time.monotonic())))

        log.info("encerrando de forma limpa")
        if self.conectado.is_set():
            self.cliente.publish(topicos.estado(ID), Estado(estado="offline").para_json(),
                                 qos=topicos.QOS, retain=True).wait_for_publish(timeout=2)
            self.cliente.disconnect()
        self.cliente.loop_stop()


if __name__ == "__main__":
    Celula().rodar()
