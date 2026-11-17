// Telas "Exportar dados" e "Exportar dados · por célula e período" do Figma
// (nós 86:1336 e 211:1928), escolhidas pelo seletor "O que exportar".
// O arquivo vem do POST /exportacoes: por experimento, cada célula no período
// em que esteve nele; por célula, o período escolhido. A API agrupa, calcula
// a taxa e monta o Excel (com os anexos em abas) ou o CSV (só os dados).
// Gráficos para publicação ainda não existem na API.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { exportarDados, type PedidoDeExportacao } from "@/api/cliente";
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
import { FONTE_DADOS } from "@/dados/fonte";
import { celulasIniciais, useCelulas } from "@/dados/useCelulas";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { fechado, ROTULO_DO_STATUS } from "@/funcionalidades/experimentos/modelo";
import { useSessao } from "@/sessao/SessaoProvider";
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

/** Uma exportação já feita neste navegador, para baixar de novo. */
interface Recente {
  nome: string;
  quando: string;
  por: string;
  pedido: PedidoDeExportacao;
}

const CHAVE_DAS_RECENTES = "tupa.exportacoes";
const MAXIMO_DE_RECENTES = 5;

// As do Figma, para o modo exemplo.
const RECENTES_DE_EXEMPLO = [
  { nome: "EXP-02 · média por hora · .xlsx", detalhe: "22/10 às 17:40 · Pedro Ximenes" },
  { nome: "EXP-04 · dados brutos · .csv", detalhe: "30/09 às 09:12 · Henry Piozzi" },
];

function lerRecentes(): Recente[] {
  try {
    const guardadas = JSON.parse(localStorage.getItem(CHAVE_DAS_RECENTES) ?? "[]");
    return Array.isArray(guardadas) ? guardadas : [];
  } catch {
    return [];
  }
}

function guardarRecentes(recentes: Recente[]): void {
  try {
    localStorage.setItem(CHAVE_DAS_RECENTES, JSON.stringify(recentes));
  } catch {
    // Sem armazenamento (janela anônima, por exemplo): a lista vale só até fechar a tela.
  }
}

