// Tela "Alertas · regras" do Figma (nó 83:1303). Abertos e Histórico listam
// os alertas que o backend abre, com o título e a ajuda de cada tipo. A aba
// Regras é a do Figma: no modo exemplo, as regras ficam na memória; no modo
// api, vêm de /regras (criar, ligar, desligar e excluir), e embaixo aparecem
// as verificações fixas do backend, que não dá para desligar.
// O Histórico filtra por célula e tipo, e o alerta que nenhuma regra fecha
// (colisao_seq) ganha o botão Fechar alerta.

import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { alterarRegra, criarRegra, excluirRegra, fecharAlerta, listarAlertas, listarRegras } from "@/api/cliente";
import chaveDesligada from "@/assets/icones/chave-desligada.svg";
import chaveLigada from "@/assets/icones/chave-ligada.svg";
import iconeEmail from "@/assets/icones/email-15.svg";
import iconeSino from "@/assets/icones/sino-15.svg";
import { SeloCritico } from "@/compartilhado/componentes/SeloCritico";
import { Botao } from "@/compartilhado/componentes/Botao";
import * as formatar from "@/compartilhado/formatar";
import { useDados } from "@/dados/DadosProvider";
import { useCelulas } from "@/dados/useCelulas";
import { FONTE_DADOS, infoDoAlerta, TITULO_DO_ALERTA } from "@/dados/fonte";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { useSessao } from "@/sessao/SessaoProvider";
import estilos from "./Alertas.module.css";
import { REGRAS_EXEMPLO, regraDaApi, regraParaApi, type Regra, type RegraNova } from "./modelo";
import { NovaRegra } from "./NovaRegra";

type Aba = "abertos" | "regras" | "historico";

interface AlertaFechado {
  id: number;
  /** null nos alertas do sistema. */
  idCelula: string | null;
  titulo: string;
  mensagem: string;
  abertoEm: Date;
  fechadoEm: Date;
  /** Quem fechou à mão; sem nome, foi a regra que fechou. */
  fechadoPor?: string | null;
  /** Alerta de uma regra de gravidade crítica. */
  critico?: boolean;
}

interface FiltroDoHistorico {
  /** "" para todas; "sistema" para os alertas sem célula. */
  idCelula: string;
  /** "" para todos. */
  tipo: string;
}

const HORA = 3_600_000;
const HISTORICO_EXEMPLO: AlertaFechado[] = [
  { id: 101, idCelula: "c08", titulo: "Desvio de temperatura", mensagem: "Desvio de temperatura: 31,3 °C com alvo de 30,0 °C", abertoEm: new Date(Date.now() - 30 * HORA), fechadoEm: new Date(Date.now() - 29.7 * HORA) },
  { id: 102, idCelula: "c08", titulo: "Sem comunicação", mensagem: "Sem comunicação: placa ficou offline", abertoEm: new Date(Date.now() - 26 * HORA), fechadoEm: new Date(Date.now() - 25.9 * HORA) },
  { id: 103, idCelula: "c11", titulo: "Setpoint sem confirmação", mensagem: "Setpoint sem confirmação: pedido de 37,0 °C", abertoEm: new Date(Date.now() - 50 * HORA), fechadoEm: new Date(Date.now() - 49 * HORA) },
];

/** Quantos alertas o GET /alertas devolve sem `limite`. */
const LIMITE_DA_API = 500;

/** Alertas fechados, do mais novo ao mais antigo. `versao` muda quando um
 *  alerta é fechado à mão, para a lista buscar de novo. */
