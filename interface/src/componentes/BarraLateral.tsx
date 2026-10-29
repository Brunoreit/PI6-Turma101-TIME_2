// Barra lateral do Figma (nó 87:1743), comum a todas as telas.

import { NavLink, useLocation } from "react-router-dom";
import iconeAlertas from "../assets/icones/nav-alertas.svg";
import iconeCalibracao from "../assets/icones/nav-calibracao.svg";
import iconeExperimentos from "../assets/icones/nav-experimentos.svg";
import iconeExportar from "../assets/icones/nav-exportar.svg";
import iconeVisaoGeral from "../assets/icones/nav-visao-geral.svg";
import pontoSistema from "../assets/icones/ponto-sistema.svg";
import simboloCnpem from "../assets/icones/simbolo-cnpem.svg";
import { useDados } from "../dados/DadosProvider";
import estilos from "./BarraLateral.module.css";

export const ROTAS = [
  { caminho: "/", rotulo: "Visão geral", icone: iconeVisaoGeral },
  { caminho: "/experimentos", rotulo: "Experimentos", icone: iconeExperimentos },
  { caminho: "/alertas", rotulo: "Alertas", icone: iconeAlertas },
  { caminho: "/calibracao", rotulo: "Calibração", icone: iconeCalibracao },
  { caminho: "/exportar", rotulo: "Exportar dados", icone: iconeExportar },
] as const;

function ItemDoSistema({ nome, ok, rotuloOk }: { nome: string; ok: boolean | null; rotuloOk: string }) {
  const situacao = ok === null ? "sem dados" : ok ? rotuloOk : "parado";
  return (
    <div className={estilos.servico}>
      {ok ? (
        <img className={estilos.ponto} src={pontoSistema} width={7} height={7} alt="" />
      ) : (
        <span className={`${estilos.ponto} ${ok === null ? estilos.pontoSemDados : estilos.pontoParado}`} />
      )}
      <span className={estilos.servicoNome}>{nome}</span>
      <span className={estilos.servicoEstado}>{situacao}</span>
    </div>
  );
}

export function BarraLateral() {
  const { dados } = useDados();
  const alertas = dados?.alertas.length ?? 0;
  const sistema = dados?.sistema ?? { broker: null, consumidor: null, regras: null };
  // As telas da célula são abertas pela Visão geral, que fica marcada nelas.
  const naCelula = useLocation().pathname.startsWith("/celulas/");

  return (
    <aside className={estilos.barra}>
      <div className={estilos.marca}>
        <img src={simboloCnpem} width={32} height={32} alt="" />
        <div className={estilos.nome}>
          <span className={estilos.produto}>T.U.P.A</span>
          <span className={estilos.instituicao}>CNPEM · Monitoramento</span>
        </div>
      </div>

      <nav className={estilos.navegacao} aria-label="Principal">
        {ROTAS.map((rota) => (
          <NavLink
            key={rota.caminho}
            to={rota.caminho}
            end={rota.caminho === "/"}
            className={({ isActive }) => {
              const ativo = isActive || (rota.caminho === "/" && naCelula);
              return `${estilos.item} ${ativo ? estilos.ativo : ""}`;
            }}
          >
            {/* O SVG serve de máscara para a cor acompanhar o item ativo. */}
            <span
              className={estilos.icone}
              // Aspas obrigatórias: o Vite embute SVGs pequenos como data: URI.
              style={{ maskImage: `url("${rota.icone}")`, WebkitMaskImage: `url("${rota.icone}")` }}
              aria-hidden
            />
            <span className={estilos.rotulo}>{rota.rotulo}</span>
            {rota.caminho === "/alertas" && alertas > 0 && (
              <span className={estilos.contador} aria-label={`${alertas} alertas abertos`}>
                {alertas}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={estilos.espaco} />

      <section className={estilos.sistema} aria-label="Sistema">
        <span className={estilos.sistemaTitulo}>Sistema</span>
        <ItemDoSistema nome="Broker MQTT" ok={sistema.broker} rotuloOk="conectado" />
        <ItemDoSistema nome="Consumidor" ok={sistema.consumidor} rotuloOk="ativo" />
        <ItemDoSistema nome="Regras" ok={sistema.regras} rotuloOk="ativo" />
      </section>
    </aside>
  );
}
