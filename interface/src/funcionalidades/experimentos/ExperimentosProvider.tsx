// Experimentos compartilhados pelas telas. Segue VITE_FONTE_DADOS:
//   exemplo  começa com exemplo.ts e as mudanças ficam na memória até
//            recarregar a página
//   api      lista em GET /experimentos, detalhe em GET /experimentos/{id} e
//            as ações nas rotas da API. A URL usa o código (EXP-01); as
//            chamadas usam o id, guardado no experimento.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import * as api from "@/api/cliente";
import { ErroDaApi } from "@/api/cliente";
import type { DetalheDoExperimentoApi } from "@/api/tipos";
import { useDados } from "@/dados/DadosProvider";
import { FONTE_DADOS } from "@/dados/fonte";
import { useSessao } from "@/sessao/SessaoProvider";
import { experimentoDaLista, experimentoDoDetalhe, fichaParaApi } from "./api";
import { EXPERIMENTOS_EXEMPLO } from "./exemplo";
import type { Convidado, Experimento, Ficha } from "./modelo";

interface Contexto {
  experimentos: Experimento[];
  /** Só no modo api, enquanto a lista não chegou. */
  carregando: boolean;
  erro: string | null;
  /** O detalhe, se já foi carregado, ou o item da lista. */
  buscar: (codigo: string) => Experimento | undefined;
  /** Busca o detalhe (células e acessos). Rejeita com ErroDaApi; 404 quando
   *  o experimento não existe ou a pessoa não tem acesso. */
  carregarDetalhe: (codigo: string) => Promise<void>;
  /** As ações devolvem o código do experimento novo, como "EXP-05". */
  criar: (ficha: Ficha, baseadoEm?: string) => Promise<string>;
  duplicar: (codigo: string) => Promise<string>;
  alterar: (codigo: string, ficha: Ficha) => Promise<void>;
  encerrar: (codigo: string) => Promise<void>;
  cancelar: (codigo: string, motivo: string) => Promise<void>;
  /** Compartilhar. Só o responsável pode; a API confere. */
  convidar: (codigo: string, email: string, acesso: Convidado["acesso"]) => Promise<void>;
  mudarPermissao: (codigo: string, convidado: Convidado, acesso: Convidado["acesso"]) => Promise<void>;
  removerAcesso: (codigo: string, convidado: Convidado) => Promise<void>;
}

const ContextoExperimentos = createContext<Contexto | null>(null);

const NAO_ENCONTRADO = "Experimento não encontrado ou sem acesso.";

const PERMISSAO = { leitura: "leitura", modificar: "edicao" } as const;

/** "ana.souza@cnpem.br" vira "Ana Souza". */
function nomeDoEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map((parte) => parte[0].toUpperCase() + parte.slice(1))
    .join(" ");
}

export function ExperimentosProvider({ children }: { children: ReactNode }) {
  const valor = useFonte();
  return <ContextoExperimentos.Provider value={valor}>{children}</ContextoExperimentos.Provider>;
}

function useDaApi(): Contexto {
  const { usuario } = useSessao();
  const celulas = useDados().dados?.celulas ?? [];
  const [lista, setLista] = useState<Experimento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [detalhes, setDetalhes] = useState<Record<string, DetalheDoExperimentoApi>>({});

  const recarregarLista = useCallback(async () => {
    try {
      const recebidos = await api.listarExperimentos();
      const convertidos = recebidos.map(experimentoDaLista);
      setLista(convertidos);
      setErro(null);
      return convertidos;
    } catch (falha) {
      setErro(falha instanceof ErroDaApi ? falha.detalhe : String(falha));
      return null;
    }
  }, []);

  useEffect(() => {
    recarregarLista();
  }, [recarregarLista]);

  async function idDe(codigo: string): Promise<number> {
    const conhecido = detalhes[codigo]?.id_experimento ?? lista?.find((e) => e.codigo === codigo)?.id;
    if (conhecido !== undefined) return conhecido;
    // Link aberto direto, antes de a lista chegar.
    const atual = (await recarregarLista()) ?? [];
    const id = atual.find((e) => e.codigo === codigo)?.id;
    if (id === undefined) throw new ErroDaApi(404, NAO_ENCONTRADO);
    return id;
  }

  async function carregarDetalhe(codigo: string) {
    const detalhe = await api.buscarExperimento(await idDe(codigo));
    setDetalhes((d) => ({ ...d, [codigo]: detalhe }));
  }

  /** Depois de uma ação: a lista e, se já estava aberto, o detalhe. */
  async function depoisDe(codigo: string) {
    await Promise.all([recarregarLista(), detalhes[codigo] ? carregarDetalhe(codigo) : null]);
  }

  return {
    experimentos: lista ?? [],
    carregando: lista === null && erro === null,
    erro,
    buscar(codigo) {
      const detalhe = detalhes[codigo];
      return detalhe ? experimentoDoDetalhe(detalhe, usuario, celulas) : lista?.find((e) => e.codigo === codigo);
    },
    carregarDetalhe,
    async criar(ficha) {
      const novo = await api.criarExperimento(fichaParaApi(ficha));
      await recarregarLista();
      return novo.codigo;
    },
    async duplicar(codigo) {
      const copia = await api.duplicarExperimento(await idDe(codigo));
      await recarregarLista();
      return copia.codigo;
    },
    async alterar(codigo, ficha) {
      const atual = detalhes[codigo] ?? null;
      const id = await idDe(codigo);
      const corpo = fichaParaApi(ficha, atual?.metadados);
      // Depois do início, a API só aceita descrição e metadados.
      const emAndamento = atual
        ? atual.status === "em_andamento"
        : lista?.find((e) => e.codigo === codigo)?.status === "andamento";
      await api.alterarExperimento(id, emAndamento ? { descricao: corpo.descricao, metadados: corpo.metadados } : corpo);
      await depoisDe(codigo);
    },
    async encerrar(codigo) {
      await api.encerrarExperimento(await idDe(codigo));
      await depoisDe(codigo);
    },
    async cancelar(codigo, motivo) {
      await api.cancelarExperimento(await idDe(codigo), motivo);
      await depoisDe(codigo);
    },
    async convidar(codigo, email, acesso) {
      await api.concederAcesso(await idDe(codigo), email, PERMISSAO[acesso]);
      await depoisDe(codigo);
    },
    // A rota de convidar também troca a permissão de quem já tem acesso, numa
    // chamada só. Remover e convidar de novo deixaria a pessoa sem acesso se a
    // segunda chamada falhasse.
    async mudarPermissao(codigo, convidado, acesso) {
      await api.concederAcesso(await idDe(codigo), convidado.email, PERMISSAO[acesso]);
      await depoisDe(codigo);
    },
    async removerAcesso(codigo, convidado) {
      if (convidado.idPessoa === undefined) throw new ErroDaApi(404, NAO_ENCONTRADO);
      await api.revogarAcesso(await idDe(codigo), convidado.idPessoa);
      await depoisDe(codigo);
    },
  };
}

