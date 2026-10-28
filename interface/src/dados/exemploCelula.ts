// Dados de exemplo iguais aos das telas da célula c08 no Figma (arquivo
// Telas, nós 105:1629, 85:1321 e 87:1343). Qualquer célula aberta no modo
// exemplo mostra estes dados, só com o id trocado.

import type { DetalheDaCelula, Periodo, Series } from "./modeloCelula";

const SEGUNDO = 1000;

/** Converte a altura de cada ponto no gráfico do Figma (0,5 no topo, 110,5
 *  na base) de volta para o valor medido. */
function doFigma(ys: number[], minimo: number, maximo: number): number[] {
  return ys.map((y) => maximo - ((y - 0.5) / 110) * (maximo - minimo));
}

// Médias de cada hora nas últimas 24 h, como no painel Leituras do Figma.
const TEMPERATURA_24H = doFigma(
  [63.7, 48.6, 59, 60.3, 51.7, 55, 58.3, 51.3, 51.3, 54.8, 52.5, 53.3, 50.3, 59.8, 57.6, 52.1, 52.2,
    62.9, 52.5, 56, 48.5, 50.4, 61.7, 44.5],
  29, 31,
);
const OD_24H = doFigma(
  [55.5, 43.3, 31.1, 51.9, 39.7, 27.5, 48.2, 36, 23.8, 44.6, 32.4, 53.2, 41, 28.8, 49.6, 37.4, 25.1,
    45.9, 33.7, 54.5, 42.3, 30.1, 50.9, 31.3],
  0.2, 0.4,
);
const PH_24H = doFigma(
  [28.2, 29.2, 29.7, 30.2, 29.6, 30, 31.8, 32.2, 31.2, 32.9, 33.8, 33.7, 33.7, 34.4, 33, 34.4, 34.2,
    34.2, 36.8, 36.5, 36.1, 36.6, 37.2, 37.6],
  6.4, 7.2,
);

/** Série inventada para os períodos que o Figma não mostra. Termina no
 *  valor atual para combinar com o resto da tela. */
function serieInventada(pontos: number, final: number, variacao: number, tendencia: number): number[] {
  return Array.from({ length: pontos }, (_, i) => {
    const restante = pontos - 1 - i;
    return final - tendencia * restante + variacao * Math.sin(i * 1.7) * (restante ? 1 : 0);
  });
}

function seriesDoPeriodo(periodo: Periodo): Series {
  switch (periodo) {
    case "6h":
      return { temperatura: TEMPERATURA_24H.slice(-6), od: OD_24H.slice(-6), ph: PH_24H.slice(-6) };
    case "24h":
      return { temperatura: TEMPERATURA_24H, od: OD_24H, ph: PH_24H };
    case "7d":
      return {
        temperatura: serieInventada(28, 30.2, 0.25, 0),
        od: serieInventada(28, 0.344, 0.03, 0),
        ph: serieInventada(28, 6.93, 0.03, 0.004),
      };
    case "experimento":
      return {
        temperatura: serieInventada(13, 30.2, 0.2, 0),
        od: serieInventada(13, 0.344, 0.02, 0),
        ph: serieInventada(13, 6.93, 0.02, 0.01),
      };
  }
}

