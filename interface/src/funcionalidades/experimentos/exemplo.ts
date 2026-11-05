// Experimentos de exemplo iguais aos das telas "Experimentos · compartilhados"
// e "Experimento EXP-01" do Figma (arquivo Telas, nós 78:1217 e 14:1164).
// Os dias são contados a partir de hoje, para o "dia 19 de 90" continuar
// valendo em qualquer data.

import type { CelulaNoExperimento, Experimento, Pessoa } from "./modelo";

const DIA = 86_400_000;
const agora = Date.now();
const diasAtras = (dias: number) => new Date(agora - dias * DIA);
const segundosAtras = (segundos: number) => new Date(agora - segundos * 1000);

export const PESSOAS = {
  rogerio: { nome: "Rogério Medina", email: "rogerio.medina@cnpem.br" },
  pedro: { nome: "Pedro Ximenes", email: "pedro.ximenes@cnpem.br" },
  henry: { nome: "Henry Piozzi", email: "henry.piozzi@cnpem.br" },
  gabriel: { nome: "Gabriel Bonatto", email: "gabriel.bonatto@cnpem.br" },
} satisfies Record<string, Pessoa>;

function celula(
  id: string, condicao: string, temperaturaC: number, od: number, ph: number,
  inicioDias: number, segundos: number, situacao: CelulaNoExperimento["situacao"] = "online",
): CelulaNoExperimento {
  return { id, condicao, situacao, temperaturaC, od, ph, inicio: diasAtras(inicioDias), fim: null, ultimaLeituraEm: segundosAtras(segundos) };
}

export const EXPERIMENTOS_EXEMPLO: Experimento[] = [
  {
    codigo: "EXP-01",
    nome: "Temperatura ótima de E. coli",
    descricao: "Compara o crescimento a 25, 30, 32 e 37 °C",
    tipo: "Turbidostato",
    status: "andamento",
    responsavel: PESSOAS.rogerio,
    convidados: [
      { ...PESSOAS.pedro, acesso: "leitura" },
      { ...PESSOAS.henry, acesso: "modificar" },
      { ...PESSOAS.gabriel, acesso: "leitura", pendente: true },
    ],
    inicio: diasAtras(18),
    fim: null,
    duracaoDias: 90,
    celulas: [
      celula("c09", "25 °C", 25.0, 0.087, 6.99, 18, 8),
      celula("c10", "25 °C", 25.1, 0.121, 6.98, 18, 1),
      celula("c01", "30 °C", 30.1, 0.482, 6.91, 18, 6),
      celula("c02", "30 °C", 30.0, 0.615, 6.88, 18, 4),
      celula("c03", "30 °C", 33.4, 0.731, 6.84, 18, 9, "alerta"),
      celula("c13", "32 °C", 32.0, 0.468, 6.9, 17, 4),
      celula("c14", "32 °C", 31.9, 0.501, 6.89, 17, 2),
      celula("c05", "37 °C", 37.1, 1.124, 6.71, 18, 7),
      celula("c06", "37 °C", 36.9, 1.287, 6.66, 18, 2),
      celula("c11", "37 °C", 30.0, 0.552, 6.89, 2, 6, "alerta"),
    ],
    condicoes: [
      { rotulo: "25 °C", taxas: [{ idCelula: "c09", taxa: 0.3 }, { idCelula: "c10", taxa: 0.32 }] },
      {
        rotulo: "30 °C",
        taxas: [{ idCelula: "c01", taxa: 0.51 }, { idCelula: "c02", taxa: 0.54 }, { idCelula: "c03", taxa: 0.49 }],
        aviso: "c03 com desvio de temperatura há 12 min",
      },
      { rotulo: "32 °C", taxas: [{ idCelula: "c13", taxa: 0.57 }, { idCelula: "c14", taxa: 0.59 }] },
      {
        rotulo: "37 °C",
        taxas: [{ idCelula: "c05", taxa: 0.64 }, { idCelula: "c06", taxa: 0.62 }],
        aviso: "c11 aguardando confirmação do setpoint, fora da média",
      },
    ],
    fases: [{ duracaoDias: 90, temperaturaC: 30 }],
    phMin: 6.6,
    phMax: 7.2,
  },
  {
    codigo: "EXP-02",
    nome: "Adaptação a pH ácido",
    descricao: "Cepa em meio com pH 6,5, temperatura fixa de 30 °C",
    tipo: "Quimiostato",
    status: "andamento",
    responsavel: PESSOAS.pedro,
    convidados: [],
    inicio: diasAtras(12),
    fim: null,
    duracaoDias: 90,
    celulas: [
      celula("c07", "pH 6,5", 30.0, 0.412, 6.52, 12, 3),
      celula("c08", "pH 6,5", 30.4, 0.388, 6.49, 12, 5),
      celula("c12", "pH 6,5", 29.9, 0.436, 6.51, 12, 2),
      celula("c15", "pH 6,5", 30.1, 0.401, 6.5, 12, 7),
    ],
    condicoes: [
      {
        rotulo: "pH 6,5",
        taxas: [
          { idCelula: "c07", taxa: 0.42 }, { idCelula: "c08", taxa: 0.4 },
          { idCelula: "c12", taxa: 0.44 }, { idCelula: "c15", taxa: 0.41 },
        ],
      },
    ],
    fases: [{ duracaoDias: 90, temperaturaC: 30 }],
    phMin: 6.3,
    phMax: 6.7,
  },
  {
    codigo: "EXP-03",
    nome: "Temperatura ótima · repetição",
    descricao: "Duplicado do EXP-01, faixa de 28 a 34 °C",
    tipo: "Turbidostato",
    status: "standby",
    responsavel: PESSOAS.pedro,
    convidados: [],
    inicio: null,
    fim: null,
    duracaoDias: 90,
    celulas: [],
    condicoes: [],
    fases: [{ duracaoDias: 45, temperaturaC: 30 }, { duracaoDias: 45, temperaturaC: 32 }],
    phMin: 6.6,
    phMax: 7.2,
    baseadoEm: "EXP-01",
  },
  {
    codigo: "EXP-04",
    nome: "Validação do sensor de OD",
    descricao: "Curvas de referência para a calibração",
    tipo: "Curva de crescimento",
    status: "encerrado",
    responsavel: PESSOAS.henry,
    convidados: [{ ...PESSOAS.pedro, acesso: "modificar" }],
    inicio: new Date(2026, 6, 1),
    fim: new Date(2026, 8, 29),
    duracaoDias: 90,
    celulas: [
      { ...celula("c04", "Referência", 30.0, 0.0, 7.0, 0, 0, "offline"), inicio: new Date(2026, 6, 1), fim: new Date(2026, 8, 29) },
      { ...celula("c16", "Referência", 30.0, 0.0, 7.0, 0, 0, "offline"), inicio: new Date(2026, 6, 1), fim: new Date(2026, 8, 29) },
    ],
    condicoes: [],
    fases: [{ duracaoDias: 90, temperaturaC: 30 }],
    phMin: 6.8,
    phMax: 7.2,
  },
];
