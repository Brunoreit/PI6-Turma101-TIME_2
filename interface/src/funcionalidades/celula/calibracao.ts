// Fórmula da curva de OD e conversão das versões que vêm da API.
//
// O banco guarda od = a · bruto + b. Nas versões novas, o branco está nos
// pontos (rótulo "branco") e embutido no b: a fórmula aparece como
// od = a · (bruto − branco) + b', com b' = b + a · branco. Nas antigas, sem
// branco, continua od = a · bruto + b.

import type { CalibracaoApi, PontoCalibracaoApi } from "@/api/tipos";
import type { VersaoDeCalibracao } from "./modelo";

const coeficiente = (a: number) => a.toLocaleString("pt-BR", { maximumSignificantDigits: 3 });
const termo = (b: number) =>
  `${b < 0 ? "−" : "+"} ${Math.abs(b).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;

/** "od = 0,000515 · (bruto − 98) − 0,018". `b` é o da fórmula com o branco. */
export function formulaComBranco(a: number, b: number, branco: number): string {
  return `od = ${coeficiente(a)} · (bruto − ${Math.round(branco).toLocaleString("pt-BR")}) ${termo(b)}`;
}

/** A fórmula de uma versão: com o branco nas novas, sem nas antigas. */
export function formulaDaVersao(versao: { a: number; b: number; branco: number | null }): string {
  if (versao.branco !== null) return formulaComBranco(versao.a, versao.b + versao.a * versao.branco, versao.branco);
  const numero = (valor: number) => valor.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
  return `od = ${numero(versao.a)} · bruto ${versao.b < 0 ? "−" : "+"} ${numero(Math.abs(versao.b))}`;
}

function brancoDos(pontos: PontoCalibracaoApi[] | null): number | null {
  const branco = pontos?.find((p) => p.rotulo?.toLowerCase() === "branco");
  return branco ? branco.bruto : null;
}

export function versaoDaApi(c: CalibracaoApi): VersaoDeCalibracao {
  const branco = brancoDos(c.pontos);
  // Nas versões antigas, o branco é o ponto de OD 0; não é padrão.
  const padroes = (c.pontos ?? [])
    .filter((p) => p.od_referencia !== null && p.rotulo?.toLowerCase() !== "branco" && !(branco === null && p.od_referencia === 0))
    .map((p) => ({ referencia: p.od_referencia as number, calculada: c.a * p.bruto + c.b }));
  return {
    versao: c.versao,
    a: c.a,
    b: c.b,
    branco,
    criadaEm: new Date(c.criada_em),
    autor: c.calibrado_por,
    padroes,
    r2: c.r2,
    organismo: c.organismo,
  };
}

/** A versão ativa e as outras, da mais nova para a mais antiga. */
export function calibracaoDaApi(versoes: CalibracaoApi[]): { atual: VersaoDeCalibracao; anteriores: VersaoDeCalibracao[] } | null {
  const ativa = versoes.find((v) => v.ativa);
  if (!ativa) return null;
  return {
    atual: versaoDaApi(ativa),
    anteriores: versoes.filter((v) => v !== ativa).map(versaoDaApi),
  };
}
