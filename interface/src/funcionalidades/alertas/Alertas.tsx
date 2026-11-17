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

/** Alertas fechados, do mais novo ao mais antigo. `versao` muda quando um
 *  alerta é fechado à mão, para a lista buscar de novo. */
function useHistorico(ativo: boolean, filtro: FiltroDoHistorico, versao: number) {
  const [historico, setHistorico] = useState<AlertaFechado[] | null>(FONTE_DADOS === "exemplo" ? HISTORICO_EXEMPLO : null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ativo || FONTE_DADOS === "exemplo") return;
    const controle = new AbortController();
    setErro(null);
    listarAlertas(controle.signal, false, { idCelula: filtro.idCelula || undefined, tipo: filtro.tipo || undefined })
      .then((alertas) =>
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
            })),
        ),
      )
      .catch((e: Error) => e.name !== "AbortError" && setErro(e.message));
    return () => controle.abort();
  }, [ativo, filtro.idCelula, filtro.tipo, versao]);
  return { historico, erro };
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

/** Modo api: as verificações que o backend sempre roda, fixas no código. */
function RegrasDoBackend() {
  return (
    <div className={estilos.lista}>
      <p className={estilos.descricao}>
        Verificações do sistema: valem para todas as células e não podem ser desligadas.
      </p>
      {Object.entries(TITULO_DO_ALERTA).map(([tipo, { titulo, ajuda }]) => (
        <div key={tipo} className={estilos.alerta}>
          <span className={estilos.pontoFechado} />
          <div className={estilos.alertaTextos}>
            <p className={estilos.alertaTitulo}>{titulo}</p>
            <p className={estilos.descricao}>{ajuda}</p>
          </div>
          <span className={estilos.codigo}>{tipo}</span>
        </div>
      ))}
    </div>
  );
}

