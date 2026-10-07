"""Regras de negócio que olham o banco e abrem ou fecham alertas.

Cada função é independente e idempotente: rodar duas vezes seguidas
não abre alerta duplicado nem muda estado à toa.
"""

import logging

import psycopg

from app.banco import repositorios as repo
from app.config import Config

log = logging.getLogger(__name__)


def sem_comunicacao(conn: psycopg.Connection, cfg: Config) -> None:
    """Célula offline, ou sem mandar nada há mais de SEM_COMUNICACAO_S."""
    for c in conn.execute(
        """
        SELECT id_celula,
               estado = 'offline'
               OR ultimo_contato < now() - make_interval(secs => %s) AS sem_contato
          FROM celula
        """,
        (cfg.sem_comunicacao_s,),
    ).fetchall():
        if c["sem_contato"]:
            if repo.abrir_alerta(conn, c["id_celula"], "sem_comunicacao",
                                 "A célula parou de enviar dados."):
                log.warning("alerta aberto: %s sem comunicação", c["id_celula"])
        elif repo.fechar_alerta(conn, c["id_celula"], "sem_comunicacao"):
            log.info("alerta fechado: %s voltou a se comunicar", c["id_celula"])


def setpoint_sem_confirmacao(conn: psycopg.Connection, cfg: Config) -> None:
    """Pedido de setpoint que a célula não confirmou em SETPOINT_TIMEOUT_S."""
    atrasadas = {
        linha["id_celula"]: linha["temperatura_c"]
        for linha in conn.execute(
            """
            SELECT DISTINCT ON (id_celula) id_celula, temperatura_c
              FROM pedido_setpoint
             WHERE estado = 'solicitado'
               AND solicitado_em < now() - make_interval(secs => %s)
             ORDER BY id_celula, solicitado_em DESC
            """,
            (cfg.setpoint_timeout_s,),
        ).fetchall()
    }
    for id_celula, valor in atrasadas.items():
        if repo.abrir_alerta(conn, id_celula, "setpoint_sem_confirmacao",
                             f"A célula não confirmou o setpoint de {valor:.1f} °C."):
            log.warning("alerta aberto: %s não confirmou setpoint", id_celula)
    for c in conn.execute(
        "SELECT id_celula FROM alerta WHERE tipo = 'setpoint_sem_confirmacao' AND fechado_em IS NULL"
    ).fetchall():
        if c["id_celula"] not in atrasadas:
            repo.fechar_alerta(conn, c["id_celula"], "setpoint_sem_confirmacao")


def setpoint_atingido(conn: psycopg.Connection, cfg: Config) -> None:
    """Marca como atingido o pedido aplicado cuja temperatura medida já
    chegou a TOLERANCIA_ATINGIDO_C do valor pedido."""
    for p in conn.execute(
        """
        SELECT p.id_pedido, p.id_celula
          FROM pedido_setpoint p
          JOIN LATERAL (
                SELECT temperatura_c FROM leitura l
                 WHERE l.id_celula = p.id_celula AND l.ts_recebido >= p.aplicado_em
                 ORDER BY seq DESC LIMIT 1) u ON true
         WHERE p.estado = 'aplicado' AND abs(u.temperatura_c - p.temperatura_c) <= %s
        """,
        (cfg.tolerancia_atingido_c,),
    ).fetchall():
        if repo.avancar_pedido(conn, p["id_pedido"], "atingido"):
            log.info("setpoint %s atingido na célula %s", p["id_pedido"], p["id_celula"])


def desvio_temperatura(conn: psycopg.Connection, cfg: Config) -> None:
    """Depois de atingir o setpoint, a temperatura se afastou mais de DESVIO_MAX_C."""
    for c in conn.execute(
        """
        SELECT p.id_celula, p.temperatura_c AS alvo, u.temperatura_c AS medida
          FROM (SELECT DISTINCT ON (id_celula) id_celula, temperatura_c, estado
                  FROM pedido_setpoint
                 WHERE estado IN ('aplicado', 'atingido')
                 ORDER BY id_celula, solicitado_em DESC) p
          JOIN LATERAL (
                SELECT temperatura_c FROM leitura l
                 WHERE l.id_celula = p.id_celula ORDER BY seq DESC LIMIT 1) u ON true
         WHERE p.estado = 'atingido'
        """
    ).fetchall():
        if abs(c["medida"] - c["alvo"]) > cfg.desvio_max_c:
            if repo.abrir_alerta(conn, c["id_celula"], "desvio_temperatura",
                                 f"Temperatura em {c['medida']:.1f} °C, alvo de {c['alvo']:.1f} °C."):
                log.warning("alerta aberto: desvio de temperatura em %s", c["id_celula"])
        else:
            repo.fechar_alerta(conn, c["id_celula"], "desvio_temperatura")


TODAS = [sem_comunicacao, setpoint_sem_confirmacao, setpoint_atingido, desvio_temperatura]
