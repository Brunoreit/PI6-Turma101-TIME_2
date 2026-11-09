// De onde vêm os dados das telas.
//
//   VITE_FONTE_DADOS=exemplo  (padrão) dados de exemplo iguais aos do Figma
//   VITE_FONTE_DADOS=api      dados reais, pela API
//
// No modo api, o que a API ainda não informa (estado do consumidor e das
// regras, setpoints aguardando) fica como "sem dados".

import { consultarSaude, listarAlertas, listarCelulas, listarExperimentos, listarLeituras } from "@/api/cliente";
import type { AlertaApi, CelulaApi, ExperimentoListadoApi, LeituraApi, TipoAlerta } from "@/api/tipos";
import { gerarExemplo } from "./exemplo";
import {
  HORAS_DE_HISTORICO,
  type AlertaResumo,
  type Experimento,
  type CelulaResumo,
  type SituacaoCelula,
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
  const leituras = await Promise.all(
    celulas.map((c) => listarLeituras(c.id_celula, { desde: inicio, limite: 10000 }, sinal)),
  );

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
    sistema: { broker: saude?.broker ?? null, consumidor: null, regras: null },
    setpointsAguardando: null,
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
    experimento: experimentoDaCelula(celula, experimentos, agora),
    temperaturaC: celula.temperatura_c,
    ph: celula.ph,
    od: celula.od,
    temperaturaEmAlerta: daCelula.some((a) => a.tipo === "desvio_temperatura"),
    historicoOd: mediaPorHora(leituras, inicio),
    ultimaLeituraEm: celula.ultima_leitura_em ? new Date(celula.ultima_leitura_em) : null,
  };
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
