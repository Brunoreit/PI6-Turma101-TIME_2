// Telas "Login" e "Login · erro" do Figma (nós 207:1833 e 207:1876).

import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { useSessao } from "@/sessao/SessaoProvider";
import { AvisoDeErro, CartaoDeConta } from "./CartaoDeConta";
import estilos from "./Conta.module.css";

export function Entrar() {
  const { entrar } = useSessao();
  const navegar = useNavigate();
  // Volta para a tela que a pessoa tentou abrir antes de entrar.
  const destino = (useLocation().state as { de?: string } | null)?.de ?? "/";
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [manter, setManter] = useState(true);
  const [erro, setErro] = useState(false);

  return (
    <CartaoDeConta
      titulo="Entrar"
      subtitulo="Use o e-mail e a senha da sua conta."
      onSubmit={() => {
        if (entrar(email, senha, manter)) navegar(destino, { replace: true });
        else setErro(true);
      }}
      rodape={
        <>
          Ainda não tem conta?
          <Link to="/cadastro" className={estilos.link}>
            Criar conta
          </Link>
        </>
      }
    >
      {erro && <AvisoDeErro>E-mail ou senha incorretos. Confira os dados ou use Esqueci minha senha.</AvisoDeErro>}
      <Campo rotulo="E-mail" tipo="email" valor={email} onChange={setEmail} placeholder="nome@cnpem.br" autoComplete="email" />
      <Campo
        rotulo="Senha"
        tipo="senha"
        valor={senha}
        onChange={setSenha}
        placeholder="Digite sua senha"
        autoComplete="current-password"
        erro={erro}
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
      <Botao tipo="primario" submit cheio>
        Entrar
      </Botao>
    </CartaoDeConta>
  );
}
