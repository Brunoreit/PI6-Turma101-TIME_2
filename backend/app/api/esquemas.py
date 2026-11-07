"""Formatos de entrada da API (os de saída seguem as linhas do banco)."""

import re
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


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


def _normalizar_email(email: str) -> str:
    return email.strip().lower()


class Cadastro(BaseModel):
    nome: str
    email: str
    senha: str = Field(description="8 caracteres ou mais, com pelo menos uma letra e um número")

    @field_validator("nome")
    @classmethod
    def _nome(cls, nome: str) -> str:
        nome = nome.strip()
        if not nome:
            raise ValueError("Informe o nome.")
        return nome

    @field_validator("email")
    @classmethod
    def _email(cls, email: str) -> str:
        email = _normalizar_email(email)
        if not re.fullmatch(r"[^@\s]+@[^@\s]+", email):
            raise ValueError("Informe um e-mail no formato nome@instituicao.br.")
        return email

    @field_validator("senha")
    @classmethod
    def _senha(cls, senha: str) -> str:
        if len(senha) < 8 or not re.search(r"[^\W\d_]", senha) or not re.search(r"\d", senha):
            raise ValueError("A senha precisa ter 8 caracteres ou mais, com pelo menos uma letra e um número.")
        return senha


class Entrada(BaseModel):
    email: str
    senha: str

    @field_validator("email")
    @classmethod
    def _email(cls, email: str) -> str:
        return _normalizar_email(email)
