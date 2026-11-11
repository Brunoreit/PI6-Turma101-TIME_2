"""API HTTP usada pela interface web.

A interface nunca acessa o banco nem o broker direto: tudo passa por aqui,
para que validação do setpoint e registro de quem pediu fiquem num lugar só.

Login por e-mail e senha (rotas /auth). Todas as outras rotas exigem login,
menos /saude, que o healthcheck do Docker usa. O setpoint e a calibração
gravam quem fez o pedido.

Executar: uvicorn app.api.main:app --host 0.0.0.0 --port 8000
Documentação interativa em http://localhost:8000/docs
"""

import csv
import io
import logging
import math
import secrets
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from typing import Annotated, Literal

import paho.mqtt.client as mqtt
import psycopg
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api import autenticacao
from app.api.esquemas import (AlteracaoCelula, AlteracaoCultivo, AlteracaoExperimento, Cadastro, Entrada,
                              Motivo, MotivoOpcional, NovaCalibracao, NovoAcesso, NovoCultivo,
                              NovoExperimento, NovoSetpoint, PontoCalibracao)
from app.banco import repositorios as repo
from app.calibracao import ajuste
from app.banco.conexao import criar_pool
from app.config import config
from contrato import PedidoSetpoint, topicos

log = logging.getLogger("api")
estado: dict = {}


@asynccontextmanager
async def ciclo_de_vida(_app: FastAPI):
    if not config.segredo_sessao:
        raise RuntimeError(
            "SEGREDO_SESSAO não definido: a API precisa dele para assinar os tokens de sessão. "
            "Defina a variável com um valor aleatório, por exemplo a saída de "
            "python -c \"import secrets; print(secrets.token_urlsafe(32))\"."
        )
    estado["pool"] = criar_pool()
    cliente = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2, client_id=f"evolver-api-{secrets.token_hex(3)}"
    )
    cliente.reconnect_delay_set(min_delay=1, max_delay=5)
    cliente.connect_async(config.mqtt_host, config.mqtt_port, keepalive=30)
    cliente.loop_start()
    estado["mqtt"] = cliente
    yield
    cliente.loop_stop()
    estado["pool"].close()


app = FastAPI(title="T.U.P.A · Monitoramento", version="0.1.0", lifespan=ciclo_de_vida)


def _conexao():
    with estado["pool"].connection() as conn:
        yield conn


Conexao = Annotated[psycopg.Connection, Depends(_conexao)]

_bearer = HTTPBearer(auto_error=False, description="Token devolvido por /auth/cadastro ou /auth/entrar")


def _nao_autenticado(detalhe: str) -> HTTPException:
    return HTTPException(401, detalhe, headers={"WWW-Authenticate": "Bearer"})


