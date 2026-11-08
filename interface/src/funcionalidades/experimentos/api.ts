// Tradução entre os experimentos da API e o modelo das telas.
//
// A API guarda a ficha em colunas (modo, duração, temperatura alvo, faixa de
// pH) e o resto em `metadados`. O formulário do Figma tem campos que não têm
// coluna própria: as fases de temperatura, a OD mínima e máxima do
// turbidostato e a agitação. Eles vão em `metadados`, junto com organismo,
// meio, volume, lote e inóculo, e o backend ainda não os usa. A temperatura
// alvo enviada às células é a da primeira fase.

import type {
  AcessoApi, CultivoApi, DetalheDoExperimentoApi, ExperimentoApi, ExperimentoListadoApi, FichaApi, ModoApi,
  StatusExperimentoApi,
} from "@/api/tipos";
import type { CelulaResumo } from "@/dados/modelo";
import type { Usuario } from "@/sessao/SessaoProvider";
import type {
  Acesso, CelulaNoExperimento, Convidado, Experimento, Fase, Ficha, Metadados, StatusExperimento, TipoDeCrescimento,
} from "./modelo";

const STATUS: Record<StatusExperimentoApi, StatusExperimento> = {
  cadastrado: "standby",
  em_andamento: "andamento",
  encerrado: "encerrado",
  cancelado: "cancelado",
};

const TIPO: Record<ModoApi, TipoDeCrescimento> = {
  curva_crescimento: "Curva de crescimento",
  turbidostato: "Turbidostato",
  quimiostato: "Quimiostato",
};

const MODO = Object.fromEntries(Object.entries(TIPO).map(([modo, tipo]) => [tipo, modo])) as Record<TipoDeCrescimento, ModoApi>;

/** Campos de `metadados` que o formulário preenche. Os outros (como
 *  motivo_cancelamento) são preservados ao editar. */
const CHAVES_DO_FORMULARIO = [
  "organismo", "meio", "volume_ml", "lote_meio", "inoculo_od", "fases", "od_min", "od_max", "agitacao_rpm",
];

const texto = (valor: unknown) => (typeof valor === "string" ? valor : "");
const numeroOuNulo = (valor: unknown) => (typeof valor === "number" && Number.isFinite(valor) ? valor : null);
const data = (valor: string | null) => (valor ? new Date(valor) : null);

function fasesDe(api: ExperimentoApi): Fase[] {
  const salvas = api.metadados.fases;
  if (Array.isArray(salvas)) {
    const fases = salvas
      .map((f) => ({ duracaoDias: numeroOuNulo(f?.duracao_dias), temperaturaC: numeroOuNulo(f?.temperatura_c) }))
      .filter((f): f is Fase => f.duracaoDias !== null && f.temperaturaC !== null);
    if (fases.length) return fases;
  }
  // Criado fora da interface: uma fase só, com a temperatura alvo da ficha.
  return api.temperatura_alvo_c === null ? [] : [{ duracaoDias: api.duracao_prevista_dias ?? 0, temperaturaC: api.temperatura_alvo_c }];
}

function metadadosDe(api: ExperimentoApi): Metadados {
  const m = api.metadados;
  return {
    organismo: texto(m.organismo),
    meio: texto(m.meio),
    volumeMl: numeroOuNulo(m.volume_ml),
    lote: texto(m.lote_meio),
    inoculoOd: numeroOuNulo(m.inoculo_od),
  };
}

function convidadoDe(acesso: AcessoApi): Convidado {
  return { nome: acesso.nome, email: acesso.email, acesso: acesso.permissao === "edicao" ? "modificar" : "leitura" };
}

function acessoDaApi(acesso: ExperimentoListadoApi["acesso"]): Acesso {
  return acesso === "responsavel" ? "responsavel" : acesso === "edicao" ? "modificar" : "leitura";
}

