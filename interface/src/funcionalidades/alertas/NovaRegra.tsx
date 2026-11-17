// "painel Nova regra" da tela Alertas do Figma (nó 83:1651). No modo api a
// regra vai para o POST /regras, e "Testar com as leituras das últimas 24 h"
// chama o POST /regras/testar, que mostra o que a regra teria feito sem salvar
// nada. Com "E-mail" marcado, o processo de regras avisa por e-mail quando a
// regra abre um alerta (no Compose, os e-mails ficam no Mailpit).

import { useEffect, useState } from "react";
import { testarRegra } from "@/api/cliente";
import type { ResultadoDoTesteApi } from "@/api/tipos";
import iconeInfo from "@/assets/icones/info-14.svg";
import iconeTestar from "@/assets/icones/testar.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import { Campo } from "@/compartilhado/componentes/Campo";
import * as formatar from "@/compartilhado/formatar";
import { FONTE_DADOS } from "@/dados/fonte";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { acessoNoExperimento, fechado } from "@/funcionalidades/experimentos/modelo";
import { useSessao } from "@/sessao/SessaoProvider";
import estilos from "./Alertas.module.css";
import {
  COMPARACOES, PARAMETROS, testeParaApi, valorDaMedida, type Comparacao, type Gravidade, type Parametro, type RegraNova,
} from "./modelo";

const SIGLA: Record<Parametro, string> = { "Densidade óptica": "OD", Temperatura: "temperatura", pH: "pH" };
const NA_API = FONTE_DADOS === "api";

interface Props {
  /** Rejeitar (a API recusou) mostra a mensagem no painel, que continua aberto. */
  onSalvar: (regra: RegraNova) => void | Promise<void>;
  onCancelar: () => void;
}