def _pessoa_opcional(
    conn: Conexao, request: Request,
    credenciais: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict | None:
    """A pessoa do token, ou None sem token. Token presente e inválido dá 401."""
    if credenciais is None:
        if "authorization" in request.headers:
            raise _nao_autenticado("Cabeçalho Authorization em formato inválido. Envie Authorization: Bearer <token>.")
        return None
    id_pessoa = autenticacao.ler_token(credenciais.credentials, config.segredo_sessao)
    pessoa = repo.buscar_pessoa(conn, id_pessoa) if id_pessoa is not None else None
    if pessoa is None:
        raise _nao_autenticado("Sessão inválida ou expirada. Entre de novo com e-mail e senha para receber outro token.")
    return pessoa


PessoaOpcional = Annotated[dict | None, Depends(_pessoa_opcional)]


def _pessoa_logada(pessoa: PessoaOpcional) -> dict:
    if pessoa is None:
        raise _nao_autenticado("Esta rota exige login. Entre com e-mail e senha e envie o token em Authorization: Bearer <token>.")
    return pessoa


PessoaLogada = Annotated[dict, Depends(_pessoa_logada)]


def _exigir_celula(conn: psycopg.Connection, id_celula: str) -> None:
    if not repo.celula_existe(conn, id_celula):
        raise HTTPException(404, f"Célula {id_celula} não encontrada.")


def _conferir_temperatura(temperatura_c: float) -> None:
    if not config.temperatura_min_c <= temperatura_c <= config.temperatura_max_c:
        raise HTTPException(
            422, f"A temperatura deve ficar entre {config.temperatura_min_c:.0f} "
                 f"e {config.temperatura_max_c:.0f} °C.",
        )


@app.get("/saude")
def saude():
    """Aberta, sem login: se o banco e o broker respondem à API e o sinal de
    vida do consumidor e das regras (None se nunca gravaram ou se o banco
    não responde). Não traz dado de célula nem de pessoa."""
    processos: dict[str, dict] = {}
    try:
        with estado["pool"].connection(timeout=2) as conn:
            processos = {p["nome"]: p for p in repo.listar_processos(conn)}
        banco = True
    except Exception:
        banco = False

    def resumo(nome: str, limite_s: float) -> dict | None:
        p = processos.get(nome)
        if p is None:
            return None
        return {"ativo": p["segundos_sem_sinal"] <= limite_s, "ultimo_sinal": p["ultimo_sinal"],
                "iniciado_em": p["iniciado_em"],
                **({"broker_conectado": p["broker_conectado"], "broker_desde": p["broker_desde"]}
                   if nome == "consumidor" else {})}

    return {
        "banco": banco,
        "broker": estado["mqtt"].is_connected(),
        "consumidor": resumo("consumidor", config.sinal_vida_limite_s),
        # As regras gravam uma vez por rodada.
        "regras": resumo("regras", max(config.sinal_vida_limite_s, 3 * config.regras_intervalo_s)),
    }


def _sessao(pessoa: dict) -> dict:
    token = autenticacao.emitir_token(pessoa["id_pessoa"], config.segredo_sessao, config.sessao_horas)
    return {"token": token, "pessoa": pessoa}


@app.post("/auth/cadastro", status_code=201)
def cadastrar(conn: Conexao, corpo: Cadastro):
    try:
        pessoa = repo.criar_pessoa(conn, corpo.nome, corpo.email, autenticacao.resumir_senha(corpo.senha))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, "Já existe uma conta com este e-mail. Entre com ela ou use outro e-mail.") from None
    except psycopg.errors.CheckViolation:
        raise HTTPException(422, "Informe um e-mail no formato nome@instituicao.br.") from None
    return _sessao(pessoa)


@app.post("/auth/entrar")
def entrar(conn: Conexao, corpo: Entrada):
    pessoa = repo.buscar_pessoa_por_email(conn, corpo.email)
    resumo = pessoa.pop("senha_hash") if pessoa is not None else None
    # Mesma resposta para e-mail inexistente e senha errada.
    if resumo is None or not autenticacao.conferir_senha(corpo.senha, resumo):
        raise HTTPException(401, "E-mail ou senha incorretos.")
    return _sessao(pessoa)


@app.get("/auth/eu")
def eu(pessoa: PessoaLogada):
    return pessoa


@app.get("/celulas")
def listar_celulas(conn: Conexao, _pessoa: PessoaLogada):
    return repo.listar_celulas(conn)


@app.patch("/celulas/{id_celula}")
def alterar_celula(conn: Conexao, _pessoa: PessoaLogada, id_celula: str, corpo: AlteracaoCelula):
    try:
        celula = repo.atualizar_celula(conn, id_celula, **corpo.model_dump(exclude_unset=True))
    except psycopg.errors.UniqueViolation:
        raise HTTPException(409, f"Já existe uma célula com o apelido {corpo.apelido}. Escolha outro apelido.") from None
    if celula is None:
        raise HTTPException(404, f"Célula {id_celula} não encontrada.")
    return celula


@app.get("/celulas/{id_celula}/leituras")
def listar_leituras(conn: Conexao, _pessoa: PessoaLogada, id_celula: str, desde: datetime | None = None,
                    limite: int = Query(1000, ge=1, le=10000)):
    _exigir_celula(conn, id_celula)
    return repo.listar_leituras(conn, id_celula, desde, limite)


def _celula_csv(valor) -> str:
    """Formata um valor como o Excel em português lê: vírgula decimal e data
    sem fuso nem microssegundos (todas em UTC)."""
    if valor is None:
        return ""
    if isinstance(valor, datetime):
        return valor.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(valor, float):
        return repr(valor).replace(".", ",")
    return str(valor)


