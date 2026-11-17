"""Carga inicial (seed) do banco do T.U.P.A, para demonstrar e testar com o simulador.

Ferramenta de desenvolvimento, como o resto do simulador. Não roda sozinha no
init do PostgreSQL: o banco dos testes de integração precisa começar vazio.

O que entra (o roteiro de 90 dias está em simulador/roteiro.py):
  - 4 pessoas (Pedro Ximenes, Rogério Medina, Henry Piozzi, Gabriel Bonatto),
    todas com a senha 'cultura123'
  - células c01 a c16 com a calibração v1 de OD (branco + 4 padrões, reta
    calculada por app.calibracao.ajuste, o mesmo código da API); a c01 à c08
    têm também a v2, mais nova e em uso
  - 7 experimentos: EXP-01 e EXP-02 em andamento, EXP-03 em stand by,
    EXP-04, EXP-05 e EXP-07 encerrados e EXP-06 cancelado, com compartilhamentos
  - 38 cultivos: 14 abertos e 24 antigos (encerrados ou cancelados), cada um
    com a faixa de pH do experimento
  - os pedidos de setpoint de cada cultivo. A c11 tem o pedido de 37 °C sem
    confirmação (a célula simulada ignora setpoints)
  - 7 alertas antigos, já fechados, para o Histórico

Leituras não entram aqui. Quem gera o histórico é a própria célula simulada
(HISTORICO_HORAS), que publica as leituras passadas pelo MQTT com seq contínuo
a partir de 0, seguindo o mesmo roteiro. Assim nada colide com as leituras ao
vivo e tudo passa pelo consumidor, como numa placa real.

Rodar a carga antes de subir as células: as leituras chegam com as células,
os cultivos e as calibrações já no banco. Com --zerar, o processo de regras só
sobe depois que o histórico chegou, para as leituras antigas não abrirem
alertas de agora.

Execução:
  python -m simulador.semente --zerar          # apaga tudo (docker compose down -v), sobe, carrega
                                               # e liga as 16 células com 90 dias de histórico
  python -m simulador.semente --zerar --dias 7        # histórico mais curto (carrega mais rápido)
  python -m simulador.semente --zerar --sem-celulas   # sem ligar as células
  python -m simulador.semente                  # só carrega no banco que já está no ar
"""

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app.api.autenticacao import resumir_senha
from app.calibracao.ajuste import ajustar_com_branco
from simulador import roteiro
from simulador.perfis import PERFIS_PADRAO

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("semente")

RAIZ = Path(__file__).resolve().parent.parent
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://evolver:evolver@localhost:5432/evolver")
# Sem as regras: elas sobem depois que o histórico das células chegou.
SERVICOS_SEM_CELULAS = ["banco", "broker", "consumidor", "api", "interface"]
HISTORICO_PASSO_MIN = 20

SENHA = "cultura123"
PESSOAS = {
    "pedro": ("Pedro Ximenes", "pedro.ximenes@cnpem.br"),
    "rogerio": ("Rogério Medina", "rogerio.medina@cnpem.br"),
    "henry": ("Henry Piozzi", "henry.piozzi@cnpem.br"),
    "gabriel": ("Gabriel Bonatto", "gabriel.bonatto@cnpem.br"),
}

# Pontos das calibrações: (rótulo, OD de referência, bruto médio lido).
# O sensor simulado lê 2000·OD + 100; os brutos têm um pequeno erro de
# leitura, para a reta e o R² não saírem perfeitos.
PONTOS_V1 = [("branco", None, 100.0), ("P1", 0.20, 502.0), ("P2", 0.35, 797.0),
             ("P3", 0.50, 1103.0), ("P4", 0.80, 1698.0)]
# Refeita com um padrão a mais, para cobrir as OD altas dos lotes em LB.
PONTOS_V2 = [("branco", None, 101.0), ("P1", 0.20, 499.0), ("P2", 0.35, 802.0),
             ("P3", 0.50, 1098.0), ("P4", 0.80, 1703.0), ("P5", 1.20, 2504.0)]
CELULAS_COM_V2 = [f"c0{n}" for n in range(1, 9)]


