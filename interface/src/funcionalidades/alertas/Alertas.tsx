// Tela "Alertas · regras" do Figma (nó 83:1303). Abertos e Histórico listam
// os alertas que o backend abre, com o título e a ajuda de cada tipo. A aba
// Regras é a do Figma no modo exemplo; no modo api, a API ainda não tem regras
// configuráveis, então ela mostra as regras fixas do backend, sem editar.

import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { listarAlertas } from "@/api/cliente";
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
}

const HORA = 3_600_000;
const HISTORICO_EXEMPLO: AlertaFechado[] = [
  { id: 101, idCelula: "c08", titulo: "Desvio de temperatura", mensagem: "Desvio de temperatura: 31,3 °C com alvo de 30,0 °C", abertoEm: new Date(Date.now() - 30 * HORA), fechadoEm: new Date(Date.now() - 29.7 * HORA) },
  { id: 102, idCelula: "c08", titulo: "Sem comunicação", mensagem: "Sem comunicação: placa ficou offline", abertoEm: new Date(Date.now() - 26 * HORA), fechadoEm: new Date(Date.now() - 25.9 * HORA) },
  { id: 103, idCelula: "c11", titulo: "Setpoint sem confirmação", mensagem: "Setpoint sem confirmação: pedido de 37,0 °C", abertoEm: new Date(Date.now() - 50 * HORA), fechadoEm: new Date(Date.now() - 49 * HORA) },
];

function useHistorico(ativo: boolean) {
  const [historico, setHistorico] = useState<AlertaFechado[] | null>(FONTE_DADOS === "exemplo" ? HISTORICO_EXEMPLO : null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ativo || FONTE_DADOS === "exemplo") return;
    const controle = new AbortController();
    listarAlertas(controle.signal, false)
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
            })),
        ),
      )
      .catch((e: Error) => e.name !== "AbortError" && setErro(e.message));
    return () => controle.abort();
  }, [ativo]);
  return { historico, erro };
}

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
  const { dados } = useDados();
  const nomeDa = useCelulas().nome;
  const [parametros, setParametros] = useSearchParams();
  const aba = (parametros.get("aba") as Aba | null) ?? (FONTE_DADOS === "api" ? "abertos" : "regras");
  const [regras, setRegras] = useState(REGRAS_EXEMPLO);
  const [destacada, setDestacada] = useState<number | null>(6);
  const [criando, setCriando] = useState(true);
  const { historico, erro } = useHistorico(aba === "historico");
  const abertos = dados?.alertas ?? [];

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
          {erro && <p className={estilos.erro}>{erro}</p>}
          {historico === null && !erro && <p className={estilos.vazio}>Carregando…</p>}
          {historico?.length === 0 && <p className={estilos.vazio}>Nenhum alerta fechado ainda.</p>}
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
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