@app.get("/celulas/{id_celula}/leituras.csv")
def exportar_leituras(conn: Conexao, _pessoa: PessoaLogada, id_celula: str):
    _exigir_celula(conn, id_celula)

    # O streaming continua depois que a requisição devolve a conexão dela,
    # por isso pega outra do pool só para isso.
    def linhas():
        with estado["pool"].connection() as conn:
            buffer = io.StringIO()
            # BOM para o Excel reconhecer UTF-8; ";" porque é o separador que o
            # Excel em português espera (a vírgula é o separador decimal).
            buffer.write("﻿")
            escritor = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
            escritor.writerow(["seq", "ts_origem_utc", "ts_recebido_utc", "temperatura_c",
                               "od_bruto", "od", "ph", "id_calibracao"])
            for linha in repo.iterar_leituras(conn, id_celula):
                escritor.writerow(_celula_csv(v) for v in linha.values())
                if buffer.tell() > 64_000:
                    yield buffer.getvalue()
                    buffer.seek(0)
                    buffer.truncate()
            yield buffer.getvalue()

    return StreamingResponse(
        linhas(), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{id_celula}.csv"'},
    )


@app.post("/celulas/{id_celula}/setpoint", status_code=202)
def pedir_setpoint(conn: Conexao, pessoa: PessoaLogada, id_celula: str, corpo: NovoSetpoint):
    _exigir_celula(conn, id_celula)
    _conferir_temperatura(corpo.temperatura_c)
    if not estado["mqtt"].is_connected():
        # Não publica: o paho guardaria a mensagem e a enviaria depois,
        # e um pedido recusado aqui seria aplicado lá na célula.
        raise HTTPException(503, "Broker indisponível. Tente de novo em alguns segundos.")
    # Quem pediu é sempre a pessoa do token.
    pedido, _ = _enviar_setpoint(conn, id_celula, corpo.temperatura_c, pessoa["nome"], pessoa["id_pessoa"])
    return pedido


def _enviar_setpoint(conn: psycopg.Connection, id_celula: str, temperatura_c: float,
                     solicitado_por: str, id_pessoa: int | None) -> tuple[dict, bool]:
    """Grava o pedido e o publica, esperando até 5 s a confirmação do
    broker. Devolve o pedido e se o broker confirmou. Quem chama já
    conferiu a temperatura e a conexão com o broker."""
    id_pedido = f"sp-{secrets.token_hex(4)}"
    pedido = repo.criar_pedido(conn, id_pedido, id_celula, temperatura_c, solicitado_por, id_pessoa=id_pessoa)

    # Retida: se a célula estiver offline, recebe o pedido assim que voltar.
    mensagem = PedidoSetpoint(id=id_pedido, temperatura_c=temperatura_c)
    info = estado["mqtt"].publish(topicos.setpoint(id_celula), mensagem.para_json(),
                                  qos=topicos.QOS, retain=True)
    try:
        info.wait_for_publish(timeout=5)
    except RuntimeError:
        pass
    confirmado = info.is_published()
    if not confirmado:
        log.warning("pedido %s sem confirmação do broker em 5 s, segue como solicitado", id_pedido)
    return pedido, confirmado


@app.get("/celulas/{id_celula}/setpoints")
def listar_setpoints(conn: Conexao, _pessoa: PessoaLogada, id_celula: str):
    _exigir_celula(conn, id_celula)
    return repo.listar_pedidos(conn, id_celula)


@app.get("/setpoints/{id_pedido}")
def buscar_setpoint(conn: Conexao, _pessoa: PessoaLogada, id_pedido: str):
    pedido = repo.buscar_pedido(conn, id_pedido)
    if pedido is None:
        raise HTTPException(404, f"Pedido {id_pedido} não encontrado.")
    return pedido


@app.get("/celulas/{id_celula}/od-ao-vivo")
def od_ao_vivo(conn: Conexao, _pessoa: PessoaLogada, id_celula: str):
    """Sensor de OD agora, para a nova calibração. `janela` resume as últimas
    CALIBRACAO_N_LEITURAS leituras; o bruto de um padrão gravado ao vivo é a
    média delas, e só pode ser gravado com `estavel`. `recentes` traz até 8
    leituras (ou N, se for maior) para o gráfico."""
    _exigir_celula(conn, id_celula)
    n = config.calibracao_n_leituras
    recentes = repo.ultimas_leituras_od(conn, id_celula, max(n, 8))
    janela = recentes[-n:]
    resumo = ajuste.resumir([l["od_bruto"] for l in janela]) if janela else None
    intervalo = None
    if len(janela) >= 2:
        intervalo = (janela[-1]["ts_origem"] - janela[0]["ts_origem"]).total_seconds() / (len(janela) - 1)
    return {
        "id_celula": id_celula,
        "ultima": recentes[-1] if recentes else None,
        "recentes": recentes,
        "variacao_max": config.calibracao_variacao_max,
        "janela": {
            "n_esperado": n,
            "n_leituras": len(janela),
            "faltam": n - len(janela),
            "seq_inicio": janela[0]["seq"] if janela else None,
            "seq_fim": janela[-1]["seq"] if janela else None,
            "media": resumo.media if resumo else None,
            "minimo": resumo.minimo if resumo else None,
            "maximo": resumo.maximo if resumo else None,
            # Média zero dá variação infinita, que o JSON não representa.
            "variacao": resumo.variacao if resumo and math.isfinite(resumo.variacao) else None,
            "desvio": resumo.desvio if resumo else None,
            "estavel": ajuste.estavel(resumo, n, config.calibracao_variacao_max),
            "intervalo_medio_s": intervalo,
        },
    }


