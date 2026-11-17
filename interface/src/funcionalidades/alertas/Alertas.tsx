// Tela "Alertas · regras" do Figma (nó 83:1303). Abertos e Histórico listam
// os alertas que o backend abre, com o título e a ajuda de cada tipo. A aba
// Regras é a do Figma no modo exemplo; no modo api, a API ainda não tem regras
// configuráveis, então ela mostra as regras fixas do backend, sem editar.
// O Histórico filtra por célula e tipo, e o alerta que nenhuma regra fecha
// (colisao_seq) ganha o botão Fechar alerta.

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fecharAlerta, listarAlertas } from "@/api/cliente";
import chaveDesligada from "@/assets/icones/chave-desligada.svg";
import chaveLigada from "@/assets/icones/chave-ligada.svg";
import iconeEmail from "@/assets/icones/email-15.svg";
import iconeSino from "@/assets/icones/sino-15.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import * as formatar from "@/compartilhado/formatar";
import { useDados } from "@/dados/DadosProvider";
import { useCelulas } from "@/dados/useCelulas";
import { FONTE_DADOS, infoDoAlerta, TITULO_DO_ALERTA } from "@/dados/fonte";
import estilos from "./Alertas.module.css";
import { REGRAS_EXEMPLO, type Regra } from "./modelo";
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
              titulo: infoDoAlerta(a.tipo).titulo,
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

const SEM_REGRAS_NA_API = "Ainda não disponível: a API ainda não tem regras de alerta configuráveis.";

/** Modo api: as regras que o backend já roda, fixas no código. */
function RegrasDoBackend() {
  return (
    <div className={estilos.lista}>
      <p className={estilos.descricao}>
        A API ainda não tem regras configuráveis. Estas são as verificações que o backend já faz, iguais para todas as
        células.
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
  const [regras, setRegras] = useState(REGRAS_EXEMPLO);
  const [destacada, setDestacada] = useState<number | null>(6);
  const [criando, setCriando] = useState(true);
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
    { valor: "regras", rotulo: FONTE_DADOS === "api" ? "Regras" : `Regras ${regras.length}` },
    { valor: "historico", rotulo: "Histórico" },
  ];

  function salvar(regra: Omit<Regra, "id">) {
    const id = Math.max(0, ...regras.map((r) => r.id)) + 1;
    setRegras((lista) => [...lista, { ...regra, id }]);
    setDestacada(id);
  }

  return (
    <div className={estilos.tela}>
      <header className={estilos.cabecalho}>
        <div className={estilos.tituloBloco}>
          <h1>Alertas</h1>
          <p>
            {FONTE_DADOS === "api"
              ? "Alertas que o backend abre e fecha sozinho. As regras configuráveis ainda não existem na API."
              : "Regras que decidem quando o sistema avisa e por onde. Você cria regras para os experimentos que pode modificar."}
          </p>
        </div>
        <Botao
          tipo="primario"
          indisponivel={FONTE_DADOS === "api" ? SEM_REGRAS_NA_API : undefined}
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

      {aba === "regras" && FONTE_DADOS === "api" && <RegrasDoBackend />}

      {aba === "regras" && FONTE_DADOS === "exemplo" && (
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
                  <Chave
                    ligada={r.ativa}
                    nome={r.nome}
                    onClick={() => setRegras((lista) => lista.map((x) => (x.id === r.id ? { ...x, ativa: !x.ativa } : x)))}
                  />
                </span>
              </div>
            ))}
          </div>
          {criando && <NovaRegra onSalvar={salvar} onCancelar={() => setCriando(false)} />}
        </div>
      )}

      {aba === "abertos" && (
        <div className={estilos.lista}>
          {erroAoFechar && <p className={estilos.erro}>{erroAoFechar}</p>}
          {abertos.length === 0 && <p className={estilos.vazio}>Nenhum alerta aberto. Tudo dentro do esperado.</p>}
          {abertos.map((a) => (
            <div key={a.id} className={estilos.alerta}>
              <span className={estilos.pontoAlerta} />
              <div className={estilos.alertaTextos}>
                <p className={estilos.alertaTitulo}>
                  <span className={estilos.codigo}>{a.idCelula ? nomeDa(a.idCelula) : "Sistema"}</span> · {a.titulo}
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
