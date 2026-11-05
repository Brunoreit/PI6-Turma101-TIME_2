// Telas "Experimento EXP-01", "· só leitura" e "· compartilhar" do Figma
// (nós 14:1164, 79:1185 e 79:1590). O que aparece depende do acesso da
// pessoa logada: responsável, pode modificar ou só leitura.

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import iconeHistoriador from "@/assets/icones/historiador-14.svg";
import olho from "@/assets/icones/olho-18.svg";
import { AvisoDeAcesso, useAvisoDeAcesso } from "@/compartilhado/componentes/AvisoDeAcesso";
import { Botao } from "@/compartilhado/componentes/Botao";
import { SeloDeStatus } from "@/compartilhado/componentes/SeloDeStatus";
import * as formatar from "@/compartilhado/formatar";
import { useSessao } from "@/sessao/SessaoProvider";
import { Compartilhar } from "./Compartilhar";
import estilos from "./Experimento.module.css";
import { SeloDoExperimento } from "./Experimentos";
import { useExperimentos } from "./ExperimentosProvider";
import { acessoDe, diaAtual, terminoPrevisto } from "./modelo";
import { TaxaDeCrescimento } from "./TaxaDeCrescimento";

export function DetalheDoExperimento() {
  const { codigo = "" } = useParams();
  const { buscar, encerrar } = useExperimentos();
  const { usuario } = useSessao();
  const { aviso, mostrar } = useAvisoDeAcesso();
  const [compartilhando, setCompartilhando] = useState(false);
  const [pedidoEnviado, setPedidoEnviado] = useState(false);
  const experimento = buscar(codigo);

  if (!experimento) {
    return (
      <div className={estilos.tela}>
        <nav className={estilos.trilha}>
          <Link to="/experimentos">Experimentos</Link> / <span>{codigo}</span>
        </nav>
        <p className={estilos.vazio}>Experimento {codigo} não encontrado. Volte para a lista e escolha outro.</p>
      </div>
    );
  }

  const acesso = acessoDe(experimento, usuario?.email);
  const responsavel = experimento.responsavel.nome;
  const encerrado = experimento.status === "encerrado";
  const dia = diaAtual(experimento);
  const termino = terminoPrevisto(experimento);

  const pedirAcesso = () => setPedidoEnviado(true);
  const semAcessoCompartilhar = () =>
    mostrar({
      titulo: "Você precisa de acesso para compartilhar",
      mensagem: `Só o responsável muda quem tem acesso ao ${experimento.codigo}.`,
      acao: `Pedir acesso a ${responsavel}`,
    });
  const semAcessoEncerrar = () =>
    mostrar({
      titulo: "Você precisa de acesso para encerrar",
      mensagem: `Só o responsável pode encerrar o ${experimento.codigo}.${acesso === "leitura" ? " Você tem acesso só de leitura." : ""}`,
      acao: `Pedir acesso a ${responsavel}`,
    });

  const legendaAcoes =
    acesso === "responsavel"
      ? "Você é o responsável."
      : acesso === "leitura"
        ? "Você tem acesso só de leitura."
        : `Só o responsável, ${responsavel}, pode encerrar.`;

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
            {experimento.tipo} · responsável {responsavel} · {experimento.descricao.charAt(0).toLowerCase()}
            {experimento.descricao.slice(1)}
          </p>
        </div>
        <div className={estilos.acoes}>
          <div className={estilos.botoes}>
            <Botao
              onClick={() => setCompartilhando(true)}
              semAcesso={acesso === "responsavel" ? undefined : semAcessoCompartilhar}
            >
              Compartilhar
            </Botao>
            <Botao para={`/experimentos/novo?base=${experimento.codigo}`}>Duplicar</Botao>
            {!encerrado && (
              <Botao
                tipo="perigo"
                semAcesso={acesso === "responsavel" ? undefined : semAcessoEncerrar}
                onClick={() => {
                  if (window.confirm(`Encerrar o ${experimento.codigo}? As células voltam a ficar livres.`)) encerrar(experimento.codigo);
                }}
              >
                Encerrar experimento
              </Botao>
            )}
          </div>
          <p className={estilos.legendaAcoes}>{legendaAcoes}</p>
        </div>
      </header>

      {acesso === "leitura" && (
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
              ? "Não iniciado"
              : encerrado
                ? `Encerrado · ${dia} de ${experimento.duracaoDias} dias`
                : `Dia ${dia} de ${experimento.duracaoDias}`}
          </span>
          <span className={estilos.prazoDatas}>
            {!experimento.inicio || !termino
              ? `${experimento.duracaoDias} dias previstos. Começa quando a primeira célula for atribuída.`
              : encerrado && experimento.fim
                ? `Início ${formatar.data(experimento.inicio)} · término ${formatar.data(experimento.fim)}`
                : `Início ${formatar.data(experimento.inicio)} · término previsto ${formatar.data(termino)}`}
          </span>
        </div>
        <span className={estilos.trilho}>
          <span
            className={encerrado ? estilos.trilhoEncerrado : estilos.trilhoAndando}
            style={{ width: `${(dia / experimento.duracaoDias) * 100}%` }}
          />
        </span>
      </div>

      <TaxaDeCrescimento condicoes={experimento.condicoes} />

      <section className={estilos.painel}>
        <div className={estilos.painelTitulo}>
          <h2>Células no experimento</h2>
          <p>
            {experimento.celulas.length === 0
              ? "Nenhuma célula ainda. Atribua uma célula livre na tela da célula."
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
              <div key={c.id} className={estilos.linha} role="row">
                <span className={estilos.idCelula} role="cell">
                  {c.id}
                </span>
                <span role="cell">{c.condicao}</span>
                <span role="cell">
                  <SeloDeStatus situacao={c.situacao} />
                </span>
                <span role="cell">{formatar.temperatura(c.temperaturaC)}</span>
                <span role="cell">{formatar.decimal(c.od, 3)}</span>
                <span role="cell">{formatar.decimal(c.ph, 2)}</span>
                <span role="cell">
                  {formatar.diaMes(c.inicio)} {c.fim ? `a ${formatar.diaMes(c.fim)}` : "até agora"}
                </span>
                <span role="cell">{c.fim ? "—" : formatar.tempoDecorrido(c.ultimaLeituraEm)}</span>
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
            <Link to={`/historiador?celulas=${experimento.celulas.map((c) => c.id).join(",")}`} className={estilos.historiadorLink}>
              <img src={iconeHistoriador} width={14} height={14} alt="" />
              Ver estas {experimento.celulas.length} células no historiador, cada uma no seu período
            </Link>
            <span>As medições ficam na célula. O experimento guarda só o início e o fim de cada uma.</span>
          </div>
        )}
      </section>

      <AvisoDeAcesso aviso={aviso} onAcao={pedirAcesso} />
      {compartilhando && <Compartilhar experimento={experimento} onFechar={() => setCompartilhando(false)} />}
    </div>
  );
}
