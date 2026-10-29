// Tela "Célula c08 · ajustes" do Figma (nó 85:1321). Nada aqui tem endpoint
// na API ainda: os botões aparecem como no Figma e dizem isso ao passar o
// mouse. No modo api, os painéis sem dados avisam que a API não os informa.

import { useState } from "react";
import { useParams } from "react-router-dom";
import iconeAlertaSelo from "../../assets/icones/alerta-selo.svg";
import iconeCheckSelo from "../../assets/icones/check-selo.svg";
import iconeChave from "../../assets/icones/chave.svg";
import { Botao, SEM_API } from "../../componentes/Botao";
import { Campo } from "../../componentes/Campo";
import { CurvaDeCalibracao } from "../../componentes/CurvaDeCalibracao";
import * as formatar from "../../dados/formatar";
import type { Bomba, DetalheDaCelula, VersaoDeCalibracao } from "../../dados/modeloCelula";
import { useCelula } from "../../dados/useCelula";
import estilos from "./Ajustes.module.css";
import { CabecalhoDaCelula, CarregandoCelula } from "./CabecalhoDaCelula";
import comum from "./Celula.module.css";

const SEM_DADOS = "A API ainda não informa estes dados.";

const MOTIVOS_DE_MANUTENCAO = ["Troca de mangueira", "Troca de frasco", "Ventoinha", "Bomba", "Outro"];

/** od = 0,00048 · bruto − 0,041 */
function formula(versao: VersaoDeCalibracao): string {
  const numero = (valor: number) => valor.toLocaleString("pt-BR", { maximumFractionDigits: 6 });
  return `od = ${numero(versao.a)} · bruto ${versao.b < 0 ? "−" : "+"} ${numero(Math.abs(versao.b))}`;
}

function TituloDoPainel({ id, nome, descricao }: { id: string; nome: string; descricao: string }) {
  return (
    <div className={comum.painelTitulo}>
      <h2 id={id} className={comum.painelNome}>{nome}</h2>
      <p className={comum.painelDescricao}>{descricao}</p>
    </div>
  );
}

// ---------------------------------------------------------------- calibração