@app.get("/celulas/{id_celula}/calibracoes")
def listar_calibracoes(conn: Conexao, _pessoa: PessoaLogada, id_celula: str):
    """Versões da curva de OD, da mais nova para a mais antiga. Nas versões
    com branco, `b` já tem o branco embutido (b − a·branco); o branco está
    em `pontos`, no ponto de rótulo "branco"."""
    _exigir_celula(conn, id_celula)
    return repo.listar_calibracoes(conn, id_celula)


def _porcento(fracao: float) -> str:
    """0.0153 vira "1,5%"; 0.01 vira "1%"."""
    return f"{fracao * 100:.1f}".replace(".0", "").replace(".", ",") + "%"


def _calibracao_por_pontos(conn: psycopg.Connection, id_celula: str,
                           pontos: list[PontoCalibracao]) -> tuple[ajuste.AjusteComBranco, list[dict]]:
    """Confere os pontos, recalcula pelas leituras os que vieram ao vivo e
    ajusta a reta só com os padrões. Qualquer problema dá 422 dizendo o quê."""
    sem_rotulo = [i + 1 for i, p in enumerate(pontos) if p.rotulo is None]
    if sem_rotulo:
        raise HTTPException(422, f"Os pontos {', '.join(map(str, sem_rotulo))} estão sem rotulo. "
                                 'Use "branco" para o branco e um nome para cada padrão, como "P1".')
    sem_origem = [p.rotulo for p in pontos if p.origem is None]
    if sem_origem:
        raise HTTPException(422, f"Falta a origem (leitura ou digitado) em: {', '.join(sem_origem)}.")
    rotulos = [p.rotulo.casefold() for p in pontos]
    repetidos = sorted({p.rotulo for p in pontos if rotulos.count(p.rotulo.casefold()) > 1})
    if repetidos:
        raise HTTPException(422, f"Há mais de um ponto com o rótulo {', '.join(repetidos)}. Cada ponto precisa de um rótulo só dele.")
    brancos = [p for p in pontos if p.rotulo.casefold() == "branco"]
    padroes = [p for p in pontos if p.rotulo.casefold() != "branco"]
    if not brancos:
        raise HTTPException(422, 'Falta o branco. Grave a leitura do frasco só com meio de cultura num ponto de rótulo "branco".')
    sem_referencia = [p.rotulo for p in padroes if p.od_referencia is None]
    if sem_referencia:
        raise HTTPException(422, f"Falta a OD de referência em: {', '.join(sem_referencia)}. "
                                 "Informe a OD medida no espectrofotômetro de cada padrão.")
    if len(padroes) < ajuste.MINIMO_DE_PADROES:
        faltam = ajuste.MINIMO_DE_PADROES - len(padroes)
        raise HTTPException(422, f"A calibração precisa do branco e de pelo menos {ajuste.MINIMO_DE_PADROES} padrões. "
                                 f"{'Falta 1 padrão' if faltam == 1 else f'Faltam {faltam} padrões'}.")

    agora = datetime.now(timezone.utc)
    gravados = []
    for p in [brancos[0], *padroes]:
        ponto = {"rotulo": "branco" if p is brancos[0] else p.rotulo,
                 "od_referencia": None if p is brancos[0] else p.od_referencia,
                 "bruto": p.bruto, "origem": p.origem}
        if p.origem == "leitura":
            # Vale o que está no banco, não a média que veio do navegador.
            valores = repo.od_bruto_no_intervalo(conn, id_celula, p.seq_inicio, p.seq_fim)
            if len(valores) != p.n_leituras:
                raise HTTPException(
                    422, f"O {ponto['rotulo']} aponta para as leituras seq {p.seq_inicio} a {p.seq_fim}, mas a "
                         f"{id_celula} tem {len(valores)} leituras de OD nesse intervalo, não {p.n_leituras}. "
                         "Grave o ponto de novo pela leitura ao vivo ou digite o valor.")
            resumo = ajuste.resumir(valores)
            if not resumo.variacao < config.calibracao_variacao_max:
                # As mesmas leituras dão a mesma variação: o que a tela viu
                # como estável continua estável aqui.
                raise HTTPException(
                    422, f"As leituras seq {p.seq_inicio} a {p.seq_fim} do {ponto['rotulo']} variam "
                         f"{_porcento(resumo.variacao)} entre o mínimo e o máximo, mais que o limite de "
                         f"{_porcento(config.calibracao_variacao_max)}. Espere a leitura estabilizar e grave de novo, "
                         "ou digite o valor.")
            ponto.update(bruto=round(resumo.media, 2), seq_inicio=p.seq_inicio, seq_fim=p.seq_fim,
                         n_leituras=p.n_leituras, desvio=round(resumo.desvio, 2))
        elif p.desvio is not None:
            ponto["desvio"] = p.desvio
        ponto["gravado_em"] = (p.gravado_em or agora).isoformat()
        gravados.append(ponto)

    branco = gravados[0]["bruto"]
    try:
        resultado = ajuste.ajustar_com_branco(branco, [(g["bruto"], g["od_referencia"]) for g in gravados[1:]])
    except ajuste.CalibracaoInvalida as erro:
        raise HTTPException(422, str(erro)) from None
    return resultado, gravados


