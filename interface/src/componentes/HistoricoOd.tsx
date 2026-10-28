// Barras da OD média de cada hora nas últimas 24 h, dentro do card de célula.

import { ESCALA_OD } from "../dados/modelo";
import estilos from "./HistoricoOd.module.css";

const ALTURA_MINIMA_PX = 2;
const ALTURA_MAXIMA_PX = 30;

function altura(od: number): number {
  const fracao = Math.min(Math.max(od / ESCALA_OD, 0), 1);
  return Math.round(ALTURA_MINIMA_PX + fracao * (ALTURA_MAXIMA_PX - ALTURA_MINIMA_PX));
}

interface Props {
  valores: (number | null)[];
  /** Célula offline: barras em cinza e sem destaque na última hora. */
  apagado: boolean;
}

export function HistoricoOd({ valores, apagado }: Props) {
  const ultima = valores.length - 1;
  return (
    <div className={estilos.barras} role="img" aria-label="Densidade óptica a cada hora, nas últimas 24 h">
      {valores.map((od, i) => {
        const tipo =
          od === null ? estilos.vazia : apagado ? estilos.apagada : i === ultima ? estilos.atual : estilos.normal;
        return (
          <span
            key={i}
            className={`${estilos.barra} ${tipo}`}
            style={{ height: od === null ? ALTURA_MINIMA_PX : altura(od) }}
          />
        );
      })}
    </div>
  );
}
