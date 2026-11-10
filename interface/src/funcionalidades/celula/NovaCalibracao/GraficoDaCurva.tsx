// Gráfico do painel "Curva" da Nova calibração de OD (Figma, nó 233:2356):
// eixo horizontal com o valor bruto menos o branco, vertical com a OD do
// espectrofotômetro. O branco não é ponto da reta e não aparece. Os pontos
// são os padrões gravados; o vazado é o padrão sendo lido, com o valor ao
// vivo. A linha laranja é a versão nova e a tracejada, a versão em uso.

import { useState } from "react";
import { DicaDoGrafico } from "@/compartilhado/componentes/DicaDoGrafico";
import * as formatar from "@/compartilhado/formatar";
import estilos from "./NovaCalibracao.module.css";

export interface PontoDaCurva {
  nome: string;
  /** bruto − branco */
  x: number;
  od: number;
}

interface Props {
  pontos: PontoDaCurva[];
  /** Padrão sendo lido agora, desenhado vazado. */
  aoVivo: PontoDaCurva | null;
  branco: number | null;
  /** Retas em od = a · (bruto − branco) + b. */
  nova: { a: number; b: number } | null;
  atual: { a: number; b: number; versao: number } | null;
}

const LARGURA = 1000;
const ALTURA = 600;

export function GraficoDaCurva({ pontos, aoVivo, branco, nova, atual }: Props) {
  const [apontado, setApontado] = useState<string | null>(null);
  const todos = aoVivo ? [...pontos, aoVivo] : pontos;
  // Escala com folga: bruto em múltiplos de 400, OD em múltiplos de 0,2.
  const maxX = Math.max(1200, Math.ceil(Math.max(0, ...todos.map((p) => p.x)) / 400) * 400);
  const maxY = Math.max(0.6, Math.ceil(Math.max(0, ...todos.map((p) => p.od)) / 0.2 - 1e-9) * 0.2);
  const passoX = maxX > 4000 ? 2000 : maxX > 2000 ? 1000 : 400;
  const marcasX = Array.from({ length: Math.floor(maxX / passoX) + 1 }, (_, i) => i * passoX);
  const passoY = maxY > 2 ? 0.5 : 0.2;
  const marcasY = Array.from({ length: Math.floor(maxY / passoY + 1e-9) + 1 }, (_, i) => i * passoY);
  const px = (x: number) => (Math.max(x, 0) / maxX) * 100;
  const py = (od: number) => 100 - (Math.min(Math.max(od, 0), maxY) / maxY) * 100;
  const linha = (reta: { a: number; b: number }) => {
    // Trecho da reta dentro do gráfico.
    const x1 = Math.max(0, (0 - reta.b) / reta.a);
    const x2 = Math.min(maxX, (maxY - reta.b) / reta.a);
    return { x1: (px(x1) / 100) * LARGURA, y1: (py(reta.a * x1 + reta.b) / 100) * ALTURA, x2: (px(x2) / 100) * LARGURA, y2: (py(reta.a * x2 + reta.b) / 100) * ALTURA };
  };
  const ponto = todos.find((p) => p.nome === apontado);

  return (
    <div className={estilos.grafico} role="img" aria-label={`Curva de calibração com ${pontos.length} padrões`}>
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
            className={p === aoVivo ? estilos.pontoEditando : estilos.pontoCurva}
            style={{ left: `${px(p.x)}%`, top: `${py(p.od)}%` }}
            onMouseEnter={() => setApontado(p.nome)}
            onMouseLeave={() => setApontado(null)}
          />
        ))}
        {ponto && (
          <DicaDoGrafico
            titulo={ponto === aoVivo ? `${ponto.nome} · ao vivo` : ponto.nome}
            linhas={[
              { rotulo: "OD de referência", valor: formatar.decimal(ponto.od, 3), forte: true },
              ...(branco !== null ? [{ rotulo: "Bruto", valor: formatar.inteiro(ponto.x + branco) }] : []),
              { rotulo: "Sem o branco", valor: formatar.inteiro(ponto.x) },
              ...(nova ? [{ rotulo: "Versão nova calcula", valor: formatar.decimal(nova.a * ponto.x + nova.b, 3) }] : []),
              ...(atual ? [{ rotulo: `Versão ${atual.versao} calcula`, valor: formatar.decimal(atual.a * ponto.x + atual.b, 3) }] : []),
            ]}
            x={px(ponto.x) / 100}
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
