"""Terminal de controle interativo e CLI para o simulador T.U.P.A.

Força o que o sensor da célula simulada mede. Não calibra nada: quem calibra
é a tela "Nova calibração" da interface, e a reta que vale é a do servidor.
A cada valor de OD forçado, a célula publica na hora uma rajada de 6 leituras
com ruído de 0,1% do bruto, então a janela fica estável em ~3 s e o botão de
gravar da tela já pode ser usado.

  - Calibração de OD ao vivo (a OD de referência é digitada de novo na tela):
      branco                   -> sensor lê bruto 100 (só meio de cultura)
      branco 120               -> sensor lê bruto 120
      padrao 0.2 valor 0.235   -> padrão de OD 0.2; o sensor lê como 0.235 (bruto 570)
      padrao 0.5               -> sensor lê exatamente o padrão (bruto 1100)
      padrao 0.8 bruto 1650    -> padrão de OD 0.8 com o bruto digitado
  - Conferência das contas:
      tabela           -> pontos, x = bruto - branco, a, b, R² e o b gravado no banco
      tabela excel     -> dados tabulados para colar direto no Excel
  - Testes de regras e alertas:
      temp 38.5        -> simula desvio de temperatura
      ph 5.5           -> simula pH fora da faixa
      auto             -> restaura simulação automática contínua
  - Quedas de comunicação (voltam sozinhas depois do tempo pedido):
      rede 120         -> ESP <-> Raspberry: Wi-Fi da célula ativa cortado
      rede todas 120   -> ESP <-> Raspberry: Wi-Fi de todas as células
      servidor 120     -> Raspberry <-> servidor: cabo cortado (pausa o enlace)
      broker 60        -> broker (Raspberry Pi) parado
      consumidor 60    -> consumidor parado
  - Relatório de falhas (Markdown e JSON em relatorios/):
      relatorio        -> desde que a CLI abriu: cada falha simulada, se o alerta
                          certo abriu e fechou, e se alguma leitura se perdeu
      relatorio 2h     -> das últimas 2 horas (30m, 2h, 1d)
      Ao sair, o relatório é gerado sozinho se houve falha simulada sem relatório.
"""

import argparse
import json
import math
import os
import subprocess
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import paho.mqtt.client as mqtt


class SessaoCalibracao:
    def __init__(self):
        self.branco_bruto: float = 100.0
        self.pontos: list[dict] = []  # {"rotulo": ..., "od_ref": ..., "od_medida": ..., "bruto": ...}
        self.ruido: float | None = None  # desvio padrão fixo do bruto; None = 0,1% do valor

    def registrar_branco(self, bruto: float):
        self.branco_bruto = bruto

    def adicionar_ponto(self, rotulo: str, od_ref: float, od_medida: float, bruto: float):
        # Substitui se já existir ponto com o mesmo od_ref, senão adiciona
        self.pontos = [p for p in self.pontos if abs(p["od_ref"] - od_ref) > 1e-4]
        self.pontos.append({
            "rotulo": rotulo,
            "od_ref": od_ref,
            "od_medida": od_medida,
            "bruto": bruto,
        })
        self.pontos.sort(key=lambda p: p["od_ref"])

    def limpar(self):
        self.branco_bruto = 100.0
        self.pontos.clear()

    def calcular_regressao(self):
        """Calcula a reta od = a * (bruto - branco) + b e o R²."""
        if len(self.pontos) < 2:
            return None
        xs = [p["bruto"] - self.branco_bruto for p in self.pontos]
        ys = [p["od_ref"] for p in self.pontos]
        n = len(xs)
        media_x = sum(xs) / n
        media_y = sum(ys) / n

        sxx = sum((x - media_x) ** 2 for x in xs)
        syy = sum((y - media_y) ** 2 for y in ys)
        sxy = sum((x - media_x) * (y - media_y) for x, y in zip(xs, ys))

        if sxx == 0:
            return None
        a = sxy / sxx
        b = media_y - a * media_x
        r2 = (sxy ** 2) / (sxx * syy) if syy > 0 else 1.0
        return {"a": a, "b": b, "r2": r2, "branco": self.branco_bruto}


