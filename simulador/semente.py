"""Carga inicial (seed) do banco do T.U.P.A, para demonstrar e testar com o simulador.

Ferramenta de desenvolvimento, como o resto do simulador. Não roda sozinha no
init do PostgreSQL: o banco dos testes de integração precisa começar vazio.

O que entra:
  - 4 pessoas (Pedro Ximenes, Rogério Medina, Henry Piozzi, Gabriel Bonatto),
    todas com a senha 'cultura123'
  - células c01 a c16, cada uma com a calibração v1 de OD (branco + 4 padrões,
    reta calculada por app.calibracao.ajuste, o mesmo código da API)
  - EXP-01 e EXP-02 em andamento, EXP-03 em stand by e EXP-04 encerrado,
    com compartilhamentos
  - 14 cultivos abertos, com a faixa de pH do experimento
  - um pedido de setpoint por célula em cultivo: atingido na temperatura da
    condição, para as regras de desvio de temperatura valerem. A c11 tem o
    pedido de 37 °C sem confirmação (a célula simulada ignora setpoints)

Leituras não entram aqui. Quem gera o histórico é a própria célula simulada
(HISTORICO_HORAS), que publica as leituras passadas pelo MQTT com seq contínuo
a partir de 0. Assim nada colide com as leituras ao vivo e tudo passa pelo
consumidor, como numa placa real.

Rodar a carga antes de subir as células: as leituras chegam com as células,
os cultivos e as calibrações já no banco.

Execução:
  python -m simulador.semente --zerar          # apaga tudo (docker compose down -v),
                                               # sobe, carrega e liga as 16 células com 24 h de histórico
  python -m simulador.semente --zerar --sem-celulas   # idem, sem ligar as células
  python -m simulador.semente                  # só carrega no banco que já está no ar
"""

import argparse
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app.api.autenticacao import resumir_senha
from app.calibracao.ajuste import ajustar_com_branco
from simulador.perfis import PERFIS_PADRAO

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("semente")

RAIZ = Path(__file__).resolve().parent.parent
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://evolver:evolver@localhost:5432/evolver")
SERVICOS_SEM_CELULAS = ["banco", "broker", "consumidor", "regras", "api", "interface"]

SENHA = "cultura123"
PESSOAS = [
    ("Pedro Ximenes", "pedro.ximenes@cnpem.br"),
    ("Rogério Medina", "rogerio.medina@cnpem.br"),
    ("Henry Piozzi", "henry.piozzi@cnpem.br"),
    ("Gabriel Bonatto", "gabriel.bonatto@cnpem.br"),
]

# Pontos da calibração v1: (rótulo, OD de referência, bruto médio lido).
# O sensor simulado lê 2000·OD + 100; os brutos têm um pequeno erro de
# leitura, para a reta e o R² não saírem perfeitos.
PONTOS_CALIBRACAO = [
    ("branco", None, 100.0),
    ("P1", 0.20, 502.0),
    ("P2", 0.35, 797.0),
    ("P3", 0.50, 1103.0),
    ("P4", 0.80, 1698.0),
]

# (experimento, célula, condição, réplica, dias desde o início, temperatura do setpoint)
CULTIVOS = [
    (1, "c09", "25 °C", 1, 18, 25.0),
    (1, "c10", "25 °C", 2, 18, 25.0),
    (1, "c01", "30 °C", 1, 18, 30.0),
    (1, "c02", "30 °C", 2, 18, 30.0),
    (1, "c03", "30 °C", 3, 18, 30.0),
    (1, "c13", "32 °C", 1, 17, 32.0),
    (1, "c14", "32 °C", 2, 17, 32.0),
    (1, "c05", "37 °C", 1, 18, 37.0),
    (1, "c06", "37 °C", 2, 18, 37.0),
    (1, "c11", "37 °C", 3, 2, 37.0),
    (2, "c07", "pH 6,5", 1, 12, 30.0),
    (2, "c08", "pH 6,5", 2, 12, 30.0),
    (2, "c12", "pH 6,5", 3, 12, 30.0),
    (2, "c15", "pH 6,5", 4, 12, 30.0),
]


def popular_banco(url_banco: str = DATABASE_URL) -> None:
    log.info("Conectando ao PostgreSQL em %s", url_banco.split("@")[-1])
    with psycopg.connect(url_banco, autocommit=True, row_factory=dict_row) as conn:
        with conn.transaction():
            _popular(conn)
    log.info("Carga inicial concluída. Login: qualquer e-mail da lista, senha '%s'.", SENHA)


