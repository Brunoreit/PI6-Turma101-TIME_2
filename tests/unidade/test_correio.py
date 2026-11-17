"""E-mail dos alertas (app/avisos/correio.py), sem banco e sem servidor de e-mail."""

import smtplib
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from app.avisos import correio
from app.config import Config

CFG = replace(Config(), smtp_host="smtp.teste", smtp_porta=1025, smtp_usuario="", smtp_senha="",
              smtp_seguranca="nenhuma", email_remetente="T.U.P.A <alertas@tupa.local>",
              interface_url="http://tupa.local:8080/", email_repetir_s=300, email_fuso="America/Sao_Paulo")


def _alerta(**campos) -> dict:
    return {"id_alerta": 7, "id_celula": "c03", "mensagem": "Temperatura alta: Temperatura em 61.0 °C, acima de 50.0 °C há mais de 2 min.",
            "aberto_em": datetime(2026, 11, 17, 14, 2, tzinfo=timezone.utc), "id_regra": 3, "regra_nome": "Temperatura alta",
            "gravidade": "aviso", "id_experimento": None, "experimento_nome": None,
            "destinatarios": ["ana@cnpem.br", "henry@cnpem.br"], **campos}


class SmtpFalso:
    """Guarda o que seria enviado. `falhar` faz o envio dar erro."""

    enviados: list = []
    falhar = False
    conexoes = 0

    def __init__(self, host, porta, timeout):
        SmtpFalso.conexoes += 1
        self.host, self.porta = host, porta

    def send_message(self, msg):
        if SmtpFalso.falhar:
            raise smtplib.SMTPRecipientsRefused({})
        SmtpFalso.enviados.append(msg)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


@pytest.fixture
def ambiente(monkeypatch):
    SmtpFalso.enviados, SmtpFalso.falhar, SmtpFalso.conexoes = [], False, 0
    marcados = []
    pendentes = [_alerta()]
    monkeypatch.setattr(correio.smtplib, "SMTP", SmtpFalso)
    monkeypatch.setattr(correio.repo, "emails_pendentes", lambda conn, repetir: list(pendentes))
    monkeypatch.setattr(correio.repo, "marcar_email", lambda conn, id_alerta, erro: marcados.append((id_alerta, erro)))
    return pendentes, marcados


def test_mensagem_do_alerta():
    msg = correio.montar(_alerta(), CFG)
    assert msg["Subject"] == "[T.U.P.A] Temperatura alta · célula c03"
    assert msg["To"] == "ana@cnpem.br, henry@cnpem.br"
    # O nome vai entre aspas porque tem pontos.
    assert (msg["From"].addresses[0].display_name, msg["From"].addresses[0].addr_spec) == ("T.U.P.A", "alertas@tupa.local")
    texto = msg.get_content()
    assert 'A regra "Temperatura alta" abriu um alerta na célula c03.' in texto
    assert "Temperatura em 61.0 °C" in texto
    assert "http://tupa.local:8080/celulas/c03" in texto
    # 14:02 UTC é 11:02 em São Paulo.
    assert "Aberto em 17/11/2026 11:02." in texto


def test_regra_critica_e_de_experimento_aparecem_no_email():
    msg = correio.montar(_alerta(gravidade="critica", experimento_nome="Crescimento de E. coli"), CFG)
    assert msg["Subject"].startswith("[T.U.P.A] [CRÍTICO] ")
    assert 'no Crescimento de E. coli abriu um alerta crítico' in msg.get_content()


def test_envia_e_marca_cada_alerta(ambiente):
    pendentes, marcados = ambiente
    pendentes.append(_alerta(id_alerta=8, id_celula="c05"))
    assert correio.enviar_pendentes(None, CFG) == 2
    assert [m["Subject"].split("célula ")[1] for m in SmtpFalso.enviados] == ["c03", "c05"]
    assert marcados == [(7, None), (8, None)]
    assert SmtpFalso.conexoes == 1   # uma conexão para todos


def test_sem_smtp_host_nao_envia_nem_marca(ambiente):
    _, marcados = ambiente
    assert correio.enviar_pendentes(None, replace(CFG, smtp_host="")) == 0
    assert SmtpFalso.conexoes == 0 and marcados == []


def test_falha_no_envio_fica_para_depois(ambiente):
    _, marcados = ambiente
    SmtpFalso.falhar = True
    assert correio.enviar_pendentes(None, CFG) == 0
    [(id_alerta, erro)] = marcados
    assert id_alerta == 7 and erro


def test_servidor_fora_marca_a_tentativa_de_todos(ambiente, monkeypatch):
    pendentes, marcados = ambiente
    pendentes.append(_alerta(id_alerta=8))

    def recusa(*_args, **_kwargs):
        raise ConnectionRefusedError("conexão recusada")

    monkeypatch.setattr(correio.smtplib, "SMTP", recusa)
    assert correio.enviar_pendentes(None, CFG) == 0
    assert [m[0] for m in marcados] == [7, 8]
    assert all("smtp.teste:1025 indisponível" in m[1] for m in marcados)


def test_nada_pendente_nem_conecta(ambiente):
    pendentes, _ = ambiente
    pendentes.clear()
    assert correio.enviar_pendentes(None, CFG) == 0
    assert SmtpFalso.conexoes == 0
