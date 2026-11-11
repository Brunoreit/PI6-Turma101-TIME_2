// Dados das telas de uma célula. Segue VITE_FONTE_DADOS, como a visão geral
// (ver fonte.ts). No modo api, o experimento vem do cultivo aberto na célula
// (cultivo_atual de GET /celulas), a calibração de GET /celulas/{id}/calibracoes
// e o que a API ainda não informa (MAC, bombas, manutenção, mensagens
// recebidas) fica `null`.

import {
  alterarCelula,
  buscarExperimento,
  buscarSetpoint,
  cadastrarCalibracao,
  cancelarCultivo,
  alterarCultivo,
  encerrarCultivo,
  ErroDaApi,
  iniciarCultivo,
  consultarIntegridade,
  consultarSaude,
  listarAlertas,
  listarCalibracoes,
  listarCelulas,
  listarLeituras,
  listarSetpoints,
  pedirSetpoint,
} from "@/api/cliente";
import type { CelulaApi, LeituraApi, PedidoSetpointApi, PontoCalibracaoApi } from "@/api/tipos";
import { calibracaoDaApi } from "./calibracao";
import { TIPO } from "@/funcionalidades/experimentos/api";
import { gerarExemploDaCelula } from "./exemplo";
import { alertaDaApi, FONTE_DADOS } from "@/dados/fonte";
import * as formatar from "@/compartilhado/formatar";
import type { SituacaoCelula } from "@/dados/modelo";
import type { DetalheDaCelula, EtapaDoCaminho, ExperimentoDaCelula, PedidoDeSetpoint, Periodo, Series } from "./modelo";

const MINUTO = 60 * 1000;
const HORA = 60 * MINUTO;
const DIA = 24 * HORA;

/** Quantos intervalos cada período tem e quanto dura cada um. No modo api,
 *  "experimento" vai do início do cultivo até agora; sem cultivo, 7 dias. */
const INTERVALOS: Record<Periodo, { quantidade: number; duracaoMs: number }> = {
  "6h": { quantidade: 24, duracaoMs: 15 * MINUTO },
  "24h": { quantidade: 24, duracaoMs: HORA },
  "7d": { quantidade: 28, duracaoMs: 6 * HORA },
  experimento: { quantidade: 28, duracaoMs: 6 * HORA },
};

/** Sem leitura há mais que isso (3 períodos de 20 s), a etapa não está ok. */
const LEITURA_RECENTE_MS = 60 * 1000;

/** `idPessoa` é a pessoa logada, para saber o acesso dela ao experimento. */
export async function carregarCelula(
  id: string, periodo: Periodo, idPessoa: number | null, sinal?: AbortSignal,
): Promise<DetalheDaCelula> {
  if (FONTE_DADOS === "exemplo") return gerarExemploDaCelula(id, periodo);
  return carregarDaApi(id, periodo, idPessoa, sinal);
}

const SO_NA_API = (acao: string) =>
  new Error(`Modo exemplo: ${acao}. Rode com VITE_FONTE_DADOS=api para mexer nos cultivos de verdade.`);

/**
 * "Atribuir e iniciar": abre o cultivo da célula no experimento. Se o
 * experimento tem temperatura alvo, a API já manda o setpoint. Se a pessoa
 * escolheu outra temperatura para esta célula, ela vai num pedido depois.
 * Devolve um aviso quando o cultivo começou mas a temperatura não foi enviada.
 */
