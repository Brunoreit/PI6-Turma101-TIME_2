// Tela "Célula c08 · diagnóstico" do Figma (nó 87:1343): por onde a
// informação passa, do sensor até a tela, e onde ela parou.

import { Fragment } from "react";
import { useParams } from "react-router-dom";
import iconeApi from "../../assets/icones/caminho-api.svg";
import iconeBanco from "../../assets/icones/caminho-banco.svg";
import iconeBroker from "../../assets/icones/caminho-broker.svg";
import iconeConsumidor from "../../assets/icones/caminho-consumidor.svg";
import iconePlaca from "../../assets/icones/caminho-placa.svg";
import iconeSensores from "../../assets/icones/caminho-sensores.svg";
import iconeSetaDireita from "../../assets/icones/seta-direita.svg";
import iconeSetaEsquerda from "../../assets/icones/seta-esquerda.svg";
import { Botao } from "../../componentes/Botao";
import * as formatar from "../../dados/formatar";
import type { ChaveDaEtapa, DetalheDaCelula, EtapaDoCaminho } from "../../dados/modeloCelula";
import { useCelula } from "../../dados/useCelula";
import { CabecalhoDaCelula, CarregandoCelula } from "./CabecalhoDaCelula";
import comum from "./Celula.module.css";
import estilos from "./Diagnostico.module.css";

const SEM_DADOS = "A API ainda não informa estes dados.";

const PARTES: Record<ChaveDaEtapa, { nome: string; descricao: string; icone: string }> = {
  sensores: { nome: "Sensores", descricao: "temperatura, OD e pH", icone: iconeSensores },
  placa: { nome: "Placa ESP32", descricao: "grava no buffer local", icone: iconePlaca },
  broker: { nome: "Broker MQTT", descricao: "Raspberry Pi do laboratório", icone: iconeBroker },
  consumidor: { nome: "Consumidor", descricao: "valida, converte a OD e grava", icone: iconeConsumidor },
  banco: { nome: "Banco de dados", descricao: "PostgreSQL no servidor", icone: iconeBanco },
  api: { nome: "API e interface", descricao: "onde você está agora", icone: iconeApi },
};

/** Rótulo da seta que sai de cada etapa. */
const PROTOCOLO: Partial<Record<ChaveDaEtapa, string>> = { placa: "MQTT" };

const SITUACAO = (ok: boolean | null) => (ok === null ? "sem dados" : ok ? "funcionando" : "parado");

function Etapa({ etapa, firmware }: { etapa: EtapaDoCaminho; firmware: string | null }) {
  const parte = PARTES[etapa.chave];
  const descricao = etapa.chave === "placa" && firmware ? `${firmware} · ${parte.descricao}` : parte.descricao;
  const tipo = etapa.ok === null ? estilos.semDados : etapa.ok ? estilos.ok : estilos.parada;
  return (
    <li className={`${estilos.etapa} ${tipo}`}>
      <div className={estilos.etapaTopo}>
        <img src={parte.icone} width={18} height={18} alt="" />
        <h3 className={estilos.etapaNome}>{parte.nome}</h3>
        <span className={estilos.ponto} role="img" aria-label={SITUACAO(etapa.ok)} />
      </div>
      <p className={estilos.etapaDescricao}>{descricao}</p>
      <p className={estilos.etapaValor}>{etapa.valor}</p>
    </li>
  );
}

