"""Relatório de falhas: o que não depende do banco (o resto está na etapa 16
do ponta a ponta)."""

from datetime import datetime, timedelta, timezone

from app.relatorio.falhas import FalhaSimulada, anotar, instante, ler_simuladas, para_markdown, resumo_curto

AGORA = datetime(2026, 11, 11, 15, 0, tzinfo=timezone.utc)


def test_instante_aceita_periodo_relativo_e_data():
    assert instante("2h", AGORA) == AGORA - timedelta(hours=2)
    assert instante("30m", AGORA) == AGORA - timedelta(minutes=30)
    assert instante("1,5d", AGORA) == AGORA - timedelta(days=1.5)
    assert instante("2026-11-11T14:00:00+00:00") == datetime(2026, 11, 11, 14, 0, tzinfo=timezone.utc)
    assert instante("2026-11-11 14:00").tzinfo is not None  # sem fuso: hora local


def test_anotar_de_novo_substitui_e_so_entra_o_periodo(tmp_path):
    arquivo = tmp_path / "falhas-simuladas.jsonl"
    servidor = FalhaSimulada(acao="servidor", inicio=AGORA - timedelta(minutes=10), previsto_s=120)
    anotar(arquivo, servidor)
    servidor.fim = servidor.inicio + timedelta(seconds=120)
    anotar(arquivo, servidor)
    anotar(arquivo, FalhaSimulada(acao="rede", alvo="c02", inicio=AGORA - timedelta(days=2)))
    arquivo.write_text(arquivo.read_text(encoding="utf-8") + "linha estragada\n", encoding="utf-8")

    lidas = ler_simuladas(arquivo, AGORA - timedelta(hours=1), AGORA)
    assert [(f.acao, f.fim) for f in lidas] == [("servidor", servidor.fim)]
    assert ler_simuladas(tmp_path / "nao-existe.jsonl", AGORA - timedelta(hours=1), AGORA) == []


def _relatorio(buracos: list[dict]) -> dict:
    inicio = AGORA - timedelta(minutes=5)
    falha = {
        "acao": "servidor", "descricao": "Raspberry ↔ servidor: cabo cortado", "alvo": None,
        "inicio": inicio, "fim": inicio + timedelta(seconds=120), "duracao_s": 120.0, "previsto_s": 120,
        "em_andamento": False, "alerta_esperado": "broker_inacessivel", "celulas_alvo": [],
        "detectada": True, "deteccao_s": 70.0, "recuperada": True, "recuperacao_s": 10.0,
        "alertas": [], "alertas_indevidos": [], "leituras_durante": 18, "leituras_chegaram_depois": 18,
        "celulas_com_leitura": 3, "buracos": buracos,
        "resultado": "com problemas" if buracos else "ok",
        "problemas": [f"{sum(b['faltam'] for b in buracos)} leituras não chegaram"] if buracos else [],
    }
    faltam = sum(b["faltam"] for b in buracos)
    return {
        "origem": "simulador (CLI)", "gerado_em": AGORA, "desde": AGORA - timedelta(minutes=10), "ate": AGORA,
        "resumo": {"falhas_simuladas": 1, "falhas_ok": int(not buracos), "falhas_com_problemas": int(bool(buracos)),
                   "falhas_em_andamento": 0, "alertas_de_comunicacao": 1, "alertas_abertos": 0,
                   "outros_alertas": 0, "outros_alertas_abertos": 0, "atraso_considerado_s": 5,
                   "celulas": 1, "leituras": 30, "leituras_que_chegaram_atrasadas": 18,
                   "leituras_faltando": faltam, "dados_completos": faltam == 0},
        "falhas_simuladas": [falha],
        "alertas_de_comunicacao": [{"tipo": "broker_inacessivel", "celula": None, "aberto_em": inicio,
                                    "fechado_em": inicio + timedelta(seconds=130), "duracao_s": 60.0,
                                    "mensagem": "O servidor não alcança o broker."}],
        "outros_alertas": [],
        "integridade": [{"id_celula": "c01", "leituras": 30 - faltam, "primeiro_seq": 10, "ultimo_seq": 39,
                         "chegaram_depois": 18, "atrasadas": 18, "maior_atraso_s": 125.0, "faltam": faltam, "buracos": buracos,
                         "sem_comunicacao_agora": False}],
    }


def test_markdown_de_falha_recuperada_com_dados_completos():
    texto = para_markdown(_relatorio([]))
    assert "# Relatório de falhas de comunicação" in texto
    assert "### 1. servidor: Raspberry ↔ servidor: cabo cortado" in texto
    assert "| Detectada | sim, 1 min 10 s após o início |" in texto
    assert "alerta fechado 10 s depois que a comunicação voltou" in texto
    assert "| **Resultado** | OK |" in texto
    assert "**Dados completos:**" in texto
    assert "| sistema |" in texto
    assert resumo_curto(_relatorio([]))[-1] == "  dados completos"


def test_markdown_mostra_as_leituras_que_faltam():
    buracos = [{"id_celula": "c01", "de": 20, "ate": 22, "faltam": 3}]
    texto = para_markdown(_relatorio(buracos))
    assert "**Faltam 3 leituras**" in texto
    assert "**faltam 3** (seq 20–22)" in texto
    assert "**COM PROBLEMAS**" in texto
    assert "- 3 leituras não chegaram" in texto
