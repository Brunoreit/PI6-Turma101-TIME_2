// Painel "Taxa de crescimento por condição" da tela do experimento: uma barra
// por condição com a média das células, e um ponto para cada célula. Ao
// passar o mouse numa barra, mostra a média e a taxa de cada célula.

import { useState } from "react";
import { DicaDoGrafico } from "@/compartilhado/componentes/DicaDoGrafico";
import * as formatar from "@/compartilhado/formatar";
import estilos from "./Experimento.module.css";
import type { Condicao } from "./modelo";

const ESCALA = 0.8;
const MARCAS = [0, 0.2, 0.4, 0.6, 0.8];

/** Posição no eixo, de 0 a 1. Taxa negativa (cultura morrendo) fica no zero. */
const posicao = (taxa: number) => Math.min(Math.max(taxa / ESCALA, 0), 1);

function media(condicao: Condicao): number {
  return condicao.taxas.reduce((soma, t) => soma + t.taxa, 0) / condicao.taxas.length;
}

export function TaxaDeCrescimento({ condicoes }: { condicoes: Condicao[] }) {
  const maior = Math.max(...condicoes.map(media));
  const [apontada, setApontada] = useState<string | null>(null);
  const taxa = (v: number) => `${formatar.decimal(v, 2)} h⁻¹`;
  return (
    <section className={estilos.painel}>
      <div className={estilos.painelTitulo}>
        <h2>Taxa de crescimento por condição</h2>
        <p>Média das células de cada condição nos últimos 7 dias, em divisões por hora. Cada ponto é uma célula.</p>
      </div>
      {condicoes.length === 0 ? (
        <p className={estilos.vazio}>Ainda sem leituras suficientes para calcular a taxa.</p>
      ) : (
        <>
          <div className={estilos.eixo} aria-hidden>
            <div className={estilos.eixoTrilho}>
              {MARCAS.map((m) => (
                <span key={m} style={{ left: `${(m / ESCALA) * 100}%` }}>
                  {formatar.decimal(m, 1)}
                </span>
              ))}
            </div>
          </div>
          {condicoes.map((condicao) => {
            const valor = media(condicao);
            return (
              <div key={condicao.rotulo} className={estilos.condicao}>
                <span className={estilos.condicaoRotulo}>{condicao.rotulo}</span>
                <div
                  className={estilos.trilhoTaxa}
                  onMouseEnter={() => setApontada(condicao.rotulo)}
                  onMouseLeave={() => setApontada(null)}
                >
                  <span
                    className={valor === maior ? estilos.barraMaior : estilos.barra}
                    style={{ width: `${posicao(valor) * 100}%` }}
                  />
                  {condicao.taxas.map((t) => (
                    <span
                      key={t.idCelula}
                      className={estilos.pontoTaxa}
                      style={{ left: `${posicao(t.taxa) * 100}%` }}
                    />
                  ))}
                  {apontada === condicao.rotulo && (
                    <DicaDoGrafico
                      titulo={`${condicao.rotulo} · ${condicao.taxas.length} ${condicao.taxas.length === 1 ? "célula" : "células"}`}
                      linhas={[
                        { rotulo: "Média", valor: taxa(valor), forte: true },
                        ...condicao.taxas.map((t) => ({ rotulo: t.idCelula, valor: taxa(t.taxa) })),
                      ]}
                      x={posicao(valor)}
                      topo={-8}
                    />
                  )}
                </div>
                <div className={estilos.valores}>
                  <span className={estilos.valorMedia}>{formatar.decimal(valor, 2)} h⁻¹</span>
                  <span className={estilos.valorCelulas}>
                    {condicao.taxas.map((t) => `${t.idCelula} ${formatar.decimal(t.taxa, 2)}`).join(" · ")}
                  </span>
                  {condicao.aviso && <span className={estilos.valorAviso}>{condicao.aviso}</span>}
                </div>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}
