// Trilha, título e abas comuns às telas da célula (Visão da célula, Ajustes
// e Diagnóstico).

import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import estilos from "./Celula.module.css";

const ABAS = [
  { caminho: "", rotulo: "Visão da célula" },
  { caminho: "/ajustes", rotulo: "Ajustes" },
  { caminho: "/diagnostico", rotulo: "Diagnóstico" },
] as const;

interface Props {
  id: string;
  aba: (typeof ABAS)[number]["rotulo"];
  subtitulo: string;
  /** Botão à direita do título. */
  acao?: ReactNode;
  /** Falha na última atualização. */
  erro?: string | null;
}

export function CabecalhoDaCelula({ id, aba, subtitulo, acao, erro }: Props) {
  const base = `/celulas/${encodeURIComponent(id)}`;
  return (
    <>
      <nav className={estilos.trilha} aria-label="Trilha">
        <Link to="/celulas" className={estilos.trilhaLink}>Células</Link>
        <span aria-hidden>/</span>
        <Link to={base} className={estilos.trilhaLink}>{id}</Link>
        <span aria-hidden>/</span>
        <span aria-current="page">{aba}</span>
      </nav>

      <header className={estilos.cabecalho}>
        <div className={estilos.tituloBloco}>
          <h1 className={estilos.titulo}>{id}</h1>
          <p className={estilos.subtitulo}>{subtitulo}</p>
          {erro && <p className={estilos.erro}>Falha na última atualização: {erro}</p>}
        </div>
        {acao}
      </header>

      <nav className={estilos.abas} aria-label={`Telas da célula ${id}`}>
        {ABAS.map((item) => (
          <NavLink
            key={item.caminho}
            to={`${base}${item.caminho}`}
            end
            className={({ isActive }) => (isActive ? estilos.abaAtiva : estilos.aba)}
          >
            {item.rotulo}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

/** Enquanto a primeira busca não volta, ou se ela falhar. */
export function CarregandoCelula({ id, aba, erro }: { id: string; aba: Props["aba"]; erro: string | null }) {
  return (
    <div className={estilos.tela}>
      <CabecalhoDaCelula id={id} aba={aba} subtitulo={erro ? "Não foi possível carregar a célula." : "Carregando…"} erro={erro} />
    </div>
  );
}
