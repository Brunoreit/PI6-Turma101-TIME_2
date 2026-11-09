// Modal "Cancelar experimento". Não existe no Figma: segue o desenho do modal
// Confirmar temperatura. O motivo é obrigatório e a API guarda em
// metadados.motivo_cancelamento e nos cultivos cancelados junto.

import { ModalDeMotivo } from "@/compartilhado/componentes/ModalDeMotivo";
import type { Experimento } from "./modelo";

interface Props {
  experimento: Experimento;
  onConfirmar: (motivo: string) => Promise<void>;
  onFechar: () => void;
}

export function CancelarExperimento({ experimento, onConfirmar, onFechar }: Props) {
  const abertas = experimento.celulas.filter((c) => !c.fim).length;
  return (
    <ModalDeMotivo
      titulo="Cancelar experimento"
      subtitulo={`${experimento.codigo} · ${experimento.nome}`}
      consequencias={
        <>
          O experimento fica cancelado e não pode ser reaberto.
          {abertas > 0 && ` ${abertas === 1 ? "A célula em uso volta" : `As ${abertas} células em uso voltam`} a ficar livre${abertas === 1 ? "" : "s"}.`}{" "}
          Para repetir o estudo, duplique o experimento.
        </>
      }
      placeholder="Ex.: contaminação no inóculo"
      acao="Cancelar experimento"
      onConfirmar={onConfirmar}
      onFechar={onFechar}
    />
  );
}
