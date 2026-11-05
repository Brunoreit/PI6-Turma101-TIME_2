// Painel "Atribuir experimento" da tela "Célula c04 · livre" do Figma (nó
// 153:1633). Ocupa o lugar dos Comandos quando a célula está livre. A API
// ainda não tem o endpoint de atribuição, então o botão explica o motivo.

import { useState } from "react";
import iconeCheck from "@/assets/icones/check-14-verde.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import * as formatar from "@/compartilhado/formatar";
import type { DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

export function AtribuirExperimento({ dados }: { dados: DetalheDaCelula }) {
  const { experimentos } = useExperimentos();
  // Só aparecem experimentos em andamento ou em Stand by.
  const abertos = experimentos.filter((e) => e.status !== "encerrado");
  const [codigo, setCodigo] = useState(abertos.find((e) => e.status === "standby")?.codigo ?? abertos[0]?.codigo ?? "");
  const escolhido = abertos.find((e) => e.codigo === codigo);
  const alvoDoCadastro = escolhido?.fases[0]?.temperaturaC ?? 30;
  const [temperatura, setTemperatura] = useState(formatar.decimal(alvoDoCadastro, 1));

  const checagens = [
    "Frasco com meio instalado",
    "Mangueiras conectadas",
    dados.calibracao ? `Calibração de OD em dia (v${dados.calibracao.atual.versao})` : "Calibração de OD em dia",
    `Célula ${dados.situacao === "offline" ? "offline" : "online"}`,
  ];

  return (
    <section className={estilos.comandos} aria-labelledby="titulo-atribuir">
      <div className={comum.painelTitulo}>
        <h2 id="titulo-atribuir" className={comum.painelNome}>Atribuir experimento</h2>
        <p className={comum.painelDescricao}>A célula está livre. Escolha o experimento que ela vai representar.</p>
      </div>

      <div className={estilos.grupo}>
        <label htmlFor="experimento-alvo" className={estilos.grupoRotulo}>Experimento</label>
        {/* O select fica invisível por cima: mostra o código e o nome em duas linhas, como no Figma. */}
        <div className={estilos.seletorExperimento}>
          {escolhido && (
            <span className={estilos.seletorTextos} aria-hidden>
              <span className={estilos.seletorCodigo}>
                {escolhido.codigo} · {escolhido.status === "standby" ? "Stand by" : "Em andamento"}
              </span>
              <span className={estilos.seletorNome}>{escolhido.nome}</span>
            </span>
          )}
          <select
            id="experimento-alvo"
            value={codigo}
            onChange={(e) => {
              setCodigo(e.target.value);
              const novo = abertos.find((x) => x.codigo === e.target.value);
              setTemperatura(formatar.decimal(novo?.fases[0]?.temperaturaC ?? 30, 1));
            }}
          >
            {abertos.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} · {e.status === "standby" ? "Stand by" : "Em andamento"} · {e.nome}
              </option>
            ))}
          </select>
        </div>
        <p className={estilos.ajuda}>Só aparecem experimentos em andamento ou em Stand by.</p>
      </div>

      <div className={estilos.grupo}>
        <label htmlFor="temperatura-atribuicao" className={estilos.grupoRotulo}>Temperatura alvo desta célula</label>
        <div className={estilos.entrada}>
          <input
            id="temperatura-atribuicao"
            className={estilos.entradaValor}
            inputMode="decimal"
            value={temperatura}
            onChange={(e) => setTemperatura(e.target.value)}
          />
          <span className={estilos.entradaUnidade}>°C</span>
        </div>
        <p className={estilos.ajuda}>O cadastro sugere {formatar.temperatura(alvoDoCadastro)}.</p>
      </div>

      {escolhido && (
        <div className={estilos.linhaFaixa}>
          <span>Faixa de pH de referência</span>
          <strong>
            {formatar.decimal(escolhido.phMin, 1)} a {formatar.decimal(escolhido.phMax, 1)}
          </strong>
        </div>
      )}

      <div className={estilos.antesDeIniciar}>
        <p className={estilos.grupoRotulo}>Antes de iniciar</p>
        <ul>
          {checagens.map((c) => (
            <li key={c}>
              <img src={iconeCheck} width={14} height={14} alt="" />
              {c}
            </li>
          ))}
        </ul>
      </div>

      <Botao tipo="primario" cheio indisponivel="Ainda não disponível: a API não tem o endpoint para atribuir a célula a um experimento.">
        Atribuir e iniciar
      </Botao>
      {escolhido && (
        <p className={estilos.ajuda}>
          A {dados.id} entra no {escolhido.codigo} agora e recebe {temperatura || "?"} °C.
          {escolhido.status === "standby"
            ? ` O ${escolhido.codigo} sai de Stand by e só as leituras a partir daqui entram nele.`
            : " Só as leituras a partir daqui entram nele."}
        </p>
      )}
    </section>
  );
}
