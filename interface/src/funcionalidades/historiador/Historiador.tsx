// Tela "Historiador" do Figma (nó 209:2146). Todas as medições de todas as
// células, com ou sem experimento: até 4 células, um período e as variáveis.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import baixar from "@/assets/icones/baixar-16.svg";
import calendario from "@/assets/icones/calendario-14.svg";
import esquerda from "@/assets/icones/chevron-esquerda-14.svg";
import direita from "@/assets/icones/chevron-direita-14.svg";
import fechar from "@/assets/icones/fechar-12.svg";
import gravando from "@/assets/icones/gravando.svg";
import iconeInfo from "@/assets/icones/info-14.svg";
import mais from "@/assets/icones/mais-12-marca.svg";
import zoom from "@/assets/icones/zoom-14.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { Campo } from "@/compartilhado/componentes/Campo";
import * as formatar from "@/compartilhado/formatar";
import { FONTE_DADOS } from "@/dados/fonte";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { fechado } from "@/funcionalidades/experimentos/modelo";
import { carregarSeries, estatistica, type Serie, type Variavel } from "./dados";
import { GraficoDeComparacao, type Contexto } from "./GraficoDeComparacao";
import estilos from "./Historiador.module.css";

const MAXIMO_DE_CELULAS = 4;
const TODAS_AS_CELULAS = Array.from({ length: 16 }, (_, i) => `c${String(i + 1).padStart(2, "0")}`);
const CORES = ["var(--serie\\/1)", "var(--serie\\/2)", "var(--serie\\/3)", "var(--serie\\/4)"];
const HORA = 3_600_000;

const PERIODOS = [
  { rotulo: "1 h", horas: 1 },
  { rotulo: "12 h", horas: 12 },
  { rotulo: "24 h", horas: 24 },
  { rotulo: "7 dias", horas: 168 },
];

const NOMES: Record<Variavel | "setpoint", string> = {
  temperatura: "Temperatura",
  od: "Densidade óptica",
  ph: "pH",
  setpoint: "Setpoint",
};

interface Evento {
  t: Date;
  idCelula: string;
  tipo: "Comando" | "Alerta" | "Resolvido" | "Comunicação" | "Anotação";
  descricao: string;
}

/** Eventos de exemplo, nos mesmos horários relativos do Figma (08:00 a 20:00). */
function eventosDeExemplo(inicio: Date, fim: Date, celulas: string[]): Evento[] {
  const em = (fracao: number) => new Date(inicio.getTime() + (fim.getTime() - inicio.getTime()) * fracao);
  const [a, b = a] = celulas;
  if (!a) return [];
  return [
    { t: em(0.12), idCelula: a, tipo: "Comando", descricao: "Temperatura alvo de 30,0 °C enviada para teste do aquecedor, sem experimento" },
    { t: em(0.18), idCelula: b, tipo: "Alerta", descricao: "Desvio de temperatura: 31,3 °C com alvo de 30,0 °C" },
    { t: em(0.19), idCelula: b, tipo: "Resolvido", descricao: "Temperatura voltou para a faixa" },
    { t: em(0.5), idCelula: b, tipo: "Comunicação", descricao: "Placa ficou offline" },
    { t: em(0.51), idCelula: b, tipo: "Comunicação", descricao: "Placa voltou e reenviou 15 leituras guardadas" },
  ];
}

const CLASSE_DO_TIPO: Record<Evento["tipo"], string> = {
  Comando: estilos.tipoComando,
  Alerta: estilos.tipoAlerta,
  Resolvido: estilos.tipoResolvido,
  Comunicação: estilos.tipoComunicacao,
  Anotação: estilos.tipoComando,
};

function dataDoParametro(texto: string | null): Date | null {
  const data = texto ? new Date(texto) : null;
  return data && !Number.isNaN(data.getTime()) ? data : null;
}

