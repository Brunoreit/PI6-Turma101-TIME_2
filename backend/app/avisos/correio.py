"""Aviso por e-mail dos alertas das regras marcadas com e-mail.

O processo de regras chama `enviar_pendentes` a cada rodada, depois das
verificações. Cada alerta aberto gera um e-mail só (alerta.email_enviado_em),
mesmo que a regra rode de novo. Se o servidor de e-mail falhar, o alerta
fica pendente e a tentativa se repete depois de EMAIL_REPETIR_S; o erro
fica em alerta.email_erro.

Sem SMTP_HOST, nada é enviado e nada é marcado: o alerta só aparece na tela.
No Compose, SMTP_HOST aponta para o Mailpit, que não entrega a ninguém e
mostra os e-mails em http://localhost:8025. Em produção, basta apontar
SMTP_HOST, SMTP_PORTA, SMTP_USUARIO, SMTP_SENHA e SMTP_SEGURANCA para o
servidor de verdade.

Senha do SMTP nunca vai para o log.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from zoneinfo import ZoneInfo

import psycopg

from app.banco import repositorios as repo
from app.config import Config

log = logging.getLogger("regras")

TIMEOUT_S = 10


def montar(alerta: dict, cfg: Config) -> EmailMessage:
    """O e-mail de um alerta de regra. `alerta` é uma linha de emails_pendentes."""
    critica = alerta["gravidade"] == "critica"
    onde = f" no {alerta['experimento_nome']}" if alerta["experimento_nome"] else ""
    msg = EmailMessage()
    msg["Subject"] = f"[T.U.P.A]{' [CRÍTICO]' if critica else ''} {alerta['regra_nome']} · célula {alerta['id_celula']}"
    msg["From"] = cfg.email_remetente
    msg["To"] = ", ".join(alerta["destinatarios"])
    msg["Date"] = formatdate(localtime=True)
    msg["Message-ID"] = make_msgid(domain="tupa.local")
    aberto = alerta["aberto_em"].astimezone(ZoneInfo(cfg.email_fuso)).strftime("%d/%m/%Y %H:%M")
    link = f"{cfg.interface_url.rstrip('/')}/celulas/{alerta['id_celula']}"
    msg.set_content(
        f"A regra \"{alerta['regra_nome']}\"{onde} abriu um alerta{' crítico' if critica else ''} "
        f"na célula {alerta['id_celula']}.\n\n"
        f"{alerta['mensagem']}\n\n"
        f"Aberto em {aberto}.\n"
        f"Veja a célula: {link}\n\n"
        "O alerta fecha sozinho quando a leitura volta ao limite. Este e-mail vai uma vez por alerta.\n"
        "Para não receber mais, desligue o e-mail da regra na tela Alertas.\n"
    )
    return msg


def _conectar(cfg: Config) -> smtplib.SMTP:
    if cfg.smtp_seguranca == "ssl":
        smtp = smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_porta, timeout=TIMEOUT_S,
                                context=ssl.create_default_context())
    else:
        smtp = smtplib.SMTP(cfg.smtp_host, cfg.smtp_porta, timeout=TIMEOUT_S)
        if cfg.smtp_seguranca == "starttls":
            smtp.starttls(context=ssl.create_default_context())
    if cfg.smtp_usuario:
        smtp.login(cfg.smtp_usuario, cfg.smtp_senha)
    return smtp


def enviar_pendentes(conn: psycopg.Connection, cfg: Config) -> int:
    """Envia os e-mails dos alertas pendentes e devolve quantos saíram."""
    if not cfg.smtp_host:
        return 0
    pendentes = repo.emails_pendentes(conn, cfg.email_repetir_s)
    if not pendentes:
        return 0
    enviados = 0
    try:
        smtp = _conectar(cfg)
    except (OSError, smtplib.SMTPException) as erro:
        motivo = f"servidor de e-mail {cfg.smtp_host}:{cfg.smtp_porta} indisponível: {erro}"
        log.warning("e-mail não enviado, tenta de novo em %.0f s: %s", cfg.email_repetir_s, motivo)
        for alerta in pendentes:
            repo.marcar_email(conn, alerta["id_alerta"], motivo)
        return 0
    with smtp:
        for alerta in pendentes:
            if not alerta["destinatarios"]:
                # Ninguém para avisar (não deveria acontecer: a regra sempre tem quem criou).
                repo.marcar_email(conn, alerta["id_alerta"], "regra sem destinatário")
                continue
            try:
                smtp.send_message(montar(alerta, cfg))
            except (OSError, smtplib.SMTPException) as erro:
                log.warning("e-mail do alerta %s não enviado, tenta de novo depois: %s", alerta["id_alerta"], erro)
                repo.marcar_email(conn, alerta["id_alerta"], str(erro))
                continue
            repo.marcar_email(conn, alerta["id_alerta"], None)
            enviados += 1
            log.info("e-mail do alerta %s (regra %s, célula %s) enviado para %d pessoa(s)",
                     alerta["id_alerta"], alerta["id_regra"], alerta["id_celula"], len(alerta["destinatarios"]))
    return enviados
