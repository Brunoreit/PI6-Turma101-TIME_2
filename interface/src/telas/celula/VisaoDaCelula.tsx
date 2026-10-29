// Tela "Célula c08 · visão da célula" do Figma (nó 105:1629).

import { useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import iconeAgitacao from "../../assets/icones/agitacao.svg";
import iconeBombas from "../../assets/icones/bombas.svg";
import iconeCadeado from "../../assets/icones/cadeado.svg";
import iconeChama from "../../assets/icones/chama.svg";
import iconeCheckCirculo from "../../assets/icones/check-circulo.svg";
import iconeCheckEtapa from "../../assets/icones/check-etapa.svg";
import etiquetaAgitacao from "../../assets/icones/etiqueta-agitacao.svg";
import etiquetaDescarte from "../../assets/icones/etiqueta-descarte.svg";
import etiquetaEntrada from "../../assets/icones/etiqueta-entrada.svg";
import etiquetaOd from "../../assets/icones/etiqueta-od.svg";
import etiquetaPh from "../../assets/icones/etiqueta-ph.svg";
import etiquetaTemperatura from "../../assets/icones/etiqueta-temperatura.svg";
import iconeFrasco from "../../assets/icones/frasco.svg";
import iconeGota from "../../assets/icones/gota.svg";
import iconeInfo from "../../assets/icones/info.svg";
import interruptorLigado from "../../assets/icones/interruptor-ligado.svg";
import iconeSemConexao from "../../assets/icones/sem-conexao.svg";
import iconeSino from "../../assets/icones/sino.svg";
import iconeTermometro from "../../assets/icones/termometro.svg";
import frascoTupa from "../../assets/ilustracoes/frasco-tupa.svg";
import { Botao, SEM_API } from "../../componentes/Botao";
import { GraficoDeLinha } from "../../componentes/GraficoDeLinha";
import { SeloDeStatus } from "../../componentes/SeloDeStatus";
import { enviarSetpoint } from "../../dados/fonteCelula";
import * as formatar from "../../dados/formatar";
import type { SituacaoCelula } from "../../dados/modelo";
import {
  TEMPERATURA_MAX_C,
  TEMPERATURA_MIN_C,
  type DetalheDaCelula,
  type EstadoDoPedido,
  type ExperimentoDaCelula,
  type Periodo,
} from "../../dados/modeloCelula";
import { useCelula } from "../../dados/useCelula";
import { CabecalhoDaCelula, CarregandoCelula } from "./CabecalhoDaCelula";
import comum from "./Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

const SELO: Record<SituacaoCelula, string> = { online: "Em operação", alerta: "Com alerta", offline: "Offline" };

const traco = (valor: number | null, formato: (v: number) => string) => (valor === null ? "—" : formato(valor));

function temperaturaAlvo(dados: DetalheDaCelula): number | null {
  if (dados.experimento?.alvoC != null) return dados.experimento.alvoC;
  if (dados.pedido && dados.pedido.estado !== "recusado") return dados.pedido.temperaturaC;
  return null;
}

function faixaDePh(experimento: DetalheDaCelula["experimento"]): [number, number] | null {
  if (!experimento || experimento.phMin === null || experimento.phMax === null) return null;
  return [experimento.phMin, experimento.phMax];
}

// ---------------------------------------------------------------- faixa de status

function Caixa({ rotulo, valor, mono = false }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <div className={estilos.caixa}>
      <span className={estilos.caixaRotulo}>{rotulo}</span>
      <span className={mono ? `${estilos.caixaValor} ${comum.mono}` : estilos.caixaValor}>{valor}</span>
    </div>
  );
}

