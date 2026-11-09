// Painel para encerrar ou resetar a participação da célula no experimento.
// Encerrar chama POST /cultivos/{id}/encerrar; Resetar chama
// POST /cultivos/{id}/cancelar, com o motivo pedido num modal. A API não
// apaga nada, nem as leituras nem o armazenamento local da placa.

import { useState } from "react";
import iconeSemConexao from "@/assets/icones/sem-conexao.svg";
import { AvisoDeAcesso, useAvisoDeAcesso } from "@/compartilhado/componentes/AvisoDeAcesso";
import { Botao } from "@/compartilhado/componentes/Botao";
import { ModalDeMotivo } from "@/compartilhado/componentes/ModalDeMotivo";
import { cancelarParticipacao, encerrarParticipacao } from "@/funcionalidades/celula/fonte";
import type { DetalheDaCelula, ExperimentoDaCelula } from "@/funcionalidades/celula/modelo";
import { mensagemDoErro } from "@/funcionalidades/conta/CartaoDeConta";
import { useExperimentos } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { useSessao } from "@/sessao/SessaoProvider";
import { acessoNaCelula, podeMexer } from "./calculos";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

interface Props {
  dados: DetalheDaCelula;
  experimento: ExperimentoDaCelula;
  /** Depois de encerrar ou cancelar: a célula fica livre. */
  aoMudar: () => void;
}

export function TirarDoExperimento({ dados, experimento, aoMudar }: Props) {
  const { buscar } = useExperimentos();
  const { usuario } = useSessao();
  const { aviso, mostrar } = useAvisoDeAcesso();
  const [resetando, setResetando] = useState(false);
  const [encerrando, setEncerrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const acesso = acessoNaCelula(experimento, buscar, usuario?.email);
  const pode = podeMexer(acesso);

  const semAcesso = (acao: string) => () =>
    mostrar({
      titulo: `Você precisa de acesso para ${acao}`,
      mensagem:
        acesso === null
          ? `A ${dados.id} está num experimento de outra pessoa. Só o responsável ou quem tem edição pode ${acao}.`
          : `Só o responsável pelo ${experimento.codigo} ou quem tem edição pode ${acao}. Você tem acesso só de leitura.`,
      acao: `Pedir acesso a ${experimento.responsavel}`,
    });

  async function encerrar() {
    if (!window.confirm(`Tirar a ${dados.id} do ${experimento.codigo}? A célula fica livre a partir de agora.`)) return;
    setErro(null);
    setEncerrando(true);
    try {
      await encerrarParticipacao(experimento.idCultivo);
      aoMudar();
    } catch (falha) {
      setErro(mensagemDoErro(falha));
    } finally {
      setEncerrando(false);
    }
  }

  return (
    <section className={comum.painel} aria-labelledby="titulo-tirar">
      <h2 id="titulo-tirar" className={comum.painelNome}>Tirar a célula do experimento</h2>
      <div className={estilos.acoes}>
        <div className={estilos.acao}>
          <p className={comum.painelDescricao}>
            A célula sai do {experimento.codigo} e fica livre. As leituras feitas até agora continuam no experimento.
          </p>
          <Botao ocupado={encerrando} onClick={encerrar} semAcesso={pode ? undefined : semAcesso("encerrar a participação")}>
            Encerrar participação
          </Botao>
        </div>
        <div className={estilos.acao}>
          <p className={comum.painelDescricao}>
            Para quando algo deu errado. Cancela a participação, que fica marcada como não válida no experimento. As
            leituras continuam guardadas.
          </p>
          <Botao tipo="perigo" onClick={() => setResetando(true)} semAcesso={pode ? undefined : semAcesso("resetar a célula")}>
            Resetar célula
          </Botao>
        </div>
        {erro && (
          <p className={estilos.ajudaErro} role="alert">
            {erro}
          </p>
        )}
      </div>
      <div className={estilos.perdaDeConexao}>
        <img src={iconeSemConexao} width={16} height={16} alt="" />
        <p>
          Perder a conexão não tira a célula do experimento: ela continua nele até alguém encerrar ou resetar a
          participação, e as leituras guardadas na placa entram quando ela voltar.
        </p>
      </div>

      <AvisoDeAcesso aviso={aviso} />
      {resetando && (
        <ModalDeMotivo
          titulo="Resetar célula"
          subtitulo={`${dados.id} · ${experimento.codigo} · ${experimento.nome}`}
          consequencias={
            <>
              A participação da {dados.id} no {experimento.codigo} fica cancelada e a célula fica livre. As leituras não
              são apagadas.
            </>
          }
          placeholder="Ex.: frasco contaminado"
          acao="Resetar célula"
          onFechar={() => setResetando(false)}
          onConfirmar={async (motivo) => {
            await cancelarParticipacao(experimento.idCultivo, motivo);
            setResetando(false);
            aoMudar();
          }}
        />
      )}
    </section>
  );
}
