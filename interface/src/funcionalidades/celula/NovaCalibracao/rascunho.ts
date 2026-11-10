// Calibração em andamento, guardada no navegador até salvar ou cancelar, para
// não perder os pontos ao recarregar ou fechar a aba. Uma chave por célula.
// O localStorage pode estar bloqueado (aba anônima, dados do site apagados):
// toda leitura e escrita fica num try/catch e a tela funciona sem ele.

/** Um ponto gravado na tabela. */
export interface Gravado {
  bruto: number;
  origem: "leitura" | "digitado";
  /** Só com origem leitura: as leituras que formaram a média. */
  seqInicio?: number;
  seqFim?: number;
  nLeituras?: number;
  desvio?: number;
  /** ISO 8601. */
  gravadoEm: string;
}

export interface Linha {
  /** "branco", "P1", "P2"... */
  rotulo: string;
  /** OD de referência como foi digitada ("0,350"). Vazia no branco. */
  od: string;
  gravado: Gravado | null;
}

export interface Rascunho {
  /** Quando a calibração começou (ISO 8601). */
  desde: string;
  linhas: Linha[];
  selecionada: string;
  organismo: string;
  recalcular: boolean;
}

const chave = (idCelula: string) => `calibracao-em-andamento-${idCelula}`;

export function lerRascunho(idCelula: string): Rascunho | null {
  try {
    const texto = localStorage.getItem(chave(idCelula));
    if (!texto) return null;
    const r = JSON.parse(texto) as Rascunho;
    return Array.isArray(r?.linhas) && typeof r.desde === "string" ? r : null;
  } catch {
    return null;
  }
}

export function guardarRascunho(idCelula: string, rascunho: Rascunho): void {
  try {
    localStorage.setItem(chave(idCelula), JSON.stringify(rascunho));
  } catch {
    // Sem armazenamento: a calibração continua, só não sobrevive a recarregar.
  }
}

export function apagarRascunho(idCelula: string): void {
  try {
    localStorage.removeItem(chave(idCelula));
  } catch {
    // Nada a apagar.
  }
}
