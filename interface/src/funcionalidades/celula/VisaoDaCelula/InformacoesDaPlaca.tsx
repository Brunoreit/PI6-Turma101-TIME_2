// Painel com modelo, MAC, firmware, calibração e período de leitura.

import iconeInfo from "@/assets/icones/info.svg";
import * as formatar from "@/compartilhado/formatar";
import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

export function InformacoesDaPlaca({ dados }: { dados: DetalheDaCelula }) {
  const { placa, calibracao } = dados;
  const linhas: [string, string][] = [
    ["Modelo", placa.modelo ?? "—"],
    ["MAC", placa.mac ?? "—"],
    ["Firmware", placa.firmware ?? "—"],
    ["Calibração de OD", calibracao ? `v${calibracao.atual.versao} · ${formatar.data(calibracao.atual.criadaEm)}` : "—"],
    ["Período de leitura", dados.periodoLeituraS === null ? "—" : `${dados.periodoLeituraS} s`],
  ];
  return (
    <section className={estilos.informacoes} aria-labelledby="titulo-placa">
      <div className={comum.painelTituloIcone}>
        <img src={iconeInfo} width={16} height={16} alt="" />
        <h2 id="titulo-placa" className={comum.painelNome}>Informações da placa</h2>
      </div>
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className={`${comum.dado} ${estilos.dadoEspacado}`}>
          <span className={comum.dadoRotulo}>{rotulo}</span>
          <span className={comum.dadoValor}>{valor}</span>
        </div>
      ))}
    </section>
  );
}
