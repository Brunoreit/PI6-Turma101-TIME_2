// Busca os dados da visão geral a cada 20 s e os entrega para a barra
// lateral e para as telas, para que todas usem a mesma consulta.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { carregarVisaoGeral } from "./fonte";
import type { VisaoGeral } from "./modelo";

export const INTERVALO_DE_ATUALIZACAO_MS = 20_000;

interface EstadoDosDados {
  dados: VisaoGeral | null;
  /** Mensagem da última falha. Os dados anteriores continuam na tela. */
  erro: string | null;
}

const Contexto = createContext<EstadoDosDados>({ dados: null, erro: null });

export function DadosProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<EstadoDosDados>({ dados: null, erro: null });

  useEffect(() => {
    let controle = new AbortController();

    async function atualizar() {
      controle.abort();
      controle = new AbortController();
      try {
        const dados = await carregarVisaoGeral(controle.signal);
        setEstado({ dados, erro: null });
      } catch (erro) {
        if (controle.signal.aborted) return;
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        setEstado((anterior) => ({ ...anterior, erro: mensagem }));
      }
    }

    atualizar();
    const temporizador = setInterval(atualizar, INTERVALO_DE_ATUALIZACAO_MS);
    return () => {
      clearInterval(temporizador);
      controle.abort();
    };
  }, []);

  return <Contexto.Provider value={estado}>{children}</Contexto.Provider>;
}

export function useDados(): EstadoDosDados {
  return useContext(Contexto);
}
