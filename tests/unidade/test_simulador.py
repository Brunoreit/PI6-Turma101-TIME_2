from buffer import Buffer
from modelo import ModeloCultivo


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
