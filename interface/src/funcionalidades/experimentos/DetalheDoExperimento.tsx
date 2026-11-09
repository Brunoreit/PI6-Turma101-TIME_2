// Telas "Experimento EXP-01", "· só leitura", "· compartilhar" e "· mais
// ações" do Figma (nós 14:1164, 79:1185, 79:1590, 274:2313 e 274:2744). O
// que aparece depende do acesso da pessoa logada: responsável, pode
// modificar ou só leitura. Editar, Encerrar e Cancelar ficam no menu "Mais
// ações"; quem não é o responsável vê os itens esmaecidos, com cadeado.

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErroDaApi } from "@/api/cliente";
import iconeHistoriador from "@/assets/icones/historiador-14.svg";
import iconeCancelarCinza from "@/assets/icones/menu-cancelar-cinza.svg";
import iconeCancelar from "@/assets/icones/menu-cancelar.svg";
import iconeEditarCinza from "@/assets/icones/menu-editar-cinza.svg";
import iconeEditar from "@/assets/icones/menu-editar.svg";
import iconeEncerrarCinza from "@/assets/icones/menu-encerrar-cinza.svg";
import iconeEncerrar from "@/assets/icones/menu-encerrar.svg";
import olho from "@/assets/icones/olho-18.svg";
import { AvisoDeAcesso, useAvisoDeAcesso } from "@/compartilhado/componentes/AvisoDeAcesso";
import { Botao } from "@/compartilhado/componentes/Botao";
import { MenuSuspenso, type ItemDoMenu } from "@/compartilhado/componentes/MenuSuspenso";
import { SeloDeStatus } from "@/compartilhado/componentes/SeloDeStatus";
import * as formatar from "@/compartilhado/formatar";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { useSessao } from "@/sessao/SessaoProvider";
import { CancelarExperimento } from "./CancelarExperimento";
import { Compartilhar } from "./Compartilhar";
import { EncerrarExperimento } from "./EncerrarExperimento";
import estilos from "./Experimento.module.css";
import { SeloDoExperimento } from "./Experimentos";
import { useExperimentos } from "./ExperimentosProvider";
import { acessoNoExperimento, diaAtual, fechado, progresso, terminoPrevisto } from "./modelo";
import { useCondicoes } from "./taxa";
import { TaxaDeCrescimento } from "./TaxaDeCrescimento";

const NAO_ENCONTRADO = "Experimento não encontrado ou sem acesso. Volte para a lista e escolha outro.";

/** O historiador com as células e o período que cobre todas elas: do
 *  primeiro início ao último fim (ou agora, se alguma continua). */
function linkDoHistoriador(celulas: { id: string; inicio: Date; fim: Date | null }[]): string {
  const ids = [...new Set(celulas.map((c) => c.id))].slice(0, 4).join(",");
  const inicio = new Date(Math.min(...celulas.map((c) => c.inicio.getTime())));
  const parametros = new URLSearchParams({ celulas: ids, inicio: inicio.toISOString() });
  if (celulas.every((c) => c.fim)) {
    parametros.set("fim", new Date(Math.max(...celulas.map((c) => c.fim!.getTime()))).toISOString());
  }
  return `/historiador?${parametros}`;
}

const ou = (valor: number | null, formato: (v: number) => string) => (valor === null ? "—" : formato(valor));

