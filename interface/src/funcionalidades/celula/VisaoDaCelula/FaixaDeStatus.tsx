// Faixa do topo: experimento, dia, temperatura alvo, última leitura e placa.

import { SeloDeStatus } from "@/compartilhado/componentes/SeloDeStatus";
import * as formatar from "@/compartilhado/formatar";
import type { SituacaoCelula } from "@/dados/modelo";
import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import { temperaturaAlvo, traco } from "./calculos";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

const SELO: Record<SituacaoCelula, string> = { online: "Em operação", alerta: "Com alerta", offline: "Offline" };

function Caixa({ rotulo, valor, mono = false }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <div className={estilos.caixa}>
      <span className={estilos.caixaRotulo}>{rotulo}</span>
      <span className={mono ? `${estilos.caixaValor} ${comum.mono}` : estilos.caixaValor}>{valor}</span>
    </div>
  );
}

export function FaixaDeStatus({ dados }: { dados: DetalheDaCelula }) {
  const { experimento, placa } = dados;
  const alvo = temperaturaAlvo(dados);

  let nome = "Experimento não informado pela API";
  let detalhe = "A API ainda não devolve o experimento da célula.";
  if (experimento === null) {
    nome = "Sem experimento";
    detalhe = "A célula está medindo, mas as leituras não entram em nenhum experimento.";
  } else if (experimento?.acesso === null) {
    nome = `${experimento.codigo} · experimento de outra pessoa`;
    detalhe = `Em uso desde ${formatar.data(experimento.naCelulaDesde)}, num experimento que não foi compartilhado com você.`;
  } else if (experimento) {
    nome = `${experimento.codigo} · ${experimento.nome}`;
    detalhe = `${experimento.modo} · na célula desde ${formatar.data(experimento.naCelulaDesde)} · responsável ${experimento.responsavel}${
      experimento.condicao ? ` · condição ${experimento.condicao}` : ""}`;
  }

  return (
    <section className={estilos.faixaStatus} aria-label="Situação da célula">
      <div className={estilos.experimento}>
        <div className={estilos.experimentoLinha}>
          {experimento === null && dados.situacao === "online" ? (
            <SeloDeStatus situacao="espera" rotulo="Livre" />
          ) : (
            <SeloDeStatus situacao={dados.situacao} rotulo={SELO[dados.situacao]} />
          )}
          <span className={estilos.experimentoNome}>{nome}</span>
        </div>
        <p className={estilos.experimentoDetalhe}>{detalhe}</p>
      </div>
      <Caixa
        rotulo="Dia do experimento"
        valor={experimento?.dia ? (experimento.duracaoDias ? `${experimento.dia} de ${experimento.duracaoDias}` : `${experimento.dia}`) : "—"}
      />
      <Caixa rotulo="Temperatura alvo" valor={traco(alvo, formatar.temperatura)} />
      <Caixa
        rotulo="Última leitura"
        valor={dados.ultimaLeituraEm ? formatar.tempoDecorrido(dados.ultimaLeituraEm, dados.atualizadoEm) : "nenhuma"}
      />
      <Caixa
        rotulo="Placa"
        valor={placa.modelo ? [placa.modelo, placa.firmware].filter(Boolean).join(" · ") : "—"}
        mono
      />
    </section>
  );
}
