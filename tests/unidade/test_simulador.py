import json
from unittest.mock import MagicMock

from simulador.buffer import Buffer
from simulador.celula import Celula
from simulador.modelo import ModeloCultivo
from simulador.perfis import PERFIS_PADRAO, obter_perfil


def test_temperatura_converge_ao_setpoint():
    modelo = ModeloCultivo(temperatura_c=30, setpoint_c=37, tau_s=10)
    for _ in range(100):
        modelo.avancar(1)
    assert abs(modelo.temperatura_c - 37) < 0.01


def test_falha_de_aquecimento_esfria_a_cultura():
    modelo = ModeloCultivo(temperatura_c=37, setpoint_c=37, tau_s=10, falha_aquecimento=True)
    for _ in range(100):
        modelo.avancar(1)
    assert modelo.temperatura_c < 34


def test_desvio_temperatura_converge_ao_alvo_deslocado():
    modelo = ModeloCultivo(temperatura_c=30, setpoint_c=30, desvio_temperatura=3.4, tau_s=10)
    for _ in range(100):
        modelo.avancar(1)
    assert abs(modelo.temperatura_c - 33.4) < 0.01


def test_od_inicial_configurada():
    modelo = ModeloCultivo(od_inicial=0.615)
    assert abs(modelo.od - 0.615) < 0.01


def test_ph_base_personalizado():
    modelo = ModeloCultivo(ph_base=6.55, od_inicial=0.4, ruido_ph=0.0)
    leitura = modelo.medir()
    assert 6.4 <= leitura["ph"] <= 6.6


def test_definir_manual_od_e_bruto():
    modelo = ModeloCultivo()
    # Padrão por OD direta (ex: 0.200 -> 2000 * 0.2 + 100 = 500)
    modelo.definir_manual(od=0.2, ruido_od=0.0)
    assert modelo.medir()["od_bruto"] == 500.0

    # Padrão por valor bruto direto
    modelo.definir_manual(od_bruto=1200.0, ruido_od=0.0)
    assert modelo.medir()["od_bruto"] == 1200.0

    # Desativar e voltar ao automático
    modelo.desativar_manual()
    assert modelo.od_bruto_manual is None


def test_definir_manual_temperatura_e_ph():
    modelo = ModeloCultivo()
    modelo.definir_manual(temperatura_c=39.2, ph=5.4)
    medicao = modelo.medir()
    assert abs(medicao["temperatura_c"] - 39.2) < 0.2
    assert abs(medicao["ph"] - 5.4) < 0.05


def test_od_cresce_e_estabiliza():
    modelo = ModeloCultivo()
    inicio = modelo.od
    modelo.avancar(3600 * 4)
    meio = modelo.od
    modelo.avancar(3600 * 40)
    assert inicio < meio < modelo.od <= modelo.od_max


def test_seq_continua_depois_de_reiniciar(tmp_path):
    caminho = tmp_path / "c01.db"
    primeiro = Buffer(caminho)
    assert [primeiro.proximo_seq() for _ in range(3)] == [0, 1, 2]
    reiniciado = Buffer(caminho)
    assert reiniciado.proximo_seq() == 3


def test_buffer_guarda_em_ordem_ate_confirmar(tmp_path):
    buffer = Buffer(tmp_path / "c01.db")
    for seq in (2, 0, 1):
        buffer.guardar(seq, f"leitura {seq}".encode())
    assert [s for s, _ in buffer.pendentes()] == [0, 1, 2]
    buffer.remover(0)
    assert buffer.quantidade() == 2


def test_perfis_padrao_16_celulas():
    assert len(PERFIS_PADRAO) == 16
    assert "c01" in PERFIS_PADRAO
    assert "c16" in PERFIS_PADRAO

    # c03 deve ter desvio de temperatura para simular alerta do Figma
    p03 = obter_perfil("c03")
    assert p03.cenario == "desvio_temperatura"
    assert p03.desvio_temperatura > 0

    # c08 deve ter pH ácido do EXP-02
    p08 = obter_perfil("c08")
    assert p08.ph_base < 6.7


def test_celula_instanciacao_com_perfil(tmp_path):
    c = Celula(id_celula="c03", buffer_dir=tmp_path)
    assert c.id == "c03"
    assert c.cenario == "desvio_temperatura"
    assert c.modelo.desvio_temperatura == 3.4


