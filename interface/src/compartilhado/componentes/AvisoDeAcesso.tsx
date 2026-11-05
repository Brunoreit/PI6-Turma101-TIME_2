// Componente "Aviso de acesso" do Figma (nó 77:1205). Aparece quando a pessoa
// clica numa opção esmaecida (Botão sem acesso) e some sozinho em 5 s.

import { useEffect, useRef, useState } from "react";
import iconeCadeado from "@/assets/icones/cadeado-16-marca.svg";
import estilos from "./AvisoDeAcesso.module.css";

export interface Aviso {
  titulo: string;
  mensagem: string;
  acao: string;
}

const DURACAO_MS = 5000;

/** Guarda o aviso aberto e o fecha depois de 5 s. */
export function useAvisoDeAcesso() {
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const temporizador = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(temporizador.current), []);
  return {
    aviso,
    mostrar(novo: Aviso) {
      window.clearTimeout(temporizador.current);
      setAviso(novo);
      temporizador.current = window.setTimeout(() => setAviso(null), DURACAO_MS);
    },
    fechar: () => setAviso(null),
  };
}

export function AvisoDeAcesso({ aviso, onAcao }: { aviso: Aviso | null; onAcao?: () => void }) {
  if (!aviso) return null;
  return (
    <div className={estilos.aviso} role="status">
      <span className={estilos.icone}>
        <img src={iconeCadeado} width={16} height={16} alt="" />
      </span>
      <div className={estilos.textos}>
        <p className={estilos.titulo}>{aviso.titulo}</p>
        <p className={estilos.mensagem}>{aviso.mensagem}</p>
        <button type="button" className={estilos.acao} onClick={onAcao}>
          {aviso.acao}
        </button>
      </div>
    </div>
  );
}
