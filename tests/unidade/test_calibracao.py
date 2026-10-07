from app.calibracao.conversao import Curva, converter
from modelo import ModeloCultivo

CURVA_PADRAO = Curva(id_calibracao=1, a=0.0005, b=-0.05)


def test_converte_pela_curva_linear():
    assert converter(1100.0, CURVA_PADRAO) == 0.5


def test_sem_valor_ou_sem_curva_devolve_none():
    assert converter(None, CURVA_PADRAO) is None
    assert converter(1100.0, None) is None


def test_curva_padrao_desfaz_o_sensor_simulado():
    # O simulador gera od_bruto = 2000 * od + 100. A calibração padrão
    # precisa devolver a OD original, com a margem do ruído do sensor.
    modelo = ModeloCultivo()
    for _ in range(20):
        modelo.avancar(600)
        leitura = modelo.medir()
        assert abs(converter(leitura["od_bruto"], CURVA_PADRAO) - modelo.od) < 0.02
