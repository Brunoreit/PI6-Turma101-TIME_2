// Única porta de saída da interface: tudo passa pela API, nunca pelo banco
// ou pelo broker. O prefixo /api é repassado para a API pelo Vite (em
// desenvolvimento) e pelo nginx (no Docker).

import type {
  AlertaApi, CelulaApi, DetalheDoExperimentoApi, ExperimentoApi, ExperimentoListadoApi, FichaApi, IntegridadeApi,
  LeituraApi, PedidoSetpointApi, PessoaApi, SaudeApi, SessaoApi,
} from "./tipos";

const BASE = "/api";
const API_FORA_DO_AR =
  "A API não respondeu. Verifique se ela está rodando na porta 8000 (uvicorn app.api.main:app).";

export class ErroDaApi extends Error {
  constructor(
    public readonly status: number,
    mensagem: string,
    /** Só a explicação da API, sem o caminho: é o que aparece na tela. */
    public readonly detalhe: string = mensagem,
  ) {
    super(mensagem);
    this.name = "ErroDaApi";
  }
}

// Token da pessoa logada. Quem guarda e restaura é o SessaoProvider; aqui ele
// só vai no cabeçalho Authorization de todas as chamadas.
let token: string | null = null;
let aoPerderSessao: () => void = () => {};

export function usarToken(novo: string | null): void {
  token = novo;
}

/** Chamado quando a API recusa o token (401): a sessão expirou ou é inválida. */
export function quandoPerderSessao(funcao: () => void): void {
  aoPerderSessao = funcao;
}

/** A API devolve {"detail": "..."}. Erros de validação do FastAPI (422) vêm
 *  como lista, com o texto em "msg" precedido de "Value error, ". */
function lerDetalhe(corpo: unknown): string | null {
  const detalhe = (corpo as { detail?: unknown } | null)?.detail;
  if (typeof detalhe === "string") return detalhe;
  if (Array.isArray(detalhe)) {
    const mensagens = detalhe
      .map((d) => (typeof d?.msg === "string" ? d.msg.replace(/^Value error, /, "") : null))
      .filter((m): m is string => Boolean(m));
    if (mensagens.length) return mensagens.join(" ");
  }
  return null;
}

async function buscar<T>(caminho: string, sinal?: AbortSignal, opcoes: RequestInit = {}): Promise<T> {
  const comToken = token;
  const cabecalhos = new Headers(opcoes.headers);
  if (comToken) cabecalhos.set("Authorization", `Bearer ${comToken}`);
  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${caminho}`, { ...opcoes, headers: cabecalhos, signal: sinal });
  } catch (erro) {
    if (erro instanceof DOMException && erro.name === "AbortError") throw erro;
    throw new ErroDaApi(0, API_FORA_DO_AR);
  }
  if (!resposta.ok) {
    // Sem {"detail"} no corpo, quem respondeu foi o proxy (Vite ou nginx):
    // a API está fora do ar.
    const detalhe = lerDetalhe(await resposta.json().catch(() => null));
    if (detalhe === null) throw new ErroDaApi(resposta.status, API_FORA_DO_AR);
    // Só derruba a sessão se o token que foi enviado ainda é o atual.
    if (resposta.status === 401 && comToken && comToken === token) aoPerderSessao();
    throw new ErroDaApi(resposta.status, `${caminho}: ${detalhe}`, detalhe);
  }
  return resposta.json() as Promise<T>;
}

function enviar<T>(caminho: string, corpo: unknown, metodo: "POST" | "PATCH" = "POST"): Promise<T> {
  return buscar(caminho, undefined, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

export function cadastrarConta(nome: string, email: string, senha: string): Promise<SessaoApi> {
  return enviar("/auth/cadastro", { nome, email, senha });
}

export function entrarNaConta(email: string, senha: string): Promise<SessaoApi> {
  return enviar("/auth/entrar", { email, senha });
}

/** Pessoa dona do token atual. Com token vencido, dá 401. */
export function consultarPessoaLogada(sinal?: AbortSignal): Promise<PessoaApi> {
  return buscar("/auth/eu", sinal);
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

/** Cadastra uma nova versão da curva de OD. Com `recalcular`, a API refaz a
 *  OD das leituras gravadas: todas, ou só as de `desde` em diante. */
export function cadastrarCalibracao(
  idCelula: string, a: number, b: number, recalcular: boolean, desde: Date | null,
): Promise<unknown> {
  return buscar(`/celulas/${encodeURIComponent(idCelula)}/calibracoes`, undefined, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a, b, recalcular, recalcular_desde: desde?.toISOString() ?? null }),
  });
}

export function consultarIntegridade(sinal?: AbortSignal): Promise<IntegridadeApi[]> {
  return buscar("/integridade", sinal);
}

// ---------------------------------------------------------------- experimentos
// Todas exigem login. Experimento fora do alcance da pessoa dá 404; acesso
// insuficiente dá 403.

export function listarExperimentos(sinal?: AbortSignal): Promise<ExperimentoListadoApi[]> {
  return buscar("/experimentos?filtro=todos", sinal);
}

export function buscarExperimento(id: number, sinal?: AbortSignal): Promise<DetalheDoExperimentoApi> {
  return buscar(`/experimentos/${id}`, sinal);
}

export function criarExperimento(ficha: FichaApi): Promise<ExperimentoApi> {
  return enviar("/experimentos", ficha);
}

/** Cópia em Stand by, com quem duplicou como responsável. */
export function duplicarExperimento(id: number): Promise<ExperimentoApi> {
  return enviar(`/experimentos/${id}/duplicar`, {});
}

/** Em Stand by, qualquer campo; em andamento, só descricao e metadados. */
export function alterarExperimento(id: number, campos: Partial<FichaApi>): Promise<ExperimentoApi> {
  return enviar(`/experimentos/${id}`, campos, "PATCH");
}

export function encerrarExperimento(id: number): Promise<ExperimentoApi> {
  return enviar(`/experimentos/${id}/encerrar`, {});
}

export function cancelarExperimento(id: number, motivo: string): Promise<ExperimentoApi> {
  return enviar(`/experimentos/${id}/cancelar`, { motivo });
}
