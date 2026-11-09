// Cálculos usados por mais de um painel da Visão da célula.

import type { DetalheDaCelula, ExperimentoDaCelula } from "@/funcionalidades/celula/modelo";
import { acessoNoExperimento, type Acesso, type Experimento } from "@/funcionalidades/experimentos/modelo";

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

/** O que a pessoa logada pode fazer no cultivo da célula. No modo api vem
 *  da API; no modo exemplo, dos experimentos de exemplo. `null`: sem acesso
 *  ao experimento. */
export function acessoNaCelula(
  experimento: ExperimentoDaCelula, buscar: (codigo: string) => Experimento | undefined, email: string | undefined,
): Acesso | null {
  if (experimento.acesso !== undefined) return experimento.acesso;
  const doExemplo = buscar(experimento.codigo);
  return doExemplo ? acessoNoExperimento(doExemplo, email) : "responsavel";
}

/** Atribuir, encerrar, cancelar e mudar o pH: responsável ou edição. */
export const podeMexer = (acesso: Acesso | null) => acesso === "responsavel" || acesso === "modificar";
