// Células que o Historiador e o Exportar oferecem, e o nome de cada uma. No
// modo api, são as que a API conhece (GET /celulas, pelo DadosProvider), com o
// apelido; no modo exemplo, as 16 do Figma.

import { useDados } from "./DadosProvider";
import { FONTE_DADOS } from "./fonte";
import { nomeDaCelula } from "./modelo";

const CELULAS_DO_EXEMPLO = Array.from({ length: 16 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`);

export function useCelulas(): { ids: string[]; nome: (id: string) => string; carregando: boolean } {
  const { dados } = useDados();
  const celulas = dados?.celulas ?? [];
  const ids = FONTE_DADOS === "exemplo" ? CELULAS_DO_EXEMPLO : celulas.map((c) => c.id).sort();
  return {
    ids,
    nome: (id) => nomeDaCelula(celulas.find((c) => c.id === id) ?? { id }),
    carregando: FONTE_DADOS === "api" && dados === null,
  };
}

/** Células escolhidas quando a tela abre sem ?celulas=: as do Figma no modo
 *  exemplo; as duas primeiras da API no modo api. */
export function celulasIniciais(ids: string[]): string[] {
  return FONTE_DADOS === "exemplo" ? ["c04", "c08"] : ids.slice(0, 2);
}