function salvarArquivo(arquivo: Blob, nome: string): void {
  const endereco = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = endereco;
  link.download = nome;
  link.click();
  setTimeout(() => URL.revokeObjectURL(endereco), 1000);
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
  const { usuario } = useSessao();
  const [parametros] = useSearchParams();
  const agora = useMemo(() => new Date(), []);
  const [modo, setModo] = useState<Modo>(parametros.get("celulas") ? "celula" : "experimento");
  const [codigo, setCodigo] = useState(parametros.get("experimento") ?? experimentos[0]?.codigo ?? "");
  const experimento = experimentos.find((e) => e.codigo === codigo);
  // Uma célula que voltou ao experimento tem dois cultivos, mas aparece uma vez só.
  const celulasDoExperimento = [...new Set(experimento?.celulas.map((c) => c.id) ?? [])];
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
  const [baixando, setBaixando] = useState(false);
  const [erroDoDownload, setErroDoDownload] = useState<string | null>(null);
  const [recentes, setRecentes] = useState<Recente[]>(lerRecentes);

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

  // A taxa é a inclinação de ln(OD) dentro de cada intervalo: não existe numa leitura só.
  const brutos = agrupamento === "brutos";
  const medidasDoPedido: PedidoDeExportacao["medidas"] = [
    ...(medidas.temperatura ? (["temperatura"] as const) : []),
    ...(medidas.ph ? (["ph"] as const) : []),
    ...(medidas.od ? (["od"] as const) : []),
    ...(medidas.odBruta ? (["od_bruta"] as const) : []),
    ...(medidas.taxa && !brutos ? (["taxa"] as const) : []),
  ];
  const intervaloValido = Number.isInteger(Number(intervalo)) && Number(intervalo) >= 1 && Number(intervalo) <= 1440;

  // Por que o botão não exporta, se for o caso.
  const motivo =
    FONTE_DADOS !== "api"
      ? "O modo exemplo não tem leituras para exportar. Suba a interface com VITE_FONTE_DADOS=api."
      : escolhidas.length === 0
        ? "Escolha pelo menos uma célula."
        : medidasDoPedido.length === 0
          ? medidas.taxa
            ? "A taxa de crescimento só entra nos arquivos agrupados. Escolha outra medida ou um agrupamento."
            : "Escolha pelo menos uma medida."
          : modo === "celula" && !(inicio.getTime() < fim.getTime())
            ? "O período precisa terminar depois de começar."
            : agrupamento === "intervalo" && !intervaloValido
              ? "O intervalo vai de 1 a 1440 minutos, sem casas decimais."
              : undefined;

  const semAnexos = formato === "csv" ? "Os anexos são abas do Excel. O CSV leva só os dados." : undefined;

  function montarPedido(): PedidoDeExportacao {
    return {
      ...(modo === "experimento"
        ? { id_experimento: experimento?.id, ...(doExperimento === "todas" ? {} : { celulas: escolhidas }) }
        : { celulas: escolhidas, desde: inicio.toISOString(), ate: fim.toISOString() }),
      medidas: medidasDoPedido,
      agrupamento,
      ...(agrupamento === "intervalo" ? { intervalo_min: Number(intervalo) } : {}),
      formato,
      // O CSV leva só os dados; os anexos são abas do Excel.
      anexos:
        formato === "csv"
          ? []
          : (["contexto", "parametros", "alertas", "calibracoes"] as const).filter((anexo) => anexos[anexo]),
      // As datas do arquivo saem no fuso deste computador.
      fuso: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
    };
  }

  // A rota exige login: o arquivo vem pela chamada com token e o navegador
  // salva o que chegou. `rotulo` é o nome na lista de recentes; sem ele, é
  // um "baixar de novo", que não entra na lista outra vez.
  async function baixarArquivo(pedido: PedidoDeExportacao, rotulo?: string) {
    if (baixando) return;
    setErroDoDownload(null);
    setBaixando(true);
    try {
      const { arquivo, nome: nomeDoArquivo } = await exportarDados(pedido);
      salvarArquivo(arquivo, nomeDoArquivo);
      if (rotulo) {
        const novas = [
          { nome: rotulo, quando: new Date().toISOString(), por: usuario?.nome ?? "", pedido },
          ...recentes.filter((r) => r.nome !== rotulo),
        ].slice(0, MAXIMO_DE_RECENTES);
        setRecentes(novas);
        guardarRecentes(novas);
      }
    } catch (falha) {
      setErroDoDownload(mensagemDoErro(falha));
    } finally {
      setBaixando(false);
    }
  }

  function exportar() {
    const origem =
      modo === "experimento"
        ? `${codigo}${doExperimento === "todas" ? "" : ` · ${escolhidas.length} de ${celulasDoExperimento.length} células`}`
        : escolhidas.length <= 3
          ? escolhidas.map(nome).join(", ")
          : `${escolhidas.length} células`;
    return baixarArquivo(montarPedido(), `${origem} · ${rotuloAgrupamento} · .${formato}`);
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
                <CaixaDeSelecao
                  marcada={medidas.taxa && !brutos}
                  desabilitada={brutos}
                  titulo={brutos ? "A taxa é calculada dentro de cada intervalo: só entra nos arquivos agrupados." : undefined}
                  onChange={(v) => setMedidas({ ...medidas, taxa: v })}
                >
                  {brutos ? "Taxa de crescimento · só nos agrupados" : "Taxa de crescimento"}
                </CaixaDeSelecao>
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
              <span className={estilos.rotulo}>
                {formato === "csv" ? "Incluir no arquivo · só no Excel, o CSV leva só os dados" : "Incluir no arquivo"}
              </span>
              <div className={estilos.anexos}>
                <CaixaDeSelecao marcada={anexos.contexto && formato === "xlsx"} desabilitada={formato === "csv"} titulo={semAnexos} onChange={(v) => setAnexos({ ...anexos, contexto: v })}>
                  {modo === "experimento"
                    ? "Metadados do experimento (organismo, meio, volume, fases)"
                    : "Experimentos em que as células estavam no período, se houver"}
                </CaixaDeSelecao>
                <CaixaDeSelecao marcada={anexos.parametros && formato === "xlsx"} desabilitada={formato === "csv"} titulo={semAnexos} onChange={(v) => setAnexos({ ...anexos, parametros: v })}>
                  Histórico de parâmetros: quem mudou, quando e para quanto
                </CaixaDeSelecao>
                <CaixaDeSelecao marcada={anexos.alertas && formato === "xlsx"} desabilitada={formato === "csv"} titulo={semAnexos} onChange={(v) => setAnexos({ ...anexos, alertas: v })}>
                  Alertas do período
                </CaixaDeSelecao>
                <CaixaDeSelecao marcada={anexos.calibracoes && formato === "xlsx"} desabilitada={formato === "csv"} titulo={semAnexos} onChange={(v) => setAnexos({ ...anexos, calibracoes: v })}>
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
                <dd>{formato === "xlsx" ? `Excel, ${abas.length} ${abas.length === 1 ? "aba" : "abas"}` : "CSV, 1 arquivo"}</dd>
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
            <Botao
              tipo="primario"
              cheio
              ocupado={baixando}
              indisponivel={motivo}
              onClick={exportar}
            >
              {baixando ? "Baixando..." : formato === "xlsx" ? "Exportar Excel" : "Exportar CSV"}
            </Botao>
            {motivo && <p className={estilos.ajuda}>{motivo}</p>}
            {erroDoDownload && (
              <p className={estilos.erroDoDownload} role="alert">
                {erroDoDownload}
              </p>
            )}
            <div className={estilos.nota}>
              <img src={iconeInfo} width={14} height={14} alt="" />
              <p>
                {modo === "experimento"
                  ? "Cada célula sai no período em que esteve no experimento. As datas do arquivo ficam no horário deste computador."
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
            {FONTE_DADOS !== "api" ? (
              RECENTES_DE_EXEMPLO.map((r) => (
                <div key={r.nome} className={estilos.recente}>
                  <img src={arquivo16} width={16} height={16} alt="" />
                  <span className={estilos.recenteTextos}>
                    <span className={estilos.recenteNome}>{r.nome}</span>
                    <span>{r.detalhe}</span>
                  </span>
                  <button type="button" className={estilos.baixar} title="O modo exemplo não tem leituras para exportar." aria-disabled>
                    <img src={baixar} width={16} height={16} alt="Baixar de novo" />
                  </button>
                </div>
              ))
            ) : recentes.length === 0 ? (
              <p className={estilos.ajuda}>Nenhuma exportação feita neste navegador ainda.</p>
            ) : (
              // A API não guarda os arquivos: baixar de novo refaz o mesmo pedido, com os dados de agora.
              recentes.map((r) => (
                <div key={r.nome} className={estilos.recente}>
                  <img src={arquivo16} width={16} height={16} alt="" />
                  <span className={estilos.recenteTextos}>
                    <span className={estilos.recenteNome}>{r.nome}</span>
                    <span>
                      {formatar.diaHora(new Date(r.quando))}
                      {r.por && ` · ${r.por}`}
                    </span>
                  </span>
                  <button type="button" className={estilos.baixar} title="Baixar de novo, com os dados de agora" onClick={() => baixarArquivo(r.pedido)}>
                    <img src={baixar} width={16} height={16} alt="Baixar de novo" />
                  </button>
                </div>
              ))
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
