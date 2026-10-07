"""Nomes dos tópicos MQTT.

Formato: evolver/v1/celula/{id_celula}/{tipo}

A versão no caminho permite mudar o formato das mensagens no futuro
sem quebrar quem ainda usa o formato antigo.
"""

import re

PREFIXO = "evolver/v1/celula"

ESTADO = "estado"
LEITURA = "leitura"
SETPOINT = "setpoint"
SETPOINT_RESPOSTA = "setpoint/resposta"

# Qualidade de serviço usada em todas as mensagens: entrega ao menos uma vez.
QOS = 1

_ID_VALIDO = re.compile(r"^[a-zA-Z0-9_-]{1,32}$")


def validar_id(id_celula: str) -> str:
    if not _ID_VALIDO.match(id_celula):
        raise ValueError(f"id de célula inválido: {id_celula!r}")
    return id_celula


def estado(id_celula: str) -> str:
    return f"{PREFIXO}/{validar_id(id_celula)}/{ESTADO}"


def leitura(id_celula: str) -> str:
    return f"{PREFIXO}/{validar_id(id_celula)}/{LEITURA}"


def setpoint(id_celula: str) -> str:
    return f"{PREFIXO}/{validar_id(id_celula)}/{SETPOINT}"


def setpoint_resposta(id_celula: str) -> str:
    return f"{PREFIXO}/{validar_id(id_celula)}/{SETPOINT_RESPOSTA}"


# Assinaturas com curinga usadas pelo consumidor do sistema central.
ASSINATURAS_CONSUMIDOR = [
    f"{PREFIXO}/+/{ESTADO}",
    f"{PREFIXO}/+/{LEITURA}",
    f"{PREFIXO}/+/{SETPOINT_RESPOSTA}",
]


def interpretar(topico: str) -> tuple[str, str]:
    """Separa um tópico recebido em (id_celula, tipo).

    >>> interpretar("evolver/v1/celula/c01/setpoint/resposta")
    ('c01', 'setpoint/resposta')
    """
    if not topico.startswith(PREFIXO + "/"):
        raise ValueError(f"tópico fora do contrato: {topico!r}")
    resto = topico[len(PREFIXO) + 1:]
    id_celula, _, tipo = resto.partition("/")
    if tipo not in (ESTADO, LEITURA, SETPOINT, SETPOINT_RESPOSTA):
        raise ValueError(f"tipo de mensagem desconhecido: {tipo!r}")
    return validar_id(id_celula), tipo
