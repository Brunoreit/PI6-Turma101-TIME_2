from app.calibracao.conversao import Curva, converter
from simulador.modelo import ModeloCultivo

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


# ---------------------------------------------------------------- calibração com branco

import pytest

from app.calibracao.ajuste import (CalibracaoInvalida, ajustar_com_branco, ajustar_reta, estavel,
                                   resumir)

# Exemplo do orientador: branco 98 e três padrões.
BRANCO = 98.0
PADROES = [(520.0, 0.200), (812.0, 0.350), (1102.0, 0.500)]


def test_reta_e_r2_do_exemplo():
    ajuste = ajustar_com_branco(BRANCO, PADROES)
    assert round(ajuste.a, 6) == 0.000515
    assert round(ajuste.b, 3) == -0.018
    assert round(ajuste.r2, 3) == 1.000
    assert ajuste.branco == BRANCO


def test_minimos_quadrados_pelas_formulas():
    # x = bruto − branco; a = Sxy/Sxx, b = ȳ − a·x̄
    xs = [b - BRANCO for b, _ in PADROES]
    ys = [od for _, od in PADROES]
    mx, my = sum(xs) / 3, sum(ys) / 3
    sxx = sum((x - mx) ** 2 for x in xs)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    reta = ajustar_reta(list(zip(xs, ys)))
    assert reta.a == pytest.approx(sxy / sxx)
    assert reta.b == pytest.approx(my - sxy / sxx * mx)


def test_branco_nao_entra_como_ponto_da_reta():
    so_padroes = ajustar_reta([(b - BRANCO, od) for b, od in PADROES])
    com_branco = ajustar_com_branco(BRANCO, PADROES)
    assert (com_branco.a, com_branco.b, com_branco.r2) == (so_padroes.a, so_padroes.b, so_padroes.r2)
    # Se o branco fosse ponto (x = 0, OD 0), a reta seria outra.
    errada = ajustar_reta([(0.0, 0.0), *[(b - BRANCO, od) for b, od in PADROES]])
    assert errada.b != pytest.approx(com_branco.b, abs=1e-4)


def test_mudar_o_branco_so_desloca_x_e_nao_muda_a_inclinacao():
    a = ajustar_com_branco(98.0, PADROES)
    b = ajustar_com_branco(150.0, PADROES)
    assert a.a == pytest.approx(b.a)
    assert a.r2 == pytest.approx(b.r2)


def test_b_do_banco_converte_igual_a_formula_com_branco():
    ajuste = ajustar_com_branco(BRANCO, PADROES)
    for bruto in (0.0, 98.0, 520.0, 777.7, 1102.0, 3000.0):
        com_branco = ajuste.a * (bruto - BRANCO) + ajuste.b
        do_banco = ajuste.a * bruto + ajuste.b_banco
        assert do_banco == pytest.approx(com_branco, abs=1e-12)
    assert ajuste.b_banco == pytest.approx(ajuste.b - ajuste.a * BRANCO)
    curva = Curva(id_calibracao=9, a=ajuste.a, b=ajuste.b_banco)
    assert converter(1102.0, curva) == round(ajuste.a * (1102.0 - BRANCO) + ajuste.b, 4)


def test_padroes_podem_ter_qualquer_od():
    # Sem a faixa antiga de 0,2 a 0,8.
    ajuste = ajustar_com_branco(100.0, [(200.0, 0.05), (2100.0, 1.0), (4100.0, 2.0)])
    assert ajuste.a == pytest.approx(0.0005)
    assert ajuste.r2 == pytest.approx(1.0)


@pytest.mark.parametrize("padroes", [[], [(520.0, 0.2)], [(520.0, 0.2), (812.0, 0.35)]])
def test_menos_de_3_padroes_e_recusado(padroes):
    with pytest.raises(CalibracaoInvalida, match="pelo menos 3 padrões"):
        ajustar_com_branco(BRANCO, padroes)


def test_padroes_com_o_mesmo_bruto_ou_a_mesma_od_sao_recusados():
    with pytest.raises(CalibracaoInvalida, match="mesmo valor bruto"):
        ajustar_com_branco(BRANCO, [(500.0, 0.1), (500.0, 0.2), (500.0, 0.3)])
    with pytest.raises(CalibracaoInvalida, match="mesma OD"):
        ajustar_com_branco(BRANCO, [(500.0, 0.2), (600.0, 0.2), (700.0, 0.2)])


def test_resumo_da_janela():
    janela = resumir([1097.0, 1100.0, 1102.0, 1104.0, 1106.0, 1103.0])
    assert janela.n == 6
    assert (janela.minimo, janela.maximo) == (1097.0, 1106.0)
    assert janela.media == pytest.approx(1102.0)
    assert janela.variacao == pytest.approx(9 / 1102)
    assert janela.desvio == pytest.approx(3.162, abs=1e-3)
    assert resumir([98.0]).desvio == 0.0


def test_regra_de_estabilidade():
    # (máximo − mínimo) / média menor que o limite, com a janela cheia.
    assert estavel(resumir([1097.0, 1100.0, 1102.0, 1104.0, 1106.0, 1103.0]), 6, 0.01)
    assert not estavel(resumir([1000.0, 1020.0, 1040.0, 1060.0, 1071.0, 1071.0]), 6, 0.01)
    # Exatamente no limite não é estável (a regra é "menor que").
    assert not estavel(resumir([99.5, 100.5, 100.0, 100.0, 100.0, 100.0]), 6, 0.01)
    # Faltando leituras, nunca é estável, por mais paradas que estejam.
    assert not estavel(resumir([1100.0] * 5), 6, 0.01)
    assert not estavel(None, 6, 0.01)
    assert not estavel(resumir([0.0] * 6), 6, 0.01)
