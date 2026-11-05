// "modal Compartilhar" do Figma (nó 79:1961). Só o responsável abre: convida
// por e-mail, muda a permissão de quem já tem acesso ou remove o acesso.

import { useEffect, useState } from "react";
import coroa12 from "@/assets/icones/coroa-12.svg";
import coroa13 from "@/assets/icones/coroa-13.svg";
import iconeEmail from "@/assets/icones/email-16.svg";
import iconeFechar from "@/assets/icones/fechar-20.svg";
import lapis from "@/assets/icones/lapis-13.svg";
import olho from "@/assets/icones/olho-13.svg";
import iconeRemover from "@/assets/icones/remover-16.svg";
import { Botao } from "@/compartilhado/componentes/Botao";
import { iniciais, useSessao } from "@/sessao/SessaoProvider";
import estilos from "./Compartilhar.module.css";
import { useExperimentos } from "./ExperimentosProvider";
import type { Convidado, Experimento } from "./modelo";

type Permissao = Convidado["acesso"];

function SeletorDePermissao({ valor, onChange, rotulo }: { valor: Permissao; onChange: (p: Permissao) => void; rotulo: string }) {
  return (
    <select className={estilos.seletor} value={valor} aria-label={rotulo} onChange={(e) => onChange(e.target.value as Permissao)}>
      <option value="leitura">Só leitura</option>
      <option value="modificar">Pode modificar</option>
    </select>
  );
}

/** Nome provisório para quem ainda não entrou: a parte do e-mail antes do @. */
function nomeDoEmail(email: string): string {
  return email
    .split("@")[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map((parte) => parte[0].toUpperCase() + parte.slice(1))
    .join(" ");
}

export function Compartilhar({ experimento, onFechar }: { experimento: Experimento; onFechar: () => void }) {
  const { definirConvidados } = useExperimentos();
  const { usuario } = useSessao();
  const [email, setEmail] = useState("");
  const [permissao, setPermissao] = useState<Permissao>("leitura");
  const [erro, setErro] = useState<string | null>(null);
  const convidados = experimento.convidados;

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  function convidar() {
    const limpo = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(limpo)) return setErro("Digite um e-mail válido, como nome@cnpem.br.");
    if (limpo === experimento.responsavel.email || convidados.some((c) => c.email === limpo))
      return setErro("Essa pessoa já tem acesso. Mude a permissão dela na lista abaixo.");
    definirConvidados(experimento.codigo, [...convidados, { nome: nomeDoEmail(limpo), email: limpo, acesso: permissao, pendente: true }]);
    setEmail("");
    setErro(null);
  }

  const mudar = (alvo: string, acesso: Permissao) =>
    definirConvidados(experimento.codigo, convidados.map((c) => (c.email === alvo ? { ...c, acesso } : c)));
  const remover = (alvo: string) => definirConvidados(experimento.codigo, convidados.filter((c) => c.email !== alvo));

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
            convidar();
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
            <Botao tipo="primario" submit>
              Convidar
            </Botao>
          </div>
          {erro && <p className={estilos.erro}>{erro}</p>}
        </form>

        <div className={estilos.pessoas}>
          <p className={estilos.rotulo}>Pessoas com acesso</p>
          <ul className={estilos.lista}>
            <li className={estilos.pessoa}>
              <span className={estilos.avatar}>{iniciais(experimento.responsavel.nome)}</span>
              <span className={estilos.pessoaTextos}>
                <span className={estilos.pessoaNome}>
                  {experimento.responsavel.nome}
                  {experimento.responsavel.email === usuario?.email && "  ·  você"}
                </span>
                <span className={estilos.pessoaEmail}>{experimento.responsavel.email}</span>
              </span>
              <span className={estilos.seloResponsavel}>
                <img src={coroa12} width={12} height={12} alt="" />
                Responsável
              </span>
            </li>
            {convidados.map((c) => (
              <li key={c.email} className={estilos.pessoa}>
                <span className={c.pendente ? estilos.avatarPendente : estilos.avatar}>{iniciais(c.nome)}</span>
                <span className={estilos.pessoaTextos}>
                  <span className={estilos.pessoaNome}>{c.nome}</span>
                  <span className={estilos.pessoaEmail}>
                    {c.email}
                    {c.pendente && " · convite enviado, ainda não entrou"}
                  </span>
                </span>
                <SeletorDePermissao valor={c.acesso} onChange={(p) => mudar(c.email, p)} rotulo={`Permissão de ${c.nome}`} />
                <button type="button" className={estilos.remover} onClick={() => remover(c.email)} aria-label={`Remover o acesso de ${c.nome}`}>
                  <img src={iconeRemover} width={16} height={16} alt="" />
                </button>
              </li>
            ))}
          </ul>
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
          <p>Quem for convidado recebe um e-mail, e o experimento aparece na lista dela com o selo de compartilhado.</p>
          <Botao onClick={onFechar}>Concluir</Botao>
        </div>
      </div>
    </div>
  );
}
