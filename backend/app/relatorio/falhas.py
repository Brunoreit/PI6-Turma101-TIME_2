"""Relatório de falhas de comunicação.

Lê do banco, para um período, os alertas que estiveram abertos e a
integridade das leituras, e salva o resultado em Markdown (para ler) e em
JSON (os mesmos dados, para guardar ou processar).

Falhas provocadas de propósito pelo simulador (CLI) ou pelo teste ponta a
ponta entram como "falhas simuladas": para cada uma, o relatório diz se o
alerta certo abriu e em quanto tempo, se fechou depois que a comunicação
voltou, se alguma célula foi culpada sem motivo e se alguma leitura medida
durante a falha se perdeu. A CLI anota as falhas em
relatorios/falhas-simuladas.jsonl, e este comando as encontra sozinho.

Uso:
  python -m app.relatorio.falhas                       últimas 24 horas
  python -m app.relatorio.falhas --desde 2h            últimas 2 horas (30m, 2h, 1d)
  python -m app.relatorio.falhas --desde "2026-11-11 14:00" --ate "2026-11-11 15:00"
  python -m app.relatorio.falhas --pasta relatorios --banco postgresql://...

Como o seq é contínuo por célula, um buraco no seq é uma leitura que não
chegou: perdida, ou ainda guardada numa célula que continua sem comunicação.
"""

import argparse
import json
import os
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app.banco import repositorios as repo

TIPOS_COMUNICACAO = ("sem_comunicacao", "broker_inacessivel", "consumidor_parado")
TIPOS_DO_SISTEMA = ("broker_inacessivel", "consumidor_parado")

# acao: (descrição, alerta esperado)
ACOES = {
    "rede": ("ESP ↔ Raspberry: Wi-Fi da célula cortado", "sem_comunicacao"),
    "servidor": ("Raspberry ↔ servidor: cabo cortado", "broker_inacessivel"),
    "broker": ("Broker (Raspberry Pi) parado", "broker_inacessivel"),
    "consumidor": ("Consumidor parado", "consumidor_parado"),
}

# Depois que a comunicação volta, quanto tempo ainda se olha para o banco:
# uma célula culpada por engano aparece logo depois da reconexão, e as
# leituras guardadas ainda estão chegando.
FOLGA = timedelta(seconds=60)
# O alerta esperado abre enquanto a falha dura; esta tolerância cobre a
# rodada das regras. Um alerta aberto depois é de outra falha.
TOLERANCIA_ABERTURA = timedelta(seconds=10)
# Leitura que levou mais que isto para chegar ao banco ficou guardada.
ATRASO_S = 5
# Células com leitura nos 5 minutos antes da falha contam como ligadas.
JANELA_ATIVAS = timedelta(minutes=5)

ARQUIVO_SIMULADAS = "falhas-simuladas.jsonl"


# ---------------------------------------------------------------- falhas simuladas


@dataclass
class FalhaSimulada:
    acao: str                      # rede, servidor, broker ou consumidor
    inicio: datetime
    fim: datetime | None = None    # None enquanto a comunicação não voltou
    alvo: str | None = None        # só na rede: a célula ou "todos"
    previsto_s: float | None = None
    id: str = field(default="")

    def __post_init__(self):
        if not self.id:
            self.id = f"{self.acao}-{self.alvo or 'sistema'}-{self.inicio.isoformat()}"

    def para_json(self) -> dict:
        return {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in asdict(self).items()}

    @classmethod
    def de_json(cls, d: dict) -> "FalhaSimulada":
        return cls(acao=d["acao"], inicio=datetime.fromisoformat(d["inicio"]),
                   fim=datetime.fromisoformat(d["fim"]) if d.get("fim") else None,
                   alvo=d.get("alvo"), previsto_s=d.get("previsto_s"), id=d["id"])


def anotar(caminho: Path, falha: FalhaSimulada) -> None:
    """Acrescenta a falha ao arquivo. Anotar de novo a mesma falha (com o
    fim, quando a comunicação volta) substitui a anotação anterior."""
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with open(caminho, "a", encoding="utf-8") as f:
        f.write(json.dumps(falha.para_json(), ensure_ascii=False) + "\n")


