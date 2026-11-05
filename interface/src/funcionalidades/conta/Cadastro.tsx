// Tela "Cadastro" do Figma (nó 207:1925).

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Botao } from "@/compartilhado/componentes/Botao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { senhaValida, useSessao } from "@/sessao/SessaoProvider";
import { AvisoDeErro, CartaoDeConta } from "./CartaoDeConta";
import estilos from "./Conta.module.css";
import { RegrasDaSenha } from "./RegrasDaSenha";

export function Cadastro() {
  const { cadastrar } = useSessao();
  const navegar = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const confirmacaoErrada = confirmacao !== "" && confirmacao !== senha;

  function enviar() {
    if (!nome.trim() || !email.includes("@")) return setErro("Preencha o nome completo e um e-mail válido.");
    if (!senhaValida(senha)) return setErro("A senha precisa ter 8 caracteres ou mais, com letras e números.");
    if (senha !== confirmacao) return setErro("As duas senhas não são iguais. Digite a mesma senha nos dois campos.");
    const falha = cadastrar({ nome: nome.trim(), email, senha });
    if (falha) setErro(falha);
    else navegar("/", { replace: true });
  }

  return (
    <CartaoDeConta
      titulo="Criar conta"
      subtitulo="Preencha seus dados para acessar o sistema."
      onSubmit={enviar}
      rodape={
        <>
          Já tem conta?
          <Link to="/entrar" className={estilos.link}>
            Entrar
          </Link>
        </>
      }
    >
      {erro && <AvisoDeErro>{erro}</AvisoDeErro>}
      <Campo rotulo="Nome completo" tipo="texto" valor={nome} onChange={setNome} autoComplete="name" />
      <Campo rotulo="E-mail" tipo="email" valor={email} onChange={setEmail} placeholder="nome@cnpem.br" autoComplete="email" />
      <Campo
        rotulo="Senha"
        tipo="senha"
        valor={senha}
        onChange={setSenha}
        autoComplete="new-password"
        ajuda="Mínimo de 8 caracteres, com letras e números."
      />
      <RegrasDaSenha senha={senha} />
      <Campo
        rotulo="Confirmar senha"
        tipo="senha"
        valor={confirmacao}
        onChange={setConfirmacao}
        autoComplete="new-password"
        erro={confirmacaoErrada}
        ajuda={confirmacaoErrada ? "As senhas não são iguais." : undefined}
      />
      <Botao tipo="primario" submit cheio>
        Criar conta
      </Botao>
    </CartaoDeConta>
  );
}
