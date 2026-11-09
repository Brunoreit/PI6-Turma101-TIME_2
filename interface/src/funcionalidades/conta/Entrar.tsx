// Telas "Login" e "Login · erro" do Figma (nós 207:1833 e 207:1876). A
// mensagem de erro é a que a API devolve em "detail".

import { useState } from "react";
import { ErroDaApi } from "@/api/cliente";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { useSessao } from "@/sessao/SessaoProvider";
import { AvisoDeErro, CartaoDeConta, mensagemDoErro } from "./CartaoDeConta";
import estilos from "./Conta.module.css";

export function Entrar() {
  const { entrar } = useSessao();
  const navegar = useNavigate();
  // Volta para a tela que a pessoa tentou abrir antes de entrar.
  const destino = (useLocation().state as { de?: string } | null)?.de ?? "/";
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [manter, setManter] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [senhaErrada, setSenhaErrada] = useState(false);
  const [enviando, setEnviando] = useState(false);

  async function enviar() {
    if (enviando) return;
    if (!email.trim() || !senha) {
      setSenhaErrada(false);
      return setErro("Preencha o e-mail e a senha.");
    }
    setEnviando(true);
    try {
      await entrar(email, senha, manter);
      navegar(destino, { replace: true });
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setSenhaErrada(falha instanceof ErroDaApi && falha.status === 401);
      setEnviando(false);
    }
  }

  return (
    <CartaoDeConta
      titulo="Entrar"
      subtitulo="Use o e-mail e a senha da sua conta."
      onSubmit={enviar}
      rodape={
        <>
          Ainda não tem conta?
          <Link to="/cadastro" className={estilos.link}>
            Criar conta
          </Link>
        </>
      }
    >
      {erro && <AvisoDeErro>{erro}</AvisoDeErro>}
      <Campo rotulo="E-mail" tipo="email" valor={email} onChange={setEmail} placeholder="nome@cnpem.br" autoComplete="email" />
      <Campo
        rotulo="Senha"
        tipo="senha"
        valor={senha}
        onChange={setSenha}
        placeholder="Digite sua senha"
        autoComplete="current-password"
        erro={senhaErrada}
      />
      <div className={estilos.opcoes}>
        <span className={estilos.manter}>
          <CaixaDeSelecao marcada={manter} onChange={setManter}>
            Manter conectado
          </CaixaDeSelecao>
        </span>
        <Link to="/recuperar-senha" state={{ email }} className={estilos.link}>
          Esqueci minha senha
        </Link>
      </div>
      <Botao tipo="primario" submit cheio ocupado={enviando}>
        {enviando ? "Entrando..." : "Entrar"}
      </Botao>
    </CartaoDeConta>
  );
}
