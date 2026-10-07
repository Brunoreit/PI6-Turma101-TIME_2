"""Processo de regras: roda as verificações a cada REGRAS_INTERVALO_S.

Executar: python -m app.regras.main
"""

import logging
import signal
import threading

from app.banco.conexao import conectar
from app.config import config
from app.regras.verificacoes import TODAS

logging.basicConfig(level=logging.INFO, format="%(asctime)s regras %(levelname)s %(message)s")
log = logging.getLogger("regras")


def main() -> None:
    conn = conectar()
    parar = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: parar.set())
    signal.signal(signal.SIGINT, lambda *_: parar.set())
    log.info("verificando a cada %.0f s", config.regras_intervalo_s)

    while not parar.is_set():
        for regra in TODAS:
            try:
                regra(conn, config)
            except Exception:
                # Uma regra com erro não pode impedir as outras de rodar.
                log.exception("falha na regra %s", regra.__name__)
                if conn.closed:
                    conn = conectar()
        parar.wait(config.regras_intervalo_s)


if __name__ == "__main__":
    main()
