import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { ROTAS } from "./componentes/BarraLateral";
import { DadosProvider } from "./dados/DadosProvider";
import { Layout } from "./Layout";
import "./estilos/global.css";
import { EmConstrucao } from "./telas/EmConstrucao";
import { VisaoGeral } from "./telas/VisaoGeral";

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <BrowserRouter>
      <DadosProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<VisaoGeral />} />
            {ROTAS.filter((r) => r.caminho !== "/").map((r) => (
              <Route key={r.caminho} path={`${r.caminho}/*`} element={<EmConstrucao titulo={r.rotulo} />} />
            ))}
            <Route path="*" element={<EmConstrucao titulo="Página não encontrada" />} />
          </Route>
        </Routes>
      </DadosProvider>
    </BrowserRouter>
  </StrictMode>,
);
