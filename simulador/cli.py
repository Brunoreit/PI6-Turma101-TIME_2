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
"""

import argparse
import json
import math
import os
import sys
import time

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


def modo_interativo(cli: mqtt.Client, celula_inicial: str = "c04"):
    celula = celula_inicial
    sessao = SessaoCalibracao()

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
    print("  auto                      -> devolve a célula à simulação normal\n")

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
            print("  rede [SEGUNDOS]            -> corta a rede (padrão 120 s); volta sozinha (alerta sem_comunicacao)")
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
            por_s = 120.0
            if args:
                try:
                    por_s = float(args[-1])
                except ValueError:
                    print("Uso: rede [segundos] (ex: rede 120). A rede volta sozinha depois desse tempo.")
                    continue
            enviar_comando(cli, celula, {"rede": "cortar", "por_s": por_s})
            print(f"[{celula}] Rede cortada por {por_s:.0f} s, sem aviso ao broker.")
            print("       O broker declara a célula offline em ~45 s (alerta sem_comunicacao).")
            print("       As leituras ficam guardadas na célula e são reenviadas quando a rede voltar.")

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
        modo_interativo(cli, args.celula)
    finally:
        cli.loop_stop()
        cli.disconnect()


if __name__ == "__main__":
    main()
