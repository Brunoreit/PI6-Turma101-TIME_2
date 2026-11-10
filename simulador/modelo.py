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
    desvio_temperatura: float = 0.0      # desvio fixo simulado (°C)
    ph_base: float = 7.0                 # pH base neutro da cultura
    ph_queda: float = 0.3                # quanto o pH cai no pico de OD
    ruido_temp: float = 0.05             # desvio padrão do ruído da temperatura
    ruido_od: float = 4.0                # desvio padrão do ruído de contagens de OD
    ruido_ph: float = 0.01               # desvio padrão do ruído de pH
    od_inicial: float | None = None      # se definido, ajusta o tempo para começar nesta OD

    # Sobreposições manuais (usadas para calibração ao vivo e testes de alerta):
    od_bruto_manual: float | None = None
    temperatura_manual: float | None = None
    ph_manual: float | None = None
    ruido_manual: float | None = None

    _horas: float = 0.0
    _rng: random.Random = field(default_factory=random.Random)

    def __post_init__(self):
        if self.od_inicial is not None and 0 < self.od_inicial < self.od_max:
            # Calcula as horas equivalentes na curva logística para a OD começar no valor desejado:
            # od = k / (1 + ((k - n0)/n0) * exp(-r * t))
            k, n0, r = self.od_max, self.od0, self.taxa_por_hora
            termo = ((k - n0) / n0) * (self.od_inicial / (k - self.od_inicial))
            if termo > 0:
                self._horas = math.log(termo) / r

    def avancar(self, dt_s: float) -> None:
        self._horas += dt_s * self.escala_tempo / 3600
        if not self.falha_aquecimento:
            alvo = self.setpoint_c + self.desvio_temperatura
            fator = 1 - math.exp(-dt_s / self.tau_s)
            self.temperatura_c += (alvo - self.temperatura_c) * fator
        else:
            # Aquecedor queimado: a cultura esfria em direção à temperatura ambiente.
            self.temperatura_c += (22.0 - self.temperatura_c) * (1 - math.exp(-dt_s / (self.tau_s * 4)))

    @property
    def od(self) -> float:
        k, n0, r, t = self.od_max, self.od0, self.taxa_por_hora, self._horas
        return k / (1 + (k - n0) / n0 * math.exp(-r * t))

    def definir_manual(
        self,
        od_bruto: float | None = None,
        od: float | None = None,
        temperatura_c: float | None = None,
        ph: float | None = None,
        ruido_od: float | None = None,
    ) -> None:
        """Define medições forçadas manualmente (ex: durante calibração ou testes de alerta)."""
        if od is not None:
            # Converte OD biológica para valor bruto do sensor simulado
            self.od_bruto_manual = 2000.0 * od + 100.0
        elif od_bruto is not None:
            self.od_bruto_manual = float(od_bruto)

        if temperatura_c is not None:
            self.temperatura_manual = float(temperatura_c)
            self.temperatura_c = float(temperatura_c)

        if ph is not None:
            self.ph_manual = float(ph)

        if ruido_od is not None:
            self.ruido_manual = float(ruido_od)

    def desativar_manual(self) -> None:
        """Restaura a simulação automática da cultura."""
        self.od_bruto_manual = None
        self.temperatura_manual = None
        self.ph_manual = None
        self.ruido_manual = None

    def medir(self) -> dict:
        """Leitura como os sensores entregariam, com ruído.
        od_bruto imita contagens do conversor analógico: 2000 * od + 100."""
        od = self.od
        ruido_od = self.ruido_manual if self.ruido_manual is not None else self.ruido_od

        if self.od_bruto_manual is not None:
            od_b = round(self.od_bruto_manual + self._rng.gauss(0, ruido_od), 1)
        else:
            od_b = round(2000 * od + 100 + self._rng.gauss(0, ruido_od), 1)

        if self.temperatura_manual is not None:
            temp = round(self.temperatura_manual + self._rng.gauss(0, self.ruido_temp), 2)
        else:
            temp = round(self.temperatura_c + self._rng.gauss(0, self.ruido_temp), 2)

        if self.ph_manual is not None:
            ph_v = round(self.ph_manual + self._rng.gauss(0, self.ruido_ph), 2)
        else:
            ph_v = round(self.ph_base - self.ph_queda * od / self.od_max + self._rng.gauss(0, self.ruido_ph), 2)

        return {
            "temperatura_c": temp,
            "od_bruto": od_b,
            "ph": ph_v,
        }
