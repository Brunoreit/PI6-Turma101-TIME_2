// Selo "crítico" dos alertas abertos por uma regra de gravidade crítica. Não
// está no Figma: segue o selo "crítica" da lista de regras, em vermelho cheio
// para se destacar dos alertas comuns, que já são vermelhos claros.

import estilos from "./SeloCritico.module.css";

export function SeloCritico() {
  return (
    <span className={estilos.selo} title="Regra de gravidade crítica">
      crítico
    </span>
  );
}
