// Tela "Célula c08 · nova calibração de OD" do Figma (nó 233:1931) e os
// estados "· estabilizando" (284:2339), "· padrão gravado" (284:2661) e
// "· excluir padrão" (284:2991), aberta pelo botão Nova calibração dos Ajustes.
//
// A pessoa coloca o branco e cada padrão no frasco, escolhe a linha em
// "Gravar em" e grava a média das últimas leituras quando o sensor estabiliza.
// Quem mediu por fora digita o valor. O branco não é ponto da reta: ele só
// zera a linha base. A curva e a fórmula são uma prévia (regressao.ts); ao
// salvar, o POST /celulas/{id}/calibracoes recebe os pontos e o servidor
// confere as leituras e calcula a reta. A calibração em andamento fica no
// navegador (rascunho.ts) até salvar ou cancelar.

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { PontoCalibracaoApi } from "@/api/tipos";
import iconeOk from "@/assets/icones/check-13-verde.svg";
import iconeEtapa from "@/assets/icones/etapa-feita.svg";
import iconeLixeira from "@/assets/icones/lixeira.svg";
import iconeMais from "@/assets/icones/mais-14-marca.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import { Campo } from "@/compartilhado/componentes/Campo";
import * as formatar from "@/compartilhado/formatar";
import { FONTE_DADOS } from "@/dados/fonte";
import { formulaComBranco } from "@/funcionalidades/celula/calibracao";
import comum from "@/funcionalidades/celula/Celula.module.css";
import { salvarCalibracao } from "@/funcionalidades/celula/fonte";
import { useCelula } from "@/funcionalidades/celula/useCelula";
import { trocarFrascoNoExemplo, useOdAoVivo } from "./aoVivo";
import { GraficoDaCurva, type PontoDaCurva } from "./GraficoDaCurva";
import { LeituraAoVivo, nomeDa } from "./LeituraAoVivo";
import estilos from "./NovaCalibracao.module.css";
import { apagarRascunho, guardarRascunho, lerRascunho, type Linha } from "./rascunho";
import { ajustarComBranco, MINIMO_DE_PADROES } from "./regressao";

const INICIAIS: Linha[] = [
  { rotulo: "branco", od: "", gravado: null },
  ...[1, 2, 3, 4, 5].map((n) => ({ rotulo: `P${n}`, od: "", gravado: null })),
];

/** Valor bruto: "1.104" e "1104,5" no formato brasileiro. Vazio ou inválido vira NaN. */
function numero(texto: string): number {
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  return limpo === "" ? NaN : Number(limpo);
}

/** OD de referência: "0,2" e "0.2" valem o mesmo. A OD não tem milhar, então
 *  o ponto é sempre decimal (com `numero`, "0.2" virava 2). */
function lerOd(texto: string): number {
  const limpo = texto.trim().replace(",", ".");
  return limpo === "" ? NaN : Number(limpo);
}

const horaMinuto = (iso: string | Date) =>
  new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Bruto que o frasco do modo exemplo mostra para cada linha. */
function brutoNoExemplo(linha: Linha, indice: number): number {
  if (linha.rotulo === "branco") return 98;
  const od = lerOd(linha.od);
  return Math.round(98 + ((Number.isFinite(od) ? od : 0.05 + 0.15 * indice) + 0.018) / 0.000515);
}

/** O próximo ponto ainda sem valor depois de `rotulo`, dando a volta. */
function proximoVazio(linhas: Linha[], rotulo: string): string {
  const i = linhas.findIndex((l) => l.rotulo === rotulo);
  for (let k = 1; k < linhas.length; k++) {
    const l = linhas[(i + k) % linhas.length];
    if (!l.gravado) return l.rotulo;
  }
  return rotulo;
}

