// Regras de alerta, como a tela "Alertas · regras" do Figma mostra. Hoje o
// processo de regras do backend tem três verificações fixas (sem
// comunicação, desvio de temperatura e setpoint sem confirmação), sem
// endpoint para listar ou criar regras. Por isso a lista vem daqui e as
// mudanças ficam só no navegador.

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
