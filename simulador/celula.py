"""Célula de cultivo simulada.

Faz o papel de uma placa ESP32 para testar o sistema central sem hardware:
anuncia-se ao conectar, publica leituras numeradas, guarda tudo localmente
quando a conexão cai e reenvia depois, e responde aos pedidos de setpoint.

Configuração por variáveis de ambiente (ver .env.example):
  ID_CELULA    identificador da célula, por exemplo c01 (ou lista separada por vírgula)
  CENARIO      normal | ignorar_setpoint | falha_aquecimento | desvio_temperatura
  INTERVALO_S  segundos entre leituras (20 no uso normal, 1 nos testes)
  HISTORICO_HORAS      horas de leituras passadas publicadas na primeira
                       subida (buffer vazio), para os gráficos já terem dados.
                       0 desliga (padrão)
  HISTORICO_PASSO_MIN  minutos entre as leituras desse histórico (padrão 20)

Comandos manuais (tópico evolver/simulador/{id}/comando, enviados pela CLI)
forçam o que o sensor mede. Depois de um comando de OD, a célula publica uma
rajada de leituras (padrão 6, meio segundo entre elas) para a janela da
calibração ao vivo encher na hora, sem esperar 6 x INTERVALO_S.

Falha de rede sob comando, para os testes:
  SIGUSR1  corta a rede sem desconectar de forma limpa (o broker publica offline)
  SIGUSR2  restaura a rede

Executar:
  python -m simulador.celula                (roda a célula definida em ID_CELULA, padrão c01)
  python -m simulador                       (roda todas as 16 células com perfis da interface)
"""

import json
import logging
import os
import signal
import socket
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import paho.mqtt.client as mqtt

from contrato import Estado, Leitura, PedidoSetpoint, RespostaSetpoint, topicos
from simulador.buffer import Buffer
from simulador.modelo import ModeloCultivo
from simulador.perfis import obter_perfil

TEMP_MIN_C, TEMP_MAX_C = 20.0, 45.0
SENSORES = ["temperatura", "od", "ph"]
RAJADA_PADRAO = 6          # leituras publicadas logo após um comando manual de OD
RAJADA_INTERVALO_S = 0.5
RUIDO_RELATIVO = 0.001     # ruído padrão de um valor forçado: 0,1% do bruto (variação ~0,3% em 6 leituras)


def ruido_proporcional(bruto: float) -> float:
    """Desvio padrão do ruído para um bruto forçado. Proporcional ao valor,
    para o branco (bruto baixo) ficar tão estável quanto os padrões."""
    return max(0.05, abs(bruto) * RUIDO_RELATIVO)


