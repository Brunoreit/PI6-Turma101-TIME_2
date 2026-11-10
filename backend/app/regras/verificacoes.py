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
    """O último pedido de setpoint da célula não foi confirmado em
    SETPOINT_TIMEOUT_S. Só o último conta: um pedido antigo que a célula
    ignorou fica como solicitado para sempre, mas deixa de valer quando um
    pedido mais novo é confirmado."""
    atrasadas = {
        linha["id_celula"]: linha["temperatura_c"]
        for linha in conn.execute(
            """
            SELECT id_celula, temperatura_c
              FROM (SELECT DISTINCT ON (id_celula) id_celula, temperatura_c, estado, solicitado_em
                      FROM pedido_setpoint
                     ORDER BY id_celula, solicitado_em DESC) ultimo
             WHERE estado = 'solicitado'
               AND solicitado_em < now() - make_interval(secs => %s)
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


def _faixa(minimo: float | None, maximo: float | None) -> str:
    if minimo is not None and maximo is not None:
        return f"de {minimo:.2f} a {maximo:.2f}"
    return f"mínimo de {minimo:.2f}" if minimo is not None else f"máximo de {maximo:.2f}"


def ph_fora_da_faixa(conn: psycopg.Connection, cfg: Config) -> None:
    """Célula com cultivo aberto cuja última leitura de pH do período do
    cultivo (a de maior ts_origem) está fora da faixa de referência dele.
    Fecha o alerta quando o pH volta, quando o cultivo não tem leitura de pH
    no período e quando a célula fica sem cultivo aberto ou sem faixa."""
    fora = set()
    for c in conn.execute(
        """
        SELECT c.id_celula, c.ph_ref_min, c.ph_ref_max, u.ph
          FROM cultivo c
          JOIN LATERAL (
                SELECT ph FROM leitura l
                 WHERE l.id_celula = c.id_celula AND l.ph IS NOT NULL
                   AND l.ts_origem >= c.iniciado_em
                 ORDER BY ts_origem DESC LIMIT 1) u ON true
         WHERE c.status = 'em_andamento'
           AND (c.ph_ref_min IS NOT NULL OR c.ph_ref_max IS NOT NULL)
           AND (u.ph < c.ph_ref_min OR u.ph > c.ph_ref_max)
        """
    ).fetchall():
        fora.add(c["id_celula"])
        if repo.abrir_alerta(conn, c["id_celula"], "ph_fora_da_faixa",
                             f"pH em {c['ph']:.2f}, fora da faixa de referência "
                             f"({_faixa(c['ph_ref_min'], c['ph_ref_max'])})."):
            log.warning("alerta aberto: pH fora da faixa em %s", c["id_celula"])
    for c in conn.execute(
        "SELECT id_celula FROM alerta WHERE tipo = 'ph_fora_da_faixa' AND fechado_em IS NULL"
    ).fetchall():
        if c["id_celula"] not in fora and repo.fechar_alerta(conn, c["id_celula"], "ph_fora_da_faixa"):
            log.info("alerta fechado: pH de %s voltou à faixa ou o cultivo mudou", c["id_celula"])


TODAS = [sem_comunicacao, setpoint_sem_confirmacao, setpoint_atingido, desvio_temperatura,
         ph_fora_da_faixa]
