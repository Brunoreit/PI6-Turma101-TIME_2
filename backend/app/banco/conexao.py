"""Conexão com o PostgreSQL."""

import logging
import time

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import config

log = logging.getLogger(__name__)


def conectar(tentativas: int = 30) -> psycopg.Connection:
    """Abre uma conexão em modo autocommit, esperando o banco subir."""
    for tentativa in range(1, tentativas + 1):
        try:
            return psycopg.connect(config.database_url, autocommit=True, row_factory=dict_row)
        except psycopg.OperationalError as erro:
            if tentativa == tentativas:
                raise
            log.warning("banco indisponível (%s), nova tentativa em 1 s", erro.__class__.__name__)
            time.sleep(1)
    raise RuntimeError("inalcançável")


def criar_pool() -> ConnectionPool:
    """Pool para a API: cada requisição pega a sua conexão, e conexões que
    caíram (banco reiniciado) são descartadas e trocadas sozinhas."""
    pool = ConnectionPool(
        config.database_url, min_size=1, max_size=10, open=False,
        kwargs={"autocommit": True, "row_factory": dict_row},
        check=ConnectionPool.check_connection,
    )
    pool.open(wait=True, timeout=30)
    return pool
