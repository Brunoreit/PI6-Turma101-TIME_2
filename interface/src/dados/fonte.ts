// De onde vêm os dados das telas.
//
//   VITE_FONTE_DADOS=exemplo  (padrão) dados de exemplo iguais aos do Figma
//   VITE_FONTE_DADOS=api      dados reais, pela API
//
// No modo api, o estado do consumidor e das regras vem do sinal de vida que
// eles gravam (GET /saude); antes do primeiro sinal, fica "sem dados".

import { consultarSaude, listarAlertas, listarCelulas, listarExperimentos, listarLeituras, listarSetpoints } from "@/api/cliente";
import type { AlertaApi, CelulaApi, ExperimentoListadoApi, LeituraApi, PedidoSetpointApi, SaudeApi, TipoAlerta } from "@/api/tipos";
import * as formatar from "@/compartilhado/formatar";
import { gerarExemplo } from "./exemplo";
import {
  HORAS_DE_HISTORICO,
  type AlertaResumo,
  type Experimento,
  type CelulaResumo,
  type SituacaoCelula,
  type Sistema,
  type VisaoGeral,
} from "./modelo";

export const FONTE_DADOS: "exemplo" | "api" =
  import.meta.env.VITE_FONTE_DADOS === "api" ? "api" : "exemplo";

const HORA = 60 * 60 * 1000;

const DIA = 24 * HORA;

/** Título e texto de ajuda de cada tipo de alerta que o backend abre. */
export const TITULO_DO_ALERTA: Record<TipoAlerta, { titulo: string; ajuda: string }> = {
  sem_comunicacao: {
    titulo: "Sem comunicação",
    ajuda: "A célula parou de mandar sinal. Fecha sozinho quando ela voltar a se comunicar.",
  },
  setpoint_sem_confirmacao: {
    titulo: "Setpoint sem confirmação",
    ajuda: "A célula não confirmou o pedido de temperatura no prazo. Fecha sozinho quando ela confirmar.",
  },
  desvio_temperatura: {
    titulo: "Desvio de temperatura",
    ajuda: "A temperatura está longe do alvo. Fecha sozinho quando ela voltar para perto do alvo.",
  },
  ph_fora_da_faixa: {
    titulo: "pH fora da faixa do cultivo",
    ajuda: "O último pH ficou fora da faixa de referência do cultivo (a faixa e o valor estão na mensagem). Fecha sozinho quando o pH volta para a faixa.",
  },
  colisao_seq: {
    titulo: "Leitura repetida com horário diferente",
    ajuda: "Chegou uma leitura com o mesmo número de outra, mas com outro horário. A leitura original foi mantida e a nova, descartada. Este alerta não fecha sozinho.",
  },
  consumidor_parado: {
    titulo: "Consumidor parado",
    ajuda: "O processo que grava as leituras parou de dar sinal de vida. Nada se perde: o broker guarda as leituras até ele voltar. Enquanto isso, nenhuma célula ganha alerta de sem comunicação. Fecha sozinho quando ele voltar.",
  },
  broker_inacessivel: {
    titulo: "Servidor sem conexão com o broker",
    ajuda: "O servidor não alcança o broker MQTT (Raspberry Pi desligado, broker parado ou rede entre os dois cortada). As leituras ficam guardadas no broker ou nas células e chegam quando a conexão voltar. Enquanto isso, nenhuma célula ganha alerta de sem comunicação. Fecha sozinho quando a conexão voltar.",
  },
};

/** Título e ajuda de um tipo. Tipo desconhecido aparece com o próprio nome. */
export function infoDoAlerta(tipo: string): { titulo: string; ajuda: string | undefined } {
  const conhecido = TITULO_DO_ALERTA[tipo as TipoAlerta];
  return conhecido ?? { titulo: tipo, ajuda: undefined };
}

export async function carregarVisaoGeral(sinal?: AbortSignal): Promise<VisaoGeral> {
  if (FONTE_DADOS === "exemplo") return gerarExemplo();
  return carregarDaApi(sinal);
}

async function carregarDaApi(sinal?: AbortSignal): Promise<VisaoGeral> {
  const agora = new Date();
  const inicio = new Date(agora.getTime() - HORAS_DE_HISTORICO * HORA);

  const [celulas, alertas, saude, experimentos] = await Promise.all([
    listarCelulas(sinal),
    listarAlertas(sinal),
    consultarSaude(sinal).catch(() => null),
    // Só os experimentos que a pessoa vê; os outros aparecem sem nome.
    listarExperimentos(sinal).catch(() => [] as ExperimentoListadoApi[]),
  ]);
  // Uma leitura a cada 20 s dá 4.320 por dia, abaixo do limite de 10.000.
  const [leituras, pedidos] = await Promise.all([
    Promise.all(celulas.map((c) => listarLeituras(c.id_celula, { desde: inicio, limite: 10000 }, sinal))),
    // O último pedido de cada célula, para contar os que ainda não chegaram ao alvo.
    Promise.all(celulas.map((c) => listarSetpoints(c.id_celula, sinal).catch(() => [] as PedidoSetpointApi[]))),
  ]);

  let total = 0;
  let perdidas = 0;
  for (const lista of leituras) {
    if (lista.length === 0) continue;
    total += lista.length;
    // seq é contínuo por célula: o que falta entre o primeiro e o último se perdeu.
    perdidas += lista[lista.length - 1].seq - lista[0].seq + 1 - lista.length;
  }

  return {
    celulas: celulas.map((c, i) => celulaDaApi(c, leituras[i], alertas, inicio, experimentos, agora)),
    alertas: alertas.map(alertaDaApi),
    sistema: sistemaDaApi(saude, agora),
    setpointsAguardando: setpointsAguardando(pedidos.map((lista) => lista[0]).filter(Boolean)),
    leituras24h: { total, perdidas },
    atualizadoEm: agora,
  };
}