function CalibracaoDeOd({ calibracao }: { calibracao: DetalheDaCelula["calibracao"] }) {
  const atual = calibracao?.atual;
  const padroes = atual?.padroes ?? [];
  const faixa = padroes.length
    ? `${padroes.length} padrões entre ${formatar.decimal(Math.min(...padroes.map((p) => p.referencia)), 1)} e ${formatar.decimal(Math.max(...padroes.map((p) => p.referencia)), 1)}`
    : null;

  return (
    <section className={comum.painel} aria-labelledby="titulo-calibracao">
      <TituloDoPainel
        id="titulo-calibracao"
        nome="Calibração de densidade óptica"
        descricao="Converte o valor bruto do sensor em OD. Como o valor bruto fica guardado, uma calibração nova pode recalcular todo o histórico."
      />

      {!atual ? (
        <p className={comum.semDados}>{SEM_DADOS}</p>
      ) : (
        <>
          <div className={estilos.emUso}>
            <div className={estilos.emUsoLinha}>
              <span className={estilos.emUsoVersao}>Versão {atual.versao}</span>
              <span className={`${estilos.selo} ${estilos.seloOk}`}>em uso</span>
            </div>
            <p className={estilos.formula}>{formula(atual)}</p>
            <p className={estilos.emUsoDetalhe}>
              {[
                formatar.data(atual.criadaEm),
                `por ${atual.autor}`,
                faixa,
                atual.r2 === null ? null : `R² = ${formatar.decimal(atual.r2, 3)}`,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          {padroes.length > 0 && (
            <>
              <CurvaDeCalibracao padroes={padroes} />
              <p className={estilos.nota}>
                Eixo vertical: OD calculada pelo T.U.P.A. Eixo horizontal: OD do espectrofotômetro. Em destaque, a
                faixa confiável de 0,2 a 0,8.
              </p>
            </>
          )}
        </>
      )}

      <div className={estilos.botoes}>
        <Botao tipo="primario" indisponivel={SEM_API}>Nova calibração</Botao>
        {atual && <Botao indisponivel={SEM_API}>Recalcular histórico com a versão {atual.versao}</Botao>}
      </div>

      <div className={estilos.passos}>
        <p className={estilos.passosTitulo}>A nova calibração é guiada em 3 passos</p>
        <ol className={estilos.passosLista}>
          <li>Ler o branco, com o frasco só com meio de cultura.</li>
          <li>Ler pelo menos 3 padrões de OD conhecida, entre 0,2 e 0,8.</li>
          <li>Conferir a curva e o R² antes de salvar.</li>
        </ol>
      </div>

      {calibracao && calibracao.anteriores.length > 0 && (
        <div className={estilos.versoes}>
          <h3 className={estilos.versoesTitulo}>Versões anteriores</h3>
          {calibracao.anteriores.map((versao) => (
            <div key={versao.versao} className={estilos.versao}>
              <span className={estilos.versaoNome}>Versão {versao.versao}</span>
              <span className={estilos.versaoDetalhe}>{formatar.data(versao.criadaEm)} · {versao.autor}</span>
              <span className={estilos.versaoFormula}>{formula(versao)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- bombas

const SELO_DA_BOMBA: Record<Bomba["situacao"], { texto: string; classe: string; icone?: string }> = {
  vencida: { texto: "checagem vencida", classe: estilos.seloVencido, icone: iconeAlertaSelo },
  em_dia: { texto: "em dia", classe: estilos.seloOk, icone: iconeCheckSelo },
  sem_uso: { texto: "sem uso", classe: estilos.seloNeutro },
};

function CardDeBomba({ bomba }: { bomba: Bomba }) {
  const selo = SELO_DA_BOMBA[bomba.situacao];
  return (
    <div className={bomba.situacao === "vencida" ? estilos.bombaVencida : estilos.bomba}>
      <div className={estilos.bombaLinha}>
        <h3 className={estilos.bombaNome}>{bomba.nome}</h3>
        <span className={`${estilos.selo} ${selo.classe}`}>
          {selo.icone && <img src={selo.icone} width={12} height={12} alt="" />}
          {selo.texto}
        </span>
      </div>
      <p className={estilos.bombaResumo}>{bomba.resumo}</p>
      <p className={estilos.bombaDetalhe}>{bomba.detalhe}</p>
      {bomba.situacao === "vencida" && <Botao tipo="primario" indisponivel={SEM_API}>Calibrar agora</Botao>}
    </div>
  );
}

function Bombas({ dados }: { dados: DetalheDaCelula }) {
  return (
    <section className={comum.painel} aria-labelledby="titulo-bombas">
      <TituloDoPainel id="titulo-bombas" nome="Bombas peristálticas" descricao="A vazão calibrada é usada para calcular o volume bombeado." />
      {dados.bombas ? dados.bombas.map((bomba) => <CardDeBomba key={bomba.nome} bomba={bomba} />) : (
        <p className={comum.semDados}>{SEM_DADOS}</p>
      )}
      <Campo
        rotulo="Checar as bombas a cada"
        valor={dados.checagemBombasDias === null ? "" : String(dados.checagemBombasDias)}
        unidade="dias"
        ajuda="O sistema avisa quando a checagem vence."
        somenteLeitura
      />
    </section>
  );
}

// ---------------------------------------------------------------- período de leitura

function PeriodoDeLeitura({ periodoS }: { periodoS: number | null }) {
  const [valor, setValor] = useState(periodoS === null ? "" : String(periodoS));
  return (
    <section className={comum.painel} aria-labelledby="titulo-periodo">
      <TituloDoPainel id="titulo-periodo" nome="Período de leitura" descricao="De quanto em quanto tempo a placa manda uma leitura." />
      <div className={estilos.linhaCampo}>
        <Campo rotulo="Uma leitura a cada" valor={valor} onChange={setValor} unidade="s" />
        <Botao indisponivel={SEM_API}>Aplicar</Botao>
      </div>
      <p className={estilos.ajuda}>Mínimo de 20 s. A mudança vai para a placa e fica no histórico.</p>
    </section>
  );
}

// ---------------------------------------------------------------- manutenção

function ModoManutencao({ manutencao }: { manutencao: DetalheDaCelula["manutencao"] }) {
  const [motivo, setMotivo] = useState("Troca de frasco");

  let estado = SEM_DADOS;
  if (manutencao) {
    const ultima = manutencao.ultima
      ? ` · última manutenção em ${formatar.diaMes(manutencao.ultima.em)}, ${manutencao.ultima.motivo}`
      : "";
    estado = `${manutencao.ativa ? "Ligado" : "Desligado"}${ultima}`;
  }

  return (
    <section className={comum.painel} aria-labelledby="titulo-manutencao">
      <TituloDoPainel
        id="titulo-manutencao"
        nome="Modo manutenção"
        descricao="Use quando for mexer na célula. Os alertas e o controle dela ficam pausados, e o período fica marcado no gráfico. A célula continua no experimento."
      />
      <div className={estilos.estadoManutencao}>
        <img src={iconeChave} width={16} height={16} alt="" />
        <p>{estado}</p>
      </div>
      <div className={estilos.grupo}>
        <span id="motivo-manutencao" className={estilos.grupoRotulo}>O que vai ser feito</span>
        <div className={estilos.opcoes} role="radiogroup" aria-labelledby="motivo-manutencao">
          {MOTIVOS_DE_MANUTENCAO.map((opcao) => (
            <button
              key={opcao}
              type="button"
              role="radio"
              aria-checked={motivo === opcao}
              className={motivo === opcao ? estilos.opcaoAtiva : estilos.opcao}
              onClick={() => setMotivo(opcao)}
            >
              {opcao}
            </button>
          ))}
        </div>
      </div>
      <div>
        <Botao indisponivel={SEM_API}>Iniciar manutenção</Botao>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- tela

export function Ajustes() {
  const { id = "" } = useParams();
  const { dados, erro } = useCelula(id);

  if (!dados) return <CarregandoCelula id={id} aba="Ajustes" erro={erro} />;

  const { placa, experimento } = dados;
  const subtitulo = [
    placa.modelo,
    placa.mac && `MAC ${placa.mac}`,
    experimento ? `${experimento.codigo} · ${experimento.nome}` : experimento === null ? "Livre · sem experimento" : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className={comum.tela}>
      <CabecalhoDaCelula
        id={id}
        aba="Ajustes"
        subtitulo={subtitulo || "Calibração, bombas, período de leitura e manutenção da célula."}
        erro={erro}
      />
      <div className={estilos.corpo}>
        <CalibracaoDeOd calibracao={dados.calibracao} />
        <div className={estilos.colunaDireita}>
          <Bombas dados={dados} />
          {/* key: ao trocar de célula, o campo volta ao valor dela. */}
          <PeriodoDeLeitura key={id} periodoS={dados.periodoLeituraS} />
          <ModoManutencao manutencao={dados.manutencao} />
        </div>
      </div>
    </div>
  );
}
