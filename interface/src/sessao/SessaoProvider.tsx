// Sessão do usuário logado. A API ainda não tem autenticação, então as contas
// ficam guardadas no próprio navegador (localStorage), só para o fluxo das
// telas de Login, Cadastro e Recuperar senha funcionar. Quando a API ganhar
// os endpoints de conta, só este arquivo muda.

import { createContext, useContext, useState, type ReactNode } from "react";

export interface Usuario {
  nome: string;
  email: string;
}

interface Conta extends Usuario {
  senha: string;
}

interface Sessao {
  usuario: Usuario | null;
  /** Devolve false se o e-mail ou a senha não conferem. */
  entrar: (email: string, senha: string, manterConectado: boolean) => boolean;
  cadastrar: (conta: Conta) => string | null;
  trocarSenha: (email: string, senha: string) => void;
  sair: () => void;
}

const CHAVE_CONTAS = "tupa.contas";
const CHAVE_SESSAO = "tupa.sessao";

/** Conta de demonstração, a mesma do Figma. */
const CONTA_EXEMPLO: Conta = { nome: "Pedro Ximenes", email: "pedro.ximenes@cnpem.br", senha: "evolver123" };

export const REGRAS_DA_SENHA = [
  { rotulo: "8 caracteres ou mais", ok: (senha: string) => senha.length >= 8 },
  { rotulo: "Letras e números", ok: (senha: string) => /[a-zA-Z]/.test(senha) && /\d/.test(senha) },
];

export function senhaValida(senha: string): boolean {
  return REGRAS_DA_SENHA.every((regra) => regra.ok(senha));
}

function lerContas(): Conta[] {
  try {
    const salvas = JSON.parse(localStorage.getItem(CHAVE_CONTAS) ?? "[]") as Conta[];
    return salvas.some((c) => c.email === CONTA_EXEMPLO.email) ? salvas : [CONTA_EXEMPLO, ...salvas];
  } catch {
    return [CONTA_EXEMPLO];
  }
}

function lerSessao(): Usuario | null {
  const salva = localStorage.getItem(CHAVE_SESSAO) ?? sessionStorage.getItem(CHAVE_SESSAO);
  try {
    return salva ? (JSON.parse(salva) as Usuario) : null;
  } catch {
    return null;
  }
}

const Contexto = createContext<Sessao | null>(null);

export function SessaoProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(lerSessao);

  function iniciar(conta: Conta, manterConectado: boolean) {
    const dados: Usuario = { nome: conta.nome, email: conta.email };
    // Sem "Manter conectado", a sessão acaba ao fechar o navegador.
    (manterConectado ? localStorage : sessionStorage).setItem(CHAVE_SESSAO, JSON.stringify(dados));
    setUsuario(dados);
  }

  const sessao: Sessao = {
    usuario,
    entrar(email, senha, manterConectado) {
      const conta = lerContas().find((c) => c.email === email.trim().toLowerCase() && c.senha === senha);
      if (!conta) return false;
      iniciar(conta, manterConectado);
      return true;
    },
    cadastrar(conta) {
      const email = conta.email.trim().toLowerCase();
      const contas = lerContas();
      if (contas.some((c) => c.email === email)) return "Já existe uma conta com este e-mail. Use Entrar ou Esqueci minha senha.";
      localStorage.setItem(CHAVE_CONTAS, JSON.stringify([...contas, { ...conta, email }]));
      iniciar({ ...conta, email }, true);
      return null;
    },
    trocarSenha(email, senha) {
      const contas = lerContas().map((c) => (c.email === email ? { ...c, senha } : c));
      localStorage.setItem(CHAVE_CONTAS, JSON.stringify(contas));
      const conta = contas.find((c) => c.email === email);
      if (conta) iniciar(conta, true);
    },
    sair() {
      localStorage.removeItem(CHAVE_SESSAO);
      sessionStorage.removeItem(CHAVE_SESSAO);
      setUsuario(null);
    },
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