def _popular(conn: psycopg.Connection) -> None:
    agora = datetime.now(timezone.utc)

    def dias(d: float) -> datetime:
        return agora - timedelta(days=d)

    # 1. Pessoas
    ids: dict[str, int] = {}
    for nome, email in PESSOAS:
        linha = conn.execute(
            """
            INSERT INTO pessoa (nome, email, senha_hash, criado_em)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome
            RETURNING id_pessoa
            """,
            (nome, email, resumir_senha(SENHA), dias(30)),
        ).fetchone()
        ids[email.split(".")[0]] = linha["id_pessoa"]
    pedro, rogerio, henry, gabriel = ids["pedro"], ids["rogerio"], ids["henry"], ids["gabriel"]
    log.info("4 pessoas")

    # 2. Células e calibração v1, com a mesma conta da API
    branco = PONTOS_CALIBRACAO[0][2]
    ajuste = ajustar_com_branco(branco, [(bruto, od) for _, od, bruto in PONTOS_CALIBRACAO[1:]])
    pontos = json.dumps([
        {"rotulo": rotulo, "od_referencia": od, "bruto": bruto, "origem": "digitado"}
        for rotulo, od, bruto in PONTOS_CALIBRACAO
    ])
    for id_celula, perfil in PERFIS_PADRAO.items():
        conn.execute(
            """
            INSERT INTO celula (id_celula, apelido, modelo, firmware, sensores, estado, primeiro_anuncio, ultimo_contato)
            VALUES (%s, %s, %s, %s, %s::jsonb, 'online', %s, %s)
            ON CONFLICT (id_celula) DO UPDATE SET apelido = EXCLUDED.apelido, modelo = EXCLUDED.modelo
            """,
            (id_celula, id_celula, perfil.modelo, perfil.versao,
             json.dumps(["temperatura", "od", "ph"]), dias(40), agora),
        )
        conn.execute(
            """
            INSERT INTO calibracao (id_celula, versao, a, b, ativa, sensor, pontos, r2, organismo, id_pessoa, criada_em)
            VALUES (%s, 1, %s, %s, true, 'od', %s::jsonb, %s, 'E. coli', %s, %s)
            ON CONFLICT (id_celula, versao) DO NOTHING
            """,
            (id_celula, ajuste.a, ajuste.b_banco, pontos, ajuste.r2, pedro, dias(20)),
        )
    log.info("16 células, calibração v1: od = %.6f·(bruto − %.0f) %+.4f, R² %.4f",
             ajuste.a, branco, ajuste.b, ajuste.r2)

    # 3. Experimentos
    experimentos = [
        (1, "Temperatura ótima de E. coli", "Compara o crescimento a 25, 30, 32 e 37 °C",
         "turbidostato", "em_andamento", 6.6, 7.2, rogerio, None, dias(19), dias(18), None,
         {"fases": [{"duracaoDias": 90, "temperaturaC": 30}], "organismo": "E. coli BW25113",
          "meio": "LB", "volume_ml": 20, "agitacao_rpm": 600}),
        (2, "Adaptação a pH ácido", "Cepa em meio com pH 6,5, temperatura fixa de 30 °C",
         "quimiostato", "em_andamento", 6.3, 6.7, pedro, None, dias(13), dias(12), None,
         {"fases": [{"duracaoDias": 90, "temperaturaC": 30}], "organismo": "E. coli", "meio": "M9 glicose pH 6.5"}),
        (3, "Temperatura ótima · repetição", "Duplicado do EXP-01, faixa de 28 a 34 °C",
         "turbidostato", "cadastrado", 6.6, 7.2, pedro, 1, dias(2), None, None, {"baseadoEm": "EXP-01"}),
        (4, "Validação do sensor de OD", "Curvas de referência para a calibração",
         "curva_crescimento", "encerrado", 6.8, 7.2, henry, None, dias(95), dias(90), dias(2), {}),
    ]
    for (id_exp, nome, descricao, modo, status, ph_min, ph_max, resp, origem,
         criado, iniciado, encerrado, meta) in experimentos:
        conn.execute(
            """
            INSERT INTO experimento (id_experimento, nome, descricao, modo, status, duracao_prevista_dias,
                                     temperatura_alvo_c, ph_ref_min, ph_ref_max, id_responsavel, id_origem,
                                     criado_em, iniciado_em, encerrado_em, metadados)
            VALUES (%s, %s, %s, %s, %s, 90, 30.0, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (id_experimento) DO NOTHING
            """,
            (id_exp, nome, descricao, modo, status, ph_min, ph_max, resp, origem,
             criado, iniciado, encerrado, json.dumps(meta)),
        )
    conn.execute("SELECT setval('experimento_id_experimento_seq', (SELECT max(id_experimento) FROM experimento))")
    log.info("4 experimentos")

    # 4. Compartilhamento
    for id_exp, id_pessoa, permissao in [(1, pedro, "leitura"), (1, henry, "edicao"),
                                         (1, gabriel, "leitura"), (4, pedro, "edicao")]:
        conn.execute(
            """
            INSERT INTO experimento_acesso (id_experimento, id_pessoa, permissao, concedido_em)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (id_experimento, id_pessoa) DO NOTHING
            """,
            (id_exp, id_pessoa, permissao, dias(10)),
        )

    # 5. Cultivos, com a faixa de pH do experimento, e o setpoint de cada célula
    faixa_ph = {e[0]: (e[5], e[6]) for e in experimentos}
    for id_exp, id_celula, condicao, replica, ha_dias, alvo in CULTIVOS:
        quem = pedro if id_exp == 2 else rogerio
        inicio = dias(ha_dias)
        conn.execute(
            """
            INSERT INTO cultivo (id_experimento, id_celula, condicao, replica, ph_ref_min, ph_ref_max,
                                 status, iniciado_em, id_iniciado_por)
            VALUES (%s, %s, %s, %s, %s, %s, 'em_andamento', %s, %s)
            ON CONFLICT DO NOTHING
            """,
            (id_exp, id_celula, condicao, replica, *faixa_ph[id_exp], inicio, quem),
        )

        nome_quem = next(n for n, e in PESSOAS if e.startswith("pedro" if quem == pedro else "rogerio"))
        if PERFIS_PADRAO[id_celula].cenario == "ignorar_setpoint":
            # Pedido sem resposta: a regra setpoint_sem_confirmacao abre o alerta.
            conn.execute(
                """
                INSERT INTO pedido_setpoint (id_pedido, id_celula, temperatura_c, estado,
                                             solicitado_por, id_pessoa, solicitado_em)
                VALUES (%s, %s, %s, 'solicitado', %s, %s, %s)
                ON CONFLICT (id_pedido) DO NOTHING
                """,
                (f"semente-{id_celula}", id_celula, alvo, nome_quem, quem, agora - timedelta(hours=1)),
            )
        else:
            conn.execute(
                """
                INSERT INTO pedido_setpoint (id_pedido, id_celula, temperatura_c, estado, solicitado_por,
                                             id_pessoa, solicitado_em, recebido_em, aplicado_em, atingido_em)
                VALUES (%s, %s, %s, 'atingido', %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id_pedido) DO NOTHING
                """,
                (f"semente-{id_celula}", id_celula, alvo, nome_quem, quem, inicio,
                 inicio + timedelta(seconds=1), inicio + timedelta(seconds=2), inicio + timedelta(minutes=10)),
            )
    log.info("%d cultivos abertos e seus pedidos de setpoint", len(CULTIVOS))


