# T.U.P.A

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
PI6-Turma101-TIME_2/
├── docker-compose.yml      sobe tudo
├── .env.example            portas, faixas e tempos configuráveis
├── requirements.txt        instala tudo para desenvolver (pip install -r requirements.txt)
├── pyproject.toml          pacotes do projeto e configuração do pytest e do Pyright
├── contrato/               tópicos e mensagens MQTT (fonte única de verdade)
│   ├── topicos.py
│   └── mensagens.py
├── infra/
│   ├── mosquitto/          broker: persistência e fila para clientes desconectados
│   └── postgres/init/      tabelas, criadas na primeira subida do PostgreSQL (01, 02 e 03_modelo_mvp.sql)
├── backend/app/
│   ├── consumidor/         processo 1: assina o MQTT, valida e grava sem duplicar
│   ├── regras/             processo 2: alertas e estado "atingido" do setpoint
│   ├── api/                processo 3: FastAPI usada pela interface, com login
│   ├── calibracao/         OD bruta → OD, guardando o valor original
│   └── banco/              conexão e todas as consultas
├── simulador/              célula simulada: curva, buffer local, falhas, setpoint
│                           (fora do Docker: python -m simulador.celula)
├── interface/              React + TypeScript + Vite, servida pelo nginx (ver interface/README.md)
├── tests/
│   ├── unidade/            rápidos, sem broker nem banco
│   └── integracao/         test_ponta_a_ponta.py: o sistema inteiro, etapa por etapa
│                           test_modelo_dados.py: esquema, repositórios, regras e API
└── docs/
    ├── contrato-mqtt.md    documento para combinar com o grupo do hardware
    └── especificacao-modelo-dados-mvp.md   modelo de dados (pessoas, experimentos, cultivos)
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
| Interface web | http://localhost:8080 (crie uma conta em "Criar conta"; o login é pela API) |
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

### Experimentos pela API

Pessoas, experimentos, acessos e cultivos exigem login. O token vem do cadastro ou da entrada e vai no cabeçalho `Authorization`:

```bash
TOKEN=$(curl -s -X POST localhost:8000/auth/cadastro -H "Content-Type: application/json" \
        -d '{"nome": "Ana", "email": "ana@cnpem.br", "senha": "cultura123"}' | jq -r .token)

curl -X POST localhost:8000/experimentos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"nome": "Curva de E. coli", "modo": "curva_crescimento", "temperatura_alvo_c": 30}'

# Põe a c01 no experimento e envia os 30 °C para a célula
curl -X POST localhost:8000/experimentos/1/cultivos -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"id_celula": "c01", "condicao": "30 °C"}'
```

A lista completa de rotas está em http://localhost:8000/docs. As rotas que já existiam (células, leituras, setpoint, calibração, alertas, integridade) continuam sem login; com token, registram quem fez o pedido.

A API precisa de `SEGREDO_SESSAO`, que assina os tokens (no Compose já vem um valor de desenvolvimento; troque fora dele). `SESSAO_HORAS` define a validade do token (padrão 12). As duas estão no `.env.example`.

### Banco que já tem dados

O `docker compose down -v` apaga o banco. Para aplicar o modelo de dados num banco que não pode ser perdido, faça um `pg_dump` antes e rode o script à mão; ele pode ser aplicado mais de uma vez sem mudar nada:

```bash
psql "postgresql://evolver:evolver@localhost:5432/evolver" -v ON_ERROR_STOP=1 -f infra/postgres/init/03_modelo_mvp.sql
```

### Falhas simuladas

Para simular uma queda de rede na célula c02 e depois restaurar:

```bash
docker compose kill -s SIGUSR1 celula-c02   # corta
docker compose kill -s SIGUSR2 celula-c02   # restaura
```

## Testes

```bash
pip install -r requirements.txt            # uma vez: dependências e pacotes do projeto

pytest tests/unidade                       # segundos, sem Docker
pytest tests/integracao -v                 # ponta a ponta e modelo de dados, sobe tudo pelo Docker Compose (~2 min)
AMBIENTE=local pytest tests/integracao -v  # mesmo teste sem Docker (precisa de PostgreSQL 16 com btree_gist e Mosquitto)
```

Use `MANTER_AMBIENTE=1` para não apagar o ambiente e os logs ao final.

## O teste ponta a ponta

