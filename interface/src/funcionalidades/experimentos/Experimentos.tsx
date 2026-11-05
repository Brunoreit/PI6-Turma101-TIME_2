// Telas "Experimentos" e "Experimentos · compartilhados" do Figma (nós
// 11:1156 e 78:1217). A segunda é a versão mais nova: o filtro separa os
// seus dos compartilhados, e o responsável ganha o selo de permissão.

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import iconeInfo from "@/assets/icones/info-16.svg";
import lapis from "@/assets/icones/lapis-11.svg";
import iconeMais from "@/assets/icones/mais-16.svg";
import olho from "@/assets/icones/olho-11.svg";
import { SeloDeStatus } from "@/compartilhado/componentes/SeloDeStatus";
import * as formatar from "@/compartilhado/formatar";
import { useSessao } from "@/sessao/SessaoProvider";
import { useExperimentos } from "./ExperimentosProvider";
import estilos from "./Experimentos.module.css";
import { acessoDe, diaAtual, ROTULO_DO_STATUS, type Experimento } from "./modelo";

type Filtro = "todos" | "meus" | "compartilhados";

const CHIPS_VISIVEIS = 3;

export function SeloDoExperimento({ experimento }: { experimento: Experimento }) {
  const variante = { andamento: "online", standby: "espera", encerrado: "offline" } as const;
  return <SeloDeStatus situacao={variante[experimento.status]} rotulo={ROTULO_DO_STATUS[experimento.status]} />;
}

function Celulas({ experimento }: { experimento: Experimento }) {
  const { celulas, status } = experimento;
  if (celulas.length === 0) {
    return (
      <>
        <span className={estilos.nenhuma}>Nenhuma célula</span>
        <Link to="/" className={estilos.atribuir}>
          Atribua na tela da célula
        </Link>
      </>
    );
  }
  const resto = celulas.length - CHIPS_VISIVEIS;
  return (
    <>
      <span className={estilos.chips}>
        {[...celulas].sort((a, b) => a.id.localeCompare(b.id)).slice(0, CHIPS_VISIVEIS).map((c) => (
          <span key={c.id} className={estilos.chip}>
            {c.id}
          </span>
        ))}
        {resto > 0 && <span className={estilos.mais}>+{resto}</span>}
      </span>
      <span className={estilos.legenda}>
        {celulas.length} {celulas.length === 1 ? "célula" : "células"}
        {status === "encerrado" && (celulas.length === 1 ? " liberada" : " liberadas")}
      </span>
    </>
  );
}

function Duracao({ experimento }: { experimento: Experimento }) {
  const { inicio, fim, duracaoDias, status } = experimento;
  const dia = diaAtual(experimento);
  const texto = !inicio ? "não iniciado" : status === "encerrado" ? `${dia} de ${duracaoDias} dias` : `dia ${dia} de ${duracaoDias}`;
  const legenda = !inicio
    ? `${duracaoDias} dias previstos`
    : status === "encerrado" && fim
      ? `${formatar.diaMes(inicio)} a ${formatar.data(fim)}`
      : `início ${formatar.data(inicio)}`;
  return (
    <>
      <span className={estilos.duracaoTexto}>{texto}</span>
      <span className={estilos.progresso}>
        {inicio && (
          <span
            className={status === "encerrado" ? estilos.progressoEncerrado : estilos.progressoAndando}
            style={{ width: `${(dia / duracaoDias) * 100}%` }}
          />
        )}
      </span>
      <span className={estilos.legenda}>{legenda}</span>
    </>
  );
}

function Permissao({ experimento, email }: { experimento: Experimento; email?: string }) {
  const acesso = acessoDe(experimento, email);
  if (acesso === "responsavel") return <span className={estilos.voce}>você</span>;
  return (
    <span className={estilos.permissao}>
      <img src={acesso === "leitura" ? olho : lapis} width={11} height={11} alt="" />
      {acesso === "leitura" ? "só leitura" : "pode modificar"}
    </span>
  );
}

