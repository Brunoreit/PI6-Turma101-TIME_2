// Telas "Novo experimento" e "Novo experimento · etapas e metadados" do
// Figma (nós 13:1164 e 80:1249). A segunda é a mais nova e a que vale: além
// das informações gerais, tem os limites do tipo de crescimento, as fases e
// os metadados. Com ?base=EXP-01 o formulário começa copiado de outro.
//
// O mesmo formulário edita um experimento em /experimentos/EXP-01/editar. Em
// Stand by tudo muda; em andamento, só a descrição e os metadados (os campos
// que a API guarda em metadados: OD do turbidostato, agitação e a lista de
// metadados); encerrado ou cancelado, nada. Os campos travados ficam
// desabilitados com a explicação.

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ErroDaApi } from "@/api/cliente";
import arrastar from "@/assets/icones/arrastar.svg";
import cadeado from "@/assets/icones/cadeado-14.svg";
import check from "@/assets/icones/check-14-verde.svg";
import copiar from "@/assets/icones/copiar.svg";
import info from "@/assets/icones/info-14.svg";
import lixeira from "@/assets/icones/lixeira.svg";
import mais from "@/assets/icones/mais-14-marca.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { Campo } from "@/compartilhado/componentes/Campo";
import * as formatar from "@/compartilhado/formatar";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { useSessao } from "@/sessao/SessaoProvider";
import { useExperimentos } from "./ExperimentosProvider";
import { acessoNoExperimento, fechado, TIPOS_DE_CRESCIMENTO, type Experimento, type Ficha, type TipoDeCrescimento } from "./modelo";
import estilos from "./NovoExperimento.module.css";

const DURACAO_PADRAO = 90;

interface FaseNoFormulario {
  chave: number;
  duracao: string;
  temperatura: string;
}

interface Formulario {
  nome: string;
  descricao: string;
  tipo: TipoDeCrescimento;
  duracao: string;
  odMin: string;
  odMax: string;
  agitacao: string;
  phMin: string;
  phMax: string;
  fases: FaseNoFormulario[];
  organismo: string;
  meio: string;
  volume: string;
  lote: string;
  inoculo: string;
}

/** "30,5" ou "30.5" viram 30,5. Vazio ou inválido vira NaN. */
function numero(texto: string): number {
  return texto.trim() === "" ? NaN : Number(texto.replace(",", "."));
}

const numeroOuNulo = (texto: string) => (Number.isFinite(numero(texto)) ? numero(texto) : null);
const textoDe = (valor: number | null | undefined, casas: number) =>
  valor == null || Number.isNaN(valor) ? "" : formatar.decimal(valor, casas);

let proximaChave = 1;
const fase = (duracao: number, temperatura: number): FaseNoFormulario => ({
  chave: proximaChave++,
  duracao: String(duracao),
  temperatura: formatar.decimal(temperatura, 1),
});

const VAZIO: Formulario = {
  nome: "",
  descricao: "",
  tipo: "Turbidostato",
  duracao: String(DURACAO_PADRAO),
  odMin: "0,30",
  odMax: "0,60",
  agitacao: "300",
  phMin: "6,6",
  phMax: "7,2",
  fases: [fase(DURACAO_PADRAO, 30)],
  organismo: "",
  meio: "",
  volume: "20",
  lote: "",
  inoculo: "",
};

/** O formulário preenchido com a ficha de um experimento. */
function formularioDe(e: Experimento): Formulario {
  const m = e.metadados;
  return {
    ...VAZIO,
    nome: e.nome,
    descricao: e.descricao,
    tipo: e.tipo,
    duracao: String(e.duracaoDias),
    odMin: e.odMin === undefined ? VAZIO.odMin : textoDe(e.odMin, 2),
    odMax: e.odMax === undefined ? VAZIO.odMax : textoDe(e.odMax, 2),
    agitacao: e.agitacaoRpm === undefined ? VAZIO.agitacao : textoDe(e.agitacaoRpm, 0),
    phMin: textoDe(e.phMin, 1),
    phMax: textoDe(e.phMax, 1),
    fases: e.fases.length ? e.fases.map((f) => fase(f.duracaoDias, f.temperaturaC)) : VAZIO.fases,
    ...(m && {
      organismo: m.organismo,
      meio: m.meio,
      volume: textoDe(m.volumeMl, 0),
      lote: m.lote,
      inoculo: textoDe(m.inoculoOd, 2),
    }),
  };
}

