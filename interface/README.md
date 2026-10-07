# Interface web

HTML, CSS e JavaScript puros, sem etapa de build. O serviço `interface` do
`docker-compose.yml` serve esta pasta com nginx em http://localhost:8080
(porta em `PORTA_INTERFACE`).

O nginx repassa `/api/` para a API, então a interface fala só com a API,
nunca com o banco ou o broker, e não precisa de CORS. Como a pasta é montada
como volume, basta recarregar a página depois de editar um arquivo.

| Tela | Endpoint |
|---|---|
| Visão geral das células | `GET /celulas` |
| Gráficos de uma célula | `GET /celulas/{id}/leituras` |
| Mudar temperatura | `POST /celulas/{id}/setpoint` |
| Andamento dos pedidos | `GET /celulas/{id}/setpoints` |
| Alertas | `GET /alertas` |
| Exportar CSV | `GET /celulas/{id}/leituras.csv` |
| Situação do sistema | `GET /saude` |

Ainda sem tela: nova calibração (`POST /celulas/{id}/calibracoes`).