def ler_simuladas(caminho: Path, desde: datetime, ate: datetime) -> list[FalhaSimulada]:
    """Falhas anotadas que começaram no período, a última anotação de cada uma."""
    if not caminho.exists():
        return []
    por_id: dict[str, FalhaSimulada] = {}
    for linha in caminho.read_text(encoding="utf-8").splitlines():
        if linha.strip():
            try:
                falha = FalhaSimulada.de_json(json.loads(linha))
            except (ValueError, KeyError):
                continue
            por_id[falha.id] = falha
    return sorted((f for f in por_id.values() if desde <= f.inicio <= ate), key=lambda f: f.inicio)


# ---------------------------------------------------------------- montagem


def _segundos(depois: datetime | None, antes: datetime | None) -> float | None:
    return (depois - antes).total_seconds() if depois and antes else None


def _alerta(a: dict) -> dict:
    return {"tipo": a["tipo"], "celula": a["id_celula"], "aberto_em": a["aberto_em"],
            "fechado_em": a["fechado_em"], "duracao_s": _segundos(a["fechado_em"], a["aberto_em"]),
            "mensagem": a["mensagem"]}


def avaliar_simulada(conn: psycopg.Connection, falha: FalhaSimulada, agora: datetime,
                     proxima: datetime | None = None) -> dict:
    """proxima: início da falha simulada seguinte. Alerta aberto depois
    dele pode ser dela, então não conta para esta."""
    descricao, tipo = ACOES[falha.acao]
    em_andamento = falha.fim is None or falha.fim > agora
    fim = agora if em_andamento else falha.fim
    depois = min(fim + FOLGA, agora)
    limite = min(depois, proxima) if proxima else depois
    durante = [a for a in repo.alertas_no_periodo(conn, falha.inicio, depois)
               if falha.inicio <= a["aberto_em"] <= limite]
    na_falha = [a for a in durante if a["aberto_em"] <= fim + TOLERANCIA_ABERTURA]

    if falha.acao == "rede":
        if falha.alvo in (None, "todos"):
            ativas = repo.leituras_por_celula(conn, falha.inicio - JANELA_ATIVAS, falha.inicio)
            alvos = [l["id_celula"] for l in ativas]
        else:
            alvos = [falha.alvo]
        esperados = [a for a in na_falha if a["tipo"] == tipo and a["id_celula"] in alvos]
        # Célula fora do ar não é culpa do servidor.
        indevidos = [a for a in na_falha if a["tipo"] in TIPOS_DO_SISTEMA]
        detectada = bool(alvos) and {a["id_celula"] for a in esperados} == set(alvos)
        celulas = alvos
    else:
        alvos = []
        esperados = [a for a in na_falha if a["tipo"] == tipo and a["id_celula"] is None]
        # Servidor sem receber não é culpa das células.
        indevidos = [a for a in durante if a["tipo"] == "sem_comunicacao"]
        detectada = bool(esperados)
        celulas = None

    recuperada = detectada and not em_andamento and all(a["fechado_em"] for a in esperados)
    leituras = repo.leituras_por_celula(conn, falha.inicio, fim, celulas)
    buracos = repo.buracos_de_seq(conn, falha.inicio - FOLGA, depois, celulas)

    problemas = []
    if not detectada and not em_andamento:
        faltou = sorted(set(alvos) - {a["id_celula"] for a in esperados})
        problemas.append(f"o alerta {tipo} não abriu" + (f" em {', '.join(faltou)}" if faltou else "")
                         + f" (a falha durou {_duracao(_segundos(fim, falha.inicio))}; uma queda mais curta "
                         "que o tempo de detecção não abre alerta)")
    elif not em_andamento and not recuperada:
        problemas.append(f"o alerta {tipo} continua aberto depois que a comunicação voltou")
    if indevidos:
        problemas.append("alertas indevidos: " + ", ".join(
            f"{a['tipo']} em {a['id_celula'] or 'sistema'}" for a in indevidos))
    if buracos:
        problemas.append(f"{sum(b['faltam'] for b in buracos)} leituras não chegaram")

    return {
        "acao": falha.acao, "descricao": descricao, "alvo": falha.alvo,
        "inicio": falha.inicio, "fim": falha.fim, "duracao_s": _segundos(fim, falha.inicio),
        "previsto_s": falha.previsto_s, "em_andamento": em_andamento,
        "alerta_esperado": tipo, "celulas_alvo": alvos,
        "detectada": detectada,
        "deteccao_s": _segundos(min((a["aberto_em"] for a in esperados), default=None), falha.inicio),
        "recuperada": recuperada,
        "recuperacao_s": _segundos(max((a["fechado_em"] for a in esperados), default=None), falha.fim)
                         if recuperada else None,
        "alertas": [_alerta(a) for a in esperados],
        "alertas_indevidos": [_alerta(a) for a in indevidos],
        "leituras_durante": sum(l["leituras"] for l in leituras),
        "leituras_chegaram_depois": sum(l["chegaram_depois"] for l in leituras),
        "celulas_com_leitura": len(leituras),
        "buracos": buracos,
        "resultado": "em andamento" if em_andamento else ("ok" if not problemas else "com problemas"),
        "problemas": problemas,
    }