function useDoExemplo(): Contexto {
  const { usuario } = useSessao();
  const [experimentos, setExperimentos] = useState(EXPERIMENTOS_EXEMPLO);

  function mudar(codigo: string, mudanca: (e: Experimento) => Experimento) {
    setExperimentos((lista) => lista.map((e) => (e.codigo === codigo ? mudanca(e) : e)));
  }

  function proximoCodigo() {
    const maior = Math.max(0, ...experimentos.map((e) => Number(e.codigo.slice(4)) || 0));
    return `EXP-${String(maior + 1).padStart(2, "0")}`;
  }

  function fechar(codigo: string, status: "encerrado" | "cancelado", motivo?: string) {
    const agora = new Date();
    mudar(codigo, (e) => ({
      ...e,
      status,
      fim: agora,
      motivoCancelamento: motivo,
      celulas: e.celulas.map((c) => ({ ...c, fim: c.fim ?? agora })),
    }));
  }

  const buscar = (codigo: string) => experimentos.find((e) => e.codigo === codigo);

  return {
    experimentos,
    carregando: false,
    erro: null,
    buscar,
    async carregarDetalhe(codigo) {
      if (!buscar(codigo)) throw new ErroDaApi(404, NAO_ENCONTRADO);
    },
    async criar(ficha, baseadoEm) {
      const codigo = proximoCodigo();
      const novo: Experimento = {
        ...ficha,
        codigo,
        status: "standby",
        responsavel: { nome: usuario?.nome ?? "", email: usuario?.email ?? "" },
        convidados: [],
        inicio: null,
        fim: null,
        celulas: [],
        condicoes: [],
        baseadoEm,
      };
      setExperimentos((lista) => [...lista, novo]);
      return codigo;
    },
    async duplicar(codigoBase) {
      const original = buscar(codigoBase);
      if (!original) throw new ErroDaApi(404, NAO_ENCONTRADO);
      const codigo = proximoCodigo();
      const copia: Experimento = {
        ...original,
        codigo,
        status: "standby",
        responsavel: { nome: usuario?.nome ?? "", email: usuario?.email ?? "" },
        convidados: [],
        inicio: null,
        fim: null,
        celulas: [],
        condicoes: [],
        motivoCancelamento: undefined,
        baseadoEm: codigoBase,
      };
      setExperimentos((lista) => [...lista, copia]);
      return codigo;
    },
    async alterar(codigo, ficha) {
      mudar(codigo, (e) => ({ ...e, ...ficha }));
    },
    async encerrar(codigo) {
      fechar(codigo, "encerrado");
    },
    async cancelar(codigo, motivo) {
      fechar(codigo, "cancelado", motivo);
    },
    // Sem API não há contas para conferir: qualquer e-mail entra, com o nome
    // tirado do e-mail.
    async convidar(codigo, email, acesso) {
      mudar(codigo, (e) => ({ ...e, convidados: [...e.convidados, { nome: nomeDoEmail(email), email, acesso }] }));
    },
    async mudarPermissao(codigo, convidado, acesso) {
      mudar(codigo, (e) => ({ ...e, convidados: e.convidados.map((c) => (c.email === convidado.email ? { ...c, acesso } : c)) }));
    },
    async removerAcesso(codigo, convidado) {
      mudar(codigo, (e) => ({ ...e, convidados: e.convidados.filter((c) => c.email !== convidado.email) }));
    },
  };
}

/** FONTE_DADOS é fixa no build, então o hook escolhido nunca troca. */
const useFonte = FONTE_DADOS === "api" ? useDaApi : useDoExemplo;

export function useExperimentos(): Contexto {
  const contexto = useContext(ContextoExperimentos);
  if (!contexto) throw new Error("useExperimentos precisa estar dentro de <ExperimentosProvider>.");
  return contexto;
}