function useHistorico(ativo: boolean, filtro: FiltroDoHistorico, versao: number) {
  const [historico, setHistorico] = useState<AlertaFechado[] | null>(FONTE_DADOS === "exemplo" ? HISTORICO_EXEMPLO : null);
  const [erro, setErro] = useState<string | null>(null);
  // A API devolve até LIMITE_DA_API alertas (abertos e fechados): chegou nele, há mais antigos.
  const [cortado, setCortado] = useState(false);
  useEffect(() => {
    if (!ativo || FONTE_DADOS === "exemplo") return;
    const controle = new AbortController();
    setErro(null);
    listarAlertas(controle.signal, false, { idCelula: filtro.idCelula || undefined, tipo: filtro.tipo || undefined })
      .then((alertas) => {
        setCortado(alertas.length >= LIMITE_DA_API);
        setHistorico(
          alertas
            .filter((a) => a.fechado_em)
            .map((a) => ({
              id: a.id_alerta,
              idCelula: a.id_celula,
              titulo: infoDoAlerta(a.tipo, a.regra_nome).titulo,
              mensagem: a.mensagem,
              abertoEm: new Date(a.aberto_em),
              fechadoEm: new Date(a.fechado_em!),
              fechadoPor: a.fechado_por_nome,
              critico: a.regra_gravidade === "critica",
            })),
        );
      })
      .catch((e: Error) => e.name !== "AbortError" && setErro(e.message));
    return () => controle.abort();
  }, [ativo, filtro.idCelula, filtro.tipo, versao]);
  return { historico, erro, cortado };
}

