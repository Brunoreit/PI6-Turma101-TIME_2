// Painel "Comparação entre células" do Historiador (Figma, nó 209:2637): as
// faixas de contexto em cima, um gráfico por variável e o cursor que mostra
// os valores de cada célula no instante apontado.

import { useState, type MouseEvent } from "react";
import * as formatar from "@/compartilhado/formatar";
import type { Serie, Variavel } from "./dados";
import estilos from "./Historiador.module.css";

export interface Contexto {
  idCelula: string;
  texto: string;
  emExperimento: boolean;
}

const LARGURA = 1000;
const ALTURA = 60;
/** Largura da coluna das marcas do eixo, igual a --margem-marcas no CSS. */
const MARGEM_DAS_MARCAS = 44;

const VARIAVEIS: Record<Variavel, { titulo: string; casas: number; passo: number; formatar: (v: number) => string }> = {
  temperatura: { titulo: "Temperatura (°C)", casas: 0, passo: 1, formatar: (v) => formatar.temperatura(v) },
  od: { titulo: "Densidade óptica", casas: 2, passo: 0.05, formatar: (v) => formatar.decimal(v, 3) },
  ph: { titulo: "pH", casas: 2, passo: 0.05, formatar: (v) => formatar.decimal(v, 2) },
};

/** Três marcas redondas que cobrem todos os valores das células. */
function escala(series: Serie[], variavel: Variavel) {
  const { passo } = VARIAVEIS[variavel];
  const valores = series.flatMap((s) => s.pontos.map((p) => p[variavel])).filter((v): v is number => v !== null);
  if (valores.length === 0) return { minimo: 0, maximo: 2 * passo, marcas: [0, passo, 2 * passo] };
  let baixo = Math.floor(Math.min(...valores) / passo);
  let alto = Math.ceil(Math.max(...valores) / passo);
  if (alto - baixo < 2) {
    baixo -= 1;
    alto += 1;
  }
  if ((alto - baixo) % 2 === 1) alto += 1;
  return { minimo: baixo * passo, maximo: alto * passo, marcas: [alto, (alto + baixo) / 2, baixo].map((k) => k * passo) };
}

function caminho(serie: Serie, variavel: Variavel, minimo: number, maximo: number): string {
  const n = serie.pontos.length;
  let d = "";
  let emTrecho = false;
  serie.pontos.forEach((p, i) => {
    const v = p[variavel];
    if (v === null) {
      emTrecho = false;
      return;
    }
    const x = n > 1 ? (i / (n - 1)) * LARGURA : 0;
    const y = (1 - (v - minimo) / (maximo - minimo)) * ALTURA;
    d += `${emTrecho ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    emTrecho = true;
  });
  return d;
}

interface Props {
  series: Serie[];
  cores: Record<string, string>;
  variaveis: Variavel[];
  contexto: Contexto[];
  rotulosTempo: string[];
  /** Instantes sem leitura de alguma célula, marcados em vermelho claro. */
  buracos: number[];
}

export function GraficoDeComparacao({ series, cores, variaveis, contexto, rotulosTempo, buracos }: Props) {
  const [cursor, setCursor] = useState<number | null>(null);
  const n = series[0]?.pontos.length ?? 0;

  function mover(evento: MouseEvent<HTMLDivElement>) {
    const caixa = evento.currentTarget.getBoundingClientRect();
    const fracao = (evento.clientX - caixa.left - MARGEM_DAS_MARCAS) / (caixa.width - MARGEM_DAS_MARCAS);
    setCursor(fracao < 0 || fracao > 1 || n === 0 ? null : Math.round(fracao * (n - 1)));
  }

  const instante = cursor !== null ? series[0]?.pontos[cursor]?.t : undefined;

  return (
    <div className={estilos.grafico}>
      <div className={estilos.contexto}>
        <span className={estilos.eixoRotulo}>Contexto</span>
        <div className={estilos.faixasContexto}>
          {contexto.map((c) => (
            <span key={c.idCelula} className={c.emExperimento ? estilos.faixaExperimento : estilos.faixaLivre}>
              {c.texto}
            </span>
          ))}
        </div>
      </div>

      <div className={estilos.areaGraficos} onMouseMove={mover} onMouseLeave={() => setCursor(null)}>
        {variaveis.map((variavel) => {
          const { minimo, maximo, marcas } = escala(series, variavel);
          const info = VARIAVEIS[variavel];
          return (
            <div key={variavel} className={estilos.linhaGrafico}>
              <div className={estilos.marcas} aria-hidden>
                {marcas.map((m) => (
                  <span key={m}>{formatar.decimal(m, info.casas)}</span>
                ))}
              </div>
              <div className={estilos.desenho}>
                <span className={estilos.tituloVariavel}>{info.titulo}</span>
                <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} preserveAspectRatio="none" role="img" aria-label={`${info.titulo} das células escolhidas`}>
                  {buracos.map((i) => (
                    <rect key={i} className={estilos.buraco} x={(i / Math.max(n - 1, 1)) * LARGURA - 4} width={8} y={0} height={ALTURA} />
                  ))}
                  {series.map((s) => (
                    <path key={s.idCelula} d={caminho(s, variavel, minimo, maximo)} stroke={cores[s.idCelula]} className={estilos.curva} />
                  ))}
                </svg>
              </div>
            </div>
          );
        })}

        {cursor !== null && n > 1 && (
          <>
            <span className={estilos.cursor} style={{ left: `calc(var(--margem-marcas) + (100% - var(--margem-marcas)) * ${cursor / (n - 1)})` }} />
            <div
              className={estilos.valoresNoCursor}
              style={{
                left: `calc(var(--margem-marcas) + (100% - var(--margem-marcas)) * ${cursor / (n - 1)})`,
                transform: cursor / (n - 1) > 0.7 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
              }}
            >
              <p className={estilos.valoresTitulo}>{instante && formatar.diaHora(instante)}</p>
              <table>
                <thead>
                  <tr>
                    <th />
                    {series.map((s) => (
                      <th key={s.idCelula} style={{ color: cores[s.idCelula] }}>
                        {s.idCelula}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {variaveis.map((v) => (
                    <tr key={v}>
                      <td>{v === "temperatura" ? "Temperatura" : v === "od" ? "OD" : "pH"}</td>
                      {series.map((s) => {
                        const valor = s.pontos[cursor]?.[v];
                        return <td key={s.idCelula}>{valor == null ? "—" : VARIAVEIS[v].formatar(valor)}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className={estilos.eixoTempo} aria-hidden>
        {rotulosTempo.map((r, i) => (
          <span key={i}>{r}</span>
        ))}
      </div>
    </div>
  );
}
