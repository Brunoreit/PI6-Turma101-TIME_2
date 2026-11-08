# CLAUDE.md

Contexto do projeto para o Claude Code. Leia antes de mexer no código.

## O projeto

**T.U.P.A** é o sistema central de monitoramento das células de cultivo da plataforma eVOLVER. Projeto acadêmico PI6 de Engenharia de Software da PUC-Campinas, em parceria com o CNPEM (Centro Nacional de Pesquisa em Energia e Materiais). Equipe de 5 alunos.

O eVOLVER é um equipamento de cultura contínua de microrganismos. Cada célula (Smart Sleeve) é um frasco com sensores de temperatura, densidade óptica (OD) e pH, e os experimentos duram dias ou semanas sem supervisão. O sistema existe para que o pesquisador acompanhe as culturas de longe e seja avisado quando algo dá errado.

## Escopo da equipe

A equipe faz **somente o software de alto nível**, que é tudo depois do broker MQTT: consumidor, regras, banco, API e interface web.

Fora do escopo:
- Firmware das placas ESP32 (outro grupo faz)
- Hardware, sensores e atuadores
- Controle automatizado do cultivo (turbidostato, quimiostato)
- Comando de agitação, bombas, OD ou pH. **Só a temperatura é comandável**, por setpoint. OD e pH são apenas visualização

O `simulador/` faz o papel das placas para testes. Ele é ferramenta de teste, não entrega.

## Arquitetura

```
célula (simulador ou ESP32) ──MQTT──▶ Mosquitto ──▶ consumidor ──▶ PostgreSQL ◀── API ◀── interface
          ▲                              │                            ▲
          └────────── setpoint ──────────┘◀───────── API publica ─────┘
                                                                 regras
```

Três processos Python independentes, mesmo código-base em `backend/app/`:

| Processo | Comando | Papel |
|---|---|---|
| consumidor | `python -m app.consumidor.main` | Assina os tópicos, valida, converte OD pela calibração, grava. Abre o alerta `colisao_seq`, porque só ele vê a mensagem que colidiu |
| regras | `python -m app.regras.main` | Roda verificações periódicas, abre e fecha os outros alertas, marca setpoint como atingido |
| api | `uvicorn app.api.main:app` | FastAPI usada pela interface. Única forma de publicar setpoint (direto ou ao iniciar um cultivo) |

## Estrutura

```
contrato/            tópicos e mensagens MQTT (Pydantic). Fonte única do formato
infra/               configuração dos serviços de fora do nosso código
  mosquitto/         mosquitto.conf do broker
  postgres/init/     SQL executado na primeira subida do PostgreSQL (01, 02 e 03_modelo_mvp.sql)
backend/app/
  config.py          configuração por variáveis de ambiente
  banco/             conexão e as consultas (repositorios.py)
  calibracao/        od = a * od_bruto + b
  consumidor/        cliente MQTT e tratadores de mensagem
  regras/            verificações de alerta (verificacoes.py)
  api/               main.py (rotas), esquemas.py (entrada), autenticacao.py (senha e token)
simulador/           célula falsa: modelo físico, buffer SQLite, sinais de falha (python -m simulador.celula)
interface/           React + TypeScript + Vite, uma pasta por tela em src/funcionalidades/ (ver interface/README.md)
tests/unidade/       rápidos, sem infraestrutura
tests/integracao/    test_ponta_a_ponta.py (roteiro com MQTT) e test_modelo_dados.py (esquema, repositórios, consumidor, regra de pH e API), modo compose ou local
docs/contrato-mqtt.md                 documento do contrato para o grupo do hardware
docs/especificacao-modelo-dados-mvp.md  especificação do modelo de dados; valem as "Decisões da implementação", no fim
requirements.txt     instala tudo para desenvolver, inclusive os pacotes do projeto (-e .)
pyproject.toml       pacotes app, contrato e simulador; configuração do pytest e do Pyright
```

## Comandos

```bash
docker compose up --build                    # sobe tudo (broker, banco, backend, 3 células)
pip install -r requirements.txt             # dependências e pacotes app, contrato e simulador
pytest tests/unidade                         # segundos
cd interface && npm install && npm run dev  # interface em http://localhost:5173
pytest tests/integracao -v                   # ~2 min, usa Docker Compose
AMBIENTE=local pytest tests/integracao -v    # sem Docker, exige PostgreSQL 16 com btree_gist e Mosquitto, não roda como root
MANTER_AMBIENTE=1 ...                         # não apaga ambiente e logs ao final
docker compose kill -s SIGUSR1 celula-c02    # simula queda de rede da célula
docker compose kill -s SIGUSR2 celula-c02    # restaura
```

