// Tela "Célula c08 · nova calibração de OD" do Figma (nó 233:1931), aberta
// pelo botão Nova calibração da aba Ajustes. A pessoa digita o branco e os
// padrões; a curva e a fórmula se atualizam a cada linha. Salvar usa o
// POST /celulas/{id}/calibracoes; com "Recalcular o histórico" marcado, a API
// refaz a OD das leituras desde a versão em uso.

import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import iconeOk from "@/assets/icones/check-13-verde.svg";
import iconeEtapa from "@/assets/icones/etapa-feita.svg";
import iconeMais from "@/assets/icones/mais-14-marca.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { CaixaDeSelecao } from "@/compartilhado/componentes/CaixaDeSelecao";
import * as formatar from "@/compartilhado/formatar";
import { salvarCalibracao } from "@/funcionalidades/celula/fonte";
import { useCelula } from "@/funcionalidades/celula/useCelula";
import comum from "@/funcionalidades/celula/Celula.module.css";
import { GraficoDaCurva } from "./GraficoDaCurva";
import estilos from "./NovaCalibracao.module.css";
import { ajustarReta, type Ponto } from "./regressao";

interface Linha {
  nome: string;
  od: string;
  bruto: string;
}

const MINIMO_DE_PADROES = 3;
const FAIXA: [number, number] = [0.2, 0.8];

/** Valores do Figma: branco e dois padrões lidos, o terceiro sendo preenchido. */
const INICIAIS: Linha[] = [
  { nome: "Branco", od: "0,000", bruto: "98" },
  { nome: "P1", od: "0,200", bruto: "520" },
  { nome: "P2", od: "0,350", bruto: "812" },
  { nome: "P3", od: "0,500", bruto: "1.104" },
  { nome: "P4", od: "", bruto: "" },
  { nome: "P5", od: "", bruto: "" },
];

/** "1.104" e "0,500" no formato brasileiro. Vazio ou inválido vira NaN. */
function numero(texto: string): number {
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  return limpo === "" ? NaN : Number(limpo);
}

function pontoDa(linha: Linha): Ponto | null {
  const od = numero(linha.od);
  const bruto = numero(linha.bruto);
  return Number.isFinite(od) && Number.isFinite(bruto) && bruto >= 0 ? { od, bruto } : null;
}

/** Como na aba Ajustes: "od = 0,00048 · bruto − 0,047". */
function formula(a: number, b: number): string {
  const coeficiente = a.toLocaleString("pt-BR", { minimumSignificantDigits: 2, maximumSignificantDigits: 2 });
  const termo = Math.abs(b).toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  return `od = ${coeficiente} · bruto ${b < 0 ? "−" : "+"} ${termo}`;
}

