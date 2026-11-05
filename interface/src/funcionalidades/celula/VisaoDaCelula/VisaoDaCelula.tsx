// Telas "Célula c08 · visão da célula" e "Célula c04 · livre" do Figma (nós
// 105:1629 e 153:1633). Cada painel fica num arquivo desta pasta; aqui só a
// montagem da tela. Sem experimento, Atribuir experimento entra no lugar dos
// Comandos e o Histórico da célula no lugar de Tirar do experimento.

import { useState } from "react";
import { useParams } from "react-router-dom";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CabecalhoDaCelula, CarregandoCelula } from "@/funcionalidades/celula/CabecalhoDaCelula";
import type { Periodo } from "@/funcionalidades/celula/modelo";
import { useCelula } from "@/funcionalidades/celula/useCelula";
import { Alertas } from "./Alertas";
import { AtribuirExperimento } from "./AtribuirExperimento";
import { CelulaDeCultivo } from "./CelulaDeCultivo";
import { Comandos } from "./Comandos";
import { FaixaDeStatus } from "./FaixaDeStatus";
import { HistoricoDaCelula } from "./HistoricoDaCelula";
import { InformacoesDaPlaca } from "./InformacoesDaPlaca";
import { Leituras } from "./Leituras";
import { Parametros } from "./Parametros";
import { TirarDoExperimento } from "./TirarDoExperimento";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

export function VisaoDaCelula() {
  const { id = "" } = useParams();
  const [periodo, setPeriodo] = useState<Periodo>("24h");
  const { dados, erro, recarregar } = useCelula(id, periodo);

  if (!dados) return <CarregandoCelula id={id} aba="Visão da célula" erro={erro} />;

  const { experimento } = dados;

  return (
    <div className={comum.tela}>
      <CabecalhoDaCelula
        id={id}
        aba="Visão da célula"
        subtitulo="Acompanhe a célula em tempo real: medidas, comando de temperatura e tendências do experimento."
        erro={erro}
        acao={
          experimento ? (
            <Botao para={`/experimentos/${encodeURIComponent(experimento.codigo)}`}>Abrir experimento</Botao>
          ) : (
            <Botao para="/experimentos">Ver experimentos</Botao>
          )
        }
      />

      <FaixaDeStatus dados={dados} />

      <div className={estilos.principal}>
        <Parametros dados={dados} />
        <CelulaDeCultivo dados={dados} />
        {/* key: ao trocar de célula, os campos voltam aos valores dela. */}
        {experimento === null ? (
          <AtribuirExperimento key={id} dados={dados} />
        ) : (
          <Comandos key={id} dados={dados} aoEnviar={recarregar} />
        )}
        <div className={estilos.colunaAlertas}>
          <Alertas dados={dados} />
          <InformacoesDaPlaca dados={dados} />
        </div>
      </div>

      <div className={experimento !== undefined ? estilos.linhaLeituras : undefined}>
        <Leituras dados={dados} periodo={periodo} aoMudarPeriodo={setPeriodo} />
        {experimento ? <TirarDoExperimento experimento={experimento} /> : experimento === null && <HistoricoDaCelula dados={dados} />}
      </div>
    </div>
  );
}
