// Componente "Conta do usuário" do Figma (nó 205:1653), no pé da barra
// lateral. Ao sair, a pessoa volta para a tela de Login.

import { useNavigate } from "react-router-dom";
import iconeSair from "@/assets/icones/sair.svg";
import * as formatar from "@/compartilhado/formatar";
import { iniciais, useSessao } from "@/sessao/SessaoProvider";
import estilos from "./ContaDoUsuario.module.css";

export function ContaDoUsuario() {
  const { usuario, sair } = useSessao();
  const navegar = useNavigate();
  if (!usuario) return null;

  return (
    <div className={estilos.conta}>
      <span className={estilos.avatar} aria-hidden>
        {iniciais(usuario.nome)}
      </span>
      <span className={estilos.nome} title={usuario.email}>
        {usuario.nome}
        {usuario.criadoEm && <span className={estilos.desde} title="Data em que a conta foi criada">desde {formatar.data(new Date(usuario.criadoEm))}</span>}
      </span>
      <button
        type="button"
        className={estilos.sair}
        onClick={() => {
          sair();
          navegar("/entrar");
        }}
      >
        <img src={iconeSair} width={14} height={14} alt="" />
        Sair
      </button>
    </div>
  );
}
