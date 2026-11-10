"""Contas da calibração de OD com branco, sem banco e sem API.

Regras (vieram do orientador):

- O branco não é ponto da reta. Ele só zera a linha base e tira o efeito do
  meio de cultura. A reta é ajustada só com os padrões, com
  x = bruto do padrão − bruto do branco e y = OD de referência.
- Mínimos quadrados: a = Sxy / Sxx, b = ȳ − a·x̄,
  R² = 1 − Σ(y − (a·x + b))² / Σ(y − ȳ)².
- O banco guarda a curva como od = a·bruto + b_banco. Como
  od = a·(bruto − branco) + b  é o mesmo que  od = a·bruto + (b − a·branco),
  b_banco = b − a·branco e o consumidor, `converter` e o recálculo de
  `nova_calibracao` continuam iguais.
- O bruto de um padrão lido ao vivo é a média das últimas N leituras, e só
  vale com a leitura estável: (máximo − mínimo) / média < variação máxima.

A interface repete estas contas em `regressao.ts` só como prévia. O que vale
é o que o servidor calcula aqui.
"""

import statistics
from dataclasses import dataclass

MINIMO_DE_PADROES = 3


class CalibracaoInvalida(ValueError):
    """Pontos que não formam uma reta. A mensagem diz o que corrigir."""


@dataclass(frozen=True)
class Reta:
    a: float
    b: float
    r2: float


@dataclass(frozen=True)
class AjusteComBranco:
    branco: float
    a: float
    b: float          # od = a·(bruto − branco) + b
    r2: float

    @property
    def b_banco(self) -> float:
        """O b que vai para a tabela calibracao: od = a·bruto + b_banco."""
        return self.b - self.a * self.branco


def ajustar_reta(pontos: list[tuple[float, float]]) -> Reta:
    """Mínimos quadrados de (x, y). Exige dois x e dois y diferentes."""
    n = len(pontos)
    if n < 2:
        raise CalibracaoInvalida("São precisos pelo menos 2 pontos para ajustar a reta.")
    media_x = sum(x for x, _ in pontos) / n
    media_y = sum(y for _, y in pontos) / n
    sxx = sum((x - media_x) ** 2 for x, _ in pontos)
    # Comparar os valores, e não Sxx ou a soma total com zero: a média de
    # valores iguais pode sair com um resto de ponto flutuante.
    if len({x for x, _ in pontos}) == 1:
        raise CalibracaoInvalida(
            "Todos os padrões têm o mesmo valor bruto. Grave padrões de OD diferentes para formar a reta.")
    sxy = sum((x - media_x) * (y - media_y) for x, y in pontos)
    total = sum((y - media_y) ** 2 for _, y in pontos)
    if len({y for _, y in pontos}) == 1:
        raise CalibracaoInvalida(
            "Todos os padrões têm a mesma OD de referência. Use padrões de OD diferentes para formar a reta.")
    a = sxy / sxx
    b = media_y - a * media_x
    residuo = sum((y - (a * x + b)) ** 2 for x, y in pontos)
    return Reta(a=a, b=b, r2=1 - residuo / total)


def ajustar_com_branco(branco: float, padroes: list[tuple[float, float]]) -> AjusteComBranco:
    """`padroes` são (bruto, od_referencia). O branco fica fora da reta."""
    if len(padroes) < MINIMO_DE_PADROES:
        faltam = MINIMO_DE_PADROES - len(padroes)
        raise CalibracaoInvalida(
            f"A calibração precisa de pelo menos {MINIMO_DE_PADROES} padrões além do branco. "
            f"{'Falta 1 padrão' if faltam == 1 else f'Faltam {faltam} padrões'}.")
    reta = ajustar_reta([(bruto - branco, od) for bruto, od in padroes])
    return AjusteComBranco(branco=branco, a=reta.a, b=reta.b, r2=reta.r2)


@dataclass(frozen=True)
class Janela:
    """Resumo das últimas leituras do sensor de OD."""

    n: int
    media: float
    minimo: float
    maximo: float
    variacao: float    # (máximo − mínimo) / média
    desvio: float      # desvio padrão amostral; 0 com uma leitura só


def resumir(valores: list[float]) -> Janela:
    if not valores:
        raise ValueError("resumir precisa de pelo menos um valor")
    media = sum(valores) / len(valores)
    minimo, maximo = min(valores), max(valores)
    variacao = (maximo - minimo) / abs(media) if media else float("inf")
    desvio = statistics.stdev(valores) if len(valores) > 1 else 0.0
    return Janela(n=len(valores), media=media, minimo=minimo, maximo=maximo, variacao=variacao, desvio=desvio)


def estavel(janela: Janela | None, n_esperado: int, variacao_max: float) -> bool:
    """Estável só com a janela cheia e variando menos que o limite."""
    return janela is not None and janela.n >= n_esperado and janela.variacao < variacao_max
