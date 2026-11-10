// Gráfico da curva de calibração da OD (Figma, nó 85:1544). Eixo vertical:
// OD calculada pelo T.U.P.A. Eixo horizontal: OD do espectrofotômetro. Os
// padrões bem calibrados ficam sobre a diagonal. Ao passar o mouse num
// padrão, mostra a OD de referência, a calculada e a diferença. Os padrões
// podem ter qualquer OD: a escala vai de 0,1 a 0,9 e cresce para caber todos.

import { useState } from "react";
import { DicaDoGrafico } from "./DicaDoGrafico";
import estilos from "./CurvaDeCalibracao.module.css";

/** Escala com 0,1 de folga, que cresce em passos de 0,2 para caber todos os padrões. */
function escala(padroes: { referencia: number; calculada: number }[]) {
  const valores = padroes.flatMap((p) => [p.referencia, p.calculada]);
  const minimo = Math.min(0.1, Math.floor((Math.min(...valores, 0.1) - 0.1) / 0.2) * 0.2 + 0.1);
  const maximo = Math.max(0.9, Math.ceil((Math.max(...valores, 0.9) - 0.1) / 0.2) * 0.2 + 0.1);
  const passo = maximo - minimo > 2 ? 0.5 : 0.2;
  const marcas: number[] = [];
  for (let m = Math.ceil(minimo / passo - 1e-9) * passo; m < maximo - 1e-9; m += passo) {
    if (m > minimo + 1e-9) marcas.push(Math.round(m * 10) / 10);
  }
  return { minimo, maximo, marcas };
}

const rotulo = (od: number) => od.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const od = (valor: number) => valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export function CurvaDeCalibracao({ padroes }: { padroes: { referencia: number; calculada: number }[] }) {
  const [apontado, setApontado] = useState<number | null>(null);
  const padrao = apontado === null ? null : padroes[apontado];
  const { minimo: MINIMO, maximo: MAXIMO, marcas: MARCAS } = escala(padroes);
  /** Posição de 0 a 100 dentro da área do gráfico. */
  const posicao = (od: number) => ((od - MINIMO) / (MAXIMO - MINIMO)) * 100;
  return (
    <div
      className={estilos.grafico}
      role="img"
      aria-label={`Curva de calibração com ${padroes.length} padrões`}
    >
      <div className={estilos.area}>
        <svg className={estilos.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {MARCAS.map((marca) => (
            <line key={marca} className={estilos.grade} x1={0} x2={100} y1={100 - posicao(marca)} y2={100 - posicao(marca)} />
          ))}
          <line className={estilos.diagonal} x1={0} y1={100} x2={100} y2={0} />
        </svg>
        {padroes.map((p, i) => (
          <span
            key={p.referencia}
            className={i === apontado ? `${estilos.padrao} ${estilos.padraoApontado}` : estilos.padrao}
            style={{ left: `${posicao(p.referencia)}%`, top: `${100 - posicao(p.calculada)}%` }}
            onMouseEnter={() => setApontado(i)}
            onMouseLeave={() => setApontado(null)}
          />
        ))}
        {padrao && apontado !== null && (
          <DicaDoGrafico
            titulo={`Padrão ${apontado + 1} de ${padroes.length}`}
            linhas={[
              { rotulo: "Espectrofotômetro", valor: od(padrao.referencia) },
              { rotulo: "T.U.P.A", valor: od(padrao.calculada), forte: true },
              {
                rotulo: "Diferença",
                valor: `${padrao.calculada - padrao.referencia >= 0 ? "+" : "−"}${od(Math.abs(padrao.calculada - padrao.referencia))}`,
              },
            ]}
            x={posicao(padrao.referencia) / 100}
            topo={Math.max(0, ((100 - posicao(padrao.calculada)) / 100) * 148 - 30)}
          />
        )}
        {MARCAS.map((marca) => (
          <span key={`v${marca}`} className={estilos.marcaVertical} style={{ top: `${100 - posicao(marca)}%` }}>
            {rotulo(marca)}
          </span>
        ))}
        {MARCAS.map((marca) => (
          <span key={`h${marca}`} className={estilos.marcaHorizontal} style={{ left: `${posicao(marca)}%` }}>
            {rotulo(marca)}
          </span>
        ))}
      </div>
    </div>
  );
}
