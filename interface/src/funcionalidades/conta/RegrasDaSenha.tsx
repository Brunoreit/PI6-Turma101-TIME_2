// Lista "regras da senha" do Cadastro: cada regra fica verde ao ser cumprida.

import iconeOk from "@/assets/icones/regra-ok.svg";
import { REGRAS_DA_SENHA } from "@/sessao/SessaoProvider";
import estilos from "./Conta.module.css";

export function RegrasDaSenha({ senha }: { senha: string }) {
  return (
    <ul className={estilos.regras} aria-label="Regras da senha">
      {REGRAS_DA_SENHA.map((regra) => {
        const ok = regra.ok(senha);
        return (
          <li key={regra.rotulo} data-ok={ok}>
            {ok ? <img src={iconeOk} width={12} height={12} alt="Cumprida:" /> : <span className={estilos.marcador} />}
            {regra.rotulo}
          </li>
        );
      })}
    </ul>
  );
}
