// Painel "Leituras": gráficos de temperatura, OD e pH por período.

import { GraficoDeLinha } from "@/compartilhado/componentes/GraficoDeLinha";
import * as formatar from "@/compartilhado/formatar";
import type { DetalheDaCelula, ExperimentoDaCelula, Periodo } from "@/funcionalidades/celula/modelo";
import { faixaDePh, temperaturaAlvo, traco } from "./calculos";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

const PERIODOS: { valor: Periodo; rotulo: string; media: string }[] = [
  { valor: "6h", rotulo: "6 h", media: "de cada 15 min" },
  { valor: "24h", rotulo: "24 h", media: "de cada hora" },
  { valor: "7d", rotulo: "7 dias", media: "de cada 6 h" },
  { valor: "experimento", rotulo: "Experimento", media: "de cada dia" },
];

function rotulosDoTempo(periodo: Periodo, experimento: ExperimentoDaCelula | null | undefined): [string, string, string] {
  switch (periodo) {
    case "6h":
      return ["há 6 h", "há 3 h", "agora"];
    case "24h":
      return ["há 24 h", "há 12 h", "agora"];
    case "7d":
      return ["há 7 dias", "há 3,5 dias", "agora"];
    case "experimento":
      return ["dia 1", `dia ${Math.max(1, Math.round((experimento?.dia ?? 2) / 2))}`, "agora"];
  }
}

const HORA = 3_600_000;

/** Quanto tempo o gráfico cobre, até a última atualização. */
function duracaoDoPeriodo(periodo: Periodo, experimento: ExperimentoDaCelula | null | undefined): number {
  switch (periodo) {
    case "6h":
      return 6 * HORA;
    case "24h":
      return 24 * HORA;
    case "7d":
      return 7 * 24 * HORA;
    case "experimento":
      return Math.max(1, experimento?.dia ?? 1) * 24 * HORA;
  }
}

/** Escala do eixo vertical com três marcas redondas: múltiplos de `passo`
 *  que cobrem os valores, com a marca do meio também redonda. */
function escala(valores: (number | null)[], passo: number, extras: number[]) {
  const todos = [...valores.filter((v): v is number => v !== null), ...extras];
  if (todos.length === 0) return { minimo: 0, maximo: 2 * passo, marcas: [0, passo, 2 * passo] };
  let baixo = Math.floor(Math.min(...todos) / passo + 1e-9);
  let alto = Math.ceil(Math.max(...todos) / passo - 1e-9);
  if (alto === baixo) {
    baixo -= 1;
    alto += 1;
  }
  if ((alto - baixo) % 2 === 1) baixo -= 1;
  const marcas = [baixo, (baixo + alto) / 2, alto].map((k) => k * passo);
  return { minimo: marcas[0], maximo: marcas[2], marcas };
}

export function Leituras({ dados, periodo, aoMudarPeriodo }: { dados: DetalheDaCelula; periodo: Periodo; aoMudarPeriodo: (p: Periodo) => void }) {
  const alvo = temperaturaAlvo(dados);
  const faixa = faixaDePh(dados.experimento);
  const tempo = rotulosDoTempo(periodo, dados.experimento);
  const { media } = PERIODOS.find((p) => p.valor === periodo)!;
  const { series } = dados;
  const duracao = duracaoDoPeriodo(periodo, dados.experimento);
  // Ponto i de n: os pontos se espalham igualmente pelo período, o último é agora.
  const rotuloDoPonto = (n: number) => (i: number) => {
    const fim = dados.atualizadoEm.getTime();
    const t = new Date(n > 1 ? fim - (duracao * (n - 1 - i)) / (n - 1) : fim);
    return i === n - 1 ? `agora · ${formatar.diaHora(t)}` : `média · ${formatar.diaHora(t)}`;
  };

  const graficos = [
    {
      nome: "Temperatura",
      atual: traco(dados.temperaturaC, formatar.temperatura),
      valores: series.temperatura,
      ...escala(series.temperatura, 1, alvo === null ? [] : [alvo]),
      formatarMarca: (v: number) => `${formatar.inteiro(v)} °C`,
      formatarValor: formatar.temperatura,
      referencia: alvo,
      faixa: null,
      nota: alvo === null ? null : "Linha tracejada: temperatura alvo",
    },
    {
      nome: "Densidade óptica",
      atual: traco(dados.od, (v) => formatar.decimal(v, 3)),
      valores: series.od,
      ...escala(series.od, 0.1, []),
      formatarMarca: (v: number) => formatar.decimal(v, 1),
      formatarValor: (v: number) => formatar.decimal(v, 3),
      referencia: null,
      faixa: null,
      nota: null,
    },
    {
      nome: "pH",
      atual: traco(dados.ph, (v) => formatar.decimal(v, 2)),
      valores: series.ph,
      ...escala(series.ph, 0.4, faixa ?? []),
      formatarMarca: (v: number) => formatar.decimal(v, 1),
      formatarValor: (v: number) => formatar.decimal(v, 2),
      referencia: null,
      faixa,
      nota: faixa ? "Faixa verde: pH de referência do experimento" : null,
    },
  ];

  return (
    <section className={comum.painel} aria-labelledby="titulo-leituras">
      <div className={estilos.leiturasTitulo}>
        <div className={comum.painelTitulo}>
          <h2 id="titulo-leituras" className={comum.painelNome}>Leituras</h2>
          <p className={comum.painelDescricao}>
            {dados.periodoLeituraS ? `Uma leitura a cada ${dados.periodoLeituraS} s, mostrada` : "Mostradas"} pela média {media}.
          </p>
        </div>
        <div className={estilos.periodo} role="radiogroup" aria-label="Período">
          {PERIODOS.map((p) => {
            const semExperimento = p.valor === "experimento" && !dados.experimento;
            return (
              <button
                key={p.valor}
                type="button"
                role="radio"
                aria-checked={periodo === p.valor}
                aria-disabled={semExperimento || undefined}
                title={semExperimento ? "A célula não tem experimento informado." : undefined}
                className={periodo === p.valor ? estilos.periodoAtivo : estilos.periodoItem}
                onClick={() => !semExperimento && aoMudarPeriodo(p.valor)}
              >
                {p.rotulo}
              </button>
            );
          })}
        </div>
      </div>

      {graficos.map((grafico) => (
        <div key={grafico.nome} className={estilos.grafico}>
          <div className={estilos.graficoCabecalho}>
            <h3 className={estilos.graficoNome}>{grafico.nome}</h3>
            <span className={estilos.graficoAtual}>{grafico.atual}</span>
          </div>
          <GraficoDeLinha
            valores={grafico.valores}
            minimo={grafico.minimo}
            maximo={grafico.maximo}
            marcas={grafico.marcas}
            formatarMarca={grafico.formatarMarca}
            rotulosTempo={tempo}
            referencia={grafico.referencia}
            faixa={grafico.faixa}
            descricao={`${grafico.nome}, média ${media}, de ${tempo[0]} até agora`}
            nome={grafico.nome}
            formatarValor={grafico.formatarValor}
            rotuloDoPonto={rotuloDoPonto(grafico.valores.length)}
          />
          {grafico.nota && <p className={estilos.graficoNota}>{grafico.nota}</p>}
        </div>
      ))}
    </section>
  );
}
