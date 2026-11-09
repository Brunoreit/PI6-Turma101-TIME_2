// "modal Compartilhar" do Figma (nó 79:1961). Só o responsável abre: convida
// por e-mail, muda a permissão de quem já tem acesso ou remove o acesso.
//
// No modo api, só recebe acesso quem já tem conta: a API não tem convite
// pendente, então o estado "convite enviado, ainda não entrou" do Figma saiu.
// O responsável não vem na lista de acessos da API; aparece no topo, a partir
// dos dados do experimento.

import { useEffect, useState } from "react";
import coroa12 from "@/assets/icones/coroa-12.svg";
import coroa13 from "@/assets/icones/coroa-13.svg";
import iconeEmail from "@/assets/icones/email-16.svg";
import iconeFechar from "@/assets/icones/fechar-20.svg";
import lapis from "@/assets/icones/lapis-13.svg";
import olho from "@/assets/icones/olho-13.svg";
import iconeRemover from "@/assets/icones/remover-16.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import * as formatar from "@/compartilhado/formatar";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { iniciais, useSessao } from "@/sessao/SessaoProvider";
import estilos from "./Compartilhar.module.css";
import { useExperimentos } from "./ExperimentosProvider";
import { acessoNoExperimento, type Convidado, type Experimento } from "./modelo";

type Permissao = Convidado["acesso"];

function SeletorDePermissao({
  valor, onChange, rotulo, desabilitado = false,
}: { valor: Permissao; onChange: (p: Permissao) => void; rotulo: string; desabilitado?: boolean }) {
  return (
    <select
      className={estilos.seletor}
      value={valor}
      aria-label={rotulo}
      disabled={desabilitado}
      onChange={(e) => onChange(e.target.value as Permissao)}
    >
      <option value="leitura">Só leitura</option>
      <option value="modificar">Pode modificar</option>
    </select>
  );
}

