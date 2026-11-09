// Painel "Atribuir experimento" da tela "Célula c04 · livre" do Figma (nó
// 153:1633). Ocupa o lugar dos Comandos quando a célula está livre.
// "Atribuir e iniciar" abre o cultivo pelo POST /experimentos/{id}/cultivos.
// Só aparecem os experimentos abertos em que a pessoa é responsável ou tem
// edição, porque só elas podem atribuir.

import { useState } from "react";
import iconeCheck from "@/assets/icones/check-14-verde.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import * as formatar from "@/compartilhado/formatar";
import { atribuirCelula } from "@/funcionalidades/celula/fonte";
import { TEMPERATURA_MAX_C, TEMPERATURA_MIN_C, type DetalheDaCelula } from "@/funcionalidades/celula/modelo";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { acessoNoExperimento, fechado, type Experimento } from "@/funcionalidades/experimentos/modelo";
import { useSessao } from "@/sessao/SessaoProvider";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

/** Temperatura alvo do cadastro: a da primeira fase, ou nenhuma. */
const alvoDe = (e: Experimento | undefined) => e?.fases[0]?.temperaturaC ?? null;

export function AtribuirExperimento({ dados, aoAtribuir }: { dados: DetalheDaCelula; aoAtribuir: (aviso: string | null) => void }) {
  const { experimentos } = useExperimentos();
  const { usuario } = useSessao();
  // Em andamento ou em Stand by, e com acesso para atribuir.
  const abertos = experimentos.filter((e) => {
    const acesso = acessoNoExperimento(e, usuario?.email);
    return !fechado(e) && (acesso === "responsavel" || acesso === "modificar");
  });
  const [codigo, setCodigo] = useState(abertos.find((e) => e.status === "standby")?.codigo ?? abertos[0]?.codigo ?? "");
  const escolhido = abertos.find((e) => e.codigo === codigo) ?? abertos[0];
  const alvoDoCadastro = alvoDe(escolhido);
  const [temperatura, setTemperatura] = useState(alvoDoCadastro === null ? "" : formatar.decimal(alvoDoCadastro, 1));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function atribuir() {
    if (!escolhido || enviando) return;
    const texto = temperatura.trim();
    const valor = Number(texto.replace(",", "."));
    if (texto && (!Number.isFinite(valor) || valor < TEMPERATURA_MIN_C || valor > TEMPERATURA_MAX_C)) {
      return setErro(`Digite uma temperatura entre ${TEMPERATURA_MIN_C} e ${TEMPERATURA_MAX_C} °C, ou deixe em branco.`);
    }
    setErro(null);
    setEnviando(true);
    try {
      const aviso = await atribuirCelula(dados.id, { id: escolhido.id, alvoC: alvoDoCadastro }, texto ? valor : null);
      aoAtribuir(aviso);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
      setEnviando(false);
    }
  }

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
              const alvo = alvoDe(abertos.find((x) => x.codigo === e.target.value));
              setTemperatura(alvo === null ? "" : formatar.decimal(alvo, 1));
            }}
          >
            {abertos.map((e) => (
              <option key={e.codigo} value={e.codigo}>
                {e.codigo} · {e.status === "standby" ? "Stand by" : "Em andamento"} · {e.nome}
              </option>
            ))}
          </select>
        </div>
        <p className={estilos.ajuda}>
          {abertos.length === 0
            ? "Nenhum experimento em andamento ou em Stand by em que você seja responsável ou tenha edição."
            : "Só aparecem experimentos em andamento ou em Stand by em que você é responsável ou tem edição."}
        </p>
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
        <p className={estilos.ajuda}>
          {alvoDoCadastro === null
            ? "O experimento não tem temperatura alvo. Em branco, a célula fica na temperatura atual."
            : `O cadastro sugere ${formatar.temperatura(alvoDoCadastro)}.`}
        </p>
      </div>

      {escolhido && Number.isFinite(escolhido.phMin) && Number.isFinite(escolhido.phMax) && (
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

      <Botao
        tipo="primario"
        cheio
        ocupado={enviando}
        onClick={atribuir}
        indisponivel={escolhido ? undefined : "Nenhum experimento disponível para atribuir. Crie um ou peça acesso de edição."}
      >
        {enviando ? "Atribuindo..." : "Atribuir e iniciar"}
      </Botao>
      {erro && (
        <p className={estilos.ajudaErro} role="alert">
          {erro}
        </p>
      )}
      {escolhido && !erro && (
        <p className={estilos.ajuda}>
          A {dados.id} entra no {escolhido.codigo} agora
          {temperatura.trim() ? ` e recebe ${temperatura.trim()} °C` : ""}.
          {escolhido.status === "standby"
            ? ` O ${escolhido.codigo} sai de Stand by e só as leituras a partir daqui entram nele.`
            : " Só as leituras a partir daqui entram nele."}
        </p>
      )}
    </section>
  );
}
