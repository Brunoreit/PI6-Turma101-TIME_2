// Componente "Botão" do Figma (nó 77:1198). Tipos primário e secundário,
// mais o secundário de perigo usado em "Resetar célula".

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import estilos from "./Botao.module.css";

/** Para as ações que a API ainda não oferece: o botão aparece como no
 *  Figma, mas não faz nada e explica o motivo ao passar o mouse. */
export const SEM_API = "Ainda não disponível: a API não tem este recurso.";

interface Props {
  children: ReactNode;
  tipo?: "primario" | "secundario" | "perigo";
  /** Vira link em vez de botão. */
  para?: string;
  onClick?: () => void;
  /** Texto que explica por que a ação não está disponível. */
  indisponivel?: string;
  ocupado?: boolean;
  submit?: boolean;
}

export function Botao({ children, tipo = "secundario", para, onClick, indisponivel, ocupado = false, submit = false }: Props) {
  const classe = `${estilos.botao} ${estilos[tipo]}`;
  if (para && !indisponivel) {
    return (
      <Link to={para} className={classe}>
        {children}
      </Link>
    );
  }
  const bloqueado = Boolean(indisponivel) || ocupado;
  return (
    <button
      type={submit ? "submit" : "button"}
      className={classe}
      aria-disabled={bloqueado || undefined}
      aria-busy={ocupado || undefined}
      title={indisponivel}
      onClick={(evento) => {
        if (bloqueado) {
          evento.preventDefault();
          return;
        }
        onClick?.();
      }}
    >
      {children}
    </button>
  );
}
