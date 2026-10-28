// Componente "Selo de status" do Figma (nó 3:54).

import pontoAlerta from "../assets/icones/ponto-alerta.svg";
import pontoOffline from "../assets/icones/ponto-offline.svg";
import pontoOnline from "../assets/icones/ponto-online.svg";
import type { SituacaoCelula } from "../dados/modelo";
import estilos from "./SeloDeStatus.module.css";

const VARIANTES: Record<SituacaoCelula, { rotulo: string; ponto: string }> = {
  online: { rotulo: "Online", ponto: pontoOnline },
  alerta: { rotulo: "Com alerta", ponto: pontoAlerta },
  offline: { rotulo: "Offline", ponto: pontoOffline },
};

export function SeloDeStatus({ situacao }: { situacao: SituacaoCelula }) {
  const { rotulo, ponto } = VARIANTES[situacao];
  return (
    <span className={`${estilos.selo} ${estilos[situacao]}`}>
      <img className={estilos.ponto} src={ponto} width={6} height={6} alt="" />
      {rotulo}
    </span>
  );
}
