"""Formato das mensagens trocadas pelo MQTT.

Todas as mensagens são JSON em UTF-8. Campos desconhecidos são rejeitados,
para que um erro de digitação no firmware apareça logo no primeiro teste.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class _Mensagem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    def para_json(self) -> bytes:
        return self.model_dump_json(exclude_none=True).encode()

    @classmethod
    def de_json(cls, dados: bytes | str):
        return cls.model_validate_json(dados)


class Estado(_Mensagem):
    """Publicada pela célula ao conectar (online) e pelo broker quando a
    célula cai sem avisar (offline, pela mensagem de última vontade).
    Sempre retida, para quem chegar depois saber o estado atual."""

    estado: Literal["online", "offline"]
    sensores: list[str] = Field(default_factory=list)
    versao: str | None = None


class Leitura(_Mensagem):
    """Uma medição da célula.

    seq é um número crescente por célula que nunca volta a zero, nem quando a
    placa reinicia. É ele que permite ao sistema central detectar leituras
    repetidas e buracos no histórico.
    ts é o horário da célula, em UTC. O sistema central grava também o
    horário de chegada, porque o relógio da placa pode estar errado.
    od_bruto é o valor do sensor antes da calibração.
    """

    seq: int = Field(ge=0)
    ts: datetime
    temperatura_c: float | None = None
    od_bruto: float | None = None
    ph: float | None = Field(default=None, ge=0, le=14)


class PedidoSetpoint(_Mensagem):
    """Enviada pelo sistema central para mudar a temperatura alvo.
    Publicada retida, para a célula receber mesmo se estiver offline."""

    id: str = Field(min_length=1, max_length=40)
    temperatura_c: float


class RespostaSetpoint(_Mensagem):
    """Enviada pela célula para informar o andamento de um pedido.

    recebido: a célula leu o pedido.
    aplicado: a célula passou a controlar a temperatura para o novo valor.
    recusado: a célula rejeitou o pedido, com o motivo.
    O estado "atingido" não vem da célula: o sistema central decide quando a
    temperatura medida chegou perto do valor pedido.
    """

    id: str = Field(min_length=1, max_length=40)
    estado: Literal["recebido", "aplicado", "recusado"]
    motivo: str | None = None