export function NovaCalibracao() {
  const { id = "" } = useParams();
  const navegar = useNavigate();
  const { dados } = useCelula(id);
  const { aoVivo, erro: erroAoVivo } = useOdAoVivo(id);

  // Volta a calibração guardada no navegador, se houver.
  const [inicial] = useState(() => lerRascunho(id));
  const [linhas, setLinhas] = useState<Linha[]>(inicial?.linhas ?? INICIAIS);
  const [selecionada, setSelecionada] = useState(inicial?.selecionada ?? "branco");
  const [organismo, setOrganismo] = useState(inicial?.organismo ?? "");
  const [recalcular, setRecalcular] = useState(inicial?.recalcular ?? false);
  const [desde, setDesde] = useState<string | null>(inicial?.desde ?? null);
  const [restaurada, setRestaurada] = useState(inicial !== null);

  const [editandoOd, setEditandoOd] = useState<string | null>(null);
  const [digitando, setDigitando] = useState<{ rotulo: string; texto: string } | null>(null);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState<string | null>(null);
  /** Última leitura usada na gravação ao vivo: até a janela andar além dela, o botão espera. */
  const [travadoAte, setTravadoAte] = useState<number | null>(null);
  const [conferindo, setConferindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    const relogio = setInterval(() => setAgora(new Date()), 1000);
    return () => clearInterval(relogio);
  }, []);

  // Guarda no navegador a cada mudança, a partir do primeiro valor.
  useEffect(() => {
    const temAlgo = linhas.some((l) => l.gravado || l.od.trim()) || organismo.trim() !== "";
    if (!temAlgo) return;
    const inicio = desde ?? new Date().toISOString();
    if (!desde) setDesde(inicio);
    guardarRascunho(id, { desde: inicio, linhas, selecionada, organismo, recalcular });
  }, [id, linhas, selecionada, organismo, recalcular, desde]);

  // Modo exemplo: escolher outra linha é trocar o frasco.
  useEffect(() => {
    const i = linhas.findIndex((l) => l.rotulo === selecionada);
    if (i >= 0) trocarFrascoNoExemplo(brutoNoExemplo(linhas[i], i));
    // Só ao trocar de linha; mudar a OD digitada não troca o frasco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecionada]);

  const atual = dados?.calibracao?.atual ?? null;
  const proxima = atual ? String(atual.versao + 1) : null;
  const versaoNova = proxima ? `versão ${proxima}` : "versão nova";
  const experimento = dados?.experimento;
  const base = `/celulas/${encodeURIComponent(id)}`;

  const branco = linhas.find((l) => l.rotulo === "branco")?.gravado?.bruto ?? null;
  const padroes = linhas.filter((l) => l.rotulo !== "branco");
  const completos = padroes.filter((l) => l.gravado && Number.isFinite(lerOd(l.od)));
  const incompletos = padroes.filter((l) => (l.gravado || l.od.trim()) && !completos.includes(l));
  const preenchidos = padroes.filter((l) => Number.isFinite(lerOd(l.od))).length;
  const linhaSelecionada = linhas.find((l) => l.rotulo === selecionada) ?? null;
  const ultima = aoVivo?.ultima ?? null;

  const pontos: PontoDaCurva[] = branco === null ? [] : completos.map((l) => ({
    nome: l.rotulo, x: l.gravado!.bruto - branco, od: lerOd(l.od),
  }));
  // O padrão sendo lido entra na prévia com o valor ao vivo, como no Figma.
  const pontoAoVivo: PontoDaCurva | null =
    branco !== null && ultima && linhaSelecionada && linhaSelecionada.rotulo !== "branco" && Number.isFinite(lerOd(linhaSelecionada.od))
      ? { nome: linhaSelecionada.rotulo, x: ultima.bruto - branco, od: lerOd(linhaSelecionada.od) }
      : null;
  const naPrevia = pontoAoVivo && !linhaSelecionada?.gravado ? [...pontos, pontoAoVivo] : pontos;
  const reta = branco === null ? null : ajustarComBranco(branco, naPrevia.map((p) => ({ bruto: p.x + branco, od: p.od })));
  const retaSalva = branco === null ? null : ajustarComBranco(branco, completos.map((l) => ({ bruto: l.gravado!.bruto, od: lerOd(l.od) })));
  const pronto = branco !== null && completos.length >= MINIMO_DE_PADROES && retaSalva !== null;
  const esperandoNovaLeitura = travadoAte !== null && (aoVivo?.janela.seqInicio ?? -1) <= travadoAte;
  // A versão em uso nos mesmos eixos: od = a · (x + branco) + b.
  const atualNoEixo = atual && branco !== null ? { a: atual.a, b: atual.b + atual.a * branco, versao: atual.versao } : null;

  function mudar(funcao: (ls: Linha[]) => Linha[]) {
    setLinhas(funcao);
    setConferindo(false);
    setAviso(null);
  }

  function selecionar(rotulo: string) {
    setSelecionada(rotulo);
    setConfirmacao(null);
    setDigitando(null);
    setExcluindo(null);
  }

  function gravarAoVivo() {
    const j = aoVivo?.janela;
    if (!j?.estavel || j.media === null || j.seqInicio === null || j.seqFim === null || esperandoNovaLeitura) return;
    const gravado = {
      bruto: j.media, origem: "leitura" as const, seqInicio: j.seqInicio, seqFim: j.seqFim, nLeituras: j.n,
      desvio: j.desvio ?? 0, gravadoEm: new Date().toISOString(),
    };
    const novas = linhas.map((l) => (l.rotulo === selecionada ? { ...l, gravado } : l));
    mudar(() => novas);
    setTravadoAte(j.seqFim);
    setConfirmacao(`${nomeDa(selecionada)} gravado: ${formatar.inteiro(j.media)}, média de ${j.n} leituras (seq ${formatar.inteiro(
      j.seqInicio)} a ${formatar.inteiro(j.seqFim)}).`);
    setSelecionada(proximoVazio(novas, selecionada));
    setDigitando(null);
  }

  function gravarDigitado() {
    if (!digitando) return;
    const bruto = numero(digitando.texto);
    if (!Number.isFinite(bruto) || bruto < 0) return;
    const rotulo = digitando.rotulo;
    const novas = linhas.map((l) => (l.rotulo === rotulo ? { ...l, gravado: { bruto, origem: "digitado" as const, gravadoEm: new Date().toISOString() } } : l));
    mudar(() => novas);
    setDigitando(null);
    setConfirmacao(`${nomeDa(rotulo)} digitado: ${formatar.inteiro(bruto)}.`);
    setSelecionada(proximoVazio(novas, rotulo));
  }

  /** Tira o padrão da tabela e renumera os seguintes (P1, P2...). O branco não sai. */
  function remover(rotulo: string) {
    let n = 0;
    const renomeado = new Map<string, string>();
    const novas = linhas
      .filter((l) => l.rotulo !== rotulo)
      .map((l) => {
        if (l.rotulo === "branco") return l;
        const novo = `P${++n}`;
        renomeado.set(l.rotulo, novo);
        return { ...l, rotulo: novo };
      });
    mudar(() => novas);
    setSelecionada(selecionada === rotulo ? proximoVazio(novas, "branco") : renomeado.get(selecionada) ?? selecionada);
    setExcluindo(null);
    setDigitando(null);
    setConfirmacao(null);
  }

  function descartar() {
    apagarRascunho(id);
    setLinhas(INICIAIS);
    setSelecionada("branco");
    setOrganismo("");
    setRecalcular(false);
    setDesde(null);
    setRestaurada(false);
    setConfirmacao(null);
    setTravadoAte(null);
    setConferindo(false);
  }

  function cancelar() {
    apagarRascunho(id);
    navegar(`${base}/ajustes`);
  }

  async function salvar() {
    if (!pronto) return;
    setSalvando(true);
    setAviso(null);
    const ponto = (l: Linha): PontoCalibracaoApi => {
      const g = l.gravado!;
      return {
        rotulo: l.rotulo,
        od_referencia: l.rotulo === "branco" ? null : lerOd(l.od),
        bruto: g.bruto,
        origem: g.origem,
        ...(g.origem === "leitura" ? { seq_inicio: g.seqInicio, seq_fim: g.seqFim, n_leituras: g.nLeituras, desvio: g.desvio } : {}),
        gravado_em: g.gravadoEm,
      };
    };
    try {
      const enviados = [ponto(linhas.find((l) => l.rotulo === "branco")!), ...completos.map(ponto)];
      // Sem versão em uso, recalcula o histórico todo.
      const salva = await salvarCalibracao(id, enviados, recalcular, atual?.criadaEm ?? null, organismo);
      apagarRascunho(id);
      const recalculadas = recalcular
        ? ` ${formatar.inteiro(salva.reprocessadas)} ${salva.reprocessadas === 1 ? "leitura teve" : "leituras tiveram"} a OD recalculada.`
        : " O histórico não foi recalculado.";
      const detalhes = [
        formulaComBranco(salva.a, salva.b, salva.branco),
        salva.r2 !== null ? `R² = ${formatar.decimal(salva.r2, 3)}` : null,
        `${salva.padroes} ${salva.padroes === 1 ? "padrão" : "padrões"}`,
        salva.organismo ? `organismo ${salva.organismo}` : null,
        salva.sensor ? `sensor ${salva.sensor}` : null,
      ].filter(Boolean).join(", ");
      navegar(`${base}/ajustes`, {
        state: {
          aviso: `Versão ${salva.versao} da calibração de OD (nº ${salva.idCalibracao}) salva em ${formatar.diaHora(salva.criadaEm)}${
            salva.porVoce ? " por você" : ""}: ${detalhes}.${recalculadas}`,
        },
      });
    } catch (erro) {
      setAviso({ erro: true, texto: erro instanceof Error ? erro.message : String(erro) });
    } finally {
      setSalvando(false);
    }
  }

  const etapas = [
    { titulo: "Escolher a célula", detalhe: id, feita: true },
    { titulo: "Branco", detalhe: "zera a linha base", feita: branco !== null },
    { titulo: "Padrões", detalhe: `${preenchidos} de ${padroes.length} preenchidos`, feita: pronto && conferindo },
    { titulo: "Conferir e salvar", detalhe: versaoNova, feita: false },
  ];
  const etapaAtual = branco === null ? 1 : conferindo ? 3 : 2;
  const nPrevia = naPrevia.length;

  return (
    <div className={comum.tela}>
      <nav className={comum.trilha} aria-label="Trilha">
        <Link to="/" className={comum.trilhaLink}>Visão geral</Link>
        <span aria-hidden>/</span>
        <Link to={base} className={comum.trilhaLink}>{id}</Link>
        <span aria-hidden>/</span>
        <Link to={`${base}/ajustes`} className={comum.trilhaLink}>Ajustes</Link>
        <span aria-hidden>/</span>
        <span aria-current="page">Nova calibração de OD</span>
      </nav>

      <header className={comum.cabecalho}>
        <div className={comum.tituloBloco}>
          <h1 className={estilos.titulo}>Nova calibração de OD</h1>
          <p className={comum.subtitulo}>
            {id}
            {experimento ? ` · ${experimento.codigo}` : ""}. Registre o branco e os padrões medidos para criar a {versaoNova} da curva de OD.
          </p>
        </div>
        <Botao onClick={cancelar}>Cancelar calibração</Botao>
      </header>

      {restaurada && desde && (
        <div className={estilos.emAndamento} role="status">
          <p>
            Calibração em andamento desde {horaMinuto(desde)}
            {new Date(desde).toDateString() !== agora.toDateString() ? ` de ${formatar.diaMes(new Date(desde))}` : ""}. Os pontos gravados
            voltaram de onde você parou.
          </p>
          <button type="button" className={estilos.botaoCancelar} onClick={descartar}>
            Descartar e começar de novo
          </button>
        </div>
      )}

      <ol className={estilos.etapas} aria-label="Etapas da calibração">
        {etapas.map((e, i) => (
          <li key={e.titulo} className={estilos.etapa}>
            {i > 0 && <span className={i <= etapaAtual ? estilos.tracoFeito : estilos.traco} aria-hidden />}
            <span className={e.feita ? estilos.numeroFeito : i === etapaAtual ? estilos.numeroAtual : estilos.numero}>
              {e.feita ? <img src={iconeEtapa} width={14} height={14} alt="Feita:" /> : i + 1}
            </span>
            <span className={estilos.etapaTextos}>
              <span className={i === etapaAtual ? estilos.etapaTituloAtual : i > etapaAtual ? estilos.etapaTituloFutura : estilos.etapaTitulo}>
                {e.titulo}
              </span>
              <span>{e.detalhe}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className={estilos.corpo}>
        <section className={estilos.painel}>
          <div className={estilos.painelTitulo}>
            <h2>Padrões de referência</h2>
            <p>
              Coloque cada padrão no frasco, escolha a linha dele e grave o valor quando a leitura estabilizar. Se mediu por fora, dá para
              digitar.
            </p>
          </div>

          <LeituraAoVivo
            idCelula={id}
            aoVivo={aoVivo}
            erro={erroAoVivo}
            agora={agora}
            linhas={linhas}
            selecionada={selecionada}
            onSelecionar={selecionar}
            onGravar={gravarAoVivo}
            confirmacao={confirmacao}
            esperandoNovaLeitura={esperandoNovaLeitura}
          />

          <div className={estilos.tabela} role="table" aria-label="Padrões de referência">
            <div className={estilos.cabecalhoTabela} role="row">
              <span role="columnheader">Padrão</span>
              <span role="columnheader">OD de referência</span>
              <span role="columnheader">Bruto gravado</span>
              <span role="columnheader">Situação</span>
            </div>
            {linhas.map((l) => {
              const ehBranco = l.rotulo === "branco";
              const nome = nomeDa(l.rotulo);
              const lendo = l.rotulo === selecionada;
              const g = l.gravado;
              const emDigitacao = digitando?.rotulo === l.rotulo;
              const odAberta = !ehBranco && (editandoOd === l.rotulo || (lendo && l.od === ""));
              return (
                <div key={l.rotulo} className={lendo ? estilos.linhaEditando : estilos.linha} role="row">
                  <span role="cell">{nome}</span>

                  <span role="cell">
                    {ehBranco ? (
                      <span className={estilos.linhaBase}>linha base</span>
                    ) : odAberta ? (
                      <input
                        className={estilos.entrada}
                        inputMode="decimal"
                        aria-label={`OD de referência do ${nome}`}
                        placeholder="0,000"
                        value={l.od}
                        autoFocus={editandoOd === l.rotulo}
                        onChange={(e) => mudar((ls) => ls.map((x) => (x.rotulo === l.rotulo ? { ...x, od: e.target.value } : x)))}
                        onBlur={() => setEditandoOd(null)}
                        onKeyDown={(e) => e.key === "Enter" && setEditandoOd(null)}
                      />
                    ) : (
                      <button type="button" className={l.od ? estilos.valor : estilos.vazio} title="Clique para corrigir" onClick={() => setEditandoOd(l.rotulo)}>
                        {l.od || "—"}
                      </button>
                    )}
                  </span>

                  <span role="cell" className={estilos.brutoCelula}>
                    {emDigitacao ? (
                      <input
                        className={estilos.entrada}
                        inputMode="decimal"
                        aria-label={`Valor bruto do ${nome}, medido por fora`}
                        placeholder="bruto"
                        autoFocus
                        value={digitando.texto}
                        onChange={(e) => setDigitando({ rotulo: l.rotulo, texto: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") gravarDigitado();
                          if (e.key === "Escape") setDigitando(null);
                        }}
                      />
                    ) : g ? (
                      <>
                        <span className={estilos.brutoValor}>{formatar.inteiro(g.bruto)}</span>
                        {!ehBranco && branco !== null && <span>{formatar.inteiro(g.bruto - branco)} sem o branco</span>}
                        <span>
                          {g.origem === "leitura"
                            ? `${g.nLeituras} leituras · ±${formatar.inteiro(g.desvio ?? 0)}`
                            : "digitado"}
                        </span>
                      </>
                    ) : (
                      <span className={estilos.brutoValor}>—</span>
                    )}
                    {lendo && !emDigitacao && ultima && (
                      <span className={estilos.aoVivoNaLinha}>ao vivo: {formatar.inteiro(ultima.bruto)}</span>
                    )}
                  </span>

                  <span role="cell" className={estilos.situacao}>
                    {excluindo === l.rotulo ? (
                      <span className={estilos.confirmarExclusao} role="group" aria-label={`Confirmar a exclusão do ${nome}`}>
                        <span>Excluir o {nome}?</span>
                        <button type="button" className={estilos.botaoExcluir} autoFocus onClick={() => remover(l.rotulo)}>
                          Excluir
                        </button>
                        <button type="button" className={estilos.botaoCancelar} onClick={() => setExcluindo(null)}>
                          Cancelar
                        </button>
                      </span>
                    ) : (
                      <>
                        <span className={estilos.situacaoTextos}>
                          {emDigitacao ? (
                            <>
                              <button type="button" className={estilos.botaoGravar} onClick={gravarDigitado}
                                disabled={!Number.isFinite(numero(digitando.texto))}>
                                Gravar
                              </button>
                              <button type="button" className={estilos.botaoCancelar} onClick={() => setDigitando(null)}>
                                Cancelar
                              </button>
                            </>
                          ) : lendo ? (
                            <>
                              <span className={estilos.lendo}>lendo agora</span>
                              <button type="button" className={estilos.digitar} onClick={() => setDigitando({ rotulo: l.rotulo, texto: "" })}>
                                Digitar
                              </button>
                            </>
                          ) : g ? (
                            <span className={estilos.ok}>
                              <img src={iconeOk} width={13} height={13} alt="" />
                              {g.origem === "leitura" ? "gravado" : "digitado"} {horaMinuto(g.gravadoEm)}
                            </span>
                          ) : (
                            <span className={estilos.aPreencher}>a preencher</span>
                          )}
                        </span>
                        {ehBranco ? (
                          <span className={estilos.semLixeira} aria-hidden />
                        ) : (
                          <button
                            type="button"
                            className={estilos.remover}
                            aria-label={`Excluir o ${nome}`}
                            title={`Excluir o ${nome}`}
                            onClick={() => setExcluindo(l.rotulo)}
                          >
                            <img src={iconeLixeira} width={16} height={16} alt="" />
                          </button>
                        )}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className={estilos.adicionar}
            onClick={() => {
              const rotulo = `P${padroes.length + 1}`;
              mudar((ls) => [...ls, { rotulo, od: "", gravado: null }]);
              selecionar(rotulo);
            }}
          >
            <img src={iconeMais} width={14} height={14} alt="" />
            Adicionar padrão
          </button>
        </section>

        <section className={`${estilos.painel} ${estilos.painelCurva}`}>
          <div className={estilos.painelTitulo}>
            <h2>Curva</h2>
            <p>
              Atualiza a cada padrão gravado.
              {pontoAoVivo ? ` O ponto vazado é o ${pontoAoVivo.nome} ao vivo` : ""}
              {pontoAoVivo && atual ? " e a" : atual ? " A" : ""}
              {atual ? ` linha tracejada é a versão ${atual.versao}, em uso hoje` : ""}
              {pontoAoVivo || atual ? "." : ""}
            </p>
          </div>
          <GraficoDaCurva pontos={pontos} aoVivo={pontoAoVivo} branco={branco} nova={reta} atual={atualNoEixo} />
          <p className={estilos.legenda}>
            Eixo horizontal: valor bruto menos o branco{branco !== null ? ` (${formatar.inteiro(branco)})` : ""}. Eixo vertical: OD do
            espectrofotômetro. O branco só zera a linha base e não é ponto da reta.
          </p>
          <div className={estilos.formula}>
            <span>{proxima ? `Versão ${proxima}` : "Versão nova"} (provisória)</span>
            <strong>
              {branco === null ? "grave o branco para começar" : reta ? formulaComBranco(reta.a, reta.b, branco) : "faltam padrões para a curva"}
            </strong>
            <span>
              {reta?.r2 != null
                ? `R² = ${formatar.decimal(reta.r2, 3)} com ${nPrevia} padrões · o branco não entra na reta`
                : `R² aparece a partir de ${MINIMO_DE_PADROES} padrões · o branco não entra na reta`}
            </span>
          </div>
          <Campo
            rotulo="Organismo usado na curva"
            tipo="texto"
            valor={organismo}
            onChange={setOrganismo}
            placeholder="Ex.: E. coli K-12"
            ajuda="Opcional. Fica guardado com a versão, junto com os padrões e o R²."
          />
          <CaixaDeSelecao marcada={recalcular} onChange={setRecalcular}>
            <span className={estilos.recalcular}>
              Recalcular o histórico da {id}
              {atual ? ` desde ${formatar.diaMes(atual.criadaEm)}` : ""} com a {versaoNova}. O valor bruto não muda, só a OD calculada.
            </span>
          </CaixaDeSelecao>
          {conferindo && retaSalva && branco !== null && (
            <div className={estilos.conferir}>
              <p>
                Confira antes de salvar: {formulaComBranco(retaSalva.a, retaSalva.b, branco)}
                {retaSalva.r2 != null ? `, R² = ${formatar.decimal(retaSalva.r2, 3)}` : ""}, com {completos.length} padrões. O servidor refaz a
                conta com as leituras gravadas e a {versaoNova} passa a valer para as próximas leituras
                {recalcular ? ` e para as leituras desde ${atual ? formatar.diaMes(atual.criadaEm) : "o início"}` : ""}.
                {incompletos.length > 0
                  ? ` Fica${incompletos.length > 1 ? "m" : ""} de fora, sem OD ou sem bruto: ${incompletos.map((l) => l.rotulo).join(", ")}.`
                  : ""}
              </p>
            </div>
          )}
          <div className={estilos.botoes}>
            <Botao onClick={() => (conferindo ? setConferindo(false) : navegar(`${base}/ajustes`))}>Voltar</Botao>
            {conferindo ? (
              <Botao tipo="primario" ocupado={salvando} onClick={salvar}>
                {proxima ? `Salvar versão ${proxima}` : "Salvar nova versão"}
              </Botao>
            ) : (
              // Esmaecido até ter o branco e padrões suficientes, como no Figma.
              <span className={pronto ? undefined : estilos.esmaecido}>
                <Botao
                  tipo="primario"
                  indisponivel={pronto ? undefined : `Libera com o branco e pelo menos ${MINIMO_DE_PADROES} padrões.`}
                  onClick={() => {
                    setDigitando(null);
                    setConferindo(true);
                  }}
                >
                  Conferir e salvar
                </Botao>
              </span>
            )}
          </div>
          {aviso ? (
            <p className={aviso.erro ? estilos.erro : estilos.ajuda} role="status">{aviso.texto}</p>
          ) : (
            <p className={estilos.ajuda}>
              Libera com o branco e pelo menos {MINIMO_DE_PADROES} padrões.
              {FONTE_DADOS === "exemplo" ? " No modo exemplo a leitura ao vivo é simulada e salvar não grava nada." : ""}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
