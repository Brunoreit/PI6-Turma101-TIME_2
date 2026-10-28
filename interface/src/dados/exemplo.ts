// Dados de exemplo iguais aos da tela "Visão geral · 4 células" do Figma
// (arquivo Telas, nó 87:1742). Usados enquanto a API não devolve todos os
// campos da tela. Para trocar pela API, defina VITE_FONTE_DADOS=api
// (ver fonte.ts).

import { ESCALA_OD, type CelulaResumo, type VisaoGeral } from "./modelo";

const SEGUNDO = 1000;
const MINUTO = 60 * SEGUNDO;

/** Altura em pixels de cada barra no Figma (de 2 a 30), convertida de volta
 *  para OD com a mesma escala que o card usa para desenhar. */
function historicoDoFigma(alturas: number[]): number[] {
  return alturas.map((altura) => ((altura - 2) / 28) * ESCALA_OD);
}

const repetir = (valor: number, vezes: number) => Array<number>(vezes).fill(valor);

const EXP_01 = { nome: "EXP-01", alvoC: 30, dia: 19, duracaoDias: 90 };

export function gerarExemplo(agora: Date = new Date()): VisaoGeral {
  const antes = (ms: number) => new Date(agora.getTime() - ms);

  const celulas: CelulaResumo[] = [
    {
      id: "c01",
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
      situacao: "online",
      experimento: null,
      temperaturaC: 29.9,
      ph: 6.97,
      od: 0.198,
      temperaturaEmAlerta: false,
      historicoOd: historicoDoFigma([...repetir(2, 21), 3, 3, 4]),
      ultimaLeituraEm: antes(3 * SEGUNDO),
    },
  ];

  return {
    celulas,
    alertas: [
      {
        id: 1,
        idCelula: "c03",
        titulo: "Desvio de temperatura",
        mensagem: "Temperatura em 33,4 °C, alvo de 30,0 °C.",
        abertoEm: antes(12 * MINUTO),
      },
    ],
    sistema: { broker: true, consumidor: true, regras: true },
    setpointsAguardando: { total: 0, detalhe: "nenhum pedido pendente" },
    leituras24h: { total: 17280, perdidas: 0 },
    atualizadoEm: agora,
  };
}
