"""Roteiro de 90 dias da demonstração: o que cada célula fez em cada período.

É a fonte única das duas pontas da carga de demonstração:
  - simulador/semente.py cria no banco os experimentos, os cultivos, os
    pedidos de setpoint e os alertas antigos descritos aqui;
  - simulador/celula.py gera o histórico de leituras (HISTORICO_HORAS)
    seguindo as mesmas datas, então cada cultivo antigo tem as suas curvas.

Os tempos são em "dias atrás" (90 = há 90 dias, 0 = agora), para a carga
valer em qualquer data. Não é um modelo biológico preciso: as curvas só
precisam ter o formato certo para os gráficos e a exportação.

Sete experimentos: EXP-01 e EXP-02 em andamento, EXP-03 em stand by,
EXP-04, EXP-05 e EXP-07 encerrados e EXP-06 cancelado.
"""

import math
from dataclasses import dataclass, field

from simulador.perfis import PERFIS_PADRAO

DIAS = 90
TEMPERATURA_EM_ESPERA_C = 30.0
OD_EM_ESPERA = 0.03          # frasco só com meio de cultura


@dataclass(frozen=True)
class ExperimentoRoteiro:
    id: int
    nome: str
    descricao: str
    modo: str                    # curva_crescimento | turbidostato | quimiostato
    status: str                  # cadastrado | em_andamento | encerrado | cancelado
    responsavel: str             # pedro | rogerio | henry | gabriel
    ph_min: float
    ph_max: float
    temperatura_alvo_c: float
    criado: float                # dias atrás
    inicio: float | None = None
    fim: float | None = None
    origem: int | None = None
    motivo: str | None = None    # do cancelamento
    metadados: dict = field(default_factory=dict)
    acessos: tuple[tuple[str, str], ...] = ()   # (pessoa, permissão)


@dataclass(frozen=True)
class CultivoRoteiro:
    experimento: int
    celula: str
    condicao: str
    replica: int
    inicio: float                # dias atrás
    fim: float | None            # dias atrás; None = aberto
    temperatura_c: float
    curva: str                   # lotes | turbidostato | quimiostato
    od_alvo: float               # patamar (lotes) ou OD mantida (turbidostato, quimiostato)
    ph_base: float = 7.0
    ganho_por_dia: float = 0.0   # turbidostato: a cultura se adapta e os ciclos encurtam
    queda_apos_dias: float | None = None   # a cultura morre depois deste tempo
    desvio_final_c: float = 0.0  # nas últimas horas a temperatura sobe este tanto (c03)
    temperatura_medida_c: float | None = None   # se a célula não obedece o setpoint (c11)


@dataclass(frozen=True)
class EventoRoteiro:
    """Alerta antigo, já fechado. Com `grandeza`, as leituras do período
    mostram o problema; sem ela (comunicação), as leituras não mudam, porque
    a célula guarda tudo e reenvia."""
    tipo: str
    celula: str | None           # None = alerta do sistema
    inicio: float                # dias atrás
    duracao_h: float
    mensagem: str
    grandeza: str | None = None  # temperatura | ph
    delta: float = 0.0