function CaminhoDaInformacao({ dados }: { dados: DetalheDaCelula }) {
  return (
    <section className={comum.painel} aria-labelledby="titulo-caminho">
      <div className={comum.painelTitulo}>
        <h2 id="titulo-caminho" className={comum.painelNome}>Caminho da informação</h2>
        <p className={comum.painelDescricao}>
          Cada caixa é uma parte do sistema. Verde está funcionando. Se uma parar, ela fica vermelha e as seguintes
          mostram desde quando não recebem nada.
        </p>
      </div>
      <ol className={estilos.fluxo}>
        {dados.caminho.map((etapa, i) => (
          <Fragment key={etapa.chave}>
            {i > 0 && (
              <li className={estilos.seta} aria-hidden>
                <img src={iconeSetaDireita} width={18} height={18} alt="" />
                {PROTOCOLO[dados.caminho[i - 1].chave] && (
                  <span className={estilos.protocolo}>{PROTOCOLO[dados.caminho[i - 1].chave]}</span>
                )}
              </li>
            )}
            <Etapa etapa={etapa} firmware={dados.placa.firmware} />
          </Fragment>
        ))}
      </ol>
      <div className={estilos.volta}>
        <img src={iconeSetaEsquerda} width={14} height={14} alt="" />
        <p>
          O setpoint faz o caminho de volta: interface, API, broker e placa. A placa responde recebido e aplicado, e o
          sistema marca atingido quando a temperatura chega no alvo.
        </p>
      </div>
    </section>
  );
}

function Dado({ rotulo, valor, mono = false, destaque = false }: { rotulo: string; valor: string; mono?: boolean; destaque?: boolean }) {
  const classes = [comum.dadoValor, mono && comum.mono, destaque && estilos.destaque].filter(Boolean).join(" ");
  return (
    <div className={comum.dado}>
      <span className={comum.dadoRotulo}>{rotulo}</span>
      <span className={classes}>{valor}</span>
    </div>
  );
}

function Placa({ dados }: { dados: DetalheDaCelula }) {
  const { placa } = dados;
  return (
    <section className={comum.painel} aria-labelledby="titulo-placa">
      <h2 id="titulo-placa" className={comum.painelNome}>Placa</h2>
      <Dado rotulo="Modelo" valor={placa.modelo ?? "—"} />
      <Dado rotulo="MAC" valor={placa.mac ?? "—"} mono />
      <Dado rotulo="Firmware" valor={placa.firmware ?? "—"} mono />
      <Dado rotulo="Sensores declarados" valor={placa.sensores.length ? placa.sensores.join(", ") : "nenhum"} />
      <Dado
        rotulo="Online desde"
        valor={placa.onlineDesde ? formatar.diaHora(placa.onlineDesde).replace(" ", " às ") : "—"}
      />
      <Dado rotulo="Keepalive" valor={placa.keepaliveS === null ? "—" : `${placa.keepaliveS} s`} />
    </section>
  );
}

function Sensores({ dados }: { dados: DetalheDaCelula }) {
  const quando = dados.ultimaLeituraEm ? formatar.tempoDecorrido(dados.ultimaLeituraEm, dados.atualizadoEm) : null;
  const linha = (valor: string | null) => (valor === null || quando === null ? "sem leitura" : `${valor} · ${quando}`);
  const od =
    dados.odBruto === null || dados.od === null
      ? null
      : `${formatar.inteiro(dados.odBruto)} → ${formatar.decimal(dados.od, 3)}`;
  const sensores: [string, string | null][] = [
    ["Temperatura", dados.temperaturaC === null ? null : formatar.temperatura(dados.temperaturaC)],
    ["OD bruta", od],
    ["pH", dados.ph === null ? null : formatar.decimal(dados.ph, 2)],
  ];
  return (
    <section className={comum.painel} aria-labelledby="titulo-sensores">
      <div className={comum.painelTitulo}>
        <h2 id="titulo-sensores" className={comum.painelNome}>Sensores</h2>
        <p className={comum.painelDescricao}>Última leitura de cada um.</p>
      </div>
      {sensores.map(([nome, valor]) => (
        <div key={nome} className={estilos.sensor}>
          <span className={valor === null ? estilos.pontoApagado : estilos.pontoOk} aria-hidden />
          <span className={comum.dadoRotulo}>{nome}</span>
          <span className={comum.dadoValor}>{linha(valor)}</span>
        </div>
      ))}
    </section>
  );
}

