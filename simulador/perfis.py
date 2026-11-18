"""Perfis pré-configurados para as células simuladas (c01 a c16).

Refletem os cenários e condições observadas na interface web (Figma e exemplos):
  - c01 e c02: Condição 30 °C, EXP-01, operação normal
  - c03: Condição 30 °C, mas com desvio de temperatura (temperatura real ~33,4 °C)
  - c04: Célula livre (sem experimento atribuído, pronta para testes e calibração)
  - c05 e c06: Condição 37 °C, EXP-01, operação normal
  - c07 e c08: EXP-02 (cultivo ácido, pH ~6,5, temp 30 °C)
  - c09 e c10: Condição 25 °C, EXP-01, operação normal
  - c11: Condição 37 °C, mas ignorando setpoint (continua em 30 °C para simular pendência)
  - c12: EXP-02 (pH ~6,5, temp 30 °C)
  - c13 e c14: Condição 32 °C, EXP-01, operação normal
  - c15: EXP-02 (pH ~6,5, temp 30 °C)
  - c16: Célula de referência ou livre
"""

from dataclasses import dataclass


@dataclass
class PerfilCelula:
    id_celula: str
    cenario: str = "normal"
    temp_inicial_c: float = 30.0
    setpoint_c: float = 30.0
    desvio_temperatura: float = 0.0
    od_inicial: float | None = None
    ph_base: float = 7.0
    ruido_od: float = 4.0
    versao: str = "sim-0.1"
    modelo: str = "ESP32"


PERFIS_PADRAO: dict[str, PerfilCelula] = {
    "c01": PerfilCelula("c01", cenario="normal", temp_inicial_c=30.0, setpoint_c=30.0, od_inicial=0.482, ph_base=7.0),
    "c02": PerfilCelula("c02", cenario="normal", temp_inicial_c=30.0, setpoint_c=30.0, od_inicial=0.615, ph_base=7.0),
    "c03": PerfilCelula("c03", cenario="desvio_temperatura", temp_inicial_c=33.4, setpoint_c=30.0, desvio_temperatura=3.4, od_inicial=0.731, ph_base=7.0),
    "c04": PerfilCelula("c04", cenario="normal", temp_inicial_c=29.9, setpoint_c=30.0, od_inicial=0.198, ph_base=7.0),
    "c05": PerfilCelula("c05", cenario="normal", temp_inicial_c=37.0, setpoint_c=37.0, od_inicial=1.124, ph_base=7.0),
    "c06": PerfilCelula("c06", cenario="normal", temp_inicial_c=37.0, setpoint_c=37.0, od_inicial=1.287, ph_base=7.0),
    "c07": PerfilCelula("c07", cenario="normal", temp_inicial_c=30.0, setpoint_c=30.0, od_inicial=0.412, ph_base=6.58),
    "c08": PerfilCelula("c08", cenario="normal", temp_inicial_c=30.0, setpoint_c=30.0, od_inicial=0.388, ph_base=6.56),
    "c09": PerfilCelula("c09", cenario="normal", temp_inicial_c=25.0, setpoint_c=25.0, od_inicial=0.087, ph_base=7.0),
    "c10": PerfilCelula("c10", cenario="normal", temp_inicial_c=25.0, setpoint_c=25.0, od_inicial=0.121, ph_base=7.0),
    # Ignora o pedido de 37 °C da carga inicial: a temperatura própria fica em 30 °C.
    "c11": PerfilCelula("c11", cenario="ignorar_setpoint", temp_inicial_c=30.0, setpoint_c=30.0, od_inicial=0.552, ph_base=7.0),
    "c12": PerfilCelula("c12", cenario="normal", temp_inicial_c=30.0, setpoint_c=30.0, od_inicial=0.436, ph_base=6.57),
    "c13": PerfilCelula("c13", cenario="normal", temp_inicial_c=32.0, setpoint_c=32.0, od_inicial=0.468, ph_base=7.0),
    "c14": PerfilCelula("c14", cenario="normal", temp_inicial_c=32.0, setpoint_c=32.0, od_inicial=0.501, ph_base=7.0),
    "c15": PerfilCelula("c15", cenario="normal", temp_inicial_c=30.0, setpoint_c=30.0, od_inicial=0.401, ph_base=6.56),
    "c16": PerfilCelula("c16", cenario="normal", temp_inicial_c=30.0, setpoint_c=30.0, od_inicial=0.050, ph_base=7.0),
}


def obter_perfil(id_celula: str) -> PerfilCelula:
    """Retorna o perfil da célula ou cria um perfil padrão para IDs desconhecidos."""
    return PERFIS_PADRAO.get(id_celula, PerfilCelula(id_celula=id_celula))
