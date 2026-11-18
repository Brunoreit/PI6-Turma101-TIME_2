"""O cabo entre o servidor e o Raspberry Pi do broker, para simular o corte.

No Docker Compose o consumidor e a API não falam direto com o broker:
falam com este repassador TCP, que manda tudo para o broker. As células
continuam ligadas direto no broker, como as placas pelo Wi-Fi do
laboratório. Pausar o contêiner congela os pacotes no caminho, como um
cabo puxado, sem fechar nenhuma conexão:

  docker compose pause enlace     corta servidor ↔ Raspberry
  docker compose unpause enlace   religa

(ou "servidor cortar" e "servidor voltar" na CLI do simulador). É
ferramenta de teste, como o resto do simulador: em produção, MQTT_HOST
aponta direto para o Raspberry Pi.

Executar: python -m simulador.enlace   (ENLACE_PORTA, ENLACE_DESTINO=host:porta)
"""

import asyncio
import logging
import os

logging.basicConfig(level=logging.INFO, format="%(asctime)s enlace %(levelname)s %(message)s")
log = logging.getLogger("enlace")


async def _copiar(leitor: asyncio.StreamReader, escritor: asyncio.StreamWriter) -> None:
    try:
        while dados := await leitor.read(65536):
            escritor.write(dados)
            await escritor.drain()
    except (ConnectionError, OSError):
        pass
    finally:
        escritor.close()


def atender(host: str, porta: int):
    async def _atender(leitor: asyncio.StreamReader, escritor: asyncio.StreamWriter) -> None:
        origem = escritor.get_extra_info("peername")
        try:
            leitor_destino, escritor_destino = await asyncio.open_connection(host, porta)
        except OSError as erro:
            log.warning("destino %s:%d não respondeu (%s), fechando %s", host, porta, erro, origem)
            escritor.close()
            return
        log.info("ligado %s -> %s:%d", origem, host, porta)
        await asyncio.gather(_copiar(leitor, escritor_destino), _copiar(leitor_destino, escritor))
        log.info("desligado %s", origem)

    return _atender


async def servir(porta: int, host_destino: str, porta_destino: int) -> asyncio.Server:
    return await asyncio.start_server(atender(host_destino, porta_destino), "0.0.0.0", porta)


async def _main() -> None:
    porta = int(os.environ.get("ENLACE_PORTA", 1883))
    host, _, porta_destino = os.environ.get("ENLACE_DESTINO", "broker:1883").rpartition(":")
    servidor = await servir(porta, host, int(porta_destino))
    log.info("repassando :%d -> %s:%s", porta, host, porta_destino)
    async with servidor:
        await servidor.serve_forever()


if __name__ == "__main__":
    asyncio.run(_main())
