// Telas "Exportar dados" e "Exportar dados · por célula e período" do Figma
// (nós 86:1336 e 211:1928), escolhidas pelo seletor "O que exportar".
// Hoje a API só exporta as leituras brutas de uma célula em CSV
// (GET /celulas/{id}/leituras.csv). Os outros formatos e agrupamentos ficam
// como no Figma, mas o botão explica que ainda não estão disponíveis.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import arquivo12 from "@/assets/icones/arquivo-12.svg";
import arquivo16 from "@/assets/icones/arquivo-16.svg";
import baixar from "@/assets/icones/baixar-16.svg";
import iconeInfo from "@/assets/icones/info-14.svg";
import radioDesmarcado from "@/assets/icones/radio-desmarcado.svg";
import radioMarcado from "@/assets/icones/radio-marcado.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import { Campo } from "@/compartilhado/componentes/Campo";
import * as formatar from "@/compartilhado/formatar";
import { celulasIniciais, useCelulas } from "@/dados/useCelulas";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { fechado, ROTULO_DO_STATUS } from "@/funcionalidades/experimentos/modelo";
import estilos from "./Exportar.module.css";

type Modo = "experimento" | "celula";
type Agrupamento = "brutos" | "hora" | "dia" | "intervalo";
type Formato = "xlsx" | "csv";

const LEITURAS_POR_HORA = 180; // uma a cada 20 s
const HORA = 3_600_000;

const AGRUPAMENTOS: { valor: Exclude<Agrupamento, "intervalo">; titulo: string; texto: string }[] = [
  { valor: "brutos", titulo: "Dados brutos", texto: "Uma linha por leitura, a cada 20 s" },
  { valor: "hora", titulo: "Média por hora", texto: "Média, mínimo e máximo de cada hora" },
  { valor: "dia", titulo: "Média por dia", texto: "Bom para ver o experimento inteiro" },
];

