"""Regras de negócio que olham o banco e abrem ou fecham alertas.

Cada função é independente e idempotente: rodar duas vezes seguidas
não abre alerta duplicado nem muda estado à toa.
"""

import logging

import psycopg

from app.banco import repositorios as repo
from app.config import Config

log = logging.getLogger(__name__)


def _numero(valor: float, casas: int) -> str:
    """Número das mensagens de alerta, com vírgula decimal como na tela: 37,0."""
    return f"{valor:.{casas}f}".replace(".", ",")


def _consumidor(conn: psycopg.Connection, cfg: Config) -> dict | None:
    """Situação do consumidor pelo sinal de vida, ou None se ele nunca gravou."""
    return conn.execute(
        """
        SELECT ultimo_sinal < now() - make_interval(secs => %s) AS parado,
               NOT broker_conectado
               AND broker_desde < now() - make_interval(secs => %s) AS sem_broker,
               -- Conectado há pouco: as células ainda não tiveram tempo de
               -- mandar algo depois da volta.
               broker_conectado
               AND broker_desde >= now() - make_interval(secs => %s) AS reconectou_agora,
               broker_conectado,
               -- As regras acabaram de subir: o sinal que está no banco pode
               -- ser de antes de o sistema parar, e o consumidor ainda não
               -- teve tempo de gravar o primeiro.
               COALESCE((SELECT iniciado_em FROM processo WHERE nome = 'regras')
                        > now() - make_interval(secs => %s), false) AS regras_subiram_agora
          FROM processo WHERE nome = 'consumidor'
        """,
        (cfg.sinal_vida_limite_s, cfg.broker_inacessivel_s, cfg.sem_comunicacao_s, cfg.sinal_vida_limite_s),
    ).fetchone()


def comunicacao_do_servidor(conn: psycopg.Connection, cfg: Config) -> None:
    """Consumidor sem sinal de vida (consumidor_parado) ou vivo mas sem
    conexão com o broker (broker_inacessivel). Os dois alertas são do
    sistema, sem célula. Sem nenhum sinal gravado ainda, não decide nada."""
    c = _consumidor(conn, cfg)
    if c is None:
        return
    if c["parado"]:
        if c["regras_subiram_agora"]:
            # Subida do sistema: espera SINAL_VIDA_LIMITE_S antes de acusar.
            return
        if repo.abrir_alerta(conn, None, "consumidor_parado",
                             "O consumidor parou: as leituras não estão sendo gravadas. "
                             "Elas ficam guardadas no broker até ele voltar."):
            log.warning("alerta aberto: consumidor parado")
        # Parado, ele não diz se o broker responde: o alerta do broker fica como está.
        return
    if repo.fechar_alerta(conn, None, "consumidor_parado"):
        log.info("alerta fechado: consumidor voltou")
    if c["sem_broker"]:
        if repo.abrir_alerta(conn, None, "broker_inacessivel",
                             "O servidor perdeu a conexão com o broker MQTT. As leituras ficam "
                             "guardadas no broker ou nas células até a conexão voltar."):
            log.warning("alerta aberto: broker inacessível")
    elif c["broker_conectado"] and repo.fechar_alerta(conn, None, "broker_inacessivel"):
        log.info("alerta fechado: servidor reconectado ao broker")


