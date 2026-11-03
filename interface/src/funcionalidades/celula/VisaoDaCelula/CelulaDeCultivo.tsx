// Ilustração do frasco com as etiquetas dos sensores e mangueiras.

import etiquetaAgitacao from "@/assets/icones/etiqueta-agitacao.svg";
import etiquetaDescarte from "@/assets/icones/etiqueta-descarte.svg";
import etiquetaEntrada from "@/assets/icones/etiqueta-entrada.svg";
import etiquetaOd from "@/assets/icones/etiqueta-od.svg";
import etiquetaPh from "@/assets/icones/etiqueta-ph.svg";
import etiquetaTemperatura from "@/assets/icones/etiqueta-temperatura.svg";
import frascoTupa from "@/assets/ilustracoes/frasco-tupa.svg";
import * as formatar from "@/compartilhado/formatar";
import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import { traco } from "./calculos";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

function Etiqueta({ icone, rotulo, valor, x, y }: { icone: string; rotulo: string; valor?: string; x: number; y: number }) {
  return (
    <div className={estilos.etiqueta} style={{ left: x, top: y }}>
      <img src={icone} width={13.3856} height={13.3856} alt="" />
      <div className={estilos.etiquetaTexto}>
        <span className={estilos.etiquetaRotulo}>{rotulo}</span>
        {valor && <span className={estilos.etiquetaValor}>{valor}</span>}
      </div>
    </div>
  );
}

export function CelulaDeCultivo({ dados }: { dados: DetalheDaCelula }) {
  return (
    <section className={estilos.cultivo} aria-labelledby="titulo-cultivo">
      <div className={comum.painelTitulo}>
        <h2 id="titulo-cultivo" className={comum.painelNome}>Célula de cultivo</h2>
        <p className={comum.painelDescricao}>Frasco no Smart Sleeve, com sensores e mangueiras.</p>
      </div>
      {/* Posições do Figma: a ilustração tem tamanho fixo. */}
      <div className={estilos.ilustracao}>
        <img className={estilos.frasco} src={frascoTupa} width={120.889} height={270.222} alt="Frasco da célula com sensores e mangueiras" />
        <Etiqueta icone={etiquetaEntrada} rotulo="Entrada de meio" x={0} y={56.89} />
        <Etiqueta icone={etiquetaDescarte} rotulo="Descarte" x={184.89} y={56.89} />
        <Etiqueta icone={etiquetaOd} rotulo="Sensor de OD" valor={traco(dados.od, (v) => formatar.decimal(v, 3))} x={0} y={199.95} />
        <Etiqueta icone={etiquetaPh} rotulo="Sensor de pH" valor={traco(dados.ph, (v) => formatar.decimal(v, 2))} x={176.52} y={199.95} />
        <Etiqueta icone={etiquetaAgitacao} rotulo="Agitação" valor="em breve" x={172.34} y={281.1} />
        <Etiqueta icone={etiquetaTemperatura} rotulo="Temperatura" valor={traco(dados.temperaturaC, formatar.temperatura)} x={82.82} y={337.15} />
      </div>
    </section>
  );
}
