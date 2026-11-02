// Números e datas no formato brasileiro: vírgula decimal e ponto de milhar.

export function decimal(valor: number, casas: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function inteiro(valor: number): string {
  return valor.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

export function temperatura(valor: number): string {
  return `${decimal(valor, 1)} °C`;
}

export function hora(data: Date): string {
  return data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** 06/10/2026 */
export function data(valor: Date): string {
  return valor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** 06/10 */
export function diaMes(valor: Date): string {
  return valor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

/** 06/10 08:14, ou 06/10 08:14:31 com segundos. */
export function diaHora(valor: Date, segundos = false): string {
  const horario = valor.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: segundos ? "2-digit" : undefined,
  });
  return `${diaMes(valor)} ${horario}`;
}

/** Duração longa, como "1 d 19 h" ou "3 h 12 min". */
export function duracao(desde: Date, agora: Date = new Date()): string {
  const minutos = Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / 60_000));
  const horas = Math.floor(minutos / 60);
  if (horas === 0) return `${minutos} min`;
  if (horas < 24) return `${horas} h ${minutos % 60} min`;
  return `${Math.floor(horas / 24)} d ${horas % 24} h`;
}

export function tempoDecorrido(desde: Date, agora: Date = new Date()): string {
  const segundos = Math.max(0, Math.round((agora.getTime() - desde.getTime()) / 1000));
  if (segundos < 60) return `há ${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}
