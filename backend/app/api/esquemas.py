"""Formatos de entrada da API (os de saída seguem as linhas do banco)."""

from pydantic import BaseModel, Field


class NovoSetpoint(BaseModel):
    temperatura_c: float = Field(description="Temperatura alvo em °C")
    solicitado_por: str = Field(default="anonimo", max_length=80)


class NovaCalibracao(BaseModel):
    a: float = Field(description="Coeficiente angular: od = a * od_bruto + b")
    b: float = Field(description="Coeficiente linear")