def montar(conn: psycopg.Connection, desde: datetime, ate: datetime | None = None,
           simuladas: list[FalhaSimulada] | None = None, origem: str = "período") -> dict:
    """Junta tudo o que o relatório mostra. Não grava nada no banco."""
    agora = repo.agora_no_banco(conn)
    ate = min(ate or agora, agora)
    alertas = repo.alertas_no_periodo(conn, desde, ate)
    leituras = repo.leituras_por_celula(conn, desde, ate, atraso_s=ATRASO_S)
    buracos = repo.buracos_de_seq(conn, desde, ate)
    sem_comunicacao_agora = {a["id_celula"] for a in alertas
                             if a["tipo"] == "sem_comunicacao" and a["fechado_em"] is None}
    ordem = sorted(simuladas or [], key=lambda f: f.inicio)
    falhas = [avaliar_simulada(conn, f, agora, ordem[i + 1].inicio if i + 1 < len(ordem) else None)
              for i, f in enumerate(ordem)]

    celulas = []
    for l in leituras:
        dela = [b for b in buracos if b["id_celula"] == l["id_celula"]]
        celulas.append({**l, "faltam": sum(b["faltam"] for b in dela), "buracos": dela,
                        "sem_comunicacao_agora": l["id_celula"] in sem_comunicacao_agora})

    comunicacao = [_alerta(a) for a in alertas if a["tipo"] in TIPOS_COMUNICACAO]
    outros = [_alerta(a) for a in alertas if a["tipo"] not in TIPOS_COMUNICACAO]
    faltam = sum(c["faltam"] for c in celulas)
    return {
        "origem": origem,
        "gerado_em": agora,
        "desde": desde,
        "ate": ate,
        "resumo": {
            "falhas_simuladas": len(falhas),
            "falhas_ok": sum(f["resultado"] == "ok" for f in falhas),
            "falhas_com_problemas": sum(f["resultado"] == "com problemas" for f in falhas),
            "falhas_em_andamento": sum(f["resultado"] == "em andamento" for f in falhas),
            "alertas_de_comunicacao": len(comunicacao),
            "alertas_abertos": sum(a["fechado_em"] is None for a in comunicacao),
            "outros_alertas": len(outros),
            "outros_alertas_abertos": sum(a["fechado_em"] is None for a in outros),
            "celulas": len(celulas),
            "leituras": sum(c["leituras"] for c in celulas),
            "leituras_que_chegaram_atrasadas": sum(c["atrasadas"] for c in celulas),
            "atraso_considerado_s": ATRASO_S,
            "leituras_faltando": faltam,
            "dados_completos": faltam == 0,
        },
        "falhas_simuladas": falhas,
        "alertas_de_comunicacao": comunicacao,
        "outros_alertas": outros,
        "integridade": celulas,
    }


