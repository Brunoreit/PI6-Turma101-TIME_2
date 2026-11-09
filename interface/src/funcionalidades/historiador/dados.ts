// Séries do Historiador: as leituras de cada célula no período, agrupadas
// em pontos para o gráfico. No modo exemplo, as curvas são geradas aqui,
// parecidas com as do Figma (nó 209:2146). No modo api, vêm de
// GET /celulas/{id}/leituras.

import { listarLeituras } from "@/api/cliente";
import { FONTE_DADOS } from "@/dados/fonte";

export type Variavel = "temperatura" | "od" | "ph";

export interface Ponto {
  t: Date;
  temperatura: number | null;
  od: number | null;
  ph: number | null;
}

export interface Serie {
  idCelula: string;
  pontos: Ponto[];
}

export const PONTOS_NO_GRAFICO = 120;

/** Número pseudoaleatório estável, para a curva de exemplo não mudar a cada tela. */
function ruido(semente: number): number {
  const x = Math.sin(semente * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function serieDeExemplo(idCelula: string, inicio: Date, fim: Date, emExperimento: boolean): Serie {
  const numero = Number(idCelula.slice(1)) || 1;
  const passo = (fim.getTime() - inicio.getTime()) / (PONTOS_NO_GRAFICO - 1);
  // Em experimento, a célula fica em 30 °C. Livre, a temperatura sobe devagar, como a c04 do Figma.
  const pontos: Ponto[] = [];
  for (let i = 0; i < PONTOS_NO_GRAFICO; i++) {
    const t = new Date(inicio.getTime() + i * passo);
    const fracao = i / (PONTOS_NO_GRAFICO - 1);
    const r = ruido(numero * 1000 + i);
    // Um buraco curto no meio da série, como a queda de rede do Figma.
    if (emExperimento && Math.abs(fracao - 0.45) < 0.008) {
      pontos.push({ t, temperatura: null, od: null, ph: null });
      continue;
    }
    pontos.push({
      t,
      temperatura: emExperimento
        ? 30 + (r - 0.5) * 0.4 + (Math.abs(fracao - 0.08) < 0.015 ? 1.2 : 0)
        : 24.5 + fracao * 4.5 + (r - 0.5) * 0.3,
      od: emExperimento ? 0.3 + fracao * 0.05 + (r - 0.5) * 0.01 : 0.19 + (r - 0.5) * 0.008,
      ph: (emExperimento ? 6.94 : 6.97) + Math.sin(i / 6 + numero) * 0.008 + (r - 0.5) * 0.006,
    });
  }
  return { idCelula, pontos };
}

/** Média de cada intervalo do período. `null` onde não houve leitura. */
function agrupar(leituras: { t: Date; temperatura: number | null; od: number | null; ph: number | null }[], inicio: Date, fim: Date): Ponto[] {
  const passo = (fim.getTime() - inicio.getTime()) / PONTOS_NO_GRAFICO;
  const baldes = Array.from({ length: PONTOS_NO_GRAFICO }, () => ({ temperatura: [] as number[], od: [] as number[], ph: [] as number[] }));
  for (const l of leituras) {
    const i = Math.floor((l.t.getTime() - inicio.getTime()) / passo);
    if (i < 0 || i >= PONTOS_NO_GRAFICO) continue;
    if (l.temperatura !== null) baldes[i].temperatura.push(l.temperatura);
    if (l.od !== null) baldes[i].od.push(l.od);
    if (l.ph !== null) baldes[i].ph.push(l.ph);
  }
  const media = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
  return baldes.map((b, i) => ({
    t: new Date(inicio.getTime() + (i + 0.5) * passo),
    temperatura: media(b.temperatura),
    od: media(b.od),
    ph: media(b.ph),
  }));
}

/** `emExperimento` só serve para as curvas de exemplo. */
export async function carregarSeries(
  celulas: string[], inicio: Date, fim: Date, emExperimento: Set<string>, sinal?: AbortSignal,
): Promise<Serie[]> {
  if (FONTE_DADOS === "exemplo") return celulas.map((id) => serieDeExemplo(id, inicio, fim, emExperimento.has(id)));
  return Promise.all(
    celulas.map(async (idCelula) => {
      const leituras = await listarLeituras(idCelula, { desde: inicio, limite: 10000 }, sinal);
      const pontos = agrupar(
        leituras.map((l) => ({ t: new Date(l.ts_origem), temperatura: l.temperatura_c, od: l.od, ph: l.ph })),
        inicio,
        fim,
      );
      return { idCelula, pontos };
    }),
  );
}

export interface Estatistica {
  minimo: number;
  media: number;
  maximo: number;
}

export function estatistica(serie: Serie, variavel: Variavel): Estatistica | null {
  const valores = serie.pontos.map((p) => p[variavel]).filter((v): v is number => v !== null);
  if (valores.length === 0) return null;
  return {
    minimo: Math.min(...valores),
    media: valores.reduce((a, b) => a + b, 0) / valores.length,
    maximo: Math.max(...valores),
  };
}
