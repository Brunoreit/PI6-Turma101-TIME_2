"""Monta o arquivo da exportação: as colunas, o arredondamento e a escrita em
CSV e em Excel.

Aqui não há consulta ao banco nem FastAPI: as funções recebem as linhas que
os repositórios devolvem e produzem planilhas, que a API transforma em
arquivo. Assim dá para testar o formato sem infraestrutura.

O CSV sai como o Excel em português espera: UTF-8 com BOM, ";" entre as
colunas e vírgula decimal. As datas vêm do banco já no fuso pedido, sem fuso.
"""

import csv
import io
import json
from collections.abc import Iterable, Iterator
from dataclasses import dataclass
from datetime import datetime

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Font

MEDIDAS = ("temperatura", "ph", "od", "od_bruta", "taxa")

# Colunas de cada medida, nos dados brutos e nos agrupados.
_BRUTAS = {"temperatura": ["temperatura_c"], "ph": ["ph"], "od": ["od"], "od_bruta": ["od_bruto"]}
_AGRUPADAS = {
    "temperatura": ["temperatura_c_media", "temperatura_c_min", "temperatura_c_max"],
    "ph": ["ph_media", "ph_min", "ph_max"],
    "od": ["od_media", "od_min", "od_max"],
    "od_bruta": ["od_bruto_media", "od_bruto_min", "od_bruto_max"],
    "taxa": ["taxa_divisoes_por_hora"],
}
# Casas decimais pelo começo do nome da coluna. A ordem importa: od_bruto antes de od.
_CASAS = (("temperatura", 3), ("ph", 3), ("od_bruto", 2), ("od", 4), ("taxa", 4))

# Linhas de dados que cabem numa aba do Excel (o limite dele é 1.048.576).
LIMITE_EXCEL = 1_000_000

ROTULO_DO_AGRUPAMENTO = {"brutos": "dados-brutos", "hora": "media-por-hora", "dia": "media-por-dia"}


class ArquivoGrandeDemais(Exception):
    """A aba Dados passaria do limite de linhas do Excel."""


class Titulo(list):
    """Linha de cabeçalho: sai em negrito no Excel."""


@dataclass
class Alvo:
    """Uma célula num período. Fim None é "até agora". No modo experimento,
    é um cultivo, com a condição e a réplica dele."""

    id_celula: str
    inicio: datetime
    fim: datetime | None
    condicao: str | None = None
    replica: int | None = None


@dataclass
class Planilha:
    """Uma aba do Excel (ou o CSV inteiro, que é só a aba Dados)."""

    nome: str
    linhas: Iterable[list]
    # Linha de cima congelada: abas que são uma tabela só.
    congelar: bool = True


def passo_em_minutos(agrupamento: str, intervalo_min: int | None) -> int | None:
    """None para os dados brutos."""
    return {"brutos": None, "hora": 60, "dia": 1440, "intervalo": intervalo_min}[agrupamento]


def colunas_das_medidas(medidas: Iterable[str], agrupado: bool) -> list[str]:
    """As colunas de medida, na ordem fixa de MEDIDAS. A taxa só existe nos
    dados agrupados: numa leitura só não há inclinação."""
    tabela = _AGRUPADAS if agrupado else _BRUTAS
    return [coluna for medida in MEDIDAS if medida in medidas for coluna in tabela.get(medida, [])]


def cabecalho_dos_dados(medidas: Iterable[str], agrupado: bool, por_experimento: bool) -> Titulo:
    return Titulo([
        "celula",
        *(["condicao", "replica"] if por_experimento else []),
        *(["inicio_do_intervalo", "leituras"] if agrupado else ["data_hora"]),
        *colunas_das_medidas(medidas, agrupado),
    ])


def _arredondar(coluna: str, valor):
    if not isinstance(valor, float):
        return valor
    for comeco, casas in _CASAS:
        if coluna.startswith(comeco):
            return round(valor, casas)
    return valor


def linha_dos_dados(alvo: Alvo, registro: dict, medidas: Iterable[str], agrupado: bool,
                    por_experimento: bool) -> list:
    """Uma linha da aba Dados, na ordem de cabecalho_dos_dados."""
    return [
        alvo.id_celula,
        *([alvo.condicao, alvo.replica] if por_experimento else []),
        registro["data_hora"],
        *([registro["leituras"]] if agrupado else []),
        *(_arredondar(c, registro[c]) for c in colunas_das_medidas(medidas, agrupado)),
    ]


def _texto(valor) -> str:
    """Um valor no CSV: vírgula decimal e data sem fuso nem microssegundos."""
    if valor is None:
        return ""
    if isinstance(valor, bool):
        return "sim" if valor else "não"
    if isinstance(valor, datetime):
        return valor.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(valor, float):
        return repr(valor).replace(".", ",")
    return str(valor)


def escrever_csv(linhas: Iterable[list]) -> Iterator[str]:
    """O CSV em pedaços, para a API enviar sem montar tudo na memória."""
    buffer = io.StringIO()
    buffer.write("﻿")
    escritor = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    for linha in linhas:
        escritor.writerow(_texto(v) for v in linha)
        if buffer.tell() > 64_000:
            yield buffer.getvalue()
            buffer.seek(0)
            buffer.truncate()
    yield buffer.getvalue()


def _valor_da_celula(valor):
    """O Excel não guarda fuso nem listas: bool vira sim/não e o resto, texto."""
    if isinstance(valor, bool):
        return "sim" if valor else "não"
    if isinstance(valor, (dict, list)):
        return json.dumps(valor, ensure_ascii=False)
    if isinstance(valor, datetime):
        return valor.replace(microsecond=0)
    return valor


