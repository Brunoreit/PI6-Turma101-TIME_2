// Modal "Cancelar experimento". Não existe no Figma: segue o desenho do modal
// Confirmar temperatura. O motivo é obrigatório e a API guarda em
// metadados.motivo_cancelamento e nos cultivos cancelados junto.

import { useEffect, useState } from "react";
import iconeFechar from "@/assets/icones/fechar-20.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import estilos from "./CancelarExperimento.module.css";
import type { Experimento } from "./modelo";

interface Props {
  experimento: Experimento;
  onConfirmar: (motivo: string) => Promise<void>;
  onFechar: () => void;
}

export function CancelarExperimento({ experimento, onConfirmar, onFechar }: Props) {
  const [motivo, setMotivo] = useState("");
  const [faltaMotivo, setFaltaMotivo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const abertas = experimento.celulas.filter((c) => !c.fim).length;

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  async function confirmar() {
    if (enviando) return;
    if (!motivo.trim()) return setFaltaMotivo(true);
    setEnviando(true);
    setErro(null);
    try {
      await onConfirmar(motivo.trim());
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setEnviando(false);
    }
  }

  return (
    <div className={estilos.fundo} onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={estilos.modal} role="dialog" aria-modal="true" aria-labelledby="titulo-cancelar">
        <div className={estilos.cabecalho}>
          <div className={estilos.textos}>
            <h2 id="titulo-cancelar">Cancelar experimento</h2>
            <p>
              {experimento.codigo} · {experimento.nome}
            </p>
          </div>
          <button type="button" className={estilos.fechar} onClick={onFechar} aria-label="Fechar">
            <img src={iconeFechar} width={20} height={20} alt="" />
          </button>
        </div>

        <p className={estilos.consequencias}>
          O experimento fica cancelado e não pode ser reaberto.
          {abertas > 0 && ` As ${abertas === 1 ? "célula" : `${abertas} células`} em uso voltam a ficar livres.`} Para
          repetir o estudo, duplique o experimento.
        </p>

        <div className={estilos.campo}>
          <label htmlFor="motivo-cancelamento">Motivo *</label>
          <textarea
            id="motivo-cancelamento"
            value={motivo}
            autoFocus
            aria-invalid={(faltaMotivo && !motivo.trim()) || undefined}
            placeholder="Ex.: contaminação no inóculo"
            onChange={(e) => setMotivo(e.target.value)}
          />
          {faltaMotivo && !motivo.trim() ? (
            <span className={estilos.erro}>Escreva o motivo do cancelamento.</span>
          ) : (
            <span className={estilos.ajuda}>Fica registrado no experimento.</span>
          )}
        </div>

        {erro && (
          <p className={estilos.erro} role="alert">
            {erro}
          </p>
        )}

        <div className={estilos.botoes}>
          <Botao onClick={onFechar}>Voltar</Botao>
          <Botao tipo="perigo" ocupado={enviando} onClick={confirmar}>
            {enviando ? "Cancelando..." : "Cancelar experimento"}
          </Botao>
        </div>
      </div>
    </div>
  );
}
