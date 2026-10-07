"""Configuração lida das variáveis de ambiente (ver .env.example)."""

import os
from dataclasses import dataclass


def _float(nome: str, padrao: float) -> float:
    return float(os.environ.get(nome, padrao))


@dataclass(frozen=True)
class Config:
    database_url: str = os.environ.get(
        "DATABASE_URL", "postgresql://evolver:evolver@localhost:5432/evolver"
    )
    mqtt_host: str = os.environ.get("MQTT_HOST", "localhost")
    mqtt_port: int = int(os.environ.get("MQTT_PORT", 1883))

    # Faixa aceita para o setpoint. O eVOLVER opera da temperatura ambiente até 45 °C.
    temperatura_min_c: float = _float("TEMPERATURA_MIN_C", 20.0)
    temperatura_max_c: float = _float("TEMPERATURA_MAX_C", 45.0)

    # Regras de alerta
    regras_intervalo_s: float = _float("REGRAS_INTERVALO_S", 10)
    sem_comunicacao_s: float = _float("SEM_COMUNICACAO_S", 90)
    setpoint_timeout_s: float = _float("SETPOINT_TIMEOUT_S", 120)
    tolerancia_atingido_c: float = _float("TOLERANCIA_ATINGIDO_C", 0.5)
    desvio_max_c: float = _float("DESVIO_MAX_C", 2.0)


config = Config()
