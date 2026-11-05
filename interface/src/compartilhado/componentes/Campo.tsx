// Componente "Campo" do Figma (nó 77:1199): rótulo, entrada com unidade
// opcional e texto de ajuda.

import { useId, useState } from "react";
import estilos from "./Campo.module.css";

interface Props {
  rotulo: string;
  valor: string;
  onChange?: (valor: string) => void;
  unidade?: string;
  ajuda?: string;
  /** Mostra a ajuda e a borda em vermelho, para erros de validação. */
  erro?: boolean;
  somenteLeitura?: boolean;
  /** Rótulo só para leitores de tela, quando o título vem de fora. */
  rotuloOculto?: boolean;
  /** Padrão "numero", que abre o teclado numérico no celular. */
  tipo?: "numero" | "texto" | "email" | "senha" | "data";
  placeholder?: string;
  autoComplete?: string;
}

export function Campo({
  rotulo, valor, onChange, unidade, ajuda, erro = false, somenteLeitura = false,
  rotuloOculto = false, tipo = "numero", placeholder, autoComplete,
}: Props) {
  const id = useId();
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const tipoHtml =
    tipo === "senha" ? (mostrarSenha ? "text" : "password") : tipo === "email" ? "email" : tipo === "data" ? "date" : "text";
  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={rotuloOculto ? estilos.oculto : estilos.rotulo}>
        {rotulo}
      </label>
      <div className={estilos.entrada}>
        <input
          id={id}
          className={estilos.valor}
          type={tipoHtml}
          inputMode={tipo === "numero" ? "decimal" : undefined}
          value={valor}
          placeholder={placeholder}
          autoComplete={autoComplete}
          readOnly={somenteLeitura}
          aria-invalid={erro || undefined}
          aria-describedby={ajuda ? `${id}-ajuda` : undefined}
          onChange={(evento) => onChange?.(evento.target.value)}
        />
        {tipo === "senha" ? (
          <button type="button" className={estilos.mostrar} onClick={() => setMostrarSenha((m) => !m)}>
            {mostrarSenha ? "Ocultar" : "Mostrar"}
          </button>
        ) : (
          unidade && <span className={estilos.unidade}>{unidade}</span>
        )}
      </div>
      {ajuda && (
        <p id={`${id}-ajuda`} className={erro ? estilos.erro : estilos.ajuda}>
          {ajuda}
        </p>
      )}
    </div>
  );
}