def imprimir_tabela(sessao: SessaoCalibracao, formato_excel: bool = False):
    if formato_excel:
        print("\n--- Copie e Cole no Excel (Separado por TAB) ---")
        print("Ponto\tOD Referência (Y)\tBruto Medido\tX (Bruto - Branco)")
        print(f"Branco\t0.000\t{sessao.branco_bruto:.1f}\t0.0")
        for p in sessao.pontos:
            x = p["bruto"] - sessao.branco_bruto
            print(f"{p['rotulo']}\t{p['od_ref']:.3f}\t{p['bruto']:.1f}\t{x:.1f}")
        print("------------------------------------------------\n")
        return

    print("\n--- Tabela de Calibração Atual (para conferência no Excel) ---")
    print(f"{'Ponto':<12} {'OD Ref (Y)':<14} {'OD Medida':<12} {'Bruto':<12} {'X = Bruto - Branco':<20}")
    print("-" * 70)
    print(f"{'Branco':<12} {'0.000 (base)':<14} {'0.000':<12} {sessao.branco_bruto:<12.1f} {'0.0':<20}")
    for p in sessao.pontos:
        x = p["bruto"] - sessao.branco_bruto
        print(f"{p['rotulo']:<12} {p['od_ref']:<14.3f} {p['od_medida']:<12.3f} {p['bruto']:<12.1f} {x:<20.1f}")
    print("-" * 70)

    reg = sessao.calcular_regressao()
    if reg:
        b_banco = reg["b"] - reg["a"] * reg["branco"]
        print(f"Reta (só os padrões):  OD = {reg['a']:.6f} * (bruto - {reg['branco']:.1f}) + {reg['b']:.4f}")
        print(f"R²:                    {reg['r2']:.4f} ({reg['r2'] * 100:.2f}%)")
        print(f"Gravado no banco:      a = {reg['a']:.6f}   b = b - a*branco = {b_banco:.4f}")
        print(f"                       (o consumidor converte cada leitura com OD = a * bruto + {b_banco:.4f})")
        print(f"OD do branco na curva: {reg['b']:.4f} (a reta não é forçada pelo zero)")
        if len(sessao.pontos) < 3:
            print("O servidor exige pelo menos 3 padrões além do branco.")
        print("O servidor usa a média das 6 leituras gravadas, que tem ruído:")
        print("os valores da tela podem diferir destes nas últimas casas.")
    else:
        print("Insira pelo menos 2 padrões para calcular a reta e o R².")
    print("Dica: digite 'tabela excel' para ver formato de copiar/colar.\n")


def comando_od(bruto: float, ruido: float | None) -> dict:
    """Comando que fixa o bruto do sensor. Sem `ruido_od`, a célula usa 0,1% do bruto."""
    comando = {"od_bruto": bruto}
    if ruido is not None:
        comando["ruido_od"] = ruido
    return comando


def enviar_comando(cli: mqtt.Client, celula: str, comando: dict) -> None:
    topico = f"evolver/simulador/{celula}/comando"
    cli.publish(topico, json.dumps(comando).encode("utf-8"), qos=1)


def conectar_mqtt(host: str, porta: int) -> mqtt.Client:
    cli = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id="evolver-simulador-cli")
    try:
        cli.connect(host, porta, keepalive=60)
        cli.loop_start()
        time.sleep(0.1)
        return cli
    except Exception as erro:
        print(f"Erro ao conectar no broker MQTT ({host}:{porta}): {erro}")
        sys.exit(1)


RAIZ = Path(__file__).resolve().parents[1]
PASTA_RELATORIOS = RAIZ / "relatorios"


