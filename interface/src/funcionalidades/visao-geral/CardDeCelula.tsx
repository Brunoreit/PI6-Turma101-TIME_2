// Componente "Card de célula" do Figma (nó 3:57). Estados: online, com
// alerta, offline e livre (sem experimento, combinável com os outros).
// O card inteiro é um link para a Visão da célula.

import { Link } from "react-router-dom";
import * as formatar from "@/compartilhado/formatar";
import { nomeDaCelula, type CelulaResumo, type Experimento } from "@/dados/modelo";
import estilos from "./CardDeCelula.module.css";
import { HistoricoOd } from "./HistoricoOd";
import { SeloDeStatus } from "@/compartilhado/componentes/SeloDeStatus";

function descricaoDoExperimento(experimento: Experimento): string {
  const partes = [experimento.nome];
  if (experimento.alvoC !== null) partes.push(`${formatar.decimal(experimento.alvoC, 0)} °C`);
  // Experimento de outra pessoa: a API não conta o nome nem o prazo.
  if (experimento.dia > 0) partes.push(experimento.duracaoDias ? `dia ${experimento.dia} de ${experimento.duracaoDias}` : `dia ${experimento.dia}`);
  return partes.join(" · ");
}

export function CardDeCelula({ celula, agora }: { celula: CelulaResumo; agora: Date }) {
  const offline = celula.situacao === "offline";
  const classes = [estilos.card, estilos[celula.situacao]].join(" ");

  let subtitulo: string;
  if (celula.experimento === null) subtitulo = "Livre · sem experimento";
  else if (celula.experimento === undefined) subtitulo = "Experimento não informado";
  else subtitulo = descricaoDoExperimento(celula.experimento);

  // Offline, a última temperatura não vale mais: o aquecimento pode ter parado.
  const temperatura =
    offline || celula.temperaturaC === null ? "—" : formatar.temperatura(celula.temperaturaC);

  return (
    <Link to={`/celulas/${celula.id}`} className={classes} aria-label={`Abrir célula ${nomeDaCelula(celula)}`}>
      <div className={estilos.identificacao}>
        <div className={estilos.topo}>
          <h3 className={celula.apelido ? `${estilos.id} ${estilos.apelido}` : estilos.id}>
            {nomeDaCelula(celula)}
            {celula.apelido && <span className={estilos.idDaPlaca}>{celula.id}</span>}
          </h3>
          <SeloDeStatus
            situacao={celula.situacao}
            rotulo={
              celula.situacao === "alerta" && celula.alertasAbertos && celula.alertasAbertos > 1
                ? `${celula.alertasAbertos} alertas`
                : undefined
            }
          />
        </div>
        <p className={celula.experimento === null ? estilos.livre : estilos.subtitulo}>{subtitulo}</p>
      </div>

      <div className={estilos.medidas}>
        <div className={estilos.medida}>
          <span className={estilos.rotulo}>Temperatura</span>
          <span className={celula.temperaturaEmAlerta && !offline ? estilos.valorEmAlerta : estilos.valor}>
            {temperatura}
          </span>
        </div>
        <div className={estilos.medida}>
          <span className={estilos.rotulo}>pH</span>
          <span className={estilos.valor}>{celula.ph === null ? "—" : formatar.decimal(celula.ph, 2)}</span>
        </div>
      </div>

      <p className={estilos.od}>
        <span className={estilos.odValor}>{celula.od === null ? "—" : formatar.decimal(celula.od, 3)}</span>
        {!offline && <span className={estilos.odRotulo}>Densidade óptica</span>}
      </p>

      <div className={estilos.historico}>
        <HistoricoOd valores={celula.historicoOd} apagado={offline} agora={agora} />
        <div className={estilos.rodape}>
          <span>OD nas últimas 24 h</span>
          <span>{celula.ultimaLeituraEm ? formatar.tempoDecorrido(celula.ultimaLeituraEm, agora) : "sem leituras"}</span>
        </div>
      </div>
    </Link>
  );
}