export function Historiador() {
  const { experimentos: lista, buscar, carregarDetalhe } = useExperimentos();
  // A lista da API não traz as células; o detalhe traz, com o período de cada
  // uma. As faixas de contexto usam o detalhe.
  const experimentos = lista.map((e) => buscar(e.codigo) ?? e);
  const codigos = lista.map((e) => e.codigo).join(",");
  useEffect(() => {
    if (FONTE_DADOS !== "api") return;
    for (const codigo of codigos.split(",").filter(Boolean)) carregarDetalhe(codigo).catch(() => {});
    // carregarDetalhe muda a cada render do provider; os códigos bastam.
  }, [codigos]);
  const [parametros, setParametros] = useSearchParams();
  const celulas = (parametros.get("celulas")?.split(",").filter(Boolean) ?? ["c04", "c08"]).slice(0, MAXIMO_DE_CELULAS);
  const [variaveis, setVariaveis] = useState<Set<Variavel | "setpoint">>(new Set(["temperatura", "od", "ph"]));
  // ?inicio=...&fim=... (datas ISO) abre num período, como o "Ver no
  // historiador" do experimento. Sem fim, vai até agora.
  const [fim, setFim] = useState(() => dataDoParametro(parametros.get("fim")) ?? new Date());
  const [horas, setHoras] = useState(() => {
    const inicioPedido = dataDoParametro(parametros.get("inicio"));
    // Um pouco de folga antes do início; no mínimo 6 min.
    return inicioPedido ? Math.max(0.1, ((fim.getTime() - inicioPedido.getTime()) / HORA) * 1.1) : 12;
  });
  const [series, setSeries] = useState<Serie[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [anotacoes, setAnotacoes] = useState<Evento[]>([]);
  const [nomeGravacao, setNomeGravacao] = useState("Teste de queda de rede");
  const [duracaoGravacao, setDuracaoGravacao] = useState("1");
  const inicio = useMemo(() => new Date(fim.getTime() - horas * HORA), [fim, horas]);
  const chave = celulas.join(",");

  const emExperimento = celulas
    .filter((id) => experimentos.some((e) => !fechado(e) && e.celulas.some((c) => c.id === id && c.fim === null)))
    .join(",");

  useEffect(() => {
    const controle = new AbortController();
    setErro(null);
    carregarSeries(chave ? chave.split(",") : [], inicio, fim, new Set(emExperimento.split(",")), controle.signal)
      .then(setSeries)
      .catch((e: Error) => e.name !== "AbortError" && setErro(e.message));
    return () => controle.abort();
  }, [chave, inicio, fim, emExperimento]);

  const cores = Object.fromEntries(celulas.map((id, i) => [id, CORES[i]]));
  const mostradas = (["temperatura", "od", "ph"] as const).filter((v) => variaveis.has(v));

  function mudarCelulas(novas: string[]) {
    setParametros(novas.length ? { celulas: novas.join(",") } : {}, { replace: true });
  }

  function alternarVariavel(v: Variavel | "setpoint") {
    setVariaveis((atual) => {
      const novo = new Set(atual);
      if (novo.has(v)) novo.delete(v);
      else novo.add(v);
      return novo;
    });
  }

  const contexto: Contexto[] = celulas.map((id) => {
    const experimento = experimentos.find((e) =>
      e.celulas.some((c) => c.id === id && c.inicio <= fim && (c.fim === null || c.fim >= inicio)),
    );
    const participacao = experimento?.celulas.find((c) => c.id === id);
    if (!experimento || !participacao) return { idCelula: id, texto: `${id} · sem experimento`, emExperimento: false };
    const ate = participacao.fim ? formatar.diaMes(participacao.fim) : "agora";
    return {
      idCelula: id,
      texto: `${id} · ${experimento.codigo} · ${experimento.nome} (${formatar.diaMes(participacao.inicio)} até ${ate})`,
      emExperimento: true,
    };
  });

  const n = series[0]?.pontos.length ?? 0;
  const buracos = series.flatMap((s) => s.pontos.flatMap((p, i) => (p.temperatura === null ? [i] : [])));
  const rotulosTempo = Array.from({ length: 7 }, (_, i) => {
    const t = new Date(inicio.getTime() + ((fim.getTime() - inicio.getTime()) * i) / 6);
    return horas > 24 ? formatar.diaMes(t) : t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  });
  // No modo api, os eventos ainda não vêm da API (só as anotações feitas aqui).
  const exemplos = FONTE_DADOS === "exemplo" ? eventosDeExemplo(inicio, fim, celulas) : [];
  const eventos = [...exemplos, ...anotacoes.filter((a) => a.t >= inicio && a.t <= fim)].sort(
    (a, b) => a.t.getTime() - b.t.getTime(),
  );
  const intervalo =
    formatar.data(inicio) === formatar.data(fim)
      ? `${formatar.data(inicio)} · ${inicio.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} a ${fim.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
      : `${formatar.diaHora(inicio)} a ${formatar.diaHora(fim)}`;

  function anotar() {
    const texto = window.prompt("Anotação para este período (ela aparece nos eventos):");
    if (!texto?.trim() || celulas.length === 0) return;
    setAnotacoes((a) => [...a, { t: new Date(Math.min(Date.now(), fim.getTime())), idCelula: celulas[0], tipo: "Anotação", descricao: texto.trim() }]);
  }

  return (
    <div className={estilos.tela}>
      <header className={estilos.cabecalho}>
        <div className={estilos.tituloBloco}>
          <h1>Historiador</h1>
          <p>Todas as medições de todas as células, gravadas o tempo todo, com ou sem experimento. Escolha as células e o período.</p>
        </div>
        <Botao para={`/exportar?celulas=${chave}`}>Exportar trecho</Botao>
      </header>

      <div className={estilos.avisoAcesso}>
        <img src={iconeInfo} width={14} height={14} alt="" />
        <p>Aberto a todos os usuários logados. Os experimentos aparecem só como faixas no tempo, para dar contexto às medições.</p>
      </div>

      <section className={estilos.ferramentas}>
        <div className={estilos.linhaCelulas}>
          <span className={estilos.rotulo}>Células</span>
          {celulas.map((id) => (
            <span key={id} className={estilos.celula}>
              <span className={estilos.pontoCor} style={{ background: cores[id] }} />
              {id}
              <button type="button" aria-label={`Tirar a ${id}`} onClick={() => mudarCelulas(celulas.filter((c) => c !== id))}>
                <img src={fechar} width={12} height={12} alt="" />
              </button>
            </span>
          ))}
          {celulas.length < MAXIMO_DE_CELULAS &&
            (escolhendo ? (
              <select
                className={estilos.escolherCelula}
                autoFocus
                defaultValue=""
                onBlur={() => setEscolhendo(false)}
                onChange={(e) => {
                  mudarCelulas([...celulas, e.target.value]);
                  setEscolhendo(false);
                }}
              >
                <option value="" disabled>
                  Escolha a célula
                </option>
                {TODAS_AS_CELULAS.filter((c) => !celulas.includes(c)).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            ) : (
              <button type="button" className={estilos.adicionar} onClick={() => setEscolhendo(true)}>
                <img src={mais} width={12} height={12} alt="" />
                Adicionar célula
              </button>
            ))}
          <span className={estilos.espaco} />
          <span className={estilos.ajuda}>Até {MAXIMO_DE_CELULAS} células por vez</span>
        </div>

        <div className={estilos.filtros}>
          <div className={estilos.variaveis}>
            <span className={estilos.rotulo}>Variáveis</span>
            {(Object.keys(NOMES) as (Variavel | "setpoint")[]).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={variaveis.has(v)}
                className={variaveis.has(v) ? estilos.variavelAtiva : estilos.variavel}
                title={v === "setpoint" ? "Ainda não disponível: a API não devolve o histórico de setpoints." : undefined}
                disabled={v === "setpoint"}
                onClick={() => alternarVariavel(v)}
              >
                {NOMES[v]}
              </button>
            ))}
          </div>
          <div className={estilos.periodo} role="radiogroup" aria-label="Período">
            {PERIODOS.map((p) => (
              <button
                key={p.horas}
                type="button"
                role="radio"
                aria-checked={horas === p.horas}
                className={horas === p.horas ? estilos.periodoAtivo : estilos.periodoItem}
                onClick={() => setHoras(p.horas)}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          <span className={estilos.intervalo}>
            <img src={calendario} width={14} height={14} alt="" />
            {intervalo}
          </span>
          <div className={estilos.navegar}>
            <button type="button" aria-label="Período anterior" onClick={() => setFim(new Date(fim.getTime() - horas * HORA))}>
              <img src={esquerda} width={14} height={14} alt="" />
            </button>
            <button type="button" aria-label="Voltar para agora" title="Voltar para agora" onClick={() => setFim(new Date())}>
              <img src={zoom} width={14} height={14} alt="" />
            </button>
            <button
              type="button"
              aria-label="Próximo período"
              disabled={fim.getTime() >= Date.now() - 60_000}
              onClick={() => setFim(new Date(Math.min(Date.now(), fim.getTime() + horas * HORA)))}
            >
              <img src={direita} width={14} height={14} alt="" />
            </button>
          </div>
        </div>
      </section>

      <section className={estilos.painel}>
        <div className={estilos.painelCabecalho}>
          <div>
            <h2>Comparação entre células</h2>
            <p>Uma linha por célula. A faixa de cima mostra se a célula estava em algum experimento no período.</p>
          </div>
          <div className={estilos.legenda}>
            {celulas.map((id) => (
              <span key={id}>
                <span className={estilos.tracoLegenda} style={{ background: cores[id] }} />
                {id}
              </span>
            ))}
          </div>
        </div>
        {erro && <p className={estilos.erro}>Não foi possível carregar as leituras: {erro}</p>}
        {celulas.length === 0 ? (
          <p className={estilos.ajuda}>Adicione pelo menos uma célula para ver as medições.</p>
        ) : mostradas.length === 0 ? (
          <p className={estilos.ajuda}>Escolha pelo menos uma variável.</p>
        ) : (
          n > 0 && (
            <GraficoDeComparacao
              series={series}
              cores={cores}
              variaveis={mostradas}
              contexto={contexto}
              rotulosTempo={rotulosTempo}
              buracos={[...new Set(buracos)]}
            />
          )
        )}
      </section>

      <div className={estilos.detalhes}>
        <section className={`${estilos.painel} ${estilos.eventos}`}>
          <div className={estilos.painelCabecalho}>
            <div>
              <h2>Eventos no período</h2>
              <p>De todas as células escolhidas.</p>
            </div>
            <Botao onClick={anotar}>Adicionar anotação</Botao>
          </div>
          <div className={estilos.tabela} role="table" aria-label="Eventos no período">
            <div className={estilos.cabecalhoTabela} role="row">
              {["Horário", "Célula", "Tipo", "Descrição"].map((c) => (
                <span key={c} role="columnheader">
                  {c}
                </span>
              ))}
            </div>
            {eventos.length === 0 && <p className={estilos.vazio}>Nenhum evento no período.</p>}
            {eventos.map((e, i) => (
              <div key={i} className={estilos.linha} role="row">
                <span role="cell" className={estilos.mono}>
                  {horas > 24 ? formatar.diaHora(e.t, true) : formatar.hora(e.t)}
                </span>
                <span role="cell" className={estilos.celulaEvento} style={{ color: cores[e.idCelula] }}>
                  {e.idCelula}
                </span>
                <span role="cell">
                  <span className={CLASSE_DO_TIPO[e.tipo]}>{e.tipo}</span>
                </span>
                <span role="cell">{e.descricao}</span>
              </div>
            ))}
          </div>
        </section>

        <div className={estilos.colunaDireita}>
          <section className={estilos.painel}>
            <div>
              <h2>Estatísticas do trecho</h2>
              <p>{intervalo}.</p>
            </div>
            <table className={estilos.estatisticas}>
              <thead>
                <tr>
                  <th>Variável</th>
                  <th />
                  <th>Mín.</th>
                  <th>Média</th>
                  <th>Máx.</th>
                </tr>
              </thead>
              <tbody>
                {mostradas.flatMap((v) =>
                  series.map((s, i) => {
                    const e = estatistica(s, v);
                    const f = (x: number) => (v === "temperatura" ? formatar.temperatura(x) : formatar.decimal(x, v === "od" ? 3 : 2));
                    return (
                      <tr key={`${v}-${s.idCelula}`} className={i === 0 ? estilos.inicioDoGrupo : undefined}>
                        <td>{i === 0 ? NOMES[v].replace("Densidade óptica", "OD") : ""}</td>
                        <td className={estilos.celulaEvento} style={{ color: cores[s.idCelula] }}>
                          {s.idCelula}
                        </td>
                        <td>{e ? f(e.minimo) : "—"}</td>
                        <td>{e ? f(e.media) : "—"}</td>
                        <td>{e ? f(e.maximo) : "—"}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </section>

          <section className={estilos.painel}>
            <h2>Gravação</h2>
            <div className={estilos.gravacaoContinua}>
              <img src={gravando} width={18} height={18} alt="" />
              <div>
                <p className={estilos.forte}>Gravação contínua ativa</p>
                <p>As 16 células gravam uma leitura a cada 20 s, o tempo todo, guardada por 4 meses aqui e por 1 ano no servidor do CNPEM.</p>
              </div>
            </div>
            <div className={estilos.diagnostico}>
              <p className={estilos.forte}>Gravação de diagnóstico</p>
              <p>
                Grava também todas as mensagens MQTT das células escolhidas ({celulas.join(" e ") || "nenhuma"}) e marca o trecho para
                análise.
              </p>
              <div className={estilos.linhaDiagnostico}>
                <Campo rotulo="Nome" tipo="texto" valor={nomeGravacao} onChange={setNomeGravacao} />
                <span className={estilos.duracao}>
                  <Campo rotulo="Duração" valor={duracaoGravacao} onChange={setDuracaoGravacao} unidade="h" />
                </span>
              </div>
              <Botao tipo="primario" cheio indisponivel="Ainda não disponível: o consumidor não grava as mensagens MQTT brutas.">
                Iniciar gravação de diagnóstico
              </Botao>
            </div>
            <div className={estilos.sessoes}>
              <p className={estilos.ajuda}>Sessões salvas</p>
              {[
                { nome: "Queda de conexão", detalhe: "22/10 · 13:30 a 14:30 · 186 mensagens" },
                { nome: "Teste de setpoint", detalhe: "06/10 · 08:00 a 09:00 · 192 mensagens" },
              ].map((s) => (
                <div key={s.nome} className={estilos.sessao}>
                  <div>
                    <p className={estilos.sessaoNome}>{s.nome}</p>
                    <p>{s.detalhe}</p>
                  </div>
                  <button type="button" aria-disabled title="Ainda não disponível: a API não guarda sessões de diagnóstico.">
                    <img src={baixar} width={16} height={16} alt="Baixar" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