export async function atribuirCelula(
  idCelula: string,
  experimento: { id?: number; alvoC: number | null },
  temperaturaC: number | null,
  cultivo: { condicao: string; replica: number | null; continuaDe: number | null },
): Promise<{ erro: boolean; texto: string }> {
  if (FONTE_DADOS === "exemplo" || experimento.id === undefined) throw SO_NA_API("a célula não foi atribuída");
  let iniciado;
  try {
    iniciado = await iniciarCultivo(experimento.id, idCelula, {
      // Sem condição escrita, vale a temperatura escolhida, como "32,0 °C".
      condicao: cultivo.condicao.trim() || (temperaturaC === null ? null : formatar.temperatura(temperaturaC)),
      replica: cultivo.replica,
      continuaDe: cultivo.continuaDe,
    });
  } catch (erro) {
    if (erro instanceof ErroDaApi && erro.status === 503) {
      throw new Error("A célula não foi atribuída porque o broker está fora do ar. Tente de novo em instantes.");
    }
    throw erro; // 409 (célula em outro cultivo, experimento fechado) traz a explicação da API.
  }
  const inicio = `A ${idCelula} entrou no experimento às ${formatar.hora(new Date(iniciado.iniciado_em))} (cultivo nº ${iniciado.id_cultivo}).`;
  const pedidoDaApi = iniciado.pedido_setpoint;
  const enviado = (p: PedidoSetpointApi) => ` Pedido de ${formatar.temperatura(p.temperatura_c)} ${p.estado} (${p.id_pedido}).`;
  const outra = temperaturaC !== null && (experimento.alvoC === null || Math.abs(temperaturaC - experimento.alvoC) >= 0.05);
  if (!outra) {
    if (iniciado.setpoint_confirmado === false) {
      return { erro: true, texto: `${inicio} Mas a temperatura alvo não foi enviada: o broker não confirmou o envio. Mande de novo em Comandos.` };
    }
    return { erro: false, texto: inicio + (pedidoDaApi ? enviado(pedidoDaApi) : " O experimento não tem temperatura alvo.") };
  }
  try {
    return { erro: false, texto: inicio + enviado(await pedirSetpoint(idCelula, temperaturaC)) };
  } catch (erro) {
    const motivo = erro instanceof ErroDaApi ? erro.detalhe : String(erro);
    return {
      erro: true,
      texto: `${inicio} Mas a temperatura de ${formatar.temperatura(temperaturaC)} não foi enviada: ${motivo} Mande de novo em Comandos.`,
    };
  }
}

/** "Encerrar participação": a célula sai do experimento a partir de agora.
 *  O motivo é opcional. */
export async function encerrarParticipacao(idCultivo: number | undefined, motivo: string | null = null): Promise<void> {
  if (FONTE_DADOS === "exemplo" || idCultivo === undefined) throw SO_NA_API("a participação não foi encerrada");
  await encerrarCultivo(idCultivo, motivo);
}

/** Condição e réplica do cultivo. Em branco tira o valor. */
export async function salvarCultivo(idCultivo: number | undefined, condicao: string, replica: number | null): Promise<void> {
  if (FONTE_DADOS === "exemplo" || idCultivo === undefined) throw SO_NA_API("o cultivo não foi alterado");
  await alterarCultivo(idCultivo, { condicao: condicao.trim() || null, replica });
}

/** "Resetar célula": cancela o cultivo. Nada é apagado, nem na placa. */
export async function cancelarParticipacao(idCultivo: number | undefined, motivo: string): Promise<void> {
  if (FONTE_DADOS === "exemplo" || idCultivo === undefined) throw SO_NA_API("a participação não foi cancelada");
  await cancelarCultivo(idCultivo, motivo);
}

/** Apelido, descrição e modelo da célula. Em branco tira o valor. */
export async function salvarIdentificacao(
  id: string, campos: { apelido: string; descricao: string; modelo: string },
): Promise<void> {
  if (FONTE_DADOS === "exemplo") throw SO_NA_API("a identificação não foi salva");
  const ouNulo = (texto: string) => texto.trim() || null;
  try {
    await alterarCelula(id, { apelido: ouNulo(campos.apelido), descricao: ouNulo(campos.descricao), modelo: ouNulo(campos.modelo) });
  } catch (erro) {
    if (erro instanceof ErroDaApi && erro.status === 409) throw new Error("Esse apelido já é usado por outra célula. Escolha outro.");
    throw erro;
  }
}

/** Faixa de pH de referência deste cultivo, usada só pelos alertas. */
export async function salvarFaixaDePh(idCultivo: number | undefined, minimo: number, maximo: number): Promise<void> {
  if (FONTE_DADOS === "exemplo" || idCultivo === undefined) throw SO_NA_API("a faixa de pH não foi salva");
  await alterarCultivo(idCultivo, { ph_ref_min: minimo, ph_ref_max: maximo });
}

/** O experimento do cultivo aberto. Sem acesso a ele (404), a tela mostra só
 *  que a célula está em uso. */
