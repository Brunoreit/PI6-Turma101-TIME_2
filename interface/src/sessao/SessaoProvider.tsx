// Sessão da pessoa logada, pela API (POST /auth/entrar, POST /auth/cadastro e
// GET /auth/eu). O token fica no localStorage com "Manter conectado" marcado
// e no sessionStorage sem ele, para a sessão acabar ao fechar o navegador. O
// cliente da API manda o token em todas as chamadas; se a API recusar (401),
// a sessão é apagada e o ExigeLogin leva para /entrar.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cadastrarConta, consultarPessoaLogada, entrarNaConta, quandoPerderSessao, usarToken } from "@/api/cliente";
import type { SessaoApi } from "@/api/tipos";

export interface Usuario {
  id: number;
  nome: string;
  email: string;
  /** Quando a conta foi criada (ISO 8601). */
  criadoEm?: string;
}

interface Sessao {
  usuario: Usuario | null;
  /** Rejeita com ErroDaApi; o `detalhe` do erro é a mensagem para a tela. */
  entrar: (email: string, senha: string, manterConectado: boolean) => Promise<void>;
  cadastrar: (nome: string, email: string, senha: string) => Promise<void>;
  sair: () => void;
}

const CHAVE_SESSAO = "tupa.sessao";

interface Guardada {
  token: string;
  usuario: Usuario;
}

/** As mesmas regras que a API confere no cadastro. */
export const REGRAS_DA_SENHA = [
  { rotulo: "8 caracteres ou mais", ok: (senha: string) => senha.length >= 8 && senha.length <= 128 },
  { rotulo: "Letras e números", ok: (senha: string) => /\p{L}/u.test(senha) && /\d/.test(senha) },
];

export function senhaValida(senha: string): boolean {
  return REGRAS_DA_SENHA.every((regra) => regra.ok(senha));
}

function lerGuardada(): Guardada | null {
  try {
    const texto = localStorage.getItem(CHAVE_SESSAO) ?? sessionStorage.getItem(CHAVE_SESSAO);
    const guardada = texto ? (JSON.parse(texto) as Guardada) : null;
    return guardada?.token && guardada.usuario ? guardada : null;
  } catch {
    return null;
  }
}

function apagarGuardada() {
  localStorage.removeItem(CHAVE_SESSAO);
  sessionStorage.removeItem(CHAVE_SESSAO);
  // Contas da versão antiga, que ficavam só no navegador.
  localStorage.removeItem("tupa.contas");
}

const Contexto = createContext<Sessao | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(() => {
    const guardada = lerGuardada();
    usarToken(guardada?.token ?? null);
    return guardada?.usuario ?? null;
  });

  function encerrar() {
    apagarGuardada();
    usarToken(null);
    setUsuario(null);
  }

  useEffect(() => {
    quandoPerderSessao(encerrar);
    // Confere o token guardado. Se venceu, o 401 chama encerrar(); com a API
    // fora do ar, a pessoa continua logada e as telas mostram o aviso delas.
    if (!lerGuardada()) return;
    const controle = new AbortController();
    consultarPessoaLogada(controle.signal)
      .then((pessoa) => setUsuario({ id: pessoa.id_pessoa, nome: pessoa.nome, email: pessoa.email, criadoEm: pessoa.criado_em }))
      .catch(() => {});
    return () => controle.abort();
  }, []);

  function iniciar({ token, pessoa }: SessaoApi, manterConectado: boolean) {
    const guardada: Guardada = {
      token,
      usuario: { id: pessoa.id_pessoa, nome: pessoa.nome, email: pessoa.email, criadoEm: pessoa.criado_em },
    };
    apagarGuardada();
    (manterConectado ? localStorage : sessionStorage).setItem(CHAVE_SESSAO, JSON.stringify(guardada));
    usarToken(token);
    setUsuario(guardada.usuario);
  }

  const sessao: Sessao = {
    usuario,
    async entrar(email, senha, manterConectado) {
      iniciar(await entrarNaConta(email.trim(), senha), manterConectado);
    },
    async cadastrar(nome, email, senha) {
      iniciar(await cadastrarConta(nome.trim(), email.trim(), senha), true);
    },
    sair: encerrar,
  };

  return <Contexto.Provider value={sessao}>{children}</Contexto.Provider>;
}

export function useSessao(): Sessao {
  const sessao = useContext(Contexto);
  if (!sessao) throw new Error("useSessao precisa estar dentro de <SessaoProvider>.");
  return sessao;
}

export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}
