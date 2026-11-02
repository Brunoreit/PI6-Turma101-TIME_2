// Cálculos usados por mais de um painel da Visão da célula.

import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";

export const traco = (valor: number | null, formato: (v: number) => string) => (valor === null ? "—" : formato(valor));

export function temperaturaAlvo(dados: DetalheDaCelula): number | null {
  if (dados.experimento?.alvoC != null) return dados.experimento.alvoC;
  if (dados.pedido && dados.pedido.estado !== "recusado") return dados.pedido.temperaturaC;
  return null;
}

export function faixaDePh(experimento: DetalheDaCelula["experimento"]): [number, number] | null {
  if (!experimento || experimento.phMin === null || experimento.phMax === null) return null;
  return [experimento.phMin, experimento.phMax];
}