function IntegridadeDoHistorico({ dados }: { dados: DetalheDaCelula }) {
  const { integridade } = dados;
  return (
    <section className={comum.painel} aria-labelledby="titulo-integridade">
      <div className={comum.painelTitulo}>
        <h2 id="titulo-integridade" className={comum.painelNome}>Integridade do histórico</h2>
        <p className={comum.painelDescricao}>Prova que nenhuma leitura se perdeu no caminho.</p>
      </div>
      {!integridade ? (
        <p className={comum.semDados}>Ainda não há leituras gravadas desta célula.</p>
      ) : (
        <>
          <Dado rotulo="Último seq" valor={formatar.inteiro(integridade.ultimoSeq)} mono />
          <Dado rotulo="Leituras gravadas" valor={formatar.inteiro(integridade.gravadas)} />
          <Dado rotulo="Repetidas descartadas" valor={integridade.repetidas === null ? "—" : formatar.inteiro(integridade.repetidas)} />
          {integridade.buracos === 0 ? (
            <Dado rotulo="Buracos na sequência" valor="nenhum" destaque />
          ) : (
            <div className={comum.dado}>
              <span className={comum.dadoRotulo}>Buracos na sequência</span>
              <span className={`${comum.dadoValor} ${estilos.problema}`}>
                {formatar.inteiro(integridade.buracos)} {integridade.buracos === 1 ? "leitura faltando" : "leituras faltando"}
              </span>
            </div>
          )}
          <Dado
            rotulo="Pendentes na placa"
            valor={integridade.pendentesNaPlaca === null ? "—" : formatar.inteiro(integridade.pendentesNaPlaca)}
          />
        </>
      )}
    </section>
  );
}

function UltimasMensagens({ dados }: { dados: DetalheDaCelula }) {
  return (
    <section className={comum.painel} aria-labelledby="titulo-mensagens">
      <div className={comum.painelTitulo}>
        <h2 id="titulo-mensagens" className={comum.painelNome}>Últimas mensagens</h2>
        <p className={comum.painelDescricao}>
          O que chegou do broker para a {dados.id}, da mais nova para a mais antiga.
        </p>
      </div>
      {!dados.mensagens ? (
        <p className={comum.semDados}>{SEM_DADOS}</p>
      ) : dados.mensagens.length === 0 ? (
        <p className={comum.semDados}>Nenhuma mensagem recebida desta célula.</p>
      ) : (
        <table className={estilos.mensagens}>
          <thead className={comum.oculto}>
            <tr>
              <th>Recebida em</th>
              <th>Tipo</th>
              <th>Conteúdo</th>
            </tr>
          </thead>
          <tbody>
            {dados.mensagens.map((mensagem) => (
              <tr key={`${mensagem.em.getTime()}-${mensagem.tipo}`}>
                <td className={estilos.mensagemHora}>{formatar.diaHora(mensagem.em, true)}</td>
                <td className={mensagem.problema ? estilos.mensagemTipoProblema : estilos.mensagemTipo}>{mensagem.tipo}</td>
                <td className={estilos.mensagemConteudo}>{mensagem.conteudo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function Diagnostico() {
  const { id = "" } = useParams();
  const { dados, erro, recarregar } = useCelula(id);

  if (!dados) return <CarregandoCelula id={id} aba="Diagnóstico" erro={erro} />;

  return (
    <div className={comum.tela}>
      <CabecalhoDaCelula
        id={id}
        aba="Diagnóstico"
        subtitulo="Confira por onde a informação passa, do sensor até a tela, e onde algo parou."
        erro={erro}
        acao={<Botao onClick={recarregar}>Conferir agora</Botao>}
      />
      <CaminhoDaInformacao dados={dados} />
      <div className={estilos.detalhes}>
        <Placa dados={dados} />
        <Sensores dados={dados} />
        <IntegridadeDoHistorico dados={dados} />
      </div>
      <UltimasMensagens dados={dados} />
    </div>
  );
}
