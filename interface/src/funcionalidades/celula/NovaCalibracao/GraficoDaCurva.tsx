// Gráfico do painel "Curva" da Nova calibração de OD (Figma, nó 233:2356):
// eixo horizontal com o valor bruto, vertical com a OD. Os pontos são os
// padrões preenchidos; a linha laranja é a versão nova e a tracejada, a atual.

import { useState } from "react";
import { DicaDoGrafico } from "@/compartilhado/componentes/DicaDoGrafico";
import * as formatar from "@/compartilhado/formatar";
import type { Ponto } from "./regressao";
import estilos from "./NovaCalibracao.module.css";

interface Props {
  pontos: (Ponto & { nome: string })[];
  /** Ponto da linha que está sendo preenchida, desenhado vazado. */
  editando: (Ponto & { nome: string }) | null;
  nova: { a: number; b: number } | null;
  atual: { a: number; b: number; versao: number } | null;
}

const LARGURA = 1000;
const ALTURA = 600;

export function GraficoDaCurva({ pontos, editando, nova, atual }: Props) {
  const [apontado, setApontado] = useState<string | null>(null);
  const todos = editando ? [...pontos, editando] : pontos;
  // Escala com folga: bruto em múltiplos de 400, OD em múltiplos de 0,2.
  const maxX = Math.max(1200, Math.ceil(Math.max(0, ...todos.map((p) => p.bruto)) / 400) * 400);
  const maxY = Math.max(0.6, Math.ceil(Math.max(0, ...todos.map((p) => p.od)) / 0.2 - 1e-9) * 0.2);
  const marcasX = Array.from({ length: maxX / 400 + 1 }, (_, i) => i * 400);
  const marcasY = Array.from({ length: Math.round(maxY / 0.2) + 1 }, (_, i) => i * 0.2);
  const px = (bruto: number) => (bruto / maxX) * 100;
  const py = (od: number) => 100 - (Math.min(Math.max(od, 0), maxY) / maxY) * 100;
  const linha = (reta: { a: number; b: number }) => {
    // Trecho da reta dentro do gráfico.
    const x1 = Math.max(0, (0 - reta.b) / reta.a);
    const x2 = Math.min(maxX, (maxY - reta.b) / reta.a);
    return { x1: (px(x1) / 100) * LARGURA, y1: (py(reta.a * x1 + reta.b) / 100) * ALTURA, x2: (px(x2) / 100) * LARGURA, y2: (py(reta.a * x2 + reta.b) / 100) * ALTURA };
  };
  const ponto = todos.find((p) => p.nome === apontado);

  return (
    <div className={estilos.grafico} role="img" aria-label={`Curva de calibração com ${pontos.length} pontos`}>
      <div className={estilos.areaGrafico}>
        <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} preserveAspectRatio="none" aria-hidden>
          {marcasY.map((m) => (
            <line key={m} className={estilos.grade} x1={0} x2={LARGURA} y1={(py(m) / 100) * ALTURA} y2={(py(m) / 100) * ALTURA} />
          ))}
          {atual && atual.a > 0 && <line className={estilos.retaAtual} {...linha(atual)} />}
          {nova && nova.a > 0 && <line className={estilos.retaNova} {...linha(nova)} />}
        </svg>
        {todos.map((p) => (
          <span
            key={p.nome}
            className={p === editando ? estilos.pontoEditando : estilos.pontoCurva}
            style={{ left: `${px(p.bruto)}%`, top: `${py(p.od)}%` }}
            onMouseEnter={() => setApontado(p.nome)}
            onMouseLeave={() => setApontado(null)}
          />
        ))}
        {ponto && (
          <DicaDoGrafico
            titulo={ponto.nome}
            linhas={[
              { rotulo: "OD de referência", valor: formatar.decimal(ponto.od, 3), forte: true },
              { rotulo: "Bruto", valor: formatar.inteiro(ponto.bruto) },
              ...(nova ? [{ rotulo: "Versão nova calcula", valor: formatar.decimal(nova.a * ponto.bruto + nova.b, 3) }] : []),
              ...(atual ? [{ rotulo: `Versão ${atual.versao} calcula`, valor: formatar.decimal(atual.a * ponto.bruto + atual.b, 3) }] : []),
            ]}
            x={px(ponto.bruto) / 100}
            topo={Math.max(0, (py(ponto.od) / 100) * 200 - 20)}
          />
        )}
        {marcasY.map((m) => (
          <span key={`y${m}`} className={estilos.marcaY} style={{ top: `${py(m)}%` }}>
            {m === 0 ? "0" : formatar.decimal(m, 1)}
          </span>
        ))}
        {marcasX.map((m) => (
          <span key={`x${m}`} className={estilos.marcaX} style={{ left: `${px(m)}%` }}>
            {m}
          </span>
        ))}
      </div>
    </div>
  );
}
