"""Montagem do arquivo da exportação: colunas, arredondamento, CSV e Excel."""

import io
from datetime import datetime

import pytest
from openpyxl import load_workbook

from app.api.esquemas import NovaExportacao
from app.exportacao import montagem
from app.exportacao.montagem import Alvo, Planilha, Titulo

ALVO = Alvo("c01", datetime(2026, 11, 1), None, condicao="30 °C", replica=2)
BRUTA = {"data_hora": datetime(2026, 11, 1, 9, 0, 20), "temperatura_c": 30.0123456, "ph": 6.98765,
         "od": 0.123456, "od_bruto": 345.6789}
AGRUPADA = {"data_hora": datetime(2026, 11, 1, 9), "leituras": 3,
            "temperatura_c_media": 30.00049, "temperatura_c_min": 29.9, "temperatura_c_max": 30.1,
            "ph_media": 7.0, "ph_min": 6.9, "ph_max": 7.1,
            "od_media": 0.12345678, "od_min": 0.1, "od_max": 0.2,
            "od_bruto_media": 345.678, "od_bruto_min": 300.0, "od_bruto_max": 400.0,
            "taxa_divisoes_por_hora": 0.4567891}


def test_colunas_seguem_as_medidas_na_ordem_fixa():
    assert montagem.colunas_das_medidas(["od", "temperatura"], agrupado=False) == ["temperatura_c", "od"]
    assert montagem.colunas_das_medidas(["taxa", "od_bruta"], agrupado=True) == [
        "od_bruto_media", "od_bruto_min", "od_bruto_max", "taxa_divisoes_por_hora"]


def test_taxa_nao_existe_nos_dados_brutos():
    assert montagem.colunas_das_medidas(["taxa", "ph"], agrupado=False) == ["ph"]


def test_cabecalho_muda_com_o_modo_e_o_agrupamento():
    assert montagem.cabecalho_dos_dados(["ph"], agrupado=False, por_experimento=False) == ["celula", "data_hora", "ph"]
    assert montagem.cabecalho_dos_dados(["ph"], agrupado=True, por_experimento=True) == [
        "celula", "condicao", "replica", "inicio_do_intervalo", "leituras", "ph_media", "ph_min", "ph_max"]


def test_linha_bruta_arredonda_cada_medida():
    linha = montagem.linha_dos_dados(ALVO, BRUTA, ["temperatura", "ph", "od", "od_bruta"], False, True)
    assert linha == ["c01", "30 °C", 2, datetime(2026, 11, 1, 9, 0, 20), 30.012, 6.988, 0.1235, 345.68]


def test_linha_agrupada_tem_leituras_e_taxa():
    linha = montagem.linha_dos_dados(ALVO, AGRUPADA, ["od", "taxa"], True, False)
    assert linha == ["c01", datetime(2026, 11, 1, 9), 3, 0.1235, 0.1, 0.2, 0.4568]


def test_linha_tem_o_tamanho_do_cabecalho():
    for agrupado in (False, True):
        for por_experimento in (False, True):
            registro = AGRUPADA if agrupado else BRUTA
            cabecalho = montagem.cabecalho_dos_dados(montagem.MEDIDAS, agrupado, por_experimento)
            linha = montagem.linha_dos_dados(ALVO, registro, montagem.MEDIDAS, agrupado, por_experimento)
            assert len(linha) == len(cabecalho)


def test_passo_em_minutos():
    assert [montagem.passo_em_minutos(a, 15) for a in ("brutos", "hora", "dia", "intervalo")] == [None, 60, 1440, 15]


def test_csv_no_formato_do_excel_em_portugues():
    texto = "".join(montagem.escrever_csv([
        Titulo(["celula", "data_hora", "od", "replica"]),
        ["c01", datetime(2026, 11, 1, 9, 0, 20), 0.1235, None],
    ]))
    assert texto == "﻿celula;data_hora;od;replica\r\nc01;2026-11-01 09:00:20;0,1235;\r\n"


def test_csv_sai_em_pedacos_sem_perder_linhas():
    linhas = [["c01", n, 1.5] for n in range(20_000)]
    pedacos = list(montagem.escrever_csv(linhas))
    assert len(pedacos) > 1
    assert "".join(pedacos).count("\r\n") == 20_000