async function experimentoDoCultivo(
  cultivo: NonNullable<CelulaApi["cultivo_atual"]>, idPessoa: number | null, agora: Date, sinal?: AbortSignal,
): Promise<ExperimentoDaCelula> {
  const codigo = `EXP-${String(cultivo.id_experimento).padStart(2, "0")}`;
  const base = {
    idExperimento: cultivo.id_experimento,
    idCultivo: cultivo.id_cultivo,
    condicao: cultivo.condicao,
    codigo,
    naCelulaDesde: new Date(cultivo.iniciado_em),
  };
  try {
    const e = await buscarExperimento(cultivo.id_experimento, sinal);
    const doCultivo = e.cultivos.find((c) => c.id_cultivo === cultivo.id_cultivo);
    const convite = e.acessos.find((a) => a.id_pessoa === idPessoa);
    const duracaoDias = e.duracao_prevista_dias ?? 0;
    const inicio = e.iniciado_em ? new Date(e.iniciado_em) : base.naCelulaDesde;
    const dia = Math.floor((agora.getTime() - inicio.getTime()) / DIA) + 1;
    return {
      ...base,
      replica: doCultivo?.replica ?? null,
      acesso: e.id_responsavel === idPessoa ? "responsavel" : convite?.permissao === "edicao" ? "modificar" : "leitura",
      codigo: e.codigo,
      nome: e.nome,
      modo: TIPO[e.modo],
      responsavel: e.responsavel_nome,
      dia: duracaoDias > 0 ? Math.min(Math.max(dia, 1), duracaoDias) : Math.max(dia, 1),
      duracaoDias,
      alvoC: e.temperatura_alvo_c,
      phMin: doCultivo?.ph_ref_min ?? e.ph_ref_min,
      phMax: doCultivo?.ph_ref_max ?? e.ph_ref_max,
    };
  } catch (erro) {
    if (!(erro instanceof ErroDaApi && erro.status === 404)) throw erro;
    return {
      ...base,
      acesso: null,
      nome: "experimento de outra pessoa",
      modo: "—",
      responsavel: "—",
      dia: 0,
      duracaoDias: 0,
      alvoC: null,
      phMin: null,
      phMax: null,
    };
  }
}

function pedidoDaApi(p: PedidoSetpointApi): PedidoDeSetpoint {
  return {
    id: p.id_pedido,
    temperaturaC: p.temperatura_c,
    estado: p.estado,
    motivo: p.motivo,
    solicitadoPor: p.solicitado_por,
    solicitadoEm: new Date(p.solicitado_em),
    recebidoEm: p.recebido_em ? new Date(p.recebido_em) : null,
    aplicadoEm: p.aplicado_em ? new Date(p.aplicado_em) : null,
    atingidoEm: p.atingido_em ? new Date(p.atingido_em) : null,
  };
}

/** Pede a nova temperatura alvo e devolve o pedido, para acompanhar as
 *  etapas. No modo exemplo não há para onde enviar. */
export async function enviarSetpoint(id: string, temperaturaC: number): Promise<PedidoDeSetpoint> {
  if (FONTE_DADOS === "exemplo") {
    throw new Error("Modo exemplo: o pedido não foi enviado. Rode com VITE_FONTE_DADOS=api para comandar a célula.");
  }
  return pedidoDaApi(await pedirSetpoint(id, temperaturaC));
}

/** O pedido agora (GET /setpoints/{id}), entre as atualizações de 20 s. */
export async function consultarPedido(idPedido: string, sinal?: AbortSignal): Promise<PedidoDeSetpoint> {
  return pedidoDaApi(await buscarSetpoint(idPedido, sinal));
}

/** Salva a nova versão da curva de OD pelos pontos: o branco e os padrões.
 *  A API confere as leituras dos pontos gravados ao vivo, ajusta a reta e
 *  devolve a, b e R²; o que a tela mostrou antes era só uma prévia.
 *  No modo exemplo não há para onde enviar. */
export async function salvarCalibracao(
  id: string,
  pontos: PontoCalibracaoApi[],
  recalcular: boolean,
  desde: Date | null,
  organismo: string,
): Promise<{
  versao: number;
  idCalibracao: number;
  reprocessadas: number;
  criadaEm: Date;
  sensor: string | null;
  /** Reta com o branco à parte: od = a · (bruto − branco) + b. */
  a: number;
  b: number;
  branco: number;
  r2: number | null;
  padroes: number;
  organismo: string | null;
  porVoce: boolean;
}> {
  if (FONTE_DADOS === "exemplo") {
    throw new Error("Modo exemplo: a calibração não foi salva. Rode com VITE_FONTE_DADOS=api para gravar a nova versão.");
  }
  const salva = await cadastrarCalibracao(id, pontos, recalcular, desde, organismo.trim() || null);
  const branco = salva.ajuste?.branco ?? 0;
  return {
    versao: salva.versao,
    idCalibracao: salva.id_calibracao,
    reprocessadas: salva.leituras_reprocessadas,
    criadaEm: new Date(salva.criada_em),
    sensor: salva.sensor,
    a: salva.ajuste?.a ?? salva.a,
    b: salva.ajuste?.b ?? salva.b + salva.a * branco,
    branco,
    r2: salva.r2,
    padroes: salva.ajuste?.padroes ?? Math.max(0, (salva.pontos?.length ?? 1) - 1),
    organismo: salva.organismo,
    porVoce: salva.id_pessoa !== null,
  };
}

