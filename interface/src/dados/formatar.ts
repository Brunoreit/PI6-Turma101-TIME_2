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

export function tempoDecorrido(desde: Date, agora: Date = new Date()): string {
  const segundos = Math.max(0, Math.round((agora.getTime() - desde.getTime()) / 1000));
  if (segundos < 60) return `há ${segundos} s`;
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  return `há ${Math.floor(horas / 24)} d`;
}
