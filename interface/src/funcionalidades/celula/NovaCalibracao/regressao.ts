// Contas da calibração de OD, iguais às do servidor (backend/app/calibracao/
// ajuste.py). O que aparece na tela é só uma prévia: o que vale é o que o
// servidor devolve ao salvar.
//
// - O branco não é ponto da reta. Ele só zera a linha base: a reta é
//   ajustada só com os padrões, com x = bruto do padrão − bruto do branco.
// - Mínimos quadrados: a = Sxy / Sxx, b = ȳ − a·x̄,
//   R² = 1 − Σ(y − (a·x + b))² / Σ(y − ȳ)².
// - O banco guarda od = a · bruto + (b − a · branco).

export const MINIMO_DE_PADROES = 3;

export interface Padrao {
  bruto: number;
  od: number;
}

export interface Reta {
  /** od = a · (bruto − branco) + b */
  a: number;
  b: number;
  /** `null` com menos de 3 padrões. */
  r2: number | null;
}

/** Reta pelos padrões, com o branco fora dela. `null` sem pontos que formem
 *  uma reta (menos de 2, todos com o mesmo bruto ou a mesma OD). A prévia
 *  aparece a partir de 2 padrões; salvar exige 3. */
export function ajustarComBranco(branco: number, padroes: Padrao[]): Reta | null {
  const n = padroes.length;
  if (n < 2) return null;
  const xs = padroes.map((p) => p.bruto - branco);
  const ys = padroes.map((p) => p.od);
  if (new Set(xs).size === 1 || new Set(ys).size === 1) return null;
  const mediaX = xs.reduce((s, x) => s + x, 0) / n;
  const mediaY = ys.reduce((s, y) => s + y, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mediaX) ** 2, 0);
  const sxy = xs.reduce((s, x, i) => s + (x - mediaX) * (ys[i] - mediaY), 0);
  const a = sxy / sxx;
  const b = mediaY - a * mediaX;
  const total = ys.reduce((s, y) => s + (y - mediaY) ** 2, 0);
  const residuo = xs.reduce((s, x, i) => s + (ys[i] - (a * x + b)) ** 2, 0);
  return { a, b, r2: n >= MINIMO_DE_PADROES ? 1 - residuo / total : null };
}

/** O b que o banco guarda: od = a · bruto + bBanco. */
export function bDoBanco(reta: { a: number; b: number }, branco: number): number {
  return reta.b - reta.a * branco;
}

/** O b da fórmula com o branco, a partir do que o banco guarda. */
export function bComBranco(a: number, bBanco: number, branco: number): number {
  return bBanco + a * branco;
}

export interface Janela {
  n: number;
  media: number;
  minimo: number;
  maximo: number;
  /** (máximo − mínimo) / média */
  variacao: number;
  /** Desvio padrão amostral; 0 com uma leitura só. */
  desvio: number;
}

export function resumir(valores: number[]): Janela | null {
  const n = valores.length;
  if (n === 0) return null;
  const media = valores.reduce((s, v) => s + v, 0) / n;
  const minimo = Math.min(...valores);
  const maximo = Math.max(...valores);
  const variacao = media === 0 ? Infinity : (maximo - minimo) / Math.abs(media);
  const desvio = n > 1 ? Math.sqrt(valores.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1)) : 0;
  return { n, media, minimo, maximo, variacao, desvio };
}

/** Estável só com a janela cheia e variando menos que o limite. */
export function estavel(janela: Janela | null, nEsperado: number, variacaoMax: number): boolean {
  return janela !== null && janela.n >= nEsperado && janela.variacao < variacaoMax;
}

/** Quantas leituras ainda faltam para a janela ficar estável: conta, das mais
 *  novas para trás, quantas já variam menos que o limite entre si. */
export function faltamParaEstabilizar(valores: number[], nEsperado: number, variacaoMax: number): number {
  let estaveis = 0;
  for (let k = 1; k <= Math.min(valores.length, nEsperado); k++) {
    const janela = resumir(valores.slice(-k));
    if (!janela || janela.variacao >= variacaoMax) break;
    estaveis = k;
  }
  return nEsperado - estaveis;
}