export function DetalheDoExperimento() {
  const { codigo = "" } = useParams();
  const { buscar, carregarDetalhe, duplicar, encerrar, cancelar } = useExperimentos();
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const { aviso, mostrar } = useAvisoDeAcesso();
  const [compartilhando, setCompartilhando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
  const [carregado, setCarregado] = useState(false);
  const [erroDeCarga, setErroDeCarga] = useState<string | null>(null);
  const [erroDaAcao, setErroDaAcao] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    setCarregado(false);
    setErroDeCarga(null);
    carregarDetalhe(codigo)
      .then(() => setCarregado(true))
      .catch((falha) => setErroDeCarga(falha instanceof ErroDaApi && falha.status === 404 ? NAO_ENCONTRADO : mensagemDoErro(falha)));
    // carregarDetalhe muda a cada render do provider; só o código importa.
  }, [codigo]);

  const experimento = carregado ? buscar(codigo) : undefined;
  const condicoes = useCondicoes(experimento);

  if (!experimento) {
    return (
      <div className={estilos.tela}>
        <nav className={estilos.trilha}>
          <Link to="/experimentos">Experimentos</Link> / <span>{codigo}</span>
        </nav>
        <p className={estilos.vazio}>{erroDeCarga ?? (carregado ? NAO_ENCONTRADO : "Carregando o experimento...")}</p>
      </div>
    );
  }

  const acesso = acessoNoExperimento(experimento, usuario?.email);
  const responsavel = experimento.responsavel.nome;
  const souResponsavel = acesso === "responsavel";
  const encerrado = fechado(experimento);
  const dia = diaAtual(experimento);
  const termino = terminoPrevisto(experimento);

  const pedirAcesso = () => setPedidoEnviado(true);
  const semAcesso = (acao: string) => () =>
    mostrar({
      titulo: `Você precisa de acesso para ${acao}`,
      mensagem: `Só o responsável pode ${acao} o ${experimento.codigo}.${acesso === "leitura" ? " Você tem acesso só de leitura." : ""}`,
      acao: `Pedir acesso a ${responsavel}`,
    });

  /** Roda a ação; 403 vira o Aviso de acesso, os outros erros aparecem embaixo dos botões. */
  async function executar(acao: () => Promise<void>) {
    setErroDaAcao(null);
    setOcupado(true);
    try {
      await acao();
    } catch (falha) {
      if (falha instanceof ErroDaApi && falha.status === 403) {
        mostrar({ titulo: "Você não tem acesso a esta ação", mensagem: falha.detalhe, acao: `Pedir acesso a ${responsavel}` });
      } else {
        setErroDaAcao(mensagemDoErro(falha));
      }
    } finally {
      setOcupado(false);
    }
  }

  // Menu "Mais ações": as mesmas regras dos antigos botões. Editar e Cancelar
  // só com o experimento aberto; Encerrar só em andamento. A chave é o verbo
  // usado no Aviso de acesso.
  const abertas = experimento.celulas.filter((c) => !c.fim).length;
  const maisAcoes: ItemDoMenu[] = [];
  if (!encerrado) {
    maisAcoes.push({
      chave: "editar",
      titulo: "Editar",
      ajuda: experimento.status === "andamento" ? "Em andamento, só a descrição e os metadados mudam." : "Todos os campos podem mudar.",
      icone: iconeEditar,
      iconeEsmaecido: iconeEditarCinza,
      onEscolher: () => navegar(`/experimentos/${experimento.codigo}/editar`),
    });
  }
  if (experimento.status === "andamento") {
    maisAcoes.push({
      chave: "encerrar",
      titulo: "Encerrar experimento",
      ajuda:
        abertas === 0
          ? "Fecha o experimento. Nenhuma célula está em uso."
          : `Fecha o experimento e libera ${abertas === 1 ? "a célula" : `as ${abertas} células`}.`,
      icone: iconeEncerrar,
      iconeEsmaecido: iconeEncerrarCinza,
      perigo: true,
      divisoria: true,
      onEscolher: () => setEncerrando(true),
    });
  }
  if (!encerrado) {
    maisAcoes.push({
      chave: "cancelar",
      titulo: "Cancelar experimento",
      ajuda: "Marca como não válido. Pede um motivo.",
      icone: iconeCancelar,
      iconeEsmaecido: iconeCancelarCinza,
      perigo: true,
      divisoria: experimento.status !== "andamento",
      onEscolher: () => setCancelando(true),
    });
  }

  /** 403 dentro de um modal: fecha o modal e mostra o Aviso de acesso. */
  function noModal(acao: () => Promise<void>, fecharModal: () => void) {
    return async () => {
      try {
        await acao();
        fecharModal();
      } catch (falha) {
        if (falha instanceof ErroDaApi && falha.status === 403) {
          fecharModal();
          mostrar({ titulo: "Você não tem acesso a esta ação", mensagem: falha.detalhe, acao: `Pedir acesso a ${responsavel}` });
          return;
        }
        throw falha;
      }
    };
  }

  const legendaAcoes = souResponsavel
    ? "Você é o responsável."
    : acesso === "leitura"
      ? "Você tem acesso só de leitura."
      : `Só o responsável, ${responsavel}, pode editar, encerrar ou cancelar.`;

  return (
    <div className={estilos.tela}>
      <nav className={estilos.trilha} aria-label="Trilha">
        <Link to="/experimentos">Experimentos</Link>
        <span>/</span>
        <span>{experimento.codigo}</span>
      </nav>

      <header className={estilos.cabecalho}>
        <div className={estilos.tituloBloco}>
          <div className={estilos.tituloLinha}>
            <span className={estilos.codigo}>{experimento.codigo}</span>
            <h1>{experimento.nome}</h1>
            <SeloDoExperimento experimento={experimento} />
          </div>
          <p className={estilos.subtitulo}>
            {experimento.tipo} · responsável {responsavel}
            {experimento.criadoEm && ` · cadastrado em ${formatar.data(experimento.criadoEm)}`}
            {experimento.baseadoEm && (
              <>
                {" · duplicado do "}
                <Link to={`/experimentos/${experimento.baseadoEm}`}>{experimento.baseadoEm}</Link>
              </>
            )}
            {experimento.descricao && ` · ${experimento.descricao.charAt(0).toLowerCase()}${experimento.descricao.slice(1)}`}
          </p>
        </div>
        <div className={estilos.acoes}>
          <div className={estilos.botoes}>
            <Botao onClick={() => setCompartilhando(true)} semAcesso={souResponsavel ? undefined : semAcesso("compartilhar")}>
              Compartilhar
            </Botao>
            <Botao
              ocupado={ocupado}
              onClick={() => executar(async () => navegar(`/experimentos/${await duplicar(experimento.codigo)}/editar`))}
            >
              Duplicar
            </Botao>
            {maisAcoes.length > 0 && (
              <MenuSuspenso
                rotulo="Mais ações"
                itens={maisAcoes}
                semAcesso={
                  souResponsavel
                    ? undefined
                    : { rodape: `Só o responsável, ${responsavel}, pode usar estas opções.`, aoClicar: (item) => semAcesso(item.chave)() }
                }
              />
            )}
          </div>
          <p className={estilos.legendaAcoes}>{legendaAcoes}</p>
          {erroDaAcao && (
            <p className={estilos.erroAcao} role="alert">
              {erroDaAcao}
            </p>
          )}
        </div>
      </header>

      {experimento.status === "cancelado" && (
        <div className={estilos.avisoCancelado}>
          <p className={estilos.avisoTitulo}>
            Experimento cancelado{experimento.fim && ` em ${formatar.data(experimento.fim)}`}
          </p>
          <p>Motivo: {experimento.motivoCancelamento ?? "não informado"}</p>
        </div>
      )}

      {acesso === "leitura" && !encerrado && (
        <div className={estilos.avisoLeitura}>
          <img src={olho} width={18} height={18} alt="" />
          <div className={estilos.avisoTextos}>
            <p className={estilos.avisoTitulo}>{responsavel} compartilhou este experimento com você para leitura</p>
            <p>
              Você vê as células, os gráficos e os alertas, e pode exportar os dados. Para ajustar parâmetros ou mexer nas
              células, peça acesso de edição.
            </p>
          </div>
          {pedidoEnviado ? (
            <span className={estilos.pedidoEnviado}>Pedido enviado a {responsavel}</span>
          ) : (
            <Botao onClick={pedirAcesso}>Pedir acesso de edição</Botao>
          )}
        </div>
      )}

      <div className={estilos.prazo}>
        <div className={estilos.prazoLinha}>
          <span className={estilos.prazoDia}>
            {!experimento.inicio
              ? experimento.status === "cancelado" ? "Cancelado antes de começar" : "Não iniciado"
              : encerrado
                ? `${experimento.status === "cancelado" ? "Cancelado" : "Encerrado"} · ${dia} de ${experimento.duracaoDias} dias`
                : `Dia ${dia} de ${experimento.duracaoDias}`}
          </span>
          <span className={estilos.prazoDatas}>
            {!experimento.inicio || !termino
              ? `${experimento.duracaoDias} dias previstos.${encerrado ? "" : " Começa quando a primeira célula for atribuída."}`
              : encerrado && experimento.fim
                ? `Início ${formatar.data(experimento.inicio)} · término ${formatar.data(experimento.fim)}`
                : `Início ${formatar.data(experimento.inicio)} · término previsto ${formatar.data(termino)}`}
          </span>
        </div>
        <span className={estilos.trilho}>
          <span
            className={encerrado ? estilos.trilhoEncerrado : estilos.trilhoAndando}
            style={{ width: `${progresso(experimento) * 100}%` }}
          />
        </span>
      </div>

      <TaxaDeCrescimento condicoes={condicoes} />

      <section className={estilos.painel}>
        <div className={estilos.painelTitulo}>
          <h2>Células no experimento</h2>
          <p>
            {experimento.celulas.length === 0
              ? encerrado
                ? "Nenhuma célula passou por este experimento."
                : "Nenhuma célula ainda. Atribua uma célula livre na tela da célula."
              : `${experimento.celulas.length} ${experimento.celulas.length === 1 ? "célula" : "células"}. Clique numa célula para ajustar os parâmetros dela.`}
          </p>
        </div>
        {experimento.celulas.length > 0 && (
          <div className={estilos.tabela} role="table" aria-label="Células no experimento">
            <div className={estilos.cabecalhoTabela} role="row">
              {["Célula", "Condição", "Estado", "Temperatura", "Densidade óptica", "pH", "Período no experimento", "Última leitura", ""].map(
                (coluna, i) => (
                  <span key={i} role="columnheader">
                    {coluna}
                  </span>
                ),
              )}
            </div>
            {experimento.celulas.map((c) => (
              <div key={`${c.id}-${c.inicio.getTime()}`} className={estilos.linha} role="row">
                <span className={estilos.idCelula} role="cell">
                  {c.id}
                </span>
                <span role="cell">
                  {c.condicao}
                  {c.replica != null && ` · réplica ${c.replica}`}
                  {c.continuaDe && <span className={estilos.motivoCelula}>continua de {c.continuaDe}</span>}
                  {c.metadados && Object.keys(c.metadados).length > 0 && (
                    <span className={estilos.motivoCelula}>
                      {Object.entries(c.metadados)
                        .map(([chave, valor]) => `${chave}: ${typeof valor === "object" ? JSON.stringify(valor) : String(valor)}`)
                        .join(" · ")}
                    </span>
                  )}
                </span>
                <span role="cell">
                  {c.cancelada ? (
                    <span title={c.motivo ? `Motivo: ${c.motivo}` : undefined}>
                      <SeloDeStatus situacao="cancelado" rotulo="Cancelada" />
                      {c.motivo && <span className={estilos.motivoCelula}>{c.motivo}</span>}
                    </span>
                  ) : c.situacao ? (
                    <span title={c.motivo ? `Motivo: ${c.motivo}` : undefined}>
                      <SeloDeStatus situacao={c.situacao} rotulo={c.fim ? "Liberada" : undefined} />
                      {c.fim && c.motivo && <span className={estilos.motivoCelula}>{c.motivo}</span>}
                    </span>
                  ) : (
                    "—"
                  )}
                </span>
                <span role="cell">{ou(c.temperaturaC, formatar.temperatura)}</span>
                <span role="cell">{ou(c.od, (v) => formatar.decimal(v, 3))}</span>
                <span role="cell">{ou(c.ph, (v) => formatar.decimal(v, 2))}</span>
                <span role="cell">
                  {formatar.diaMes(c.inicio)} {c.fim ? `a ${formatar.diaMes(c.fim)}` : "até agora"}
                  {(c.iniciadoPor || c.encerradoPor) && (
                    <span className={estilos.motivoCelula}>
                      {[c.iniciadoPor && `entrou por ${c.iniciadoPor}`, c.encerradoPor && `saiu por ${c.encerradoPor}`].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </span>
                <span role="cell">{c.fim || !c.ultimaLeituraEm ? "—" : formatar.tempoDecorrido(c.ultimaLeituraEm)}</span>
                <span role="cell">
                  <Link to={`/celulas/${c.id}`} className={estilos.abrir}>
                    Abrir
                  </Link>
                </span>
              </div>
            ))}
          </div>
        )}
        {experimento.celulas.length > 0 && (
          <div className={estilos.historiador}>
            <Link to={linkDoHistoriador(experimento.celulas)} className={estilos.historiadorLink}>
              <img src={iconeHistoriador} width={14} height={14} alt="" />
              Ver estas {experimento.celulas.length} células no historiador, cada uma no seu período
            </Link>
            <span>As medições ficam na célula. O experimento guarda só o início e o fim de cada uma.</span>
          </div>
        )}
      </section>

      <AvisoDeAcesso aviso={aviso} onAcao={pedirAcesso} />
      {compartilhando && <Compartilhar experimento={experimento} onFechar={() => setCompartilhando(false)} />}
      {cancelando && (
        <CancelarExperimento
          experimento={experimento}
          onFechar={() => setCancelando(false)}
          onConfirmar={(motivo) => noModal(() => cancelar(experimento.codigo, motivo), () => setCancelando(false))()}
        />
      )}
      {encerrando && (
        <EncerrarExperimento
          experimento={experimento}
          onFechar={() => setEncerrando(false)}
          onConfirmar={noModal(() => encerrar(experimento.codigo), () => setEncerrando(false))}
        />
      )}
    </div>
  );
}
