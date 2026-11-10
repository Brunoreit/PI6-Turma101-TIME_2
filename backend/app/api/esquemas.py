"""Formatos de entrada da API (os de saída seguem as linhas do banco)."""

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class NovoSetpoint(BaseModel):
    temperatura_c: float = Field(description="Temperatura alvo em °C")


class PontoCalibracao(BaseModel):
    """Um ponto da calibração. No formato antigo só `od_referencia` e `bruto`;
    os outros campos são do cadastro por pontos e ficam todos opcionais."""

    od_referencia: float | None = Field(
        default=None, description="OD do padrão, medida no espectrofotômetro. null no branco")
    bruto: float = Field(description="Valor bruto lido pelo sensor da célula para esse ponto. "
                                     "Com origem leitura, o servidor recalcula pela média das leituras")
    rotulo: str | None = Field(default=None, description='"branco" ou o nome do padrão ("P1", "P2"...)')
    origem: Literal["leitura", "digitado"] | None = Field(
        default=None, description="leitura: média das leituras seq_inicio a seq_fim; digitado: medido por fora")
    seq_inicio: int | None = Field(default=None, ge=0, description="Primeira leitura da média (origem leitura)")
    seq_fim: int | None = Field(default=None, ge=0, description="Última leitura da média (origem leitura)")
    n_leituras: int | None = Field(default=None, gt=0, le=10_000,
                                   description="Quantas leituras formam a média (origem leitura)")
    desvio: float | None = Field(default=None, description="Desvio padrão das leituras. O servidor recalcula")
    gravado_em: datetime | None = Field(default=None, description="Quando o ponto foi gravado na tela")

    @field_validator("rotulo")
    @classmethod
    def _rotulo(cls, rotulo: str | None) -> str | None:
        return _texto_obrigatorio(rotulo, "O rótulo do ponto não pode ficar em branco.")

    @model_validator(mode="after")
    def _origem(self):
        nome = self.rotulo or "ponto"
        intervalo = (self.seq_inicio, self.seq_fim, self.n_leituras)
        if self.origem == "leitura":
            if None in intervalo:
                raise ValueError(f"O {nome} veio da leitura ao vivo e precisa de seq_inicio, seq_fim e n_leituras.")
            if self.seq_inicio > self.seq_fim:
                raise ValueError(f"No {nome}, seq_inicio precisa ser menor ou igual a seq_fim.")
        elif any(v is not None for v in intervalo):
            raise ValueError(f"seq_inicio, seq_fim e n_leituras só valem com origem leitura. "
                             f"Tire esses campos do {nome} ou use origem leitura.")
        return self


class NovaCalibracao(BaseModel):
    """Dois jeitos de cadastrar:

    - **a e b prontos** (formato antigo): a curva é gravada como veio; `pontos`
      e `r2`, se vierem, só são guardados.
    - **por pontos**, sem a, b e r2: um ponto `branco` e pelo menos 3 padrões.
      O servidor confere as leituras, ajusta a reta só com os padrões, com
      x = bruto − branco, e grava a, b − a·branco e o R².
    """

    a: float | None = Field(default=None, description="Coeficiente angular: od = a * od_bruto + b. "
                                                       "De fora no cadastro por pontos")
    b: float | None = Field(default=None, description="Coeficiente linear. De fora no cadastro por pontos")
    recalcular: bool = Field(
        default=True,
        description="Recalcula a OD das leituras já gravadas. Se falso, só as próximas leituras usam a nova versão.",
    )
    recalcular_desde: datetime | None = Field(
        default=None,
        description="Com recalcular, só as leituras a partir deste instante. Vazio recalcula o histórico todo.",
    )
    pontos: list[PontoCalibracao] | None = Field(
        default=None, max_length=100,
        description="Branco e padrões. Com a e b, só guardados. Sem, o servidor calcula a reta com eles.",
    )
    r2: float | None = Field(default=None, description="Qualidade do ajuste. Com a e b, calculada por quem "
                                                       "cadastra; no cadastro por pontos, pelo servidor")
    organismo: str | None = Field(default=None, description="Cultura usada para fazer a curva")

    @property
    def por_pontos(self) -> bool:
        return self.a is None

    @model_validator(mode="after")
    def _um_dos_jeitos(self):
        if (self.a is None) != (self.b is None):
            raise ValueError("Envie a e b juntos, ou nenhum dos dois para o servidor calcular a reta pelos pontos.")
        if self.a is None:
            if not self.pontos:
                raise ValueError("Envie a e b prontos, ou os pontos (o branco e pelo menos 3 padrões) "
                                 "para o servidor calcular a reta.")
            if self.r2 is not None:
                raise ValueError("No cadastro por pontos o servidor calcula o R². Tire o r2 do corpo.")
        return self


