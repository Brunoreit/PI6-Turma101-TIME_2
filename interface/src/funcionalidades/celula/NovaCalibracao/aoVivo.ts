// Sensor de OD ao vivo da Nova calibração. No modo api, GET
// /celulas/{id}/od-ao-vivo a cada 5 s, só com a tela aberta. No modo exemplo,
// uma leitura simulada a cada 3 s que sobe até o padrão do frasco e
// estabiliza em uns 30 s, para dar para ver os estados Estabilizando e Estável.

import { useCallback, useEffect, useRef, useState } from "react";
import { consultarOdAoVivo } from "@/api/cliente";
import { FONTE_DADOS } from "@/dados/fonte";
import { estavel, resumir } from "./regressao";

export const INTERVALO_AO_VIVO_MS = 5000;

export interface LeituraDeOd {
  seq: number;
  medidaEm: Date;
  bruto: number;
}

export interface OdAoVivo {
  ultima: LeituraDeOd | null;
  /** Até 8 leituras, da mais antiga para a mais nova, para o gráfico. */
  recentes: LeituraDeOd[];
  variacaoMax: number;
  janela: {
    /** Quantas leituras formam a média (CALIBRACAO_N_LEITURAS). */
    nEsperado: number;
    n: number;
    faltam: number;
    seqInicio: number | null;
    seqFim: number | null;
    media: number | null;
    minimo: number | null;
    maximo: number | null;
    variacao: number | null;
    desvio: number | null;
    estavel: boolean;
    intervaloMedioS: number | null;
  };
}

async function daApi(id: string, sinal?: AbortSignal): Promise<OdAoVivo> {
  const r = await consultarOdAoVivo(id, sinal);
  const leitura = (l: { seq: number; ts_origem: string; od_bruto: number }): LeituraDeOd =>
    ({ seq: l.seq, medidaEm: new Date(l.ts_origem), bruto: l.od_bruto });
  const j = r.janela;
  return {
    ultima: r.ultima ? leitura(r.ultima) : null,
    recentes: r.recentes.map(leitura),
    variacaoMax: r.variacao_max,
    janela: {
      nEsperado: j.n_esperado,
      n: j.n_leituras,
      faltam: j.faltam,
      seqInicio: j.seq_inicio,
      seqFim: j.seq_fim,
      media: j.media,
      minimo: j.minimo,
      maximo: j.maximo,
      variacao: j.variacao,
      desvio: j.desvio,
      estavel: j.estavel,
      intervaloMedioS: j.intervalo_medio_s,
    },
  };
}

// ---------------------------------------------------------------- modo exemplo

const N_EXEMPLO = 6;
const VARIACAO_EXEMPLO = 0.01;
const PERIODO_EXEMPLO_S = 3;
/** Rapidez com que o valor chega ao padrão novo: estabiliza em uns 30 s. */
const TAU_EXEMPLO_S = 3.5;
const SEQ_EXEMPLO = 56200;

/** Frasco simulado: o valor vai de `de` até `ate` a partir de `desde`. */
const frasco = { inicio: Date.now(), desde: Date.now(), de: 60, ate: 98 };

function valorNoExemplo(t: number): number {
  const s = (t - frasco.desde) / 1000;
  const base = s <= 0 ? frasco.de : frasco.ate + (frasco.de - frasco.ate) * Math.exp(-s / TAU_EXEMPLO_S);
  // Ruído fixo por instante, de ±0,1%, para o gráfico não ser uma linha reta.
  const ruido = Math.sin(t / 997) * 0.6 + Math.sin(t / 331) * 0.4;
  return Math.round(base * (1 + ruido * 0.001));
}

/** Troca o frasco do exemplo: a leitura passa a subir (ou descer) até `bruto`. */
export function trocarFrascoNoExemplo(bruto: number): void {
  if (FONTE_DADOS !== "exemplo") return;
  const agora = Date.now();
  frasco.de = valorNoExemplo(agora);
  frasco.ate = bruto;
  frasco.desde = agora;
}

function doExemplo(): OdAoVivo {
  const agora = Date.now();
  const passos = Math.floor((agora - frasco.inicio) / (PERIODO_EXEMPLO_S * 1000));
  const recentes: LeituraDeOd[] = [];
  for (let k = Math.max(0, passos - 7); k <= passos; k++) {
    const medidaEm = new Date(frasco.inicio + k * PERIODO_EXEMPLO_S * 1000);
    recentes.push({ seq: SEQ_EXEMPLO + k, medidaEm, bruto: valorNoExemplo(medidaEm.getTime()) });
  }
  const janela = recentes.slice(-N_EXEMPLO);
  const resumo = resumir(janela.map((l) => l.bruto));
  return {
    ultima: recentes[recentes.length - 1],
    recentes,
    variacaoMax: VARIACAO_EXEMPLO,
    janela: {
      nEsperado: N_EXEMPLO,
      n: janela.length,
      faltam: N_EXEMPLO - janela.length,
      seqInicio: janela[0].seq,
      seqFim: janela[janela.length - 1].seq,
      media: resumo?.media ?? null,
      minimo: resumo?.minimo ?? null,
      maximo: resumo?.maximo ?? null,
      variacao: resumo?.variacao ?? null,
      desvio: resumo?.desvio ?? null,
      estavel: estavel(resumo, N_EXEMPLO, VARIACAO_EXEMPLO),
      intervaloMedioS: janela.length > 1 ? PERIODO_EXEMPLO_S : null,
    },
  };
}

export async function lerOdAoVivo(id: string, sinal?: AbortSignal): Promise<OdAoVivo> {
  return FONTE_DADOS === "exemplo" ? doExemplo() : daApi(id, sinal);
}

// ---------------------------------------------------------------- hook

/** Consulta a cada 5 s enquanto a tela está aberta e para ao sair. */
export function useOdAoVivo(id: string): { aoVivo: OdAoVivo | null; erro: string | null; atualizar: () => void } {
  const [aoVivo, setAoVivo] = useState<OdAoVivo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const buscarAgora = useRef<() => void>(() => {});

  useEffect(() => {
    setAoVivo(null);
    let controle = new AbortController();
    async function buscar() {
      controle.abort();
      controle = new AbortController();
      try {
        setAoVivo(await lerOdAoVivo(id, controle.signal));
        setErro(null);
      } catch (falha) {
        if (controle.signal.aborted) return;
        setErro(falha instanceof Error ? falha.message : String(falha));
      }
    }
    buscarAgora.current = buscar;
    buscar();
    const temporizador = setInterval(buscar, INTERVALO_AO_VIVO_MS);
    return () => {
      clearInterval(temporizador);
      controle.abort();
    };
  }, [id]);

  const atualizar = useCallback(() => buscarAgora.current(), []);
  return { aoVivo, erro, atualizar };
}
