// Telas "Recuperar senha" e "Recuperar senha · e-mail enviado" do Figma
// (nós 207:1983 e 207:2015). A API ainda não tem rota para enviar o e-mail
// de recuperação, então o botão fica indisponível e explica o motivo. A tela
// de e-mail enviado já está pronta para quando a rota existir.

import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import iconeVoltar from "@/assets/icones/chevron-esquerda.svg";
import iconeEmail from "@/assets/icones/email.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { AvisoDeErro, CartaoDeConta } from "./CartaoDeConta";
import estilos from "./Conta.module.css";

const SEM_RECUPERACAO =
  "Ainda não disponível: a API não tem a rota para enviar o e-mail de recuperação de senha.";

export function RecuperarSenha() {
  const inicial = (useLocation().state as { email?: string } | null)?.email ?? "";
  const [email, setEmail] = useState(inicial);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (enviado) {
    return (
      <CartaoDeConta
        titulo="Confira seu e-mail"
        icone={
          <span className={estilos.iconeEnviado}>
            <img src={iconeEmail} width={22} height={22} alt="" />
          </span>
        }
        rodape={
          <>
            Não recebeu?
            <button type="button" className={estilos.link} onClick={() => setEnviado(false)}>
              Reenviar e-mail
            </button>
          </>
        }
      >
        <p className={estilos.texto}>
          Se existir uma conta com {email.trim()}, você vai receber um link para criar uma senha nova. O link vale por 30
          minutos.
        </p>
        <p className={estilos.textoMenor}>Não chegou? Confira a caixa de spam ou peça outro link.</p>
        <Botao para="/entrar" cheio>
          Voltar para o login
        </Botao>
      </CartaoDeConta>
    );
  }

  return (
    <CartaoDeConta
      titulo="Recuperar senha"
      subtitulo="Digite o e-mail da sua conta. Vamos enviar um link para você criar uma senha nova."
      onSubmit={() => setErro(SEM_RECUPERACAO)}
      rodape={
        <Link to="/entrar" className={`${estilos.link} ${estilos.voltar}`}>
          <img src={iconeVoltar} width={14} height={14} alt="" />
          Voltar para o login
        </Link>
      }
    >
      {erro && <AvisoDeErro>{erro}</AvisoDeErro>}
      <Campo
        rotulo="E-mail"
        tipo="email"
        valor={email}
        onChange={setEmail}
        placeholder="nome@cnpem.br"
        autoComplete="email"
      />
      <Botao tipo="primario" submit cheio indisponivel={SEM_RECUPERACAO}>
        Enviar link
      </Botao>
    </CartaoDeConta>
  );
}