API em http://localhost:8000/docs. Banco em `postgresql://evolver:evolver@localhost:5432/evolver`.

## Contrato MQTT

Tópicos `evolver/v1/celula/{id}/{tipo}`, QoS 1 em tudo, JSON. Campos desconhecidos são proibidos, exceto na `leitura`, onde vão para `leitura.extras` com um aviso no log (uma vez por campo e célula).

| Tipo | Publica | Retida | Conteúdo |
|---|---|---|---|
| `estado` | célula, ou broker via LWT | sim | `online` + sensores e `versao` (gravada em `celula.firmware`), ou `offline` |
| `leitura` | célula | não | `seq, ts, temperatura_c, od_bruto, ph` |
| `setpoint` | API | sim | `id, temperatura_c` |
| `setpoint/resposta` | célula | não | `id, estado (recebido, aplicado, recusado), motivo` |

Medição nunca é recusada por estar fora de faixa: o pH aceita qualquer valor. Comandos continuam validados (setpoint fora de `TEMPERATURA_MIN_C`/`TEMPERATURA_MAX_C` dá 422).

Estados do pedido de setpoint no banco: `solicitado → recebido → aplicado → atingido`, ou `recusado`. O `atingido` é decidido pelas regras, não pela célula.

## Regras que não podem ser quebradas

- **Mudou o contrato, atualize três lugares:** `contrato/`, `docs/contrato-mqtt.md` e os testes. Mudança incompatível vira `v2` no tópico, nunca altera a `v1`.
- **Idempotência em tudo que vem do MQTT.** QoS 1 entrega ao menos uma vez, então toda mensagem pode chegar repetida. Leituras usam `ON CONFLICT (id_celula, seq) DO NOTHING`. Setpoint nunca volta estado para trás (`avancar_pedido`).
- **Colisão de `seq` não substitui a leitura.** O mesmo `seq` com o mesmo `ts` é reenvio e só é descartado. Com `ts` diferente, a original fica e o consumidor abre `colisao_seq` (`gravar_leitura` devolve `gravada`, `duplicada` ou `colisao`). Não há regra que feche esse alerta.
- **`seq` é contínuo por célula e nunca zera.** É o que permite provar que o histórico está completo.
- **Nunca sobrescrever `od_bruto`.** A OD convertida pode ser recalculada, o valor bruto é o dado original. Uma calibração nova recalcula tudo, só a partir de `recalcular_desde` ou nada (`recalcular: false`).
- **SQL só em `backend/app/banco/repositorios.py`.** Consumidor e API chamam funções de lá. A única exceção é `backend/app/regras/verificacoes.py`, que faz as próprias consultas de seleção (padrão que já existia e que a regra `ph_fora_da_faixa` segue). As gravações (abrir e fechar alertas, avançar o setpoint) continuam passando pelos repositórios.
- **A interface só fala com a API.** Nunca direto com o banco ou o broker.
- **A API não publica com o broker desconectado.** O paho guardaria a mensagem e enviaria depois, aplicando um pedido que já foi dado como falho. Vale para `POST /celulas/{id}/setpoint` e para iniciar cultivo de experimento com temperatura alvo: os dois dão 503 antes de gravar.
- **Perder a conexão nunca encerra cultivo nem experimento.** Nenhuma regra automática muda o status deles.
- **Operações de várias etapas usam transação e travam o experimento** (`SELECT ... FOR UPDATE`): iniciar cultivo, encerrar e cancelar experimento e o `PATCH /experimentos/{id}`. As conexões do pool estão em autocommit; use `with conn.transaction():`.
- **Consumidor usa `clean_session=False` e `client_id` fixo** (`evolver-consumidor`). Trocar isso quebra a entrega do que chegou enquanto ele estava parado.
- **Células só sobem depois que o consumidor se inscreve.** Antes da primeira inscrição o broker descarta o que chega. O consumidor cria `/tmp/consumidor-inscrito` ao ter a inscrição confirmada, o healthcheck dele no `docker-compose.yml` olha esse arquivo, e as células dependem dele (`service_healthy`). O modo local do teste faz a mesma espera.
- **Regras são idempotentes.** Rodar duas vezes não abre alerta duplicado (índice único parcial em `alerta`).
- **Senha e token nunca no log nem nas respostas.** Só `buscar_pessoa_por_email` devolve `senha_hash`, para conferir o login.

## Convenções