class Registro:
    """Anota cada falha simulada (início e fim) em relatorios/falhas-simuladas.jsonl,
    para o relatório de falhas dizer se o sistema percebeu e se os dados ficaram
    completos. O relatório é do backend (app.relatorio.falhas); a importação
    fica dentro dos métodos porque a imagem Docker do simulador não tem o backend."""

    def __init__(self, url_banco: str, pasta: Path = PASTA_RELATORIOS):
        self.url_banco = url_banco
        self.pasta = pasta
        self.inicio_sessao = datetime.now(timezone.utc)
        self.falhas: list = []      # FalhaSimulada desta sessão
        self.relatadas = 0          # quantas já entraram num relatório gerado

    def _anotar(self, falha) -> None:
        from app.relatorio.falhas import ARQUIVO_SIMULADAS, anotar
        try:
            anotar(self.pasta / ARQUIVO_SIMULADAS, falha)
        except OSError as erro:
            print(f"Não consegui anotar a falha para o relatório: {erro}")

    def comecou(self, acao: str, por_s: float, alvo: str | None = None, fim_conhecido: bool = False):
        from app.relatorio.falhas import FalhaSimulada
        inicio = datetime.now(timezone.utc)
        falha = FalhaSimulada(acao=acao, inicio=inicio, alvo=alvo, previsto_s=por_s,
                              fim=inicio + timedelta(seconds=por_s) if fim_conhecido else None)
        self.falhas.append(falha)
        self._anotar(falha)

    def terminou(self, acao: str) -> None:
        for falha in reversed(self.falhas):
            if falha.acao == acao and falha.fim is None:
                falha.fim = datetime.now(timezone.utc)
                self._anotar(falha)
                return

    def pendentes(self) -> int:
        return len(self.falhas) - self.relatadas

    def gerar(self, desde: datetime | None = None) -> None:
        import psycopg
        from app.relatorio.falhas import gerar, resumo_curto
        desde = desde or self.inicio_sessao
        simuladas = [f for f in self.falhas if f.inicio >= desde]
        origem = "simulador (CLI)" if simuladas else "período"
        print("Gerando o relatório de falhas...")
        try:
            relatorio, md, js = gerar(self.url_banco, desde, None, self.pasta, simuladas or None, origem)
        except psycopg.OperationalError:
            print(f"Não consegui abrir o banco em {self.url_banco}. Use --banco ou DATABASE_URL.")
            return
        self.relatadas = len(self.falhas)
        print("\n".join(resumo_curto(relatorio)))
        print(f"Relatório salvo em {md}")
        print(f"                  {js}")
        if relatorio["resumo"]["falhas_em_andamento"] or relatorio["resumo"]["alertas_abertos"]:
            print("Ainda há falha em andamento ou alerta aberto. Gere de novo daqui a pouco com 'relatorio',")
            print(f"ou depois com: python -m app.relatorio.falhas --desde \"{_hora_local(desde)}\"")


def _hora_local(dt: datetime) -> str:
    return dt.astimezone().strftime("%Y-%m-%d %H:%M:%S")


class Falhas:
    """Quedas de comunicação do lado do servidor, pelo Docker Compose.

    servidor  pausa o enlace (cabo servidor <-> Raspberry Pi do broker)
    broker    para o broker (Raspberry Pi ou broker fora do ar)
    consumidor  para o processo consumidor

    Cada uma volta sozinha depois do tempo pedido. Ao sair da CLI, o que
    ainda estiver cortado é religado. Início e fim vão para o registro."""

    ACOES = {
        "servidor": (("pause", "enlace"), ("unpause", "enlace")),
        "broker": (("stop", "broker"), ("start", "broker")),
        "consumidor": (("stop", "consumidor"), ("start", "consumidor")),
    }

    def __init__(self, registro: Registro | None = None):
        self.ativas: dict[str, threading.Timer] = {}
        self.registro = registro

    @staticmethod
    def _compose(*args: str) -> bool:
        try:
            r = subprocess.run(["docker", "compose", *args], cwd=RAIZ, capture_output=True, text=True)
        except FileNotFoundError:
            print("Docker não encontrado. Esses comandos só funcionam com o sistema no Docker Compose.")
            return False
        if r.returncode != 0:
            print(f"docker compose {' '.join(args)} falhou: {r.stderr.strip()}")
            return False
        return True

    def cortar(self, nome: str, por_s: float) -> bool:
        if nome in self.ativas:
            self.ativas.pop(nome).cancel()
        if not self._compose(*self.ACOES[nome][0]):
            return False
        if self.registro:
            self.registro.terminou(nome)  # corte repetido: o anterior termina aqui
            self.registro.comecou(nome, por_s)
        timer = threading.Timer(por_s, self._volta_automatica, args=(nome,))
        timer.daemon = True
        timer.start()
        self.ativas[nome] = timer
        return True

    def _volta_automatica(self, nome: str) -> None:
        if self.ativas.pop(nome, None) is not None and self._compose(*self.ACOES[nome][1]):
            if self.registro:
                self.registro.terminou(nome)
            print(f"\n[{nome}] religado automaticamente. (Enter para o prompt)")

    def religar(self, nome: str) -> bool:
        timer = self.ativas.pop(nome, None)
        if timer:
            timer.cancel()
        if not self._compose(*self.ACOES[nome][1]):
            return False
        if self.registro:
            self.registro.terminou(nome)
        return True

    def religar_tudo(self) -> None:
        for nome in list(self.ativas):
            if self.religar(nome):
                print(f"[{nome}] religado ao sair.")