# ---------------------------------------------------------------- texto


def _hora(dt: datetime | None, data: bool = False) -> str:
    if dt is None:
        return "—"
    return dt.astimezone().strftime("%d/%m/%Y %H:%M:%S" if data else "%H:%M:%S")


def _duracao(s: float | None) -> str:
    if s is None:
        return "—"
    s = round(s)
    if s < 60:
        return f"{s} s"
    m, s = divmod(s, 60)
    if m < 60:
        return f"{m} min {s:02d} s"
    h, m = divmod(m, 60)
    return f"{h} h {m:02d} min"


def _onde(celula: str | None) -> str:
    return celula or "sistema"


def _seqs(buracos: list[dict]) -> str:
    return ", ".join(f"{b['de']}" if b["de"] == b["ate"] else f"{b['de']}–{b['ate']}" for b in buracos)


def para_markdown(r: dict) -> str:
    res = r["resumo"]
    linhas = [
        "# Relatório de falhas de comunicação",
        "",
        f"Gerado em {_hora(r['gerado_em'], True)} · origem: {r['origem']}  ",
        f"Período: {_hora(r['desde'], True)} a {_hora(r['ate'], True)} "
        f"({_duracao(_segundos(r['ate'], r['desde']))})",
        "",
        "## Resumo",
        "",
    ]
    if res["falhas_simuladas"]:
        partes = [f"{res['falhas_ok']} ok"]
        if res["falhas_com_problemas"]:
            partes.append(f"**{res['falhas_com_problemas']} com problemas**")
        if res["falhas_em_andamento"]:
            partes.append(f"{res['falhas_em_andamento']} em andamento")
        linhas.append(f"- Falhas simuladas: {res['falhas_simuladas']} ({', '.join(partes)})")
    linhas += [
        f"- Alertas de comunicação no período: {res['alertas_de_comunicacao']}"
        + (f" ({res['alertas_abertos']} ainda abertos)" if res["alertas_abertos"] else ""),
        f"- Leituras medidas no período: {res['leituras']} em {res['celulas']} células; "
        f"{res['leituras_que_chegaram_atrasadas']} chegaram com mais de {res['atraso_considerado_s']} s "
        "de atraso (ficaram guardadas durante uma falha)",
    ]
    if res["outros_alertas"]:
        linhas.append(f"- Outros alertas no período: {res['outros_alertas']}"
                      + (f" ({res['outros_alertas_abertos']} ainda abertos)" if res["outros_alertas_abertos"] else ""))
    if res["dados_completos"]:
        linhas.append("- **Dados completos:** nenhum seq faltando, nenhuma leitura perdida.")
    else:
        linhas.append(f"- **Faltam {res['leituras_faltando']} leituras** (detalhes em Integridade dos dados).")

    if r["falhas_simuladas"]:
        linhas += ["", "## Falhas simuladas"]
        for i, f in enumerate(r["falhas_simuladas"], 1):
            alvo = f" ({f['alvo']})" if f["alvo"] else ""
            if f["em_andamento"]:
                fim = "em andamento"
            else:
                fim = f"{_hora(f['fim'])} ({_duracao(f['duracao_s'])})"
            if f["detectada"]:
                deteccao = f"sim, {_duracao(f['deteccao_s'])} após o início"
                if len(f["celulas_alvo"]) > 1:
                    deteccao += f" ({len(f['alertas'])} células)"
            else:
                deteccao = "**não**"
            if f["recuperada"]:
                recuperacao = f"alerta fechado {_duracao(f['recuperacao_s'])} depois que a comunicação voltou"
            elif f["em_andamento"]:
                recuperacao = "aguardando a comunicação voltar"
            elif f["detectada"]:
                recuperacao = "**alerta ainda aberto**"
            else:
                recuperacao = "—"
            indevidos = ", ".join(f"{a['tipo']} em {_onde(a['celula'])}" for a in f["alertas_indevidos"])
            if f["buracos"]:
                dados = f"**faltam {sum(b['faltam'] for b in f['buracos'])}**: " + "; ".join(
                    f"{c} seq {_seqs([b for b in f['buracos'] if b['id_celula'] == c])}"
                    for c in sorted({b["id_celula"] for b in f["buracos"]}))
            else:
                dados = "completos"
            resultado = {"ok": "OK", "em andamento": "em andamento"}.get(f["resultado"], "**COM PROBLEMAS**")
            linhas += [
                "",
                f"### {i}. {f['acao']}{alvo}: {f['descricao']}",
                "",
                "| | |",
                "|---|---|",
                f"| Início | {_hora(f['inicio'], True)} |",
                f"| Fim | {fim} |",
                f"| Alerta esperado | `{f['alerta_esperado']}` em "
                f"{', '.join(f['celulas_alvo']) if f['celulas_alvo'] else 'sistema'} |",
                f"| Detectada | {deteccao} |",
                f"| Recuperação | {recuperacao} |",
                f"| Alertas indevidos | {indevidos or 'nenhum'} |",
                f"| Leituras medidas durante a falha | {f['leituras_durante']} "
                f"({f['leituras_chegaram_depois']} guardadas e entregues depois que voltou) |",
                f"| Dados | {dados} |",
                f"| **Resultado** | {resultado} |",
            ]
            if f["problemas"]:
                linhas += ["", *(f"- {p}" for p in f["problemas"])]

    linhas += ["", "## Alertas de comunicação", ""]
    if r["alertas_de_comunicacao"]:
        linhas += ["| Tipo | Onde | Abriu | Fechou | Duração | Mensagem |", "|---|---|---|---|---|---|"]
        linhas += [f"| `{a['tipo']}` | {_onde(a['celula'])} | {_hora(a['aberto_em'], True)} | "
                   f"{_hora(a['fechado_em']) if a['fechado_em'] else '**aberto**'} | {_duracao(a['duracao_s'])} | "
                   f"{a['mensagem'].replace('|', '/')} |" for a in r["alertas_de_comunicacao"]]
    else:
        linhas.append("Nenhum alerta de comunicação no período.")

    if r["outros_alertas"]:
        linhas += ["", "## Outros alertas", "", "| Tipo | Onde | Abriu | Fechou |", "|---|---|---|---|"]
        linhas += [f"| `{a['tipo']}` | {_onde(a['celula'])} | {_hora(a['aberto_em'], True)} | "
                   f"{_hora(a['fechado_em']) if a['fechado_em'] else '**aberto**'} |" for a in r["outros_alertas"]]

    linhas += ["", "## Integridade dos dados", ""]
    if r["integridade"]:
        linhas += ["Leituras medidas no período, pelo horário da célula. O seq é contínuo: "
                   "um intervalo faltando é uma leitura que não chegou.", "",
                   "| Célula | Leituras | Seq | Chegaram atrasadas | Maior atraso | Situação |",
                   "|---|---|---|---|---|---|"]
        for c in r["integridade"]:
            if c["faltam"]:
                situacao = f"**faltam {c['faltam']}** (seq {_seqs(c['buracos'])})"
                if c["sem_comunicacao_agora"]:
                    situacao += "; sem comunicação agora, podem estar guardadas na célula"
            else:
                situacao = "completo"
            linhas.append(f"| {c['id_celula']} | {c['leituras']} | {c['primeiro_seq']}–{c['ultimo_seq']} | "
                          f"{c['atrasadas']} | {_duracao(c['maior_atraso_s'])} | {situacao} |")
    else:
        linhas.append("Nenhuma leitura no período.")
    return "\n".join(linhas) + "\n"