- Código, nomes, comentários, mensagens de log e de erro em **português**.
- Python 3.12, tipagem nas assinaturas, `str | None` em vez de `Optional`.
- Dependências: a versão fica no `requirements.txt` da parte que usa (`backend/`, `simulador/` ou `tests/`). O `requirements.txt` da raiz junta os três para desenvolver. O `pyproject.toml` registra os pacotes do projeto e guarda a configuração do pytest e do Pyright.
- Configuração só por variável de ambiente, lida em `config.py`. Novas variáveis vão também em `.env.example` e no `docker-compose.yml`.
- Mensagens de erro da API dizem o que aconteceu e como resolver, sem pedir desculpas.
- Toda funcionalidade nova que envolve MQTT ganha uma etapa no teste de integração. A etapa de integridade é sempre a última.

## Banco

PostgreSQL 16 puro, sem TimescaleDB nem InfluxDB (decisão consciente: volume de ~69 mil linhas por dia com 16 células não justifica). A extensão `btree_gist` (contrib, já presente na imagem `postgres:16-alpine`) é usada para impedir cultivos sobrepostos na mesma célula.

| Tabela | O que guarda |
|---|---|
| `celula` | Placas anunciadas, com `apelido` (único), `modelo` e `firmware` |
| `calibracao`, `calibracao_padrao` | Curvas de OD por célula, versionadas, uma ativa; com `sensor`, `pontos`, `r2`, `organismo` e quem calibrou |
| `leitura` | Medições, chave `(id_celula, seq)`, com `extras` para campos que o contrato não conhece |
| `pedido_setpoint` | Pedidos de temperatura, com `id_pessoa` quando há login |
| `alerta` | Tipos `sem_comunicacao`, `setpoint_sem_confirmacao`, `desvio_temperatura`, `ph_fora_da_faixa` e `colisao_seq`; um aberto por célula e tipo |
| `pessoa` | Contas: nome, e-mail (minúsculo, único) e resumo scrypt da senha |
| `experimento` | A ficha do estudo: `cadastrado` (Stand by), `em_andamento`, `encerrado` ou `cancelado` |
| `experimento_acesso` | Compartilhamento: `leitura` ou `edicao`. O responsável não tem linha aqui |
| `cultivo` | Uma célula num experimento durante um período. Uma célula, um cultivo por vez, sem períodos sobrepostos |

A visão `leitura_cultivo` liga cada leitura ao cultivo da mesma célula em cujo período ela foi medida (`ts_origem`). Leituras fora de cultivo continuam só na `leitura`.

Não há sistema de migração. O `03_modelo_mvp.sql` é idempotente e há dois caminhos para aplicá-lo:
- **Desenvolvimento e teste:** `docker compose down -v` e subir de novo. O 03 roda sozinho num volume novo.
- **Banco com dados que importam:** nunca `down -v`. Faça `pg_dump` antes e aplique à mão com `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/postgres/init/03_modelo_mvp.sql`. O script só apaga a tabela `experimento` antiga, e só se ela estiver vazia; com dados nela, para sem mudar nada.

## API

Rotas na raiz (sem prefixo; quem tira o `/api` é o proxy do Vite e o `nginx.conf` da interface).

**Login:** `POST /auth/cadastro {nome, email, senha}` (201) e `POST /auth/entrar {email, senha}` devolvem `{token, pessoa}`; `GET /auth/eu` devolve a pessoa. O token vai em `Authorization: Bearer <token>`. Senha de 8 a 128 caracteres, com letra e número. Token HMAC sem tabela de sessão, válido por `SESSAO_HORAS`.

**Rotas que já existiam continuam abertas.** Com token, `POST /celulas/{id}/setpoint` usa o nome da pessoa logada em `solicitado_por` e grava `id_pessoa`, e `POST /celulas/{id}/calibracoes` grava `id_pessoa`. Token presente e inválido dá 401 mesmo nelas. `GET /celulas` ganhou `descricao`, `apelido`, `modelo`, `firmware` e `cultivo_atual`.

**Rotas novas, todas com login:**