AJUDA_FALHAS = {
    "servidor": (
        "Cabo servidor <-> Raspberry Pi cortado (enlace pausado). As células seguem ligadas ao broker.",
        "Em ~30-45 s o consumidor e a API percebem; ~20 s depois abre o alerta broker_inacessivel.",
        "Nenhuma célula ganha sem_comunicacao: o problema é do servidor. Setpoint pela tela dá 503.",
        "O broker guarda as leituras para o consumidor; ao religar, chegam todas, sem buracos.",
    ),
    "broker": (
        "Broker parado (Raspberry Pi ou broker fora do ar). Células, consumidor e API perdem a conexão.",
        "Em ~20 s abre o alerta broker_inacessivel. As células guardam as leituras no buffer local",
        "e reenviam quando o broker voltar. Nenhuma célula ganha sem_comunicacao.",
    ),
    "consumidor": (
        "Consumidor parado. Em ~30 s abre o alerta consumidor_parado e a barra lateral mostra 'parado'.",
        "O broker guarda as leituras na sessão do consumidor; ao voltar, chegam todas.",
    ),
}


def comando_falha(falhas: Falhas, nome: str, args: list[str], padrao_s: float) -> None:
    acao = args[0].lower() if args else "cortar"
    if acao in ("voltar", "religar", "ligar", "start"):
        if falhas.religar(nome):
            print(f"[{nome}] religado.")
        return
    por_s = padrao_s
    if len(args) > 1 or (args and acao not in ("cortar", "parar")):
        try:
            por_s = float(args[-1])
        except ValueError:
            print(f"Uso: {nome} cortar|parar [segundos] | {nome} voltar")
            return
    if falhas.cortar(nome, por_s):
        print(f"[{nome}] cortado por {por_s:.0f} s (volta sozinho; '{nome} voltar' religa antes).")
        for linha in AJUDA_FALHAS[nome]:
            print(f"       {linha}")


def parse_comando_padrao(args: list[str]) -> tuple[float, float, float]:
    """Interpreta:
      padrao 0.2 valor 0.235
      padrao 0.2 0.235
      padrao 0.2
      padrao 0.2 bruto 570
    Retorna: (od_ref, od_medida, od_bruto)
    """
    if not args:
        raise ValueError("Informe a OD de referência (ex: padrao 0.2 valor 0.235)")

    od_ref = float(args[0])
    od_medida = od_ref
    bruto = None

    i = 1
    while i < len(args):
        token = args[i].lower()
        if token == "valor" and i + 1 < len(args):
            if args[i + 1].lower() == "bruto" and i + 2 < len(args):
                bruto = float(args[i + 2])
                i += 3
                continue
            od_medida = float(args[i + 1])
            i += 2
            continue
        elif token == "bruto" and i + 1 < len(args):
            bruto = float(args[i + 1])
            i += 2
            continue
        else:
            # número solto após od_ref: assume od_medida
            try:
                od_medida = float(token)
            except ValueError:
                pass
            i += 1

    if bruto is None:
        bruto = 2000.0 * od_medida + 100.0
    return od_ref, od_medida, bruto


def modo_interativo(cli: mqtt.Client, celula_inicial: str = "c04", url_banco: str = ""):
    celula = celula_inicial
    sessao = SessaoCalibracao()
    registro = Registro(url_banco)
    falhas = Falhas(registro)
    try:
        _laco(cli, celula, sessao, falhas, registro)
    finally:
        falhas.religar_tudo()
        if registro.pendentes():
            registro.gerar()


