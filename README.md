# T.U.P.A

O T.U.P.A é o sistema central de monitoramento das células de cultivo. Ele acompanha de longe as culturas do eVOLVER, o equipamento de cultura contínua de microrganismos usado no CNPEM, e avisa o pesquisador quando algo dá errado. É o projeto PI6 de Engenharia de Software da PUC-Campinas, em parceria com o CNPEM.

As células publicam leituras num broker MQTT. Este repositório contém tudo que fica depois do broker (consumidor, regras, banco, API e interface web) e um simulador que faz o papel das placas para testar sem hardware.

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
| Interface com os dados reais | `VITE_FONTE_DADOS=api docker compose up --build` (sem a variável, as telas mostram os dados de exemplo do Figma) |
| Documentação interativa da API | http://localhost:8000/docs |
| Estado das células (com login) | `GET http://localhost:8000/celulas` |
| Histórico completo e sem repetições? (com login) | `GET http://localhost:8000/integridade` |
| Banco | `postgresql://evolver:evolver@localhost:5432/evolver` |
| E-mails dos alertas (Mailpit, nada sai da máquina) | http://localhost:8025 |
| Broker | `localhost:1883` |

### Usando a API

Todas as rotas exigem login, menos `/saude`, `/auth/cadastro` e `/auth/entrar`. O token vem do cadastro ou da entrada e vai no cabeçalho `Authorization`:

```bash
TOKEN=$(curl -s -X POST localhost:8000/auth/cadastro -H "Content-Type: application/json" \
        -d '{"nome": "Ana", "email": "ana@cnpem.br", "senha": "cultura123"}' | jq -r .token)

# Estado das células
curl localhost:8000/celulas -H "Authorization: Bearer $TOKEN"

# Muda a temperatura da c01; o pedido fica com o nome de quem está logado
curl -X POST localhost:8000/celulas/c01/setpoint -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"temperatura_c": 37}'

curl -X POST localhost:8000/experimentos -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"nome": "Curva de E. coli", "modo": "curva_crescimento", "temperatura_alvo_c": 30}'

# Põe a c01 no experimento e envia os 30 °C para a célula
curl -X POST localhost:8000/experimentos/1/cultivos -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" -d '{"id_celula": "c01", "condicao": "30 °C"}'
```

A lista completa de rotas está em http://localhost:8000/docs (o botão "Authorize" recebe o token). Sem token, ou com token inválido, a resposta é 401. O setpoint e a calibração registram quem fez o pedido.

A API precisa de `SEGREDO_SESSAO`, que assina os tokens (no Compose já vem um valor de desenvolvimento; troque fora dele). `SESSAO_HORAS` define a validade do token (padrão 12). As duas estão no `.env.example`.

### Banco que já tem dados

O `docker compose down -v` apaga o banco. Para aplicar o modelo de dados num banco que não pode ser perdido, faça um `pg_dump` antes e rode o script à mão; ele pode ser aplicado mais de uma vez sem mudar nada:

```bash
psql "postgresql://evolver:evolver@localhost:5432/evolver" -v ON_ERROR_STOP=1 -f infra/postgres/init/03_modelo_mvp.sql
```

### Falhas simuladas

A comunicação tem dois trechos, e cada um pode cair sozinho:

```
ESP32 (célula) ──Wi-Fi──▶ Raspberry Pi (broker) ──rede──▶ servidor (consumidor, API) ──▶ banco
```

No Docker Compose, o consumidor e a API chegam ao broker pelo serviço `enlace`, um repassador TCP que faz o papel da rede entre o servidor e o Raspberry Pi. As células ligam direto no broker. Pela CLI do simulador (`python -m simulador.cli`), cada queda volta sozinha depois do tempo pedido, e o que ainda estiver cortado é religado ao sair:

| Trecho | Na CLI | Direto no Docker | O que acontece |
|---|---|---|---|
| ESP ↔ Raspberry, uma célula | `rede 120` | `docker compose kill -s SIGUSR1 celula-c02` (`SIGUSR2` restaura) | Em ~45 s o broker declara a célula offline e abre `sem_comunicacao` nela. A célula guarda as leituras e reenvia ao voltar |
| ESP ↔ Raspberry, todas | `rede todas 120` | | `sem_comunicacao` em cada célula |
| Raspberry ↔ servidor | `servidor 120` | `docker compose pause enlace` (`unpause` religa) | Em ~30 a 45 s o consumidor e a API percebem, e ~20 s depois abre `broker_inacessivel`. As células seguem online e o broker guarda as leituras para o consumidor. Setpoint pela tela dá 503 |
| Raspberry ou broker fora do ar | `broker 60` | `docker compose stop broker` | Abre `broker_inacessivel` em ~20 s. As células guardam as leituras e reenviam |
| Consumidor parado | `consumidor 60` | `docker compose stop consumidor` | Abre `consumidor_parado` em ~30 s. O broker guarda as leituras |