| Rota | Quem pode |
|---|---|
| `POST /experimentos`, `GET /experimentos?filtro=todos\|meus\|compartilhados` | logado (a lista mostra só os próprios e os compartilhados) |
| `GET /experimentos/{id}` (com cultivos e acessos), `POST /experimentos/{id}/duplicar` | qualquer acesso |
| `PATCH /experimentos/{id}` | responsável. `cadastrado`: tudo; `em_andamento`: só `descricao` e `metadados`; fechado: nada |
| `POST /experimentos/{id}/encerrar` | responsável. Só `em_andamento`; encerra junto os cultivos abertos |
| `POST /experimentos/{id}/cancelar {motivo}` | responsável. Cancela junto os cultivos abertos |
| `POST /experimentos/{id}/acessos {email, permissao}`, `DELETE /experimentos/{id}/acessos/{id_pessoa}` | responsável |
| `POST /experimentos/{id}/cultivos {id_celula, condicao?, replica?, continua_de?}` | responsável ou edição. Com `temperatura_alvo_c`, publica o setpoint e devolve `pedido_setpoint` e `setpoint_confirmado` |
| `PATCH /cultivos/{id}`, `POST /cultivos/{id}/encerrar`, `POST /cultivos/{id}/cancelar {motivo}` | responsável ou edição |
| `GET /cultivos/{id}/leituras` | qualquer acesso |
| `PATCH /celulas/{id} {apelido?, descricao?, modelo?}` | logado |

Experimento ou cultivo fora do alcance da pessoa dá 404 (não revela que existe); acesso insuficiente dá 403. Respostas de experimento trazem `codigo` (`EXP-01`), calculado na API.

**Variáveis da API:** `SEGREDO_SESSAO` assina os tokens e é obrigatória (sem ela a API não sobe; consumidor e regras não a usam). `SESSAO_HORAS` é a validade do token (padrão 12). No Compose, as duas ficam só no serviço `api`, com um segredo de desenvolvimento.

## Estado atual

Base e modelo de dados do MVP implementados (branch `feat/modelo-dados-mvp`, 06/11/2026). Passam 38 testes de unidade e, no modo Docker Compose, 105 testes de `test_modelo_dados.py` e as 16 etapas do ponta a ponta (a 16 é a integridade final). Em 02/11/2026 o modo Docker Compose passou três vezes seguidas, com o pytest rodando no Windows e os serviços em contêineres Linux. O modo local não foi conferido depois do modelo de dados (falta confirmar o `btree_gist` no PostgreSQL de quem o usa).

Interface: todas as telas do Figma (arquivo Telas) prontas, menos "Célula c08 · Antiga" e "Login · conta CNPEM (guardado)", que não serão usadas. São Login e as telas de conta, Visão geral, telas da célula (inclusive a célula livre e o modal de confirmar temperatura), Experimentos (lista, novo, detalhe, compartilhar, só leitura), Historiador, Alertas, Exportar dados e a nova calibração de OD (pela aba Ajustes da célula; a Calibração saiu da barra lateral). Por padrão usa dados de exemplo (`VITE_FONTE_DADOS=exemplo`). A API já tem login, experimentos, acessos e cultivos, mas a interface ainda não está ligada a eles: as telas de Login, contas e Experimentos usam dados de exemplo e guardam as mudanças só no navegador. Regras de alerta e exportação agrupada não existem na API (detalhes em `interface/README.md`).

## Problemas conhecidos

- **Alerta falso com consumidor parado.** Sem o consumidor, `ultimo_contato` não é atualizado e a regra `sem_comunicacao` abre alerta para todas as células. Correção planejada: consumidor grava sinal de vida e a regra ignora a checagem quando ele estiver parado.
- **Rotas antigas sem login e broker com `allow_anonymous true`.** Aceitável só em desenvolvimento. Qualquer um pode mandar setpoint para uma célula, mesmo com cultivo aberto. O login da interface ainda é só de demonstração (contas no `localStorage`).
- **`colisao_seq` não fecha sozinho.** Não há regra nem rota para fechar o alerta; ele fica aberto até o próximo `down -v`.
- **`setpoint_confirmado: false` sem teste.** Se o broker cair entre gravar o cultivo e publicar o setpoint, o cultivo fica criado e o pedido segue como solicitado. Esse caso não tem teste automático.
- **Alerta de pH por uma leitura só.** `ph_fora_da_faixa` olha só a última leitura do cultivo, sem tempo mínimo fora da faixa; uma leitura ruidosa abre o alerta.

## Próximos passos

1. Ligar a interface à API: login, experimentos, acessos, cultivos, apelido da célula, tipos de alerta novos e status "cancelado"
2. Sinal de vida do consumidor
3. Login nas rotas antigas e senha no broker
4. Endpoints de regras de alerta e de exportação agrupada (média por hora ou dia, Excel)
5. Fechar o contrato com o grupo do hardware, inclusive o ID por MAC e o modelo da placa
6. Escolher um processo de migração do banco depois da entrega
