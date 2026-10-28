// O que as telas mostram. Vem da API (fonte.ts) ou dos dados de exemplo
// (exemplo.ts). `null` quer dizer "a API ainda não informa isso".

export type SituacaoCelula = "online" | "alerta" | "offline";

export interface Experimento {
  nome: string;
  /** Temperatura alvo do experimento. Pode não estar definida. */
  alvoC: number | null;
  dia: number;
  duracaoDias: number;
}

export interface CelulaResumo {
  id: string;
  situacao: SituacaoCelula;
  /** `null`: célula livre. `undefined`: a API ainda não informa. */
  experimento: Experimento | null | undefined;
  temperaturaC: number | null;
  ph: number | null;
  od: number | null;
  temperaturaEmAlerta: boolean;
  /** Média da OD em cada hora das últimas 24 h, da mais antiga para a mais
   *  recente. `null` onde não houve leitura naquela hora. */
  historicoOd: (number | null)[];
  ultimaLeituraEm: Date | null;
}

export interface AlertaResumo {
  id: number;
  idCelula: string;
  titulo: string;
  mensagem: string;
  abertoEm: Date;
}

export interface Sistema {
  broker: boolean | null;
  consumidor: boolean | null;
  regras: boolean | null;
}

export interface VisaoGeral {
  celulas: CelulaResumo[];
  alertas: AlertaResumo[];
  sistema: Sistema;
  setpointsAguardando: { total: number; detalhe: string } | null;
  leituras24h: { total: number; perdidas: number } | null;
  atualizadoEm: Date;
}

export const HORAS_DE_HISTORICO = 24;

/** OD que enche a barra do histórico. Fixa, e não relativa a cada célula,
 *  para que os cards possam ser comparados entre si. */
export const ESCALA_OD = 1.6;
