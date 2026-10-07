"""Comportamento físico simulado de uma célula de cultivo.

Não é um modelo biológico preciso. Ele só precisa produzir curvas com o
formato certo para exercitar o sistema: crescimento logístico da densidade
óptica, temperatura que converge ao setpoint com atraso, pH que cai
conforme a cultura cresce, e ruído em tudo.
"""

import math
import random
from dataclasses import dataclass, field


@dataclass
class ModeloCultivo:
    temperatura_c: float = 30.0
    setpoint_c: float = 30.0
    tau_s: float = 120.0                 # tempo para a temperatura andar ~63% até o setpoint
    od0: float = 0.05                    # densidade óptica inicial
    od_max: float = 1.5                  # capacidade de suporte
    taxa_por_hora: float = 0.6           # taxa de crescimento
    escala_tempo: float = 1.0            # acelera o crescimento nos testes
    falha_aquecimento: bool = False
    _horas: float = 0.0
    _rng: random.Random = field(default_factory=random.Random)

    def avancar(self, dt_s: float) -> None:
        self._horas += dt_s * self.escala_tempo / 3600
        if not self.falha_aquecimento:
            fator = 1 - math.exp(-dt_s / self.tau_s)
            self.temperatura_c += (self.setpoint_c - self.temperatura_c) * fator
        else:
            # Aquecedor queimado: a cultura esfria em direção à temperatura ambiente.
            self.temperatura_c += (22.0 - self.temperatura_c) * (1 - math.exp(-dt_s / (self.tau_s * 4)))

    @property
    def od(self) -> float:
        k, n0, r, t = self.od_max, self.od0, self.taxa_por_hora, self._horas
        return k / (1 + (k - n0) / n0 * math.exp(-r * t))

    def medir(self) -> dict:
        """Leitura como os sensores entregariam, com ruído.
        od_bruto imita contagens do conversor analógico: 2000 * od + 100."""
        od = self.od
        return {
            "temperatura_c": round(self.temperatura_c + self._rng.gauss(0, 0.05), 2),
            "od_bruto": round(2000 * od + 100 + self._rng.gauss(0, 4), 1),
            "ph": round(7.0 - 0.3 * od / self.od_max + self._rng.gauss(0, 0.01), 2),
        }