export function NovaCalibracao() {
  const { id = "" } = useParams();
  const navegar = useNavigate();
  const { dados } = useCelula(id);
  const [linhas, setLinhas] = useState<Linha[]>(INICIAIS);
  const [editando, setEditando] = useState<string | null>("P3");
  const [conferindo, setConferindo] = useState(false);
  const [recalcular, setRecalcular] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null);

  const atual = dados?.calibracao?.atual ?? null;
  const proxima = (atual?.versao ?? 0) + 1;
  const experimento = dados?.experimento;
  const base = `/celulas/${encodeURIComponent(id)}`;

  // A linha em edição só entra na conta quando sai dela, como "lido".
  const lidas = linhas.filter((l) => l.nome !== editando && pontoDa(l));
  const pontos = lidas.map((l) => ({ nome: l.nome, ...pontoDa(l)! }));
  const linhaEditando = linhas.find((l) => l.nome === editando);
  const pontoEditando = linhaEditando && pontoDa(linhaEditando) ? { nome: linhaEditando.nome, ...pontoDa(linhaEditando)! } : null;
  const reta = ajustarReta(pontoEditando ? [...pontos, pontoEditando] : pontos);
  const brancoOk = pontos.some((p) => p.nome === "Branco");
  const padroes = linhas.filter((l) => l.nome !== "Branco");
  const padroesLidos = pontos.filter((p) => p.nome !== "Branco");
  const naFaixa = padroesLidos.filter((p) => p.od >= FAIXA[0] && p.od <= FAIXA[1]).length;
  const pronto = brancoOk && naFaixa >= MINIMO_DE_PADROES && reta !== null && reta.a > 0;
  const preenchidos = padroes.filter((l) => pontoDa(l)).length;
  const faltam = Math.max(0, padroes.length - preenchidos);

  function mudar(nome: string, campo: "od" | "bruto", valor: string) {
    setLinhas((ls) => ls.map((l) => (l.nome === nome ? { ...l, [campo]: valor } : l)));
    setEditando(nome);
    setConferindo(false);
  }

  async function salvar() {
    if (!reta) return;
    setSalvando(true);
    setAviso(null);
    try {
      // Sem versão em uso, recalcula o histórico todo.
      await salvarCalibracao(id, reta.a, reta.b, recalcular, atual?.criadaEm ?? null);
      navegar(`${base}/ajustes`);
    } catch (erro) {
      setAviso({ erro: true, texto: erro instanceof Error ? erro.message : String(erro) });
    } finally {
      setSalvando(false);
    }
  }

  const etapas = [
    { titulo: "Escolher a célula", detalhe: id, feita: true },
    { titulo: "Branco", detalhe: "meio sem células", feita: brancoOk },
    { titulo: "Padrões", detalhe: `${preenchidos} de ${padroes.length} preenchidos`, feita: pronto && conferindo },
    { titulo: "Conferir e salvar", detalhe: `versão ${proxima}`, feita: false },
  ];
  const etapaAtual = !brancoOk ? 1 : conferindo ? 3 : 2;

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
            {experimento ? ` · ${experimento.codigo}` : ""}. Registre o branco e os padrões medidos para criar a versão {proxima} da curva de OD.
          </p>
        </div>
        <Botao para={`${base}/ajustes`}>Cancelar calibração</Botao>
      </header>

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
              Para cada padrão, digite a OD medida no espectrofotômetro e o valor bruto que a célula mostrou com ele no frasco. Use
              pelo menos {MINIMO_DE_PADROES} padrões entre 0,2 e 0,8.
            </p>
          </div>
          <div className={estilos.tabela} role="table" aria-label="Padrões de referência">
            <div className={estilos.cabecalhoTabela} role="row">
              <span role="columnheader">Padrão</span>
              <span role="columnheader">OD de referência</span>
              <span role="columnheader">Bruto da {id}</span>
              <span role="columnheader">Situação</span>
            </div>
            {linhas.map((l) => {
              const emEdicao = l.nome === editando;
              const lido = !emEdicao && pontoDa(l) !== null;
              const foraDaFaixa = lido && l.nome !== "Branco" && (numero(l.od) < FAIXA[0] || numero(l.od) > FAIXA[1]);
              return (
                <div key={l.nome} className={emEdicao ? estilos.linhaEditando : estilos.linha} role="row">
                  <span role="cell">{l.nome}</span>
                  {(["od", "bruto"] as const).map((campo) => (
                    <span key={campo} role="cell">
                      {emEdicao || (!lido && l.nome !== "Branco") ? (
                        emEdicao ? (
                          <input
                            className={estilos.entrada}
                            inputMode="decimal"
                            aria-label={`${campo === "od" ? "OD de referência" : "Valor bruto"} do ${l.nome}`}
                            value={l[campo]}
                            autoFocus={campo === "od" && l[campo] === ""}
                            onChange={(e) => mudar(l.nome, campo, e.target.value)}
                          />
                        ) : (
                          <button type="button" className={estilos.vazio} onClick={() => setEditando(l.nome)}>
                            —
                          </button>
                        )
                      ) : (
                        <button type="button" className={estilos.valor} title="Clique para corrigir" onClick={() => setEditando(l.nome)}>
                          {l[campo]}
                        </button>
                      )}
                    </span>
                  ))}
                  <span role="cell">
                    {emEdicao ? (
                      <button type="button" className={estilos.preenchendo} onClick={() => setEditando(null)} title="Clique para terminar esta linha">
                        preenchendo
                      </button>
                    ) : lido ? (
                      foraDaFaixa ? (
                        <span className={estilos.foraDaFaixa}>fora de 0,2 a 0,8</span>
                      ) : (
                        <span className={estilos.ok}>
                          <img src={iconeOk} width={13} height={13} alt="" />
                          ok
                        </span>
                      )
                    ) : (
                      <span className={estilos.aPreencher}>a preencher</span>
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
              const nome = `P${padroes.length + 1}`;
              setLinhas((ls) => [...ls, { nome, od: "", bruto: "" }]);
              setEditando(nome);
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
              Atualiza a cada padrão preenchido.
              {atual ? ` A linha tracejada é a versão ${atual.versao}, em uso hoje.` : ""}
            </p>
          </div>
          <GraficoDaCurva pontos={pontos} editando={pontoEditando} nova={reta} atual={atual} />
          <div className={estilos.formula}>
            <span>Versão {proxima} (provisória)</span>
            <strong>{reta ? formula(reta.a, reta.b) : "faltam pontos para a curva"}</strong>
            <span>
              {reta?.r2 != null ? `R² = ${formatar.decimal(reta.r2, 3)} com ${pontos.length + (pontoEditando ? 1 : 0)} pontos` : "R² aparece a partir de 3 pontos"}
              {faltam > 0 ? ` · ${faltam === 1 ? "falta 1 padrão" : `faltam ${faltam} padrões`}` : ""}
            </span>
          </div>
          <CaixaDeSelecao marcada={recalcular} onChange={setRecalcular}>
            <span className={estilos.recalcular}>
              Recalcular o histórico da {id}
              {atual ? ` desde ${formatar.diaMes(atual.criadaEm)}` : ""} com a versão {proxima}. O valor bruto não muda, só a OD calculada.
            </span>
          </CaixaDeSelecao>
          {conferindo && reta && (
            <div className={estilos.conferir}>
              <p>
                Confira antes de salvar: {formula(reta.a, reta.b)}
                {reta.r2 != null ? `, R² = ${formatar.decimal(reta.r2, 3)}` : ""}. A versão {proxima} passa a valer para as próximas leituras
                {recalcular ? ` e para as leituras desde ${atual ? formatar.diaMes(atual.criadaEm) : "o início"}` : ""}.
              </p>
            </div>
          )}
          <div className={estilos.botoes}>
            <Botao onClick={() => (conferindo ? setConferindo(false) : navegar(`${base}/ajustes`))}>Voltar</Botao>
            {conferindo ? (
              <Botao tipo="primario" ocupado={salvando} onClick={salvar}>
                Salvar versão {proxima}
              </Botao>
            ) : (
              // Esmaecido até ter padrões suficientes, como no Figma.
              <span className={pronto ? undefined : estilos.esmaecido}>
                <Botao
                  tipo="primario"
                  indisponivel={pronto ? undefined : `Libera com ao menos ${MINIMO_DE_PADROES} padrões entre 0,2 e 0,8, além do branco.`}
                  onClick={() => {
                    setEditando(null);
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
            <p className={estilos.ajuda}>Libera com ao menos {MINIMO_DE_PADROES} padrões entre 0,2 e 0,8.</p>
          )}
        </section>
      </div>
    </div>
  );
}