/** As leituras atuais vêm dos dados gerais (atualizados a cada 20 s). */
function celulaDe(cultivo: CultivoApi, celulas: CelulaResumo[]): CelulaNoExperimento {
  const atual = celulas.find((c) => c.id === cultivo.id_celula);
  const aberta = cultivo.encerrado_em === null;
  return {
    id: cultivo.id_celula,
    condicao: cultivo.condicao ?? "—",
    situacao: aberta ? (atual?.situacao ?? null) : "offline",
    temperaturaC: aberta ? (atual?.temperaturaC ?? null) : null,
    od: aberta ? (atual?.od ?? null) : null,
    ph: aberta ? (atual?.ph ?? null) : null,
    inicio: new Date(cultivo.iniciado_em),
    fim: data(cultivo.encerrado_em),
    ultimaLeituraEm: aberta ? (atual?.ultimaLeituraEm ?? null) : null,
  };
}

function base(api: ExperimentoApi, responsavelNome: string): Experimento {
  const motivo = api.metadados.motivo_cancelamento;
  return {
    id: api.id_experimento,
    codigo: api.codigo,
    nome: api.nome,
    descricao: api.descricao ?? "",
    tipo: TIPO[api.modo],
    status: STATUS[api.status],
    responsavel: { nome: responsavelNome, email: "" },
    convidados: [],
    inicio: data(api.iniciado_em),
    fim: data(api.encerrado_em),
    duracaoDias: api.duracao_prevista_dias ?? 0,
    celulas: [],
    condicoes: [],
    fases: fasesDe(api),
    phMin: api.ph_ref_min ?? NaN,
    phMax: api.ph_ref_max ?? NaN,
    odMin: numeroOuNulo(api.metadados.od_min),
    odMax: numeroOuNulo(api.metadados.od_max),
    agitacaoRpm: numeroOuNulo(api.metadados.agitacao_rpm),
    metadados: metadadosDe(api),
    metadadosDaApi: api.metadados,
    motivoCancelamento: typeof motivo === "string" ? motivo : undefined,
    baseadoEm: api.id_origem === null ? undefined : `EXP-${String(api.id_origem).padStart(2, "0")}`,
  };
}

export function experimentoDaLista(api: ExperimentoListadoApi): Experimento {
  return { ...base(api, api.responsavel_nome), acesso: acessoDaApi(api.acesso), celulasAbertas: api.cultivos_abertos };
}

export function experimentoDoDetalhe(api: DetalheDoExperimentoApi, usuario: Usuario | null, celulas: CelulaResumo[]): Experimento {
  const meu = usuario !== null && api.id_responsavel === usuario.id;
  const convite = api.acessos.find((a) => a.id_pessoa === usuario?.id);
  return {
    ...base(api, api.responsavel_nome),
    acesso: meu ? "responsavel" : convite?.permissao === "edicao" ? "modificar" : "leitura",
    convidados: api.acessos.map(convidadoDe),
    celulas: api.cultivos.filter((c) => c.status !== "cancelado").map((c) => celulaDe(c, celulas)),
  };
}

/** Corpo do POST ou do PATCH. `anteriores` são os metadados já gravados,
 *  para não perder chaves que o formulário não conhece. */
export function fichaParaApi(ficha: Ficha, anteriores: Record<string, unknown> = {}): FichaApi {
  const preservados = Object.fromEntries(Object.entries(anteriores).filter(([chave]) => !CHAVES_DO_FORMULARIO.includes(chave)));
  const m = ficha.metadados;
  const metadados: Record<string, unknown> = {
    ...preservados,
    fases: ficha.fases.map((f) => ({ duracao_dias: f.duracaoDias, temperatura_c: f.temperaturaC })),
    agitacao_rpm: ficha.agitacaoRpm,
    ...(ficha.tipo === "Turbidostato" ? { od_min: ficha.odMin, od_max: ficha.odMax } : {}),
    organismo: m.organismo || undefined,
    meio: m.meio || undefined,
    volume_ml: m.volumeMl,
    lote_meio: m.lote || undefined,
    inoculo_od: m.inoculoOd,
  };
  // Sem valor, a chave não vai.
  for (const chave of Object.keys(metadados)) if (metadados[chave] == null) delete metadados[chave];
  return {
    nome: ficha.nome,
    descricao: ficha.descricao || null,
    modo: MODO[ficha.tipo],
    duracao_prevista_dias: ficha.duracaoDias,
    temperatura_alvo_c: ficha.fases[0]?.temperaturaC ?? null,
    ph_ref_min: Number.isFinite(ficha.phMin) ? ficha.phMin : null,
    ph_ref_max: Number.isFinite(ficha.phMax) ? ficha.phMax : null,
    metadados,
  };
}