def _laco(cli: mqtt.Client, celula: str, sessao: SessaoCalibracao, falhas: Falhas, registro: Registro) -> None:

    print("=" * 72)
    print("  T.U.P.A - Terminal Interativo de Calibração e Alertas")
    print("=" * 72)
    print(f"Célula selecionada: {celula} (use 'celula <id>' para trocar)")
    print("\nCalibração ao vivo: abra 'Nova calibração' da célula na interface.")
    print("A cada comando abaixo, a célula manda 6 leituras estáveis em ~3 s;")
    print("aí é só clicar em gravar o ponto na tela.")
    print("  branco                    -> grave o branco na tela")
    print("  padrao 0.2 valor 0.235    -> na tela, OD de referência 0.2, e grave")
    print("  padrao 0.35 valor 0.342")
    print("  padrao 0.5 valor 0.510")
    print("  padrao 0.8 valor 0.795")
    print("  tabela                    -> confere a, b, R² e o b gravado no banco")
    print("  auto                      -> devolve a célula à simulação normal")
    print("\nQuedas de comunicação: rede [todas] [s], servidor [s], broker [s], consumidor [s]")
    print("Relatório de falhas: relatorio [2h] (gerado sozinho ao sair, se houve falha simulada)")
    print("('ajuda' mostra tudo)\n")

    while True:
        try:
            linha = input(f"[{celula}]> ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nEncerrando terminal...")
            break

        if not linha:
            continue

        partes = linha.split()
        cmd = partes[0].lower()
        args = partes[1:]

        if cmd in ("sair", "exit", "quit"):
            break

        elif cmd in ("ajuda", "help", "?"):
            print("\nComandos disponíveis:")
            print("  branco [<bruto>]           -> sensor lê o branco (padrão: bruto 100)")
            print("  padrao <REF> valor <MED>   -> padrão de OD REF, sensor lê como OD MED (ex: padrao 0.2 valor 0.235)")
            print("  padrao <REF> bruto <B>     -> padrão de OD REF com o bruto B digitado")
            print("  bruto <VALOR>              -> define contagem bruta direta (ex: bruto 570)")
            print("  ruido <SIGMA>|auto         -> desvio padrão do bruto forçado (auto = 0,1% do valor; 0 = exato)")
            print("  tabela [excel|limpar]      -> visualiza os pontos, R² ou formato Excel")
            print("  temp <GRAUS_C>             -> altera temperatura (ex: temp 38.5 para alerta)")
            print("  ph <VALOR>                 -> altera pH (ex: ph 5.5 para alerta)")
            print("  cenario <NOME>             -> normal | desvio_temperatura | falha_aquecimento | ignorar_setpoint")
            print("\n  Quedas de comunicação (todas voltam sozinhas depois do tempo):")
            print("  rede [SEGUNDOS]            -> ESP <-> Raspberry: corta o Wi-Fi da célula ativa (padrão 120 s)")
            print("  rede todas [SEGUNDOS]      -> ESP <-> Raspberry: corta o Wi-Fi de todas as células")
            print("                                (alerta sem_comunicacao em cada célula em ~45 s)")
            print("  servidor [SEGUNDOS]        -> Raspberry <-> servidor: corta o cabo (padrão 120 s)")
            print("  broker [SEGUNDOS]          -> para o broker / Raspberry (padrão 60 s)")
            print("  consumidor [SEGUNDOS]      -> para o consumidor (padrão 60 s)")
            print("                                (alertas broker_inacessivel ou consumidor_parado)")
            print("  servidor|broker|consumidor voltar -> religa antes do tempo")
            print("  relatorio [PERÍODO]        -> relatório de falhas em relatorios/ (Markdown e JSON),")
            print("                                desde que a CLI abriu ou do período (30m, 2h, 1d)\n")
            print("  colisao                    -> republica o último seq com outro horário (alerta colisao_seq)")
            print("  auto                       -> restaura o modelo biológico contínuo")
            print("  celula <ID>                -> troca a célula ativa (c01 a c16 ou 'todos')\n")

        elif cmd == "tabela":
            if args and args[0].lower() == "excel":
                imprimir_tabela(sessao, formato_excel=True)
            elif args and args[0].lower() == "limpar":
                sessao.limpar()
                print("Tabela de calibração resetada.")
            else:
                imprimir_tabela(sessao, formato_excel=False)

        elif cmd == "celula":
            if args:
                celula = args[0]
                print(f"Célula ativa alterada para: {celula}")
            else:
                print(f"Célula atual: {celula}. Use 'celula <id>' para alterar.")

        elif cmd == "branco":
            bruto = 100.0
            if args:
                try:
                    if args[0].lower() == "valor" and len(args) > 1:
                        val = float(args[1])
                    else:
                        val = float(args[0])
                    bruto = val if val > 20.0 else (2000.0 * val + 100.0)
                except ValueError:
                    print("Valor de branco inválido. Usando 100.0.")
            sessao.registrar_branco(bruto)
            enviar_comando(cli, celula, comando_od(bruto, sessao.ruido))
            print(f"[{celula}] Sensor lendo o branco: bruto ~{bruto:.1f}.")
            print("       Em ~3 s a tela mostra 'estável'. Grave o branco.")

        elif cmd == "padrao":
            try:
                od_ref, od_medida, bruto = parse_comando_padrao(args)
            except ValueError as e:
                print(f"Erro no comando padrao: {e}")
                print("Exemplo: padrao 0.2 valor 0.235")
                continue

            rotulo = f"Padrão {od_ref}"
            sessao.adicionar_ponto(rotulo, od_ref, od_medida, bruto)
            enviar_comando(cli, celula, comando_od(bruto, sessao.ruido))
            x = bruto - sessao.branco_bruto
            print(f"[{celula}] {rotulo}: sensor lendo bruto ~{bruto:.1f} (x = bruto - branco = {x:.1f})")
            print(f"       Em ~3 s fica estável. Na tela, OD de referência {od_ref} e grave o ponto.")

        elif cmd == "bruto":
            if not args:
                print("Uso: bruto <valor> (ex: bruto 570)")
                continue
            try:
                bruto = float(args[0])
                enviar_comando(cli, celula, comando_od(bruto, sessao.ruido))
                print(f"[{celula}] Sensor lendo bruto ~{bruto:.1f}.")
            except ValueError:
                print("Valor numérico inválido.")

        elif cmd == "ruido":
            if not args:
                atual = "0,1% do valor" if sessao.ruido is None else f"{sessao.ruido}"
                print(f"Ruído atual do bruto forçado: {atual}. Use 'ruido 2' ou 'ruido auto'.")
                continue
            if args[0].lower() == "auto":
                sessao.ruido = None
                print("Ruído do bruto forçado: 0,1% do valor.")
                continue
            try:
                sessao.ruido = max(0.0, float(args[0]))
                print(f"Ruído do bruto forçado: desvio padrão {sessao.ruido}. Vale a partir do próximo comando.")
                print("Com ruído alto a tela não fica estável (variação de 1% ou mais) e não deixa gravar.")
            except ValueError:
                print("Valor numérico inválido.")

        elif cmd == "temp":
            if not args:
                print("Uso: temp <graus_c> (ex: temp 38.5)")
                continue
            try:
                t = float(args[0])
                enviar_comando(cli, celula, {"temperatura_c": t})
                print(f"[{celula}] Temperatura definida para {t:.1f} °C")
            except ValueError:
                print("Valor numérico inválido.")

        elif cmd == "ph":
            if not args:
                print("Uso: ph <valor> (ex: ph 5.5)")
                continue
            try:
                p = float(args[0])
                enviar_comando(cli, celula, {"ph": p})
                print(f"[{celula}] pH definido para {p:.2f}")
            except ValueError:
                print("Valor numérico inválido.")

        elif cmd == "cenario":
            if not args:
                print("Uso: cenario <normal|desvio_temperatura|falha_aquecimento|ignorar_setpoint>")
                continue
            cenario = args[0].lower()
            enviar_comando(cli, celula, {"cenario": cenario})
            print(f"[{celula}] Cenário alterado para {cenario}")

        elif cmd == "rede":
            # Com a rede cortada a célula não ouve mais o broker: a volta é automática.
            alvo = celula
            if args and args[0].lower() in ("todas", "todos"):
                alvo, args = "todos", args[1:]
            por_s = 120.0
            if args:
                try:
                    por_s = float(args[-1])
                except ValueError:
                    print("Uso: rede [todas] [segundos] (ex: rede 120). A rede volta sozinha depois desse tempo.")
                    continue
            enviar_comando(cli, alvo, {"rede": "cortar", "por_s": por_s})
            # A célula volta sozinha: o fim já é conhecido.
            registro.comecou("rede", por_s, alvo=alvo, fim_conhecido=True)
            print(f"[{alvo}] Rede cortada por {por_s:.0f} s, sem aviso ao broker.")
            print("       O broker declara a célula offline em ~45 s (alerta sem_comunicacao).")
            print("       As leituras ficam guardadas na célula e são reenviadas quando a rede voltar.")

        elif cmd in ("servidor", "broker", "consumidor"):
            comando_falha(falhas, cmd, args, 120.0 if cmd == "servidor" else 60.0)

        elif cmd in ("relatorio", "relatório"):
            desde = None
            if args:
                from app.relatorio.falhas import instante
                try:
                    desde = instante(" ".join(args))
                except ValueError:
                    print("Uso: relatorio [30m|2h|1d|'2026-11-11 14:00']")
                    continue
            registro.gerar(desde)

        elif cmd == "colisao":
            enviar_comando(cli, celula, {"colisao": True})
            print(f"[{celula}] Último seq publicado de novo com outro horário.")
            print("       A leitura original fica; o consumidor abre o alerta colisao_seq, que não fecha sozinho.")

        elif cmd == "auto":
            enviar_comando(cli, celula, {"auto": True})
            print(f"[{celula}] Modo automático restaurado.")

        else:
            print(f"Comando desconhecido: '{cmd}'. Digite 'ajuda' para instruções.")


