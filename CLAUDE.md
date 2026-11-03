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
| consumidor | `python -m app.consumidor.main` | Assina os tópicos, valida, converte OD pela calibração, grava |
| regras | `python -m app.regras.main` | Roda verificações periódicas, abre e fecha alertas, marca setpoint como atingido |
| api | `uvicorn app.api.main:app` | FastAPI usada pela interface. Única forma de publicar setpoint |

## Estrutura

```
contrato/            tópicos e mensagens MQTT (Pydantic). Fonte única do formato
infra/               configuração dos serviços de fora do nosso código
  mosquitto/         mosquitto.conf do broker
  postgres/init/     SQL executado na primeira subida do PostgreSQL
backend/app/
  config.py          configuração por variáveis de ambiente
  banco/             conexão e TODAS as consultas (repositorios.py)
  calibracao/        od = a * od_bruto + b
  consumidor/        cliente MQTT e tratadores de mensagem
  regras/            verificações de alerta
  api/               endpoints FastAPI
simulador/           célula falsa: modelo físico, buffer SQLite, sinais de falha (python -m simulador.celula)
interface/           React + TypeScript + Vite (ver interface/README.md)
tests/unidade/       rápidos, sem infraestrutura
tests/integracao/    test_ponta_a_ponta.py, modo compose ou local
docs/contrato-mqtt.md  documento do contrato para o grupo do hardware
requirements.txt     instala tudo para desenvolver, inclusive os pacotes do projeto (-e .)
pyproject.toml       pacotes app, contrato e simulador; configuração do pytest e do Pyright
```

## Comandos

```bash
docker compose up --build                    # sobe tudo (broker, banco, backend, 3 células)
pip install -r requirements.txt             # dependências e pacotes app, contrato e simulador
pytest tests/unidade                         # segundos
cd interface && npm install && npm run dev  # interface em http://localhost:5173
pytest tests/integracao -v                   # ~70 s, usa Docker Compose
AMBIENTE=local pytest tests/integracao -v    # sem Docker, exige PostgreSQL 16 e Mosquitto, não roda como root
MANTER_AMBIENTE=1 ...                         # não apaga ambiente e logs ao final
docker compose kill -s SIGUSR1 celula-c02    # simula queda de rede da célula
docker compose kill -s SIGUSR2 celula-c02    # restaura
```

API em http://localhost:8000/docs. Banco em `postgresql://evolver:evolver@localhost:5432/evolver`.

## Contrato MQTT

Tópicos `evolver/v1/celula/{id}/{tipo}`, QoS 1 em tudo, JSON com campos extras proibidos.

| Tipo | Publica | Retida | Conteúdo |
|---|---|---|---|
| `estado` | célula, ou broker via LWT | sim | `online` + sensores, ou `offline` |
| `leitura` | célula | não | `seq, ts, temperatura_c, od_bruto, ph` |
| `setpoint` | API | sim | `id, temperatura_c` |
| `setpoint/resposta` | célula | não | `id, estado (recebido, aplicado, recusado), motivo` |

Estados do pedido de setpoint no banco: `solicitado → recebido → aplicado → atingido`, ou `recusado`. O `atingido` é decidido pelas regras, não pela célula.

## Regras que não podem ser quebradas

- **Mudou o contrato, atualize três lugares:** `contrato/`, `docs/contrato-mqtt.md` e os testes. Mudança incompatível vira `v2` no tópico, nunca altera a `v1`.
- **Idempotência em tudo que vem do MQTT.** QoS 1 entrega ao menos uma vez, então toda mensagem pode chegar repetida. Leituras usam `ON CONFLICT (id_celula, seq) DO NOTHING`. Setpoint nunca volta estado para trás (`avancar_pedido`).
- **`seq` é contínuo por célula e nunca zera.** É o que permite provar que o histórico está completo.
- **Nunca sobrescrever `od_bruto`.** A OD convertida pode ser recalculada, o valor bruto é o dado original.
- **SQL só em `backend/app/banco/repositorios.py`.** Consumidor, regras e API chamam funções de lá.
- **A interface só fala com a API.** Nunca direto com o banco ou o broker.
- **A API não publica com o broker desconectado.** O paho guardaria a mensagem e enviaria depois, aplicando um pedido que já foi dado como falho.
- **Consumidor usa `clean_session=False` e `client_id` fixo** (`evolver-consumidor`). Trocar isso quebra a entrega do que chegou enquanto ele estava parado.
- **Células só sobem depois que o consumidor se inscreve.** Antes da primeira inscrição o broker descarta o que chega. O consumidor cria `/tmp/consumidor-inscrito` ao ter a inscrição confirmada, o healthcheck dele no `docker-compose.yml` olha esse arquivo, e as células dependem dele (`service_healthy`). O modo local do teste faz a mesma espera.
- **Regras são idempotentes.** Rodar duas vezes não abre alerta duplicado (índice único parcial em `alerta`).

## Convenções

- Código, nomes, comentários, mensagens de log e de erro em **português**.
- Python 3.12, tipagem nas assinaturas, `str | None` em vez de `Optional`.
- Dependências: a versão fica no `requirements.txt` da parte que usa (`backend/`, `simulador/` ou `tests/`). O `requirements.txt` da raiz junta os três para desenvolver. O `pyproject.toml` registra os pacotes do projeto e guarda a configuração do pytest e do Pyright.
- Configuração só por variável de ambiente, lida em `config.py`. Novas variáveis vão também em `.env.example` e no `docker-compose.yml`.
- Mensagens de erro da API dizem o que aconteceu e como resolver, sem pedir desculpas.
- Toda funcionalidade nova que envolve MQTT ganha uma etapa no teste de integração.

## Banco

PostgreSQL 16 puro, sem TimescaleDB nem InfluxDB (decisão consciente: volume de ~69 mil linhas por dia com 16 células não justifica). Tabelas: `celula`, `experimento`, `calibracao`, `calibracao_padrao`, `leitura`, `pedido_setpoint`, `alerta`. Não há sistema de migração ainda: alterar o schema exige `docker compose down -v`.

## Estado atual

Base funcionando. 17 testes de unidade e as 10 etapas do teste ponta a ponta passando, no modo local e no modo Docker Compose. Em 02/11/2026 o modo Docker Compose passou três vezes seguidas, com o pytest rodando no Windows e os serviços em contêineres Linux.

Interface: barra lateral, tela Visão geral e telas da célula (Visão da célula, Ajustes, Diagnóstico) prontas, a partir do Figma (arquivo Telas). Por padrão usa dados de exemplo (`VITE_FONTE_DADOS=exemplo`), porque a API ainda não devolve experimento, estado do consumidor e das regras, nem setpoints aguardando.

## Problemas conhecidos

- **Alerta falso com consumidor parado.** Sem o consumidor, `ultimo_contato` não é atualizado e a regra `sem_comunicacao` abre alerta para todas as células. Correção planejada: consumidor grava sinal de vida e a regra ignora a checagem quando ele estiver parado.
- Sem autenticação na API e broker com `allow_anonymous true`. Aceitável só em desenvolvimento.
- Sem endpoints para criar e encerrar experimentos (tabela existe).

## Próximos passos

1. Sinal de vida do consumidor
2. Demais telas da interface (Experimentos, Alertas, Calibração, Exportar)
3. Autenticação na API e senha no broker
4. Endpoints de experimento
5. Fechar o contrato com o grupo do hardware