class Celula:
    def __init__(
        self,
        id_celula: str | None = None,
        cenario: str | None = None,
        mqtt_host: str | None = None,
        mqtt_port: int | None = None,
        intervalo_s: float | None = None,
        keepalive_s: int | None = None,
        buffer_dir: str | Path | None = None,
        temp_inicial_c: float | None = None,
        setpoint_c: float | None = None,
        od_inicial: float | None = None,
        ph_base: float | None = None,
        versao: str | None = None,
        tau_s: float | None = None,
        escala_tempo: float | None = None,
        historico_horas: float | None = None,
        historico_passo_min: float | None = None,
    ):
        self.id = id_celula or os.environ.get("ID_CELULA", "c01")
        perfil = obter_perfil(self.id)

        self.cenario = cenario or os.environ.get("CENARIO") or perfil.cenario
        self.mqtt_host = mqtt_host or os.environ.get("MQTT_HOST", "localhost")
        self.mqtt_port = mqtt_port if mqtt_port is not None else int(os.environ.get("MQTT_PORT", 1883))
        self.intervalo_s = intervalo_s if intervalo_s is not None else float(os.environ.get("INTERVALO_S", 20))
        self.keepalive_s = keepalive_s if keepalive_s is not None else int(os.environ.get("KEEPALIVE_S", 30))
        self.versao = versao or os.environ.get("VERSAO_FIRMWARE", perfil.versao)

        dir_padrao = "/dados" if os.name != "nt" else os.path.join(os.getcwd(), ".dados")
        dir_base = buffer_dir or os.environ.get("BUFFER_DIR", dir_padrao)
        self.buffer = Buffer(os.path.join(dir_base, f"{self.id}.db"))

        temp_ini = (
            temp_inicial_c
            if temp_inicial_c is not None
            else float(os.environ.get("TEMP_INICIAL_C", perfil.temp_inicial_c))
        )
        setpoint_padrao = (
            setpoint_c
            if setpoint_c is not None
            else float(os.environ.get("TEMP_INICIAL_C", perfil.setpoint_c))
        )
        setpoint = float(self.buffer.ler("setpoint_c", str(setpoint_padrao)))

        od_ini = (
            od_inicial
            if od_inicial is not None
            else (float(os.environ["OD_INICIAL"]) if "OD_INICIAL" in os.environ else perfil.od_inicial)
        )
        ph_b = (
            ph_base
            if ph_base is not None
            else (float(os.environ["PH_BASE"]) if "PH_BASE" in os.environ else perfil.ph_base)
        )

        tau = tau_s if tau_s is not None else float(os.environ.get("TAU_S", 120))
        escala = escala_tempo if escala_tempo is not None else float(os.environ.get("ESCALA_TEMPO", 1))

        desvio_temp = perfil.desvio_temperatura if self.cenario == "desvio_temperatura" else 0.0

        self.modelo = ModeloCultivo(
            temperatura_c=temp_ini,
            setpoint_c=setpoint,
            tau_s=tau,
            escala_tempo=escala,
            falha_aquecimento=self.cenario == "falha_aquecimento",
            desvio_temperatura=desvio_temp,
            ph_base=ph_b,
            ruido_od=perfil.ruido_od,
            od_inicial=od_ini,
        )

        self.historico_horas = (
            historico_horas if historico_horas is not None else float(os.environ.get("HISTORICO_HORAS", 0))
        )
        self.historico_passo_min = (
            historico_passo_min
            if historico_passo_min is not None
            else float(os.environ.get("HISTORICO_PASSO_MIN", 20))
        )
        self.rajada = 0  # leituras extras pedidas por um comando manual
        self.restaurar_em: float | None = None  # fim da queda de rede pedida pela CLI
        self.pedido_colisao = False

        self.log = logging.getLogger(self.id)
        self.conectado = threading.Event()
        self.rede_cortada = False
        self.em_voo: list[tuple[int, mqtt.MQTTMessageInfo]] = []
        self.pedido_corte: str | None = None

        self.cliente = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"evolver-celula-{self.id}")
        self.cliente.will_set(topicos.estado(self.id), Estado(estado="offline").para_json(),
                              qos=topicos.QOS, retain=True)
        self.cliente.reconnect_delay_set(min_delay=1, max_delay=5)
        self.cliente.max_inflight_messages_set(100)
        self.cliente.on_connect = self._ao_conectar
        self.cliente.on_disconnect = self._ao_desconectar
        self.cliente.message_callback_add(topicos.setpoint(self.id), self._ao_receber_setpoint)
        self.cliente.message_callback_add(f"evolver/simulador/{self.id}/comando", self._ao_receber_comando_simulador)
        self.cliente.message_callback_add("evolver/simulador/todos/comando", self._ao_receber_comando_simulador)

    # ------------------------------------------------------------- MQTT

    def _ao_conectar(self, cli, _u, _f, codigo, _p):
        if codigo.is_failure:
            self.log.error("conexão recusada: %s", codigo)
            return
        cli.publish(topicos.estado(self.id),
                    Estado(estado="online", sensores=SENSORES, versao=self.versao).para_json(),
                    qos=topicos.QOS, retain=True)
        cli.subscribe(topicos.setpoint(self.id), qos=topicos.QOS)
        cli.subscribe(f"evolver/simulador/{self.id}/comando", qos=topicos.QOS)
        cli.subscribe("evolver/simulador/todos/comando", qos=topicos.QOS)
        self.em_voo.clear()
        self.conectado.set()
        self.log.info("conectado, %d leituras guardadas para reenviar", self.buffer.quantidade())

    def _ao_desconectar(self, _cli, _u, _f, codigo, _p):
        self.conectado.clear()
        self.log.warning("desconectado (%s), leituras ficam guardadas", codigo)

    def _ao_receber_setpoint(self, cli, _u, msg):
        try:
            pedido = PedidoSetpoint.de_json(msg.payload)
        except ValueError as erro:
            self.log.warning("pedido de setpoint inválido: %s", erro)
            return
        if pedido.id == self.buffer.ler("ultimo_pedido"):
            return  # mensagem retida reentregue ao reconectar, já tratada
        if self.cenario == "ignorar_setpoint":
            self.log.info("cenário ignorar_setpoint: pedido %s não será respondido", pedido.id)
            return

        def responder(estado, motivo=None):
            cli.publish(topicos.setpoint_resposta(self.id),
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
        self.log.info("setpoint %s aplicado: %.1f °C", pedido.id, pedido.temperatura_c)

    def _ao_receber_comando_simulador(self, _cli, _u, msg):
        try:
            dados = json.loads(msg.payload.decode("utf-8"))
        except Exception as erro:
            self.log.warning("comando do simulador inválido: %s", erro)
            return

        if dados.get("auto"):
            self.modelo.desativar_manual()
            self.log.info("modo automático restaurado")
            return

        # Queda de rede por um tempo. Com a rede cortada a célula não ouve o
        # broker, então a volta é automática: não há comando para restaurar.
        if dados.get("rede") == "cortar":
            self.restaurar_em = time.monotonic() + float(dados.get("por_s", 120))
            self.pedido_corte = "cortar"
            return

        # Republica o último seq com outro horário: o consumidor abre colisao_seq.
        if dados.get("colisao"):
            self.pedido_colisao = True
            return

        cenario = dados.get("cenario")
        if cenario:
            self.cenario = cenario
            self.modelo.falha_aquecimento = (cenario == "falha_aquecimento")
            if cenario == "desvio_temperatura":
                self.modelo.desvio_temperatura = 3.4
            elif cenario == "normal":
                self.modelo.desvio_temperatura = 0.0

        # Valor de OD forçado (calibração ao vivo): ruído pequeno e proporcional
        # ao bruto, para a janela ficar estável e o valor ser o que foi digitado.
        forca_od = dados.get("od") is not None or dados.get("od_bruto") is not None
        ruido = dados.get("ruido_od")
        if ruido is None and forca_od:
            bruto = dados["od_bruto"] if dados.get("od_bruto") is not None else 2000.0 * dados["od"] + 100.0
            ruido = ruido_proporcional(bruto)

        self.modelo.definir_manual(
            od_bruto=dados.get("od_bruto"),
            od=dados.get("od"),
            temperatura_c=dados.get("temperatura_c"),
            ph=dados.get("ph"),
            ruido_od=ruido,
        )
        self.log.info("comando manual do simulador aplicado: %s", dados)

        # As leituras saem pelo laço principal, que é quem mexe no buffer e
        # no envio. Aqui só se pede quantas.
        if dados.get("imediato", True):
            self.rajada = int(dados.get("rajada", RAJADA_PADRAO)) if forca_od else 1

    # ------------------------------------------------------------- envio

    def _medir(self, ts: datetime | None = None) -> None:
        seq = self.buffer.proximo_seq()
        leitura = Leitura(seq=seq, ts=ts or datetime.now(timezone.utc), **self.modelo.medir())
        self.buffer.guardar(seq, leitura.para_json())

    def _publicar_colisao(self) -> int | None:
        """Manda de novo o último seq já usado, com o horário de agora e fora
        do buffer: é a mesma numeração para uma medição diferente."""
        seq = int(self.buffer.ler("proximo_seq", "0")) - 1
        if seq < 0 or not self.conectado.is_set():
            return None
        leitura = Leitura(seq=seq, ts=datetime.now(timezone.utc), **self.modelo.medir())
        self.cliente.publish(topicos.leitura(self.id), leitura.para_json(), qos=topicos.QOS)
        self.log.warning("colisão simulada: seq %d publicado de novo com outro horário", seq)
        return seq

    def _gerar_historico(self) -> int:
        """Só na primeira subida (buffer sem nenhum seq reservado): guarda
        leituras com horários passados, das HISTORICO_HORAS anteriores até
        agora, seguindo a curva de crescimento do modelo. Elas entram no buffer
        como qualquer leitura e saem pelo MQTT com seq contínuo a partir de 0,
        então nunca colidem com as leituras ao vivo. Devolve quantas gerou."""
        if self.historico_horas <= 0 or self.buffer.ler("proximo_seq") is not None:
            return 0
        passo_h = self.historico_passo_min / 60
        n = int(self.historico_horas / passo_h)
        agora = datetime.now(timezone.utc)
        horas_atuais = self.modelo._horas
        try:
            for k in range(n, 0, -1):
                self.modelo._horas = horas_atuais - k * passo_h
                self._medir(ts=agora - timedelta(hours=k * passo_h))
        finally:
            self.modelo._horas = horas_atuais
        self.log.info("histórico gerado: %d leituras das últimas %.0f h", n, self.historico_horas)
        return n

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
            info = self.cliente.publish(topicos.leitura(self.id), payload, qos=topicos.QOS)
            if info.rc != mqtt.MQTT_ERR_SUCCESS:
                break
            self.em_voo.append((seq, info))

    # ------------------------------------------------------------- falha de rede simulada

    def _cortar_rede(self) -> None:
        self.log.warning("REDE CORTADA: sem aviso ao broker, leituras passam a ser guardadas")
        self.rede_cortada = True
        self.conectado.clear()
        self.cliente.loop_stop()  # para os pings: o broker vai notar a falta e publicar offline
        self.em_voo.clear()

    def _restaurar_rede(self) -> None:
        self.log.warning("REDE RESTAURADA")
        sock = self.cliente.socket()
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.rede_cortada = False
        self.cliente.loop_start()

    # ------------------------------------------------------------- laço principal

    def rodar(self, parar: threading.Event | None = None) -> None:
        if parar is None:
            parar = threading.Event()
            if threading.current_thread() is threading.main_thread():
                signal.signal(signal.SIGTERM, lambda *_: parar.set())
                signal.signal(signal.SIGINT, lambda *_: parar.set())
                if hasattr(signal, "SIGUSR1"):
                    signal.signal(signal.SIGUSR1, lambda *_: setattr(self, "pedido_corte", "cortar"))
                if hasattr(signal, "SIGUSR2"):
                    signal.signal(signal.SIGUSR2, lambda *_: setattr(self, "pedido_corte", "restaurar"))

        self.log.info("iniciando, cenário %s, leitura a cada %.1f s", self.cenario, self.intervalo_s)
        self._gerar_historico()
        self.cliente.connect_async(self.mqtt_host, self.mqtt_port, keepalive=self.keepalive_s)
        self.cliente.loop_start()

        proxima = time.monotonic()
        ultimo = time.monotonic()
        proxima_rajada = 0.0
        while not parar.is_set():
            if self.restaurar_em is not None and self.rede_cortada and time.monotonic() >= self.restaurar_em:
                self.restaurar_em = None
                self.pedido_corte = "restaurar"
            if self.pedido_colisao:
                self.pedido_colisao = False
                self._publicar_colisao()
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
                proxima += self.intervalo_s
            if self.rajada > 0 and agora >= proxima_rajada:
                self._medir()
                self.rajada -= 1
                proxima_rajada = agora + RAJADA_INTERVALO_S
            self._enviar_pendentes()
            parar.wait(min(0.2, max(0.0, proxima - time.monotonic())))

        self.log.info("encerrando de forma limpa")
        if self.conectado.is_set():
            self.cliente.publish(topicos.estado(self.id), Estado(estado="offline").para_json(),
                                 qos=topicos.QOS, retain=True).wait_for_publish(timeout=2)
            self.cliente.disconnect()
        self.cliente.loop_stop()


def rodar_multicell(ids: list[str]) -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parar = threading.Event()

    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, lambda *_: parar.set())
        signal.signal(signal.SIGINT, lambda *_: parar.set())

    threads = []
    for id_celula in ids:
        cel = Celula(id_celula=id_celula.strip())
        t = threading.Thread(target=cel.rodar, args=(parar,), name=f"thread-{cel.id}")
        t.start()
        threads.append(t)

    logging.info("Simulador rodando com %d células: %s", len(threads), ", ".join(ids))
    try:
        while not parar.is_set():
            parar.wait(0.5)
    except KeyboardInterrupt:
        parar.set()

    for t in threads:
        t.join()
    logging.info("Todas as células encerradas com sucesso.")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    celulas_env = os.environ.get("CELULAS") or os.environ.get("ID_CELULA", "c01")
    if "," in celulas_env:
        ids = [i.strip() for i in celulas_env.split(",") if i.strip()]
        rodar_multicell(ids)
    else:
        Celula().rodar()
