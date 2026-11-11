"""Sobe, derruba e manipula os serviços durante o teste de integração.

Dois modos, escolhidos pela variável AMBIENTE:
  compose (padrão)  usa o docker-compose.yml com portas e tempos de teste
  local             roda broker, banco e serviços como processos da máquina,
                    útil quando não há Docker. Exige PostgreSQL 16 e
                    Mosquitto instalados, e não roda como root.

Os dois oferecem as mesmas operações, então o teste não sabe qual está usando.
"""

import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from app.relatorio.falhas import FalhaSimulada

RAIZ = Path(__file__).resolve().parents[2]
CELULAS = {"c01": "normal", "c02": "normal", "c03": "ignorar_setpoint"}

# Tempos curtos para o teste caber em poucos minutos.
AMBIENTE_RAPIDO = {
    "INTERVALO_S": "1",
    "KEEPALIVE_S": "3",
    "TAU_S": "3",
    "ESCALA_TEMPO": "60",
    "REGRAS_INTERVALO_S": "1",
    "SEM_COMUNICACAO_S": "8",
    "SETPOINT_TIMEOUT_S": "6",
    "SINAL_VIDA_S": "1",
    "SINAL_VIDA_LIMITE_S": "4",
    "BROKER_INACESSIVEL_S": "2",
}

# Os testes de login assinam tokens com ele, para provar expiração e adulteração.
SEGREDO_SESSAO = "segredo-de-teste"


def _porta_livre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _esperar_porta(porta: int, timeout: float = 30) -> None:
    fim = time.time() + timeout
    while time.time() < fim:
        try:
            socket.create_connection(("127.0.0.1", porta), timeout=1).close()
            return
        except OSError:
            time.sleep(0.2)
    raise TimeoutError(f"porta {porta} não abriu em {timeout:.0f} s")


class AmbienteCompose:
    PROJETO = "evolver-teste"
    PORTAS = {"PORTA_BANCO": "55432", "PORTA_API": "58000", "PORTA_MQTT": "51883",
              "PORTA_INTERFACE": "58080"}

    def __init__(self):
        self.url_banco = f"postgresql://evolver:evolver@localhost:{self.PORTAS['PORTA_BANCO']}/evolver"
        self.url_api = f"http://localhost:{self.PORTAS['PORTA_API']}"
        self.host_mqtt, self.porta_mqtt = "localhost", int(self.PORTAS["PORTA_MQTT"])

    def _dc(self, *args: str) -> None:
        # Portas próprias e tempos curtos, para não colidir com um
        # docker compose up que já esteja rodando na máquina.
        env = {**os.environ, **AMBIENTE_RAPIDO, **self.PORTAS, "SEGREDO_SESSAO": SEGREDO_SESSAO,
               **{f"CENARIO_{c.upper()}": cenario for c, cenario in CELULAS.items()}}
        subprocess.run(["docker", "compose", "-p", self.PROJETO, *args],
                       cwd=RAIZ, env=env, check=True)

    def _servico(self, nome: str) -> str:
        return f"celula-{nome}" if nome in CELULAS else nome

    def iniciar(self) -> None:
        self._dc("down", "-v", "--remove-orphans")
        self._dc("up", "-d", "--build", "--wait")

    def parar(self, nome: str) -> None:
        self._dc("stop", self._servico(nome))

    def iniciar_servico(self, nome: str) -> None:
        self._dc("start", self._servico(nome))

    def sinal(self, nome: str, sinal: str) -> None:
        # Pelo nome ("SIGUSR1"): quem roda o teste pode ser Windows, que não
        # tem esses sinais, mas quem recebe é o contêiner Linux.
        self._dc("kill", "-s", sinal, self._servico(nome))

    def encerrar(self) -> None:
        if os.environ.get("MANTER_AMBIENTE") != "1":
            self._dc("down", "-v")


