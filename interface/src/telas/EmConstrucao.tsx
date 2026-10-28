// Rota reservada para as telas que ainda não foram feitas.

import estilos from "./VisaoGeral.module.css";

export function EmConstrucao({ titulo }: { titulo: string }) {
  return (
    <div className={estilos.tela}>
      <h1 className={estilos.titulo}>{titulo}</h1>
      <p className={estilos.subtitulo}>Tela ainda não implementada.</p>
    </div>
  );
}
