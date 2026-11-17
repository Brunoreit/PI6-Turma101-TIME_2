// "painel Nova regra" da tela Alertas do Figma (nó 83:1651). No modo api a
// regra vai para o POST /regras; e-mail e o teste com leituras antigas ainda
// não existem no sistema e aparecem como indisponíveis.

import { useState } from "react";
import iconeInfo from "@/assets/icones/info-14.svg";
import iconeTestar from "@/assets/icones/testar.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { FONTE_DADOS } from "@/dados/fonte";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { acessoNoExperimento, fechado } from "@/funcionalidades/experimentos/modelo";
import { useSessao } from "@/sessao/SessaoProvider";
import estilos from "./Alertas.module.css";
import { COMPARACOES, PARAMETROS, type Comparacao, type Gravidade, type Parametro, type RegraNova } from "./modelo";

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
  const [email, setEmail] = useState(!NA_API);
  const [teste, setTeste] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const alvo = ondeVale ? `de uma célula do ${ondeVale}` : "de qualquer célula";
  const sentido = comparacao === "Maior que" ? "acima" : "abaixo";
  const previa = `Avisa quando a ${SIGLA[parametro]} ${alvo} ficar ${sentido} de ${limite || "?"} por ${minutos || "?"} minutos seguidos.`;

  async function salvar() {
    if (salvando) return;
    const n = Number(limite.replace(",", "."));
    const m = Number(minutos);
    if (!nome.trim()) return setErro("Dê um nome à regra.");
    if (limite.trim() === "" || Number.isNaN(n)) return setErro("O limite precisa ser um número, como 0,80.");
    if (!Number.isInteger(m) || m < 1 || m > 1440) return setErro("O tempo vai de 1 a 1440 minutos, sem casas decimais.");
    setErro(null);
    setSalvando(true);
    try {
      await onSalvar({
        nome: nome.trim(),
        parametro,
        comparacao,
        limite: n,
        limiteTexto: limite.trim(),
        porMinutos: m,
        ondeVale: ondeVale || null,
        gravidade,
        email,
      });
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
        <span>Gravidade</span>
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
        {NA_API ? (
          <CaixaDeSelecao marcada={false} desabilitada titulo="O sistema ainda não envia e-mail. O alerta aparece na tela.">
            E-mail para o responsável e quem pode modificar · em breve
          </CaixaDeSelecao>
        ) : (
          <CaixaDeSelecao marcada={email} onChange={setEmail}>
            E-mail para o responsável e quem pode modificar
          </CaixaDeSelecao>
        )}
        <CaixaDeSelecao marcada={false} desabilitada titulo="Canal ainda não disponível.">
          WhatsApp ou SMS · canal a definir com o LNBR
        </CaixaDeSelecao>
      </fieldset>
      <div className={estilos.previa}>
        <img src={iconeInfo} width={14} height={14} alt="" />
        <p>{previa}</p>
      </div>
      <button
        type="button"
        className={estilos.testar}
        onClick={() => setTeste("Ainda não disponível: a API não testa a regra com leituras antigas. Salve a regra; ela começa a valer na próxima verificação.")}
      >
        <img src={iconeTestar} width={12} height={12} alt="" />
        Testar com as leituras das últimas 24 h
      </button>
      {teste && <p className={estilos.ajuda}>{teste}</p>}
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
