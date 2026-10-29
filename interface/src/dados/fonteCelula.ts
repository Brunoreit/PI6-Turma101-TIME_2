// Dados das telas de uma célula. Segue VITE_FONTE_DADOS, como a visão geral
// (ver fonte.ts). No modo api, o que a API ainda não informa (experimento,
// placa, calibração, bombas, manutenção, mensagens recebidas) fica `null`.

import {
  consultarIntegridade,
  consultarSaude,
  listarAlertas,
  listarCelulas,
  listarLeituras,
  listarSetpoints,
  pedirSetpoint,
} from "../api/cliente";
import type { LeituraApi } from "../api/tipos";
import { gerarExemploDaCelula } from "./exemploCelula";
import { alertaDaApi, FONTE_DADOS } from "./fonte";
import * as formatar from "./formatar";
import type { SituacaoCelula } from "./modelo";
import type { DetalheDaCelula, EtapaDoCaminho, Periodo, Series } from "./modeloCelula";

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;

/** Quantos intervalos cada período tem e quanto dura cada um. Sem o
 *  experimento, que a API ainda não informa, "experimento" vira 7 dias. */
const INTERVALOS: Record<Periodo, { quantidade: number; duracaoMs: number }> = {
  "6h": { quantidade: 24, duracaoMs: 15 * MINUTO },
  "24h": { quantidade: 24, duracaoMs: HORA },
  "7d": { quantidade: 28, duracaoMs: 6 * HORA },
  experimento: { quantidade: 28, duracaoMs: 6 * HORA },
};

/** Sem leitura há mais que isso (3 períodos de 20 s), a etapa não está ok. */
const LEITURA_RECENTE_MS = 60 * 1000;

export async function carregarCelula(id: string, periodo: Periodo, sinal?: AbortSignal): Promise<DetalheDaCelula> {
  if (FONTE_DADOS === "exemplo") return gerarExemploDaCelula(id, periodo);
  return carregarDaApi(id, periodo, sinal);
}

/** Pede a nova temperatura alvo. No modo exemplo não há para onde enviar. */
export async function enviarSetpoint(id: string, temperaturaC: number): Promise<void> {
  if (FONTE_DADOS === "exemplo") {
    throw new Error("Modo exemplo: o pedido não foi enviado. Rode com VITE_FONTE_DADOS=api para comandar a célula.");
  }
  await pedirSetpoint(id, temperaturaC);
}