EXPERIMENTOS = [
    ExperimentoRoteiro(
        1, "Temperatura ótima de E. coli", "Compara o crescimento a 25, 30, 32 e 37 °C",
        "turbidostato", "em_andamento", "rogerio", 6.6, 7.2, 30.0, criado=19, inicio=18,
        metadados={"fases": [{"duracaoDias": 90, "temperaturaC": 30}], "organismo": "E. coli BW25113",
                   "meio": "LB", "volume_ml": 20, "agitacao_rpm": 600},
        acessos=(("pedro", "leitura"), ("henry", "edicao"), ("gabriel", "leitura"))),
    ExperimentoRoteiro(
        2, "Adaptação a pH ácido", "Cepa em meio com pH 6,5, temperatura fixa de 30 °C",
        "quimiostato", "em_andamento", "pedro", 6.3, 6.7, 30.0, criado=13, inicio=12,
        metadados={"fases": [{"duracaoDias": 90, "temperaturaC": 30}], "organismo": "E. coli",
                   "meio": "M9 glicose pH 6.5"},
        acessos=(("rogerio", "leitura"),)),
    ExperimentoRoteiro(
        3, "Temperatura ótima · repetição", "Duplicado do EXP-01, faixa de 28 a 34 °C",
        "turbidostato", "cadastrado", "pedro", 6.6, 7.2, 30.0, criado=2, origem=1,
        metadados={"baseadoEm": "EXP-01"}),
    ExperimentoRoteiro(
        4, "Validação do sensor de OD", "Curvas de referência em lote para conferir a calibração das células",
        "curva_crescimento", "encerrado", "henry", 6.7, 7.3, 30.0, criado=92, inicio=89.5, fim=75,
        metadados={"organismo": "E. coli K-12", "meio": "LB", "volume_ml": 20},
        acessos=(("pedro", "edicao"),)),
    ExperimentoRoteiro(
        5, "Curva de crescimento em LB e M9", "Lotes de 3 dias a 37 °C em meio rico (LB) e mínimo (M9)",
        "curva_crescimento", "encerrado", "gabriel", 6.5, 7.2, 37.0, criado=72, inicio=70, fim=45,
        metadados={"organismo": "E. coli BW25113", "meios": ["LB", "M9 glicose"], "volume_ml": 20},
        acessos=(("rogerio", "leitura"), ("henry", "leitura"))),
    ExperimentoRoteiro(
        6, "Estresse térmico a 42 °C", "Turbidostato a 42 °C para selecionar tolerância ao calor",
        "turbidostato", "cancelado", "rogerio", 6.6, 7.2, 42.0, criado=41, inicio=40, fim=33,
        motivo="Contaminação nas quatro células a partir do quinto dia",
        metadados={"organismo": "E. coli BW25113", "meio": "LB"}),
    ExperimentoRoteiro(
        7, "Evolução adaptativa em turbidostato", "Duas linhagens mantidas em OD 0,6 por 40 dias a 30 °C",
        "turbidostato", "encerrado", "pedro", 6.6, 7.2, 30.0, criado=63, inicio=62, fim=22,
        metadados={"organismo": "E. coli", "meio": "M9 glicose", "od_alvo": 0.6},
        acessos=(("gabriel", "edicao"), ("henry", "leitura"))),
]


def _atual(experimento: int, celula: str, condicao: str, replica: int, inicio: float,
           curva: str, **campos) -> CultivoRoteiro:
    """Cultivo aberto: termina agora na OD, no pH e na temperatura do perfil
    da célula, para o histórico emendar com as leituras ao vivo."""
    perfil = PERFIS_PADRAO[celula]
    return CultivoRoteiro(experimento, celula, condicao, replica, inicio, None, perfil.setpoint_c, curva,
                          od_alvo=perfil.od_inicial or 0.5, ph_base=perfil.ph_base, **campos)