/** Copia nome, descrição, tipo, duração e parâmetros. Células e leituras não. */
function copiarDe(base: Experimento): Formulario {
  return { ...formularioDe(base), nome: base.nome.endsWith("repetição") ? base.nome : `${base.nome} · repetição` };
}

function fichaDe(form: Formulario): Ficha {
  return {
    nome: form.nome.trim(),
    descricao: form.descricao.trim(),
    tipo: form.tipo,
    duracaoDias: numero(form.duracao),
    fases: form.fases.map((f) => ({ duracaoDias: numero(f.duracao), temperaturaC: numero(f.temperatura) })),
    phMin: numero(form.phMin),
    phMax: numero(form.phMax),
    odMin: form.tipo === "Turbidostato" ? numeroOuNulo(form.odMin) : null,
    odMax: form.tipo === "Turbidostato" ? numeroOuNulo(form.odMax) : null,
    agitacaoRpm: numeroOuNulo(form.agitacao),
    metadados: {
      organismo: form.organismo.trim(),
      meio: form.meio.trim(),
      volumeMl: numeroOuNulo(form.volume),
      lote: form.lote.trim(),
      inoculoOd: numeroOuNulo(form.inoculo),
    },
  };
}

const TRAVADO_EM_ANDAMENTO =
  "O experimento já começou: estes campos não mudam mais. Depois do início, só a descrição e os metadados podem ser editados.";

const ETAPAS = [
  { titulo: "Cadastrar · você está aqui", texto: "Defina nome, tipo, duração e parâmetros. Fica em Stand by." },
  { titulo: "Atribuir células", texto: "Na tela de cada célula livre, escolha o experimento. Uma célula, um experimento." },
  { titulo: "Iniciar", texto: "A atribuição envia os parâmetros à célula e marca o início dela no experimento." },
  { titulo: "Coletar", texto: "As leituras de cada célula ficam ligadas ao experimento. Parâmetros podem ser ajustados." },
  { titulo: "Encerrar", texto: "O responsável encerra no fim do prazo, ou antes. As células voltam a ficar livres." },
];

export function NovoExperimento() {
  const { codigo } = useParams();
  return codigo ? <EditarExperimento codigo={codigo} /> : <FormularioDoExperimento />;
}

/** Carrega o experimento antes de abrir o formulário de edição. */
function EditarExperimento({ codigo }: { codigo: string }) {
  const { buscar, carregarDetalhe } = useExperimentos();
  const [estado, setEstado] = useState<string>("carregando");

  useEffect(() => {
    carregarDetalhe(codigo)
      .then(() => setEstado("pronto"))
      .catch((falha) =>
        setEstado(falha instanceof ErroDaApi && falha.status === 404 ? "Experimento não encontrado ou sem acesso." : mensagemDoErro(falha)),
      );
    // carregarDetalhe muda a cada render do provider; só o código importa.
  }, [codigo]);

  const experimento = estado === "pronto" ? buscar(codigo) : undefined;
  if (!experimento) {
    const texto =
      estado === "carregando" ? "Carregando o experimento..." : estado === "pronto" ? "Experimento não encontrado ou sem acesso." : estado;
    return (
      <div className={estilos.tela}>
        <nav className={estilos.trilha} aria-label="Trilha">
          <Link to="/experimentos">Experimentos</Link>
          <span>/</span>
          <span>{codigo}</span>
        </nav>
        <p className={estilos.erro}>{texto}</p>
      </div>
    );
  }
  return <FormularioDoExperimento editando={experimento} />;
}

