"""Processo de regras: roda as verificações a cada REGRAS_INTERVALO_S.

Executar: python -m app.regras.main
"""

import logging
import signal
import threading
from datetime import datetime, timezone

from app.avisos import correio
from app.banco import repositorios as repo
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
    if config.smtp_host:
        log.info("e-mail dos alertas pelo servidor %s:%s", config.smtp_host, config.smtp_porta)
    else:
        log.info("SMTP_HOST vazio: os alertas não são enviados por e-mail")
    iniciado_em = datetime.now(timezone.utc)

    while not parar.is_set():
        try:
            repo.registrar_sinal(conn, "regras", iniciado_em)
        except Exception:
            log.exception("falha ao gravar o sinal de vida")
            if conn.closed:
                conn = conectar()
        for regra in TODAS:
            try:
                regra(conn, config)
            except Exception:
                # Uma regra com erro não pode impedir as outras de rodar.
                log.exception("falha na regra %s", regra.__name__)
                if conn.closed:
                    conn = conectar()
        # Depois das verificações, para o alerta aberto nesta rodada já sair nela.
        try:
            correio.enviar_pendentes(conn, config)
        except Exception:
            log.exception("falha ao enviar os e-mails dos alertas")
            if conn.closed:
                conn = conectar()
        parar.wait(config.regras_intervalo_s)


if __name__ == "__main__":
    main()
