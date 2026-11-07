"""Resumo de senha e token de sessão, só com a biblioteca padrão.

Senha: scrypt com sal aleatório, gravado como
    scrypt$<n>$<r>$<p>$<sal_b64>$<resumo_b64>
A senha nunca é guardada. A conferência recalcula com os parâmetros gravados.

Token: base64url(json {"p": id_pessoa, "exp": epoch}) + "." + base64url(hmac_sha256),
assinado com SEGREDO_SESSAO. Não há tabela de sessões: o token vale até
expirar, e sair é a interface descartar o token.

Nem a senha nem o token vão para o log.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time

_N, _R, _P, _TAMANHO = 2**14, 8, 1, 32


def _scrypt(senha: str, sal: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(senha.encode(), salt=sal, n=n, r=r, p=p, dklen=_TAMANHO)


def resumir_senha(senha: str) -> str:
    sal = secrets.token_bytes(16)
    resumo = _scrypt(senha, sal, _N, _R, _P)
    return "$".join(["scrypt", str(_N), str(_R), str(_P),
                     base64.b64encode(sal).decode(), base64.b64encode(resumo).decode()])


def conferir_senha(senha: str, resumo_gravado: str) -> bool:
    try:
        algoritmo, n, r, p, sal, resumo = resumo_gravado.split("$")
        if algoritmo != "scrypt":
            return False
        calculado = _scrypt(senha, base64.b64decode(sal), int(n), int(r), int(p))
        return hmac.compare_digest(calculado, base64.b64decode(resumo))
    except ValueError:
        return False


def _b64url(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).rstrip(b"=").decode()


def _assinatura(parte: str, segredo: str) -> str:
    return _b64url(hmac.new(segredo.encode(), parte.encode(), hashlib.sha256).digest())


def emitir_token(id_pessoa: int, segredo: str, horas: float, agora: float | None = None) -> str:
    expira = int((time.time() if agora is None else agora) + horas * 3600)
    parte = _b64url(json.dumps({"p": id_pessoa, "exp": expira}, separators=(",", ":")).encode())
    return f"{parte}.{_assinatura(parte, segredo)}"


def ler_token(token: str, segredo: str, agora: float | None = None) -> int | None:
    """Devolve o id da pessoa, ou None se o token estiver malformado,
    adulterado, assinado com outro segredo ou expirado."""
    if not token.isascii():
        return None
    parte, _, assinatura = token.partition(".")
    # Compara o texto da assinatura, não os bytes: em base64 sem preenchimento,
    # o último caractere tem bits que não contam, e trocá-lo daria os mesmos bytes.
    if not hmac.compare_digest(assinatura, _assinatura(parte, segredo)):
        return None
    try:
        dados = json.loads(base64.urlsafe_b64decode(parte + "=" * (-len(parte) % 4)))
        id_pessoa, expira = dados["p"], dados["exp"]
    except (ValueError, TypeError, KeyError):
        return None
    if not isinstance(id_pessoa, int) or not isinstance(expira, int):
        return None
    if expira <= (time.time() if agora is None else agora):
        return None
    return id_pessoa
