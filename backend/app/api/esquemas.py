"""Formatos de entrada da API (os de saída seguem as linhas do banco)."""

from datetime import datetime

from pydantic import BaseModel, Field


class NovoSetpoint(BaseModel):
    temperatura_c: float = Field(description="Temperatura alvo em °C")
    solicitado_por: str = Field(default="anonimo", max_length=80)


class PontoCalibracao(BaseModel):
    od_referencia: float = Field(description="OD do branco ou do padrão, medida no espectrofotômetro")
    bruto: float = Field(description="Valor bruto lido pelo sensor da célula para esse padrão")


class NovaCalibracao(BaseModel):
    a: float = Field(description="Coeficiente angular: od = a * od_bruto + b")
    b: float = Field(description="Coeficiente linear")
    recalcular: bool = Field(
        default=True,
        description="Recalcula a OD das leituras já gravadas. Se falso, só as próximas leituras usam a nova versão.",
    )
    recalcular_desde: datetime | None = Field(
        default=None,
        description="Com recalcular, só as leituras a partir deste instante. Vazio recalcula o histórico todo.",
    )
    pontos: list[PontoCalibracao] | None = Field(
        default=None, description="Branco e padrões usados no ajuste. Só guardados, não mudam a conta.",
    )
    r2: float | None = Field(default=None, description="Qualidade do ajuste, calculada por quem cadastra")
    organismo: str | None = Field(default=None, description="Cultura usada para fazer a curva")
