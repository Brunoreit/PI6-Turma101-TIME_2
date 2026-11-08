import asyncio
import dataclasses

import pytest

from app.api import autenticacao
from app.api.autenticacao import conferir_senha, emitir_token, ler_token, resumir_senha

SEGREDO = "segredo-de-teste"
AGORA = 1_800_000_000.0


def test_resumo_da_senha_confere_e_nao_contem_a_senha():
    resumo = resumir_senha("cultura123")
    assert resumo.startswith("scrypt$16384$8$1$")
    assert "cultura123" not in resumo
    assert conferir_senha("cultura123", resumo)
    assert not conferir_senha("cultura124", resumo)


def test_mesma_senha_gera_resumos_diferentes():
    assert resumir_senha("cultura123") != resumir_senha("cultura123")


@pytest.mark.parametrize("resumo", ["x", "", "bcrypt$1$2$3$YQ==$YQ==", "scrypt$16384$8$1$não-é-base64$YQ=="])
def test_resumo_malformado_nunca_confere(resumo):
    assert not conferir_senha("cultura123", resumo)


def test_token_valido_devolve_a_pessoa():
    token = emitir_token(7, SEGREDO, horas=12, agora=AGORA)
    assert ler_token(token, SEGREDO, agora=AGORA + 12 * 3600 - 1) == 7


def test_token_expirado_e_recusado():
    token = emitir_token(7, SEGREDO, horas=12, agora=AGORA)
    assert ler_token(token, SEGREDO, agora=AGORA + 12 * 3600) is None


def test_token_de_outro_segredo_e_recusado():
    assert ler_token(emitir_token(7, "outro-segredo", horas=12, agora=AGORA), SEGREDO, agora=AGORA) is None


def test_trocar_qualquer_caractere_do_token_invalida():
    token = emitir_token(7, SEGREDO, horas=12, agora=AGORA)
    for i, c in enumerate(token):
        for troca in {"A", "B", "x", "."} - {c}:
            adulterado = token[:i] + troca + token[i + 1:]
            assert ler_token(adulterado, SEGREDO, agora=AGORA) is None, adulterado


@pytest.mark.parametrize("token", ["", ".", "abc", "abc.def", "ção.ção", "a.b.c"])
def test_token_malformado_e_recusado(token):
    assert ler_token(token, SEGREDO, agora=AGORA) is None


def test_payload_com_tipos_errados_e_recusado():
    parte = autenticacao._b64url(b'{"p": "7", "exp": 9999999999}')
    assert ler_token(f"{parte}.{autenticacao._assinatura(parte, SEGREDO)}", SEGREDO, agora=AGORA) is None


def test_api_nao_sobe_sem_segredo_de_sessao(monkeypatch):
    from app.api import main

    monkeypatch.setattr(main, "config", dataclasses.replace(main.config, segredo_sessao=""))

    async def subir():
        async with main.ciclo_de_vida(main.app):
            pass

    with pytest.raises(RuntimeError, match="SEGREDO_SESSAO"):
        asyncio.run(subir())