def _normalizar_email(email: str) -> str:
    return email.strip().lower()


class Cadastro(BaseModel):
    nome: str
    email: str
    senha: str = Field(description="De 8 a 128 caracteres, com pelo menos uma letra e um número")

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
        if len(senha) > 128:
            raise ValueError("A senha pode ter no máximo 128 caracteres.")
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


def _texto_obrigatorio(texto: str | None, mensagem: str) -> str | None:
    if texto is not None and not texto.strip():
        raise ValueError(mensagem)
    return texto.strip() if texto is not None else None


class NovoExperimento(BaseModel):
    nome: str
    descricao: str | None = None
    modo: Literal["curva_crescimento", "turbidostato", "quimiostato"]
    duracao_prevista_dias: int | None = Field(default=None, gt=0, le=100_000,
                                              description="Só previsão: o sistema nunca encerra sozinho")
    temperatura_alvo_c: float | None = Field(default=None, description="Enviada a cada célula quando o cultivo começa")
    ph_ref_min: float | None = None
    ph_ref_max: float | None = None
    metadados: dict[str, Any] = Field(default_factory=dict, description="Organismo, cepa, meio, volume, lote, inóculo")

    @field_validator("nome")
    @classmethod
    def _nome(cls, nome: str) -> str:
        return _texto_obrigatorio(nome, "Informe o nome do experimento.")


class AlteracaoExperimento(NovoExperimento):
    """Só os campos enviados mudam. Depois do início, só descricao e metadados."""

    nome: str | None = None
    modo: Literal["curva_crescimento", "turbidostato", "quimiostato"] | None = None
    metadados: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _sem_nulo_no_obrigatorio(self):
        nulos = [campo for campo in ("nome", "modo", "metadados")
                 if campo in self.model_fields_set and getattr(self, campo) is None]
        if nulos:
            raise ValueError(f"{', '.join(nulos)} não pode ficar vazio. Envie um valor ou deixe o campo de fora.")
        return self


class Motivo(BaseModel):
    motivo: str

    @field_validator("motivo")
    @classmethod
    def _motivo(cls, motivo: str) -> str:
        return _texto_obrigatorio(motivo, "Informe o motivo.")


class MotivoOpcional(BaseModel):
    motivo: str | None = None


class NovoAcesso(BaseModel):
    email: str
    permissao: Literal["leitura", "edicao"] = Field(description="leitura (Só leitura) ou edicao (Pode modificar)")

    @field_validator("email")
    @classmethod
    def _email(cls, email: str) -> str:
        return _normalizar_email(email)


class AlteracaoCultivo(BaseModel):
    """Só os campos enviados mudam."""

    condicao: str | None = Field(default=None, description='Rótulo do grupo, ex.: "30 °C"')
    replica: int | None = Field(default=None, gt=0, le=32767)
    ph_ref_min: float | None = None
    ph_ref_max: float | None = None


class NovoCultivo(BaseModel):
    id_celula: str
    condicao: str | None = Field(default=None, description='Rótulo do grupo, ex.: "30 °C"')
    replica: int | None = Field(default=None, gt=0, le=32767)
    continua_de: int | None = Field(default=None, description="Cultivo de onde a cultura veio (troca de placa ou de célula)")


class AlteracaoCelula(BaseModel):
    """Só os campos enviados mudam. null tira o valor."""

    apelido: str | None = Field(default=None, description='Nome de exibição, ex.: "c08". Único')
    descricao: str | None = None
    modelo: str | None = Field(default=None, description='Modelo da placa, ex.: "ESP32"')

    @field_validator("apelido")
    @classmethod
    def _apelido(cls, apelido: str | None) -> str | None:
        return _texto_obrigatorio(apelido, "O apelido não pode ficar em branco. Para tirar o apelido, envie null.")
