// Gráfico da curva de calibração da OD (Figma, nó 85:1544). Eixo vertical:
// OD calculada pelo T.U.P.A. Eixo horizontal: OD do espectrofotômetro. Os
// padrões bem calibrados ficam sobre a diagonal. Ao passar o mouse num
// padrão, mostra a OD de referência, a calculada e a diferença.

import { useState } from "react";
import { DicaDoGrafico } from "./DicaDoGrafico";
import estilos from "./CurvaDeCalibracao.module.css";

const MINIMO = 0.1;
const MAXIMO = 0.9;
const MARCAS = [0.2, 0.4, 0.6, 0.8];
/** Faixa em que a calibração é confiável. */
const FAIXA: [number, number] = [0.2, 0.8];

/** Posição de 0 a 100 dentro da área do gráfico. */
const posicao = (od: number) => ((od - MINIMO) / (MAXIMO - MINIMO)) * 100;
const rotulo = (od: number) => od.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const od = (valor: number) => valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

export function CurvaDeCalibracao({ padroes }: { padroes: { referencia: number; calculada: number }[] }) {
  const [apontado, setApontado] = useState<number | null>(null);
  const padrao = apontado === null ? null : padroes[apontado];
  return (
    <div
      className={estilos.grafico}
      role="img"
      aria-label={`Curva de calibração com ${padroes.length} padrões entre 0,2 e 0,8`}
    >
      <div className={estilos.area}>
        <svg className={estilos.svg} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <rect
            className={estilos.faixa}
            x={posicao(FAIXA[0])}
            width={posicao(FAIXA[1]) - posicao(FAIXA[0])}
            y={100 - posicao(FAIXA[1])}
            height={posicao(FAIXA[1]) - posicao(FAIXA[0])}
          />
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
