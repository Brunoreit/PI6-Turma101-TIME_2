"""Teste de regra com leituras antigas: a conta de app/regras/simulacao.py."""

from datetime import datetime, timedelta, timezone

from app.regras.simulacao import Trecho, alertas_simulados

AGORA = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc)
INICIO = AGORA - timedelta(hours=24)
MIN = timedelta(minutes=1)


def _trecho(inicio: datetime, voltou_em: datetime | None, celula: str = "c01") -> Trecho:
    return Trecho(id_celula=celula, inicio=inicio, voltou_em=voltou_em, leituras=5, pior=61.0)


def test_abre_depois_do_tempo_e_fecha_quando_volta():
    s = AGORA - timedelta(hours=3)
    [alerta] = alertas_simulados([_trecho(s, s + 20 * MIN)], 15, INICIO, AGORA)
    assert (alerta.abriria_em, alerta.fecharia_em, alerta.aberto_antes) == (s + 15 * MIN, s + 20 * MIN, False)
    assert (alerta.leituras_fora, alerta.pior) == (5, 61.0)


def test_trecho_mais_curto_que_o_tempo_nao_abre():
    s = AGORA - timedelta(hours=3)
    assert alertas_simulados([_trecho(s, s + 14 * MIN)], 15, INICIO, AGORA) == []
    # Voltar exatamente no instante em que abriria também não abre.
    assert alertas_simulados([_trecho(s, s + 15 * MIN)], 15, INICIO, AGORA) == []


def test_ainda_fora_agora():
    # Fora há mais que o tempo: aberto até agora.
    [aberto] = alertas_simulados([_trecho(AGORA - 30 * MIN, None)], 15, INICIO, AGORA)
    assert (aberto.abriria_em, aberto.fecharia_em) == (AGORA - 15 * MIN, None)
    # Fora há menos que o tempo: ainda não abriria.
    assert alertas_simulados([_trecho(AGORA - 10 * MIN, None)], 15, INICIO, AGORA) == []


def test_alerta_que_vem_de_antes_do_periodo():
    # Começou antes do período e só voltou dentro dele: já estaria aberto.
    [antigo] = alertas_simulados([_trecho(INICIO - 30 * MIN, INICIO + 10 * MIN)], 15, INICIO, AGORA)
    assert antigo.aberto_antes and antigo.fecharia_em == INICIO + 10 * MIN
    # Abriu e fechou antes do período: fica de fora.
    assert alertas_simulados([_trecho(INICIO - 60 * MIN, INICIO - 5 * MIN)], 15, INICIO, AGORA) == []


def test_em_ordem_de_abertura():
    tarde, cedo = AGORA - 2 * timedelta(hours=1), AGORA - 5 * timedelta(hours=1)
    alertas = alertas_simulados([_trecho(tarde, None, "c02"), _trecho(cedo, cedo + 30 * MIN, "c09")], 5, INICIO, AGORA)
    assert [a.id_celula for a in alertas] == ["c09", "c02"]
