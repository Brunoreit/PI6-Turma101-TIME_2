// O que as telas de uma célula mostram (Visão da célula, Ajustes e
// Diagnóstico). Vem da API (fonteCelula.ts) ou dos dados de exemplo
// (exemploCelula.ts). `null` quer dizer "a API ainda não informa isso".

import type { AlertaResumo, SituacaoCelula } from "./modelo";

/** Mesmos limites que a API aceita (TEMPERATURA_MIN_C e TEMPERATURA_MAX_C). */
export const TEMPERATURA_MIN_C = 20;
export const TEMPERATURA_MAX_C = 45;

export type Periodo = "6h" | "24h" | "7d" | "experimento";

export interface ExperimentoDaCelula {
  codigo: string;
  nome: string;
  modo: string;
  naCelulaDesde: Date;
  responsavel: string;
  dia: number;
  duracaoDias: number;
  alvoC: number | null;
  /** Faixa de pH de referência. Serve só para os alertas. */
  phMin: number | null;
  phMax: number | null;
}

export interface Placa {
  modelo: string | null;
  mac: string | null;
  firmware: string | null;
  sensores: string[];
  onlineDesde: Date | null;
  keepaliveS: number | null;
}

export type EstadoDoPedido = "solicitado" | "recebido" | "aplicado" | "atingido" | "recusado";

export interface PedidoDeSetpoint {
  id: string;
  temperaturaC: number;
  estado: EstadoDoPedido;
  motivo: string | null;
  solicitadoPor: string;
  solicitadoEm: Date;
}

/** Médias de cada intervalo do período, da mais antiga para a mais recente.
 *  `null` onde não houve leitura. */
export interface Series {
  temperatura: (number | null)[];
  od: (number | null)[];
  ph: (number | null)[];
}

export interface VersaoDeCalibracao {
  versao: number;
  /** od = a · bruto + b */
  a: number;
  b: number;
  criadaEm: Date;
  autor: string;
  /** OD do espectrofotômetro e OD calculada para cada padrão lido. */
  padroes: { referencia: number; calculada: number }[];
  r2: number | null;
}

export interface Bomba {
  nome: string;
  situacao: "vencida" | "em_dia" | "sem_uso";
  /** "1,02 mL/min" ou, sem uso, o motivo. */
  resumo: string;
  detalhe: string;
}

export interface Manutencao {
  ativa: boolean;
  ultima: { em: Date; motivo: string } | null;
}

export type ChaveDaEtapa = "sensores" | "placa" | "broker" | "consumidor" | "banco" | "api";

export interface EtapaDoCaminho {
  chave: ChaveDaEtapa;
  /** `null`: a API não informa o estado desta parte. */
  ok: boolean | null;
  valor: string;
}

export interface Integridade {
  ultimoSeq: number;
  gravadas: number;
  repetidas: number | null;
  buracos: number;
  pendentesNaPlaca: number | null;
}

export interface Mensagem {
  em: Date;
  tipo: string;
  conteudo: string;
  /** Destaca em vermelho, como o offline publicado pelo broker. */
  problema: boolean;
}

export interface DetalheDaCelula {
  id: string;
  situacao: SituacaoCelula;
  /** `null`: célula livre. `undefined`: a API ainda não informa. */
  experimento: ExperimentoDaCelula | null | undefined;
  placa: Placa;
  temperaturaC: number | null;
  od: number | null;
  odBruto: number | null;
  ph: number | null;
  ultimaLeituraEm: Date | null;
  /** Último pedido de setpoint, ou `null` se nunca houve. */
  pedido: PedidoDeSetpoint | null;
  alertas: AlertaResumo[];
  series: Series;
  calibracao: { atual: VersaoDeCalibracao; anteriores: VersaoDeCalibracao[] } | null;
  bombas: Bomba[] | null;
  checagemBombasDias: number | null;
  periodoLeituraS: number | null;
  manutencao: Manutencao | null;
  caminho: EtapaDoCaminho[];
  integridade: Integridade | null;
  mensagens: Mensagem[] | null;
  atualizadoEm: Date;
}
