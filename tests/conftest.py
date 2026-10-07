import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
for caminho in (RAIZ, RAIZ / "backend", RAIZ / "simulador"):
    if str(caminho) not in sys.path:
        sys.path.insert(0, str(caminho))
