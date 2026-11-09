// Menu "Mais ações" do Figma (telas "Experimento EXP-01 · mais ações" e
// "· só leitura · mais ações", nós 274:2707 e 274:3127). Um botão com seta
// abre uma lista de ações, cada uma com ícone, título e uma linha de ajuda.
// Quem não tem acesso vê as ações esmaecidas, com cadeado, e um rodapé que
// explica; clicar numa delas chama `semAcesso`, que mostra o Aviso de acesso.

import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import cadeado from "@/assets/icones/cadeado-14-claro.svg";
import seta from "@/assets/icones/seta-baixo-14-escura.svg";
import estilos from "./MenuSuspenso.module.css";

/** Fecha um menu suspenso ao clicar fora dele ou ao apertar Esc. */
export function useFecharAoClicarFora(aberto: boolean, caixa: RefObject<HTMLElement | null>, fechar: () => void) {
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) fechar();
    };
    const tecla = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") fechar();
    };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [aberto, caixa, fechar]);
}

export interface ItemDoMenu {
  chave: string;
  titulo: string;
  ajuda: string;
  /** Ícone de 16 px na cor do item. */
  icone: string;
  /** O mesmo ícone em cinza, para quem não tem acesso. */
  iconeEsmaecido: string;
  perigo?: boolean;
  /** Linha divisória antes deste item. */
  divisoria?: boolean;
  onEscolher: () => void;
}

interface Props {
  rotulo: string;
  itens: ItemDoMenu[];
  /** Sem acesso: os itens ficam esmaecidos com cadeado, o rodapé aparece e
   *  o clique chama esta função em vez do `onEscolher`. */
  semAcesso?: { rodape: string; aoClicar: (item: ItemDoMenu) => void };
}

export function MenuSuspenso({ rotulo, itens, semAcesso }: Props) {
  const id = useId();
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const fechar = useRef(() => setAberto(false)).current;
  useFecharAoClicarFora(aberto, caixa, fechar);

  // Ao abrir, o foco vai para o primeiro item.
  useEffect(() => {
    if (aberto) lista.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [aberto]);

  function opcoes() {
    return [...(lista.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
  }

  function aoTeclarNaLista(e: KeyboardEvent) {
    const todas = opcoes();
    const atual = todas.indexOf(document.activeElement as HTMLElement);
    const ir = (i: number) => todas[(i + todas.length) % todas.length]?.focus();
    if (e.key === "ArrowDown") ir(atual + 1);
    else if (e.key === "ArrowUp") ir(atual - 1);
    else if (e.key === "Home") ir(0);
    else if (e.key === "End") ir(todas.length - 1);
    else if (e.key === "Escape") botao.current?.focus();
    else if (e.key === "Tab") return setAberto(false);
    else return;
    e.preventDefault();
  }

  function aoTeclarNoBotao(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setAberto(true);
    }
  }

  function escolher(item: ItemDoMenu) {
    setAberto(false);
    botao.current?.focus();
    if (semAcesso) semAcesso.aoClicar(item);
    else item.onEscolher();
  }

  return (
    <div className={estilos.caixa} ref={caixa}>
      <button
        ref={botao}
        type="button"
        className={estilos.botao}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? `${id}-menu` : undefined}
        onClick={() => setAberto((a) => !a)}
        onKeyDown={aoTeclarNoBotao}
      >
        {rotulo}
        <img src={seta} width={14} height={14} alt="" />
      </button>
      {aberto && (
        <div ref={lista} id={`${id}-menu`} className={estilos.menu} role="menu" aria-label={rotulo} onKeyDown={aoTeclarNaLista}>
          {itens.map((item) => (
            <Fragment key={item.chave}>
              {item.divisoria && <span className={estilos.divisoria} role="separator" />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`${estilos.item} ${semAcesso ? estilos.esmaecido : item.perigo ? estilos.perigo : ""}`}
                aria-disabled={semAcesso ? true : undefined}
                onClick={() => escolher(item)}
              >
                <img src={semAcesso ? item.iconeEsmaecido : item.icone} width={16} height={16} alt="" />
                <span className={estilos.textos}>
                  <span className={estilos.titulo}>{item.titulo}</span>
                  <span className={estilos.ajuda}>{item.ajuda}</span>
                </span>
                {semAcesso && <img className={estilos.cadeado} src={cadeado} width={14} height={14} alt="Sem acesso" />}
              </button>
            </Fragment>
          ))}
          {semAcesso && <p className={estilos.rodape}>{semAcesso.rodape}</p>}
        </div>
      )}
    </div>
  );
}