function FormularioDoExperimento({ editando }: { editando?: Experimento }) {
  const { experimentos, buscar, criar, alterar } = useExperimentos();
  const { usuario } = useSessao();
  const navegar = useNavigate();
  const [parametros, setParametros] = useSearchParams();
  const base = editando ? undefined : buscar(parametros.get("base") ?? "");
  const [form, setForm] = useState<Formulario>(() => (editando ? formularioDe(editando) : base ? copiarDe(base) : VAZIO));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // O que o status deixa mudar. A API confere de novo.
  const souResponsavel = !editando || acessoNoExperimento(editando, usuario?.email) === "responsavel";
  const tudoTravado = Boolean(editando && (fechado(editando) || !souResponsavel));
  const fichaTravada = tudoTravado || editando?.status === "andamento";
  const motivoDaTrava = !editando
    ? null
    : !souResponsavel
      ? `Só o responsável, ${editando.responsavel.nome}, pode editar este experimento.`
      : fechado(editando)
        ? `O experimento está ${editando.status === "cancelado" ? "cancelado" : "encerrado"} e não pode mais ser alterado. Para repetir o estudo, duplique.`
        : null;

  const campo = <K extends keyof Formulario>(chave: K) => (valor: Formulario[K]) => setForm((f) => ({ ...f, [chave]: valor }));

  function escolherBase(codigo: string) {
    const escolhido = buscar(codigo);
    setParametros(codigo ? { base: codigo } : {}, { replace: true });
    setForm(escolhido ? copiarDe(escolhido) : VAZIO);
  }

  function mudarFase(chave: number, mudanca: Partial<FaseNoFormulario>) {
    setForm((f) => ({ ...f, fases: f.fases.map((x) => (x.chave === chave ? { ...x, ...mudanca } : x)) }));
  }

  const duracao = numero(form.duracao);
  const somaDasFases = form.fases.reduce((soma, f) => soma + (numero(f.duracao) || 0), 0);
  const fasesFecham = somaDasFases === duracao;
  const temperaturaForaDaFaixa = form.fases.some((f) => !(numero(f.temperatura) >= 20 && numero(f.temperatura) <= 45));
  const volume = numero(form.volume);

  // "Fase 1 · dias 1 a 45": o intervalo de cada fase vem das anteriores.
  let diaInicial = 1;
  const intervalos = form.fases.map((f) => {
    const inicio = diaInicial;
    diaInicial += numero(f.duracao) || 0;
    return { inicio, fim: diaInicial - 1 };
  });

  async function salvar() {
    if (salvando || tudoTravado) return;
    if (!form.nome.trim()) return setErro("Dê um nome ao experimento.");
    if (!(duracao > 0)) return setErro("A duração precisa ser um número de dias maior que zero.");
    if (!fasesFecham) return setErro(`As fases somam ${somaDasFases} dias, mas o experimento tem ${form.duracao}. Ajuste a duração das fases.`);
    if (temperaturaForaDaFaixa) return setErro("A temperatura alvo de cada fase precisa ficar entre 20 e 45 °C.");
    setErro(null);
    setSalvando(true);
    try {
      const ficha = fichaDe(form);
      if (editando) await alterar(editando.codigo, ficha);
      const codigo = editando ? editando.codigo : await criar(ficha, base?.codigo);
      navegar(`/experimentos/${codigo}`);
    } catch (falha) {
      // A mensagem da API diz o que foi recusado, como a faixa de pH invertida.
      setErro(mensagemDoErro(falha));
      setSalvando(false);
    }
  }

  const aviso = (texto: string) => (
    <div className={estilos.travado}>
      <img src={cadeado} width={14} height={14} alt="" />
      <p>{texto}</p>
    </div>
  );

  return (
    <div className={estilos.tela}>
      <nav className={estilos.trilha} aria-label="Trilha">
        <Link to="/experimentos">Experimentos</Link>
        <span>/</span>
        {editando ? (
          <>
            <Link to={`/experimentos/${editando.codigo}`}>{editando.codigo}</Link>
            <span>/</span>
            <span>Editar</span>
          </>
        ) : (
          <span>Novo experimento</span>
        )}
      </nav>
      <div className={estilos.titulo}>
        <h1>{editando ? `Editar ${editando.codigo}` : "Novo experimento"}</h1>
        <p>
          {!editando
            ? "O experimento é salvo em Stand by. Ele começa quando a primeira célula for atribuída a ele."
            : editando.status === "standby"
              ? "Em Stand by, todos os campos podem ser alterados."
              : editando.status === "andamento"
                ? "O experimento já começou: só a descrição e os metadados podem ser alterados."
                : "Este experimento não pode mais ser alterado."}
        </p>
      </div>

      <div className={estilos.corpo}>
        <form
          className={estilos.formulario}
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          {motivoDaTrava && aviso(motivoDaTrava)}
          {base && (
            <div className={estilos.avisoBase}>
              <img src={copiar} width={16} height={16} alt="" />
              <p>
                Baseado no {base.codigo} · {base.nome}. Revise os campos antes de salvar.
              </p>
              <button type="button" className={estilos.link} onClick={() => escolherBase("")}>
                Desfazer
              </button>
            </div>
          )}

          <section className={estilos.secao}>
            <div className={estilos.secaoTitulo}>
              <h2>
                Informações gerais
                <img src={cadeado} width={14} height={14} alt="" />
              </h2>
              <p>Não podem ser alteradas depois que o experimento começar.</p>
            </div>
            {fichaTravada && !tudoTravado && aviso(`${TRAVADO_EM_ANDAMENTO} A descrição continua editável.`)}
            <Campo rotulo="Nome *" tipo="texto" valor={form.nome} onChange={campo("nome")} somenteLeitura={fichaTravada} />
            <div className={estilos.campoLivre}>
              <label htmlFor="descricao">Descrição</label>
              <textarea
                id="descricao"
                rows={3}
                value={form.descricao}
                disabled={tudoTravado}
                onChange={(e) => campo("descricao")(e.target.value)}
              />
            </div>
            <div className={estilos.linhaTipo}>
              <div className={estilos.campoLivre}>
                <label htmlFor="tipo">Tipo de crescimento *</label>
                <select
                  id="tipo"
                  className={estilos.seletor}
                  value={form.tipo}
                  disabled={fichaTravada}
                  onChange={(e) => campo("tipo")(e.target.value as TipoDeCrescimento)}
                >
                  {TIPOS_DE_CRESCIMENTO.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className={estilos.duracao}>
                <Campo
                  rotulo="Duração *"
                  valor={form.duracao}
                  onChange={campo("duracao")}
                  unidade="dias"
                  ajuda="Padrão de 3 meses."
                  somenteLeitura={fichaTravada}
                />
              </div>
            </div>
            <p className={estilos.responsavel}>
              Responsável: <strong>{editando && !souResponsavel ? editando.responsavel.nome : `${usuario?.nome} (você)`}</strong> · só o
              responsável pode encerrar o experimento
            </p>
          </section>

          <section className={estilos.painel}>
            <div className={estilos.secaoTitulo}>
              <h2>{form.tipo}</h2>
              <p>O controle roda na placa. Daqui saem só os limites que ela usa.</p>
            </div>
            <div className={estilos.grade2}>
              {form.tipo === "Turbidostato" && (
                <>
                  <Campo
                    rotulo="OD mínima"
                    valor={form.odMin}
                    onChange={campo("odMin")}
                    ajuda="A placa para de diluir aqui."
                    somenteLeitura={tudoTravado}
                  />
                  <Campo
                    rotulo="OD máxima"
                    valor={form.odMax}
                    onChange={campo("odMax")}
                    ajuda="A placa começa a diluir aqui."
                    somenteLeitura={tudoTravado}
                  />
                </>
              )}
              <Campo
                rotulo="Agitação"
                valor={form.agitacao}
                onChange={campo("agitacao")}
                unidade="rpm"
                ajuda="Faixa a definir com o hardware."
                somenteLeitura={tudoTravado}
              />
              <div className={estilos.faixa}>
                <span className={estilos.rotulo}>Faixa de pH de referência</span>
                <div className={estilos.faixaCampos}>
                  <Campo rotulo="pH mínimo" rotuloOculto valor={form.phMin} onChange={campo("phMin")} somenteLeitura={fichaTravada} />
                  <span>a</span>
                  <Campo rotulo="pH máximo" rotuloOculto valor={form.phMax} onChange={campo("phMax")} somenteLeitura={fichaTravada} />
                </div>
                <span className={estilos.ajuda}>
                  {fichaTravada && !tudoTravado ? "Travada: o experimento já começou." : "Só para alertas. O pH é medido."}
                </span>
              </div>
            </div>
          </section>

          <section className={estilos.painel}>
            <div className={estilos.secaoTitulo}>
              <h2>Fases</h2>
              <p>Cada fase tem a própria temperatura alvo, que vai para todas as células do experimento.</p>
            </div>
            {fichaTravada &&
              !tudoTravado &&
              aviso("O experimento já começou: as fases não mudam mais, porque a temperatura alvo já foi enviada às células.")}
            <div className={estilos.tabelaFases} role="table" aria-label="Fases">
              <div className={estilos.cabecalhoFases} role="row">
                <span />
                <span role="columnheader">Fase</span>
                <span role="columnheader">Duração</span>
                <span role="columnheader">Temperatura alvo</span>
                <span />
              </div>
              {form.fases.map((f, i) => (
                <div key={f.chave} className={estilos.linhaFase} role="row">
                  <img src={arrastar} width={16} height={16} alt="" />
                  <span className={estilos.nomeFase} role="cell">
                    Fase {i + 1} · dias {intervalos[i].inicio} a {intervalos[i].fim}
                  </span>
                  <span className={estilos.entradaFase} role="cell">
                    <input aria-label={`Duração da fase ${i + 1}`} inputMode="numeric" value={f.duracao} disabled={fichaTravada} onChange={(e) => mudarFase(f.chave, { duracao: e.target.value })} />
                    dias
                  </span>
                  <span className={`${estilos.entradaFase} ${estilos.entradaTemperatura}`} role="cell">
                    <input aria-label={`Temperatura alvo da fase ${i + 1}`} inputMode="decimal" value={f.temperatura} disabled={fichaTravada} onChange={(e) => mudarFase(f.chave, { temperatura: e.target.value })} />
                    °C
                  </span>
                  <button
                    type="button"
                    className={estilos.remover}
                    aria-label={`Remover a fase ${i + 1}`}
                    disabled={form.fases.length === 1 || fichaTravada}
                    onClick={() => setForm((x) => ({ ...x, fases: x.fases.filter((y) => y.chave !== f.chave) }))}
                  >
                    <img src={lixeira} width={16} height={16} alt="" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              className={estilos.adicionar}
              disabled={fichaTravada}
              onClick={() => setForm((x) => ({ ...x, fases: [...x.fases, fase(Math.max(0, duracao - somaDasFases) || 1, 30)] }))}
            >
              <img src={mais} width={14} height={14} alt="" />
              Adicionar fase
            </button>
            {fasesFecham ? (
              <p className={estilos.somaOk}>
                <img src={check} width={14} height={14} alt="" />
                As fases somam {somaDasFases} de {form.duracao} dias.
              </p>
            ) : (
              <p className={estilos.somaErrada}>
                As fases somam {somaDasFases} de {Number.isNaN(duracao) ? "?" : duracao} dias. Ajuste até fechar a duração do experimento.
              </p>
            )}
            <div className={estilos.dica}>
              <img src={info} width={14} height={14} alt="" />
              <p>
                Um ajuste feito numa célula durante o experimento vale até a próxima fase. Na troca de fase, o responsável recebe um
                aviso e o sistema manda a nova temperatura.
              </p>
            </div>
          </section>

          <section className={estilos.painel}>
            <div className={estilos.secaoTitulo}>
              <h2>Metadados do experimento</h2>
              <p>Saem junto com os dados na exportação. O experimento só começa com os obrigatórios preenchidos.</p>
            </div>
            <div className={estilos.grade2}>
              <Campo
                rotulo="Organismo e cepa *"
                tipo="texto"
                valor={form.organismo}
                onChange={campo("organismo")}
                placeholder="E. coli K-12 MG1655"
                somenteLeitura={tudoTravado}
              />
              <Campo
                rotulo="Meio de cultura *"
                tipo="texto"
                valor={form.meio}
                onChange={campo("meio")}
                placeholder="LB"
                somenteLeitura={tudoTravado}
              />
            </div>
            <div className={estilos.grade3}>
              <Campo
                rotulo="Volume de trabalho *"
                valor={form.volume}
                onChange={campo("volume")}
                unidade="mL"
                ajuda="Entre 10 e 20 mL."
                erro={form.volume !== "" && !(volume >= 10 && volume <= 20)}
                somenteLeitura={tudoTravado}
              />
              <Campo
                rotulo="Lote do meio"
                tipo="texto"
                valor={form.lote}
                onChange={campo("lote")}
                placeholder="L-2026-114"
                somenteLeitura={tudoTravado}
              />
              <Campo
                rotulo="Inóculo (OD inicial)"
                valor={form.inoculo}
                onChange={campo("inoculo")}
                placeholder="0,05"
                somenteLeitura={tudoTravado}
              />
            </div>
            <div className={estilos.dica}>
              <img src={info} width={14} height={14} alt="" />
              <p>Lista provisória. Os campos obrigatórios ainda vão ser definidos com o LNBR.</p>
            </div>
          </section>

          {erro && (
            <p className={estilos.erro} role="alert">
              {erro}
            </p>
          )}
          <div className={estilos.botoes}>
            <Botao para={editando ? `/experimentos/${editando.codigo}` : "/experimentos"}>{tudoTravado ? "Voltar" : "Cancelar"}</Botao>
            {!tudoTravado && (
              <Botao tipo="primario" submit ocupado={salvando}>
                {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Salvar experimento"}
              </Botao>
            )}
          </div>
        </form>

        <aside className={estilos.lateral}>
          {!editando && (
            <section className={estilos.duplicar}>
            <h2>Começar de um experimento</h2>
            <p>Copia nome, descrição, tipo, duração e parâmetros. Células e leituras não são copiadas.</p>
            <div className={estilos.campoLivre}>
              <label htmlFor="base">Experimento base</label>
              <select id="base" className={estilos.seletor} value={base?.codigo ?? ""} onChange={(e) => escolherBase(e.target.value)}>
                <option value="">Nenhum, começar do zero</option>
                {experimentos.map((e) => (
                  <option key={e.codigo} value={e.codigo}>
                    {e.codigo} · {e.nome}
                  </option>
                ))}
              </select>
            </div>
            </section>
          )}
          <section className={estilos.etapas}>
            <h2>Etapas do experimento</h2>
            <ol>
              {ETAPAS.map((etapa, i) => (
                <li key={etapa.titulo}>
                  <span className={i === 0 ? estilos.numeroAtual : estilos.numero}>{i + 1}</span>
                  <span className={estilos.etapaTexto}>
                    <span className={i === 0 ? estilos.etapaAtual : estilos.etapaTitulo}>{etapa.titulo}</span>
                    <span>{etapa.texto}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