def main():
    parser = argparse.ArgumentParser(description="Terminal de controle e injeção de dados no simulador T.U.P.A")
    parser.add_argument("celula", nargs="?", default="c04", help="ID da célula alvo (padrão: c04)")
    parser.add_argument("--mqtt-host", default=os.environ.get("MQTT_HOST", "localhost"), help="Host do broker MQTT")
    parser.add_argument("--mqtt-port", type=int, default=int(os.environ.get("MQTT_PORT", 1883)), help="Porta MQTT")
    parser.add_argument("--banco", default=os.environ.get(
        "DATABASE_URL", "postgresql://evolver:evolver@localhost:5432/evolver"),
        help="URL do PostgreSQL, para o relatório de falhas")

    parser.add_argument("--branco", action="store_true", help="Ajusta sensor para o branco (od_bruto=100)")
    parser.add_argument("--padrao", type=float, help="OD de referência do padrão (ex: 0.2)")
    parser.add_argument("--valor", type=float, help="OD medida correspondente ao padrão (ex: 0.235)")
    parser.add_argument("--bruto", type=float, help="Ajusta contagem bruta diretamente (ex: 570)")
    parser.add_argument("--temp", type=float, help="Ajusta temperatura diretamente (ex: 38.5)")
    parser.add_argument("--ph", type=float, help="Ajusta pH diretamente (ex: 5.5)")
    parser.add_argument("--cenario", type=str, help="Altera o cenário (normal, desvio_temperatura, etc.)")
    parser.add_argument("--auto", action="store_true", help="Restaura a simulação automática da cultura")

    args = parser.parse_args()

    tem_comando = False
    comando = {}

    if args.auto:
        comando["auto"] = True
        tem_comando = True
    if args.branco:
        comando["od_bruto"] = 100.0
        tem_comando = True
    if args.padrao is not None:
        medida = args.valor if args.valor is not None else args.padrao
        comando["od_bruto"] = 2000.0 * medida + 100.0
        tem_comando = True
    elif args.valor is not None:
        comando["od_bruto"] = 2000.0 * args.valor + 100.0
        tem_comando = True
    if args.bruto is not None:
        comando["od_bruto"] = args.bruto
        tem_comando = True
    if args.temp is not None:
        comando["temperatura_c"] = args.temp
        tem_comando = True
    if args.ph is not None:
        comando["ph"] = args.ph
        tem_comando = True
    if args.cenario:
        comando["cenario"] = args.cenario
        tem_comando = True

    if tem_comando:
        cli = conectar_mqtt(args.mqtt_host, args.mqtt_port)
        enviar_comando(cli, args.celula, comando)
        print(f"Comando enviado com sucesso para {args.celula}: {comando}")
        time.sleep(0.2)
        cli.loop_stop()
        cli.disconnect()
        return

    # Modo interativo (padrão)
    cli = conectar_mqtt(args.mqtt_host, args.mqtt_port)
    try:
        modo_interativo(cli, args.celula, args.banco)
    finally:
        cli.loop_stop()
        cli.disconnect()


if __name__ == "__main__":
    main()