async function carregarDaApi(id: string, periodo: Periodo, sinal?: AbortSignal): Promise<DetalheDaCelula> {
  const agora = new Date();
  const { quantidade, duracaoMs } = INTERVALOS[periodo];
  const inicio = new Date(agora.getTime() - quantidade * duracaoMs);

  const [celulas, alertas, saude, pedidos, integridades, leituras] = await Promise.all([
    listarCelulas(sinal),
    listarAlertas(sinal),
    consultarSaude(sinal).catch(() => null),
    listarSetpoints(id, sinal),
    consultarIntegridade(sinal).catch(() => null),
    // A API devolve no máximo 10.000 leituras, as mais recentes: em 7 dias
    // com uma a cada 20 s, o começo do período fica sem pontos.
    listarLeituras(id, { desde: inicio, limite: 10000 }, sinal),
  ]);

  const celula = celulas.find((c) => c.id_celula === id);
  if (!celula) throw new Error(`A célula ${id} não está cadastrada. Confira o id na Visão geral.`);

  const daCelula = alertas.filter((a) => a.id_celula === id);
  const situacao: SituacaoCelula =
    celula.estado === "offline" ? "offline" : daCelula.length > 0 ? "alerta" : "online";
  const ultimaLeituraEm = celula.ultima_leitura_em ? new Date(celula.ultima_leitura_em) : null;
  const odBruto = leituras.length ? leituras[leituras.length - 1].od_bruto : null;
  const linha = integridades?.find((i) => i.id_celula === id);
  const integridade = linha
    ? {
        ultimoSeq: linha.ultimo_seq,
        gravadas: linha.leituras,
        repetidas: null,
        buracos: linha.esperado - linha.seq_unicos,
        pendentesNaPlaca: null,
      }
    : null;
  const ultimo = pedidos[0];

  const recente = ultimaLeituraEm !== null && agora.getTime() - ultimaLeituraEm.getTime() < LEITURA_RECENTE_MS;
  const medidas = [
    celula.temperatura_c === null ? "—" : formatar.temperatura(celula.temperatura_c),
    odBruto === null ? "—" : formatar.inteiro(odBruto),
    celula.ph === null ? "—" : formatar.decimal(celula.ph, 2),
  ].join(" · ");
  const caminho: EtapaDoCaminho[] = [
    { chave: "sensores", ok: recente, valor: ultimaLeituraEm ? medidas : "sem leituras" },
    {
      chave: "placa",
      ok: celula.estado === "online",
      valor: celula.estado === "online" ? "online"
        : celula.ultimo_contato ? `offline desde ${formatar.diaHora(new Date(celula.ultimo_contato))}`
        : "offline",
    },
    {
      chave: "broker",
      ok: saude?.broker ?? null,
      valor: saude === null ? "sem dados" : saude.broker ? "conectado à API" : "desconectado da API",
    },
    // Sem sinal de vida do consumidor, leitura antiga não diz se ele parou
    // ou se a célula parou de mandar. Só a leitura recente prova que está ok.
    {
      chave: "consumidor",
      ok: recente ? true : null,
      valor: ultimaLeituraEm ? `última gravação ${formatar.tempoDecorrido(ultimaLeituraEm, agora)}` : "nada gravado",
    },
    {
      chave: "banco",
      ok: saude?.banco ?? null,
      valor: !integridade ? "sem dados"
        : `${formatar.inteiro(integridade.gravadas)} leituras, ${
          integridade.buracos === 0 ? "sem buracos" : `${formatar.inteiro(integridade.buracos)} faltando`}`,
    },
    { chave: "api", ok: true, valor: "atualizado agora" },
  ];

  return {
    id,
    situacao,
    experimento: undefined,
    placa: { modelo: null, mac: null, firmware: null, sensores: celula.sensores, onlineDesde: null, keepaliveS: null },
    temperaturaC: celula.temperatura_c,
    od: celula.od,
    odBruto,
    ph: celula.ph,
    ultimaLeituraEm,
    pedido: ultimo
      ? {
          id: ultimo.id_pedido,
          temperaturaC: ultimo.temperatura_c,
          estado: ultimo.estado,
          motivo: ultimo.motivo,
          solicitadoPor: ultimo.solicitado_por,
          solicitadoEm: new Date(ultimo.solicitado_em),
        }
      : null,
    alertas: daCelula.map(alertaDaApi),
    series: mediasPorIntervalo(leituras, inicio, duracaoMs, quantidade),
    calibracao: null,
    bombas: null,
    checagemBombasDias: null,
    periodoLeituraS: null,
    manutencao: null,
    caminho,
    integridade,
    mensagens: null,
    atualizadoEm: agora,
  };
}

function mediasPorIntervalo(leituras: LeituraApi[], inicio: Date, duracaoMs: number, quantidade: number): Series {
  const campos = ["temperatura_c", "od", "ph"] as const;
  const somas = campos.map(() => Array<number>(quantidade).fill(0));
  const contagens = campos.map(() => Array<number>(quantidade).fill(0));
  for (const leitura of leituras) {
    const i = Math.floor((new Date(leitura.ts_origem).getTime() - inicio.getTime()) / duracaoMs);
    if (i < 0 || i >= quantidade) continue;
    campos.forEach((campo, c) => {
      const valor = leitura[campo];
      if (valor === null) return;
      somas[c][i] += valor;
      contagens[c][i] += 1;
    });
  }
  const [temperatura, od, ph] = somas.map((lista, c) =>
    lista.map((soma, i) => (contagens[c][i] ? soma / contagens[c][i] : null)),
  );
  return { temperatura, od, ph };
}
