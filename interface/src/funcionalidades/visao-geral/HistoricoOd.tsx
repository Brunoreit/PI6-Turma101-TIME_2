// Barras da OD média de cada hora nas últimas 24 h, dentro do card de célula.
// Ao passar o mouse numa barra, mostra a hora e a OD dela.

import { useState } from "react";
import { DicaDoGrafico } from "@/compartilhado/componentes/DicaDoGrafico";
import * as formatar from "@/compartilhado/formatar";
import { ESCALA_OD } from "@/dados/modelo";
import estilos from "./HistoricoOd.module.css";

const ALTURA_MINIMA_PX = 2;
const ALTURA_MAXIMA_PX = 30;
const HORA = 3_600_000;

function altura(od: number): number {
  const fracao = Math.min(Math.max(od / ESCALA_OD, 0), 1);
  return Math.round(ALTURA_MINIMA_PX + fracao * (ALTURA_MAXIMA_PX - ALTURA_MINIMA_PX));
}

const horario = (t: Date) => t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

interface Props {
  valores: (number | null)[];
  /** Célula offline: barras em cinza e sem destaque na última hora. */
  apagado: boolean;
  /** Fim da última barra. */
  agora: Date;
}

export function HistoricoOd({ valores, apagado, agora }: Props) {
  const [apontada, setApontada] = useState<number | null>(null);
  const ultima = valores.length - 1;

  function dica(i: number) {
    const fim = new Date(agora.getTime() - (ultima - i) * HORA);
    const inicio = new Date(fim.getTime() - HORA);
    const od = valores[i];
    return (
      <DicaDoGrafico
        titulo={i === ultima ? `última hora · até ${horario(fim)}` : `${horario(inicio)} a ${horario(fim)}`}
        linhas={[{ rotulo: "OD média", valor: od === null ? "sem leitura" : formatar.decimal(od, 3), forte: true }]}
        x={valores.length > 1 ? i / ultima : 0}
        topo={-62}
      />
    );
  }

  return (
    <div
      className={estilos.barras}
      role="img"
      aria-label="Densidade óptica a cada hora, nas últimas 24 h"
      onMouseMove={(e) => {
        const caixa = e.currentTarget.getBoundingClientRect();
        const i = Math.floor(((e.clientX - caixa.left) / caixa.width) * valores.length);
        setApontada(i >= 0 && i < valores.length ? i : null);
      }}
      onMouseLeave={() => setApontada(null)}
    >
      {valores.map((od, i) => {
        const tipo =
          od === null ? estilos.vazia : apagado ? estilos.apagada : i === ultima || i === apontada ? estilos.atual : estilos.normal;
        return (
          <span
            key={i}
            className={`${estilos.barra} ${tipo}`}
            style={{ height: od === null ? ALTURA_MINIMA_PX : altura(od) }}
          />
        );
      })}
      {apontada !== null && dica(apontada)}
    </div>
  );
}
