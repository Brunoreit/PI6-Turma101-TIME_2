// Painel "Histórico da célula" da tela "Célula c04 · livre" do Figma (nó
// 153:1633): experimentos de que a célula já participou e manutenções.

import iconeHistorico from "@/assets/icones/historico-16.svg";
import * as formatar from "@/compartilhado/formatar";
import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import { useEffect } from "react";
import { FONTE_DADOS } from "@/dados/fonte";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

interface Item {
  titulo: string;
  detalhe: string;
  em: Date;
}

export function HistoricoDaCelula({ dados }: { dados: DetalheDaCelula }) {
  const { experimentos: lista, buscar, carregarDetalhe } = useExperimentos();
  // A lista da API não traz as células; o detalhe de cada experimento traz.
  const experimentos = lista.map((e) => buscar(e.codigo) ?? e);
  const codigos = lista.map((e) => e.codigo).join(",");
  useEffect(() => {
    if (FONTE_DADOS !== "api") return;
    for (const codigo of codigos.split(",").filter(Boolean)) carregarDetalhe(codigo).catch(() => {});
    // carregarDetalhe muda a cada render do provider; os códigos bastam.
  }, [codigos]);

  const itens: Item[] = [
    ...experimentos.flatMap((e) =>
      e.celulas
        .filter((c) => c.id === dados.id && c.fim)
        .map((c) => ({
          titulo: `${e.codigo} · ${e.nome}`,
          detalhe: `${formatar.diaMes(c.inicio)} a ${formatar.data(c.fim!)} · ${
            c.cancelada ? `participação cancelada${c.motivo ? `: ${c.motivo}` : ""}`
            : e.status === "encerrado" ? "experimento encerrado"
            : e.status === "cancelado" ? `experimento cancelado${e.motivoCancelamento ? `: ${e.motivoCancelamento}` : ""}`
            : "saiu do experimento"}`,
          em: c.fim!,
        })),
    ),
    ...(dados.manutencao?.ultima
      ? [{ titulo: "Manutenção", detalhe: `${formatar.data(dados.manutencao.ultima.em)} · ${dados.manutencao.ultima.motivo}`, em: dados.manutencao.ultima.em }]
      : []),
    ...(dados.calibracao
      ? [
          {
            titulo: `Calibração de OD versão ${dados.calibracao.atual.versao}`,
            detalhe: `${formatar.data(dados.calibracao.atual.criadaEm)} · od = ${formatar.decimal(dados.calibracao.atual.a, 4)} · bruto ${dados.calibracao.atual.b < 0 ? "−" : "+"} ${formatar.decimal(Math.abs(dados.calibracao.atual.b), 3)}`,
            em: dados.calibracao.atual.criadaEm,
          },
        ]
      : []),
  ].sort((a, b) => b.em.getTime() - a.em.getTime());

  return (
    <section className={comum.painel} aria-labelledby="titulo-historico">
      <h2 id="titulo-historico" className={comum.painelNome}>Histórico da célula</h2>
      {itens.length === 0 ? (
        <p className={comum.painelDescricao}>A célula ainda não participou de nenhum experimento.</p>
      ) : (
        <ul className={estilos.historicoCelula}>
          {itens.map((item) => (
            <li key={`${item.titulo}-${item.em.getTime()}`}>
              <img src={iconeHistorico} width={16} height={16} alt="" />
              <div>
                <p className={estilos.historicoTitulo}>{item.titulo}</p>
                <p className={estilos.historicoDetalhe}>{item.detalhe}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
