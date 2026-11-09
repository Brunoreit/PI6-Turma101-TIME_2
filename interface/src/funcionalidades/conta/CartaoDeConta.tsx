// Moldura comum às telas de conta do Figma (Login, Cadastro, Recuperar senha
// e Nova senha): fundo cinza, cartão centralizado com a marca e um rodapé.

import type { FormEvent, ReactNode } from "react";
import { ErroDaApi } from "@/api/cliente";
import iconeErro from "@/assets/icones/erro-circulo.svg";
import simboloCnpem from "@/assets/icones/simbolo-cnpem.svg";
import estilos from "./Conta.module.css";

interface Props {
  titulo: string;
  subtitulo?: ReactNode;
  /** Entre a marca e o título, como o ícone de e-mail enviado. */
  icone?: ReactNode;
  rodape?: ReactNode;
  onSubmit?: () => void;
  children: ReactNode;
}

export function CartaoDeConta({ titulo, subtitulo, icone, rodape, onSubmit, children }: Props) {
  return (
    <div className={estilos.pagina}>
      <main className={estilos.cartao}>
        <div className={estilos.marca}>
          <span className={estilos.simbolo}>
            <img src={simboloCnpem} width={32} height={32} alt="" />
          </span>
          <div className={estilos.nome}>
            <span className={estilos.produto}>T.U.P.A</span>
            <span className={estilos.instituicao}>CNPEM · Monitoramento</span>
          </div>
        </div>
        {icone}
        <div className={estilos.titulo}>
          <h1>{titulo}</h1>
          {subtitulo && <p>{subtitulo}</p>}
        </div>
        <form
          className={estilos.formulario}
          noValidate
          onSubmit={(evento: FormEvent) => {
            evento.preventDefault();
            onSubmit?.();
          }}
        >
          {children}
        </form>
      </main>
      {rodape && <div className={estilos.rodape}>{rodape}</div>}
    </div>
  );
}

/** Texto do erro para a tela: a explicação da API (detail) ou, sem ela, o
 *  aviso de que a API não respondeu. */
export function mensagemDoErro(erro: unknown): string {
  if (erro instanceof ErroDaApi) return erro.detalhe;
  if (erro instanceof Error && erro.message) return erro.message;
  return "Algo deu errado ao falar com a API. Tente de novo em alguns segundos.";
}

export function AvisoDeErro({ children }: { children: ReactNode }) {
  return (
    <div className={estilos.erro} role="alert">
      <img src={iconeErro} width={16} height={16} alt="" />
      <p>{children}</p>
    </div>
  );
}