def _json(valor):
    if isinstance(valor, datetime):
        return valor.isoformat()
    raise TypeError(type(valor).__name__)


def salvar(relatorio: dict, pasta: Path) -> tuple[Path, Path]:
    """Grava falhas-AAAAMMDD-HHMMSS.md e .json na pasta e devolve os dois caminhos."""
    pasta.mkdir(parents=True, exist_ok=True)
    nome = "falhas-" + relatorio["gerado_em"].astimezone().strftime("%Y%m%d-%H%M%S")
    md, js = pasta / f"{nome}.md", pasta / f"{nome}.json"
    md.write_text(para_markdown(relatorio), encoding="utf-8")
    js.write_text(json.dumps(relatorio, default=_json, ensure_ascii=False, indent=2), encoding="utf-8")
    return md, js


def gerar(url_banco: str, desde: datetime, ate: datetime | None, pasta: Path,
          simuladas: list[FalhaSimulada] | None = None, origem: str = "período") -> tuple[dict, Path, Path]:
    """Monta e salva. Sem simuladas, usa as anotadas em pasta/falhas-simuladas.jsonl."""
    with psycopg.connect(url_banco, autocommit=True, row_factory=dict_row) as conn:
        if simuladas is None:
            simuladas = ler_simuladas(pasta / ARQUIVO_SIMULADAS, desde, ate or datetime.now(timezone.utc))
        relatorio = montar(conn, desde, ate, simuladas, origem)
    md, js = salvar(relatorio, pasta)
    return relatorio, md, js