export function gerarExemploDaCelula(id: string, periodo: Periodo, agora: Date = new Date()): DetalheDaCelula {
  const antes = (ms: number) => new Date(agora.getTime() - ms);

  return {
    id,
    situacao: "online",
    experimento: {
      codigo: "EXP-02",
      nome: "Adaptação a pH ácido",
      modo: "Quimiostato",
      naCelulaDesde: new Date(2026, 9, 6, 8, 14),
      responsavel: "Pedro Ximenes",
      dia: 13,
      duracaoDias: 90,
      alvoC: 30,
      phMin: 6.5,
      phMax: 7.0,
    },
    placa: {
      modelo: "ESP32",
      mac: "24:6F:28:A1:3C:5E",
      firmware: "fw-1.0",
      sensores: ["temperatura", "od", "ph"],
      onlineDesde: new Date(2026, 9, 22, 14, 3),
      keepaliveS: 30,
    },
    temperaturaC: 30.2,
    od: 0.344,
    odBruto: 1834,
    ph: 6.93,
    ultimaLeituraEm: antes(5 * SEGUNDO),
    pedido: {
      id: "sp-7f3a91c2",
      temperaturaC: 30,
      estado: "atingido",
      motivo: null,
      solicitadoPor: "Pedro Ximenes",
      solicitadoEm: new Date(2026, 9, 6, 8, 14),
    },
    alertas: [],
    series: seriesDoPeriodo(periodo),
    calibracao: {
      atual: {
        versao: 3,
        a: 0.00048,
        b: -0.041,
        criadaEm: new Date(2026, 9, 15),
        autor: "Henry Piozzi",
        padroes: [
          { referencia: 0.2, calculada: 0.2 },
          { referencia: 0.35, calculada: 0.34 },
          { referencia: 0.5, calculada: 0.51 },
          { referencia: 0.65, calculada: 0.64 },
          { referencia: 0.8, calculada: 0.8 },
        ],
        r2: 0.998,
      },
      anteriores: [
        { versao: 2, a: 0.0005, b: -0.05, criadaEm: new Date(2026, 9, 12), autor: "Henry Piozzi", padroes: [], r2: null },
        { versao: 1, a: 0.00052, b: -0.06, criadaEm: new Date(2026, 8, 30), autor: "padrão do sistema", padroes: [], r2: null },
      ],
    },
    bombas: [
      {
        nome: "Alimentação",
        situacao: "vencida",
        resumo: "1,02 mL/min",
        detalhe: "Calibrada em 10/10 · checagem a cada 10 dias, venceu em 20/10",
      },
      {
        nome: "Descarte",
        situacao: "em_dia",
        resumo: "0,98 mL/min",
        detalhe: "Calibrada em 20/10 · próxima checagem em 30/10",
      },
      {
        nome: "Segundo meio (estressor)",
        situacao: "sem_uso",
        resumo: "Não usada no EXP-02",
        detalhe: "Entra em uso quando o experimento tem um segundo meio",
      },
    ],
    checagemBombasDias: 10,
    periodoLeituraS: 20,
    manutencao: { ativa: false, ultima: { em: new Date(2026, 9, 18), motivo: "troca de mangueira" } },
    caminho: [
      { chave: "sensores", ok: true, valor: "30,2 °C · 1.834 · 6,93" },
      { chave: "placa", ok: true, valor: "0 leituras pendentes" },
      { chave: "broker", ok: true, valor: "conectada há 1 d 19 h" },
      { chave: "consumidor", ok: true, valor: "última gravação há 5 s" },
      { chave: "banco", ok: true, valor: "56.232 leituras, sem buracos" },
      { chave: "api", ok: true, valor: "atualizado há 2 s" },
    ],
    integridade: { ultimoSeq: 56231, gravadas: 56232, repetidas: 3, buracos: 0, pendentesNaPlaca: 0 },
    mensagens: [
      {
        em: new Date(2026, 9, 24, 9, 52, 14),
        tipo: "leitura",
        conteudo: 'seq 56231 · {"temperatura_c": 30.21, "od_bruto": 1834, "ph": 6.93}',
        problema: false,
      },
      {
        em: new Date(2026, 9, 24, 9, 51, 54),
        tipo: "leitura",
        conteudo: 'seq 56230 · {"temperatura_c": 30.19, "od_bruto": 1831, "ph": 6.93}',
        problema: false,
      },
      {
        em: new Date(2026, 9, 24, 9, 51, 34),
        tipo: "leitura",
        conteudo: 'seq 56229 · {"temperatura_c": 30.22, "od_bruto": 1829, "ph": 6.94}',
        problema: false,
      },
      {
        em: new Date(2026, 9, 22, 14, 3, 41),
        tipo: "estado",
        conteudo: '{"estado": "online", "sensores": ["temperatura", "od", "ph"], "versao": "fw-1.0"}',
        problema: false,
      },
      {
        em: new Date(2026, 9, 22, 13, 58, 2),
        tipo: "estado",
        conteudo: '{"estado": "offline"} · publicado pelo broker, a placa caiu sem avisar',
        problema: true,
      },
      {
        em: new Date(2026, 9, 6, 8, 14, 31),
        tipo: "setpoint/resposta",
        conteudo: '{"id": "sp-7f3a91c2", "estado": "aplicado"}',
        problema: false,
      },
    ],
    atualizadoEm: agora,
  };
}
