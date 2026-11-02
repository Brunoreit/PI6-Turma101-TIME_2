// Componente "Campo" do Figma (nó 77:1199): rótulo, entrada com unidade
// opcional e texto de ajuda.

import { useId } from "react";
import estilos from "./Campo.module.css";

interface Props {
  rotulo: string;
  valor: string;
  onChange?: (valor: string) => void;
  unidade?: string;
  ajuda?: string;
  /** Mostra a ajuda em vermelho, para erros de validação. */
  erro?: boolean;
  somenteLeitura?: boolean;
  /** Rótulo só para leitores de tela, quando o título vem de fora. */
  rotuloOculto?: boolean;
}

export function Campo({ rotulo, valor, onChange, unidade, ajuda, erro = false, somenteLeitura = false, rotuloOculto = false }: Props) {
  const id = useId();
  return (
    <div className={estilos.campo}>
      <label htmlFor={id} className={rotuloOculto ? estilos.oculto : estilos.rotulo}>
        {rotulo}
      </label>
      <div className={estilos.entrada}>
        <input
          id={id}
          className={estilos.valor}
          inputMode="decimal"
          value={valor}
          readOnly={somenteLeitura}
          aria-invalid={erro || undefined}
          aria-describedby={ajuda ? `${id}-ajuda` : undefined}
          onChange={(evento) => onChange?.(evento.target.value)}
        />
        {unidade && <span className={estilos.unidade}>{unidade}</span>}
      </div>
      {ajuda && (
        <p id={`${id}-ajuda`} className={erro ? estilos.erro : estilos.ajuda}>
          {ajuda}
        </p>
      )}
    </div>
  );
}