def resumo_curto(r: dict) -> list[str]:
    """Linhas para mostrar no terminal."""
    res = r["resumo"]
    linhas = []
    for f in r["falhas_simuladas"]:
        alvo = f" {f['alvo']}" if f["alvo"] else ""
        texto = {"ok": "ok", "em andamento": "em andamento"}.get(f["resultado"], "COM PROBLEMAS")
        detalhe = f"; {'; '.join(f['problemas'])}" if f["problemas"] else ""
        linhas.append(f"  {f['acao']}{alvo} às {_hora(f['inicio'])}: {texto}{detalhe}")
    linhas.append(f"  {res['alertas_de_comunicacao']} alertas de comunicação"
                  + (f", {res['alertas_abertos']} ainda abertos" if res["alertas_abertos"] else ""))
    linhas.append("  dados completos" if res["dados_completos"]
                  else f"  FALTAM {res['leituras_faltando']} leituras")
    return linhas


# ---------------------------------------------------------------- linha de comando


def instante(texto: str, agora: datetime | None = None) -> datetime:
    """'30m', '2h', '1d' (antes de agora) ou uma data ISO ('2026-11-11 14:00').
    Data sem fuso é a hora local desta máquina."""
    agora = agora or datetime.now(timezone.utc)
    m = re.fullmatch(r"\s*(\d+(?:[.,]\d+)?)\s*([smhd])\s*", texto.lower())
    if m:
        n = float(m.group(1).replace(",", "."))
        return agora - timedelta(**{{"s": "seconds", "m": "minutes", "h": "hours", "d": "days"}[m.group(2)]: n})
    dt = datetime.fromisoformat(texto.strip())
    return dt if dt.tzinfo else dt.astimezone()


def main() -> None:
    parser = argparse.ArgumentParser(description="Relatório de falhas de comunicação (Markdown e JSON).")
    parser.add_argument("--desde", default="24h", help="início: 30m, 2h, 1d ou data ISO (padrão 24h)")
    parser.add_argument("--ate", help="fim: data ISO (padrão agora)")
    parser.add_argument("--pasta", default="relatorios", help="onde salvar (padrão ./relatorios)")
    parser.add_argument("--banco", default=os.environ.get(
        "DATABASE_URL", "postgresql://evolver:evolver@localhost:5432/evolver"), help="URL do PostgreSQL")
    args = parser.parse_args()
    try:
        desde = instante(args.desde)
        ate = instante(args.ate) if args.ate else None
    except ValueError:
        sys.exit("Data inválida. Use 30m, 2h, 1d ou uma data como '2026-11-11 14:00'.")
    try:
        relatorio, md, js = gerar(args.banco, desde, ate, Path(args.pasta))
    except psycopg.OperationalError as erro:
        sys.exit(f"Não consegui abrir o banco ({erro.__class__.__name__}). "
                 "Confira se o PostgreSQL está no ar e a URL em --banco ou DATABASE_URL.")
    print("\n".join(resumo_curto(relatorio)))
    print(f"Relatório salvo em {md}\n                  {js}")


if __name__ == "__main__":
    main()