class AmbienteLocal:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix="evolver-teste-"))
        self.porta_pg = _porta_livre()
        self.porta_mqtt = _porta_livre()
        self.porta_api = _porta_livre()
        self.url_banco = f"postgresql://evolver@127.0.0.1:{self.porta_pg}/evolver"
        self.url_api = f"http://127.0.0.1:{self.porta_api}"
        self.host_mqtt = "127.0.0.1"
        self.processos: dict[str, subprocess.Popen] = {}
        self.pg_bin = Path(os.environ.get("PG_BIN", "/usr/lib/postgresql/16/bin"))

    # -- infraestrutura

    def _iniciar_banco(self) -> None:
        dados = self.dir / "pg"
        subprocess.run([self.pg_bin / "initdb", "-D", dados, "-U", "evolver", "--auth=trust"],
                       check=True, stdout=subprocess.DEVNULL)
        subprocess.run([self.pg_bin / "pg_ctl", "-D", dados, "-l", self.dir / "pg.log", "-w", "start",
                        "-o", f"-p {self.porta_pg} -k {self.dir} -c listen_addresses=127.0.0.1"],
                       check=True, stdout=subprocess.DEVNULL)
        subprocess.run([self.pg_bin / "createdb", "-h", "127.0.0.1", "-p", str(self.porta_pg),
                        "-U", "evolver", "evolver"], check=True)
        for sql in sorted((RAIZ / "infra" / "postgres" / "init").glob("*.sql")):
            subprocess.run(["psql", self.url_banco, "-q", "-v", "ON_ERROR_STOP=1", "-f", sql],
                           check=True, stdout=subprocess.DEVNULL)

    def _conf_broker(self) -> Path:
        dados = self.dir / "mosquitto"
        dados.mkdir(exist_ok=True)
        conf = (RAIZ / "infra" / "mosquitto" / "mosquitto.conf").read_text()
        conf = conf.replace("listener 1883", f"listener {self.porta_mqtt} 127.0.0.1")
        conf = conf.replace("/mosquitto/data/", f"{dados}/")
        caminho = self.dir / "mosquitto.conf"
        caminho.write_text(conf)
        return caminho

    # -- serviços

    def _ambiente(self) -> dict:
        return {
            **os.environ, **AMBIENTE_RAPIDO,
            "SEGREDO_SESSAO": SEGREDO_SESSAO,
            "DATABASE_URL": self.url_banco,
            "MQTT_HOST": "127.0.0.1", "MQTT_PORT": str(self.porta_mqtt),
            "BUFFER_DIR": str(self.dir / "celulas"),
            "PYTHONPATH": f"{RAIZ}:{RAIZ / 'backend'}",
            "PYTHONUNBUFFERED": "1",
        }

    def _comando(self, nome: str) -> tuple[list[str], dict]:
        env = self._ambiente()
        if nome == "broker":
            return [shutil.which("mosquitto") or "/usr/sbin/mosquitto", "-c", str(self._conf_broker())], env
        if nome == "consumidor":
            return [sys.executable, "-m", "app.consumidor.main"], env
        if nome == "regras":
            return [sys.executable, "-m", "app.regras.main"], env
        if nome == "api":
            return [sys.executable, "-m", "uvicorn", "app.api.main:app",
                    "--host", "127.0.0.1", "--port", str(self.porta_api)], env
        if nome in CELULAS:
            env.update(ID_CELULA=nome, CENARIO=CELULAS[nome])
            return [sys.executable, "-m", "simulador.celula"], env
        raise ValueError(nome)

    def iniciar_servico(self, nome: str) -> None:
        from app.consumidor.main import ARQUIVO_INSCRITO

        if nome == "consumidor":
            ARQUIVO_INSCRITO.unlink(missing_ok=True)
        cmd, env = self._comando(nome)
        log = open(self.dir / f"{nome}.log", "a")
        self.processos[nome] = subprocess.Popen(cmd, env=env, stdout=log, stderr=subprocess.STDOUT)
        if nome == "broker":
            _esperar_porta(self.porta_mqtt)
        if nome == "api":
            _esperar_porta(self.porta_api)
        if nome == "consumidor":
            # Como o healthcheck do docker-compose.yml: as células só sobem
            # depois que o broker passa a guardar mensagens para o consumidor.
            fim = time.time() + 30
            while not ARQUIVO_INSCRITO.exists():
                if time.time() > fim:
                    raise TimeoutError("o consumidor não se inscreveu no broker em 30 s")
                time.sleep(0.2)

    def parar(self, nome: str) -> None:
        proc = self.processos.pop(nome)
        proc.terminate()
        proc.wait(timeout=15)

    def sinal(self, nome: str, sinal: str) -> None:
        self.processos[nome].send_signal(getattr(signal, sinal))

    def iniciar(self) -> None:
        self._iniciar_banco()
        for nome in ["broker", "consumidor", "regras", "api", *CELULAS]:
            self.iniciar_servico(nome)

    def encerrar(self) -> None:
        for nome in list(self.processos):
            try:
                self.parar(nome)
            except Exception:
                self.processos.get(nome) and self.processos[nome].kill()
        subprocess.run([self.pg_bin / "pg_ctl", "-D", self.dir / "pg", "-m", "fast", "stop"],
                       stdout=subprocess.DEVNULL, check=False)
        if os.environ.get("MANTER_AMBIENTE") == "1":
            print(f"\nlogs mantidos em {self.dir}")
        else:
            shutil.rmtree(self.dir, ignore_errors=True)


class ComFalhasAnotadas:
    """Repassa tudo ao ambiente e anota as falhas que o teste provoca (célula
    sem rede, consumidor ou broker parado), para o relatório de falhas."""

    def __init__(self, ambiente):
        self._ambiente = ambiente
        self.inicio: datetime | None = None
        self.falhas_simuladas: list[FalhaSimulada] = []

    def __getattr__(self, nome: str):
        return getattr(self._ambiente, nome)

    def _comecou(self, acao: str, alvo: str | None = None) -> None:
        self.falhas_simuladas.append(FalhaSimulada(acao=acao, inicio=datetime.now(timezone.utc), alvo=alvo))

    def _terminou(self, acao: str, alvo: str | None = None) -> None:
        for falha in reversed(self.falhas_simuladas):
            if falha.acao == acao and falha.alvo == alvo and falha.fim is None:
                falha.fim = datetime.now(timezone.utc)
                return

    def iniciar(self) -> None:
        self.inicio = datetime.now(timezone.utc)
        self._ambiente.iniciar()

    def parar(self, nome: str) -> None:
        if nome in ("broker", "consumidor"):
            self._comecou(nome)
        self._ambiente.parar(nome)

    def iniciar_servico(self, nome: str) -> None:
        self._ambiente.iniciar_servico(nome)
        self._terminou(nome)

    def sinal(self, nome: str, sinal: str) -> None:
        if sinal == "SIGUSR1":
            self._comecou("rede", nome)
        self._ambiente.sinal(nome, sinal)
        if sinal == "SIGUSR2":
            self._terminou("rede", nome)


def criar_ambiente():
    return ComFalhasAnotadas(AmbienteLocal() if os.environ.get("AMBIENTE") == "local" else AmbienteCompose())
