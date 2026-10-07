"""API HTTP usada pela interface web.

A interface nunca acessa o banco nem o broker direto: tudo passa por aqui,
para que validação do setpoint e registro de quem pediu fiquem num lugar só.

Executar: uvicorn app.api.main:app --host 0.0.0.0 --port 8000
Documentação interativa em http://localhost:8000/docs
"""

import csv
import io
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated

import paho.mqtt.client as mqtt
import psycopg
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.esquemas import NovaCalibracao, NovoSetpoint
from app.banco import repositorios as repo
from app.banco.conexao import criar_pool
from app.config import config
from contrato import PedidoSetpoint, topicos

log = logging.getLogger("api")
estado: dict = {}


@asynccontextmanager
async def ciclo_de_vida(_app: FastAPI):
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


app = FastAPI(title="Monitoramento eVOLVER", version="0.1.0", lifespan=ciclo_de_vida)


def _conexao():
    with estado["pool"].connection() as conn:
        yield conn


Conexao = Annotated[psycopg.Connection, Depends(_conexao)]


def _exigir_celula(conn: psycopg.Connection, id_celula: str) -> None:
    if not repo.celula_existe(conn, id_celula):
        raise HTTPException(404, f"Célula {id_celula} não encontrada.")


@app.get("/saude")
def saude():
    try:
        with estado["pool"].connection(timeout=2) as conn:
            conn.execute("SELECT 1")
        banco = True
    except Exception:
        banco = False
    return {"banco": banco, "broker": estado["mqtt"].is_connected()}


@app.get("/celulas")
def listar_celulas(conn: Conexao):
    return repo.listar_celulas(conn)


@app.get("/celulas/{id_celula}/leituras")
def listar_leituras(conn: Conexao, id_celula: str, desde: datetime | None = None,
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
def exportar_leituras(conn: Conexao, id_celula: str):
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
def pedir_setpoint(conn: Conexao, id_celula: str, corpo: NovoSetpoint):
    _exigir_celula(conn, id_celula)
    if not config.temperatura_min_c <= corpo.temperatura_c <= config.temperatura_max_c:
        raise HTTPException(
            422, f"A temperatura deve ficar entre {config.temperatura_min_c:.0f} "
                 f"e {config.temperatura_max_c:.0f} °C.",
        )
    cliente = estado["mqtt"]
    if not cliente.is_connected():
        # Não publica: o paho guardaria a mensagem e a enviaria depois,
        # e um pedido recusado aqui seria aplicado lá na célula.
        raise HTTPException(503, "Broker indisponível. Tente de novo em alguns segundos.")

    id_pedido = f"sp-{secrets.token_hex(4)}"
    pedido = repo.criar_pedido(conn, id_pedido, id_celula, corpo.temperatura_c, corpo.solicitado_por)

    # Retida: se a célula estiver offline, recebe o pedido assim que voltar.
    mensagem = PedidoSetpoint(id=id_pedido, temperatura_c=corpo.temperatura_c)
    info = cliente.publish(topicos.setpoint(id_celula), mensagem.para_json(),
                           qos=topicos.QOS, retain=True)
    try:
        info.wait_for_publish(timeout=5)
    except RuntimeError:
        pass
    if not info.is_published():
        log.warning("pedido %s sem confirmação do broker em 5 s, segue como solicitado", id_pedido)
    return pedido


@app.get("/celulas/{id_celula}/setpoints")
def listar_setpoints(conn: Conexao, id_celula: str):
    _exigir_celula(conn, id_celula)
    return repo.listar_pedidos(conn, id_celula)


@app.get("/setpoints/{id_pedido}")
def buscar_setpoint(conn: Conexao, id_pedido: str):
    pedido = repo.buscar_pedido(conn, id_pedido)
    if pedido is None:
        raise HTTPException(404, f"Pedido {id_pedido} não encontrado.")
    return pedido


@app.post("/celulas/{id_celula}/calibracoes", status_code=201)
def cadastrar_calibracao(conn: Conexao, id_celula: str, corpo: NovaCalibracao):
    _exigir_celula(conn, id_celula)
    return repo.nova_calibracao(conn, id_celula, corpo.a, corpo.b)


@app.get("/alertas")
def listar_alertas(conn: Conexao, abertos: bool = True):
    return repo.listar_alertas(conn, somente_abertos=abertos)


@app.get("/integridade")
def integridade(conn: Conexao):
    """Para cada célula, mostra se o histórico está completo e sem repetições."""
    return [
        {**linha, "completo": linha["leituras"] == linha["seq_unicos"] == linha["esperado"]}
        for linha in repo.resumo_integridade(conn)
    ]
