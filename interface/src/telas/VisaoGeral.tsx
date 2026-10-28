// Tela "Visão geral" do Figma (nó 87:1742).

import { useState } from "react";
import { Link } from "react-router-dom";
import iconeExportar from "../assets/icones/exportar.svg";
import { CardDeCelula } from "../componentes/CardDeCelula";
import { useDados } from "../dados/DadosProvider";
import * as formatar from "../dados/formatar";
import type { CelulaResumo, VisaoGeral as Dados } from "../dados/modelo";
import estilos from "./VisaoGeral.module.css";

type Filtro = "todas" | "alerta" | "offline";

const FILTROS: { valor: Filtro; rotulo: string; aceita: (c: CelulaResumo) => boolean }[] = [
  { valor: "todas", rotulo: "Todas", aceita: () => true },
  { valor: "alerta", rotulo: "Com alerta", aceita: (c) => c.situacao === "alerta" },
  { valor: "offline", rotulo: "Offline", aceita: (c) => c.situacao === "offline" },
];

function plural(n: number, singular: string, varias: string): string {
  return `${formatar.inteiro(n)} ${n === 1 ? singular : varias}`;
}

function CardDeResumo({ rotulo, valor, detalhe, emAlerta = false }: {
  rotulo: string;
  valor: string;
  detalhe: string;
  emAlerta?: boolean;
}) {
  return (
    <div className={estilos.resumoCard}>
      <span className={estilos.resumoRotulo}>{rotulo}</span>
      <span className={emAlerta ? estilos.resumoValorAlerta : estilos.resumoValor}>{valor}</span>
      <span className={estilos.resumoDetalhe}>{detalhe}</span>
    </div>
  );
}

function Resumo({ dados }: { dados: Dados }) {
  const total = dados.celulas.length;
  const online = dados.celulas.filter((c) => c.situacao !== "offline").length;
  const celulasComAlerta = new Set(dados.alertas.map((a) => a.idCelula)).size;
  const { setpointsAguardando: setpoints, leituras24h: leituras } = dados;

  return (
    <div className={estilos.resumo}>
      <CardDeResumo rotulo="Células online" valor={formatar.inteiro(online)} detalhe={`de ${total}`} />
      <CardDeResumo
        rotulo="Alertas abertos"
        valor={formatar.inteiro(dados.alertas.length)}
        detalhe={dados.alertas.length ? `em ${plural(celulasComAlerta, "célula", "células")}` : "nenhum alerta"}
        emAlerta={dados.alertas.length > 0}
      />
      <CardDeResumo
        rotulo="Setpoints aguardando"
        valor={setpoints ? formatar.inteiro(setpoints.total) : "—"}
        detalhe={setpoints ? setpoints.detalhe : "sem dados da API"}
      />
      <CardDeResumo
        rotulo="Leituras nas últimas 24 h"
        valor={leituras ? formatar.inteiro(leituras.total) : "—"}
        detalhe={
          !leituras ? "sem dados da API"
            : leituras.perdidas === 0 ? "nenhuma perdida"
            : plural(leituras.perdidas, "perdida", "perdidas")
        }
      />
    </div>
  );
}

function AlertasAbertos({ dados, agora }: { dados: Dados; agora: Date }) {
  return (
    <section className={estilos.painel} aria-labelledby="titulo-alertas">
      <div className={estilos.painelCabecalho}>
        <h2 id="titulo-alertas" className={estilos.painelTitulo}>Alertas abertos</h2>
        <Link to="/alertas" className={estilos.link}>Ver todos</Link>
      </div>
      {dados.alertas.length === 0 && <p className={estilos.semAlertas}>Nenhum alerta aberto.</p>}
      {dados.alertas.map((alerta) => (
        <div key={alerta.id} className={estilos.alerta}>
          <span className={estilos.faixa} />
          <span className={estilos.alertaCelula}>{alerta.idCelula}</span>
          <span className={estilos.alertaTitulo}>{alerta.titulo}</span>
          <span className={estilos.alertaMensagem}>{alerta.mensagem}</span>
          <span className={estilos.alertaTempo}>{formatar.tempoDecorrido(alerta.abertoEm, agora)}</span>
          <Link to={`/celulas/${alerta.idCelula}`} className={estilos.link}>Abrir célula</Link>
        </div>
      ))}
    </section>
  );
}

export function VisaoGeral() {
  const { dados, erro } = useDados();
  const [filtro, setFiltro] = useState<Filtro>("todas");

  if (!dados) {
    return (
      <div className={estilos.tela}>
        <div className={estilos.tituloBloco}>
          <h1 className={estilos.titulo}>Visão geral</h1>
          <p className={erro ? estilos.erro : estilos.subtitulo}>{erro ?? "Carregando…"}</p>
        </div>
      </div>
    );
  }

  const agora = dados.atualizadoEm;
  const aceita = FILTROS.find((f) => f.valor === filtro)!.aceita;
  const celulas = dados.celulas.filter(aceita);

  return (
    <div className={estilos.tela}>
      <header className={estilos.cabecalho}>
        <div className={estilos.tituloBloco}>
          <h1 className={estilos.titulo}>Visão geral</h1>
          <p className={estilos.subtitulo}>
            {plural(dados.celulas.length, "célula monitorada", "células monitoradas")} · atualizado às{" "}
            {formatar.hora(dados.atualizadoEm)}
          </p>
          {erro && <p className={estilos.erro}>Falha na última atualização: {erro}</p>}
        </div>
        <div className={estilos.acoes}>
          <div className={estilos.filtro} role="group" aria-label="Filtrar células">
            {FILTROS.map((f) => (
              <button
                key={f.valor}
                type="button"
                className={filtro === f.valor ? estilos.filtroAtivo : estilos.filtroItem}
                aria-pressed={filtro === f.valor}
                onClick={() => setFiltro(f.valor)}
              >
                {f.rotulo} {dados.celulas.filter(f.aceita).length}
              </button>
            ))}
          </div>
          <Link to="/exportar" className={estilos.botaoExportar}>
            <img src={iconeExportar} width={16} height={16} alt="" />
            Exportar CSV
          </Link>
        </div>
      </header>

      <Resumo dados={dados} />
      <AlertasAbertos dados={dados} agora={agora} />

      <section className={estilos.celulas} aria-labelledby="titulo-celulas">
        <div className={estilos.celulasCabecalho}>
          <h2 id="titulo-celulas" className={estilos.celulasTitulo}>Células</h2>
          <span className={estilos.legenda}>Barras: densidade óptica a cada hora, nas últimas 24 h</span>
        </div>
        {celulas.length === 0 ? (
          <p className={estilos.semAlertas}>Nenhuma célula neste filtro.</p>
        ) : (
          <div className={estilos.grade}>
            {celulas.map((celula) => (
              <CardDeCelula key={celula.id} celula={celula} agora={agora} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
