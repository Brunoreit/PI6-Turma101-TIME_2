// De onde vêm os dados das telas.
//
//   VITE_FONTE_DADOS=exemplo  (padrão) dados de exemplo iguais aos do Figma
//   VITE_FONTE_DADOS=api      dados reais, pela API
//
// No modo api, o que a API ainda não informa (experimento, estado do
// consumidor e das regras, setpoints aguardando) fica como "sem dados".

import { consultarSaude, listarAlertas, listarCelulas, listarLeituras } from "../api/cliente";
import type { AlertaApi, CelulaApi, LeituraApi, TipoAlerta } from "../api/tipos";
import { gerarExemplo } from "./exemplo";
import {
  HORAS_DE_HISTORICO,
  type AlertaResumo,
  type CelulaResumo,
  type SituacaoCelula,
  type VisaoGeral,
} from "./modelo";

export const FONTE_DADOS: "exemplo" | "api" =
  import.meta.env.VITE_FONTE_DADOS === "api" ? "api" : "exemplo";

const HORA = 60 * 60 * 1000;

const TITULO_DO_ALERTA: Record<TipoAlerta, string> = {
  sem_comunicacao: "Sem comunicação",
  setpoint_sem_confirmacao: "Setpoint sem confirmação",
  desvio_temperatura: "Desvio de temperatura",
};

export async function carregarVisaoGeral(sinal?: AbortSignal): Promise<VisaoGeral> {
  if (FONTE_DADOS === "exemplo") return gerarExemplo();
  return carregarDaApi(sinal);
}

async function carregarDaApi(sinal?: AbortSignal): Promise<VisaoGeral> {
  const agora = new Date();
  const inicio = new Date(agora.getTime() - HORAS_DE_HISTORICO * HORA);

  const [celulas, alertas, saude] = await Promise.all([
    listarCelulas(sinal),
    listarAlertas(sinal),
    consultarSaude(sinal).catch(() => null),
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
    celulas: celulas.map((c, i) => celulaDaApi(c, leituras[i], alertas, inicio)),
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
): CelulaResumo {
  const daCelula = alertas.filter((a) => a.id_celula === celula.id_celula);
  const situacao: SituacaoCelula =
    celula.estado === "offline" ? "offline" : daCelula.length > 0 ? "alerta" : "online";
  return {
    id: celula.id_celula,
    situacao,
    experimento: undefined,
    temperaturaC: celula.temperatura_c,
    ph: celula.ph,
    od: celula.od,
    temperaturaEmAlerta: daCelula.some((a) => a.tipo === "desvio_temperatura"),
    historicoOd: mediaPorHora(leituras, inicio),
    ultimaLeituraEm: celula.ultima_leitura_em ? new Date(celula.ultima_leitura_em) : null,
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

function alertaDaApi(alerta: AlertaApi): AlertaResumo {
  return {
    id: alerta.id_alerta,
    idCelula: alerta.id_celula,
    titulo: TITULO_DO_ALERTA[alerta.tipo] ?? alerta.tipo,
    mensagem: alerta.mensagem,
    abertoEm: new Date(alerta.aberto_em),
  };
}