Nas três últimas, a culpa não é das células: enquanto o servidor não está recebendo, e até `SEM_COMUNICACAO_S` depois de voltar, a regra `sem_comunicacao` não abre alerta, nem pelo `offline` que o broker publica das células conectadas quando ele mesmo sai do ar. Os dois alertas do sistema não têm célula e fecham sozinhos quando a conexão volta. A barra lateral da interface mostra o broker (visto pela API), o consumidor (`ativo`, `sem broker` ou `parado há…`) e as regras, pelo sinal de vida que os dois gravam na tabela `processo` (`GET /saude`). Em todos os casos o histórico fica completo: ao religar, o que ficou guardado chega e `GET /integridade` continua sem buracos.

### Relatório de falhas

Diz, para um período, quais alertas de comunicação abriram e fecharam e se alguma leitura se perdeu. Vale para falhas reais e simuladas, e sai em Markdown (para ler) e em JSON (os mesmos dados), na pasta `relatorios/` (fora do git):

```bash
python -m app.relatorio.falhas                 # últimas 24 h
python -m app.relatorio.falhas --desde 2h      # 30m, 2h, 1d ou "2026-11-11 14:00"; --ate, --pasta, --banco
```

Na CLI do simulador, cada falha provocada (`rede`, `servidor`, `broker`, `consumidor`) é anotada com início e fim em `relatorios/falhas-simuladas.jsonl`. O comando `relatorio` gera o relatório desde que a CLI abriu (`relatorio 2h` para outro período); ao sair, ele é gerado sozinho se houve falha sem relatório. Espere a comunicação voltar e os alertas fecharem antes de gerar, senão a falha aparece como em andamento.

Para cada falha simulada, o relatório traz:
- o alerta esperado e se ele abriu, e em quanto tempo;
- se fechou depois que a comunicação voltou;
- os alertas indevidos: célula culpada quando o problema era do servidor, ou o contrário;
- as leituras medidas durante a falha, e quantas chegaram depois, guardadas pela célula ou pelo broker;
- os `seq` que faltam.

Depois vêm todos os alertas do período e a integridade por célula. A última etapa do ponta a ponta gera o mesmo relatório para as falhas do roteiro e falha se alguma não der OK.

### Zerar e começar com dados de demonstração

```bash
python -m simulador.semente --zerar
```

**Apaga todos os dados do Docker Compose** (`down -v`: banco, broker e buffers das células) e então:

