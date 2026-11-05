// Tela "Nova senha" do Figma (nó 207:2045), aberta pelo link do e-mail de
// recuperação: /nova-senha?email=nome@cnpem.br

import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Botao } from "@/compartilhado/componentes/Botao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { senhaValida, useSessao } from "@/sessao/SessaoProvider";
import { AvisoDeErro, CartaoDeConta } from "./CartaoDeConta";
import estilos from "./Conta.module.css";

export function NovaSenha() {
  const email = useSearchParams()[0].get("email") ?? "";
  const { trocarSenha } = useSessao();
  const navegar = useNavigate();
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  function enviar() {
    if (!email) return setErro("Link incompleto. Peça outro em Esqueci minha senha.");
    if (!senhaValida(senha)) return setErro("A senha precisa ter 8 caracteres ou mais, com letras e números.");
    if (senha !== confirmacao) return setErro("As duas senhas não são iguais. Digite a mesma senha nos dois campos.");
    trocarSenha(email, senha);
    navegar("/", { replace: true });
  }

  return (
    <CartaoDeConta
      titulo="Criar nova senha"
      subtitulo={email ? `Escolha uma senha nova para ${email}.` : "Escolha uma senha nova para a sua conta."}
      onSubmit={enviar}
    >
      {erro && <AvisoDeErro>{erro}</AvisoDeErro>}
      <Campo
        rotulo="Nova senha"
        tipo="senha"
        valor={senha}
        onChange={setSenha}
        autoComplete="new-password"
        ajuda="Mínimo de 8 caracteres, com letras e números."
      />
      <Campo rotulo="Confirmar nova senha" tipo="senha" valor={confirmacao} onChange={setConfirmacao} autoComplete="new-password" />
      <Botao tipo="primario" submit cheio>
        Salvar nova senha
      </Botao>
      <p className={estilos.nota}>Depois de salvar, você entra direto no sistema.</p>
    </CartaoDeConta>
  );
}