@app.post("/celulas/{id_celula}/calibracoes", status_code=201)
def cadastrar_calibracao(conn: Conexao, pessoa: PessoaLogada, id_celula: str, corpo: NovaCalibracao):
    """Com a e b prontos, grava a curva como veio. Sem, calcula pelos pontos
    (ver NovaCalibracao) e devolve também `ajuste`, a reta com o branco à
    parte: od = a·(bruto − branco) + b."""
    _exigir_celula(conn, id_celula)
    if not corpo.por_pontos:
        return repo.nova_calibracao(
            conn, id_celula, corpo.a, corpo.b,
            recalcular=corpo.recalcular, desde=corpo.recalcular_desde,
            pontos=[p.model_dump(mode="json", exclude_unset=True) for p in corpo.pontos]
            if corpo.pontos is not None else None,
            r2=corpo.r2, organismo=corpo.organismo, id_pessoa=pessoa["id_pessoa"],
        )
    resultado, pontos = _calibracao_por_pontos(conn, id_celula, corpo.pontos)
    salva = repo.nova_calibracao(
        conn, id_celula, resultado.a, resultado.b_banco,
        recalcular=corpo.recalcular, desde=corpo.recalcular_desde,
        pontos=pontos, r2=resultado.r2, organismo=corpo.organismo, id_pessoa=pessoa["id_pessoa"],
    )
    return {**salva, "ajuste": {"branco": resultado.branco, "a": resultado.a, "b": resultado.b,
                                "r2": resultado.r2, "padroes": len(pontos) - 1}}


@app.get("/alertas")
def listar_alertas(conn: Conexao, _pessoa: PessoaLogada, abertos: bool = True):
    return repo.listar_alertas(conn, somente_abertos=abertos)


@app.get("/integridade")
def integridade(conn: Conexao, _pessoa: PessoaLogada):
    """Para cada célula, mostra se o histórico está completo e sem repetições."""
    return [
        {**linha, "completo": linha["leituras"] == linha["seq_unicos"] == linha["esperado"]}
        for linha in repo.resumo_integridade(conn)
    ]


# ---------------------------------------------------------------- experimentos
#
# Quem não tem acesso ao experimento recebe 404, para não revelar que ele
# existe. Quem tem acesso, mas não o suficiente, recebe 403.

_EDITA_CULTIVOS = ("responsavel", "edicao")

# Depois do início, só estes campos da ficha mudam (P-3).
_EDITAVEIS_EM_ANDAMENTO = ("descricao", "metadados")


def _conferir_permissao(acesso: str, permitidos: tuple[str, ...]) -> None:
    if not permitidos or acesso in permitidos:
        return
    if permitidos == ("responsavel",):
        raise HTTPException(403, "Só o responsável pelo experimento pode fazer isto. Peça ao responsável, se precisar.")
    raise HTTPException(403, "Seu acesso a este experimento é só de leitura. "
                             "Peça ao responsável a permissão Pode modificar.")