`tests/integracao/test_ponta_a_ponta.py` sobe três células simuladas e passa por estas etapas, em ordem. Leva cerca de um minuto e meio porque usa tempos curtos (leitura a cada 1 s). A conferência de integridade é sempre a última.

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
| 9 | O seq 0 da c01 publicado de novo, com outro horário e outros valores | O banco mantém a original e abre o alerta de colisão de seq |
| 10 | Duas calibrações novas na c02: sem recalcular e a partir de um instante | Só as leituras pedidas mudam de OD, e o valor bruto nunca muda |
| 11 | Células anunciam a versão do firmware | A versão fica gravada em cada célula |
| 12 | Uma leitura da c02 reenviada idêntica | É só descartada, sem alerta |
| 13 | A c01 num cultivo com faixa de pH que exclui o pH simulado | O alerta de pH abre, fecha quando a faixa muda e fecha ao encerrar o cultivo |
| 14 | Cultivo na c02 iniciado pela API, em experimento com temperatura alvo de 33 °C | O pedido de setpoint sai com o nome de quem iniciou e chega a aplicado |
| 15 | O broker para e alguém inicia um cultivo com temperatura alvo | A API recusa (503) sem gravar nada; sem temperatura alvo, o cultivo começa |
| 16 | Conferência final | Para cada célula, total = seq distintos = esperado |

A conferência de integridade é esta consulta:

```sql
SELECT id_celula, count(*) AS leituras, count(DISTINCT seq) AS seq_unicos,
       max(seq) - min(seq) + 1 AS esperado
  FROM leitura GROUP BY id_celula;
```

## O que o teste ponta a ponta revelou

**Consumidor parado gera alerta falso.** Na etapa 4, com o consumidor parado, ninguém atualiza o último contato das células, e a regra de comunicação abre alerta para as três, mesmo com elas funcionando. Hoje o alerta fecha sozinho quando o consumidor volta. Para produção, vale o consumidor registrar um sinal de vida e a regra distinguir "célula parou" de "consumidor parou".

**A primeira leitura podia se perder.** O broker só guarda mensagens para o consumidor depois que ele se inscreve pela primeira vez. Se uma célula subisse antes, a leitura `seq 0` era descartada, e o teste falhava de vez em quando, conforme a ordem em que os contêineres subiam. Agora o consumidor avisa quando está inscrito (healthcheck) e o Docker Compose só sobe as células depois disso.

**Duplicatas só aparecem quando forçadas.** Nas falhas simuladas, o reenvio não gerou nenhuma leitura repetida, e por isso as etapas 9 e 12 publicam uma de propósito. Com a placa real e rede instável, elas vão acontecer, e o banco já está preparado.

## Decisões de projeto

- **MQTT com QoS 1.** Entrega ao menos uma vez. O banco descarta repetições pela chave (célula, seq).
- **Sessão persistente no consumidor.** Se ele parar, o broker guarda as mensagens e entrega quando voltar.
- **Mensagens retidas para estado e setpoint.** Quem conecta depois recebe o último valor na hora.
- **Seq contínuo por célula, que não zera ao reiniciar.** É o que permite saber se o histórico tem buracos.
- **Valor bruto sempre guardado.** Uma nova calibração (`POST /celulas/{id}/calibracoes`) pode recalcular a OD do histórico todo, só a partir de um instante (`recalcular_desde`) ou nenhuma (`recalcular: false`, só as próximas leituras usam a versão nova).
- **Consumidor, regras e API em processos separados.** A queda de um não para os outros.
- **Células sobem depois do consumidor.** O healthcheck do consumidor só fica saudável quando o broker confirma a inscrição, e as células dependem dele no `docker-compose.yml`.
- **Interface só fala com a API.** Validação e registro de quem mudou a temperatura ficam num lugar só.
- **Cultivo liga célula e experimento por período.** As leituras não apontam para o experimento: a visão `leitura_cultivo` liga cada leitura ao cultivo pelo horário da medição. Uma célula tem um cultivo por vez, e perder a conexão nunca encerra cultivo nem experimento.
- **Colisão de seq não apaga nada.** Se o mesmo seq chegar com outro horário, a leitura original fica e abre um alerta.

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

- Ligar a interface às rotas de acessos (Compartilhar) e cultivos (o login e os experimentos já estão ligados)
- Fechar o contrato de mensagens com o grupo do hardware (`docs/contrato-mqtt.md`)
- Login nas rotas antigas e senha no broker
- Endpoints para as telas que ainda usam dados de exemplo: regras de alerta e exportação agrupada
- Sinal de vida do consumidor, para evitar o alerta falso
