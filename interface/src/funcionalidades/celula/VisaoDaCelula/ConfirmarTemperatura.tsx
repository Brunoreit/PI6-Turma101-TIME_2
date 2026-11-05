// "modal Confirmar temperatura" do Figma (nó 148:1644). Aparece ao clicar em
// Aplicar nos Comandos, antes de o pedido ir para a placa.

import { useEffect } from "react";
import iconeEnviar from "@/assets/icones/enviar.svg";
import iconeFechar from "@/assets/icones/fechar-20.svg";
import iconeFrasco from "@/assets/icones/frasco-16.svg";
import iconeHistorico from "@/assets/icones/historico-16.svg";
import iconeSeta from "@/assets/icones/seta-para.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import * as formatar from "@/compartilhado/formatar";
import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { useSessao } from "@/sessao/SessaoProvider";
import estilos from "./ConfirmarTemperatura.module.css";

interface Props {
  dados: DetalheDaCelula;
  atual: number | null;
  novo: number;
  enviando: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}

export function ConfirmarTemperatura({ dados, atual, novo, enviando, onConfirmar, onCancelar }: Props) {
  const { usuario } = useSessao();
  const { buscar } = useExperimentos();
  const { experimento } = dados;
  const outras = experimento ? (buscar(experimento.codigo)?.celulas.filter((c) => c.id !== dados.id).length ?? 0) : 0;
  const agora = new Date();

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onCancelar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onCancelar]);

  return (
    <div className={estilos.fundo} onMouseDown={(e) => e.target === e.currentTarget && onCancelar()}>
      <div className={estilos.modal} role="dialog" aria-modal="true" aria-labelledby="titulo-confirmar">
        <div className={estilos.cabecalho}>
          <div className={estilos.textos}>
            <h2 id="titulo-confirmar">Confirmar nova temperatura</h2>
            <p>{experimento ? `${dados.id} · ${experimento.codigo} · ${experimento.nome}` : `${dados.id} · sem experimento`}</p>
          </div>
          <button type="button" className={estilos.fechar} onClick={onCancelar} aria-label="Fechar">
            <img src={iconeFechar} width={20} height={20} alt="" />
          </button>
        </div>

        <div className={estilos.dePara}>
          <div className={estilos.atual}>
            <span>Atual</span>
            <strong>{atual === null ? "—" : formatar.temperatura(atual)}</strong>
          </div>
          <img src={iconeSeta} width={22} height={22} alt="para" />
          <div className={estilos.novo}>
            <span>Novo alvo</span>
            <strong>{formatar.temperatura(novo)}</strong>
          </div>
        </div>

        <ul className={estilos.itens}>
          <li>
            <img src={iconeEnviar} width={16} height={16} alt="" />
            O pedido vai para a placa agora. Você acompanha em Solicitado, Recebido, Aplicado e Atingido.
          </li>
          {experimento && (
            <li>
              <img src={iconeFrasco} width={16} height={16} alt="" />
              Vale só para a {dados.id}.
              {outras > 0 && ` As outras ${outras} células do ${experimento.codigo} continuam em ${atual === null ? "seu alvo" : formatar.temperatura(atual)}.`}
            </li>
          )}
          <li>
            <img src={iconeHistorico} width={16} height={16} alt="" />
            Fica no histórico {experimento ? "do experimento" : "da célula"}: {usuario?.nome ?? "você"} mudou{" "}
            {atual === null ? "" : `de ${formatar.decimal(atual, 1)} `}para {formatar.temperatura(novo)} em {formatar.diaMes(agora)} às{" "}
            {agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
          </li>
        </ul>

        <div className={estilos.botoes}>
          <Botao onClick={onCancelar}>Cancelar</Botao>
          <Botao tipo="primario" ocupado={enviando} onClick={onConfirmar}>
            Confirmar {formatar.temperatura(novo)}
          </Botao>
        </div>
      </div>
    </div>
  );
}