def popular_banco(url_banco: str = DATABASE_URL) -> None:
    log.info("Conectando ao PostgreSQL em %s", url_banco.split("@")[-1])
    with psycopg.connect(url_banco, autocommit=True, row_factory=dict_row) as conn:
        with conn.transaction():
            _popular(conn)
    log.info("Carga inicial concluída. Login: qualquer e-mail da lista, senha '%s'.", SENHA)


def _calibracao(pontos: list[tuple]) -> tuple:
    ajuste = ajustar_com_branco(pontos[0][2], [(bruto, od) for _, od, bruto in pontos[1:]])
    return ajuste, json.dumps([
        {"rotulo": rotulo, "od_referencia": od, "bruto": bruto, "origem": "digitado"}
        for rotulo, od, bruto in pontos])


def _popular(conn: psycopg.Connection) -> None:
    agora = datetime.now(timezone.utc)

    def dias(d: float) -> datetime:
        return agora - timedelta(days=d)

    # 1. Pessoas
    ids: dict[str, int] = {}
    for chave, (nome, email) in PESSOAS.items():
        ids[chave] = conn.execute(
            """
            INSERT INTO pessoa (nome, email, senha_hash, criado_em)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome
            RETURNING id_pessoa
            """,
            (nome, email, resumir_senha(SENHA), dias(roteiro.DIAS + 10)),
        ).fetchone()["id_pessoa"]
    log.info("%d pessoas", len(ids))

    # 2. Células e calibrações, com a mesma conta da API. A v1 é de antes do
    # primeiro experimento; a v2 da c01 à c08 é a que está em uso.
    v1, pontos_v1 = _calibracao(PONTOS_V1)
    v2, pontos_v2 = _calibracao(PONTOS_V2)
    for id_celula, perfil in PERFIS_PADRAO.items():
        conn.execute(
            """
            INSERT INTO celula (id_celula, apelido, modelo, firmware, sensores, estado, primeiro_anuncio, ultimo_contato)
            VALUES (%s, %s, %s, %s, %s::jsonb, 'online', %s, %s)
            ON CONFLICT (id_celula) DO UPDATE SET apelido = EXCLUDED.apelido, modelo = EXCLUDED.modelo
            """,
            (id_celula, id_celula, perfil.modelo, perfil.versao,
             json.dumps(["temperatura", "od", "ph"]), dias(roteiro.DIAS + 5), agora),
        )
        tem_v2 = id_celula in CELULAS_COM_V2
        for versao, ajuste, pontos, ativa, organismo, quem, quando in [
            (1, v1, pontos_v1, not tem_v2, "E. coli K-12", ids["henry"], dias(roteiro.DIAS + 1)),
            (2, v2, pontos_v2, True, "E. coli BW25113", ids["pedro"], dias(20)),
        ][: 2 if tem_v2 else 1]:
            conn.execute(
                """
                INSERT INTO calibracao (id_celula, versao, a, b, ativa, sensor, pontos, r2, organismo, id_pessoa, criada_em)
                VALUES (%s, %s, %s, %s, %s, 'od', %s::jsonb, %s, %s, %s, %s)
                ON CONFLICT (id_celula, versao) DO NOTHING
                """,
                (id_celula, versao, ajuste.a, ajuste.b_banco, ativa, pontos, ajuste.r2, organismo, quem, quando),
            )
    log.info("16 células; calibração v1 (R² %.4f) em todas e v2 (R² %.4f) em uso da c01 à c08", v1.r2, v2.r2)

    # 3. Experimentos e compartilhamento
    for e in roteiro.EXPERIMENTOS:
        metadados = {**e.metadados, **({"motivo_cancelamento": e.motivo} if e.motivo else {})}
        conn.execute(
            """
            INSERT INTO experimento (id_experimento, nome, descricao, modo, status, duracao_prevista_dias,
                                     temperatura_alvo_c, ph_ref_min, ph_ref_max, id_responsavel, id_origem,
                                     criado_em, iniciado_em, encerrado_em, metadados)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id_experimento) DO NOTHING
            """,
            (e.id, e.nome, e.descricao, e.modo, e.status,
             round(e.inicio - e.fim) if e.inicio and e.fim else 90,
             e.temperatura_alvo_c, e.ph_min, e.ph_max, ids[e.responsavel], e.origem, dias(e.criado),
             dias(e.inicio) if e.inicio is not None else None,
             dias(e.fim) if e.fim is not None else None, json.dumps(metadados)),
        )
        for pessoa, permissao in e.acessos:
            conn.execute(
                """
                INSERT INTO experimento_acesso (id_experimento, id_pessoa, permissao, concedido_em)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id_experimento, id_pessoa) DO NOTHING
                """,
                (e.id, ids[pessoa], permissao, dias(e.criado)),
            )
    conn.execute("SELECT setval('experimento_id_experimento_seq', (SELECT max(id_experimento) FROM experimento))")
    log.info("%d experimentos", len(roteiro.EXPERIMENTOS))

    # 4. Cultivos, com a faixa de pH do experimento, e os pedidos de setpoint
    experimento = {e.id: e for e in roteiro.EXPERIMENTOS}

    def pedido(id_pedido: str, id_celula: str, temperatura: float, quem: str, quando: datetime,
               confirmado: bool = True) -> None:
        nome = PESSOAS[quem][0]
        if confirmado:
            conn.execute(
                """
                INSERT INTO pedido_setpoint (id_pedido, id_celula, temperatura_c, estado, solicitado_por,
                                             id_pessoa, solicitado_em, recebido_em, aplicado_em, atingido_em)
                VALUES (%s, %s, %s, 'atingido', %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id_pedido) DO NOTHING
                """,
                (id_pedido, id_celula, temperatura, nome, ids[quem], quando, quando + timedelta(seconds=1),
                 quando + timedelta(seconds=2), quando + timedelta(minutes=10)),
            )
        else:
            # Pedido sem resposta: a regra setpoint_sem_confirmacao abre o alerta.
            conn.execute(
                """
                INSERT INTO pedido_setpoint (id_pedido, id_celula, temperatura_c, estado,
                                             solicitado_por, id_pessoa, solicitado_em)
                VALUES (%s, %s, %s, 'solicitado', %s, %s, %s)
                ON CONFLICT (id_pedido) DO NOTHING
                """,
                (id_pedido, id_celula, temperatura, nome, ids[quem], quando),
            )

    abertos = 0
    for n, c in enumerate(sorted(roteiro.CULTIVOS, key=lambda c: -c.inicio)):
        e = experimento[c.experimento]
        if c.fim is None:
            status, motivo = "em_andamento", None
        elif e.status == "cancelado":
            status, motivo = "cancelado", e.motivo
        else:
            status, motivo = "encerrado", None
        conn.execute(
            """
            INSERT INTO cultivo (id_experimento, id_celula, condicao, replica, ph_ref_min, ph_ref_max, status,
                                 iniciado_em, encerrado_em, motivo_encerramento, id_iniciado_por, id_encerrado_por)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (e.id, c.celula, c.condicao, c.replica, e.ph_min, e.ph_max, status, dias(c.inicio),
             dias(c.fim) if c.fim is not None else None, motivo, ids[e.responsavel],
             ids[e.responsavel] if c.fim is not None else None),
        )
        if c.fim is None:
            abertos += 1
            ignora = PERFIS_PADRAO[c.celula].cenario == "ignorar_setpoint"
            pedido(f"semente-{c.celula}", c.celula, roteiro.SETPOINT_PEDIDO_C.get(c.celula, c.temperatura_c),
                   e.responsavel, agora - timedelta(hours=1) if ignora else dias(c.inicio), confirmado=not ignora)
        else:
            pedido(f"semente-{c.celula}-{n}-inicio", c.celula, c.temperatura_c, e.responsavel, dias(c.inicio))
            # Ao fim do cultivo a célula volta para a temperatura de espera.
            pedido(f"semente-{c.celula}-{n}-fim", c.celula, roteiro.TEMPERATURA_EM_ESPERA_C, e.responsavel,
                   dias(c.fim))
    log.info("%d cultivos (%d abertos) e seus pedidos de setpoint", len(roteiro.CULTIVOS), abertos)

    # 5. Alertas antigos, já fechados, para o Histórico
    if not conn.execute("SELECT 1 FROM alerta LIMIT 1").fetchone():
        for ev in roteiro.EVENTOS:
            aberto = dias(ev.inicio) + timedelta(minutes=1)
            conn.execute(
                "INSERT INTO alerta (id_celula, tipo, mensagem, aberto_em, fechado_em) VALUES (%s, %s, %s, %s, %s)",
                (ev.celula, ev.tipo, ev.mensagem, aberto, aberto + timedelta(hours=ev.duracao_h)),
            )
        log.info("%d alertas antigos no histórico", len(roteiro.EVENTOS))


def _compose(env: dict, *args: str) -> None:
    comando = ["docker", "compose", "--profile", "16-celulas", *args]
    log.info("$ %s", " ".join(comando))
    subprocess.run(comando, cwd=RAIZ, env=env, check=True)


def _esperar_historico(url_banco: str, esperado: int, limite_s: float = 3600) -> None:
    """Espera as leituras do histórico das 16 células chegarem ao banco."""
    inicio = time.monotonic()
    anterior, parado_desde = -1, time.monotonic()
    with psycopg.connect(url_banco, autocommit=True) as conn:
        while True:
            total = conn.execute("SELECT count(*) FROM leitura").fetchone()[0]
            if total >= esperado:
                log.info("Histórico completo: %d leituras em %.0f s.", total, time.monotonic() - inicio)
                return
            if total != anterior:
                anterior, parado_desde = total, time.monotonic()
                log.info("Histórico chegando: %d de %d leituras (%.0f%%)", total, esperado, 100 * total / esperado)
            elif time.monotonic() - parado_desde > 120 or time.monotonic() - inicio > limite_s:
                log.warning("O histórico parou em %d de %d leituras. Seguindo assim mesmo; "
                            "veja docker compose logs simulador-16 consumidor.", total, esperado)
                return
            time.sleep(5)


def zerar(url_banco: str, ligar_celulas: bool, historico_dias: float) -> None:
    """Apaga os volumes do Compose (banco, broker e buffers das células), sobe
    tudo menos as células e as regras, carrega o banco, liga as 16 células,
    espera o histórico chegar e só então sobe as regras."""
    env = {
        **os.environ,
        "VITE_FONTE_DADOS": "api",
        "HISTORICO_HORAS": str(historico_dias * 24),
        "HISTORICO_PASSO_MIN": str(HISTORICO_PASSO_MIN),
        # Vazio: cada célula usa o cenário do seu perfil (c03 com desvio, c11 ignorando setpoint)
        "CENARIO_C01": "", "CENARIO_C02": "", "CENARIO_C03": "",
    }
    _compose(env, "down", "-v", "--remove-orphans")
    _compose(env, "up", "-d", "--build", "--wait", *SERVICOS_SEM_CELULAS)
    popular_banco(url_banco)
    if ligar_celulas:
        _compose(env, "up", "-d", "--build", "celula-c01", "celula-c02", "celula-c03", "simulador-16")
        por_celula = int(historico_dias * 24 * 60 / HISTORICO_PASSO_MIN)
        log.info("16 células ligadas, cada uma publicando %.0f dias de histórico (%d leituras).",
                 historico_dias, por_celula)
        _esperar_historico(url_banco, 16 * por_celula)
    else:
        log.info("Células desligadas. Para ligar fora do Docker: python -m simulador --historico %.0f",
                 historico_dias * 24)
    _compose(env, "up", "-d", "--build", *([] if ligar_celulas else ["regras"]))
    log.info("Interface em http://localhost:%s (modo api), API em http://localhost:%s/docs",
             os.environ.get("PORTA_INTERFACE", "8080"), os.environ.get("PORTA_API", "8000"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Carga inicial do banco do T.U.P.A para demonstração")
    parser.add_argument("url", nargs="?", default=DATABASE_URL, help="URL do PostgreSQL")
    parser.add_argument("--zerar", action="store_true",
                        help="Apaga todos os dados do Docker Compose (down -v) antes de carregar")
    parser.add_argument("--sem-celulas", action="store_true", help="Com --zerar, não liga as células simuladas")
    parser.add_argument("--dias", type=float, default=roteiro.DIAS,
                        help=f"Com --zerar, dias de leituras passadas que cada célula publica (padrão {roteiro.DIAS})")
    args = parser.parse_args()

    if args.zerar:
        zerar(args.url, not args.sem_celulas, args.dias)
    else:
        popular_banco(args.url)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as erro:
        sys.exit(f"O docker compose falhou ({erro.returncode}). Confira se o Docker está aberto e veja o log acima.")
    except psycopg.OperationalError as erro:
        sys.exit(f"Não foi possível conectar ao banco: {erro}. Suba o banco (docker compose up -d banco) "
                 "ou passe a URL certa.")
