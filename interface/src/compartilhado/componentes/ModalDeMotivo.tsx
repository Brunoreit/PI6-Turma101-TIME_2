// Modal que pede um motivo obrigatório antes de uma ação sem volta, como
// cancelar um experimento ou resetar uma célula. Não existe no Figma: segue o
// desenho do modal Confirmar temperatura.

import { useEffect, useId, useState, type ReactNode } from "react";
import iconeFechar from "@/assets/icones/fechar-20.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import estilos from "./ModalDeMotivo.module.css";

interface Props {
  titulo: string;
  subtitulo: string;
  /** O que acontece, em vermelho, antes do campo. */
  consequencias: ReactNode;
  placeholder: string;
  /** Texto do botão de confirmar, como "Cancelar experimento". */
  acao: string;
  /** Rejeitar mostra a mensagem do erro no modal, que continua aberto. */
  onConfirmar: (motivo: string) => Promise<void>;
  onFechar: () => void;
}

export function ModalDeMotivo({ titulo, subtitulo, consequencias, placeholder, acao, onConfirmar, onFechar }: Props) {
  const id = useId();
  const [motivo, setMotivo] = useState("");
  const [faltaMotivo, setFaltaMotivo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

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

  const vazio = faltaMotivo && !motivo.trim();

  return (
    <div className={estilos.fundo} onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={estilos.modal} role="dialog" aria-modal="true" aria-labelledby={`${id}-titulo`}>
        <div className={estilos.cabecalho}>
          <div className={estilos.textos}>
            <h2 id={`${id}-titulo`}>{titulo}</h2>
            <p>{subtitulo}</p>
          </div>
          <button type="button" className={estilos.fechar} onClick={onFechar} aria-label="Fechar">
            <img src={iconeFechar} width={20} height={20} alt="" />
          </button>
        </div>

        <p className={estilos.consequencias}>{consequencias}</p>

        <div className={estilos.campo}>
          <label htmlFor={`${id}-motivo`}>Motivo *</label>
          <textarea
            id={`${id}-motivo`}
            value={motivo}
            autoFocus
            aria-invalid={vazio || undefined}
            placeholder={placeholder}
            onChange={(e) => setMotivo(e.target.value)}
          />
          {vazio ? (
            <span className={estilos.erro}>Escreva o motivo.</span>
          ) : (
            <span className={estilos.ajuda}>Fica registrado.</span>
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
            {enviando ? "Enviando..." : acao}
          </Botao>
        </div>
      </div>
    </div>
  );
}
