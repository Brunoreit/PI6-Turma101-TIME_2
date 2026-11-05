// Experimentos, como as telas do Figma mostram. A API ainda não tem
// endpoints de experimento (a tabela existe no banco), então por enquanto
// os dados vêm de exemplo.ts e as mudanças ficam só no navegador.

import type { SituacaoCelula } from "@/dados/modelo";

export type StatusExperimento = "andamento" | "standby" | "encerrado";

export type TipoDeCrescimento = "Turbidostato" | "Quimiostato" | "Curva de crescimento";

export const TIPOS_DE_CRESCIMENTO: TipoDeCrescimento[] = ["Turbidostato", "Quimiostato", "Curva de crescimento"];

/** O que a pessoa logada pode fazer no experimento. */
export type Acesso = "responsavel" | "modificar" | "leitura";

export interface Pessoa {
  nome: string;
  email: string;
}

export interface Convidado extends Pessoa {
  acesso: Exclude<Acesso, "responsavel">;
  /** Recebeu o convite, mas ainda não entrou no sistema. */
  pendente?: boolean;
}

export interface CelulaNoExperimento {
  id: string;
  /** Como "30 °C": a condição testada nesta célula. */
  condicao: string;
  situacao: SituacaoCelula;
  temperaturaC: number;
  od: number;
  ph: number;
  inicio: Date;
  /** `null` enquanto a célula ainda está no experimento. */
  fim: Date | null;
  ultimaLeituraEm: Date;
}

export interface Condicao {
  rotulo: string;
  /** Taxa de crescimento de cada célula da condição, em divisões por hora. */
  taxas: { idCelula: string; taxa: number }[];
  aviso?: string;
}

export interface Fase {
  duracaoDias: number;
  temperaturaC: number;
}

export interface Experimento {
  codigo: string;
  nome: string;
  descricao: string;
  tipo: TipoDeCrescimento;
  status: StatusExperimento;
  responsavel: Pessoa;
  convidados: Convidado[];
  /** `null` enquanto nenhuma célula foi atribuída. */
  inicio: Date | null;
  fim: Date | null;
  duracaoDias: number;
  celulas: CelulaNoExperimento[];
  condicoes: Condicao[];
  fases: Fase[];
  phMin: number;
  phMax: number;
  /** Código do experimento de onde foi duplicado. */
  baseadoEm?: string;
}

export const ROTULO_DO_STATUS: Record<StatusExperimento, string> = {
  andamento: "Em andamento",
  standby: "Stand by",
  encerrado: "Encerrado",
};

export function acessoDe(experimento: Experimento, email: string | undefined): Acesso {
  if (email && experimento.responsavel.email === email) return "responsavel";
  return experimento.convidados.find((c) => c.email === email)?.acesso ?? "leitura";
}

const DIA_MS = 86_400_000;

/** Dia do experimento contado a partir do início (o primeiro dia é 1). */
export function diaAtual(experimento: Experimento, agora: Date = new Date()): number {
  if (!experimento.inicio) return 0;
  if (experimento.status === "encerrado") return experimento.duracaoDias;
  const dias = Math.floor((agora.getTime() - experimento.inicio.getTime()) / DIA_MS) + 1;
  return Math.min(Math.max(dias, 1), experimento.duracaoDias);
}

export function terminoPrevisto(experimento: Experimento): Date | null {
  if (!experimento.inicio) return null;
  return new Date(experimento.inicio.getTime() + (experimento.duracaoDias - 1) * DIA_MS);
}