def test_xlsx_tem_uma_aba_por_planilha():
    arquivo = montagem.escrever_xlsx([
        Planilha("Dados", [Titulo(["celula", "data_hora", "od"]), ["c01", datetime(2026, 11, 1, 9, 0, 20, 5), 0.1235]]),
        Planilha("Alertas", [Titulo(["tipo"]), ["desvio_temperatura"]]),
    ])
    livro = load_workbook(io.BytesIO(arquivo))
    assert livro.sheetnames == ["Dados", "Alertas"]
    dados = livro["Dados"]
    assert [c.value for c in dados[1]] == ["celula", "data_hora", "od"]
    assert dados["A1"].font.bold and not dados["A2"].font.bold
    # Sem microssegundos: o Excel mostraria a data como número quebrado.
    assert [c.value for c in dados[2]] == ["c01", datetime(2026, 11, 1, 9, 0, 20), 0.1235]
    assert dados.freeze_panes == "A2"


def test_xlsx_recusa_mais_linhas_que_o_limite():
    linhas = [Titulo(["n"]), *([n] for n in range(6))]
    montagem.escrever_xlsx([Planilha("Dados", linhas)], limite=6)
    with pytest.raises(montagem.ArquivoGrandeDemais):
        montagem.escrever_xlsx([Planilha("Dados", linhas)], limite=5)


def test_metadados_tem_a_ficha_e_os_cultivos():
    experimento = {"id_experimento": 3, "nome": "Curva", "descricao": None, "modo": "turbidostato",
                   "status": "em_andamento", "responsavel_nome": "Ana", "duracao_prevista_dias": 30,
                   "temperatura_alvo_c": 30.0, "ph_ref_min": 6.5, "ph_ref_max": 7.5,
                   "metadados": {"organismo": "E. coli", "fases": [{"dias": 3}]}}
    cultivo = {"id_cultivo": 7, "id_celula": "c01", "condicao": "30 °C", "replica": 1, "status": "em_andamento",
               "iniciado_em": datetime(2026, 11, 1), "encerrado_em": None, "motivo_encerramento": None,
               "ph_ref_min": 6.5, "ph_ref_max": 7.5, "continua_de": None, "iniciado_por": "Ana",
               "encerrado_por": None}
    datas = {"criado_em": datetime(2026, 10, 30), "iniciado_em": datetime(2026, 11, 1), "encerrado_em": None}
    planilha = montagem.planilha_de_metadados(experimento, [cultivo], "America/Sao_Paulo", datas)
    livro = load_workbook(io.BytesIO(montagem.escrever_xlsx([planilha])))
    linhas = [[c for c in linha if c is not None] for linha in livro["Metadados"].iter_rows(values_only=True)]
    assert ["codigo", "EXP-03"] in linhas and ["tipo_de_crescimento", "Turbidostato"] in linhas
    assert ["status", "Em andamento"] in linhas and ["organismo", "E. coli"] in linhas
    assert ["fases", '[{"dias": 3}]'] in linhas and ["fuso_das_datas", "America/Sao_Paulo"] in linhas
    assert linhas[-1][:5] == [7, "c01", "30 °C", 1, "em_andamento"]


def test_nome_do_arquivo():
    assert montagem.nome_do_arquivo("EXP-01", "hora", None, "xlsx", "2026-11-16") == "EXP-01_media-por-hora_2026-11-16.xlsx"
    assert montagem.nome_do_arquivo("celulas_c01", "intervalo", 15, "csv", "2026-11-16") == \
        "celulas_c01_a-cada-15-min_2026-11-16.csv"


# ------------------------------------------------------------------ o pedido

POR_CELULA = {"celulas": ["c01"], "desde": "2026-11-01T00:00:00-03:00", "ate": "2026-11-02T00:00:00-03:00",
              "medidas": ["od"]}


def test_pedido_por_experimento_e_por_celula():
    assert NovaExportacao(id_experimento=1, medidas=["od"]).formato == "xlsx"
    assert NovaExportacao(**POR_CELULA).agrupamento == "brutos"


@pytest.mark.parametrize("corpo, trecho", [
    ({"medidas": ["od"]}, "Informe id_experimento"),
    ({**POR_CELULA, "ate": None}, "informe desde e ate"),
    ({**POR_CELULA, "desde": "2026-11-01T00:00:00"}, "com fuso"),
    ({**POR_CELULA, "ate": POR_CELULA["desde"]}, "desde antes de ate"),
    ({"id_experimento": 1, "medidas": ["od"], "desde": POR_CELULA["desde"]}, "Tire desde e ate"),
    ({**POR_CELULA, "agrupamento": "intervalo"}, "intervalo_min"),
    ({**POR_CELULA, "intervalo_min": 15}, "intervalo_min"),
    ({**POR_CELULA, "medidas": ["taxa"]}, "só existe nos dados agrupados"),
])
def test_pedido_incoerente_e_recusado(corpo, trecho):
    with pytest.raises(ValueError, match=trecho):
        NovaExportacao(**corpo)


def test_pedido_sem_medida_e_recusado():
    with pytest.raises(ValueError):
        NovaExportacao(id_experimento=1, medidas=[])
