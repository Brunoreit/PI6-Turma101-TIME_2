// Caixa de seleção do Figma: quadrado laranja com o check escuro quando
// marcada, borda cinza quando não. Usada no Login, nos Alertas e no Exportar.

import type { ReactNode } from "react";
import estilos from "./CaixaDeSelecao.module.css";

interface Props {
  children: ReactNode;
  marcada: boolean;
  onChange?: (marcada: boolean) => void;
  desabilitada?: boolean;
  /** Explica por que a opção está desabilitada. */
  titulo?: string;
}

export function CaixaDeSelecao({ children, marcada, onChange, desabilitada = false, titulo }: Props) {
  return (
    <label className={desabilitada && !marcada ? estilos.indisponivel : estilos.opcao} title={titulo}>
      <input
        type="checkbox"
        className={estilos.caixa}
        checked={marcada}
        disabled={desabilitada}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      {children}
    </label>
  );
}