export function Alertas() {
  const { dados, recarregar } = useDados();
  const { ids: idsDasCelulas, nome: nomeDa } = useCelulas();
  const [parametros, setParametros] = useSearchParams();
  const aba = (parametros.get("aba") as Aba | null) ?? (FONTE_DADOS === "api" ? "abertos" : "regras");
  const { experimentos } = useExperimentos();
  const { usuario } = useSessao();
  // No modo exemplo, a tela abre como no Figma: a regra 6 destacada e o painel Nova regra aberto.
  const [regras, setRegras] = useState<Regra[]>(NA_API ? [] : REGRAS_EXEMPLO);
  const [destacada, setDestacada] = useState<number | null>(NA_API ? null : 6);
  const [criando, setCriando] = useState(!NA_API);
  const [erroDasRegras, setErroDasRegras] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<FiltroDoHistorico>({ idCelula: "", tipo: "" });
  const [fechados, setFechados] = useState(0);
  const [fechando, setFechando] = useState<number | null>(null);
  const [erroAoFechar, setErroAoFechar] = useState<string | null>(null);
  const { historico, erro } = useHistorico(aba === "historico", filtro, fechados);
  const abertos = dados?.alertas ?? [];

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

  /** No modo api, um erro da API aparece no painel Nova regra, que continua aberto. */
  async function salvar(regra: RegraNova) {
    if (NA_API) {
      const idExperimento = regra.ondeVale ? experimentos.find((e) => e.codigo === regra.ondeVale)?.id : undefined;
      const criada = await criarRegra(regraParaApi(regra, idExperimento));
      await carregarRegras();
      setDestacada(criada.id_regra);
      setCriando(false);
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
            setParametros({ aba: "regras" });
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
            onClick={() => setParametros({ aba: a.valor })}
          >
            {a.rotulo}
          </button>
        ))}
      </nav>

      {aba === "regras" && erroDasRegras && (
        <p className={estilos.erro} role="alert">
          {erroDasRegras}
        </p>
      )}

      {aba === "regras" && (
        <div className={estilos.corpo}>
          <div className={estilos.tabela} role="table" aria-label="Regras de alerta">
            <div className={estilos.cabecalhoTabela} role="row">
              {["Regra", "Condição", "Por", "Onde vale", "Canais", "Ativa"].map((c) => (
                <span key={c} role="columnheader">
                  {c}
                </span>
              ))}
            </div>
            {regras.map((r) => (
              <div key={r.id} className={r.id === destacada ? estilos.linhaDestacada : estilos.linha} role="row">
                <span className={estilos.colunaRegra} role="cell">
                  <span className={estilos.nomeRegra}>
                    {r.nome}
                    {r.gravidade === "critica" && <span className={estilos.seloCritica}>crítica</span>}
                  </span>
                  <span className={estilos.descricao}>{r.descricao}</span>
                  {r.dependeDoHardware && <span className={estilos.seloHardware}>depende do hardware</span>}
                  {NA_API && Boolean(r.alertasAbertos) && (
                    <span className={estilos.seloAbertos}>
                      {r.alertasAbertos === 1 ? "1 alerta aberto" : `${r.alertasAbertos} alertas abertos`}
                    </span>
                  )}
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
                </span>
                <span role="cell">{r.condicao}</span>
                <span role="cell">{r.porMinutos} min</span>
                <span role="cell" className={r.ondeVale ? estilos.codigo : undefined}>
                  {r.ondeVale ?? "Todas as células"}
                </span>
                <span role="cell" className={estilos.canais}>
                  <img src={iconeSino} width={15} height={15} alt="Na tela" />
                  {r.email && <img src={iconeEmail} width={15} height={15} alt="E-mail" />}
                </span>
                <span role="cell">
                  <Chave ligada={r.ativa} nome={r.nome} onClick={() => alternar(r)} />
                </span>
              </div>
            ))}
            {NA_API && regras.length === 0 && (
              <p className={estilos.vazio}>Nenhuma regra criada ainda. Use "Nova regra" para ser avisado quando uma medida passar de um limite.</p>
            )}
          </div>
          {criando && <NovaRegra onSalvar={salvar} onCancelar={() => setCriando(false)} />}
        </div>
      )}

      {aba === "regras" && NA_API && <RegrasDoBackend />}

      {aba === "abertos" && (
        <div className={estilos.lista}>
          {erroAoFechar && <p className={estilos.erro}>{erroAoFechar}</p>}
          {abertos.length === 0 && <p className={estilos.vazio}>Nenhum alerta aberto. Tudo dentro do esperado.</p>}
          {abertos.map((a) => (
            <div key={a.id} className={a.critico ? `${estilos.alerta} ${estilos.alertaCritico}` : estilos.alerta}>
              <span className={estilos.pontoAlerta} />
              <div className={estilos.alertaTextos}>
                <p className={estilos.alertaTitulo}>
                  <span className={estilos.codigo}>{a.idCelula ? nomeDa(a.idCelula) : "Sistema"}</span> · {a.titulo}
                  {a.critico && <> <SeloCritico /></>}
                </p>
                <p className={estilos.descricao}>{a.mensagem}</p>
                {a.ajuda && <p className={estilos.ajudaAlerta}>{a.ajuda}</p>}
              </div>
              <span className={estilos.alertaTempo}>aberto {formatar.tempoDecorrido(a.abertoEm)}</span>
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
            </div>
          ))}
        </div>
      )}

      {aba === "historico" && (
        <div className={estilos.lista}>
          {FONTE_DADOS === "api" && (
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
          )}
          {erro && <p className={estilos.erro}>{erro}</p>}
          {historico === null && !erro && <p className={estilos.vazio}>Carregando…</p>}
          {historico?.length === 0 && (
            <p className={estilos.vazio}>
              {filtro.idCelula || filtro.tipo ? "Nenhum alerta fechado com este filtro." : "Nenhum alerta fechado ainda."}
            </p>
          )}
          {historico?.map((a) => (
            <div key={a.id} className={estilos.alerta}>
              <span className={estilos.pontoFechado} />
              <div className={estilos.alertaTextos}>
                <p className={estilos.alertaTitulo}>
                  <span className={estilos.codigo}>{a.idCelula ? nomeDa(a.idCelula) : "Sistema"}</span> · {a.titulo}
                </p>
                <p className={estilos.descricao}>{a.mensagem}</p>
                <p className={estilos.descricao}>
                  Aberto em {formatar.diaHora(a.abertoEm)} · fechou depois de {formatar.duracao(a.abertoEm, a.fechadoEm)}
                  {a.fechadoPor && ` · fechado por ${a.fechadoPor}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
