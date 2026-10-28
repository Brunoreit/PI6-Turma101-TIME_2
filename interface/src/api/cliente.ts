// Única porta de saída da interface: tudo passa pela API, nunca pelo banco
// ou pelo broker. O prefixo /api é repassado para a API pelo Vite (em
// desenvolvimento) e pelo nginx (no Docker).

import type { AlertaApi, CelulaApi, IntegridadeApi, LeituraApi, PedidoSetpointApi, SaudeApi } from "./tipos";

const BASE = "/api";
const API_FORA_DO_AR =
  "A API não respondeu. Verifique se ela está rodando na porta 8000 (uvicorn app.api.main:app).";

export class ErroDaApi extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroDaApi";
  }
}

async function buscar<T>(caminho: string, sinal?: AbortSignal, opcoes: RequestInit = {}): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${caminho}`, { ...opcoes, signal: sinal });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === "AbortError") throw erro;
    throw new ErroDaApi(0, API_FORA_DO_AR);
  }
  if (!resposta.ok) {
    // A API devolve {"detail": "..."} com a explicação do erro. Sem esse
    // corpo, quem respondeu foi o proxy (Vite ou nginx): a API está fora do ar.
    const corpo = await resposta.json().catch(() => null);
    if (typeof corpo?.detail !== "string") throw new ErroDaApi(resposta.status, API_FORA_DO_AR);
    throw new ErroDaApi(resposta.status, `${caminho}: ${corpo.detail}`);
  }
  return resposta.json() as Promise<T>;
}

export function listarCelulas(sinal?: AbortSignal): Promise<CelulaApi[]> {
  return buscar("/celulas", sinal);
}

export function listarAlertas(sinal?: AbortSignal, abertos = true): Promise<AlertaApi[]> {
  return buscar(`/alertas?abertos=${abertos}`, sinal);
}

export function listarLeituras(
  idCelula: string,
  opcoes: { desde?: Date; limite?: number } = {},
  sinal?: AbortSignal,
): Promise<LeituraApi[]> {
  const parametros = new URLSearchParams();
  if (opcoes.desde) parametros.set("desde", opcoes.desde.toISOString());
  if (opcoes.limite) parametros.set("limite", String(opcoes.limite));
  const consulta = parametros.size ? `?${parametros}` : "";
  return buscar(`/celulas/${encodeURIComponent(idCelula)}/leituras${consulta}`, sinal);
}

export function consultarSaude(sinal?: AbortSignal): Promise<SaudeApi> {
  return buscar("/saude", sinal);
}

/** Pedidos de setpoint da célula, do mais novo para o mais antigo. */
export function listarSetpoints(idCelula: string, sinal?: AbortSignal): Promise<PedidoSetpointApi[]> {
  return buscar(`/celulas/${encodeURIComponent(idCelula)}/setpoints`, sinal);
}

export function pedirSetpoint(idCelula: string, temperaturaC: number): Promise<PedidoSetpointApi> {
  return buscar(`/celulas/${encodeURIComponent(idCelula)}/setpoint`, undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ temperatura_c: temperaturaC }),
  });
}

export function consultarIntegridade(sinal?: AbortSignal): Promise<IntegridadeApi[]> {
  return buscar("/integridade", sinal);
}