export function NovaRegra({ onSalvar, onCancelar }: Props) {
  const { experimentos } = useExperimentos();
  const { usuario } = useSessao();
  // Regra de um experimento: só nos abertos que a pessoa pode modificar (a API recusa os outros).
  const ativos = experimentos.filter((e) => !fechado(e) && acessoNoExperimento(e, usuario?.email) !== "leitura");
  const [nome, setNome] = useState("OD acima do esperado");
  const [parametro, setParametro] = useState<Parametro>("Densidade óptica");
  const [comparacao, setComparacao] = useState<Comparacao>("Maior que");
  const [limite, setLimite] = useState("0,80");
  const [minutos, setMinutos] = useState("15");
  // No Figma a regra nova vale para o EXP-01; com os dados reais, começa em todas as células.
  const [ondeVale, setOndeVale] = useState(NA_API ? "" : "EXP-01");
  const [gravidade, setGravidade] = useState<Gravidade>("aviso");
  const [email, setEmail] = useState(true);
  const [teste, setTeste] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ regra: RegraNova; dados: ResultadoDoTesteApi } | null>(null);
  const [testando, setTestando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const alvo = ondeVale ? `de uma célula do ${ondeVale}` : "de qualquer célula";
  const sentido = comparacao === "Maior que" ? "acima" : "abaixo";
  const previa = `Avisa quando a ${SIGLA[parametro]} ${alvo} ficar ${sentido} de ${limite || "?"} por ${minutos || "?"} minutos seguidos.`;

  // Mudou a regra: o resultado do teste não vale mais.
  useEffect(() => {
    setResultado(null);
    setTeste(null);
  }, [parametro, comparacao, limite, minutos, ondeVale]);

  /** A regra do painel, ou `null` com a mensagem do que falta. */
  function regraDoPainel(exigirNome: boolean): RegraNova | null {
    const n = Number(limite.replace(",", "."));
    const m = Number(minutos);
    let falta: string | null = null;
    if (exigirNome && !nome.trim()) falta = "Dê um nome à regra.";
    else if (limite.trim() === "" || Number.isNaN(n)) falta = "O limite precisa ser um número, como 0,80.";
    else if (!Number.isInteger(m) || m < 1 || m > 1440) falta = "O tempo vai de 1 a 1440 minutos, sem casas decimais.";
    setErro(falta);
    if (falta) return null;
    return {
      nome: nome.trim(),
      parametro,
      comparacao,
      limite: n,
      limiteTexto: limite.trim(),
      porMinutos: m,
      ondeVale: ondeVale || null,
      gravidade,
      email,
    };
  }

  async function testar() {
    if (testando) return;
    setTeste(null);
    setResultado(null);
    if (!NA_API) {
      setTeste("No modo exemplo não há leituras guardadas para testar. Rode com VITE_FONTE_DADOS=api.");
      return;
    }
    const regra = regraDoPainel(false);
    if (!regra) return;
    const idExperimento = ondeVale ? experimentos.find((e) => e.codigo === ondeVale)?.id : undefined;
    setTestando(true);
    try {
      setResultado({ regra, dados: await testarRegra(testeParaApi(regra, idExperimento)) });
    } catch (falha) {
      setTeste(mensagemDoErro(falha));
    } finally {
      setTestando(false);
    }
  }

  async function salvar() {
    if (salvando) return;
    const regra = regraDoPainel(true);
    if (!regra) return;
    setSalvando(true);
    try {
      await onSalvar(regra);
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form
      className={estilos.painel}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <div className={estilos.painelTitulo}>
        <h2>Nova regra</h2>
        <p>Escolha o que verificar, quando avisar e por onde.</p>
      </div>
      <Campo rotulo="Nome" tipo="texto" valor={nome} onChange={setNome} />
      <div className={estilos.linhaCampos}>
        <label className={estilos.campoSeletor}>
          <span>Parâmetro</span>
          <select className={estilos.seletor} value={parametro} onChange={(e) => setParametro(e.target.value as Parametro)}>
            {PARAMETROS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label className={estilos.campoSeletor}>
          <span>Condição</span>
          <select className={estilos.seletor} value={comparacao} onChange={(e) => setComparacao(e.target.value as Comparacao)}>
            {COMPARACOES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </div>
      <div className={estilos.linhaCampos}>
        <Campo rotulo="Limite" valor={limite} onChange={setLimite} />
        <Campo rotulo="Por quanto tempo" valor={minutos} onChange={setMinutos} unidade="min" />
      </div>
      <p className={estilos.ajuda}>O tempo evita alerta por uma leitura isolada fora do normal.</p>
      <label className={estilos.campoSeletor}>
        <span>Onde vale</span>
        <select className={estilos.seletor} value={ondeVale} onChange={(e) => setOndeVale(e.target.value)}>
          <option value="">Todas as células</option>
          {ativos.map((e) => (
            <option key={e.codigo} value={e.codigo}>
              {e.codigo} · {e.nome}
            </option>
          ))}
        </select>
      </label>
      <div className={estilos.campoSeletor}>
        <span title="Crítica aparece primeiro e em destaque: na lista de alertas, na barra lateral e no card da célula.">
          Gravidade
        </span>
        <div className={estilos.segmentos} role="radiogroup" aria-label="Gravidade">
          {(["aviso", "critica"] as const).map((g) => (
            <button
              key={g}
              type="button"
              role="radio"
              aria-checked={gravidade === g}
              className={gravidade === g ? estilos.segmentoAtivo : estilos.segmento}
              onClick={() => setGravidade(g)}
            >
              {g === "aviso" ? "Aviso" : "Crítica"}
            </button>
          ))}
        </div>
      </div>
      <fieldset className={estilos.canaisOpcoes}>
        <legend>Avisar por</legend>
        <CaixaDeSelecao marcada desabilitada titulo="Todo alerta aparece na tela.">
          Na tela
        </CaixaDeSelecao>
        <CaixaDeSelecao
          marcada={email}
          onChange={setEmail}
          titulo="Um e-mail por alerta, quando ele abre. O alerta continua aparecendo na tela."
        >
          {ondeVale ? `E-mail para o responsável e quem pode modificar o ${ondeVale}` : "E-mail para você"}
        </CaixaDeSelecao>
        <CaixaDeSelecao marcada={false} desabilitada titulo="Canal ainda não disponível.">
          WhatsApp ou SMS · canal a definir com o LNBR
        </CaixaDeSelecao>
      </fieldset>
      <div className={estilos.previa}>
        <img src={iconeInfo} width={14} height={14} alt="" />
        <p>{previa}</p>
      </div>
      <button type="button" className={estilos.testar} onClick={testar} aria-busy={testando || undefined}>
        <img src={iconeTestar} width={12} height={12} alt="" />
        {testando ? "Testando com as leituras das últimas 24 h..." : "Testar com as leituras das últimas 24 h"}
      </button>
      {teste && <p className={estilos.ajuda}>{teste}</p>}
      {resultado && <ResultadoDoTeste regra={resultado.regra} dados={resultado.dados} />}
      {erro && <p className={estilos.erro}>{erro}</p>}
      <div className={estilos.botoes}>
        <Botao onClick={onCancelar}>Cancelar</Botao>
        <Botao tipo="primario" submit ocupado={salvando}>
          {salvando ? "Salvando..." : "Salvar regra"}
        </Botao>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- resultado do teste

const MOSTRAR_ATE = 8;

/** "14:02", ou "16/11 14:02" fora do dia de hoje. */
function quando(iso: string, hoje: Date): string {
  const data = new Date(iso);
  const hora = data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return data.toDateString() === hoje.toDateString() ? hora : `${formatar.diaMes(data)} ${hora}`;
}

function duracao(de: string, ate: string): string {
  const minutos = Math.max(1, Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 60000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  return minutos % 60 ? `${horas} h ${minutos % 60} min` : `${horas} h`;
}

/** O que a regra teria feito nas últimas 24 h: quantas vezes, em quais células e quando. */
function ResultadoDoTeste({ regra, dados }: { regra: RegraNova; dados: ResultadoDoTesteApi }) {
  const hoje = new Date(dados.ate);
  const { alertas } = dados;
  const celulas = new Set(alertas.map((a) => a.id_celula)).size;
  const olhou = `${formatar.inteiro(dados.leituras)} ${dados.leituras === 1 ? "leitura" : "leituras"} de ${dados.celulas} ${
    dados.celulas === 1 ? "célula" : "células"}`;

  if (dados.leituras === 0) {
    return (
      <p className={estilos.resultadoTeste} role="status">
        Nenhuma leitura dessa medida nas últimas 24 h{regra.ondeVale ? ` nas células do ${regra.ondeVale}` : ""}: não há o que testar.
      </p>
    );
  }
  return (
    <div className={estilos.resultadoTeste} role="status">
      <p>
        {alertas.length === 0
          ? `Nas últimas 24 h (${olhou}), a regra não teria aberto nenhum alerta.`
          : `Nas últimas 24 h (${olhou}), a regra teria aberto ${alertas.length === 1 ? "1 alerta" : `${alertas.length} alertas`} em ${
            celulas === 1 ? "1 célula" : `${celulas} células`}:`}
      </p>
      {alertas.length > 0 && (
        <ul>
          {alertas.slice(0, MOSTRAR_ATE).map((a) => (
            <li key={`${a.id_celula}-${a.abriria_em}`}>
              <strong>{a.id_celula}</strong>{" "}
              {a.aberto_antes ? "já aberto no início do período" : `das ${quando(a.abriria_em, hoje)}`}
              {a.fecharia_em ? ` às ${quando(a.fecharia_em, hoje)}` : " até agora"}
              {!a.aberto_antes && a.fecharia_em ? ` (${duracao(a.abriria_em, a.fecharia_em)})` : ""}
              {` · pior ${valorDaMedida(regra.parametro, a.pior)}`}
            </li>
          ))}
        </ul>
      )}
      {alertas.length > MOSTRAR_ATE && <p>E mais {alertas.length - MOSTRAR_ATE}.</p>}
      <p className={estilos.ajuda}>
        Nada foi salvo. A verificação real roda a cada poucos segundos, então os horários podem variar um pouco.
      </p>
    </div>
  );
}
