// Filtro por status da lista de Experimentos (não está no Figma). Um botão
// "Status: Todos" abre a lista com caixas de seleção: Todos, ou um ou mais
// status. Nada marcado vale como Todos.

import { useEffect, useRef, useState } from "react";
import iconeSeta from "@/assets/icones/seta-baixo-16.svg";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import { SeloDeStatus } from "@/compartilhado/componentes/SeloDeStatus";
import estilos from "./Experimentos.module.css";
import { ROTULO_DO_STATUS, type StatusExperimento } from "./modelo";

/** Na ordem do ciclo de vida, como aparecem na lista. */
export const STATUS_DO_FILTRO: StatusExperimento[] = ["andamento", "standby", "encerrado", "cancelado"];

const VARIANTE = { andamento: "online", standby: "espera", encerrado: "offline", cancelado: "cancelado" } as const;

interface Props {
  /** Vazio: todos os status. */
  escolhidos: StatusExperimento[];
  onChange: (escolhidos: StatusExperimento[]) => void;
  /** Quantos experimentos há em cada status, já com o filtro de dono aplicado. */
  contagem: Record<StatusExperimento, number>;
}

export function FiltroDeStatus({ escolhidos, onChange, contagem }: Props) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const todos = escolhidos.length === 0;

  // Fecha ao clicar fora ou com Esc.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => caixa.current && !caixa.current.contains(e.target as Node) && setAberto(false);
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto]);

  function alternar(status: StatusExperimento) {
    const novos = escolhidos.includes(status) ? escolhidos.filter((s) => s !== status) : [...escolhidos, status];
    // Todos marcados é o mesmo que nenhum filtro.
    onChange(novos.length === STATUS_DO_FILTRO.length ? [] : STATUS_DO_FILTRO.filter((s) => novos.includes(s)));
  }

  const resumo = todos
    ? "Todos"
    : escolhidos.length <= 2
      ? escolhidos.map((s) => ROTULO_DO_STATUS[s]).join(", ")
      : `${escolhidos.length} de ${STATUS_DO_FILTRO.length}`;

  return (
    <div className={estilos.filtroStatus} ref={caixa}>
      <button
        type="button"
        className={todos ? estilos.botaoStatus : `${estilos.botaoStatus} ${estilos.botaoStatusAtivo}`}
        aria-haspopup="true"
        aria-expanded={aberto}
        title={todos ? "Filtrar por status" : `Status: ${escolhidos.map((s) => ROTULO_DO_STATUS[s]).join(", ")}`}
        onClick={() => setAberto((a) => !a)}
      >
        Status: <strong>{resumo}</strong>
        <img src={iconeSeta} width={14} height={14} alt="" />
      </button>
      {aberto && (
        <div className={estilos.listaStatus} role="group" aria-label="Filtrar por status">
          <CaixaDeSelecao marcada={todos} onChange={() => onChange([])}>
            <span className={estilos.opcaoStatus}>
              Todos
              <span className={estilos.contagemStatus}>{STATUS_DO_FILTRO.reduce((soma, s) => soma + contagem[s], 0)}</span>
            </span>
          </CaixaDeSelecao>
          <span className={estilos.divisorStatus} />
          {STATUS_DO_FILTRO.map((status) => (
            <CaixaDeSelecao key={status} marcada={escolhidos.includes(status)} onChange={() => alternar(status)}>
              <span className={estilos.opcaoStatus}>
                <SeloDeStatus situacao={VARIANTE[status]} rotulo={ROTULO_DO_STATUS[status]} />
                <span className={estilos.contagemStatus}>{contagem[status]}</span>
              </span>
            </CaixaDeSelecao>
          ))}
          {!todos && (
            <button type="button" className={estilos.limparStatus} onClick={() => onChange([])}>
              Limpar filtro
            </button>
          )}
        </div>
      )}
    </div>
  );
}
