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
  descricao: string | null;
  apelido: string | null;
  modelo: string | null;
  firmware: string | null;
  /** O cultivo aberto na célula, ou null quando ela está livre. */
  cultivo_atual: {
    id_cultivo: number;
    id_experimento: number;
    condicao: string | null;
    iniciado_em: string;
  } | null;
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

export type EstadoPedidoApi = "solicitado" | "recebido" | "aplicado" | "atingido" | "recusado";

export interface PedidoSetpointApi {
  id_pedido: string;
  id_celula: string;
  temperatura_c: number;
  estado: EstadoPedidoApi;
  motivo: string | null;
  solicitado_por: string;
  solicitado_em: string;
  recebido_em: string | null;
  aplicado_em: string | null;
  atingido_em: string | null;
}

export interface IntegridadeApi {
  id_celula: string;
  leituras: number;
  seq_unicos: number;
  esperado: number;
  primeiro_seq: number;
  ultimo_seq: number;
  completo: boolean;
}

/** Conta de uma pessoa. A senha nunca vem nas respostas. */
export interface PessoaApi {
  id_pessoa: number;
  nome: string;
  email: string;
  criado_em: string;
}

/** Resposta de POST /auth/cadastro e POST /auth/entrar. */
export interface SessaoApi {
  token: string;
  pessoa: PessoaApi;
}

export type StatusExperimentoApi = "cadastrado" | "em_andamento" | "encerrado" | "cancelado";
export type ModoApi = "curva_crescimento" | "turbidostato" | "quimiostato";
export type PermissaoApi = "leitura" | "edicao";

/** Ficha do experimento, como POST e PATCH /experimentos devolvem. */
export interface ExperimentoApi {
  codigo: string;
  id_experimento: number;
  nome: string;
  descricao: string | null;
  modo: ModoApi;
  status: StatusExperimentoApi;
  duracao_prevista_dias: number | null;
  temperatura_alvo_c: number | null;
  ph_ref_min: number | null;
  ph_ref_max: number | null;
  metadados: Record<string, unknown>;
  id_responsavel: number;
  id_origem: number | null;
  criado_em: string;
  iniciado_em: string | null;
  encerrado_em: string | null;
}

/** Item de GET /experimentos. */
export interface ExperimentoListadoApi extends ExperimentoApi {
  responsavel_nome: string;
  acesso: "responsavel" | PermissaoApi;
  cultivos_abertos: number;
}

export interface CultivoApi {
  id_cultivo: number;
  id_experimento: number;
  id_celula: string;
  condicao: string | null;
  replica: number | null;
  status: "em_andamento" | "encerrado" | "cancelado";
  ph_ref_min: number | null;
  ph_ref_max: number | null;
  iniciado_em: string;
  encerrado_em: string | null;
  motivo_encerramento: string | null;
}

/** POST /experimentos/{id}/cultivos. Sem temperatura alvo no experimento,
 *  os dois campos do setpoint vêm nulos. */
export interface CultivoIniciadoApi extends CultivoApi {
  pedido_setpoint: PedidoSetpointApi | null;
  /** false: o cultivo começou, mas o broker não confirmou o envio da temperatura. */
  setpoint_confirmado: boolean | null;
}

export interface AcessoApi {
  id_pessoa: number;
  nome: string;
  email: string;
  permissao: PermissaoApi;
  concedido_em: string;
}

/** GET /experimentos/{id}. */
export interface DetalheDoExperimentoApi extends ExperimentoApi {
  responsavel_nome: string;
  cultivos: CultivoApi[];
  acessos: AcessoApi[];
}

/** Corpo de POST /experimentos e de PATCH /experimentos/{id}. */
export interface FichaApi {
  nome: string;
  descricao: string | null;
  modo: ModoApi;
  duracao_prevista_dias: number | null;
  temperatura_alvo_c: number | null;
  ph_ref_min: number | null;
  ph_ref_max: number | null;
  metadados: Record<string, unknown>;
}
