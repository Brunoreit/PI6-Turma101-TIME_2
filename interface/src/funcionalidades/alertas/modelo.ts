// Regras de alerta, como a tela "Alertas · regras" do Figma mostra. No modo
// exemplo a lista vem daqui e as mudanças ficam na memória até recarregar a
// página. No modo api, as regras criadas na tela vêm de GET /regras e viram
// este mesmo formato (regraDaApi); as verificações fixas do backend aparecem
// numa lista à parte.

import type { NovaRegraApi, RegraApi } from "@/api/tipos";
import * as formatar from "@/compartilhado/formatar";

export type Gravidade = "aviso" | "critica";

export type Parametro = "Densidade óptica" | "Temperatura" | "pH";

export type Comparacao = "Maior que" | "Menor que";

export interface Regra {
  id: number;
  nome: string;
  descricao: string;
  condicao: string;
  porMinutos: number;
  /** Código do experimento, ou `null` para todas as células. */
  ondeVale: string | null;
  gravidade: Gravidade;
  email: boolean;
  ativa: boolean;
  dependeDoHardware?: boolean;
  /** Regras criadas por alguém. As do sistema não têm autor. */
  criadaPor?: string;
  /** Modo api: a pessoa logada pode ligar, desligar e excluir a regra. */
  podeAlterar?: boolean;
  /** Modo api: alertas que a regra tem abertos agora. */
  alertasAbertos?: number;
}

/** O que o painel Nova regra devolve, antes de virar regra do exemplo ou pedido da API. */
export interface RegraNova {
  nome: string;
  parametro: Parametro;
  comparacao: Comparacao;
  limite: number;
  /** Como a pessoa digitou, com vírgula. */
  limiteTexto: string;
  porMinutos: number;
  /** Código do experimento, ou `null` para todas as células. */
  ondeVale: string | null;
  gravidade: Gravidade;
  email: boolean;
}

const PARAMETRO_DA_API: Record<Parametro, RegraApi["parametro"]> = { "Densidade óptica": "od", Temperatura: "temperatura", pH: "ph" };
const ROTULO_DO_PARAMETRO: Record<RegraApi["parametro"], string> = { od: "OD", temperatura: "Temperatura", ph: "pH" };
const CASAS: Record<RegraApi["parametro"], number> = { od: 2, temperatura: 1, ph: 2 };

export function condicaoDaRegra(parametro: RegraApi["parametro"], comparacao: RegraApi["comparacao"], limite: number): string {
  const valor = formatar.decimal(limite, CASAS[parametro]) + (parametro === "temperatura" ? " °C" : "");
  return `${ROTULO_DO_PARAMETRO[parametro]} ${comparacao === "maior" ? "maior que" : "menor que"} ${valor}`;
}

export function regraDaApi(r: RegraApi): Regra {
  return {
    id: r.id_regra,
    nome: r.nome,
    descricao: `Criada por ${r.criada_por}.`,
    condicao: condicaoDaRegra(r.parametro, r.comparacao, r.limite),
    porMinutos: r.por_minutos,
    ondeVale: r.codigo_experimento,
    gravidade: r.gravidade,
    email: false,
    ativa: r.ativa,
    criadaPor: r.criada_por,
    podeAlterar: r.pode_alterar,
    alertasAbertos: r.alertas_abertos,
  };
}

export function regraParaApi(regra: RegraNova, idExperimento: number | undefined): NovaRegraApi {
  return {
    nome: regra.nome,
    parametro: PARAMETRO_DA_API[regra.parametro],
    comparacao: regra.comparacao === "Maior que" ? "maior" : "menor",
    limite: regra.limite,
    por_minutos: regra.porMinutos,
    gravidade: regra.gravidade,
    ...(idExperimento === undefined ? {} : { id_experimento: idExperimento }),
  };
}

export const PARAMETROS: Parametro[] = ["Densidade óptica", "Temperatura", "pH"];
export const COMPARACOES: Comparacao[] = ["Maior que", "Menor que"];

export const REGRAS_EXEMPLO: Regra[] = [
  {
    id: 1, nome: "Sem comunicação", descricao: "A célula parou de mandar leituras.",
    condicao: "Última leitura há mais de 2 min", porMinutos: 2, ondeVale: null, gravidade: "critica", email: true, ativa: true,
  },
  {
    id: 2, nome: "Desvio de temperatura", descricao: "Temperatura longe do alvo da célula.",
    condicao: "Diferença do alvo maior que 1,0 °C", porMinutos: 5, ondeVale: null, gravidade: "aviso", email: true, ativa: true,
  },
  {
    id: 3, nome: "Setpoint sem confirmação", descricao: "A placa não respondeu ao pedido.",
    condicao: "Sem resposta da placa", porMinutos: 2, ondeVale: null, gravidade: "aviso", email: false, ativa: true,
  },
  {
    id: 4, nome: "pH fora da faixa", descricao: "Usa a faixa de referência do experimento.",
    condicao: "Fora de 6,5 a 7,0", porMinutos: 10, ondeVale: "EXP-02", gravidade: "aviso", email: false, ativa: true,
  },
  {
    id: 5, nome: "Injeção contínua", descricao: "Protege contra diluição sem parar por erro na OD.",
    condicao: "Bomba de alimentação ligada com OD acima do máximo", porMinutos: 10, ondeVale: null, gravidade: "critica",
    email: true, ativa: true, dependeDoHardware: true,
  },
  {
    id: 6, nome: "OD acima do esperado", descricao: "Criada por Pedro Ximenes.",
    condicao: "OD maior que 0,80", porMinutos: 15, ondeVale: "EXP-01", gravidade: "aviso", email: false, ativa: false,
    criadaPor: "Pedro Ximenes",
  },
];