async function carregarDaApi(id: string, periodo: Periodo, idPessoa: number | null, sinal?: AbortSignal): Promise<DetalheDaCelula> {
  const agora = new Date();
  // As células vêm primeiro: o período "experimento" depende do cultivo.
  const celulas = await listarCelulas(sinal);
  const celula = celulas.find((c) => c.id_celula === id);
  if (!celula) throw new Error(`A célula ${id} não está cadastrada. Confira o id na Visão geral.`);
  const cultivo = celula.cultivo_atual;
  let { quantidade, duracaoMs } = INTERVALOS[periodo];
  if (periodo === "experimento" && cultivo) {
    duracaoMs = Math.max(MINUTO, (agora.getTime() - new Date(cultivo.iniciado_em).getTime()) / quantidade);
  }
  const inicio = new Date(agora.getTime() - quantidade * duracaoMs);

  const [experimento, alertas, saude, pedidos, integridades, leituras, calibracoes] = await Promise.all([
    cultivo ? experimentoDoCultivo(cultivo, idPessoa, agora, sinal) : null,
    listarAlertas(sinal),
    consultarSaude(sinal).catch(() => null),
    listarSetpoints(id, sinal),
    consultarIntegridade(sinal).catch(() => null),
    // A API devolve no máximo 10.000 leituras, as mais recentes: em 7 dias
    // com uma a cada 20 s, o começo do período fica sem pontos.
    listarLeituras(id, { desde: inicio, limite: 10000 }, sinal),
    listarCalibracoes(id, sinal),
  ]);

  const daCelula = alertas.filter((a) => a.id_celula === id);
  const situacao: SituacaoCelula =
    celula.estado === "offline" ? "offline" : daCelula.length > 0 ? "alerta" : "online";
  const ultimaLeituraEm = celula.ultima_leitura_em ? new Date(celula.ultima_leitura_em) : null;
  const odBruto = leituras.length ? leituras[leituras.length - 1].od_bruto : null;
  const ultimaGravada = leituras.length ? leituras[leituras.length - 1] : null;
  const linha = integridades?.find((i) => i.id_celula === id);
  const integridade = linha
    ? {
        primeiroSeq: linha.primeiro_seq,
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
    // Pelo sinal de vida: vivo e ligado ao broker. Sem ele (consumidor que
    // nunca gravou), só a leitura recente prova que está ok.
    {
      chave: "consumidor",
      ok: saude?.consumidor ? saude.consumidor.ativo && saude.consumidor.broker_conectado : recente ? true : null,
      valor: saude?.consumidor && !saude.consumidor.ativo
        ? `parado, último sinal ${formatar.tempoDecorrido(new Date(saude.consumidor.ultimo_sinal), agora)}`
        : saude?.consumidor && !saude.consumidor.broker_conectado
          ? `sem conexão com o broker desde ${formatar.hora(new Date(saude.consumidor.broker_desde))}`
          : ultimaLeituraEm ? `última gravação ${formatar.tempoDecorrido(ultimaLeituraEm, agora)}` : "nada gravado",
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
    apelido: celula.apelido,
    descricao: celula.descricao,
    ultimaLeitura: ultimaGravada
      ? {
          seq: ultimaGravada.seq,
          medidaEm: new Date(ultimaGravada.ts_origem),
          recebidaEm: new Date(ultimaGravada.ts_recebido),
          idCalibracao: ultimaGravada.id_calibracao,
        }
      : null,
    situacao,
    experimento,
    placa: {
      modelo: celula.modelo,
      mac: null,
      firmware: celula.firmware,
      sensores: celula.sensores,
      onlineDesde: null,
      keepaliveS: null,
      primeiroAnuncio: new Date(celula.primeiro_anuncio),
      ultimoContato: celula.ultimo_contato ? new Date(celula.ultimo_contato) : null,
      ultimoSeq: celula.ultima_seq,
    },
    temperaturaC: celula.temperatura_c,
    od: celula.od,
    odBruto,
    ph: celula.ph,
    ultimaLeituraEm,
    pedido: ultimo ? pedidoDaApi(ultimo) : null,
    alertas: daCelula.map(alertaDaApi),
    series: mediasPorIntervalo(leituras, inicio, duracaoMs, quantidade),
    calibracao: calibracaoDaApi(calibracoes),
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