def sem_comunicacao(conn: psycopg.Connection, cfg: Config) -> None:
    """Célula offline, ou sem mandar nada há mais de SEM_COMUNICACAO_S.

    Só abre quando o servidor está recebendo: com o consumidor parado, sem
    broker ou reconectado há menos de SEM_COMUNICACAO_S, nenhum alerta abre
    (seriam todas as células de uma vez, e a culpa não é delas). Vale também
    para o offline: ao sair do ar, o broker publica o offline (LWT) das
    células conectadas, e elas só se anunciam de novo quando ele volta."""
    c = _consumidor(conn, cfg)
    recebendo = c is None or (not c["parado"] and c["broker_conectado"] and not c["reconectou_agora"])
    for cel in conn.execute(
        """
        SELECT id_celula, estado = 'offline' AS offline,
               ultimo_contato < now() - make_interval(secs => %s) AS calada
          FROM celula
        """,
        (cfg.sem_comunicacao_s,),
    ).fetchall():
        if (cel["offline"] or cel["calada"]) and recebendo:
            if repo.abrir_alerta(conn, cel["id_celula"], "sem_comunicacao",
                                 "A célula parou de enviar dados."):
                log.warning("alerta aberto: %s sem comunicação", cel["id_celula"])
        elif not cel["offline"] and not cel["calada"] and repo.fechar_alerta(conn, cel["id_celula"], "sem_comunicacao"):
            log.info("alerta fechado: %s voltou a se comunicar", cel["id_celula"])


def setpoint_sem_confirmacao(conn: psycopg.Connection, cfg: Config) -> None:
    """O último pedido de setpoint da célula não foi aplicado em
    SETPOINT_TIMEOUT_S: ela não respondeu (solicitado) ou disse que recebeu
    e parou aí (recebido). Só o último conta: um pedido antigo que a célula
    ignorou fica como solicitado para sempre, mas deixa de valer quando um
    pedido mais novo é confirmado."""
    atrasadas = {
        linha["id_celula"]: linha
        for linha in conn.execute(
            """
            SELECT id_celula, temperatura_c, estado
              FROM (SELECT DISTINCT ON (id_celula) id_celula, temperatura_c, estado, solicitado_em
                      FROM pedido_setpoint
                     ORDER BY id_celula, solicitado_em DESC) ultimo
             WHERE estado IN ('solicitado', 'recebido')
               AND solicitado_em < now() - make_interval(secs => %s)
            """,
            (cfg.setpoint_timeout_s,),
        ).fetchall()
    }
    for id_celula, pedido in atrasadas.items():
        if pedido["estado"] == "recebido":
            mensagem = f"A célula recebeu o setpoint de {_numero(pedido['temperatura_c'], 1)} °C, mas não confirmou que aplicou."
        else:
            mensagem = f"A célula não confirmou o setpoint de {_numero(pedido['temperatura_c'], 1)} °C."
        if repo.abrir_alerta(conn, id_celula, "setpoint_sem_confirmacao", mensagem, atualizar=True):
            log.warning("alerta aberto: %s não confirmou setpoint", id_celula)
    for c in conn.execute(
        "SELECT id_celula FROM alerta WHERE tipo = 'setpoint_sem_confirmacao' AND fechado_em IS NULL"
    ).fetchall():
        if c["id_celula"] not in atrasadas:
            repo.fechar_alerta(conn, c["id_celula"], "setpoint_sem_confirmacao")


def setpoint_atingido(conn: psycopg.Connection, cfg: Config) -> None:
    """Marca como atingido o pedido aplicado cuja temperatura medida já
    chegou a TOLERANCIA_ATINGIDO_C do valor pedido."""
    for p in conn.execute(
        """
        SELECT p.id_pedido, p.id_celula
          FROM pedido_setpoint p
          JOIN LATERAL (
                SELECT temperatura_c FROM leitura l
                 WHERE l.id_celula = p.id_celula AND l.ts_recebido >= p.aplicado_em
                 ORDER BY seq DESC LIMIT 1) u ON true
         WHERE p.estado = 'aplicado' AND abs(u.temperatura_c - p.temperatura_c) <= %s
        """,
        (cfg.tolerancia_atingido_c,),
    ).fetchall():
        if repo.avancar_pedido(conn, p["id_pedido"], "atingido"):
            log.info("setpoint %s atingido na célula %s", p["id_pedido"], p["id_celula"])