CULTIVOS = [
    # EXP-04, encerrado: quatro réplicas em lote a 30 °C
    *(CultivoRoteiro(4, f"c0{n}", "Referência LB", n, 89.5, 75, 30.0, "lotes", od_alvo=1.15 + 0.04 * n,
                     ph_base=7.15) for n in range(1, 5)),
    # EXP-05, encerrado: LB cresce mais e mais rápido que M9
    *(CultivoRoteiro(5, f"c0{n}", "LB", n, 70, 45, 37.0, "lotes", od_alvo=1.42 + 0.03 * n) for n in range(1, 5)),
    *(CultivoRoteiro(5, f"c0{n}", "M9 glicose", n - 4, 70, 45, 37.0, "lotes", od_alvo=0.82 + 0.02 * n)
      for n in range(5, 9)),
    # EXP-06, cancelado: a cultura cai depois do quinto dia
    *(CultivoRoteiro(6, f"c0{n}", "42 °C", n, 40, 33, 42.0, "turbidostato", od_alvo=0.5,
                     queda_apos_dias=4.6 + 0.15 * n) for n in range(1, 5)),
    # EXP-07, encerrado: as duas linhagens ficam mais rápidas com o tempo
    *(CultivoRoteiro(7, f"c{n:02d}", "Linhagem A", n - 8, 62, 22, 30.0, "turbidostato", od_alvo=0.6,
                     ganho_por_dia=0.012) for n in range(9, 13)),
    *(CultivoRoteiro(7, f"c{n:02d}", "Linhagem B", n - 12, 62, 22, 30.0, "turbidostato", od_alvo=0.6,
                     ganho_por_dia=0.020) for n in range(13, 17)),
    # EXP-01, em andamento
    _atual(1, "c09", "25 °C", 1, 18, "turbidostato"),
    _atual(1, "c10", "25 °C", 2, 18, "turbidostato"),
    _atual(1, "c01", "30 °C", 1, 18, "turbidostato"),
    _atual(1, "c02", "30 °C", 2, 18, "turbidostato"),
    _atual(1, "c03", "30 °C", 3, 18, "turbidostato", desvio_final_c=3.4),
    _atual(1, "c13", "32 °C", 1, 17, "turbidostato"),
    _atual(1, "c14", "32 °C", 2, 17, "turbidostato"),
    _atual(1, "c05", "37 °C", 1, 18, "turbidostato"),
    _atual(1, "c06", "37 °C", 2, 18, "turbidostato"),
    # A c11 ignora o pedido de 37 °C: a condição é 37, a temperatura medida fica em 30.
    _atual(1, "c11", "37 °C", 3, 2, "turbidostato", temperatura_medida_c=30.0),
    # EXP-02, em andamento
    _atual(2, "c07", "pH 6,5", 1, 12, "quimiostato"),
    _atual(2, "c08", "pH 6,5", 2, 12, "quimiostato"),
    _atual(2, "c12", "pH 6,5", 3, 12, "quimiostato"),
    _atual(2, "c15", "pH 6,5", 4, 12, "quimiostato"),
]

# Temperatura do pedido de setpoint de cada cultivo aberto (a condição do
# experimento). Só difere do perfil na c11, que ignora o pedido.
SETPOINT_PEDIDO_C = {"c11": 37.0}

EVENTOS = [
    EventoRoteiro("desvio_temperatura", "c14", 50, 3, "Temperatura em 33.2 °C, alvo de 30.0 °C.",
                  grandeza="temperatura", delta=3.2),
    EventoRoteiro("ph_fora_da_faixa", "c06", 57, 5, "pH em 6.37, fora da faixa de referência (de 6.50 a 7.20).",
                  grandeza="ph", delta=-0.45),
    EventoRoteiro("sem_comunicacao", "c02", 65, 2, "A célula parou de enviar dados."),
    EventoRoteiro("sem_comunicacao", "c10", 30, 0.7, "A célula parou de enviar dados."),
    EventoRoteiro("setpoint_sem_confirmacao", "c15", 61.99, 0.2, "A célula não confirmou o setpoint de 30.0 °C."),
    EventoRoteiro("broker_inacessivel", None, 44, 0.4,
                  "O servidor perdeu a conexão com o broker MQTT. As leituras ficam guardadas no broker "
                  "ou nas células até a conexão voltar."),
    EventoRoteiro("consumidor_parado", None, 12.5, 0.1,
                  "O consumidor parou: as leituras não estão sendo gravadas. Elas ficam guardadas no broker "
                  "até ele voltar."),
]


# ---------------------------------------------------------------- curvas

# Taxa de crescimento (por hora) em função da temperatura.
_TAXAS = [(20.0, 0.10), (25.0, 0.22), (30.0, 0.45), (32.0, 0.52), (37.0, 0.70), (42.0, 0.30), (45.0, 0.10)]


def taxa_de_crescimento(temperatura_c: float) -> float:
    if temperatura_c <= _TAXAS[0][0]:
        return _TAXAS[0][1]
    for (t0, m0), (t1, m1) in zip(_TAXAS, _TAXAS[1:]):
        if temperatura_c <= t1:
            return m0 + (m1 - m0) * (temperatura_c - t0) / (t1 - t0)
    return _TAXAS[-1][1]


