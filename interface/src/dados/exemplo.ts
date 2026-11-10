// Dados de exemplo iguais aos da Visão Geral com as 16 células do eVOLVER / T.U.P.A.
// Usados no modo VITE_FONTE_DADOS=exemplo.
// Para usar os dados reais simulados pela API e banco de dados, defina VITE_FONTE_DADOS=api.

import { ESCALA_OD, type CelulaResumo, type VisaoGeral } from "./modelo";

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;
const DIA = 24 * 60 * MINUTO;

/** Altura em pixels de cada barra no Figma (de 2 a 30), convertida de volta
 *  para OD com a mesma escala que o card usa para desenhar. */
function historicoDoFigma(alturas: number[]): number[] {
  return alturas.map((altura) => ((altura - 2) / 28) * ESCALA_OD);
}

const repetir = (valor: number, vezes: number) => Array<number>(vezes).fill(valor);

const EXP_01 = { nome: "EXP-01 · Temperatura ótima", alvoC: 30, dia: 19, duracaoDias: 90 };
const EXP_02 = { nome: "EXP-02 · Adaptação pH ácido", alvoC: 30, dia: 13, duracaoDias: 90 };

export function gerarExemplo(agora: Date = new Date()): VisaoGeral {
  const antes = (ms: number) => new Date(agora.getTime() - ms);

  const celulas: CelulaResumo[] = [
    {
      id: "c01",
      apelido: "c01",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 30.1,
      ph: 6.91,
      od: 0.482,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 15), 3, 4, 5, 6, 7, 8, 8, 9, 10]),
      ultimaLeituraEm: antes(6 * SEGUNDO),
    },
    {
      id: "c02",
      apelido: "c02",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 30.0,
      ph: 6.88,
      od: 0.615,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 13), 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12]),
      ultimaLeituraEm: antes(4 * SEGUNDO),
    },
    {
      id: "c03",
      apelido: "c03",
      situacao: "alerta",
      experimento: EXP_01,
      temperaturaC: 33.4,
      ph: 6.84,
      od: 0.731,
      temperaturaEmAlerta: true,
      historicoOd: historicoDoFigma([...repetir(2, 12), 3, 4, 5, 7, 8, 9, 11, 12, 13, 14, 14, 15]),
      ultimaLeituraEm: antes(9 * SEGUNDO),
    },
    {
      id: "c04",
      apelido: "c04",
      situacao: "online",
      experimento: null,
      temperaturaC: 29.9,
      ph: 6.97,
      od: 0.198,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 21), 3, 3, 4]),
      ultimaLeituraEm: antes(3 * SEGUNDO),
    },
    {
      id: "c05",
      apelido: "c05",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 37.1,
      ph: 6.71,
      od: 1.124,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(3, 10), 5, 7, 10, 14, 18, 22, 25, 27, 28]),
      ultimaLeituraEm: antes(5 * SEGUNDO),
    },
    {
      id: "c06",
      apelido: "c06",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 36.9,
      ph: 6.66,
      od: 1.287,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(3, 8), 5, 8, 12, 16, 20, 24, 27, 29, 30]),
      ultimaLeituraEm: antes(7 * SEGUNDO),
    },
    {
      id: "c07",
      apelido: "c07",
      situacao: "online",
      experimento: EXP_02,
      temperaturaC: 30.0,
      ph: 6.52,
      od: 0.412,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 16), 3, 4, 5, 6, 7, 8, 8]),
      ultimaLeituraEm: antes(8 * SEGUNDO),
    },
    {
      id: "c08",
      apelido: "c08",
      situacao: "online",
      experimento: EXP_02,
      temperaturaC: 30.4,
      ph: 6.49,
      od: 0.388,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 17), 3, 4, 5, 6, 7, 8]),
      ultimaLeituraEm: antes(5 * SEGUNDO),
    },
    {
      id: "c09",
      apelido: "c09",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 25.0,
      ph: 6.99,
      od: 0.087,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 22), 3, 3]),
      ultimaLeituraEm: antes(4 * SEGUNDO),
    },
    {
      id: "c10",
      apelido: "c10",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 25.1,
      ph: 6.98,
      od: 0.121,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 20), 3, 3, 4]),
      ultimaLeituraEm: antes(6 * SEGUNDO),
    },
    {
      id: "c11",
      apelido: "c11",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 30.0,
      ph: 6.89,
      od: 0.552,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 14), 4, 5, 6, 8, 9, 10, 11]),
      ultimaLeituraEm: antes(10 * SEGUNDO),
    },
    {
      id: "c12",
      apelido: "c12",
      situacao: "online",
      experimento: EXP_02,
      temperaturaC: 29.9,
      ph: 6.51,
      od: 0.436,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 16), 3, 4, 5, 6, 7, 8, 9]),
      ultimaLeituraEm: antes(2 * SEGUNDO),
    },
    {
      id: "c13",
      apelido: "c13",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 32.0,
      ph: 6.90,
      od: 0.468,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 15), 3, 4, 5, 6, 7, 8, 9]),
      ultimaLeituraEm: antes(3 * SEGUNDO),
    },
    {
      id: "c14",
      apelido: "c14",
      situacao: "online",
      experimento: EXP_01,
      temperaturaC: 31.9,
      ph: 6.89,
      od: 0.501,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 14), 3, 4, 5, 7, 8, 9, 10]),
      ultimaLeituraEm: antes(4 * SEGUNDO),
    },
    {
      id: "c15",
      apelido: "c15",
      situacao: "online",
      experimento: EXP_02,
      temperaturaC: 30.1,
      ph: 6.50,
      od: 0.401,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 16), 3, 4, 5, 6, 7, 8]),
      ultimaLeituraEm: antes(5 * SEGUNDO),
    },
    {
      id: "c16",
      apelido: "c16",
      situacao: "offline",
      experimento: null,
      temperaturaC: 30.0,
      ph: 7.00,
      od: 0.050,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma(repetir(2, 24)),
      ultimaLeituraEm: antes(1 * DIA),
    },
  ];

  return {
    celulas,
    alertas: [
      {
        id: 1,
        idCelula: "c03",
        tipo: "desvio_temperatura",
        titulo: "Desvio de temperatura",
        ajuda: "A temperatura está longe do alvo. Fecha sozinho quando ela voltar para perto do alvo.",
        mensagem: "Temperatura em 33,4 °C, alvo de 30,0 °C.",
        abertoEm: antes(12 * MINUTO),
      },
    ],
    sistema: { broker: true, consumidor: true, regras: true },
    setpointsAguardando: { total: 0, detalhe: "nenhum pedido pendente" },
    leituras24h: { total: 69120, perdidas: 0 },
    atualizadoEm: agora,
  };
}
