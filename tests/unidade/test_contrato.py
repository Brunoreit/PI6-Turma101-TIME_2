from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from contrato import Estado, Leitura, PedidoSetpoint, RespostaSetpoint, topicos


def test_topicos_seguem_o_formato():
    assert topicos.leitura("c01") == "evolver/v1/celula/c01/leitura"
    assert topicos.setpoint_resposta("c01") == "evolver/v1/celula/c01/setpoint/resposta"


def test_interpretar_separa_id_e_tipo():
    assert topicos.interpretar("evolver/v1/celula/c07/leitura") == ("c07", "leitura")
    assert topicos.interpretar("evolver/v1/celula/c07/setpoint/resposta") == ("c07", "setpoint/resposta")


@pytest.mark.parametrize("topico", [
    "outro/v1/celula/c01/leitura",
    "evolver/v1/celula/c01/desconhecido",
    "evolver/v1/celula/../leitura",
])
def test_interpretar_rejeita_topicos_fora_do_contrato(topico):
    with pytest.raises(ValueError):
        topicos.interpretar(topico)


def test_leitura_ida_e_volta_em_json():
    original = Leitura(seq=5, ts=datetime(2026, 10, 6, tzinfo=timezone.utc),
                       temperatura_c=30.1, od_bruto=210.0, ph=6.9)
    assert Leitura.de_json(original.para_json()) == original


def test_leitura_aceita_campo_desconhecido_e_o_guarda_a_parte():
    leitura = Leitura.de_json(b'{"seq": 1, "ts": "2026-10-06T00:00:00Z", "temperatura": 30}')
    assert leitura.model_extra == {"temperatura": 30}
    assert leitura.temperatura_c is None


def test_leitura_aceita_qualquer_ph_e_rejeita_seq_negativo():
    for ph in (15, -1):
        assert Leitura(seq=1, ts=datetime.now(timezone.utc), ph=ph).ph == ph
    with pytest.raises(ValidationError):
        Leitura(seq=-1, ts=datetime.now(timezone.utc))


@pytest.mark.parametrize("modelo, payload", [
    (Estado, b'{"estado": "online", "firmware": "1.0"}'),
    (PedidoSetpoint, b'{"id": "sp-1", "temperatura_c": 37, "urgente": true}'),
    (RespostaSetpoint, b'{"id": "sp-1", "estado": "aplicado", "obs": "ok"}'),
])
def test_outras_mensagens_rejeitam_campo_desconhecido(modelo, payload):
    with pytest.raises(ValidationError):
        modelo.de_json(payload)


def test_estado_e_setpoint():
    assert Estado.de_json(b'{"estado": "offline"}').estado == "offline"
    assert PedidoSetpoint.de_json(b'{"id": "sp-1", "temperatura_c": 37}').temperatura_c == 37
    with pytest.raises(ValidationError):
        RespostaSetpoint.de_json(b'{"id": "sp-1", "estado": "atingido"}')
