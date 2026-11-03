// Painel de alertas abertos da célula.

import { Link } from "react-router-dom";
import iconeCheckCirculo from "@/assets/icones/check-circulo.svg";
import iconeSino from "@/assets/icones/sino.svg";
import * as formatar from "@/compartilhado/formatar";
import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

export function Alertas({ dados }: { dados: DetalheDaCelula }) {
  const { experimento } = dados;
  return (
    <section className={estilos.painelEstreito} aria-labelledby="titulo-alertas">
      <div className={comum.painelTituloIcone}>
        <img src={iconeSino} width={16} height={16} alt="" />
        <h2 id="titulo-alertas" className={comum.painelNome}>Alertas</h2>
        <Link to="/alertas" className={comum.link}>Ver todos →</Link>
      </div>
      {dados.alertas.length === 0 ? (
        <div className={estilos.semAlertas}>
          <img src={iconeCheckCirculo} width={24} height={24} alt="" />
          <p className={estilos.semAlertasTitulo}>Nenhum alerta ativo</p>
          <p className={estilos.semAlertasDetalhe}>
            {experimento
              ? `A ${dados.id} está dentro das faixas do ${experimento.codigo}.`
              : `A ${dados.id} não tem alertas abertos.`}
          </p>
        </div>
      ) : (
        <ul className={estilos.listaAlertas}>
          {dados.alertas.map((alerta) => (
            <li key={alerta.id} className={estilos.alerta}>
              <span className={estilos.alertaTitulo}>{alerta.titulo}</span>
              <span className={estilos.alertaMensagem}>{alerta.mensagem}</span>
              <span className={estilos.alertaTempo}>{formatar.tempoDecorrido(alerta.abertoEm, dados.atualizadoEm)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