def _exigir_acesso(conn: psycopg.Connection, id_experimento: int, pessoa: dict, *permitidos: str) -> None:
    acesso = repo.acesso_de(conn, id_experimento, pessoa["id_pessoa"])
    if acesso is None:
        raise HTTPException(404, f"Experimento {id_experimento} não encontrado.")
    _conferir_permissao(acesso, permitidos)


def _exigir_cultivo(conn: psycopg.Connection, id_cultivo: int, pessoa: dict, *permitidos: str) -> None:
    cultivo = repo.buscar_cultivo(conn, id_cultivo)
    acesso = repo.acesso_de(conn, cultivo["id_experimento"], pessoa["id_pessoa"]) if cultivo else None
    if acesso is None:
        raise HTTPException(404, f"Cultivo {id_cultivo} não encontrado.")
    _conferir_permissao(acesso, permitidos)


def _cultivo_fechado(conn: psycopg.Connection, id_cultivo: int) -> HTTPException:
    status = repo.buscar_cultivo(conn, id_cultivo)["status"]
    return HTTPException(409, f"O cultivo {id_cultivo} já está {status} e não pode mais ser alterado. "
                              "Para continuar a cultura, inicie um cultivo novo com continua_de.")


def _com_codigo(experimento: dict) -> dict:
    """Código de exibição (P-8): EXP- e o id com no mínimo 2 dígitos. Não fica no banco."""
    return {"codigo": f"EXP-{experimento['id_experimento']:02d}", **experimento}


def _experimento_fechado(id_experimento: int, status: str) -> HTTPException:
    return HTTPException(409, f"O experimento {id_experimento} já está {status}. Nada foi alterado.")


@contextmanager
def _faixa_de_ph():
    """Traduz a faixa de pH invertida. Quem confere é o banco, porque numa
    alteração o outro limite pode ser o que já estava gravado."""
    try:
        yield
    except psycopg.errors.CheckViolation as erro:
        if erro.diag.constraint_name not in ("experimento_faixa_ph", "cultivo_faixa_ph"):
            raise
        raise HTTPException(422, "A faixa de pH precisa ter o mínimo menor que o máximo. "
                                 "Confira ph_ref_min e ph_ref_max.") from None


@app.post("/experimentos", status_code=201)
def criar_experimento(conn: Conexao, pessoa: PessoaLogada, corpo: NovoExperimento):
    if corpo.temperatura_alvo_c is not None:
        _conferir_temperatura(corpo.temperatura_alvo_c)
    with _faixa_de_ph():
        return _com_codigo(repo.criar_experimento(conn, pessoa["id_pessoa"], **corpo.model_dump()))


@app.get("/experimentos")
def listar_experimentos(conn: Conexao, pessoa: PessoaLogada,
                        filtro: Literal["todos", "meus", "compartilhados"] = "todos"):
    """Os experimentos de que a pessoa é responsável e os compartilhados com ela."""
    return [_com_codigo(e) for e in repo.listar_experimentos_visiveis(conn, pessoa["id_pessoa"], filtro)]


@app.get("/experimentos/{id_experimento}")
def buscar_experimento(conn: Conexao, pessoa: PessoaLogada, id_experimento: int):
    _exigir_acesso(conn, id_experimento, pessoa)
    return _com_codigo(repo.buscar_experimento(conn, id_experimento))


@app.patch("/experimentos/{id_experimento}")
def alterar_experimento(conn: Conexao, pessoa: PessoaLogada, id_experimento: int, corpo: AlteracaoExperimento):
    """Cadastrado: todos os campos. Em andamento: só descricao e metadados.
    Encerrado ou cancelado: nenhum."""
    _exigir_acesso(conn, id_experimento, pessoa, "responsavel")
    campos = corpo.model_dump(exclude_unset=True)
    # Trava o experimento para o status não mudar entre a decisão e a gravação
    # (por exemplo, o primeiro cultivo começar no meio).
    with _faixa_de_ph(), conn.transaction():
        status = repo.travar_experimento(conn, id_experimento)["status"]
        if status in ("encerrado", "cancelado"):
            raise HTTPException(409, f"O experimento {id_experimento} está {status} e não pode mais ser alterado. "
                                     "Para repetir o estudo, duplique o experimento.")
        travados = [campo for campo in campos if campo not in _EDITAVEIS_EM_ANDAMENTO]
        if status == "em_andamento" and travados:
            raise HTTPException(422, f"O experimento já começou e estes campos não podem mais ser alterados: "
                                     f"{', '.join(travados)}. Depois do início, só descricao e metadados mudam.")
        if campos.get("temperatura_alvo_c") is not None:
            _conferir_temperatura(campos["temperatura_alvo_c"])
        experimento =repo.atualizar_experimento(conn, id_experimento, **campos)
    return _com_codigo(experimento)