/** Valor de <input type="datetime-local">, no fuso da máquina. */
function paraEntrada(data: Date): string {
  const local = new Date(data.getTime() - data.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function listaDeCelulas(ids: string[]): string {
  if (ids.length <= 3) return `${ids.length} (${ids.join(" e ").replace(/ e (?=.* e )/g, ", ")})`;
  return String(ids.length);
}

function Opcao({ ativa, onClick, children, mono = false }: { ativa: boolean; onClick: () => void; children: string; mono?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={ativa}
      className={`${ativa ? estilos.chipAtivo : estilos.chip} ${mono ? estilos.mono : ""}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function Exportar() {
  const { experimentos: lista, buscar, carregarDetalhe } = useExperimentos();
  // A lista da API não traz as células; o detalhe do experimento escolhido traz.
  const experimentos = lista.map((e) => buscar(e.codigo) ?? e);
  const { ids: todasAsCelulas, nome } = useCelulas();
  const [parametros] = useSearchParams();
  const agora = useMemo(() => new Date(), []);
  const [modo, setModo] = useState<Modo>(parametros.get("celulas") ? "celula" : "experimento");
  const [codigo, setCodigo] = useState(parametros.get("experimento") ?? experimentos[0]?.codigo ?? "");
  const experimento = experimentos.find((e) => e.codigo === codigo);
  const celulasDoExperimento = experimento?.celulas.map((c) => c.id) ?? [];
  const [doExperimento, setDoExperimento] = useState<string[] | "todas">("todas");
  // `null`: ainda não mexeu, vale a escolha inicial (que depende das células carregadas).
  const [escolhaAvulsa, setAvulsas] = useState<string[] | null>(parametros.get("celulas")?.split(",") ?? null);
  const avulsas = escolhaAvulsa ?? celulasIniciais(todasAsCelulas);
  useEffect(() => {
    if (codigo) carregarDetalhe(codigo).catch(() => {});
    // carregarDetalhe muda a cada render do provider; o código basta.
  }, [codigo]);
  const [de, setDe] = useState(() => paraEntrada(new Date(agora.getTime() - 12 * HORA)));
  const [ate, setAte] = useState(() => paraEntrada(agora));
  const [medidas, setMedidas] = useState({ temperatura: true, od: true, odBruta: true, ph: true, taxa: true });
  const [agrupamento, setAgrupamento] = useState<Agrupamento>("hora");
  const [intervalo, setIntervalo] = useState("15");
  const [formato, setFormato] = useState<Formato>("xlsx");
  const [anexos, setAnexos] = useState({ contexto: true, parametros: true, alertas: true, calibracoes: false });
  const [grafico, setGrafico] = useState<"png" | "svg" | "pdf">("svg");

  const escolhidas = modo === "experimento" ? (doExperimento === "todas" ? celulasDoExperimento : doExperimento) : avulsas;

  // No modo experimento, o período é o do experimento.
  const inicio = modo === "experimento" ? (experimento?.inicio ?? agora) : new Date(de);
  const fim = modo === "experimento" ? (experimento?.fim ?? agora) : new Date(ate);
  const horas = Math.max(0, (fim.getTime() - inicio.getTime()) / HORA);
  const minutos = Number(intervalo) || 15;
  const linhasPorCelula = Math.round(
    agrupamento === "brutos" ? horas * LEITURAS_POR_HORA : agrupamento === "hora" ? horas : agrupamento === "dia" ? horas / 24 : (horas * 60) / minutos,
  );
  const periodo = horas >= 48 ? `${Math.round(horas / 24)} dias` : `${Math.round(horas)} horas`;
  const rotuloAgrupamento =
    agrupamento === "intervalo" ? `a cada ${minutos} min` : { brutos: "dados brutos", hora: "média por hora", dia: "média por dia" }[agrupamento];

  const abas = [
    "Dados",
    ...(anexos.contexto ? [modo === "experimento" ? "Metadados" : "Contexto"] : []),
    ...(anexos.parametros ? ["Parâmetros"] : []),
    ...(anexos.alertas ? ["Alertas"] : []),
    ...(anexos.calibracoes ? ["Calibrações"] : []),
  ];

  // O que a API já sabe fazer: leituras brutas em CSV, um arquivo por célula.
  const disponivel = formato === "csv" && agrupamento === "brutos";
  const motivo = disponivel
    ? undefined
    : "Ainda não disponível: a API só exporta as leituras brutas em CSV. Escolha Dados brutos e CSV.";

  function exportar() {
    for (const id of escolhidas) {
      const link = document.createElement("a");
      link.href = `/api/celulas/${encodeURIComponent(id)}/leituras.csv`;
      link.download = `${id}.csv`;
      link.click();
    }
  }

  function alternarDoExperimento(id: string) {
    const atuais = doExperimento === "todas" ? celulasDoExperimento : doExperimento;
    const novas = atuais.includes(id) ? atuais.filter((c) => c !== id) : [...atuais, id];
    setDoExperimento(novas.length === celulasDoExperimento.length ? "todas" : novas);
  }

  return (
    <div className={estilos.tela}>
      <header className={estilos.cabecalho}>
        <h1>Exportar dados</h1>
        <p>Exporte por experimento ou direto do historiador, escolhendo as células e o período.</p>
      </header>

      <div className={estilos.corpo}>
        <div className={estilos.coluna}>
          <section className={estilos.painel}>
            <h2 className={estilos.painelTitulo}>O que exportar</h2>
            <div className={estilos.modo} role="radiogroup" aria-label="O que exportar">
              {(["experimento", "celula"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={modo === m} className={modo === m ? estilos.modoAtivo : estilos.modoItem} onClick={() => setModo(m)}>
                  {m === "experimento" ? "Por experimento" : "Por célula e período"}
                </button>
              ))}
            </div>

            {modo === "experimento" ? (
              <>
                <label className={estilos.campoSeletor}>
                  <span>Experimento</span>
                  <select
                    className={estilos.seletor}
                    value={codigo}
                    onChange={(e) => {
                      setCodigo(e.target.value);
                      setDoExperimento("todas");
                    }}
                  >
                    {experimentos.map((e) => (
                      <option key={e.codigo} value={e.codigo}>
                        {e.codigo} · {e.nome}
                        {fechado(e) ? ` · ${ROTULO_DO_STATUS[e.status]}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {experimento && fechado(experimento) && (
                  <p className={estilos.avisoFechado}>
                    {ROTULO_DO_STATUS[experimento.status]}
                    {experimento.fim && ` em ${formatar.data(experimento.fim)}`}
                    {experimento.status === "cancelado" && ` · motivo: ${experimento.motivoCancelamento ?? "não informado"}`}. Os dados
                    continuam disponíveis para exportar.
                  </p>
                )}
                <div className={estilos.grupo}>
                  <span className={estilos.rotulo}>Células</span>
                  {celulasDoExperimento.length === 0 ? (
                    <p className={estilos.ajuda}>Este experimento ainda não tem células.</p>
                  ) : (
                    <div className={estilos.chips}>
                      <Opcao ativa={doExperimento === "todas"} onClick={() => setDoExperimento(doExperimento === "todas" ? [] : "todas")}>
                        {`Todas · ${celulasDoExperimento.length}`}
                      </Opcao>
                      {celulasDoExperimento.map((id) => (
                        <Opcao key={id} mono ativa={escolhidas.includes(id)} onClick={() => alternarDoExperimento(id)}>
                          {nome(id)}
                        </Opcao>
                      ))}
                    </div>
                  )}
                </div>
                <div className={estilos.periodo}>
                  <div className={estilos.campoSeletor}>
                    <span>De</span>
                    <div className={estilos.data}>{experimento?.inicio ? formatar.data(experimento.inicio) : "não iniciado"}</div>
                  </div>
                  <div className={estilos.campoSeletor}>
                    <span>Até</span>
                    <div className={estilos.data}>{experimento?.fim ? formatar.data(experimento.fim) : `${formatar.data(agora)} · agora`}</div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className={estilos.grupo}>
                  <span className={estilos.rotulo}>Células · qualquer célula, com ou sem experimento</span>
                  <div className={estilos.chips}>
                    {todasAsCelulas.map((id) => (
                      <Opcao
                        key={id}
                        mono
                        ativa={avulsas.includes(id)}
                        onClick={() => setAvulsas(avulsas.includes(id) ? avulsas.filter((c) => c !== id) : [...avulsas, id].sort())}
                      >
                        {nome(id)}
                      </Opcao>
                    ))}
                  </div>
                </div>
                <div className={estilos.periodo}>
                  <label className={estilos.campoSeletor}>
                    <span>De</span>
                    <input className={estilos.data} type="datetime-local" value={de} max={ate} onChange={(e) => setDe(e.target.value)} />
                  </label>
                  <label className={estilos.campoSeletor}>
                    <span>Até</span>
                    <input className={estilos.data} type="datetime-local" value={ate} min={de} onChange={(e) => setAte(e.target.value)} />
                  </label>
                </div>
              </>
            )}

            <div className={estilos.grupo}>
              <span className={estilos.rotulo}>Medidas</span>
              <div className={estilos.medidas}>
                <CaixaDeSelecao marcada={medidas.temperatura} onChange={(v) => setMedidas({ ...medidas, temperatura: v })}>Temperatura</CaixaDeSelecao>
                <CaixaDeSelecao marcada={medidas.ph} onChange={(v) => setMedidas({ ...medidas, ph: v })}>pH</CaixaDeSelecao>
                <CaixaDeSelecao marcada={medidas.od} onChange={(v) => setMedidas({ ...medidas, od: v })}>Densidade óptica</CaixaDeSelecao>
                <CaixaDeSelecao marcada={medidas.taxa} onChange={(v) => setMedidas({ ...medidas, taxa: v })}>Taxa de crescimento</CaixaDeSelecao>
                <CaixaDeSelecao marcada={medidas.odBruta} onChange={(v) => setMedidas({ ...medidas, odBruta: v })}>OD bruta do sensor</CaixaDeSelecao>
                <CaixaDeSelecao marcada={false} desabilitada titulo="A placa ainda não manda esses dados.">
                  Agitação e volume · em breve
                </CaixaDeSelecao>
              </div>
            </div>
          </section>

          <section className={estilos.painel}>
            <div>
              <h2 className={estilos.painelTitulo}>Como agrupar as leituras</h2>
              <p className={estilos.painelTexto}>Os dados brutos sempre ficam guardados. O agrupamento muda só o arquivo.</p>
            </div>
            <div className={estilos.agrupamentos} role="radiogroup" aria-label="Agrupamento">
              {AGRUPAMENTOS.map((a) => (
                <button
                  key={a.valor}
                  type="button"
                  role="radio"
                  aria-checked={agrupamento === a.valor}
                  className={agrupamento === a.valor ? estilos.agrupamentoAtivo : estilos.agrupamento}
                  onClick={() => setAgrupamento(a.valor)}
                >
                  <img src={agrupamento === a.valor ? radioMarcado : radioDesmarcado} width={16} height={16} alt="" />
                  <span className={estilos.agrupamentoTextos}>
                    <span className={estilos.agrupamentoTitulo}>{a.titulo}</span>
                    <span>{a.texto}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className={estilos.intervalo}>
              <span>Ou escolha um intervalo:</span>
              <span className={estilos.intervaloCampo} data-ativo={agrupamento === "intervalo" || undefined} onFocus={() => setAgrupamento("intervalo")}>
                <Campo rotulo="Intervalo em minutos" rotuloOculto valor={intervalo} onChange={setIntervalo} unidade="min" />
              </span>
            </div>
          </section>

          <section className={estilos.painel}>
            <h2 className={estilos.painelTitulo}>Formato e anexos</h2>
            <div className={estilos.chips}>
              <Opcao ativa={formato === "xlsx"} onClick={() => setFormato("xlsx")}>Excel (.xlsx)</Opcao>
              <Opcao ativa={formato === "csv"} onClick={() => setFormato("csv")}>CSV</Opcao>
            </div>
            <div className={estilos.grupo}>
              <span className={estilos.rotulo}>Incluir no arquivo</span>
              <div className={estilos.anexos}>
                <CaixaDeSelecao marcada={anexos.contexto} onChange={(v) => setAnexos({ ...anexos, contexto: v })}>
                  {modo === "experimento"
                    ? "Metadados do experimento (organismo, meio, volume, fases)"
                    : "Experimentos em que as células estavam no período, se houver"}
                </CaixaDeSelecao>
                <CaixaDeSelecao marcada={anexos.parametros} onChange={(v) => setAnexos({ ...anexos, parametros: v })}>
                  Histórico de parâmetros: quem mudou, quando e para quanto
                </CaixaDeSelecao>
                <CaixaDeSelecao marcada={anexos.alertas} onChange={(v) => setAnexos({ ...anexos, alertas: v })}>
                  Alertas do período
                </CaixaDeSelecao>
                <CaixaDeSelecao marcada={anexos.calibracoes} onChange={(v) => setAnexos({ ...anexos, calibracoes: v })}>
                  Calibrações de OD usadas
                </CaixaDeSelecao>
              </div>
            </div>
          </section>
        </div>

        <aside className={estilos.lateral}>
          <section className={estilos.painel}>
            <h2 className={estilos.painelTitulo}>Resumo do arquivo</h2>
            <dl className={estilos.resumo}>
              <div>
                <dt>Células</dt>
                <dd>{escolhidas.length === 0 ? "nenhuma" : listaDeCelulas(escolhidas)}</dd>
              </div>
              <div>
                <dt>Período</dt>
                <dd>{periodo}</dd>
              </div>
              <div>
                <dt>Agrupamento</dt>
                <dd>{rotuloAgrupamento}</dd>
              </div>
              <div>
                <dt>Linhas</dt>
                <dd>
                  {modo === "experimento"
                    ? `cerca de ${formatar.inteiro(Math.round((linhasPorCelula * escolhidas.length) / 100) * 100)}`
                    : `${formatar.inteiro(linhasPorCelula)} por célula`}
                </dd>
              </div>
              <div>
                <dt>Formato</dt>
                <dd>{formato === "xlsx" ? `Excel, ${abas.length} abas` : `CSV, ${escolhidas.length} ${escolhidas.length === 1 ? "arquivo" : "arquivos"}`}</dd>
              </div>
            </dl>
            {formato === "xlsx" && (
              <div className={estilos.abas}>
                {abas.map((aba) => (
                  <span key={aba} className={estilos.aba}>
                    <img src={arquivo12} width={12} height={12} alt="" />
                    {aba}
                  </span>
                ))}
              </div>
            )}
            <Botao tipo="primario" cheio indisponivel={escolhidas.length === 0 ? "Escolha pelo menos uma célula." : motivo} onClick={exportar}>
              {formato === "xlsx" ? "Exportar Excel" : "Exportar CSV"}
            </Botao>
            <div className={estilos.nota}>
              <img src={iconeInfo} width={14} height={14} alt="" />
              <p>
                {modo === "experimento"
                  ? "Dados com mais de 4 meses vêm do arquivo no servidor e podem demorar alguns minutos. Nesse caso, você recebe um e-mail quando o arquivo ficar pronto."
                  : "As medições vêm direto do historiador, sem depender de experimento. Bom para a engenharia avaliar o equipamento."}
              </p>
            </div>
          </section>

          <section className={estilos.painel}>
            <div>
              <h2 className={estilos.painelTitulo}>Gráficos para publicação</h2>
              <p className={estilos.painelTexto}>Os gráficos do experimento em alta resolução, com fundo branco.</p>
            </div>
            <label className={estilos.campoSeletor}>
              <span>Gráfico</span>
              <select className={estilos.seletor} defaultValue="taxa">
                <option value="taxa">Taxa de crescimento por condição</option>
                <option value="od">Densidade óptica no tempo</option>
                <option value="temperatura">Temperatura no tempo</option>
              </select>
            </label>
            <div className={estilos.chips}>
              {(["png", "svg", "pdf"] as const).map((f) => (
                <Opcao key={f} ativa={grafico === f} onClick={() => setGrafico(f)}>
                  {f.toUpperCase()}
                </Opcao>
              ))}
            </div>
            <div>
              <Botao indisponivel="Ainda não disponível: a API não gera gráficos.">Baixar gráfico</Botao>
            </div>
          </section>

          <section className={estilos.painel}>
            <h2 className={estilos.painelTitulo}>Exportações recentes</h2>
            {[
              { nome: "EXP-02 · média por hora · .xlsx", detalhe: "22/10 às 17:40 · Pedro Ximenes" },
              { nome: "EXP-04 · dados brutos · .csv", detalhe: "30/09 às 09:12 · Henry Piozzi" },
            ].map((r) => (
              <div key={r.nome} className={estilos.recente}>
                <img src={arquivo16} width={16} height={16} alt="" />
                <span className={estilos.recenteTextos}>
                  <span className={estilos.recenteNome}>{r.nome}</span>
                  <span>{r.detalhe}</span>
                </span>
                <button type="button" className={estilos.baixar} title="Ainda não disponível: a API não guarda as exportações." aria-disabled>
                  <img src={baixar} width={16} height={16} alt="Baixar de novo" />
                </button>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
