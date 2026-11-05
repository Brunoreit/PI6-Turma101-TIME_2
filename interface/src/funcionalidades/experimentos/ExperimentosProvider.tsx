// Lista de experimentos compartilhada pelas telas de Experimentos. Enquanto
// a API não tem esses endpoints, começa com os dados de exemplo e as mudanças
// (novo, encerrar, compartilhar) ficam na memória até recarregar a página.

import { createContext, useContext, useState, type ReactNode } from "react";
import { EXPERIMENTOS_EXEMPLO } from "./exemplo";
import type { Convidado, Experimento } from "./modelo";

interface Contexto {
  experimentos: Experimento[];
  buscar: (codigo: string) => Experimento | undefined;
  /** Devolve o código do novo experimento, como "EXP-05". */
  criar: (experimento: Omit<Experimento, "codigo">) => string;
  encerrar: (codigo: string) => void;
  definirConvidados: (codigo: string, convidados: Convidado[]) => void;
}

const ContextoExperimentos = createContext<Contexto | null>(null);

export function ExperimentosProvider({ children }: { children: ReactNode }) {
  const [experimentos, setExperimentos] = useState(EXPERIMENTOS_EXEMPLO);

  function alterar(codigo: string, mudar: (e: Experimento) => Experimento) {
    setExperimentos((lista) => lista.map((e) => (e.codigo === codigo ? mudar(e) : e)));
  }

  const valor: Contexto = {
    experimentos,
    buscar: (codigo) => experimentos.find((e) => e.codigo === codigo),
    criar(novo) {
      const maior = Math.max(0, ...experimentos.map((e) => Number(e.codigo.slice(4)) || 0));
      const codigo = `EXP-${String(maior + 1).padStart(2, "0")}`;
      setExperimentos((lista) => [...lista, { ...novo, codigo }]);
      return codigo;
    },
    encerrar(codigo) {
      const agora = new Date();
      alterar(codigo, (e) => ({
        ...e,
        status: "encerrado",
        fim: agora,
        celulas: e.celulas.map((c) => ({ ...c, fim: c.fim ?? agora })),
      }));
    },
    definirConvidados(codigo, convidados) {
      alterar(codigo, (e) => ({ ...e, convidados }));
    },
  };

  return <ContextoExperimentos.Provider value={valor}>{children}</ContextoExperimentos.Provider>;
}

export function useExperimentos(): Contexto {
  const contexto = useContext(ContextoExperimentos);
  if (!contexto) throw new Error("useExperimentos precisa estar dentro de <ExperimentosProvider>.");
  return contexto;
}