function celulaDaApi(
  celula: CelulaApi,
  leituras: LeituraApi[],
  alertas: AlertaApi[],
  inicio: Date,
  experimentos: ExperimentoListadoApi[],
  agora: Date,
): CelulaResumo {
  const daCelula = alertas.filter((a) => a.id_celula === celula.id_celula);
  const situacao: SituacaoCelula =
    celula.estado === "offline" ? "offline" : daCelula.length > 0 ? "alerta" : "online";
  return {
    id: celula.id_celula,
    apelido: celula.apelido,
    situacao,
    alertasAbertos: celula.alertas_abertos,
    experimento: experimentoDaCelula(celula, experimentos, agora),
    temperaturaC: celula.temperatura_c,
    ph: celula.ph,
    od: celula.od,
    temperaturaEmAlerta: daCelula.some((a) => a.tipo === "desvio_temperatura"),
    historicoOd: mediaPorHora(leituras, inicio),
    ultimaLeituraEm: celula.ultima_leitura_em ? new Date(celula.ultima_leitura_em) : null,
  };
}

/** Pedidos que ainda não chegaram ao alvo nem foram recusados: o último de
 *  cada célula, se estiver solicitado, recebido ou aplicado. */
function setpointsAguardando(ultimos: PedidoSetpointApi[]): { total: number; detalhe: string } {
  const pendentes = ultimos.filter((p) => p.estado === "solicitado" || p.estado === "recebido" || p.estado === "aplicado");
  if (pendentes.length === 0) return { total: 0, detalhe: "nenhum pedido pendente" };
  const detalhe = pendentes
    .slice(0, 3)
    .map((p) => `${p.id_celula} em ${formatar.temperatura(p.temperatura_c)} (${p.estado})`)
    .join(", ");
  return { total: pendentes.length, detalhe: pendentes.length > 3 ? `${detalhe}…` : detalhe };
}

/** O experimento do cultivo aberto na célula, ou null se ela está livre. */
function experimentoDaCelula(celula: CelulaApi, experimentos: ExperimentoListadoApi[], agora: Date): Experimento | null {
  const cultivo = celula.cultivo_atual;
  if (!cultivo) return null;
  const e = experimentos.find((x) => x.id_experimento === cultivo.id_experimento);
  if (!e) {
    const codigo = `EXP-${String(cultivo.id_experimento).padStart(2, "0")}`;
    return { nome: `${codigo} · de outra pessoa`, alvoC: null, dia: 0, duracaoDias: 0 };
  }
  const desde = new Date(e.iniciado_em ?? cultivo.iniciado_em);
  const duracaoDias = e.duracao_prevista_dias ?? 0;
  const dia = Math.max(1, Math.floor((agora.getTime() - desde.getTime()) / DIA) + 1);
  return {
    nome: `${e.codigo} · ${e.nome}`,
    alvoC: e.temperatura_alvo_c,
    dia: duracaoDias ? Math.min(dia, duracaoDias) : dia,
    duracaoDias,
  };
}

function mediaPorHora(leituras: LeituraApi[], inicio: Date): (number | null)[] {
  const somas = Array<number>(HORAS_DE_HISTORICO).fill(0);
  const contagens = Array<number>(HORAS_DE_HISTORICO).fill(0);
  for (const leitura of leituras) {
    if (leitura.od === null) continue;
    const hora = Math.floor((new Date(leitura.ts_origem).getTime() - inicio.getTime()) / HORA);
    if (hora < 0 || hora >= HORAS_DE_HISTORICO) continue;
    somas[hora] += leitura.od;
    contagens[hora] += 1;
  }
  return somas.map((soma, i) => (contagens[i] ? soma / contagens[i] : null));
}

/** Barra lateral: o broker visto pela API e o sinal de vida do consumidor
 *  (vivo e ligado ao broker) e das regras. */
export function sistemaDaApi(saude: SaudeApi | null, agora: Date): Sistema {
  if (!saude) return { broker: null, consumidor: null, regras: null };
  const parado = (p: { ultimo_sinal: string } | null) =>
    p ? `parado ${formatar.tempoDecorrido(new Date(p.ultimo_sinal), agora)}` : undefined;
  const c = saude.consumidor;
  const textos: Sistema["textos"] = { broker: saude.broker ? undefined : "desconectado" };
  let consumidor: boolean | null = null;
  if (c && !c.ativo) {
    consumidor = false;
    textos.consumidor = parado(c);
  } else if (c && !c.broker_conectado) {
    consumidor = false;
    textos.consumidor = "sem broker";
  } else if (c) {
    consumidor = true;
  }
  const regras = saude.regras ? saude.regras.ativo : null;
  if (saude.regras && !saude.regras.ativo) textos.regras = parado(saude.regras);
  return { broker: saude.broker, consumidor, regras, textos };
}

export function alertaDaApi(alerta: AlertaApi): AlertaResumo {
  return {
    id: alerta.id_alerta,
    idCelula: alerta.id_celula,
    tipo: alerta.tipo,
    ...infoDoAlerta(alerta.tipo),
    mensagem: alerta.mensagem,
    abertoEm: new Date(alerta.aberto_em),
  };
}
