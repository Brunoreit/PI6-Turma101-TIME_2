// Formatos devolvidos pela API (backend/app/api/main.py). Seguem as colunas
// do banco em banco/init/01_tabelas.sql. Datas chegam como texto ISO 8601.

export type EstadoCelula = "online" | "offline";

export interface CelulaApi {
  id_celula: string;
  estado: EstadoCelula;
  sensores: string[];
  primeiro_anuncio: string;
  ultimo_contato: string | null;
  ultima_seq: number | null;
  ultima_leitura_em: string | null;
  temperatura_c: number | null;
  od: number | null;
  ph: number | null;
  alertas_abertos: number;
}

export type TipoAlerta = "sem_comunicacao" | "setpoint_sem_confirmacao" | "desvio_temperatura";

export interface AlertaApi {
  id_alerta: number;
  id_celula: string;
  tipo: TipoAlerta;
  mensagem: string;
  aberto_em: string;
  fechado_em: string | null;
}

export interface LeituraApi {
  seq: number;
  ts_origem: string;
  ts_recebido: string;
  temperatura_c: number | null;
  od_bruto: number | null;
  od: number | null;
  ph: number | null;
  id_calibracao: number | null;
}

export interface SaudeApi {
  banco: boolean;
  broker: boolean;
}