def desvio_temperatura(conn: psycopg.Connection, cfg: Config) -> None:
    """A temperatura está a mais de DESVIO_MAX_C do alvo do último setpoint
    que a célula aplicou. Vale em dois casos:

    - o setpoint já tinha sido atingido e a temperatura se afastou;
    - o setpoint foi aplicado há mais de SETPOINT_ATINGIR_S e a temperatura
      não chegou (aquecimento com defeito). Antes desse prazo a célula está
      a caminho do alvo novo, e um alerta do alvo antigo é fechado.

    Só abre se nenhuma leitura dos últimos ALERTA_PERSISTENCIA_S esteve perto
    do alvo: uma leitura ruidosa sozinha não abre. Aberto, o alerta fica
    enquanto a última leitura estiver longe, e a mensagem acompanha a
    temperatura medida. Fecha quando a última leitura volta para perto do alvo."""
    abertos = _abertos(conn, "desvio_temperatura")
    fora = set()
    for c in conn.execute(
        """
        SELECT p.id_celula, p.temperatura_c AS alvo, p.estado, u.temperatura_c AS medida,
               extract(epoch FROM now() - p.aplicado_em)::float AS aplicado_ha_s,
               NOT EXISTS (
                SELECT 1 FROM leitura d
                 WHERE d.id_celula = p.id_celula
                   -- Com persistência 0 vale só a última leitura, mesmo
                   -- que o relógio da célula esteja adiantado.
                   AND %(persistencia)s > 0
                   AND d.ts_origem >= now() - make_interval(secs => %(persistencia)s)
                   AND abs(d.temperatura_c - p.temperatura_c) <= %(desvio)s) AS persistente
          FROM (SELECT DISTINCT ON (id_celula) id_celula, temperatura_c, estado, aplicado_em
                  FROM pedido_setpoint
                 WHERE estado IN ('aplicado', 'atingido')
                 ORDER BY id_celula, solicitado_em DESC) p
          JOIN LATERAL (
                SELECT temperatura_c FROM leitura l
                 WHERE l.id_celula = p.id_celula ORDER BY seq DESC LIMIT 1) u ON true
         WHERE abs(u.temperatura_c - p.temperatura_c) > %(desvio)s
           AND (p.estado = 'atingido' OR p.aplicado_em < now() - make_interval(secs => %(atingir)s))
        """,
        {"desvio": cfg.desvio_max_c, "atingir": cfg.setpoint_atingir_s,
         "persistencia": cfg.alerta_persistencia_s},
    ).fetchall():
        fora.add(c["id_celula"])
        if not c["persistente"] and c["id_celula"] not in abertos:
            continue
        mensagem = f"Temperatura em {_numero(c['medida'], 1)} °C, alvo de {_numero(c['alvo'], 1)} °C."
        if c["estado"] == "aplicado":
            mensagem += (f" O setpoint foi aplicado há {c['aplicado_ha_s'] / 60:.0f} min "
                         "e a temperatura não chegou ao alvo.")
        if repo.abrir_alerta(conn, c["id_celula"], "desvio_temperatura", mensagem, atualizar=True):
            log.warning("alerta aberto: desvio de temperatura em %s", c["id_celula"])
    for id_celula in abertos - fora:
        if repo.fechar_alerta(conn, id_celula, "desvio_temperatura"):
            log.info("alerta fechado: temperatura de %s voltou ao alvo ou o setpoint mudou", id_celula)


def _abertos(conn: psycopg.Connection, tipo: str) -> set[str]:
    """Células com alerta aberto do tipo."""
    return {a["id_celula"] for a in conn.execute(
        "SELECT id_celula FROM alerta WHERE tipo = %s AND fechado_em IS NULL", (tipo,)).fetchall()}


def _faixa(minimo: float | None, maximo: float | None) -> str:
    if minimo is not None and maximo is not None:
        return f"de {_numero(minimo, 2)} a {_numero(maximo, 2)}"
    return f"mínimo de {_numero(minimo, 2)}" if minimo is not None else f"máximo de {_numero(maximo, 2)}"