def test_celula_recebe_comando_simulador_manual(tmp_path):
    c = Celula(id_celula="c04", buffer_dir=tmp_path)
    msg = MagicMock()
    msg.payload = json.dumps({"od": 0.35, "imediato": False}).encode("utf-8")

    c._ao_receber_comando_simulador(None, None, msg)
    assert c.modelo.od_bruto_manual == 2000.0 * 0.35 + 100.0

    # Volta ao automático
    msg.payload = json.dumps({"auto": True}).encode("utf-8")
    c._ao_receber_comando_simulador(None, None, msg)
    assert c.modelo.od_bruto_manual is None


def test_valor_forcado_pede_rajada_estavel_para_a_calibracao(tmp_path):
    """O branco (bruto baixo) tem de ficar tão estável quanto os padrões:
    o ruído é proporcional ao bruto, e a rajada enche a janela de 6 leituras."""
    from app.calibracao.ajuste import estavel, resumir

    c = Celula(id_celula="c04", buffer_dir=tmp_path)
    msg = MagicMock()
    for bruto in (100.0, 570.0, 1690.0):
        msg.payload = json.dumps({"od_bruto": bruto}).encode("utf-8")
        c._ao_receber_comando_simulador(None, None, msg)
        assert c.rajada == 6
        for _ in range(50):
            janela = resumir([c.modelo.medir()["od_bruto"] for _ in range(6)])
            assert estavel(janela, 6, 0.01)
            assert abs(janela.media - bruto) < bruto * 0.005

    # Temperatura e pH pedem só uma leitura imediata
    msg.payload = json.dumps({"temperatura_c": 38.5}).encode("utf-8")
    c._ao_receber_comando_simulador(None, None, msg)
    assert c.rajada == 1


def test_comandos_de_rede_e_colisao(tmp_path):
    from contrato import Leitura

    c = Celula(id_celula="c04", buffer_dir=tmp_path)
    msg = MagicMock()
    msg.payload = json.dumps({"rede": "cortar", "por_s": 30}).encode("utf-8")
    c._ao_receber_comando_simulador(None, None, msg)
    assert c.pedido_corte == "cortar" and c.restaurar_em is not None

    msg.payload = json.dumps({"colisao": True}).encode("utf-8")
    c._ao_receber_comando_simulador(None, None, msg)
    assert c.pedido_colisao

    # A colisão reusa o último seq já gravado, com outro horário
    c._medir()
    original = Leitura.de_json(c.buffer.pendentes()[-1][1])
    c.conectado.set()
    c.cliente = MagicMock()
    assert c._publicar_colisao() == original.seq
    publicada = Leitura.de_json(c.cliente.publish.call_args.args[1])
    assert publicada.seq == original.seq and publicada.ts != original.ts


def test_historico_tem_seq_continuo_e_horarios_passados(tmp_path):
    from contrato import Leitura

    c = Celula(id_celula="c01", buffer_dir=tmp_path, historico_horas=2, historico_passo_min=20)
    assert c._gerar_historico() == 6
    leituras = [Leitura.de_json(p) for _, p in c.buffer.pendentes()]
    assert [l.seq for l in leituras] == list(range(6))
    assert all(a.ts < b.ts for a, b in zip(leituras, leituras[1:]))
    # A cultura cresce ao longo do histórico até a OD atual do perfil
    assert leituras[0].od_bruto < leituras[-1].od_bruto
    assert c.buffer.ler("proximo_seq") == "6"

    # Depois da primeira subida não gera de novo: o seq continua de onde parou
    assert Celula(id_celula="c01", buffer_dir=tmp_path, historico_horas=2)._gerar_historico() == 0


def test_parse_comando_padrao_sintaxe():
    from simulador.cli import parse_comando_padrao, SessaoCalibracao

    # Sintaxe: padrao 0.2 valor 0.235
    ref, med, bruto = parse_comando_padrao(["0.2", "valor", "0.235"])
    assert ref == 0.2
    assert med == 0.235
    assert abs(bruto - 570.0) < 0.01

    # Sintaxe: padrao 0.5 (sem valor medido)
    ref2, med2, bruto2 = parse_comando_padrao(["0.5"])
    assert ref2 == 0.5
    assert med2 == 0.5
    assert abs(bruto2 - 1100.0) < 0.01

    # Cálculo da regressão na sessão
    sessao = SessaoCalibracao()
    sessao.registrar_branco(100.0)
    sessao.adicionar_ponto("P1", 0.2, 0.2, 500.0)
    sessao.adicionar_ponto("P2", 0.4, 0.4, 900.0)
    sessao.adicionar_ponto("P3", 0.6, 0.6, 1300.0)

    reg = sessao.calcular_regressao()
    assert reg is not None
    assert abs(reg["a"] - 0.0005) < 1e-6
    assert abs(reg["b"] - 0.0) < 1e-4
    assert abs(reg["r2"] - 1.0) < 1e-4
