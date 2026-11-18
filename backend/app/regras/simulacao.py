"""Teste de uma regra de alerta com leituras antigas, sem gravar nada.

Responde "o que esta regra teria feito nas últimas N horas", com a mesma
lógica de `regras_configuradas` (verificacoes.py):

- abre quando a última leitura está fora do limite, nenhuma leitura dos
  últimos `por_minutos` ficou dentro dele e a última leitura de antes desse
  tempo já estava fora;
- fecha quando uma leitura volta para dentro do limite.

Numa sequência de leituras seguidas fora do limite (um trecho), começando no
instante s e terminando quando chega a primeira leitura de volta (v), essas
três condições valem para todo instante t com s + por_minutos <= t < v. Por
isso o alerta abriria em s + por_minutos, se o trecho durar até lá, e
fecharia em v. As consultas que acham os trechos ficam em repositorios.py;
aqui só a conta, para ser testada sem banco.

A verificação real roda a cada REGRAS_INTERVALO_S, então na prática o alerta
abre e fecha até esse tempo depois do que a simulação mostra.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class Trecho:
    """Leituras seguidas fora do limite numa célula."""

    id_celula: str
    inicio: datetime
    """ts_origem da primeira leitura fora do limite."""
    voltou_em: datetime | None
    """ts_origem da primeira leitura de volta ao limite. None: ainda está fora."""
    leituras: int
    pior: float
    """O valor mais longe do limite: o maior em "maior que", o menor em "menor que"."""


@dataclass(frozen=True)
class AlertaSimulado:
    id_celula: str
    abriria_em: datetime
    fecharia_em: datetime | None
    """None: ainda estaria aberto agora."""
    aberto_antes: bool
    """Já estaria aberto no início do período testado."""
    leituras_fora: int
    pior: float


def alertas_simulados(trechos: list[Trecho], por_minutos: int, inicio_periodo: datetime,
                      agora: datetime) -> list[AlertaSimulado]:
    """Os alertas que a regra teria aberto entre `inicio_periodo` e `agora`,
    ou que já estariam abertos no início dele. Em ordem de abertura."""
    espera = timedelta(minutes=por_minutos)
    alertas = []
    for t in trechos:
        abriria = t.inicio + espera
        if abriria > agora or (t.voltou_em is not None and t.voltou_em <= abriria):
            continue  # voltou ao limite (ou ainda não deu o tempo) antes de completar por_minutos
        if t.voltou_em is not None and t.voltou_em <= inicio_periodo:
            continue  # abriu e fechou antes do período testado
        alertas.append(AlertaSimulado(
            id_celula=t.id_celula, abriria_em=abriria, fecharia_em=t.voltou_em,
            aberto_antes=abriria < inicio_periodo, leituras_fora=t.leituras, pior=t.pior,
        ))
    return sorted(alertas, key=lambda a: (a.abriria_em, a.id_celula))
