// Tela "Nova senha" do Figma (nó 207:2045), aberta pelo link do e-mail de
// recuperação: /nova-senha?email=nome@cnpem.br. A API ainda não tem rota
// para trocar a senha, então o botão fica indisponível e explica o motivo.

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Botao } from "@/compartilhado/componentes/Botao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { AvisoDeErro, CartaoDeConta } from "./CartaoDeConta";
import estilos from "./Conta.module.css";

const SEM_TROCA = "Ainda não disponível: a API não tem a rota para trocar a senha.";

export function NovaSenha() {
  const email = useSearchParams()[0].get("email") ?? "";
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);


  return (
    <CartaoDeConta
      titulo="Criar nova senha"
      subtitulo={email ? `Escolha uma senha nova para ${email}.` : "Escolha uma senha nova para a sua conta."}
      onSubmit={() => setErro(SEM_TROCA)}
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
      <Botao tipo="primario" submit cheio indisponivel={SEM_TROCA}>
        Salvar nova senha
      </Botao>
      <p className={estilos.nota}>Depois de salvar, você entra direto no sistema.</p>
    </CartaoDeConta>
  );
}