export function Experimentos() {
  const { experimentos } = useExperimentos();
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const meus = experimentos.filter((e) => acessoDe(e, usuario?.email) === "responsavel");
  const compartilhados = experimentos.filter((e) => !meus.includes(e));
  const visiveis = filtro === "meus" ? meus : filtro === "compartilhados" ? compartilhados : experimentos;

  const opcoes: { valor: Filtro; rotulo: string }[] = [
    { valor: "todos", rotulo: `Todos ${experimentos.length}` },
    { valor: "meus", rotulo: `Meus ${meus.length}` },
    { valor: "compartilhados", rotulo: `Compartilhados comigo ${compartilhados.length}` },
  ];

  return (
    <div className={estilos.tela}>
      <header className={estilos.cabecalho}>
        <div className={estilos.tituloBloco}>
          <h1 className={estilos.titulo}>Experimentos</h1>
          <p className={estilos.subtitulo}>
            {experimentos.length} experimentos · {meus.length} seus e {compartilhados.length} compartilhados com você
          </p>
        </div>
        <div className={estilos.acoes}>
          <div className={estilos.filtro} role="group" aria-label="Filtrar experimentos">
            {opcoes.map((opcao) => (
              <button
                key={opcao.valor}
                type="button"
                className={filtro === opcao.valor ? estilos.filtroAtivo : estilos.filtroItem}
                aria-pressed={filtro === opcao.valor}
                onClick={() => setFiltro(opcao.valor)}
              >
                {opcao.rotulo}
              </button>
            ))}
          </div>
          <Link to="/experimentos/novo" className={estilos.botaoNovo}>
            <img src={iconeMais} width={16} height={16} alt="" />
            Novo experimento
          </Link>
        </div>
      </header>

      <div className={estilos.tabela} role="table" aria-label="Experimentos">
        <div className={estilos.cabecalhoTabela} role="row">
          {["Experimento", "Tipo de crescimento", "Status", "Células", "Duração", "Responsável", ""].map((coluna, i) => (
            <span key={i} className={estilos.coluna} role="columnheader">
              {coluna}
            </span>
          ))}
        </div>
        {visiveis.map((e) => (
          <div
            key={e.codigo}
            className={estilos.linha}
            role="row"
            onClick={() => navegar(`/experimentos/${e.codigo}`)}
          >
            <span className={`${estilos.coluna} ${estilos.colunaNome}`} role="cell">
              <span className={estilos.nome}>
                <span className={estilos.codigo}>{e.codigo}</span>
                <Link to={`/experimentos/${e.codigo}`} className={estilos.nomeLink} onClick={(ev) => ev.stopPropagation()}>
                  {e.nome}
                </Link>
              </span>
              <span className={estilos.descricao}>{e.descricao}</span>
            </span>
            <span className={`${estilos.coluna} ${estilos.tipo}`} role="cell">
              {e.tipo}
            </span>
            <span className={estilos.coluna} role="cell">
              <SeloDoExperimento experimento={e} />
            </span>
            <span className={`${estilos.coluna} ${estilos.empilhada}`} role="cell">
              <Celulas experimento={e} />
            </span>
            <span className={`${estilos.coluna} ${estilos.empilhada} ${estilos.colunaDuracao}`} role="cell">
              <Duracao experimento={e} />
            </span>
            <span className={`${estilos.coluna} ${estilos.empilhada}`} role="cell">
              <span className={estilos.responsavel}>{e.responsavel.nome}</span>
              <Permissao experimento={e} email={usuario?.email} />
            </span>
            <span className={`${estilos.coluna} ${estilos.colunaAcao}`} role="cell">
              {/* Duplicar cria uma cópia sua, por isso fica liberado para todos. */}
              <Link
                to={`/experimentos/novo?base=${e.codigo}`}
                className={estilos.duplicar}
                onClick={(ev) => ev.stopPropagation()}
              >
                Duplicar
              </Link>
            </span>
          </div>
        ))}
        {visiveis.length === 0 && <p className={estilos.vazio}>Nenhum experimento neste filtro.</p>}
      </div>

      <div className={estilos.nota}>
        <img src={iconeInfo} width={16} height={16} alt="" />
        <p>
          O selo laranja marca os experimentos que outros pesquisadores compartilharam com você, com a sua permissão. Com
          acesso só de leitura, as opções de alterar ficam esmaecidas. Duplicar cria uma cópia sua, por isso fica liberado
          para todos.
        </p>
      </div>
    </div>
  );
}
