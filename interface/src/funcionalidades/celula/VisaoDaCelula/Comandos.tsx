// Painel "Comandos": setpoint de temperatura (o único comando real) e o
// andamento do último pedido.

import { useState, type FormEvent } from "react";
import iconeAgitacao from "@/assets/icones/agitacao.svg";
import iconeBombas from "@/assets/icones/bombas.svg";
import iconeCadeado from "@/assets/icones/cadeado.svg";
import iconeChama from "@/assets/icones/chama.svg";
import iconeCheckEtapa from "@/assets/icones/check-etapa.svg";
import interruptorLigado from "@/assets/icones/interruptor-ligado.svg";
import { Botao, SEM_API } from "@/compartilhado/componentes/Botao";
import * as formatar from "@/compartilhado/formatar";
import { enviarSetpoint } from "@/funcionalidades/celula/fonte";
import {
  TEMPERATURA_MAX_C,
  TEMPERATURA_MIN_C,
  type DetalheDaCelula,
  type EstadoDoPedido,
} from "@/funcionalidades/celula/modelo";
import { faixaDePh, temperaturaAlvo } from "./calculos";
import { ConfirmarTemperatura } from "./ConfirmarTemperatura";
import comum from "@/funcionalidades/celula/Celula.module.css";
import estilos from "./VisaoDaCelula.module.css";

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

export function Comandos({ dados, aoEnviar }: { dados: DetalheDaCelula; aoEnviar: () => void }) {
  const alvo = temperaturaAlvo(dados);
  const faixa = faixaDePh(dados.experimento);
  const [temperatura, setTemperatura] = useState(alvo === null ? "" : formatar.decimal(alvo, 1));
  const [phMin, setPhMin] = useState(faixa ? formatar.decimal(faixa[0], 1) : "");
  const [phMax, setPhMax] = useState(faixa ? formatar.decimal(faixa[1], 1) : "");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ erro: boolean; texto: string } | null>(null);

  const [confirmando, setConfirmando] = useState<number | null>(null);

  // Aplicar valida e abre a confirmação; o pedido só sai ao confirmar.
  function aplicar(evento: FormEvent) {
    evento.preventDefault();
    const valor = Number(temperatura.trim().replace(",", "."));
    if (!temperatura.trim() || !Number.isFinite(valor) || valor < TEMPERATURA_MIN_C || valor > TEMPERATURA_MAX_C) {
      setAviso({ erro: true, texto: `Digite uma temperatura entre ${TEMPERATURA_MIN_C} e ${TEMPERATURA_MAX_C} °C.` });
      return;
    }
    setAviso(null);
    setConfirmando(valor);
  }

  async function confirmar(valor: number) {
    setEnviando(true);
    try {
      await enviarSetpoint(dados.id, valor);
      setAviso({ erro: false, texto: `Pedido de ${formatar.temperatura(valor)} enviado. Acompanhe as etapas abaixo.` });
      aoEnviar();
    } catch (erro) {
      setAviso({ erro: true, texto: erro instanceof Error ? erro.message : String(erro) });
    } finally {
      setEnviando(false);
      setConfirmando(null);
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

      {confirmando !== null && (
        <ConfirmarTemperatura
          dados={dados}
          atual={alvo}
          novo={confirmando}
          enviando={enviando}
          onConfirmar={() => confirmar(confirmando)}
          onCancelar={() => setConfirmando(null)}
        />
      )}
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