def ph_fora_da_faixa(conn: psycopg.Connection, cfg: Config) -> None:
    """Célula com cultivo aberto cuja última leitura de pH do período do
    cultivo (a de maior ts_origem) está fora da faixa de referência dele.
    Só abre se nenhuma leitura de pH do cultivo nos últimos
    ALERTA_PERSISTENCIA_S esteve dentro da faixa; aberto, a mensagem
    acompanha o pH medido. Fecha o alerta quando o pH volta, quando o
    cultivo não tem leitura de pH no período e quando a célula fica sem
    cultivo aberto ou sem faixa."""
    abertos = _abertos(conn, "ph_fora_da_faixa")
    fora = set()
    for c in conn.execute(
        """
        SELECT c.id_celula, c.ph_ref_min, c.ph_ref_max, u.ph,
               NOT EXISTS (
                SELECT 1 FROM leitura d
                 WHERE d.id_celula = c.id_celula AND d.ph IS NOT NULL
                   AND d.ts_origem >= c.iniciado_em
                   AND %(persistencia)s > 0
                   AND d.ts_origem >= now() - make_interval(secs => %(persistencia)s)
                   AND (c.ph_ref_min IS NULL OR d.ph >= c.ph_ref_min)
                   AND (c.ph_ref_max IS NULL OR d.ph <= c.ph_ref_max)) AS persistente
          FROM cultivo c
          JOIN LATERAL (
                SELECT ph FROM leitura l
                 WHERE l.id_celula = c.id_celula AND l.ph IS NOT NULL
                   AND l.ts_origem >= c.iniciado_em
                 ORDER BY ts_origem DESC LIMIT 1) u ON true
         WHERE c.status = 'em_andamento'
           AND (c.ph_ref_min IS NOT NULL OR c.ph_ref_max IS NOT NULL)
           AND (u.ph < c.ph_ref_min OR u.ph > c.ph_ref_max)
        """,
        {"persistencia": cfg.alerta_persistencia_s},
    ).fetchall():
        fora.add(c["id_celula"])
        if not c["persistente"] and c["id_celula"] not in abertos:
            continue
        if repo.abrir_alerta(conn, c["id_celula"], "ph_fora_da_faixa",
                             f"pH em {_numero(c['ph'], 2)}, fora da faixa de referência "
                             f"({_faixa(c['ph_ref_min'], c['ph_ref_max'])}).", atualizar=True):
            log.warning("alerta aberto: pH fora da faixa em %s", c["id_celula"])
    for id_celula in abertos - fora:
        if repo.fechar_alerta(conn, id_celula, "ph_fora_da_faixa"):
            log.info("alerta fechado: pH de %s voltou à faixa ou o cultivo mudou", id_celula)


# Regras criadas na tela (tabela regra_alerta). A coluna e o operador vêm
# destas tabelas, nunca do que a pessoa digitou.
_COLUNA = {"temperatura": "temperatura_c", "od": "od", "ph": "ph"}
_OPERADOR = {"maior": ">", "menor": "<"}
# Nome, casas decimais e unidade de cada medida na mensagem do alerta.
_MEDIDA = {"temperatura": ("Temperatura", 1, " °C"), "od": ("OD", 3, ""), "ph": ("pH", 2, "")}


