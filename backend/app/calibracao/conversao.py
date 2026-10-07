"""Conversão do valor bruto do sensor óptico em densidade óptica (OD).

A curva é linear, od = a * bruto + b. Se no futuro o CNPEM usar outra forma
de curva, só esta função e a tabela calibracao precisam mudar.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class Curva:
    id_calibracao: int
    a: float
    b: float


def converter(od_bruto: float | None, curva: Curva | None) -> float | None:
    if od_bruto is None or curva is None:
        return None
    return round(curva.a * od_bruto + curva.b, 4)
