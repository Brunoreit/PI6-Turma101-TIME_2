// O que as telas de uma célula mostram (Visão da célula, Ajustes e
// Diagnóstico). Vem da API (fonte.ts) ou dos dados de exemplo
// (exemplo.ts). `null` quer dizer "a API ainda não informa isso".

import type { AlertaResumo, SituacaoCelula } from "@/dados/modelo";

/** Mesmos limites que a API aceita (TEMPERATURA_MIN_C e TEMPERATURA_MAX_C). */
export const TEMPERATURA_MIN_C = 20;
export const TEMPERATURA_MAX_C = 45;

export type Periodo = "6h" | "24h" | "7d" | "experimento";

export interface ExperimentoDaCelula {
  /** Ids da API (modo api). No modo exemplo não existem. */
  idExperimento?: number;
  idCultivo?: number;
  /** Acesso da pessoa logada, pela API. `null`: a pessoa não tem acesso ao
   *  experimento e só vê que a célula está em uso. No modo exemplo fica vazio. */
  acesso?: "responsavel" | "modificar" | "leitura" | null;
  /** Condição deste cultivo, como "30 °C". */
  condicao?: string | null;
  /** Número da réplica dentro da condição, quando há. */
  replica?: number | null;
  codigo: string;
  nome: string;
  modo: string;
  naCelulaDesde: Date;
  responsavel: string;
  dia: number;
  duracaoDias: number;
  alvoC: number | null;
  /** Faixa de pH de referência do cultivo (começa igual à do experimento).
   *  Serve só para os alertas. */
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
  /** Primeira vez que a placa se anunciou ao sistema (modo api). */
  primeiroAnuncio?: Date | null;
  /** Último sinal recebido da placa, de qualquer tipo (modo api). */
  ultimoContato?: Date | null;
  /** Último número de sequência gravado (modo api). */
  ultimoSeq?: number | null;
}

export type EstadoDoPedido = "solicitado" | "recebido" | "aplicado" | "atingido" | "recusado";

export interface PedidoDeSetpoint {
  id: string;
  temperaturaC: number;
  estado: EstadoDoPedido;
  motivo: string | null;
  solicitadoPor: string;
  solicitadoEm: Date;
  /** Horário de cada etapa, quando a API informa. */
  recebidoEm?: Date | null;
  aplicadoEm?: Date | null;
  atingidoEm?: Date | null;
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
  /** Primeiro número de sequência gravado (modo api). */
  primeiroSeq?: number;
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
  /** Nome de exibição, editável em Ajustes. Sem apelido, as telas mostram o id. */
  apelido?: string | null;
  /** Anotação livre da equipe sobre a célula. */
  descricao?: string | null;
  /** A última leitura gravada, com os horários de medida e de chegada e a
   *  calibração que converteu a OD (modo api). */
  ultimaLeitura?: { seq: number; medidaEm: Date; recebidaEm: Date; idCalibracao: number | null } | null;
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
