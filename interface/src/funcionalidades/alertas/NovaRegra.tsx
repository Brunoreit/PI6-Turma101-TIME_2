// "painel Nova regra" da tela Alertas do Figma (nó 83:1651).

import { useState } from "react";
import iconeInfo from "@/assets/icones/info-14.svg";
import iconeTestar from "@/assets/icones/testar.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import { Campo } from "@/compartilhado/componentes/Campo";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { fechado } from "@/funcionalidades/experimentos/modelo";
import { useSessao } from "@/sessao/SessaoProvider";
import estilos from "./Alertas.module.css";
import { COMPARACOES, PARAMETROS, type Comparacao, type Gravidade, type Parametro, type Regra } from "./modelo";

const SIGLA: Record<Parametro, string> = { "Densidade óptica": "OD", Temperatura: "temperatura", pH: "pH" };

export function NovaRegra({ onSalvar, onCancelar }: { onSalvar: (regra: Omit<Regra, "id">) => void; onCancelar: () => void }) {
  const { experimentos } = useExperimentos();
  const { usuario } = useSessao();
  const [nome, setNome] = useState("OD acima do esperado");
  const [parametro, setParametro] = useState<Parametro>("Densidade óptica");
  const [comparacao, setComparacao] = useState<Comparacao>("Maior que");
  const [limite, setLimite] = useState("0,80");
  const [minutos, setMinutos] = useState("15");
  const [ondeVale, setOndeVale] = useState("EXP-01");
  const [gravidade, setGravidade] = useState<Gravidade>("aviso");
  const [email, setEmail] = useState(true);
  const [teste, setTeste] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const ativos = experimentos.filter((e) => !fechado(e));
  const alvo = ondeVale ? `de uma célula do ${ondeVale}` : "de qualquer célula";
  const sentido = comparacao === "Maior que" ? "acima" : "abaixo";
  const previa = `Avisa quando a ${SIGLA[parametro]} ${alvo} ficar ${sentido} de ${limite || "?"} por ${minutos || "?"} minutos seguidos.`;

  function salvar() {
    const n = Number(limite.replace(",", "."));
    const m = Number(minutos);
    if (!nome.trim()) return setErro("Dê um nome à regra.");
    if (limite.trim() === "" || Number.isNaN(n)) return setErro("O limite precisa ser um número, como 0,80.");
    if (!(m > 0)) return setErro("O tempo precisa ser de pelo menos 1 minuto.");
    onSalvar({
      nome: nome.trim(),
      descricao: `Criada por ${usuario?.nome ?? "você"}.`,
      condicao: `${SIGLA[parametro] === "OD" ? "OD" : parametro} ${comparacao.toLowerCase()} ${limite}`,
      porMinutos: m,
      ondeVale: ondeVale || null,
      gravidade,
      email,
      ativa: true,
      criadaPor: usuario?.nome,
    });
    setErro(null);
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
        <CaixaDeSelecao marcada={email} onChange={setEmail}>
          E-mail para o responsável e quem pode modificar
        </CaixaDeSelecao>
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
        onClick={() => setTeste("Teste com leituras antigas ainda não disponível: a API não guarda regras novas.")}
      >
        <img src={iconeTestar} width={12} height={12} alt="" />
        Testar com as leituras das últimas 24 h
      </button>
      {teste && <p className={estilos.ajuda}>{teste}</p>}
      {erro && <p className={estilos.erro}>{erro}</p>}
      <div className={estilos.botoes}>
        <Botao onClick={onCancelar}>Cancelar</Botao>
        <Botao tipo="primario" submit>
          Salvar regra
        </Botao>
      </div>
    </form>
  );
}