1. sobe broker, banco, backend e a interface no modo api (http://localhost:8080);
2. carrega o banco com o roteiro de 90 dias (`simulador/roteiro.py`): 4 pessoas (`pedro.ximenes@cnpem.br`, `rogerio.medina@cnpem.br`, `henry.piozzi@cnpem.br`, `gabriel.bonatto@cnpem.br`, senha `cultura123`), as 16 células com a calibração v1 (a c01 à c08 têm também a v2, em uso), 7 experimentos (`EXP-01` e `EXP-02` em andamento, `EXP-03` em stand by, `EXP-04`, `EXP-05` e `EXP-07` encerrados, `EXP-06` cancelado), 38 cultivos (14 abertos e 24 antigos), os pedidos de setpoint de cada cultivo e 7 alertas antigos já fechados;
3. liga as 16 células. Na primeira subida, cada uma publica 90 dias de leituras passadas pelo MQTT, uma a cada 20 min (`HISTORICO_HORAS` e `HISTORICO_PASSO_MIN`), com `seq` contínuo, antes das leituras ao vivo. São cerca de 104 mil leituras, que chegam em uns 6 minutos;
4. só então sobe as regras, para as leituras antigas não abrirem alertas de agora.

Em segundos as regras abrem dois alertas de verdade: desvio de temperatura na c03 (perfil com +3,4 °C) e setpoint sem confirmação na c11 (ignora o pedido de 37 °C). A c04 e a c16 ficam livres; a c04 é a usada para calibrar.

Opções: `--dias 7` publica menos histórico (carrega mais rápido), `--sem-celulas` não liga as células (para rodar `python -m simulador --historico 2160` fora do Docker). Se a máquina já usa a porta 5432, passe as portas e a URL do banco: `PORTA_BANCO=55432 python -m simulador.semente postgresql://evolver:evolver@localhost:55432/evolver --zerar`. Sem `--zerar`, só carrega no banco que já está no ar; isso só serve num banco vazio, porque o histórico das células começa no `seq` 0 e colidiria com leituras que já existissem. A carga não roda no init do PostgreSQL, porque o banco dos testes de integração precisa começar vazio.

### Regras de alerta criadas na tela

Além das verificações fixas, cada pessoa cria regras na tela Alertas (ou pela API): uma medida acima ou abaixo de um limite por alguns minutos seguidos.

```bash
# Avisa quando a temperatura de qualquer célula passar de 38 °C por 5 minutos seguidos
curl -X POST localhost:8000/regras -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"nome": "Temperatura alta", "parametro": "temperatura", "comparacao": "maior", "limite": 38, "por_minutos": 5}'
```

- `parametro`: `temperatura`, `od` ou `ph`. `comparacao`: `maior` ou `menor`. `por_minutos`: de 1 a 1440.
- Com `id_experimento`, a regra vale só para as células com cultivo aberto nele, e só o responsável ou quem pode modificar o experimento cria. Sem ele, vale para todas as células.
- O processo de regras avalia as regras a cada rodada e abre um alerta do tipo `regra` por célula. Ele só abre quando a medida ficou fora do limite pelo tempo inteiro, e fecha sozinho quando ela volta.
- `PATCH /regras/{id} {"ativa": false}` desliga a regra e fecha os alertas dela; `DELETE /regras/{id}` exclui. Os alertas antigos continuam no histórico.

### Exportar os dados

`POST /exportacoes` devolve o arquivo que a tela Exportar baixa. Por experimento, cada célula sai no período em que esteve nele; por célula, vale o período pedido:

```bash
curl -X POST localhost:8000/exportacoes -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"id_experimento": 1, "medidas": ["temperatura", "ph", "od", "taxa"], "agrupamento": "hora",
          "formato": "xlsx", "anexos": ["contexto", "parametros", "alertas", "calibracoes"]}' -o EXP-01.xlsx

curl -X POST localhost:8000/exportacoes -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
     -d '{"celulas": ["c01", "c02"], "desde": "2026-11-10T00:00:00-03:00", "ate": "2026-11-12T00:00:00-03:00",
          "medidas": ["od"], "agrupamento": "brutos", "formato": "csv"}' -o celulas.csv
```

- `agrupamento`: `brutos`, `hora`, `dia` ou `intervalo` (com `intervalo_min`, de 1 a 1440). Os agrupados trazem média, mínimo e máximo de cada medida e o número de leituras do intervalo.
- `taxa` é a taxa de crescimento em divisões por hora (inclinação de ln(OD) dentro do intervalo, dividida por ln 2). Só existe nos agrupados.
- `formato`: `xlsx` (aba Dados e uma aba por anexo) ou `csv` (só os dados, com `;` e vírgula decimal, como o Excel em português lê).
- `fuso` (padrão `America/Sao_Paulo`) vale para as datas do arquivo e para o começo de cada dia.
- O Excel é recusado (422) acima de 1.000.000 de linhas; nesse caso agrupe, reduza o período ou use o CSV.

### Calibrar a OD com o simulador

O terminal do simulador força o que o sensor da célula mede; quem calibra é a tela, e a reta que vale é a do servidor.

```bash
python -m simulador.cli c04               # abre o terminal de controle da c04
```

Na interface, abra a **Nova calibração** da c04 e alterne com o terminal:

| No terminal | Na tela |
|---|---|
| `branco` (bruto 100) | espera "estável" e grava o branco |
| `padrao 0.2 valor 0.235` (sensor lê como 0,235, bruto 570) | OD de referência 0,2 e grava |
| `padrao 0.35 valor 0.342` | OD de referência 0,35 e grava |
| `padrao 0.5 valor 0.51` | OD de referência 0,5 e grava |
| `padrao 0.8 valor 0.795` | OD de referência 0,8, grava e salva a calibração |
| `tabela` | confere a, b, R² e o b gravado no banco |
| `auto` | a célula volta à simulação normal |

A cada valor forçado, a célula publica na hora 6 leituras com ruído de 0,1% do bruto, então a janela fica estável em uns 3 s. O servidor usa a média dessas leituras, por isso a tela pode diferir da `tabela` nas últimas casas. Outras formas: `branco 120` e `padrao 0.8 bruto 1650` digitam o bruto; `ruido 5` aumenta o ruído para ver a tela recusar um ponto instável (`ruido auto` volta).

Como a curva é calculada: o branco não é ponto da reta, só é descontado (x = bruto − branco). A reta é ajustada por mínimos quadrados só com os padrões, `OD = a·x + b`, sem forçar o zero, e o banco guarda `a` e `b − a·branco`. Detalhes em `backend/app/calibracao/ajuste.py`.

### Provocar cada alerta pelo terminal

| Alerta | Como provocar | Quando abre e fecha |
|---|---|---|
| `desvio_temperatura` | `temp 38.5` numa célula com setpoint atingido (c01, 30 °C) | abre em ~1 min, depois de `ALERTA_PERSISTENCIA_S` (60 s) sem nenhuma leitura perto do alvo; `auto` volta e fecha |
| `desvio_temperatura` (setpoint não atingido) | `cenario falha_aquecimento` e um setpoint novo pela interface | a célula aplica, a temperatura não chega e o alerta abre após `SETPOINT_ATINGIR_S` (15 min); `cenario normal` conserta e fecha |
| `ph_fora_da_faixa` | `ph 5.5` numa célula com **cultivo aberto** (c01: faixa 6,6 a 7,2) | abre em ~1 min (`ALERTA_PERSISTENCIA_S`); `auto` fecha |
| `setpoint_sem_confirmacao` | `cenario ignorar_setpoint` e um setpoint novo pela interface | abre após `SETPOINT_TIMEOUT_S` (120 s); fecha quando um pedido mais novo é confirmado |
| `sem_comunicacao` | `rede 120` (corta a rede por 120 s, sem aviso ao broker) | abre em ~45 s, quando o broker declara a célula offline; fecha quando a rede volta, e as leituras guardadas são reenviadas |
| `colisao_seq` | `colisao` (o último seq de novo, com outro horário) | abre na hora; não fecha sozinho: o botão "Fechar alerta" da tela Alertas fecha e grava quem fechou |
| `broker_inacessivel` (sistema) | `servidor 120` ou `broker 60` | abre em ~20 s (broker parado) ou ~1 min (rede cortada); fecha quando o consumidor reconecta |
| `consumidor_parado` (sistema) | `consumidor 60` | abre em ~30 s; fecha quando ele volta |

Temperatura e pH só abrem alerta quando nenhuma leitura dos últimos `ALERTA_PERSISTENCIA_S` esteve dentro da faixa, então uma leitura ruidosa sozinha não abre nada (`ALERTA_PERSISTENCIA_S=0` no `.env` volta a abrir pela última leitura, útil para demonstrar). Com o alerta aberto, a mensagem acompanha o valor medido.

Com a rede cortada a célula não ouve o broker, por isso ela volta sozinha depois do tempo pedido. Para ver as células responderem a uma mudança, mande um setpoint pela interface: o pedido passa por solicitado, recebido, aplicado e, quando a temperatura chega, atingido.

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
| 4 | O consumidor para | Abre `consumidor_parado`, nenhuma célula ganha `sem_comunicacao`, nada é gravado e, ao voltar, ele recebe tudo que o broker guardou e o alerta fecha |
| 5 | O broker para | Abre `broker_inacessivel` sem culpar as células, que guardam localmente e reenviam quando ele volta; o alerta fecha |
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
| 16 | A c01 aplica um setpoint de 42 °C com o aquecedor sem funcionar | O pedido fica em aplicado e abre `desvio_temperatura` dizendo que a temperatura não chegou; consertado, o pedido vira atingido e o alerta fecha |
| 17 | Conferência final e relatório de falhas | Para cada célula, total = seq distintos = esperado; cada falha do roteiro abriu e fechou o alerta certo |

A conferência de integridade é esta consulta:

```sql
SELECT id_celula, count(*) AS leituras, count(DISTINCT seq) AS seq_unicos,
       max(seq) - min(seq) + 1 AS esperado
  FROM leitura GROUP BY id_celula;
```

## O que o teste ponta a ponta revelou

**Consumidor parado gerava alerta falso (corrigido).** Na etapa 4, com o consumidor parado, ninguém atualizava o último contato das células, e a regra de comunicação abria alerta para as três, mesmo com elas funcionando. Agora o consumidor grava um sinal de vida, a regra distingue "célula parou" de "consumidor parou" ou "servidor sem broker", e as etapas 4 e 5 conferem que só o alerta do sistema abre.

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

- Fechar o contrato de mensagens com o grupo do hardware (`docs/contrato-mqtt.md`)
- Senha no broker, que ainda aceita conexão anônima
- Gráficos para publicação na tela Exportar, a parte da interface que ainda não tem API
- E-mail também para os alertas fixos, principalmente os de comunicação (hoje só as regras criadas na tela avisam por e-mail, pelo Mailpit no Compose)
