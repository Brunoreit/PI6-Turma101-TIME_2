"""O que fazer com cada tipo de mensagem recebida.

Separado do cliente MQTT para poder ser testado sem broker.
"""

import logging
import time

import psycopg
from pydantic import ValidationError

from app.banco import repositorios as repo
from app.banco.conexao import conectar
from app.calibracao.conversao import Curva, converter
from contrato import Estado, Leitura, RespostaSetpoint, topicos

log = logging.getLogger(__name__)


class Tratador:
    """Mantém a conexão e um cache curto das curvas de calibração ativas."""

    CACHE_CURVA_S = 30

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn
        self._curvas: dict[str, tuple[float, Curva | None]] = {}
        self.contagem = {"gravadas": 0, "duplicadas": 0, "invalidas": 0}

    def tratar(self, topico: str, payload: bytes) -> None:
        try:
            self._tratar(topico, payload)
        except psycopg.OperationalError as erro:
            # Banco reiniciou ou a conexão caiu: reconecta e tenta mais uma vez.
            # Se falhar de novo, o erro sobe e o consumidor encerra sem confirmar.
            log.warning("conexão com o banco perdida (%s), reconectando", erro.__class__.__name__)
            self.conn = conectar()
            self._tratar(topico, payload)

    def _tratar(self, topico: str, payload: bytes) -> None:
        try:
            id_celula, tipo = topicos.interpretar(topico)
            if tipo == topicos.LEITURA:
                self._leitura(id_celula, Leitura.de_json(payload))
            elif tipo == topicos.ESTADO:
                self._estado(id_celula, Estado.de_json(payload))
            elif tipo == topicos.SETPOINT_RESPOSTA:
                self._resposta_setpoint(id_celula, RespostaSetpoint.de_json(payload))
        except (ValueError, ValidationError) as erro:
            # Mensagem fora do contrato: registra e segue, sem derrubar o consumidor.
            self.contagem["invalidas"] += 1
            log.warning("mensagem rejeitada em %s: %s", topico, erro)

    def _estado(self, id_celula: str, msg: Estado) -> None:
        sensores = msg.sensores if msg.estado == "online" else None
        if repo.registrar_celula(self.conn, id_celula, msg.estado, sensores):
            log.info("célula nova cadastrada: %s", id_celula)
        log.info("célula %s %s", id_celula, msg.estado)

    def _leitura(self, id_celula: str, msg: Leitura) -> None:
        curva = self._curva(id_celula)
        gravou = repo.gravar_leitura(
            self.conn, id_celula, msg.seq, msg.ts, msg.temperatura_c,
            msg.od_bruto, converter(msg.od_bruto, curva), msg.ph, curva,
        )
        self.contagem["gravadas" if gravou else "duplicadas"] += 1

    def _curva(self, id_celula: str) -> Curva | None:
        agora = time.monotonic()
        em_cache = self._curvas.get(id_celula)
        if em_cache and agora - em_cache[0] < self.CACHE_CURVA_S:
            return em_cache[1]
        if not repo.celula_existe(self.conn, id_celula):
            # Leitura chegou antes do anúncio: a célula aparece mesmo assim.
            repo.registrar_celula(self.conn, id_celula, "online")
        curva = repo.curva_ativa(self.conn, id_celula)
        self._curvas[id_celula] = (agora, curva)
        return curva

    def _resposta_setpoint(self, id_celula: str, msg: RespostaSetpoint) -> None:
        if repo.avancar_pedido(self.conn, msg.id, msg.estado, msg.motivo):
            log.info("setpoint %s da célula %s: %s", msg.id, id_celula, msg.estado)