@app.post("/experimentos/{id_experimento}/encerrar")
def encerrar_experimento(conn: Conexao, pessoa: PessoaLogada, id_experimento: int):
    """Encerra o experimento e, junto, os cultivos abertos (P-9)."""
    _exigir_acesso(conn, id_experimento, pessoa, "responsavel")
    try:
        return _com_codigo(repo.encerrar_experimento(conn, id_experimento, pessoa["id_pessoa"]))
    except repo.OperacaoRecusada as recusa:
        if recusa.status == "cadastrado":
            raise HTTPException(409, f"O experimento {id_experimento} ainda não começou e não pode ser encerrado. "
                                     "Para desistir dele, cancele-o.") from None
        raise _experimento_fechado(id_experimento, recusa.status) from None


@app.post("/experimentos/{id_experimento}/cancelar")
def cancelar_experimento(conn: Conexao, pessoa: PessoaLogada, id_experimento: int, corpo: Motivo):
    """Cancela o experimento e, junto, os cultivos abertos, com o mesmo motivo."""
    _exigir_acesso(conn, id_experimento, pessoa, "responsavel")
    try:
        return _com_codigo(repo.cancelar_experimento(conn, id_experimento, pessoa["id_pessoa"], corpo.motivo))
    except repo.OperacaoRecusada as recusa:
        raise _experimento_fechado(id_experimento, recusa.status) from None


@app.post("/experimentos/{id_experimento}/duplicar", status_code=201)
def duplicar_experimento(conn: Conexao, pessoa: PessoaLogada, id_experimento: int):
    """Cópia cadastrada da ficha, com quem duplicou como responsável."""
    _exigir_acesso(conn, id_experimento, pessoa)
    return _com_codigo(repo.duplicar_experimento(conn, id_experimento, pessoa["id_pessoa"]))


@app.post("/experimentos/{id_experimento}/acessos")
def conceder_acesso(conn: Conexao, pessoa: PessoaLogada, id_experimento: int, corpo: NovoAcesso):
    """Compartilha com quem já tem conta. Repetir troca a permissão."""
    _exigir_acesso(conn, id_experimento, pessoa, "responsavel")
    convidada = repo.buscar_pessoa_por_email(conn, corpo.email)
    if convidada is None:
        raise HTTPException(404, f"Nenhuma conta com o e-mail {corpo.email}. "
                                 "A pessoa precisa se cadastrar antes de receber acesso.")
    if convidada["id_pessoa"] == pessoa["id_pessoa"]:
        raise HTTPException(422, "Você é o responsável por este experimento e já tem acesso total.")
    acesso = repo.conceder_acesso(conn, id_experimento, convidada["id_pessoa"], corpo.permissao)
    return {"id_pessoa": convidada["id_pessoa"], "nome": convidada["nome"], "email": convidada["email"],
            "permissao": acesso["permissao"], "concedido_em": acesso["concedido_em"]}


@app.delete("/experimentos/{id_experimento}/acessos/{id_pessoa}", status_code=204)
def revogar_acesso(conn: Conexao, pessoa: PessoaLogada, id_experimento: int, id_pessoa: int):
    _exigir_acesso(conn, id_experimento, pessoa, "responsavel")
    if not repo.revogar_acesso(conn, id_experimento, id_pessoa):
        raise HTTPException(404, f"A pessoa {id_pessoa} não tem acesso ao experimento {id_experimento}.")


# ---------------------------------------------------------------- cultivos


