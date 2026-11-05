// Manda para o Login quem abre uma tela do sistema sem estar logado, e
// guarda a tela pedida para voltar a ela depois de entrar.

import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useSessao } from "@/sessao/SessaoProvider";

export function ExigeLogin({ children }: { children: ReactNode }) {
  const { usuario } = useSessao();
  const local = useLocation();
  if (!usuario) return <Navigate to="/entrar" replace state={{ de: local.pathname + local.search }} />;
  return children;
}
