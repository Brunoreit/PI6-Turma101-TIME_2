// Componente "Selo de status" do Figma (nó 3:54). Além dos estados da
// célula, tem o "espera" laranja, usado no Stand by dos experimentos, e o
// "cancelado" vermelho, dos experimentos cancelados (não está no Figma).

import pontoMarca from "@/assets/icones/ponto-marca.svg";
import pontoAlerta from "@/assets/icones/ponto-alerta.svg";
import pontoOffline from "@/assets/icones/ponto-offline.svg";
import pontoOnline from "@/assets/icones/ponto-online.svg";
import type { SituacaoCelula } from "@/dados/modelo";
import estilos from "./SeloDeStatus.module.css";

type Variante = SituacaoCelula | "espera" | "cancelado";

const VARIANTES: Record<Variante, { rotulo: string; ponto: string }> = {
  online: { rotulo: "Online", ponto: pontoOnline },
  alerta: { rotulo: "Com alerta", ponto: pontoAlerta },
  offline: { rotulo: "Offline", ponto: pontoOffline },
  espera: { rotulo: "Stand by", ponto: pontoMarca },
  cancelado: { rotulo: "Cancelado", ponto: pontoAlerta },
};

/** `rotulo` troca o texto padrão, como o "Em operação" da tela da célula. */
export function SeloDeStatus({ situacao, rotulo }: { situacao: Variante; rotulo?: string }) {
  const variante = VARIANTES[situacao];
  return (
    <span className={`${estilos.selo} ${estilos[situacao]}`}>
      <img className={estilos.ponto} src={variante.ponto} width={6} height={6} alt="" />
      {rotulo ?? variante.rotulo}
    </span>
  );
}
