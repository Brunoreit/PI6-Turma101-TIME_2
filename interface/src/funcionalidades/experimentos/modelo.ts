// Experimentos, como as telas do Figma mostram. No modo exemplo os dados vêm
// de exemplo.ts e as mudanças ficam no navegador; no modo api, de
// /experimentos (a tradução fica em api.ts).

import type { SituacaoCelula } from "@/dados/modelo";

export type StatusExperimento = "andamento" | "standby" | "encerrado" | "cancelado";

export type TipoDeCrescimento = "Turbidostato" | "Quimiostato" | "Curva de crescimento";

export const TIPOS_DE_CRESCIMENTO: TipoDeCrescimento[] = ["Turbidostato", "Quimiostato", "Curva de crescimento"];

/** O que a pessoa logada pode fazer no experimento. */
export type Acesso = "responsavel" | "modificar" | "leitura";

export interface Pessoa {
  nome: string;
  email: string;
}

/** Quem tem acesso ao experimento sem ser o responsável. Não há convite
 *  pendente: só recebe acesso quem já tem conta. */
export interface Convidado extends Pessoa {
  /** Id da pessoa na API, usado para remover o acesso. No modo exemplo não existe. */
  idPessoa?: number;
  acesso: Exclude<Acesso, "responsavel">;
}

export interface CelulaNoExperimento {
  id: string;
  /** Id do cultivo na API, para buscar as leituras dele. */
  idCultivo?: number;
  /** Participação cancelada ("Resetar célula"): não vale para a taxa. */
  cancelada?: boolean;
  /** Como "30 °C": a condição testada nesta célula. */
  condicao: string;
  /** `null` quando a célula não aparece nos dados gerais. */
  situacao: SituacaoCelula | null;
  temperaturaC: number | null;
  od: number | null;
  ph: number | null;
  inicio: Date;
  /** `null` enquanto a célula ainda está no experimento. */
  fim: Date | null;
  ultimaLeituraEm: Date | null;
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

/** Metadados do formulário. Na API, ficam dentro de `metadados`. */
export interface Metadados {
  organismo: string;
  meio: string;
  volumeMl: number | null;
  lote: string;
  inoculoOd: number | null;
}

/** O que o formulário de Novo experimento (e de editar) preenche. */
export interface Ficha {
  nome: string;
  descricao: string;
  tipo: TipoDeCrescimento;
  duracaoDias: number;
  fases: Fase[];
  phMin: number;
  phMax: number;
  /** Só no turbidostato. */
  odMin: number | null;
  odMax: number | null;
  agitacaoRpm: number | null;
  metadados: Metadados;
}

export interface Experimento {
  /** Id da API, usado nas chamadas. No modo exemplo não existe. */
  id?: number;
  codigo: string;
  nome: string;
  descricao: string;
  tipo: TipoDeCrescimento;
  status: StatusExperimento;
  responsavel: Pessoa;
  /** Acesso da pessoa logada, calculado pela resposta da API. No modo
   *  exemplo fica vazio e vale acessoDe(). */
  acesso?: Acesso;
  convidados: Convidado[];
  /** `null` enquanto nenhuma célula foi atribuída. */
  inicio: Date | null;
  fim: Date | null;
  duracaoDias: number;
  celulas: CelulaNoExperimento[];
  /** Na lista da API só vem a contagem de células; elas vêm no detalhe. */
  celulasAbertas?: number;
  condicoes: Condicao[];
  fases: Fase[];
  phMin: number;
  phMax: number;
  odMin?: number | null;
  odMax?: number | null;
  agitacaoRpm?: number | null;
  metadados?: Metadados;
  /** `metadados` como a API devolveu, para não perder chaves ao editar. */
  metadadosDaApi?: Record<string, unknown>;
  /** Pedido ao cancelar; a API guarda em metadados.motivo_cancelamento. */
  motivoCancelamento?: string;
  /** Código do experimento de onde foi duplicado. */
  baseadoEm?: string;
}

export const ROTULO_DO_STATUS: Record<StatusExperimento, string> = {
  andamento: "Em andamento",
  standby: "Stand by",
  encerrado: "Encerrado",
  cancelado: "Cancelado",
};

/** Encerrado ou cancelado: nada mais muda. */
export function fechado(experimento: Experimento): boolean {
  return experimento.status === "encerrado" || experimento.status === "cancelado";
}

/** O acesso da pessoa logada: o que veio da API ou, no modo exemplo, o
 *  calculado pelos convidados. */
export function acessoNoExperimento(experimento: Experimento, email: string | undefined): Acesso {
  return experimento.acesso ?? acessoDe(experimento, email);
}

export function acessoDe(experimento: Experimento, email: string | undefined): Acesso {
  if (email && experimento.responsavel.email === email) return "responsavel";
  return experimento.convidados.find((c) => c.email === email)?.acesso ?? "leitura";
}

const DIA_MS = 86_400_000;

/** Dia do experimento contado a partir do início (o primeiro dia é 1). */
export function diaAtual(experimento: Experimento, agora: Date = new Date()): number {
  if (!experimento.inicio) return 0;
  const ate = fechado(experimento) ? experimento.fim : agora;
  if (!ate) return experimento.duracaoDias;
  const dias = Math.floor((ate.getTime() - experimento.inicio.getTime()) / DIA_MS) + 1;
  return Math.min(Math.max(dias, 1), Math.max(experimento.duracaoDias, 1));
}

/** Fração da duração já passada, de 0 a 1, para as barras de progresso. */
export function progresso(experimento: Experimento): number {
  if (!experimento.inicio || experimento.duracaoDias <= 0) return 0;
  return Math.min(diaAtual(experimento) / experimento.duracaoDias, 1);
}

export function terminoPrevisto(experimento: Experimento): Date | null {
  if (!experimento.inicio) return null;
  return new Date(experimento.inicio.getTime() + (experimento.duracaoDias - 1) * DIA_MS);
}