def escrever_xlsx(planilhas: list[Planilha], limite: int = LIMITE_EXCEL) -> bytes:
    """O arquivo .xlsx com uma aba por planilha. A primeira é a de dados;
    se ela passar do limite de linhas, levanta ArquivoGrandeDemais."""
    livro = Workbook(write_only=True)
    negrito = Font(bold=True)
    for indice, planilha in enumerate(planilhas):
        aba = livro.create_sheet(planilha.nome)
        if planilha.congelar:
            aba.freeze_panes = "A2"
        for coluna in "ABCDEFGHIJKLMNOPQRST":
            aba.column_dimensions[coluna].width = 22
        for numero, linha in enumerate(planilha.linhas):
            if indice == 0 and numero > limite:
                # Fecha a aba que estava sendo escrita, para não sobrar arquivo temporário aberto.
                aba.close()
                raise ArquivoGrandeDemais
            if isinstance(linha, Titulo):
                celulas = []
                for valor in linha:
                    celula = WriteOnlyCell(aba, value=valor)
                    celula.font = negrito
                    celulas.append(celula)
                aba.append(celulas)
            else:
                aba.append([_valor_da_celula(v) for v in linha])
    saida = io.BytesIO()
    livro.save(saida)
    return saida.getvalue()


# ------------------------------------------------------------------ anexos

_MODO = {"curva_crescimento": "Curva de crescimento", "turbidostato": "Turbidostato", "quimiostato": "Quimiostato"}
_STATUS = {"cadastrado": "Stand by", "em_andamento": "Em andamento", "encerrado": "Encerrado",
           "cancelado": "Cancelado"}


def _tabela(nome: str, cabecalho: list[str], registros: list[dict]) -> Planilha:
    return Planilha(nome, [Titulo(cabecalho), *([r[c] for c in cabecalho] for r in registros)])


def planilha_de_metadados(experimento: dict, cultivos: list[dict], fuso: str, datas: dict) -> Planilha:
    """A ficha do experimento, em campo e valor, e embaixo os cultivos dele.
    `datas` traz criado_em, iniciado_em e encerrado_em já no fuso pedido."""
    ficha = [
        ("codigo", f"EXP-{experimento['id_experimento']:02d}"),
        ("nome", experimento["nome"]),
        ("descricao", experimento["descricao"]),
        ("tipo_de_crescimento", _MODO.get(experimento["modo"], experimento["modo"])),
        ("status", _STATUS.get(experimento["status"], experimento["status"])),
        ("responsavel", experimento["responsavel_nome"]),
        ("criado_em", datas["criado_em"]),
        ("iniciado_em", datas["iniciado_em"]),
        ("encerrado_em", datas["encerrado_em"]),
        ("duracao_prevista_dias", experimento["duracao_prevista_dias"]),
        ("temperatura_alvo_c", experimento["temperatura_alvo_c"]),
        ("ph_ref_min", experimento["ph_ref_min"]),
        ("ph_ref_max", experimento["ph_ref_max"]),
        *sorted((experimento["metadados"] or {}).items()),
        ("fuso_das_datas", fuso),
    ]
    colunas = ["id_cultivo", "id_celula", "condicao", "replica", "status", "iniciado_em", "encerrado_em",
               "motivo_encerramento", "ph_ref_min", "ph_ref_max", "continua_de", "iniciado_por", "encerrado_por"]
    return Planilha("Metadados", [
        Titulo(["campo", "valor"]),
        *([campo, valor] for campo, valor in ficha),
        [],
        Titulo(["Cultivos"]),
        Titulo(colunas),
        *([c[coluna] for coluna in colunas] for c in cultivos),
    ], congelar=False)


def planilha_de_contexto(cultivos: list[dict], fuso: str) -> Planilha:
    """Em que experimento cada célula estava no período, entre os que a
    pessoa pode ver."""
    registros = [{**c, "experimento": f"EXP-{c['id_experimento']:02d} · {c['experimento']}"} for c in cultivos]
    planilha = _tabela("Contexto", ["id_celula", "experimento", "condicao", "replica", "status", "iniciado_em",
                                    "encerrado_em", "motivo_encerramento"], registros)
    planilha.linhas = [*planilha.linhas, [], ["fuso_das_datas", fuso]]
    return planilha


def planilha_de_parametros(pedidos: list[dict]) -> Planilha:
    return _tabela("Parâmetros", ["id_celula", "solicitado_em", "temperatura_c", "solicitado_por", "estado",
                                  "motivo", "recebido_em", "aplicado_em", "atingido_em"], pedidos)


def planilha_de_alertas(alertas: list[dict]) -> Planilha:
    return _tabela("Alertas", ["id_celula", "tipo", "mensagem", "aberto_em", "fechado_em", "fechado_por"], alertas)


def planilha_de_calibracoes(calibracoes: list[dict]) -> Planilha:
    return _tabela("Calibrações", ["id_celula", "versao", "a", "b", "r2", "organismo", "calibrado_por",
                                   "criada_em", "ativa", "leituras", "id_calibracao"], calibracoes)


def nome_do_arquivo(origem: str, agrupamento: str, intervalo_min: int | None, formato: str, hoje: str) -> str:
    """Ex.: EXP-01_media-por-hora_2026-11-16.xlsx. `origem` é o código do
    experimento ou as células."""
    rotulo = ROTULO_DO_AGRUPAMENTO.get(agrupamento, f"a-cada-{intervalo_min}-min")
    return f"{origem}_{rotulo}_{hoje}.{formato}"
