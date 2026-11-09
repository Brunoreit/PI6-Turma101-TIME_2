// Taxa de crescimento de cada cultivo, pelas leituras dele
// (GET /cultivos/{id}/leituras). Na fase de crescimento a OD sobe de forma
// exponencial: a inclinação de ln(OD) no tempo é a taxa específica μ (por
// hora), e μ / ln 2 dá as divisões por hora que o painel mostra.

import { useEffect, useState } from "react";
import { listarLeiturasDoCultivo } from "@/api/cliente";
import type { LeituraApi } from "@/api/tipos";
import { FONTE_DADOS } from "@/dados/fonte";
import type { Condicao, Experimento } from "./modelo";

const HORA_MS = 3_600_000;
const JANELA_MS = 7 * 24 * HORA_MS;
/** Menos que isso não dá uma reta confiável. */
const MINIMO_DE_LEITURAS = 6;
const OD_MINIMA = 0.005;

/** Divisões por hora, ou `null` sem leituras suficientes. */
export function taxaDeCrescimento(leituras: LeituraApi[]): number | null {
  const pontos = leituras
    .filter((l) => l.od !== null && l.od > OD_MINIMA)
    .map((l) => ({ x: new Date(l.ts_origem).getTime() / HORA_MS, y: Math.log(l.od as number) }));
  if (pontos.length < MINIMO_DE_LEITURAS) return null;
  const n = pontos.length;
  const mx = pontos.reduce((s, p) => s + p.x, 0) / n;
  const my = pontos.reduce((s, p) => s + p.y, 0) / n;
  const sxx = pontos.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = pontos.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  return sxy / sxx / Math.LN2;
}

/**
 * As condições do painel "Taxa de crescimento". No modo exemplo vêm prontas
 * do experimento; no modo api, são calculadas com as leituras dos últimos 7
 * dias de cada cultivo, agrupadas pela condição.
 */
export function useCondicoes(experimento: Experimento | undefined): Condicao[] {
  const [calculadas, setCalculadas] = useState<Condicao[]>([]);
  const cultivos = (experimento?.celulas ?? []).filter((c) => c.idCultivo !== undefined && !c.cancelada);
  const chave = cultivos.map((c) => `${c.idCultivo}:${c.fim?.getTime() ?? ""}`).join(",");

  useEffect(() => {
    if (FONTE_DADOS === "exemplo" || !chave) return setCalculadas([]);
    const controle = new AbortController();
    Promise.all(
      cultivos.map(async (c) => {
        const ate = c.fim ?? new Date();
        const desde = new Date(Math.max(c.inicio.getTime(), ate.getTime() - JANELA_MS));
        const leituras = await listarLeiturasDoCultivo(c.idCultivo!, { desde, limite: 10000 }, controle.signal);
        return { idCelula: c.id, condicao: c.condicao, taxa: taxaDeCrescimento(leituras) };
      }),
    )
      .then((taxas) => {
        const grupos = new Map<string, Condicao>();
        for (const t of taxas) {
          if (t.taxa === null) continue;
          const grupo = grupos.get(t.condicao) ?? { rotulo: t.condicao, taxas: [] };
          grupo.taxas.push({ idCelula: t.idCelula, taxa: t.taxa });
          grupos.set(t.condicao, grupo);
        }
        setCalculadas([...grupos.values()]);
      })
      .catch(() => {});
    return () => controle.abort();
    // `chave` resume os cultivos; a lista muda de referência a cada render.
  }, [chave]);

  if (FONTE_DADOS === "exemplo") return experimento?.condicoes ?? [];
  return calculadas;
}
