// Painel "Parâmetros da célula": temperatura, OD e pH com barras.

import iconeFrasco from "@/assets/icones/frasco.svg";
import iconeGota from "@/assets/icones/gota.svg";
import iconeTermometro from "@/assets/icones/termometro.svg";
import * as formatar from "@/compartilhado/formatar";
import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import { faixaDePh, temperaturaAlvo, traco } from "./calculos";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

interface Medida {
  icone: string;
  nome: string;
  etiqueta: { texto: string; ativa: boolean };
  valor: string;
  unidade?: string;
  detalhe: string;
  /** Quanto da barra fica preenchido, de 0 a 1. */
  fracao: number | null;
  corDaBarra: "marca" | "neutra" | "ok" | "alerta";
}

const entre = (valor: number, minimo: number, maximo: number) =>
  Math.min(Math.max((valor - minimo) / (maximo - minimo), 0), 1);

function CardDeMedida({ medida }: { medida: Medida }) {
  return (
    <div className={estilos.medida}>
      <div className={estilos.medidaTopo}>
        <img src={medida.icone} width={18} height={18} alt="" />
        <span className={estilos.medidaNome}>{medida.nome}</span>
        <span className={medida.etiqueta.ativa ? estilos.etiquetaAtiva : estilos.etiquetaNeutra}>
          {medida.etiqueta.texto}
        </span>
      </div>
      <p className={estilos.medidaValor}>
        <span className={estilos.medidaNumero}>{medida.valor}</span>
        {medida.unidade && <span className={estilos.medidaUnidade}>{medida.unidade}</span>}
      </p>
      <p className={estilos.medidaDetalhe}>{medida.detalhe}</p>
      <div className={estilos.barra}>
        {medida.fracao !== null && (
          <span className={`${estilos.preenchimento} ${estilos[medida.corDaBarra]}`} style={{ width: `${medida.fracao * 100}%` }} />
        )}
      </div>
    </div>
  );
}

export function Parametros({ dados }: { dados: DetalheDaCelula }) {
  const alvo = temperaturaAlvo(dados);
  const faixa = faixaDePh(dados.experimento);
  const offline = dados.situacao === "offline";
  const phForaDaFaixa = faixa !== null && dados.ph !== null && (dados.ph < faixa[0] || dados.ph > faixa[1]);

  // Escalas das barras: temperatura de 0 a 50 °C, OD de 0 até 0,8 (fim da
  // faixa confiável da calibração) e pH de 4 a 8.
  const medidas: Medida[] = [
    {
      icone: iconeTermometro,
      nome: "Temperatura",
      etiqueta: { texto: offline ? "Sem controle" : alvo === null ? "Sem alvo" : "Controlando", ativa: !offline && alvo !== null },
      valor: traco(dados.temperaturaC, (v) => formatar.decimal(v, 1)),
      unidade: "°C",
      detalhe: alvo === null ? "Sem temperatura alvo" : `Alvo: ${formatar.temperatura(alvo)}`,
      fracao: dados.temperaturaC === null ? null : entre(dados.temperaturaC, 0, 50),
      corDaBarra: "marca",
    },
    {
      icone: iconeFrasco,
      nome: "Densidade óptica",
      etiqueta: { texto: "Só leitura", ativa: false },
      valor: traco(dados.od, (v) => formatar.decimal(v, 3)),
      unidade: "OD",
      detalhe: `Valor bruto: ${traco(dados.odBruto, formatar.inteiro)}`,
      fracao: dados.od === null ? null : entre(dados.od, 0, 0.8),
      corDaBarra: "neutra",
    },
    {
      icone: iconeGota,
      nome: "pH",
      etiqueta: { texto: "Só leitura", ativa: false },
      valor: traco(dados.ph, (v) => formatar.decimal(v, 2)),
      detalhe: faixa
        ? `Referência: ${formatar.decimal(faixa[0], 1)} a ${formatar.decimal(faixa[1], 1)}`
        : "Sem faixa de referência",
      fracao: dados.ph === null ? null : entre(dados.ph, 4, 8),
      corDaBarra: phForaDaFaixa ? "alerta" : "ok",
    },
  ];

  return (
    <section className={estilos.parametros} aria-labelledby="titulo-parametros">
      <h2 id="titulo-parametros" className={comum.painelNome}>Parâmetros da célula</h2>
      {medidas.map((medida) => (
        <CardDeMedida key={medida.nome} medida={medida} />
      ))}
    </section>
  );
}
