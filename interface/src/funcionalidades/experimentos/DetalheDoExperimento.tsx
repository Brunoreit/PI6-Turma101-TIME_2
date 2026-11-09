// Telas "Experimento EXP-01", "· só leitura" e "· compartilhar" do Figma
// (nós 14:1164, 79:1185 e 79:1590). O que aparece depende do acesso da
// pessoa logada: responsável, pode modificar ou só leitura. Editar e
// Cancelar não estão no Figma; seguem o mesmo desenho dos outros botões.

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ErroDaApi } from "@/api/cliente";
import iconeHistoriador from "@/assets/icones/historiador-14.svg";
import olho from "@/assets/icones/olho-18.svg";
import { AvisoDeAcesso, useAvisoDeAcesso } from "@/compartilhado/componentes/AvisoDeAcesso";
import { Botao } from "@/compartilhado/componentes/Botao";
import { SeloDeStatus } from "@/compartilhado/componentes/SeloDeStatus";
import * as formatar from "@/compartilhado/formatar";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { useSessao } from "@/sessao/SessaoProvider";
import { CancelarExperimento } from "./CancelarExperimento";
import { Compartilhar } from "./Compartilhar";
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
            {!encerrado && (
              <Botao para={`/experimentos/${experimento.codigo}/editar`} semAcesso={souResponsavel ? undefined : semAcesso("editar")}>
                Editar
              </Botao>
            )}
            {experimento.status === "andamento" && (
              <Botao
                tipo="perigo"
                ocupado={ocupado}
                semAcesso={souResponsavel ? undefined : semAcesso("encerrar")}
                onClick={() => {
                  if (window.confirm(`Encerrar o ${experimento.codigo}? As células voltam a ficar livres.`)) {
                    executar(() => encerrar(experimento.codigo));
                  }
                }}
              >
                Encerrar experimento
              </Botao>
            )}
            {!encerrado && (
              <Botao tipo="perigo" onClick={() => setCancelando(true)} semAcesso={souResponsavel ? undefined : semAcesso("cancelar")}>
                Cancelar experimento
              </Botao>
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
          onConfirmar={async (motivo) => {
            try {
              await cancelar(experimento.codigo, motivo);
              setCancelando(false);
            } catch (falha) {
              if (falha instanceof ErroDaApi && falha.status === 403) {
                setCancelando(false);
                mostrar({ titulo: "Você não tem acesso a esta ação", mensagem: falha.detalhe, acao: `Pedir acesso a ${responsavel}` });
                return;
              }
              throw falha;
            }
          }}
        />
      )}
    </div>
  );
}
