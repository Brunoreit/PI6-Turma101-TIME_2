// Caixa com os valores do ponto apontado, igual à "valores no cursor" do
// Historiador (Figma, nó 209:2707). Fica dentro de um contêiner com
// position: relative e se posiciona pela fração horizontal do ponto.

import type { ReactNode } from "react";
import estilos from "./DicaDoGrafico.module.css";

export interface LinhaDaDica {
  rotulo: string;
  valor: ReactNode;
  /** Destaca o valor, como o da série principal. */
  forte?: boolean;
}

interface Props {
  titulo: string;
  linhas: LinhaDaDica[];
  /** Posição horizontal do ponto, de 0 a 1. Perto da direita, a caixa abre para a esquerda. */
  x: number;
  /** Distância do topo do contêiner, em px. */
  topo?: number;
}

export function DicaDoGrafico({ titulo, linhas, x, topo = 0 }: Props) {
  return (
    <div
      className={estilos.dica}
      role="status"
      style={{
        left: `${x * 100}%`,
        top: topo,
        transform: x > 0.65 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
      }}
    >
      <p className={estilos.titulo}>{titulo}</p>
      <dl>
        {linhas.map((l) => (
          <div key={l.rotulo}>
            <dt>{l.rotulo}</dt>
            <dd className={l.forte ? estilos.forte : undefined}>{l.valor}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
