// Quadro "Sensor de OD da cXX · ao vivo" da Nova calibração (Figma, nó
// 283:2337, e as telas "· estabilizando" e "· padrão gravado"). Mostra a
// última leitura, o gráfico das últimas 8, o selo Estável ou Estabilizando e
// o "Gravar em", que grava a média da janela no ponto escolhido.

import iconeChip from "@/assets/icones/check-10-verde.svg";
import iconeEstavel from "@/assets/icones/check-12-verde.svg";
import iconeGravado from "@/assets/icones/check-13-verde.svg";
import iconeAoVivo from "@/assets/icones/ponto-ao-vivo-8.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import * as formatar from "@/compartilhado/formatar";
import type { OdAoVivo } from "./aoVivo";
import type { Linha } from "./rascunho";
import { faltamParaEstabilizar } from "./regressao";
import estilos from "./NovaCalibracao.module.css";

/** "Branco", "P1"... */
export const nomeDa = (rotulo: string) => (rotulo === "branco" ? "Branco" : rotulo);

/** "8 s", "1 min e 20 s", "3 min". */
export function emSegundos(total: number): string {
  const s = Math.max(0, Math.round(total));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  const resto = s % 60;
  return resto ? `${min} min e ${resto} s` : `${min} min`;
}

const porcento = (fracao: number) => `${formatar.decimal(fracao * 100, 1)}%`;

interface Props {
  idCelula: string;
  aoVivo: OdAoVivo | null;
  erro: string | null;
  agora: Date;
  linhas: Linha[];
  selecionada: string;
  onSelecionar: (rotulo: string) => void;
  onGravar: () => void;
  /** "P3 gravado: 1.102, média de 6 leituras (seq 56.235 a 56.240)." */
  confirmacao: string | null;
  /** A janela ainda tem leituras do ponto que acabou de ser gravado. */
  esperandoNovaLeitura: boolean;
}

function GraficoDasUltimas({ aoVivo }: { aoVivo: OdAoVivo }) {
  const { recentes, janela } = aoVivo;
  const L = 210;
  const A = 56;
  if (recentes.length === 0) return <div className={estilos.miniGrafico} aria-hidden />;
  const valores = recentes.map((l) => l.bruto);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const folga = Math.max((max - min) * 0.15, Math.abs(max) * 0.002, 1);
  const y = (v: number) => A - 6 - ((v - (min - folga)) / (max - min + 2 * folga)) * (A - 12);
  const x = (i: number) => 4 + (i / 7) * (L - 8);
  const deslocamento = 8 - recentes.length;
  const naJanela = (seq: number) => janela.seqInicio !== null && janela.seqFim !== null && seq >= janela.seqInicio && seq <= janela.seqFim;
  const daJanela = recentes.map((l, i) => ({ ...l, i: i + deslocamento })).filter((l) => naJanela(l.seq));
  return (
    <svg className={estilos.miniGrafico} width={L} height={A} viewBox={`0 0 ${L} ${A}`} aria-hidden>
      {janela.estavel && daJanela.length > 1 && janela.minimo !== null && janela.maximo !== null && (
        <rect
          className={estilos.faixaEstavel}
          x={x(daJanela[0].i) - 4}
          width={x(daJanela[daJanela.length - 1].i) - x(daJanela[0].i) + 8}
          y={y(janela.maximo) - 4}
          height={y(janela.minimo) - y(janela.maximo) + 8}
          rx={3}
        />
      )}
      <polyline className={estilos.miniLinha} points={recentes.map((l, i) => `${x(i + deslocamento)},${y(l.bruto)}`).join(" ")} />
      {recentes.map((l, i) => (
        <circle
          key={l.seq}
          className={naJanela(l.seq) ? estilos.miniPonto : estilos.miniPontoAntigo}
          cx={x(i + deslocamento)}
          cy={y(l.bruto)}
          r={2.5}
        />
      ))}
    </svg>
  );
}

function Estabilidade({ aoVivo, esperando, proximo }: { aoVivo: OdAoVivo; esperando: boolean; proximo: string }) {
  const { janela, recentes, variacaoMax } = aoVivo;
  const intervalo = janela.intervaloMedioS;
  if (esperando) {
    return (
      <div className={estilos.estabilidade}>
        <span className={estilos.esperando}>Esperando o {proximo}</span>
        <p>Troque o frasco pelo padrão {proximo}. A gravação libera quando a nova leitura estabilizar.</p>
      </div>
    );
  }
  if (janela.estavel && janela.minimo !== null && janela.maximo !== null && janela.media !== null) {
    return (
      <div className={estilos.estabilidade}>
        <span className={estilos.seloEstavel}>
          <img src={iconeEstavel} width={12} height={12} alt="" />
          Estável
        </span>
        <p>
          As últimas {janela.n} leituras variam de {formatar.inteiro(janela.minimo)} a {formatar.inteiro(janela.maximo)} (±
          {porcento((janela.desvio ?? 0) / janela.media)}). Média: {formatar.inteiro(janela.media)}.
        </p>
      </div>
    );
  }
  const valores = recentes.map((l) => l.bruto);
  const faltam = Math.max(janela.faltam, faltamParaEstabilizar(valores, janela.nEsperado, variacaoMax));
  const tempo = intervalo ? `, cerca de ${emSegundos(faltam * intervalo)}` : "";
  const ultima = valores.length >= 2 ? valores[valores.length - 1] - valores[valores.length - 2] : null;
  let movimento = "";
  if (janela.faltam > 0) {
    movimento = `Só ${janela.n === 1 ? "1 leitura" : `${janela.n} leituras`} até agora. `;
  } else if (ultima !== null && Math.round(ultima) !== 0) {
    const sinal = ultima > 0 ? "+" : "−";
    movimento = `A leitura ainda está ${ultima > 0 ? "subindo" : "descendo"}: ${sinal}${formatar.inteiro(Math.abs(ultima))} na última. `;
  } else {
    movimento = "A leitura ainda está oscilando. ";
  }
  return (
    <div className={estilos.estabilidade}>
      <span className={estilos.seloEstabilizando}>Estabilizando</span>
      <p>
        {movimento}
        {faltam === 1 ? "Falta 1 leitura estável" : `Faltam ${faltam} leituras estáveis`}
        {tempo}.
      </p>
    </div>
  );
}

