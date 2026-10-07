# Monitoramento das células do eVOLVER

Sistema central de monitoramento das células de cultivo do eVOLVER, projeto PI6 da PUC-Campinas em parceria com o CNPEM.

As células publicam leituras num broker MQTT. Este repositório contém tudo que fica depois do broker (consumidor, regras, banco e API) e um simulador que faz o papel das placas para testar sem hardware.

```
célula simulada ──MQTT──▶ Mosquitto ──▶ consumidor ──▶ PostgreSQL ◀── API FastAPI ◀── interface web
       ▲                      │                            ▲              │
       └──── setpoint ────────┘◀──────────── publica ──────┼──────────────┘
                                                        regras
```

## Estrutura

```
evolver-monitor/
├── docker-compose.yml      sobe tudo
├── .env.example            portas, faixas e tempos configuráveis
├── contrato/               tópicos e mensagens MQTT (fonte única de verdade)
│   ├── topicos.py
│   └── mensagens.py
├── broker/mosquitto.conf   persistência e fila para clientes desconectados
├── banco/init/             tabelas, criadas na primeira subida do PostgreSQL
├── backend/app/
│   ├── consumidor/         processo 1: assina o MQTT, valida e grava sem duplicar
│   ├── regras/             processo 2: alertas e estado "atingido" do setpoint
│   ├── api/                processo 3: FastAPI usada pela interface
│   ├── calibracao/         OD bruta → OD, guardando o valor original
│   └── banco/              conexão e todas as consultas
├── simulador/              célula simulada: curva, buffer local, falhas, setpoint
├── interface/              HTML e JS puros, servidos pelo nginx
├── tests/
│   ├── unidade/            rápidos, sem broker nem banco
│   └── integracao/         o primeiro teste da arquitetura, ponta a ponta
└── docs/contrato-mqtt.md   documento para combinar com o grupo do hardware
```

## Como rodar

Precisa de Docker com Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Depois de alguns segundos:

| O quê | Onde |
|---|---|
| Interface web | http://localhost:8080 |
| Documentação interativa da API | http://localhost:8000/docs |
| Estado das células | http://localhost:8000/celulas |
| Histórico completo e sem repetições? | http://localhost:8000/integridade |
| Banco | `postgresql://evolver:evolver@localhost:5432/evolver` |
| Broker | `localhost:1883` |

Para mudar a temperatura de uma célula:

```bash
curl -X POST localhost:8000/celulas/c01/setpoint \
     -H "Content-Type: application/json" -d '{"temperatura_c": 37}'
```

Para simular uma queda de rede na célula c02 e depois restaurar:

```bash
docker compose kill -s SIGUSR1 celula-c02   # corta
docker compose kill -s SIGUSR2 celula-c02   # restaura
```

## Testes

```bash
pip install -r requirements-dev.txt

pytest tests/unidade                       # segundos, sem Docker
pytest tests/integracao -v                 # primeiro teste, sobe tudo pelo Docker Compose
AMBIENTE=local pytest tests/integracao -v  # mesmo teste sem Docker (precisa de PostgreSQL 16 e Mosquitto)
```

Use `MANTER_AMBIENTE=1` para não apagar o ambiente e os logs ao final.

## O primeiro teste

`tests/integracao/test_primeiro_teste.py` sobe três células simuladas e passa por estas etapas, em ordem. Leva pouco mais de um minuto porque usa tempos curtos (leitura a cada 1 s).

| Etapa | O que acontece | Passa se |
|---|---|---|
| 1 | Três células sobem | Aparecem cadastradas sozinhas, online, com leituras |
| 2 | A rede da c02 é cortada sem aviso | O broker publica offline e abre o alerta de célula sem comunicação |
| 3 | A rede volta | As leituras guardadas chegam, sem buraco e sem repetição, e o alerta fecha |
| 4 | O consumidor para por 8 s | Nada é gravado e, ao voltar, ele recebe tudo que o broker guardou |
| 5 | O broker para por 8 s | As células guardam localmente e reenviam quando ele volta |
| 6 | Setpoint de 37 °C na c01 | Passa por solicitado, recebido, aplicado e atingido, nessa ordem |
| 7 | Setpoint de 80 °C | A API recusa por estar fora da faixa |
| 8 | Setpoint na c03, que ignora pedidos | O pedido fica em solicitado e abre alerta |
| 9 | Leitura repetida publicada três vezes | O banco mantém a original |
| 10 | Conferência final | Para cada célula, total = seq distintos = esperado |

A conferência de integridade é esta consulta:

```sql
SELECT id_celula, count(*) AS leituras, count(DISTINCT seq) AS seq_unicos,
       max(seq) - min(seq) + 1 AS esperado
  FROM leitura GROUP BY id_celula;
```

## O que o primeiro teste revelou

**Consumidor parado gera alerta falso.** Na etapa 4, com o consumidor parado, ninguém atualiza o último contato das células, e a regra de comunicação abre alerta para as três, mesmo com elas funcionando. Hoje o alerta fecha sozinho quando o consumidor volta. Para produção, vale o consumidor registrar um sinal de vida e a regra distinguir "célula parou" de "consumidor parou".

**Duplicatas só aparecem quando forçadas.** Nas falhas simuladas, o reenvio não gerou nenhuma leitura repetida, e por isso existe a etapa 9, que publica uma de propósito. Com a placa real e rede instável, elas vão acontecer, e o banco já está preparado.

## Decisões de projeto

- **MQTT com QoS 1.** Entrega ao menos uma vez. O banco descarta repetições pela chave (célula, seq).
- **Sessão persistente no consumidor.** Se ele parar, o broker guarda as mensagens e entrega quando voltar.
- **Mensagens retidas para estado e setpoint.** Quem conecta depois recebe o último valor na hora.
- **Seq contínuo por célula, que não zera ao reiniciar.** É o que permite saber se o histórico tem buracos.
- **Valor bruto sempre guardado.** Uma nova calibração recalcula a OD de todo o histórico (`POST /celulas/{id}/calibracoes`).
- **Consumidor, regras e API em processos separados.** A queda de um não para os outros.
- **Interface só fala com a API.** Validação e registro de quem mudou a temperatura ficam num lugar só.

## Equipe

| Nome | GitHub |
|---|---|
| Bruno Reitano Figuerola | [@Brunoreit](https://github.com/Brunoreit) |
| Gabriel Flores Bonatto | [@gabrielbntt](https://github.com/gabrielbntt) |
| Henry Gabriel Piozzi | [@HenryPiozzi](https://github.com/HenryPiozzi) |
| Pedro Ximenes Costa | [@pedro-xc](https://github.com/pedro-xc) |
| Rogério Medina | [@RogerioMedina](https://github.com/RogerioMedina) |

**Orientadora:** Profª Drª Sílvia C. de Matos Soares — PUC-Campinas 

## Próximos passos

- Fechar o contrato de mensagens com o grupo do hardware (`docs/contrato-mqtt.md`)
- Tela de calibração na interface
- Autenticação na API e senha no broker
- Sinal de vida do consumidor, para evitar o alerta falso
- Cadastro e encerramento de experimentos pela API
