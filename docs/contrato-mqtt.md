# Contrato de mensagens MQTT

Versão 1. Documento para combinar com o grupo que desenvolve o firmware das placas. O código que implementa este contrato está em `contrato/`.

## Conexão

| Item | Valor |
|---|---|
| Broker | Eclipse Mosquitto, porta 1883 |
| client_id | `evolver-celula-{id}`, fixo por placa |
| Keepalive | 30 s. O broker declara a célula offline após 45 s sem sinal |
| QoS | 1 em todas as mensagens |
| Formato | JSON em UTF-8. Campos desconhecidos são rejeitados |
| id da célula | letras, números, `-` e `_`, até 32 caracteres. Ex.: `c01` |

## Tópicos

| Tópico | Quem publica | Retida | Quando |
|---|---|---|---|
| `evolver/v1/celula/{id}/estado` | Placa e broker | Sim | Ao conectar, ao desligar, e pelo broker quando a placa cai |
| `evolver/v1/celula/{id}/leitura` | Placa | Não | A cada intervalo de medição |
| `evolver/v1/celula/{id}/setpoint` | Sistema central | Sim | Quando o pesquisador muda a temperatura |
| `evolver/v1/celula/{id}/setpoint/resposta` | Placa | Não | Ao receber, aplicar ou recusar um setpoint |

## Mensagens

### estado

Ao conectar, a placa publica:

```json
{"estado": "online", "sensores": ["temperatura", "od", "ph"], "versao": "fw-1.0"}
```

Na conexão, a placa registra no broker a mensagem de última vontade (LWT), que o broker publica sozinho se ela cair sem avisar:

```json
{"estado": "offline"}
```

### leitura

```json
{"seq": 1532, "ts": "2026-10-06T20:31:05Z", "temperatura_c": 30.12, "od_bruto": 1834, "ph": 6.81}
```

| Campo | Regra |
|---|---|
| `seq` | Inteiro crescente por célula, começando em 0. **Nunca volta a zero**, nem ao reiniciar a placa. Precisa ser guardado em memória não volátil |
| `ts` | Horário da medição em UTC, formato ISO 8601 |
| `temperatura_c` | °C |
| `od_bruto` | Valor do sensor óptico sem calibração. A conversão para OD é feita no sistema central |
| `ph` | 0 a 14 |

Campos de sensores que a placa não tiver podem ser omitidos.

### Quando a conexão cai

A placa deve guardar as leituras localmente e reenviar todas, em ordem de seq, ao reconectar. Uma leitura só pode sair do armazenamento local depois que o broker confirmar o recebimento (PUBACK). Reenviar uma leitura que já chegou não causa problema: o sistema central descarta repetições pelo seq.

### setpoint

```json
{"id": "sp-7f3a91c2", "temperatura_c": 37.0}
```

A mensagem é retida, então a placa a recebe de novo toda vez que conecta. Ela deve guardar o `id` do último pedido tratado e ignorar um pedido com o mesmo `id`.

### setpoint/resposta

A placa responde cada pedido em duas etapas:

```json
{"id": "sp-7f3a91c2", "estado": "recebido"}
{"id": "sp-7f3a91c2", "estado": "aplicado"}
```

Ou recusa, com o motivo:

```json
{"id": "sp-7f3a91c2", "estado": "recusado", "motivo": "fora da faixa 20 a 45 °C"}
```

O estado `atingido` não é enviado pela placa. O sistema central decide quando a temperatura medida chegou perto do valor pedido.

## Pendências para fechar com o grupo do hardware

- Intervalo de medição definitivo
- Faixa de temperatura que a placa aceita
- Como a placa vai guardar o seq e as leituras pendentes
- Credenciais de acesso ao broker
