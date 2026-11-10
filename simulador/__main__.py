"""Ponto de entrada principal do simulador T.U.P.A.

Execução:
  python -m simulador                     # roda todas as 16 células (c01 a c16)
  python -m simulador c01 c02 c03         # roda células específicas
  python -m simulador --intervalo 5       # leitura a cada 5 segundos
  python -m simulador c04 --historico 24  # na primeira subida, publica 24 h de leituras passadas
"""

import argparse
import logging
import os
import signal
import sys
import threading

from simulador.celula import Celula
from simulador.perfis import PERFIS_PADRAO


def main():
    parser = argparse.ArgumentParser(description="T.U.P.A - Simulador de células de cultivo")
    parser.add_argument("celulas", nargs="*", help="IDs das células a simular (padrão: c01 a c16)")
    parser.add_argument("--celulas", dest="celulas_flag", help="Lista de células separadas por vírgula")
    parser.add_argument("--intervalo", type=float, default=None, help="Intervalo entre leituras em segundos")
    parser.add_argument("--rapido", action="store_true", help="Atalho para intervalo de 1 segundo")
    parser.add_argument("--historico", type=float, default=None,
                        help="Horas de leituras passadas publicadas na primeira subida (buffer vazio)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    if args.celulas:
        ids = args.celulas
    elif args.celulas_flag:
        ids = [c.strip() for c in args.celulas_flag.split(",") if c.strip()]
    elif os.environ.get("CELULAS"):
        ids = [c.strip() for c in os.environ["CELULAS"].split(",") if c.strip()]
    else:
        # Padrão: todas as 16 células (c01 a c16)
        ids = list(PERFIS_PADRAO.keys())

    intervalo = 1.0 if args.rapido else args.intervalo

    parar = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: parar.set())
    signal.signal(signal.SIGINT, lambda *_: parar.set())

    threads = []
    for id_celula in ids:
        cel = Celula(id_celula=id_celula, intervalo_s=intervalo, historico_horas=args.historico)
        t = threading.Thread(target=cel.rodar, args=(parar,), name=f"thread-{cel.id}")
        t.daemon = True
        t.start()
        threads.append(t)

    logging.info("Simulador T.U.P.A iniciado com %d células: %s", len(threads), ", ".join(ids))
    logging.info("Pressione Ctrl+C para encerrar.")

    try:
        while not parar.is_set():
            parar.wait(0.5)
    except KeyboardInterrupt:
        parar.set()

    logging.info("Encerrando células simuladas...")
    for t in threads:
        t.join(timeout=3)
    logging.info("Todas as células foram finalizadas.")


if __name__ == "__main__":
    main()