@app.post("/experimentos/{id_experimento}/cultivos", status_code=201)
def iniciar_cultivo(conn: Conexao, pessoa: PessoaLogada, id_experimento: int, corpo: NovoCultivo):
    """Põe a célula no experimento a partir de agora e, se o experimento tem
    temperatura alvo, envia a temperatura à célula. A resposta é o cultivo
    com o pedido de setpoint e se o broker confirmou a publicação (os dois
    nulos sem temperatura alvo)."""
    _exigir_acesso(conn, id_experimento, pessoa, *_EDITA_CULTIVOS)
    _exigir_celula(conn, corpo.id_celula)
    try:
        # A temperatura lida é a que vale para o cultivo: a trava impede que
        # ela mude até o cultivo ser gravado.
        with conn.transaction():
            experimento = repo.travar_experimento(conn, id_experimento)
            temperatura = experimento["temperatura_alvo_c"]
            if temperatura is not None and experimento["status"] in ("cadastrado", "em_andamento"):
                _conferir_temperatura(temperatura)
                if not estado["mqtt"].is_connected():
                    # Antes de gravar: um cultivo sem a temperatura na célula
                    # começaria com o setpoint errado.
                    raise HTTPException(503, "Broker indisponível: o cultivo não foi iniciado, porque a "
                                             "temperatura alvo não chegaria à célula. Tente de novo em alguns segundos.")
            cultivo = repo.iniciar_cultivo(conn, id_experimento, corpo.id_celula, pessoa["id_pessoa"],
                                           condicao=corpo.condicao, replica=corpo.replica,
                                           continua_de=corpo.continua_de)
    except psycopg.errors.ExclusionViolation:
        raise HTTPException(409, f"A célula {corpo.id_celula} já está em outro cultivo. "
                                 "Encerre o cultivo atual antes de iniciar outro.") from None
    except psycopg.errors.ForeignKeyViolation:
        # A célula já foi conferida: só sobra o cultivo de continua_de.
        raise HTTPException(422, f"Cultivo {corpo.continua_de} não encontrado. Confira continua_de.") from None
    except repo.OperacaoRecusada as recusa:
        raise HTTPException(409, f"O experimento {id_experimento} está {recusa.status} e não recebe cultivos novos. "
                                 "Para repetir o estudo, duplique o experimento.") from None
    if temperatura is None:
        return {**cultivo, "pedido_setpoint": None, "setpoint_confirmado": None}
    # O cultivo já está gravado. Se o broker caiu desde a checagem, o pedido
    # fica solicitado e o paho o envia ao reconectar (D6).
    pedido, confirmado = _enviar_setpoint(conn, corpo.id_celula, temperatura, pessoa["nome"], pessoa["id_pessoa"])
    return {**cultivo, "pedido_setpoint": pedido, "setpoint_confirmado": confirmado}


@app.patch("/cultivos/{id_cultivo}")
def alterar_cultivo(conn: Conexao, pessoa: PessoaLogada, id_cultivo: int, corpo: AlteracaoCultivo):
    _exigir_cultivo(conn, id_cultivo, pessoa, *_EDITA_CULTIVOS)
    with _faixa_de_ph():
        cultivo = repo.atualizar_cultivo(conn, id_cultivo, **corpo.model_dump(exclude_unset=True))
    if cultivo is None:
        raise _cultivo_fechado(conn, id_cultivo)
    return cultivo


@app.post("/cultivos/{id_cultivo}/encerrar")
def encerrar_cultivo(conn: Conexao, pessoa: PessoaLogada, id_cultivo: int, corpo: MotivoOpcional | None = None):
    """Tira a célula do experimento a partir de agora."""
    _exigir_cultivo(conn, id_cultivo, pessoa, *_EDITA_CULTIVOS)
    cultivo = repo.encerrar_cultivo(conn, id_cultivo, pessoa["id_pessoa"], corpo.motivo if corpo else None)
    if cultivo is None:
        raise _cultivo_fechado(conn, id_cultivo)
    return cultivo


@app.post("/cultivos/{id_cultivo}/cancelar")
def cancelar_cultivo(conn: Conexao, pessoa: PessoaLogada, id_cultivo: int, corpo: Motivo):
    """Como encerrar, marcando que o cultivo não valeu. Nada é apagado."""
    _exigir_cultivo(conn, id_cultivo, pessoa, *_EDITA_CULTIVOS)
    cultivo = repo.cancelar_cultivo(conn, id_cultivo, pessoa["id_pessoa"], corpo.motivo)
    if cultivo is None:
        raise _cultivo_fechado(conn, id_cultivo)
    return cultivo


@app.get("/cultivos/{id_cultivo}/leituras")
def listar_leituras_do_cultivo(conn: Conexao, pessoa: PessoaLogada, id_cultivo: int,
                               desde: datetime | None = None, limite: int = Query(1000, ge=1, le=10000)):
    """Leituras medidas no período do cultivo."""
    _exigir_cultivo(conn, id_cultivo, pessoa)
    return repo.listar_leituras_do_cultivo(conn, id_cultivo, desde, limite)
