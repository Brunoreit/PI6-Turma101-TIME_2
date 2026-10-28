import { Outlet } from "react-router-dom";
import { BarraLateral } from "./componentes/BarraLateral";
import estilos from "./Layout.module.css";

export function Layout() {
  return (
    <div className={estilos.layout}>
      <BarraLateral />
      <main className={estilos.conteudo}>
        <Outlet />
      </main>
    </div>
  );
}
