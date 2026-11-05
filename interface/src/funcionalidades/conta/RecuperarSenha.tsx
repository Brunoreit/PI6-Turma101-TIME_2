// Telas "Recuperar senha" e "Recuperar senha · e-mail enviado" do Figma
// (nós 207:1983 e 207:2015). O envio do e-mail depende da API, que ainda
// não tem esse recurso: a tela só mostra a confirmação.

import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import iconeVoltar from "@/assets/icones/chevron-esquerda.svg";
import iconeEmail from "@/assets/icones/email.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { AvisoDeErro, CartaoDeConta } from "./CartaoDeConta";
import estilos from "./Conta.module.css";

export function RecuperarSenha() {
  const inicial = (useLocation().state as { email?: string } | null)?.email ?? "";
  const [email, setEmail] = useState(inicial);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro] = useState(false);

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
      onSubmit={() => {
        if (email.includes("@")) setEnviado(true);
        else setErro(true);
      }}
      rodape={
        <Link to="/entrar" className={`${estilos.link} ${estilos.voltar}`}>
          <img src={iconeVoltar} width={14} height={14} alt="" />
          Voltar para o login
        </Link>
      }
    >
      {erro && <AvisoDeErro>Digite um e-mail válido, como nome@cnpem.br.</AvisoDeErro>}
      <Campo
        rotulo="E-mail"
        tipo="email"
        valor={email}
        onChange={setEmail}
        placeholder="nome@cnpem.br"
        autoComplete="email"
        erro={erro}
      />
      <Botao tipo="primario" submit cheio>
        Enviar link
      </Botao>
    </CartaoDeConta>
  );
}