function FaixaDeStatus({ dados }: { dados: DetalheDaCelula }) {
  const { experimento, placa } = dados;
  const alvo = temperaturaAlvo(dados);

  let nome = "Experimento não informado pela API";
  let detalhe = "A API ainda não devolve o experimento da célula.";
  if (experimento === null) {
    nome = "Livre · sem experimento";
    detalhe = "A célula está disponível para um novo experimento.";
  } else if (experimento) {
    nome = `${experimento.codigo} · ${experimento.nome}`;
    detalhe = `${experimento.modo} · na célula desde ${formatar.data(experimento.naCelulaDesde)} · responsável ${experimento.responsavel}`;
  }

  return (
    <section className={estilos.faixaStatus} aria-label="Situação da célula">
      <div className={estilos.experimento}>
        <div className={estilos.experimentoLinha}>
          <SeloDeStatus situacao={dados.situacao} rotulo={SELO[dados.situacao]} />
          <span className={estilos.experimentoNome}>{nome}</span>
        </div>
        <p className={estilos.experimentoDetalhe}>{detalhe}</p>
      </div>
      <Caixa rotulo="Dia do experimento" valor={experimento ? `${experimento.dia} de ${experimento.duracaoDias}` : "—"} />
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

// ---------------------------------------------------------------- parâmetros

interface Medida {
  icone: string;
  nome: string;
  etiqueta: { texto: string; ativa: boolean };
  valor: string;
  unidade?: string;
  detalhe: string;
  /** Quanto da barra fica preenchido, de 0 a 1. */
  fracao: number | null;
  corDaBarra: "marca" | "neutra" | "ok" | "alerta";
}

const entre = (valor: number, minimo: number, maximo: number) =>
  Math.min(Math.max((valor - minimo) / (maximo - minimo), 0), 1);

function CardDeMedida({ medida }: { medida: Medida }) {
  return (
    <div className={estilos.medida}>
      <div className={estilos.medidaTopo}>
        <img src={medida.icone} width={18} height={18} alt="" />
        <span className={estilos.medidaNome}>{medida.nome}</span>
        <span className={medida.etiqueta.ativa ? estilos.etiquetaAtiva : estilos.etiquetaNeutra}>
          {medida.etiqueta.texto}
        </span>
      </div>
      <p className={estilos.medidaValor}>
        <span className={estilos.medidaNumero}>{medida.valor}</span>
        {medida.unidade && <span className={estilos.medidaUnidade}>{medida.unidade}</span>}
      </p>
      <p className={estilos.medidaDetalhe}>{medida.detalhe}</p>
      <div className={estilos.barra}>
        {medida.fracao !== null && (
          <span className={`${estilos.preenchimento} ${estilos[medida.corDaBarra]}`} style={{ width: `${medida.fracao * 100}%` }} />
        )}
      </div>
    </div>
  );
}

function Parametros({ dados }: { dados: DetalheDaCelula }) {
  const alvo = temperaturaAlvo(dados);
  const faixa = faixaDePh(dados.experimento);
  const offline = dados.situacao === "offline";
  const phForaDaFaixa = faixa !== null && dados.ph !== null && (dados.ph < faixa[0] || dados.ph > faixa[1]);

  // Escalas das barras: temperatura de 0 a 50 °C, OD de 0 até 0,8 (fim da
  // faixa confiável da calibração) e pH de 4 a 8.
  const medidas: Medida[] = [
    {
      icone: iconeTermometro,
      nome: "Temperatura",
      etiqueta: { texto: offline ? "Sem controle" : alvo === null ? "Sem alvo" : "Controlando", ativa: !offline && alvo !== null },
      valor: traco(dados.temperaturaC, (v) => formatar.decimal(v, 1)),
      unidade: "°C",
      detalhe: alvo === null ? "Sem temperatura alvo" : `Alvo: ${formatar.temperatura(alvo)}`,
      fracao: dados.temperaturaC === null ? null : entre(dados.temperaturaC, 0, 50),
      corDaBarra: "marca",
    },
    {
      icone: iconeFrasco,
      nome: "Densidade óptica",
      etiqueta: { texto: "Só leitura", ativa: false },
      valor: traco(dados.od, (v) => formatar.decimal(v, 3)),
      unidade: "OD",
      detalhe: `Valor bruto: ${traco(dados.odBruto, formatar.inteiro)}`,
      fracao: dados.od === null ? null : entre(dados.od, 0, 0.8),
      corDaBarra: "neutra",
    },
    {
      icone: iconeGota,
      nome: "pH",
      etiqueta: { texto: "Só leitura", ativa: false },
      valor: traco(dados.ph, (v) => formatar.decimal(v, 2)),
      detalhe: faixa
        ? `Referência: ${formatar.decimal(faixa[0], 1)} a ${formatar.decimal(faixa[1], 1)}`
        : "Sem faixa de referência",
      fracao: dados.ph === null ? null : entre(dados.ph, 4, 8),
      corDaBarra: phForaDaFaixa ? "alerta" : "ok",
    },
  ];

  return (
    <section className={estilos.parametros} aria-labelledby="titulo-parametros">
      <h2 id="titulo-parametros" className={comum.painelNome}>Parâmetros da célula</h2>
      {medidas.map((medida) => (
        <CardDeMedida key={medida.nome} medida={medida} />
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- ilustração

function Etiqueta({ icone, rotulo, valor, x, y }: { icone: string; rotulo: string; valor?: string; x: number; y: number }) {
  return (
    <div className={estilos.etiqueta} style={{ left: x, top: y }}>
      <img src={icone} width={13.3856} height={13.3856} alt="" />
      <div className={estilos.etiquetaTexto}>
        <span className={estilos.etiquetaRotulo}>{rotulo}</span>
        {valor && <span className={estilos.etiquetaValor}>{valor}</span>}
      </div>
    </div>
  );
}

function CelulaDeCultivo({ dados }: { dados: DetalheDaCelula }) {
  return (
    <section className={estilos.cultivo} aria-labelledby="titulo-cultivo">
      <div className={comum.painelTitulo}>
        <h2 id="titulo-cultivo" className={comum.painelNome}>Célula de cultivo</h2>
        <p className={comum.painelDescricao}>Frasco no Smart Sleeve, com sensores e mangueiras.</p>
      </div>
      {/* Posições do Figma: a ilustração tem tamanho fixo. */}
      <div className={estilos.ilustracao}>
        <img className={estilos.frasco} src={frascoTupa} width={120.889} height={270.222} alt="Frasco da célula com sensores e mangueiras" />
        <Etiqueta icone={etiquetaEntrada} rotulo="Entrada de meio" x={0} y={56.89} />
        <Etiqueta icone={etiquetaDescarte} rotulo="Descarte" x={184.89} y={56.89} />
        <Etiqueta icone={etiquetaOd} rotulo="Sensor de OD" valor={traco(dados.od, (v) => formatar.decimal(v, 3))} x={0} y={199.95} />
        <Etiqueta icone={etiquetaPh} rotulo="Sensor de pH" valor={traco(dados.ph, (v) => formatar.decimal(v, 2))} x={176.52} y={199.95} />
        <Etiqueta icone={etiquetaAgitacao} rotulo="Agitação" valor="em breve" x={172.34} y={281.1} />
        <Etiqueta icone={etiquetaTemperatura} rotulo="Temperatura" valor={traco(dados.temperaturaC, formatar.temperatura)} x={82.82} y={337.15} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- comandos

const ETAPAS: { estado: EstadoDoPedido; rotulo: string }[] = [
  { estado: "solicitado", rotulo: "Solicitado" },
  { estado: "recebido", rotulo: "Recebido" },
  { estado: "aplicado", rotulo: "Aplicado" },
  { estado: "atingido", rotulo: "Atingido" },
];

function UltimoPedido({ pedido }: { pedido: NonNullable<DetalheDaCelula["pedido"]> }) {
  const alcancada = ETAPAS.findIndex((e) => e.estado === pedido.estado);
  return (
    <div className={estilos.ultimoPedido}>
      <p className={estilos.ultimoPedidoTexto}>
        Último pedido: {formatar.temperatura(pedido.temperaturaC)}, por {pedido.solicitadoPor} em{" "}
        {formatar.diaHora(pedido.solicitadoEm)}
      </p>
      {pedido.estado === "recusado" ? (
        <p className={estilos.recusado}>Recusado pela placa{pedido.motivo ? `: ${pedido.motivo}` : "."}</p>
      ) : (
        <ol className={estilos.etapas} aria-label="Andamento do pedido">
          {ETAPAS.map((etapa, i) => (
            <li key={etapa.estado} className={i <= alcancada ? estilos.etapaFeita : estilos.etapaPendente}>
              {i <= alcancada ? (
                <img src={iconeCheckEtapa} width={12} height={12} alt="" />
              ) : (
                <span className={estilos.etapaVazia} aria-hidden />
              )}
              {etapa.rotulo}
              <span className={comum.oculto}>{i <= alcancada ? " (feito)" : " (aguardando)"}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Comandos({ dados, aoEnviar }: { dados: DetalheDaCelula; aoEnviar: () => void }) {
  const alvo = temperaturaAlvo(dados);
  const faixa = faixaDePh(dados.experimento);
  const [temperatura, setTemperatura] = useState(alvo === null ? "" : formatar.decimal(alvo, 1));
  const [phMin, setPhMin] = useState(faixa ? formatar.decimal(faixa[0], 1) : "");
  const [phMax, setPhMax] = useState(faixa ? formatar.decimal(faixa[1], 1) : "");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null);

  async function aplicar(evento: FormEvent) {
    evento.preventDefault();
    const valor = Number(temperatura.trim().replace(",", "."));
    if (!temperatura.trim() || !Number.isFinite(valor) || valor < TEMPERATURA_MIN_C || valor > TEMPERATURA_MAX_C) {
      setAviso({ erro: true, texto: `Digite uma temperatura entre ${TEMPERATURA_MIN_C} e ${TEMPERATURA_MAX_C} °C.` });
      return;
    }
    setEnviando(true);
    setAviso(null);
    try {
      await enviarSetpoint(dados.id, valor);
      setAviso({ erro: false, texto: `Pedido de ${formatar.temperatura(valor)} enviado. Acompanhe as etapas abaixo.` });
      aoEnviar();
    } catch (erro) {
      setAviso({ erro: true, texto: erro instanceof Error ? erro.message : String(erro) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className={estilos.comandos} aria-labelledby="titulo-comandos">
      <div className={comum.painelTitulo}>
        <h2 id="titulo-comandos" className={comum.painelNome}>Comandos</h2>
        <p className={comum.painelDescricao}>
          Só a temperatura é comandada pelo painel. O pH é medido, e a faixa serve para os alertas.
        </p>
      </div>

      <div className={estilos.cardComando}>
        <div className={estilos.medidaTopo}>
          <img src={iconeChama} width={18} height={18} alt="" />
          <span className={estilos.medidaNome}>Aquecimento</span>
          <img src={interruptorLigado} width={34} height={20} alt="Ligado" title={SEM_API} />
        </div>
        <form className={estilos.grupo} onSubmit={aplicar} noValidate>
          <label htmlFor="temperatura-alvo" className={estilos.grupoRotulo}>Temperatura alvo</label>
          <div className={estilos.linhaEntrada}>
            <div className={estilos.entrada}>
              <input
                id="temperatura-alvo"
                className={estilos.entradaValor}
                inputMode="decimal"
                value={temperatura}
                aria-invalid={aviso?.erro || undefined}
                aria-describedby="temperatura-ajuda"
                onChange={(evento) => setTemperatura(evento.target.value)}
              />
              <span className={estilos.entradaUnidade}>°C</span>
            </div>
            <Botao tipo="primario" submit ocupado={enviando}>Aplicar</Botao>
          </div>
          <p id="temperatura-ajuda" className={aviso?.erro ? estilos.ajudaErro : estilos.ajuda} role="status">
            {aviso?.texto ?? `Entre ${TEMPERATURA_MIN_C} e ${TEMPERATURA_MAX_C} °C.`}
          </p>
        </form>
        {dados.pedido ? <UltimoPedido pedido={dados.pedido} /> : <p className={estilos.ajuda}>Nenhum pedido feito para esta célula.</p>}
      </div>

      <div className={estilos.grupo}>
        <span className={estilos.grupoRotulo} id="faixa-ph">Faixa de pH de referência</span>
        <div className={estilos.linhaEntrada} role="group" aria-labelledby="faixa-ph">
          <input className={estilos.entrada} inputMode="decimal" aria-label="pH mínimo" value={phMin} onChange={(e) => setPhMin(e.target.value)} />
          <span className={estilos.entradaUnidade}>a</span>
          <input className={estilos.entrada} inputMode="decimal" aria-label="pH máximo" value={phMax} onChange={(e) => setPhMax(e.target.value)} />
          <Botao indisponivel={SEM_API}>Salvar</Botao>
        </div>
        <p className={estilos.ajuda}>Usada só para alertas. O pH é medido, não comandado.</p>
      </div>

      <div className={estilos.emBreve}>
        <ComandoEmBreve icone={iconeAgitacao} nome="Agitação" detalhe="Controlada pela placa · em breve" />
        <ComandoEmBreve icone={iconeBombas} nome="Bombas de diluição" detalhe="Depende do hardware · em breve" />
      </div>
    </section>
  );
}

function ComandoEmBreve({ icone, nome, detalhe }: { icone: string; nome: string; detalhe: string }) {
  return (
    <div className={estilos.cardBloqueado} aria-disabled>
      <div className={estilos.medidaTopo}>
        <img src={icone} width={18} height={18} alt="" />
        <span className={estilos.medidaNome}>{nome}</span>
        <img src={iconeCadeado} width={14} height={14} alt="Sem acesso" />
      </div>
      <p className={estilos.bloqueadoDetalhe}>{detalhe}</p>
    </div>
  );
}

// ---------------------------------------------------------------- alertas e placa

function Alertas({ dados }: { dados: DetalheDaCelula }) {
  const { experimento } = dados;
  return (
    <section className={estilos.painelEstreito} aria-labelledby="titulo-alertas">
      <div className={comum.painelTituloIcone}>
        <img src={iconeSino} width={16} height={16} alt="" />
        <h2 id="titulo-alertas" className={comum.painelNome}>Alertas</h2>
        <Link to="/alertas" className={comum.link}>Ver todos →</Link>
      </div>
      {dados.alertas.length === 0 ? (
        <div className={estilos.semAlertas}>
          <img src={iconeCheckCirculo} width={24} height={24} alt="" />
          <p className={estilos.semAlertasTitulo}>Nenhum alerta ativo</p>
          <p className={estilos.semAlertasDetalhe}>
            {experimento
              ? `A ${dados.id} está dentro das faixas do ${experimento.codigo}.`
              : `A ${dados.id} não tem alertas abertos.`}
          </p>
        </div>
      ) : (
        <ul className={estilos.listaAlertas}>
          {dados.alertas.map((alerta) => (
            <li key={alerta.id} className={estilos.alerta}>
              <span className={estilos.alertaTitulo}>{alerta.titulo}</span>
              <span className={estilos.alertaMensagem}>{alerta.mensagem}</span>
              <span className={estilos.alertaTempo}>{formatar.tempoDecorrido(alerta.abertoEm, dados.atualizadoEm)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function InformacoesDaPlaca({ dados }: { dados: DetalheDaCelula }) {
  const { placa, calibracao } = dados;
  const linhas: [string, string][] = [
    ["Modelo", placa.modelo ?? "—"],
    ["MAC", placa.mac ?? "—"],
    ["Firmware", placa.firmware ?? "—"],
    ["Calibração de OD", calibracao ? `v${calibracao.atual.versao} · ${formatar.data(calibracao.atual.criadaEm)}` : "—"],
    ["Período de leitura", dados.periodoLeituraS === null ? "—" : `${dados.periodoLeituraS} s`],
  ];
  return (
    <section className={estilos.informacoes} aria-labelledby="titulo-placa">
      <div className={comum.painelTituloIcone}>
        <img src={iconeInfo} width={16} height={16} alt="" />
        <h2 id="titulo-placa" className={comum.painelNome}>Informações da placa</h2>
      </div>
      {linhas.map(([rotulo, valor]) => (
        <div key={rotulo} className={`${comum.dado} ${estilos.dadoEspacado}`}>
          <span className={comum.dadoRotulo}>{rotulo}</span>
          <span className={comum.dadoValor}>{valor}</span>
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- leituras

const PERIODOS: { valor: Periodo; rotulo: string; media: string }[] = [
  { valor: "6h", rotulo: "6 h", media: "de cada 15 min" },
  { valor: "24h", rotulo: "24 h", media: "de cada hora" },
  { valor: "7d", rotulo: "7 dias", media: "de cada 6 h" },
  { valor: "experimento", rotulo: "Experimento", media: "de cada dia" },
];

function rotulosDoTempo(periodo: Periodo, experimento: ExperimentoDaCelula | null | undefined): [string, string, string] {
  switch (periodo) {
    case "6h":
      return ["há 6 h", "há 3 h", "agora"];
    case "24h":
      return ["há 24 h", "há 12 h", "agora"];
    case "7d":
      return ["há 7 dias", "há 3,5 dias", "agora"];
    case "experimento":
      return ["dia 1", `dia ${Math.max(1, Math.round((experimento?.dia ?? 2) / 2))}`, "agora"];
  }
}

/** Escala do eixo vertical com três marcas redondas: múltiplos de `passo`
 *  que cobrem os valores, com a marca do meio também redonda. */
function escala(valores: (number | null)[], passo: number, extras: number[]) {
  const todos = [...valores.filter((v): v is number => v !== null), ...extras];
  if (todos.length === 0) return { minimo: 0, maximo: 2 * passo, marcas: [0, passo, 2 * passo] };
  let baixo = Math.floor(Math.min(...todos) / passo + 1e-9);
  let alto = Math.ceil(Math.max(...todos) / passo - 1e-9);
  if (alto === baixo) {
    baixo -= 1;
    alto += 1;
  }
  if ((alto - baixo) % 2 === 1) baixo -= 1;
  const marcas = [baixo, (baixo + alto) / 2, alto].map((k) => k * passo);
  return { minimo: marcas[0], maximo: marcas[2], marcas };
}

function Leituras({ dados, periodo, aoMudarPeriodo }: { dados: DetalheDaCelula; periodo: Periodo; aoMudarPeriodo: (p: Periodo) => void }) {
  const alvo = temperaturaAlvo(dados);
  const faixa = faixaDePh(dados.experimento);
  const tempo = rotulosDoTempo(periodo, dados.experimento);
  const { media } = PERIODOS.find((p) => p.valor === periodo)!;
  const { series } = dados;

  const graficos = [
    {
      nome: "Temperatura",
      atual: traco(dados.temperaturaC, formatar.temperatura),
      valores: series.temperatura,
      ...escala(series.temperatura, 1, alvo === null ? [] : [alvo]),
      formatarMarca: (v: number) => `${formatar.inteiro(v)} °C`,
      referencia: alvo,
      faixa: null,
      nota: alvo === null ? null : "Linha tracejada: temperatura alvo",
    },
    {
      nome: "Densidade óptica",
      atual: traco(dados.od, (v) => formatar.decimal(v, 3)),
      valores: series.od,
      ...escala(series.od, 0.1, []),
      formatarMarca: (v: number) => formatar.decimal(v, 1),
      referencia: null,
      faixa: null,
      nota: null,
    },
    {
      nome: "pH",
      atual: traco(dados.ph, (v) => formatar.decimal(v, 2)),
      valores: series.ph,
      ...escala(series.ph, 0.4, faixa ?? []),
      formatarMarca: (v: number) => formatar.decimal(v, 1),
      referencia: null,
      faixa,
      nota: faixa ? "Faixa verde: pH de referência do experimento" : null,
    },
  ];

  return (
    <section className={comum.painel} aria-labelledby="titulo-leituras">
      <div className={estilos.leiturasTitulo}>
        <div className={comum.painelTitulo}>
          <h2 id="titulo-leituras" className={comum.painelNome}>Leituras</h2>
          <p className={comum.painelDescricao}>
            {dados.periodoLeituraS ? `Uma leitura a cada ${dados.periodoLeituraS} s, mostrada` : "Mostradas"} pela média {media}.
          </p>
        </div>
        <div className={estilos.periodo} role="radiogroup" aria-label="Período">
          {PERIODOS.map((p) => {
            const semExperimento = p.valor === "experimento" && !dados.experimento;
            return (
              <button
                key={p.valor}
                type="button"
                role="radio"
                aria-checked={periodo === p.valor}
                aria-disabled={semExperimento || undefined}
                title={semExperimento ? "A célula não tem experimento informado." : undefined}
                className={periodo === p.valor ? estilos.periodoAtivo : estilos.periodoItem}
                onClick={() => !semExperimento && aoMudarPeriodo(p.valor)}
              >
                {p.rotulo}
              </button>
            );
          })}
        </div>
      </div>

      {graficos.map((grafico) => (
        <div key={grafico.nome} className={estilos.grafico}>
          <div className={estilos.graficoCabecalho}>
            <h3 className={estilos.graficoNome}>{grafico.nome}</h3>
            <span className={estilos.graficoAtual}>{grafico.atual}</span>
          </div>
          <GraficoDeLinha
            valores={grafico.valores}
            minimo={grafico.minimo}
            maximo={grafico.maximo}
            marcas={grafico.marcas}
            formatarMarca={grafico.formatarMarca}
            rotulosTempo={tempo}
            referencia={grafico.referencia}
            faixa={grafico.faixa}
            descricao={`${grafico.nome}, média ${media}, de ${tempo[0]} até agora`}
          />
          {grafico.nota && <p className={estilos.graficoNota}>{grafico.nota}</p>}
        </div>
      ))}
    </section>
  );
}

// ---------------------------------------------------------------- tirar do experimento

function TirarDoExperimento({ experimento }: { experimento: ExperimentoDaCelula }) {
  return (
    <section className={comum.painel} aria-labelledby="titulo-tirar">
      <h2 id="titulo-tirar" className={comum.painelNome}>Tirar a célula do experimento</h2>
      <div className={estilos.acoes}>
        <div className={estilos.acao}>
          <p className={comum.painelDescricao}>
            A célula sai do {experimento.codigo} e fica livre. As leituras feitas até agora continuam no experimento.
          </p>
          <Botao indisponivel={SEM_API}>Encerrar participação</Botao>
        </div>
        <div className={estilos.acao}>
          <p className={comum.painelDescricao}>
            Para quando algo deu errado. Cancela a participação e apaga o armazenamento local da placa.
          </p>
          <Botao tipo="perigo" indisponivel={SEM_API}>Resetar célula</Botao>
        </div>
      </div>
      <div className={estilos.perdaDeConexao}>
        <img src={iconeSemConexao} width={16} height={16} alt="" />
        <p>
          Se a célula ficar mais de 24 h sem comunicação, o sistema a retira do experimento sozinho e avisa o responsável.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- tela

export function VisaoDaCelula() {
  const { id = "" } = useParams();
  const [periodo, setPeriodo] = useState<Periodo>("24h");
  const { dados, erro, recarregar } = useCelula(id, periodo);

  if (!dados) return <CarregandoCelula id={id} aba="Visão da célula" erro={erro} />;

  const { experimento } = dados;

  return (
    <div className={comum.tela}>
      <CabecalhoDaCelula
        id={id}
        aba="Visão da célula"
        subtitulo="Acompanhe a célula em tempo real: medidas, comando de temperatura e tendências do experimento."
        erro={erro}
        acao={experimento && <Botao para={`/experimentos/${encodeURIComponent(experimento.codigo)}`}>Abrir experimento</Botao>}
      />

      <FaixaDeStatus dados={dados} />

      <div className={estilos.principal}>
        <Parametros dados={dados} />
        <CelulaDeCultivo dados={dados} />
        {/* key: ao trocar de célula, os campos voltam aos valores dela. */}
        <Comandos key={id} dados={dados} aoEnviar={recarregar} />
        <div className={estilos.colunaAlertas}>
          <Alertas dados={dados} />
          <InformacoesDaPlaca dados={dados} />
        </div>
      </div>

      <div className={experimento ? estilos.linhaLeituras : undefined}>
        <Leituras dados={dados} periodo={periodo} aoMudarPeriodo={setPeriodo} />
        {experimento && <TirarDoExperimento experimento={experimento} />}
      </div>
    </div>
  );
}
