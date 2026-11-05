// Reta da calibração por mínimos quadrados: od = a * bruto + b.

export interface Ponto {
  bruto: number;
  od: number;
}

export interface Reta {
  a: number;
  b: number;
  /** Quanto a reta explica os pontos, de 0 a 1. `null` com menos de 3 pontos. */
  r2: number | null;
}

export function ajustarReta(pontos: Ponto[]): Reta | null {
  const n = pontos.length;
  if (n < 2) return null;
  const mediaX = pontos.reduce((s, p) => s + p.bruto, 0) / n;
  const mediaY = pontos.reduce((s, p) => s + p.od, 0) / n;
  const sxx = pontos.reduce((s, p) => s + (p.bruto - mediaX) ** 2, 0);
  if (sxx === 0) return null;
  const sxy = pontos.reduce((s, p) => s + (p.bruto - mediaX) * (p.od - mediaY), 0);
  const a = sxy / sxx;
  const b = mediaY - a * mediaX;
  const total = pontos.reduce((s, p) => s + (p.od - mediaY) ** 2, 0);
  const residuo = pontos.reduce((s, p) => s + (p.od - (a * p.bruto + b)) ** 2, 0);
  return { a, b, r2: n >= 3 && total > 0 ? 1 - residuo / total : null };
}
