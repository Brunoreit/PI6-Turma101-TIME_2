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

export type TipoAlerta =
  | "sem_comunicacao"
  | "setpoint_sem_confirmacao"
  | "desvio_temperatura"
  | "ph_fora_da_faixa"
  | "colisao_seq"
  | "consumidor_parado"
  | "broker_inacessivel";

export interface AlertaApi {
  id_alerta: number;
  /** null nos alertas do sistema (consumidor_parado e broker_inacessivel). */
  id_celula: string | null;
  /** Um tipo que a interface não conhece aparece com o próprio nome. */
  tipo: TipoAlerta | (string & {});
  mensagem: string;
  aberto_em: string;
  fechado_em: string | null;
  /** Quem fechou à mão (só o colisao_seq). Nulo quando a regra fechou. */
  fechado_por: number | null;
  fechado_por_nome: string | null;
  /** Só no tipo "regra": a regra criada na tela que abriu o alerta. */
  id_regra: number | null;
  regra_nome: string | null;
  regra_gravidade: "aviso" | "critica" | null;
}

/** Regra de alerta criada na tela (GET /regras). */
export interface RegraApi {
  id_regra: number;
  nome: string;
  parametro: "temperatura" | "od" | "ph";
  comparacao: "maior" | "menor";
  limite: number;
  por_minutos: number;
  /** null: vale para todas as células. */
  id_experimento: number | null;
  codigo_experimento: string | null;
  experimento_nome: string | null;
  gravidade: "aviso" | "critica";
  /** Avisa por e-mail quem criou (todas as células) ou o responsável e quem tem edição. */
  email: boolean;
  ativa: boolean;
  criada_por: string;
  criada_em: string;
  alertas_abertos: number;
  /** A pessoa logada pode ligar, desligar e excluir. */
  pode_alterar: boolean;
}

export type NovaRegraApi = Pick<RegraApi, "nome" | "parametro" | "comparacao" | "limite" | "por_minutos" | "gravidade" | "email"> & {
  id_experimento?: number;
};

/** POST /regras/testar: a regra ainda não salva. */
export type TesteDeRegraApi = Pick<RegraApi, "parametro" | "comparacao" | "limite" | "por_minutos"> & {
  id_experimento?: number;
  /** Quantas horas para trás; 24 por padrão. */
  horas?: number;
};

/** O que a regra teria feito no período, sem gravar nada. */
export interface ResultadoDoTesteApi {
  desde: string;
  ate: string;
  /** Células e leituras da medida olhadas no período. */
  celulas: number;
  leituras: number;
  alertas: {
    id_celula: string;
    abriria_em: string;
    /** null: ainda estaria aberto agora. */
    fecharia_em: string | null;
    /** Já estaria aberto no início do período. */
    aberto_antes: boolean;
    leituras_fora: number;
    /** O valor mais longe do limite. */
    pior: number;
  }[];
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

/** Sinal de vida de um processo do backend. */
export interface ProcessoApi {
  /** Sinal recente (dentro do limite do backend). */
  ativo: boolean;
  ultimo_sinal: string;
  iniciado_em: string;
}

export interface SaudeApi {
  banco: boolean;
  /** Se a própria API está conectada ao broker. */
  broker: boolean;
  /** null se o consumidor nunca gravou sinal de vida. */
  consumidor: (ProcessoApi & { broker_conectado: boolean; broker_desde: string }) | null;
  regras: ProcessoApi | null;
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
  /** Cultivo de onde a cultura veio (troca de placa ou de célula). */
  continua_de: number | null;
  /** Quem abriu e quem fechou o cultivo (id da pessoa). */
  id_iniciado_por: number | null;
  id_encerrado_por: number | null;
  metadados: Record<string, unknown>;
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

/** Um ponto da calibração. As versões antigas só têm `od_referencia` e
 *  `bruto`; as novas têm o branco (rotulo "branco", od_referencia null) e a
 *  origem de cada ponto. Com origem "leitura", seq_inicio, seq_fim e
 *  n_leituras apontam para as leituras que formaram a média. */
export interface PontoCalibracaoApi {
  od_referencia: number | null;
  bruto: number;
  rotulo?: string;
  origem?: "leitura" | "digitado";
  seq_inicio?: number;
  seq_fim?: number;
  n_leituras?: number;
  desvio?: number;
  gravado_em?: string;
}

/** Uma versão da curva, em GET /celulas/{id}/calibracoes. Nas versões com
 *  branco, `b` já tem o branco embutido: od = a · bruto + b. */
export interface CalibracaoApi {
  id_calibracao: number;
  versao: number;
  a: number;
  b: number;
  ativa: boolean;
  criada_em: string;
  sensor: string | null;
  pontos: PontoCalibracaoApi[] | null;
  r2: number | null;
  organismo: string | null;
  id_pessoa: number | null;
  /** null na versão padrão do sistema. */
  calibrado_por: string | null;
}

/** Resposta de POST /celulas/{id}/calibracoes. `ajuste` só vem no cadastro
 *  por pontos: a reta com o branco à parte, od = a · (bruto − branco) + b. */
export interface CalibracaoSalvaApi {
  id_calibracao: number;
  versao: number;
  a: number;
  b: number;
  criada_em: string;
  sensor: string | null;
  pontos: PontoCalibracaoApi[] | null;
  r2: number | null;
  organismo: string | null;
  id_pessoa: number | null;
  leituras_reprocessadas: number;
  ajuste?: { branco: number; a: number; b: number; r2: number; padroes: number };
}

/** GET /celulas/{id}/od-ao-vivo. */
export interface OdAoVivoApi {
  id_celula: string;
  ultima: { seq: number; ts_origem: string; od_bruto: number } | null;
  /** Até 8 leituras (ou N, se for maior), da mais antiga para a mais nova. */
  recentes: { seq: number; ts_origem: string; od_bruto: number }[];
  variacao_max: number;
  janela: {
    n_esperado: number;
    n_leituras: number;
    faltam: number;
    seq_inicio: number | null;
    seq_fim: number | null;
    media: number | null;
    minimo: number | null;
    maximo: number | null;
    variacao: number | null;
    desvio: number | null;
    estavel: boolean;
    intervalo_medio_s: number | null;
  };
}
