// Busca os dados de uma célula a cada 20 s, como o DadosProvider faz para a
// visão geral. Trocar o período busca de novo sem apagar a tela.

import { useCallback, useEffect, useRef, useState } from "react";
import { INTERVALO_DE_ATUALIZACAO_MS } from "./DadosProvider";
import { carregarCelula } from "./fonteCelula";
import type { DetalheDaCelula, Periodo } from "./modeloCelula";

interface EstadoDaCelula {
  dados: DetalheDaCelula | null;
  /** Mensagem da última falha. Os dados anteriores continuam na tela. */
  erro: string | null;
  /** Busca agora, sem esperar os 20 s. */
  recarregar: () => void;
}

export function useCelula(id: string, periodo: Periodo = "24h"): EstadoDaCelula {
  const [estado, setEstado] = useState<Omit<EstadoDaCelula, "recarregar">>({ dados: null, erro: null });
  const atualizar = useRef<() => void>(() => {});

  // Outra célula: começa do zero, para não mostrar os dados da anterior.
  useEffect(() => setEstado({ dados: null, erro: null }), [id]);

  useEffect(() => {
    let controle = new AbortController();

    async function buscar() {
      controle.abort();
      controle = new AbortController();
      try {
        const dados = await carregarCelula(id, periodo, controle.signal);
        setEstado({ dados, erro: null });
      } catch (erro) {
        if (controle.signal.aborted) return;
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        setEstado((anterior) => ({ ...anterior, erro: mensagem }));
      }
    }

    atualizar.current = buscar;
    buscar();
    const temporizador = setInterval(buscar, INTERVALO_DE_ATUALIZACAO_MS);
    return () => {
      clearInterval(temporizador);
      controle.abort();
    };
  }, [id, periodo]);

  const recarregar = useCallback(() => atualizar.current(), []);
  return { ...estado, recarregar };
}
