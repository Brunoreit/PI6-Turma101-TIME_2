"""Armazenamento local da célula simulada (store and forward).

Toda leitura é gravada aqui antes de ser publicada, e só sai daqui quando o
broker confirma o recebimento. Se a conexão cair ou o processo reiniciar,
nada se perde. O mesmo arquivo guarda o próximo seq e o último setpoint,
para que ambos sobrevivam a um reinício.

Isto é do simulador: na placa real, o grupo do hardware decide como guardar
(microSD, flash). O que o sistema central exige é só o comportamento.
"""

import json
import sqlite3
import threading
from pathlib import Path


class Buffer:
    def __init__(self, caminho: str | Path):
        Path(caminho).parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(caminho, check_same_thread=False, isolation_level=None)
        self._trava = threading.Lock()
        self._db.executescript(
            """
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS pendente (seq INTEGER PRIMARY KEY, payload BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
            """
        )

    def proximo_seq(self) -> int:
        """Reserva o próximo número de sequência. Nunca repete, mesmo após reinício."""
        with self._trava:
            atual = int(self.ler("proximo_seq", "0"))
            self._gravar_meta("proximo_seq", str(atual + 1))
            return atual

    def guardar(self, seq: int, payload: bytes) -> None:
        with self._trava:
            self._db.execute("INSERT OR REPLACE INTO pendente VALUES (?, ?)", (seq, payload))

    def remover(self, seq: int) -> None:
        with self._trava:
            self._db.execute("DELETE FROM pendente WHERE seq = ?", (seq,))

    def pendentes(self) -> list[tuple[int, bytes]]:
        with self._trava:
            return self._db.execute("SELECT seq, payload FROM pendente ORDER BY seq").fetchall()

    def quantidade(self) -> int:
        with self._trava:
            return self._db.execute("SELECT count(*) FROM pendente").fetchone()[0]

    def ler(self, chave: str, padrao: str | None = None) -> str | None:
        linha = self._db.execute("SELECT valor FROM meta WHERE chave = ?", (chave,)).fetchone()
        return linha[0] if linha else padrao

    def salvar(self, chave: str, valor) -> None:
        with self._trava:
            self._gravar_meta(chave, json.dumps(valor) if not isinstance(valor, str) else valor)

    def _gravar_meta(self, chave: str, valor: str) -> None:
        self._db.execute("INSERT OR REPLACE INTO meta VALUES (?, ?)", (chave, valor))
