import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { EmConstrucao } from "@/app/EmConstrucao";
import { ExigeLogin } from "@/app/ExigeLogin";
import { Layout } from "@/app/Layout";
import { DadosProvider } from "@/dados/DadosProvider";
import "@/estilos/global.css";
import { Alertas } from "@/funcionalidades/alertas/Alertas";
import { Ajustes } from "@/funcionalidades/celula/Ajustes";
import { NovaCalibracao } from "@/funcionalidades/celula/NovaCalibracao/NovaCalibracao";
import { Diagnostico } from "@/funcionalidades/celula/Diagnostico";
import { VisaoDaCelula } from "@/funcionalidades/celula/VisaoDaCelula/VisaoDaCelula";
import { Cadastro } from "@/funcionalidades/conta/Cadastro";
import { Entrar } from "@/funcionalidades/conta/Entrar";
import { NovaSenha } from "@/funcionalidades/conta/NovaSenha";
import { RecuperarSenha } from "@/funcionalidades/conta/RecuperarSenha";
import { DetalheDoExperimento } from "@/funcionalidades/experimentos/DetalheDoExperimento";
import { Experimentos } from "@/funcionalidades/experimentos/Experimentos";
import { ExperimentosProvider } from "@/funcionalidades/experimentos/ExperimentosProvider";
import { NovoExperimento } from "@/funcionalidades/experimentos/NovoExperimento";
import { Exportar } from "@/funcionalidades/exportar/Exportar";
import { Historiador } from "@/funcionalidades/historiador/Historiador";
import { VisaoGeral } from "@/funcionalidades/visao-geral/VisaoGeral";
import { SessaoProvider } from "@/sessao/SessaoProvider";

createRoot(document.getElementById("raiz")!).render(
  <StrictMode>
    <BrowserRouter>
      <SessaoProvider>
        <Routes>
          <Route path="entrar" element={<Entrar />} />
          <Route path="cadastro" element={<Cadastro />} />
          <Route path="recuperar-senha" element={<RecuperarSenha />} />
          <Route path="nova-senha" element={<NovaSenha />} />
          <Route
            element={
              <ExigeLogin>
                <DadosProvider>
                  <ExperimentosProvider>
                    <Layout />
                  </ExperimentosProvider>
                </DadosProvider>
              </ExigeLogin>
            }
          >
            <Route index element={<VisaoGeral />} />
            <Route path="celulas/:id" element={<VisaoDaCelula />} />
            <Route path="celulas/:id/ajustes" element={<Ajustes />} />
            <Route path="celulas/:id/ajustes/calibracao" element={<NovaCalibracao />} />
            <Route path="celulas/:id/diagnostico" element={<Diagnostico />} />
            <Route path="experimentos" element={<Experimentos />} />
            <Route path="experimentos/novo" element={<NovoExperimento />} />
            <Route path="experimentos/:codigo" element={<DetalheDoExperimento />} />
            <Route path="historiador" element={<Historiador />} />
            <Route path="alertas" element={<Alertas />} />
            <Route path="exportar" element={<Exportar />} />
            <Route path="*" element={<EmConstrucao titulo="Página não encontrada" />} />
          </Route>
        </Routes>
      </SessaoProvider>
    </BrowserRouter>
  </StrictMode>,
);