/** "Hoje", "Ontem" ou "Sexta-feira, 14 de novembro" (com o ano, se não for o atual). */
function rotuloDoDia(dia: Date, agora = new Date()): string {
  const ontem = new Date(agora);
  ontem.setDate(agora.getDate() - 1);
  if (dia.toDateString() === agora.toDateString()) return "Hoje";
  if (dia.toDateString() === ontem.toDateString()) return "Ontem";
  const texto = dia.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: dia.getFullYear() === agora.getFullYear() ? undefined : "numeric",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** O histórico (já do mais novo ao mais antigo) em grupos pelo dia em que o alerta abriu. */
function porDia(alertas: AlertaFechado[]): { chave: string; rotulo: string; alertas: AlertaFechado[] }[] {
  const grupos: { chave: string; rotulo: string; alertas: AlertaFechado[] }[] = [];
  for (const a of alertas) {
    const chave = a.abertoEm.toDateString();
    if (grupos.at(-1)?.chave !== chave) grupos.push({ chave, rotulo: rotuloDoDia(a.abertoEm), alertas: [] });
    grupos.at(-1)!.alertas.push(a);
  }
  return grupos;
}

/** Abertos em grupos: "Críticos" e "Demais alertas", ou um grupo só sem críticos. */
function gruposDosAbertos<T extends { critico?: boolean }>(alertas: T[]): { chave: string; rotulo: string; alertas: T[] }[] {
  const criticos = alertas.filter((a) => a.critico);
  if (criticos.length === 0) return alertas.length ? [{ chave: "todos", rotulo: "Abertos agora", alertas }] : [];
  const demais = alertas.filter((a) => !a.critico);
  return [
    { chave: "criticos", rotulo: "Críticos", alertas: criticos },
    ...(demais.length ? [{ chave: "demais", rotulo: "Demais alertas", alertas: demais }] : []),
  ];
}

const horaCurta = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** "menos de 1 min", "42 min", "3 h 12 min". */
function quantoDurou(a: AlertaFechado): string {
  return a.fechadoEm.getTime() - a.abertoEm.getTime() < 60_000 ? "menos de 1 min" : formatar.duracao(a.abertoEm, a.fechadoEm);
}

/** Alertas que nenhuma regra fecha: a pessoa fecha depois de conferir. */
const FECHA_A_MAO = new Set(["colisao_seq"]);

function Chave({ ligada, onClick, nome }: { ligada: boolean; onClick: () => void; nome: string }) {
  return (
    <button type="button" role="switch" aria-checked={ligada} aria-label={`Regra ${nome} ativa`} className={estilos.chave} onClick={onClick}>
      <img src={ligada ? chaveLigada : chaveDesligada} width={32} height={18} alt="" />
    </button>
  );
}

const NA_API = FONTE_DADOS === "api";
const SO_QUEM_PODE = "Só quem criou a regra, ou quem é responsável ou pode modificar o experimento dela, pode alterá-la.";

export function Alertas() {
  const { dados, recarregar } = useDados();
  const { ids: idsDasCelulas, nome: nomeDa } = useCelulas();
  const [parametros, setParametros] = useSearchParams();
  const aba = (parametros.get("aba") as Aba | null) ?? (FONTE_DADOS === "api" ? "abertos" : "regras");
  const { experimentos } = useExperimentos();
  const { usuario } = useSessao();
  // No modo exemplo, a tela abre como no Figma, com a regra 6 destacada. "Nova regra" abre a janela.
  const [regras, setRegras] = useState<Regra[]>(NA_API ? [] : REGRAS_EXEMPLO);
  const [destacada, setDestacada] = useState<number | null>(NA_API ? null : 6);
  const [criando, setCriando] = useState(false);
  const [erroDasRegras, setErroDasRegras] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<number | null>(null);
  /** Nome da regra recém-criada, para o aviso quando a pessoa está em outra aba. */
  const [criada, setCriada] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<FiltroDoHistorico>({ idCelula: "", tipo: "" });
  const [fechados, setFechados] = useState(0);
  const [fechando, setFechando] = useState<number | null>(null);
  const [erroAoFechar, setErroAoFechar] = useState<string | null>(null);
  const { historico, erro, cortado } = useHistorico(aba === "historico", filtro, fechados);
  const abertos = dados?.alertas ?? [];
  const criticos = abertos.filter((a) => a.critico).length;

  function fechar(id: number) {
    setFechando(id);
    setErroAoFechar(null);
    fecharAlerta(id)
      .then(() => {
        setFechados((n) => n + 1);
        recarregar();
      })
      .catch((e: Error) => setErroAoFechar(e.message))
      .finally(() => setFechando(null));
  }

  const ativas = regras.filter((r) => r.ativa).length;
  const comAlertaAberto = regras.filter((r) => r.alertasAbertos).length;

  const abas: { valor: Aba; rotulo: string }[] = [
    { valor: "abertos", rotulo: `Abertos ${abertos.length}` },
    { valor: "regras", rotulo: `Regras ${regras.length}` },
    { valor: "historico", rotulo: "Histórico" },
  ];

  const carregarRegras = useCallback(async () => {
    try {
      setRegras((await listarRegras()).map(regraDaApi));
      setErroDasRegras(null);
    } catch (falha) {
      setErroDasRegras(mensagemDoErro(falha));
    }
  }, []);
  useEffect(() => {
    if (NA_API) carregarRegras();
  }, [aba, carregarRegras]);

  /** No modo api, um erro da API aparece na janela Nova regra, que continua aberta. */
  async function salvar(regra: RegraNova) {
    if (NA_API) {
      const idExperimento = regra.ondeVale ? experimentos.find((e) => e.codigo === regra.ondeVale)?.id : undefined;
      const criada = await criarRegra(regraParaApi(regra, idExperimento));
      await carregarRegras();
      setDestacada(criada.id_regra);
      setCriando(false);
      setCriada(regra.nome);
      return;
    }
    const id = Math.max(0, ...regras.map((r) => r.id)) + 1;
    const nova: Regra = {
      id,
      nome: regra.nome,
      descricao: `Criada por ${usuario?.nome ?? "você"}.`,
      condicao: `${regra.parametro === "Densidade óptica" ? "OD" : regra.parametro} ${regra.comparacao.toLowerCase()} ${regra.limiteTexto}`,
      porMinutos: regra.porMinutos,
      ondeVale: regra.ondeVale,
      gravidade: regra.gravidade,
      email: regra.email,
      ativa: true,
      criadaPor: usuario?.nome,
    };
    setRegras((lista) => [...lista, nova]);
    setDestacada(id);
    setCriando(false);
    setCriada(regra.nome);
  }

  /** Liga ou desliga. No modo api, desligar fecha os alertas que a regra abriu. */
  function alternar(regra: Regra) {
    if (!NA_API) return setRegras((lista) => lista.map((x) => (x.id === regra.id ? { ...x, ativa: !x.ativa } : x)));
    if (!regra.podeAlterar) return setErroDasRegras(SO_QUEM_PODE);
    alterarRegra(regra.id, !regra.ativa)
      .then(() => {
        recarregar();
        return carregarRegras();
      })
      .catch((falha) => setErroDasRegras(mensagemDoErro(falha)));
  }

  function excluir(regra: Regra) {
    setExcluindo(null);
    excluirRegra(regra.id)
      .then(() => {
        recarregar();
        return carregarRegras();
      })
      .catch((falha) => setErroDasRegras(mensagemDoErro(falha)));
  }

  return (
    <div className={estilos.tela}>
      <header className={estilos.cabecalho}>
        <div className={estilos.tituloBloco}>
          <h1>Alertas</h1>
          <p>
            {NA_API
              ? "Alertas que o sistema abre e fecha sozinho. Você cria regras para todas as células ou para os experimentos que pode modificar."
              : "Regras que decidem quando o sistema avisa e por onde. Você cria regras para os experimentos que pode modificar."}
          </p>
        </div>
        <Botao
          tipo="primario"
          onClick={() => {
            setCriada(null);
            setCriando(true);
          }}
        >
          Nova regra
        </Botao>
      </header>

      <nav className={estilos.abas} aria-label="Abas de alertas">
        {abas.map((a) => (
          <button
            key={a.valor}
            type="button"
            className={aba === a.valor ? estilos.abaAtiva : estilos.aba}
            aria-current={aba === a.valor ? "page" : undefined}
            onClick={() => {
              setCriada(null);
              setParametros({ aba: a.valor });
            }}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {criando && <NovaRegra onSalvar={salvar} onCancelar={() => setCriando(false)} />}

      {criada && (
        <div className={estilos.avisoCriada} role="status">
          <span>
            Regra <strong>{criada}</strong> criada. Ela passa a valer na próxima verificação, em poucos segundos.
          </span>
          {aba !== "regras" && (
            <button
              type="button"
              className={estilos.acaoAviso}
              onClick={() => {
                setCriada(null);
                setParametros({ aba: "regras" });
              }}
            >
              Ver regras
            </button>
          )}
          <button type="button" className={estilos.fecharAviso} aria-label="Fechar aviso" onClick={() => setCriada(null)}>
            ×
          </button>
        </div>
      )}

      {aba === "regras" && (
        <div className={estilos.historico}>
          <div className={estilos.barraResumo}>
            <span className={estilos.resumo}>
              {regras.length === 0
                ? "Nenhuma regra criada"
                : `${regras.length} ${regras.length === 1 ? "regra" : "regras"} · ${ativas} ${ativas === 1 ? "ativa" : "ativas"}`}
              {comAlertaAberto > 0 && (
                <span className={estilos.resumoAlerta}>
                  {" "}
                  · {comAlertaAberto} com alerta aberto
                </span>
              )}
            </span>
            <span className={estilos.contagem}>A chave liga e desliga a regra; desligada, os alertas dela fecham.</span>
          </div>
          {erroDasRegras && (
            <p className={estilos.erro} role="alert">
              {erroDasRegras}
            </p>
          )}
          <div className={estilos.lista}>
            <section className={estilos.grupoDoDia}>
              <h3 className={estilos.dia}>
                Regras criadas
                <span>{regras.length === 1 ? "1 regra" : `${regras.length} regras`}</span>
              </h3>
              <div role="list" aria-label="Regras de alerta">
                {regras.map((r) => (
                  <div
                    key={r.id}
                    role="listitem"
                    className={r.id === destacada ? `${estilos.linhaRegra} ${estilos.regraDestacada}` : estilos.linhaRegra}
                  >
                    <div className={estilos.alertaTextos}>
                      <p className={estilos.tituloHistorico}>
                        {r.nome}
                        {r.gravidade === "critica" && <span className={estilos.seloCritica}>crítica</span>}
                        {!r.ativa && <span className={estilos.seloDesligada}>desligada</span>}
                      </p>
                      <p className={estilos.chipsRegra}>
                        <span className={estilos.chip}>{r.condicao}</span>
                        <span className={estilos.chip}>por {r.porMinutos} min</span>
                        <span className={r.ondeVale ? `${estilos.chip} ${estilos.chipCodigo}` : estilos.chip}>
                          {r.ondeVale ?? "Todas as células"}
                        </span>
                      </p>
                      <p className={estilos.descricao}>{r.descricao}</p>
                      {(r.dependeDoHardware || (NA_API && Boolean(r.alertasAbertos))) && (
                        <p className={estilos.chipsRegra}>
                          {r.dependeDoHardware && <span className={estilos.seloHardware}>depende do hardware</span>}
                          {NA_API && Boolean(r.alertasAbertos) && (
                            <span className={estilos.seloAbertos}>
                              {r.alertasAbertos === 1 ? "1 alerta aberto" : `${r.alertasAbertos} alertas abertos`}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className={estilos.fechamento}>
                      <span className={estilos.controlesRegra}>
                        <span className={estilos.canais}>
                          <img src={iconeSino} width={15} height={15} alt="Avisa na tela" title="Avisa na tela" />
                          {r.email && <img src={iconeEmail} width={15} height={15} alt="Avisa por e-mail" title="Avisa por e-mail" />}
                        </span>
                        <Chave ligada={r.ativa} nome={r.nome} onClick={() => alternar(r)} />
                      </span>
                    {NA_API && r.podeAlterar && (
                      excluindo === r.id ? (
                        <span className={estilos.confirmacao}>
                          Excluir a regra?
                          <button type="button" className={estilos.acaoPerigo} onClick={() => excluir(r)}>
                            Excluir
                          </button>
                          <button type="button" className={estilos.acaoRegra} onClick={() => setExcluindo(null)}>
                            Cancelar
                          </button>
                        </span>
                      ) : (
                        <button type="button" className={estilos.acaoRegra} aria-label={`Excluir a regra ${r.nome}`} onClick={() => setExcluindo(r.id)}>
                          Excluir
                        </button>
                      )
                    )}
                    </div>
                  </div>
                ))}
              </div>
              {NA_API && regras.length === 0 && (
                <p className={estilos.vazio}>
                  Nenhuma regra criada ainda. Use "Nova regra" para ser avisado quando uma medida passar de um limite.
                </p>
              )}
            </section>
            {NA_API && (
              <section className={estilos.grupoDoDia} aria-label="Verificações do sistema">
                <h3 className={estilos.dia}>
                  Verificações do sistema
                  <span>sempre ativas, valem para todas as células</span>
                </h3>
                {Object.entries(TITULO_DO_ALERTA).map(([tipo, { titulo, ajuda }]) => (
                  <div key={tipo} className={estilos.linhaRegra}>
                    <div className={estilos.alertaTextos}>
                      <p className={estilos.tituloHistorico}>{titulo}</p>
                      <p className={estilos.descricao}>{ajuda}</p>
                    </div>
                    <div className={estilos.fechamento}>
                      <span className={estilos.seloCelula}>{tipo}</span>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </div>
        </div>
      )}

      {aba === "abertos" && (
        <div className={estilos.historico}>
          <div className={estilos.barraResumo}>
            <span className={estilos.resumo}>
              {abertos.length === 0
                ? "Nenhum alerta aberto"
                : `${abertos.length} ${abertos.length === 1 ? "alerta aberto" : "alertas abertos"}`}
              {criticos > 0 && (
                <span className={estilos.resumoAlerta}>
                  {" "}
                  · {criticos} {criticos === 1 ? "crítico" : "críticos"}
                </span>
              )}
            </span>
            <span className={estilos.contagem}>Os alertas abrem e fecham sozinhos; a lista se atualiza a cada poucos segundos.</span>
          </div>
          {erroAoFechar && (
            <p className={estilos.erro} role="alert">
              {erroAoFechar}
            </p>
          )}
          <div className={estilos.lista}>
            {abertos.length === 0 && <p className={estilos.vazio}>Tudo dentro do esperado.</p>}
            {gruposDosAbertos(abertos).map((grupo) => (
              <section key={grupo.chave} className={estilos.grupoDoDia} aria-label={grupo.rotulo}>
                <h3 className={grupo.chave === "criticos" ? `${estilos.dia} ${estilos.diaCritico}` : estilos.dia}>
                  {grupo.rotulo}
                  <span>{grupo.alertas.length === 1 ? "1 alerta" : `${grupo.alertas.length} alertas`}</span>
                </h3>
                {grupo.alertas.map((a) => (
                  <div key={a.id} className={a.critico ? `${estilos.linhaHistorico} ${estilos.linhaCritica}` : estilos.linhaHistorico}>
                    <span className={estilos.horaHistorico}>
                      {horaCurta(a.abertoEm)}
                      {a.abertoEm.toDateString() !== new Date().toDateString() && <small>{formatar.diaMes(a.abertoEm)}</small>}
                    </span>
                    <div className={estilos.alertaTextos}>
                      <p className={estilos.tituloHistorico}>
                        <span className={estilos.seloCelula}>{a.idCelula ? nomeDa(a.idCelula) : "Sistema"}</span>
                        {a.titulo}
                        {a.critico && <SeloCritico />}
                      </p>
                      <p className={estilos.descricao}>{a.mensagem}</p>
                      {a.ajuda && <p className={estilos.ajudaAlerta}>{a.ajuda}</p>}
                    </div>
                    <div className={estilos.fechamento}>
                      <span className={estilos.duracaoAberta}>aberto {formatar.tempoDecorrido(a.abertoEm)}</span>
                      <span className={estilos.acoesAlerta}>
                        {FONTE_DADOS === "api" && a.tipo && FECHA_A_MAO.has(a.tipo) && (
                          <Botao ocupado={fechando === a.id} onClick={() => fechar(a.id)}>
                            Fechar alerta
                          </Botao>
                        )}
                        {a.idCelula && (
                          <Link to={`/celulas/${a.idCelula}`} className={estilos.link}>
                            Abrir célula
                          </Link>
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}

      {aba === "historico" && (
        <div className={estilos.historico}>
          {FONTE_DADOS === "api" && (
            <div className={estilos.barraFiltros}>
              <div className={estilos.filtros}>
                <label className={estilos.campoSeletor}>
                  Célula
                  <select
                    className={estilos.seletor}
                    value={filtro.idCelula}
                    onChange={(e) => setFiltro((f) => ({ ...f, idCelula: e.target.value }))}
                  >
                    <option value="">Todas</option>
                    <option value="sistema">Sistema</option>
                    {idsDasCelulas.map((id) => (
                      <option key={id} value={id}>
                        {nomeDa(id)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={estilos.campoSeletor}>
                  Tipo
                  <select
                    className={estilos.seletor}
                    value={filtro.tipo}
                    onChange={(e) => setFiltro((f) => ({ ...f, tipo: e.target.value }))}
                  >
                    <option value="">Todos</option>
                    {Object.entries(TITULO_DO_ALERTA).map(([tipo, { titulo }]) => (
                      <option key={tipo} value={tipo}>
                        {titulo}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {(filtro.idCelula || filtro.tipo) && (
                <button type="button" className={estilos.limparFiltros} onClick={() => setFiltro({ idCelula: "", tipo: "" })}>
                  Limpar filtros
                </button>
              )}
              {historico && (
                <span className={estilos.contagem}>
                  {cortado
                    ? `Os ${historico.length.toLocaleString("pt-BR")} alertas fechados mais recentes`
                    : historico.length === 1
                      ? "1 alerta fechado"
                      : `${historico.length.toLocaleString("pt-BR")} alertas fechados`}
                </span>
              )}
            </div>
          )}
          <div className={estilos.lista}>
            {erro && <p className={estilos.vazio}>{erro}</p>}
            {historico === null && !erro && <p className={estilos.vazio}>Carregando…</p>}
            {historico?.length === 0 && (
              <p className={estilos.vazio}>
                {filtro.idCelula || filtro.tipo ? "Nenhum alerta fechado com este filtro." : "Nenhum alerta fechado ainda."}
              </p>
            )}
            {historico &&
              porDia(historico).map((grupo) => (
                <section key={grupo.chave} className={estilos.grupoDoDia} aria-label={grupo.rotulo}>
                  <h3 className={estilos.dia}>
                    {grupo.rotulo}
                    <span>{grupo.alertas.length === 1 ? "1 alerta" : `${grupo.alertas.length} alertas`}</span>
                  </h3>
                  {grupo.alertas.map((a) => (
                    <div key={a.id} className={estilos.linhaHistorico}>
                      <span className={estilos.horaHistorico}>{horaCurta(a.abertoEm)}</span>
                      <div className={estilos.alertaTextos}>
                        <p className={estilos.tituloHistorico}>
                          <span className={estilos.seloCelula}>{a.idCelula ? nomeDa(a.idCelula) : "Sistema"}</span>
                          {a.titulo}
                          {a.critico && <SeloCritico />}
                        </p>
                        <p className={estilos.descricao}>{a.mensagem}</p>
                      </div>
                      <div className={estilos.fechamento}>
                        <span className={estilos.duracao}>durou {quantoDurou(a)}</span>
                        <span className={estilos.descricao}>
                          {a.fechadoPor
                            ? `fechado por ${a.fechadoPor}`
                            : `fechou sozinho ${a.fechadoEm.toDateString() === a.abertoEm.toDateString() ? `às ${horaCurta(a.fechadoEm)}` : `em ${formatar.diaHora(a.fechadoEm)}`}`}
                        </span>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
