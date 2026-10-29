// Gráfico de linha do painel Leituras (Figma, nó 146:1647). A linha é SVG
// esticado na largura do painel; textos e o ponto final são HTML, para não
// deformarem junto.

import estilos from "./GraficoDeLinha.module.css";

const LARGURA = 1000;
const ALTURA = 110;

interface Props {
  valores: (number | null)[];
  minimo: number;
  maximo: number;
  /** Marcas do eixo vertical, de baixo para cima. */
  marcas: number[];
  formatarMarca: (valor: number) => string;
  /** Rótulos do eixo do tempo: início, meio e fim. */
  rotulosTempo: [string, string, string];
  /** Linha tracejada, como a temperatura alvo. */
  referencia?: number | null;
  /** Faixa verde, como o pH de referência. */
  faixa?: [number, number] | null;
  descricao: string;
}

export function GraficoDeLinha({ valores, minimo, maximo, marcas, formatarMarca, rotulosTempo, referencia, faixa, descricao }: Props) {
  const y = (valor: number) => {
    const fracao = (maximo - valor) / (maximo - minimo);
    return Math.min(Math.max(fracao, 0), 1) * ALTURA;
  };
  const x = (i: number) => (valores.length > 1 ? (i / (valores.length - 1)) * LARGURA : LARGURA);

  // Um trecho por sequência de pontos sem buraco.
  let caminho = "";
  let emTrecho = false;
  valores.forEach((valor, i) => {
    if (valor === null) {
      emTrecho = false;
      return;
    }
    caminho += `${emTrecho ? "L" : "M"}${x(i).toFixed(1)} ${y(valor).toFixed(1)}`;
    emTrecho = true;
  });

  let ultimo = valores.length - 1;
  while (ultimo >= 0 && valores[ultimo] === null) ultimo--;

  return (
    <div className={estilos.grafico} role="img" aria-label={descricao}>
      <div className={estilos.area}>
        <svg className={estilos.svg} viewBox={`0 0 ${LARGURA} ${ALTURA}`} preserveAspectRatio="none" aria-hidden>
          {faixa && (
            <rect
              className={estilos.faixa}
              x={0}
              width={LARGURA}
              y={y(faixa[1])}
              height={Math.max(y(faixa[0]) - y(faixa[1]), 0)}
            />
          )}
          {marcas.map((marca) => (
            <line key={marca} className={estilos.grade} x1={0} x2={LARGURA} y1={y(marca)} y2={y(marca)} />
          ))}
          {referencia != null && (
            <line className={estilos.referencia} x1={0} x2={LARGURA} y1={y(referencia)} y2={y(referencia)} />
          )}
          <path className={estilos.linha} d={caminho} />
        </svg>
        {ultimo >= 0 && (
          <span
            className={estilos.ponto}
            style={{ left: `${(x(ultimo) / LARGURA) * 100}%`, top: y(valores[ultimo]!) }}
          />
        )}
        {ultimo < 0 && <span className={estilos.vazio}>Sem leituras neste período</span>}
      </div>

      {marcas.map((marca) => (
        <span key={marca} className={estilos.marca} style={{ top: y(marca) - 7 }}>
          {formatarMarca(marca)}
        </span>
      ))}
      <div className={estilos.tempo}>
        {rotulosTempo.map((rotulo) => (
          <span key={rotulo}>{rotulo}</span>
        ))}
      </div>
    </div>
  );
}