def _fora_do_limite(conn: psycopg.Connection, regra: dict) -> list[dict]:
    """Células em que a última leitura da medida passou do limite da regra.
    `persistente` diz se a medida ficou fora do limite pelos últimos
    por_minutos inteiros: nenhuma leitura desse tempo ficou dentro do limite
    e a última leitura de antes dele já estava fora. Sem leitura anterior
    (a célula acabou de entrar no experimento), ainda não é persistente."""
    coluna, operador = _COLUNA[regra["parametro"]], _OPERADOR[regra["comparacao"]]
    return conn.execute(
        f"""
        WITH alvo AS (
            SELECT id_celula, NULL::timestamptz AS desde FROM celula WHERE %(experimento)s::int IS NULL
            UNION ALL
            SELECT id_celula, iniciado_em FROM cultivo
             WHERE id_experimento = %(experimento)s AND status = 'em_andamento')
        SELECT a.id_celula, u.valor,
               NOT EXISTS (
                SELECT 1 FROM leitura d
                 WHERE d.id_celula = a.id_celula AND d.{coluna} IS NOT NULL
                   AND (a.desde IS NULL OR d.ts_origem >= a.desde)
                   AND d.ts_origem >= now() - make_interval(mins => %(minutos)s)
                   AND NOT (d.{coluna} {operador} %(limite)s))
               AND coalesce((
                SELECT d.{coluna} {operador} %(limite)s FROM leitura d
                 WHERE d.id_celula = a.id_celula AND d.{coluna} IS NOT NULL
                   AND (a.desde IS NULL OR d.ts_origem >= a.desde)
                   AND d.ts_origem <= now() - make_interval(mins => %(minutos)s)
                 ORDER BY d.ts_origem DESC LIMIT 1), false) AS persistente
          FROM alvo a
          JOIN LATERAL (
                SELECT l.{coluna} AS valor FROM leitura l
                 WHERE l.id_celula = a.id_celula AND l.{coluna} IS NOT NULL
                   AND (a.desde IS NULL OR l.ts_origem >= a.desde)
                 ORDER BY l.ts_origem DESC LIMIT 1) u ON true
         WHERE u.valor {operador} %(limite)s
        """,
        {"experimento": regra["id_experimento"], "minutos": regra["por_minutos"], "limite": regra["limite"]},
    ).fetchall()


def regras_configuradas(conn: psycopg.Connection, cfg: Config) -> None:
    """Regras criadas na tela: a medida acima (ou abaixo) do limite por
    por_minutos seguidos, em todas as células ou nas células com cultivo
    aberto no experimento da regra. Aberto, o alerta acompanha o valor
    medido. Fecha quando a última leitura volta ao limite, quando a célula
    sai do experimento e quando a regra é desligada ou excluída."""
    abertos = {(a["id_regra"], a["id_celula"]) for a in conn.execute(
        "SELECT id_regra, id_celula FROM alerta WHERE tipo = 'regra' AND fechado_em IS NULL").fetchall()}
    fora = set()
    for regra in conn.execute(
        """
        SELECT id_regra, nome, parametro, comparacao, limite, por_minutos, id_experimento
          FROM regra_alerta WHERE ativa AND excluida_em IS NULL ORDER BY id_regra
        """
    ).fetchall():
        medida, casas, unidade = _MEDIDA[regra["parametro"]]
        sentido = "acima" if regra["comparacao"] == "maior" else "abaixo"
        for c in _fora_do_limite(conn, regra):
            chave = (regra["id_regra"], c["id_celula"])
            if not c["persistente"] and chave not in abertos:
                continue
            fora.add(chave)
            mensagem = (f"{regra['nome']}: {medida} em {_numero(c['valor'], casas)}{unidade}, {sentido} de "
                        f"{_numero(regra['limite'], casas)}{unidade} há mais de {regra['por_minutos']} min.")
            if repo.abrir_alerta(conn, c["id_celula"], "regra", mensagem, atualizar=True, id_regra=regra["id_regra"]):
                log.warning("alerta aberto: regra %s (%s) em %s", regra["id_regra"], regra["nome"], c["id_celula"])
    for id_regra, id_celula in abertos - fora:
        if repo.fechar_alerta(conn, id_celula, "regra", id_regra=id_regra):
            log.info("alerta fechado: regra %s em %s", id_regra, id_celula)


TODAS = [comunicacao_do_servidor, sem_comunicacao, setpoint_sem_confirmacao, setpoint_atingido, desvio_temperatura,
         ph_fora_da_faixa, regras_configuradas]