export function Compartilhar({ experimento, onFechar }: { experimento: Experimento; onFechar: () => void }) {
  const { convidar, mudarPermissao, removerAcesso } = useExperimentos();
  const { usuario } = useSessao();
  const [email, setEmail] = useState("");
  const [permissao, setPermissao] = useState<Permissao>("leitura");
  const [erro, setErro] = useState<string | null>(null);
  const [erroNaLista, setErroNaLista] = useState<string | null>(null);
  /** E-mail de quem está sendo alterado, ou "convite". */
  const [ocupado, setOcupado] = useState<string | null>(null);
  const convidados = experimento.convidados;
  const souEu = acessoNoExperimento(experimento, usuario?.email) === "responsavel";
  // A API não devolve o e-mail do responsável; quando é a pessoa logada, usa o dela.
  const emailDoResponsavel = experimento.responsavel.email || (souEu ? (usuario?.email ?? "") : "");

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  async function enviarConvite() {
    if (ocupado) return;
    const limpo = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpo)) return setErro("Digite um e-mail válido, como nome@cnpem.br.");
    if (limpo === emailDoResponsavel) return setErro("Você é o responsável e já tem acesso total.");
    if (convidados.some((c) => c.email === limpo)) return setErro("Essa pessoa já tem acesso. Mude a permissão dela na lista abaixo.");
    setOcupado("convite");
    try {
      await convidar(experimento.codigo, limpo, permissao);
      setEmail("");
      setErro(null);
    } catch (falha) {
      // Como "Nenhuma conta com o e-mail ...": aparece embaixo do campo.
      setErro(mensagemDoErro(falha));
    } finally {
      setOcupado(null);
    }
  }

  async function naLista(convidado: Convidado, acao: () => Promise<void>) {
    if (ocupado) return;
    setOcupado(convidado.email);
    setErroNaLista(null);
    try {
      await acao();
    } catch (falha) {
      setErroNaLista(`${convidado.nome}: ${mensagemDoErro(falha)}`);
    } finally {
      setOcupado(null);
    }
  }

  const mudar = (c: Convidado, acesso: Permissao) => naLista(c, () => mudarPermissao(experimento.codigo, c, acesso));
  const remover = (c: Convidado) => naLista(c, () => removerAcesso(experimento.codigo, c));

  return (
    <div className={estilos.fundo} onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={estilos.modal} role="dialog" aria-modal="true" aria-labelledby="titulo-compartilhar">
        <div className={estilos.cabecalho}>
          <div className={estilos.textos}>
            <h2 id="titulo-compartilhar">Compartilhar {experimento.codigo}</h2>
            <p>{experimento.nome} · só você, o responsável, pode mudar quem tem acesso.</p>
          </div>
          <button type="button" className={estilos.fechar} onClick={onFechar} aria-label="Fechar">
            <img src={iconeFechar} width={20} height={20} alt="" />
          </button>
        </div>

        <form
          className={estilos.convidar}
          onSubmit={(e) => {
            e.preventDefault();
            enviarConvite();
          }}
        >
          <label htmlFor="email-convite" className={estilos.rotulo}>
            Convidar por e-mail
          </label>
          <div className={estilos.linhaConvite}>
            <div className={estilos.entradaEmail} data-erro={erro !== null || undefined}>
              <img src={iconeEmail} width={16} height={16} alt="" />
              <input
                id="email-convite"
                type="email"
                value={email}
                placeholder="nome@cnpem.br"
                autoFocus
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErro(null);
                }}
              />
            </div>
            <SeletorDePermissao valor={permissao} onChange={setPermissao} rotulo="Permissão do convidado" />
            <Botao tipo="primario" submit ocupado={ocupado === "convite"}>
              {ocupado === "convite" ? "Convidando..." : "Convidar"}
            </Botao>
          </div>
          {erro ? (
            <p className={estilos.erro} role="alert">
              {erro}
            </p>
          ) : (
            <p className={estilos.dica}>A pessoa precisa já ter conta no sistema.</p>
          )}
        </form>

        <div className={estilos.pessoas}>
          <p className={estilos.rotulo}>Pessoas com acesso</p>
          <ul className={estilos.lista}>
            <li className={estilos.pessoa}>
              <span className={estilos.avatar}>{iniciais(experimento.responsavel.nome)}</span>
              <span className={estilos.pessoaTextos}>
                <span className={estilos.pessoaNome}>
                  {experimento.responsavel.nome}
                  {souEu && "  ·  você"}
                </span>
                {emailDoResponsavel && <span className={estilos.pessoaEmail}>{emailDoResponsavel}</span>}
              </span>
              <span className={estilos.seloResponsavel}>
                <img src={coroa12} width={12} height={12} alt="" />
                Responsável
              </span>
            </li>
            {convidados.map((c) => (
              <li key={c.email} className={estilos.pessoa}>
                <span className={estilos.avatar}>{iniciais(c.nome)}</span>
                <span className={estilos.pessoaTextos}>
                  <span className={estilos.pessoaNome}>{c.nome}</span>
                  <span className={estilos.pessoaEmail}>
                    {c.email}
                    {c.desde && ` · acesso desde ${formatar.data(c.desde)}`}
                  </span>
                </span>
                <SeletorDePermissao
                  valor={c.acesso}
                  onChange={(p) => mudar(c, p)}
                  rotulo={`Permissão de ${c.nome}`}
                  desabilitado={ocupado !== null}
                />
                <button
                  type="button"
                  className={estilos.remover}
                  disabled={ocupado !== null}
                  onClick={() => remover(c)}
                  aria-label={`Remover o acesso de ${c.nome}`}
                >
                  <img src={iconeRemover} width={16} height={16} alt="" />
                </button>
              </li>
            ))}
          </ul>
          {convidados.length === 0 && <p className={estilos.dica}>Ainda não está compartilhado com ninguém.</p>}
          {erroNaLista && (
            <p className={estilos.erro} role="alert">
              {erroNaLista}
            </p>
          )}
        </div>

        <div className={estilos.permissoes}>
          <div>
            <p className={estilos.permissaoTitulo}>
              <img src={olho} width={13} height={13} alt="" />
              Só leitura
            </p>
            <p>Vê células, gráficos e alertas. Exporta dados e duplica o experimento.</p>
          </div>
          <div>
            <p className={estilos.permissaoTitulo}>
              <img src={lapis} width={13} height={13} alt="" />
              Pode modificar
            </p>
            <p>Tudo da leitura, mais ajustar temperatura e pH, atribuir e tirar células.</p>
          </div>
          <div>
            <p className={estilos.permissaoTitulo}>
              <img src={coroa13} width={13} height={13} alt="" />
              Só o responsável
            </p>
            <p>Encerra o experimento e muda quem tem acesso.</p>
          </div>
        </div>

        <div className={estilos.rodape}>
          <p>O experimento aparece na lista de quem recebe acesso, com o selo da permissão. Ninguém recebe e-mail.</p>
          <Botao onClick={onFechar}>Concluir</Botao>
        </div>
      </div>
    </div>
  );
}