def _compose(env: dict, *args: str) -> None:
    comando = ["docker", "compose", "--profile", "16-celulas", *args]
    log.info("$ %s", " ".join(comando))
    subprocess.run(comando, cwd=RAIZ, env=env, check=True)


def zerar(url_banco: str, ligar_celulas: bool, historico_horas: float) -> None:
    """Apaga os volumes do Compose (banco, broker e buffers das células), sobe
    tudo menos as células, carrega o banco e então liga as 16 células."""
    env = {
        **os.environ,
        "VITE_FONTE_DADOS": "api",
        "HISTORICO_HORAS": str(historico_horas),
        # Vazio: cada célula usa o cenário do seu perfil (c03 com desvio, c11 ignorando setpoint)
        "CENARIO_C01": "", "CENARIO_C02": "", "CENARIO_C03": "",
    }
    _compose(env, "down", "-v", "--remove-orphans")
    _compose(env, "up", "-d", "--build", "--wait", *SERVICOS_SEM_CELULAS)
    popular_banco(url_banco)
    if ligar_celulas:
        _compose(env, "up", "-d", "--build")
        log.info("16 células ligadas, cada uma publicando %.0f h de histórico.", historico_horas)
    else:
        log.info("Células desligadas. Para ligar fora do Docker: python -m simulador --historico %.0f",
                 historico_horas)
    log.info("Interface em http://localhost:%s (modo api), API em http://localhost:%s/docs",
             os.environ.get("PORTA_INTERFACE", "8080"), os.environ.get("PORTA_API", "8000"))


def main() -> None:
    parser = argparse.ArgumentParser(description="Carga inicial do banco do T.U.P.A para demonstração")
    parser.add_argument("url", nargs="?", default=DATABASE_URL, help="URL do PostgreSQL")
    parser.add_argument("--zerar", action="store_true",
                        help="Apaga todos os dados do Docker Compose (down -v) antes de carregar")
    parser.add_argument("--sem-celulas", action="store_true", help="Com --zerar, não liga as células simuladas")
    parser.add_argument("--historico", type=float, default=24,
                        help="Com --zerar, horas de leituras passadas que cada célula publica (padrão 24)")
    args = parser.parse_args()

    if args.zerar:
        zerar(args.url, not args.sem_celulas, args.historico)
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