export function LeituraAoVivo({
  idCelula, aoVivo, erro, agora, linhas, selecionada, onSelecionar, onGravar, confirmacao, esperandoNovaLeitura,
}: Props) {
  const ultima = aoVivo?.ultima ?? null;
  const janela = aoVivo?.janela;
  const intervalo = janela?.intervaloMedioS ?? null;
  const nome = nomeDa(selecionada);
  const desde = ultima ? (agora.getTime() - ultima.medidaEm.getTime()) / 1000 : null;
  const podeGravar = !!janela?.estavel && janela.media !== null && !esperandoNovaLeitura;

  let ritmo = "";
  if (intervalo !== null) {
    ritmo = `uma leitura a cada ${emSegundos(intervalo)}`;
    if (desde !== null) {
      const falta = intervalo - desde;
      ritmo += falta >= 1 ? ` · próxima em ${emSegundos(falta)}` : " · próxima a qualquer momento";
    }
  }

  let rodape: string;
  if (esperandoNovaLeitura) {
    rodape = 'Escolha outra linha em "Gravar em" para regravar um padrão. O valor anterior fica no histórico.';
  } else if (podeGravar && janela && janela.seqInicio !== null && janela.seqFim !== null) {
    rodape = `Grava a média das últimas ${janela.n} leituras (seq ${formatar.inteiro(janela.seqInicio)} a ${formatar.inteiro(
      janela.seqFim)}). Cada leitura continua guardada como veio do sensor.`;
  } else {
    const n = janela?.nEsperado ?? 6;
    const limite = aoVivo ? porcento(aoVivo.variacaoMax).replace(",0%", "%") : "1%";
    rodape = `O botão libera quando as últimas ${n} leituras variarem menos de ${limite}. Se não quiser esperar, digite o valor na tabela.`;
  }

  return (
    <section className={estilos.aoVivo} aria-label={`Sensor de OD da ${idCelula} ao vivo`}>
      <div className={estilos.aoVivoTopo}>
        <img src={iconeAoVivo} width={8} height={8} alt="" />
        <strong>Sensor de OD da {idCelula} · ao vivo</strong>
        <span>{ritmo}</span>
      </div>

      {confirmacao && (
        <p className={estilos.gravadoAgora} role="status">
          <img src={iconeGravado} width={13} height={13} alt="" />
          {confirmacao}
        </p>
      )}

      {erro && !aoVivo ? (
        <p className={estilos.erro} role="alert">{erro}</p>
      ) : !aoVivo ? (
        <p className={estilos.ajuda}>Buscando a leitura do sensor…</p>
      ) : !ultima ? (
        <p className={estilos.ajuda}>A {idCelula} ainda não mandou leituras de OD. Elas aparecem aqui assim que chegarem.</p>
      ) : (
        <div className={estilos.aoVivoValores}>
          <div className={estilos.valorAgora} aria-live="polite">
            <span>
              <strong>{formatar.inteiro(ultima.bruto)}</strong> bruto
            </span>
            <span className={estilos.valorAgoraSeq}>
              seq {formatar.inteiro(ultima.seq)} · há {emSegundos(desde ?? 0)}
            </span>
          </div>
          <GraficoDasUltimas aoVivo={aoVivo} />
          <Estabilidade aoVivo={aoVivo} esperando={esperandoNovaLeitura} proximo={nome} />
        </div>
      )}
      {erro && aoVivo && <p className={estilos.erro} role="alert">{erro} Mostrando a última leitura recebida.</p>}

      <div className={estilos.divisoria} />

      <div className={estilos.gravar}>
        <span id="rotulo-gravar-em">Gravar em</span>
        <div className={estilos.chips} role="radiogroup" aria-labelledby="rotulo-gravar-em">
          {linhas.map((l) => (
            <button
              key={l.rotulo}
              type="button"
              role="radio"
              aria-checked={l.rotulo === selecionada}
              className={l.rotulo === selecionada ? estilos.chipAtivo : l.gravado ? estilos.chipGravado : estilos.chip}
              onClick={() => onSelecionar(l.rotulo)}
            >
              {l.gravado && l.rotulo !== selecionada && <img src={iconeChip} width={10} height={10} alt="gravado:" />}
              {nomeDa(l.rotulo)}
            </button>
          ))}
        </div>
        <span className={estilos.espaco} />
        {podeGravar && janela?.media != null ? (
          <Botao tipo="primario" onClick={onGravar}>
            Gravar {formatar.inteiro(janela.media)} no {nome}
          </Botao>
        ) : (
          <span className={estilos.esmaecido}>
            <Botao tipo="primario" indisponivel={esperandoNovaLeitura ? "Espere a leitura do padrão novo estabilizar." : "Libera quando a leitura estabilizar."}>
              Gravar no {nome}
            </Botao>
          </span>
        )}
      </div>
      <p className={estilos.rodapeAoVivo}>{rodape}</p>
    </section>
  );
}
