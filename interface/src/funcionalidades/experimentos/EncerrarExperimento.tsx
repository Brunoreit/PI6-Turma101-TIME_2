// Modal "Encerrar experimento". Não existe no Figma: segue o desenho do
// CancelarExperimento, mas sem motivo (a API não pede um para encerrar).

import { ModalDeMotivo } from "@/compartilhado/componentes/ModalDeMotivo";
import type { Experimento } from "./modelo";

interface Props {
  experimento: Experimento;
  onConfirmar: () => Promise<void>;
  onFechar: () => void;
}

export function EncerrarExperimento({ experimento, onConfirmar, onFechar }: Props) {
  const abertas = experimento.celulas.filter((c) => !c.fim).length;
  const celulas =
    abertas === 0
      ? "Nenhuma célula está em uso."
      : abertas === 1
        ? "a célula em uso volta a ficar livre."
        : `as ${abertas} células em uso voltam a ficar livres.`;
  return (
    <ModalDeMotivo
      titulo="Encerrar experimento"
      subtitulo={`${experimento.codigo} · ${experimento.nome}`}
      consequencias={
        abertas === 0
          ? `O experimento fica encerrado. ${celulas} As leituras continuam no experimento.`
          : `O experimento fica encerrado e ${celulas} As leituras continuam no experimento.`
      }
      acao="Encerrar experimento"
      onConfirmar={() => onConfirmar()}
      onFechar={onFechar}
    />
  );
}
