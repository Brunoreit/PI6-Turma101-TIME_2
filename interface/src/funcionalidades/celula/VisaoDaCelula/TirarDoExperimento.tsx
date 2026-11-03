// Painel para encerrar ou resetar a participação da célula no experimento.

import iconeSemConexao from "@/assets/icones/sem-conexao.svg";
import { Botao, SEM_API } from "@/compartilhado/componentes/Botao";
import type { ExperimentoDaCelula } from "@/funcionalidades/celula/modelo";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

export function TirarDoExperimento({ experimento }: { experimento: ExperimentoDaCelula }) {
  return (
    <section className={comum.painel} aria-labelledby="titulo-tirar">
      <h2 id="titulo-tirar" className={comum.painelNome}>Tirar a célula do experimento</h2>
      <div className={estilos.acoes}>
        <div className={estilos.acao}>
          <p className={comum.painelDescricao}>
            A célula sai do {experimento.codigo} e fica livre. As leituras feitas até agora continuam no experimento.
          </p>
          <Botao indisponivel={SEM_API}>Encerrar participação</Botao>
        </div>
        <div className={estilos.acao}>
          <p className={comum.painelDescricao}>
            Para quando algo deu errado. Cancela a participação e apaga o armazenamento local da placa.
          </p>
          <Botao tipo="perigo" indisponivel={SEM_API}>Resetar célula</Botao>
        </div>
      </div>
      <div className={estilos.perdaDeConexao}>
        <img src={iconeSemConexao} width={16} height={16} alt="" />
        <p>
          Se a célula ficar mais de 24 h sem comunicação, o sistema a retira do experimento sozinho e avisa o responsável.
        </p>
      </div>
    </section>
  );
}