def cultivo_em(id_celula: str, dias_atras: float) -> CultivoRoteiro | None:
    for c in CULTIVOS:
        if c.celula == id_celula and c.inicio >= dias_atras > (c.fim if c.fim is not None else -1):
            return c
    return None


def _od(c: CultivoRoteiro, horas: float, horas_ate_o_fim: float) -> float:
    """OD do cultivo `horas` depois do início, faltando `horas_ate_o_fim`."""
    taxa = taxa_de_crescimento(c.temperatura_medida_c or c.temperatura_c)
    if c.curva == "lotes":
        # Lotes de 3 dias: cresce até o patamar, cai um pouco e é repicado.
        t = horas % 72
        od = c.od_alvo / (1 + (c.od_alvo - 0.05) / 0.05 * math.exp(-taxa * t))
        od *= 1 - 0.04 * max(0.0, t - 30) / 42
    elif c.curva == "turbidostato":
        baixa, alta = 0.88 * c.od_alvo, 1.12 * c.od_alvo
        rampa = 0.05 * math.exp(taxa * horas)
        if rampa < baixa:
            od = rampa
        else:
            # Dente de serra: cresce até a OD alta e é diluído para a baixa.
            # O ciclo é contado a partir do fim, para terminar no alvo.
            periodo = 6.0 * 0.45 / (taxa * (1 + c.ganho_por_dia * horas / 24))
            fase = ((-horas_ate_o_fim / periodo) % 1 + 0.5) % 1
            od = baixa * (alta / baixa) ** fase
    else:  # quimiostato
        total = horas + horas_ate_o_fim
        adaptacao = (1 - 0.4 * math.exp(-horas / 96)) / (1 - 0.4 * math.exp(-total / 96))
        od = c.od_alvo * adaptacao + 0.008 * math.sin(2 * math.pi * horas_ate_o_fim / 24)
        od = 0.05 + (od - 0.05) * (1 - math.exp(-horas / 8))
    if c.queda_apos_dias is not None and horas > c.queda_apos_dias * 24:
        od = max(OD_EM_ESPERA, od * math.exp(-(horas - c.queda_apos_dias * 24) / 20))
    return od


def valores(id_celula: str, dias_atras: float) -> tuple[float, float, float]:
    """(temperatura em °C, OD, pH) da célula naquele momento, sem ruído."""
    c = cultivo_em(id_celula, dias_atras)
    if c is None:
        perfil = PERFIS_PADRAO.get(id_celula)
        # Célula livre agora (c04, c16): termina na OD do perfil.
        livre_agora = perfil is not None and perfil.od_inicial is not None and all(
            k.fim is not None and k.fim >= dias_atras for k in CULTIVOS if k.celula == id_celula)
        temperatura, od, ph = TEMPERATURA_EM_ESPERA_C, (perfil.od_inicial if livre_agora else OD_EM_ESPERA), 7.0
    else:
        horas = (c.inicio - dias_atras) * 24
        horas_ate_o_fim = (dias_atras - (c.fim or 0.0)) * 24
        od = _od(c, horas, horas_ate_o_fim)
        alvo = c.temperatura_medida_c if c.temperatura_medida_c is not None else c.temperatura_c
        temperatura = TEMPERATURA_EM_ESPERA_C + (alvo - TEMPERATURA_EM_ESPERA_C) * (1 - math.exp(-horas / 0.3))
        if c.desvio_final_c and horas_ate_o_fim < 6:
            temperatura += c.desvio_final_c * (1 - math.exp(-(6 - horas_ate_o_fim) / 1.0))
        ph = c.ph_base - 0.3 * od / 1.5
    for e in EVENTOS:
        if e.grandeza and e.celula == id_celula and e.inicio >= dias_atras > e.inicio - e.duracao_h / 24:
            if e.grandeza == "temperatura":
                temperatura += e.delta
            else:
                ph += e.delta
    return temperatura, od, ph
