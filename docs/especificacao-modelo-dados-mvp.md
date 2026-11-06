# Especificação de implementação: modelo de dados do MVP

| | |
|---|---|
| Sistema | T.U.P.A, monitoramento das células do eVOLVER (PI6, PUC-Campinas + CNPEM) |
| Status | **Proposta para aprovação.** Nada aqui está implementado ainda |
| Base de código analisada | branch `develop`, commit `fdaf1b3` (06/11/2026) |
| Origem das decisões | Documento "T.U.P.A — Modelo de dados do MVP", reuniões com o orientador (inclusive a de 22/10), v2 do modelo proposto pelo Rogério, telas do Figma (arquivo Telas) |
| Entrega do projeto | 25/11/2026 |

## Como usar este documento

Este documento é a referência técnica para implementar o MVP do modelo de dados. Ele foi escrito para ser lido pelo Claude Code junto com o código.

1. Leia o `CLAUDE.md` antes deste documento. As regras dele continuam valendo, e a seção H lista as que este trabalho mais arrisca quebrar.
2. Antes de mudar qualquer arquivo, confira as afirmações das seções B.2 e D contra o código atual. O documento descreve o commit `fdaf1b3`; se o código mudou, a divergência precisa ser reportada antes de seguir.
3. Implemente **uma etapa por vez** (seção F). Cada etapa termina com uma validação e um ponto de parada para revisão humana.
4. Itens marcados como **pendência (P-n)** na seção I não são decisões tomadas. Onde uma etapa depende de uma pendência, ela não começa até a pendência ser respondida, mesmo que exista uma "proposta padrão".

Convenção usada no texto:
- **[existe]**: confirmado no código do commit `fdaf1b3`.
- **[muda]**: existe e será alterado.
- **[novo]**: não existe e será criado.
- **[sugerido]**: caminho ou nome proposto, que pode ser ajustado sem mudar o comportamento.

---

## A. Contexto e objetivo

### A.1 O problema

Hoje o banco registra **o que as células medem** (`leitura`), **o que foi pedido a elas** (`pedido_setpoint`), **como converter o OD** (`calibracao`) e **o que deu errado** (`alerta`). Ele não sabe **quem usa o sistema** nem **qual experimento cada célula está rodando**. A tabela `experimento` existe, mas modela "um experimento por célula" e nenhum código a usa.

As telas do Figma, já implementadas na interface com dados de exemplo, precisam de: login por e-mail e senha, experimentos com várias células, condição e período de cada célula no experimento, compartilhamento por e-mail, faixa de pH de referência, apelido e firmware da placa, e uma consulta das medições que não dependa de experimento (o historiador).

### A.2 Finalidade do modelo

1. **Historiador independente.** Toda medição de toda célula é gravada o tempo todo, com ou sem experimento. Pedido do orientador: "a célula liga com a medição, o experimento não".
2. **Experimento como ficha, cultivo como ponte.** O experimento descreve o estudo. O cultivo diz qual célula rodou qual experimento, de quando até quando, em qual condição. As leituras são ligadas ao cultivo pela célula e pelo horário, sem chave estrangeira.
3. **Pessoas e acesso.** Login simples por e-mail e senha (aprovado pelo orientador; o login institucional do CNPEM fica para depois) e compartilhamento por experimento.

### A.3 Princípios que guiam as decisões

1. A medição é da célula, não do experimento.
2. O cultivo é a ponte entre experimento e célula.
3. Nada se perde: medição estranha é gravada e marcada, cultivo cancelado não é apagado, `od_bruto` nunca é sobrescrito.
4. Estrutura certa agora, detalhes depois: o que é caro de mudar com dados reais (identidade da célula, chave da leitura, o que liga a quê) é fixado agora; tabelas e colunas novas esperam a necessidade.
5. O que ainda é incerto vai para campos flexíveis (`metadados` em JSONB).

### A.4 Limites do MVP

**Dentro:** as tabelas da seção B, as operações de banco (repositórios) que elas exigem, os ajustes no contrato MQTT, no consumidor e nas regras listados na seção C, autenticação simples e as rotas da API que expõem experimentos, acessos e cultivos.

**Fora (não implementar, nem parcialmente):**
- Eventos da célula no tempo, ocorrências e modo manutenção.
- Recuperação de senha por e-mail, login Microsoft do CNPEM, convite para quem ainda não tem conta.
- Regras de alerta configuráveis e canais (e-mail, WhatsApp).
- Catálogo de parâmetros (`parametro`, `experimento_parametro`, `ajuste_parametro`) e setpoint genérico.
- Fases do experimento.
- Bombas, vazão, agitação, período de leitura configurável.
- Quarentena de mensagens, gravação de diagnóstico, histórico de exportações, taxa de crescimento.
- Equipes, papel de administrador, habilitação de células.
- Mudanças na interface (`interface/`). A frente das telas liga as telas à API depois; este trabalho só garante que a API existe e é compatível.
- Mudanças no simulador (`simulador/`).
- TimescaleDB ou qualquer banco além do PostgreSQL 16.

---

## B. Modelo de dados

### B.1 Visão geral

```
                    ┌──────────── responsável ─────────────┐
                    ▼                                      │
   pessoa ◀── experimento_acesso ──▶ experimento ◀── cultivo ──▶ celula ◀── calibracao
     ▲                                  ▲  (id_origem)  │ ▲          ▲  ▲
     │                                  └───────────────┘ │(continua_de)│  └── pedido_setpoint
     └── (quem calibrou / quem pediu, opcional) ──────────┘          │  └── alerta
                                                                    │
                                                 leitura ───────────┘  (historiador)

   cultivo ┄┄┄ leitura : sem chave. Ligados por célula + intervalo de tempo (visão leitura_cultivo)
```

| Relacionamento | Cardinalidade | Como é garantido |
|---|---|---|
| pessoa → experimento (responsável) | 1 : 0..N | FK `experimento.id_responsavel` NOT NULL |
| experimento ↔ pessoa (compartilhamento) | N : N | Tabela `experimento_acesso`, PK composta |
| experimento → cultivo | 1 : 0..N | FK `cultivo.id_experimento` NOT NULL |
| celula → cultivo | 1 : 0..N, **no máximo 1 aberto**, períodos nunca sobrepostos | FK `cultivo.id_celula` + restrição de exclusão |
| cultivo → cultivo (continuação) | 0..1 : 0..N | FK `cultivo.continua_de`, nula |
| experimento → experimento (duplicado de) | 0..1 : 0..N | FK `experimento.id_origem`, nula |
| celula → leitura, calibracao, pedido_setpoint, alerta | 1 : 0..N | FKs existentes |
| calibracao → leitura | 1 : 0..N | FK existente `leitura.id_calibracao` |
| pessoa → calibracao, pedido_setpoint | 0..1 : 0..N | FKs novas, nulas |
| cultivo → leitura | 0..1 : 0..N, **sem FK** | Visão `leitura_cultivo` |

### B.2 Estado atual × proposto

Confirmado em `infra/postgres/init/01_tabelas.sql` e `02_calibracao_padrao.sql`.

| Tabela | Hoje | Ação |
|---|---|---|
| `celula` | [existe] `id_celula`, `descricao`, `sensores`, `estado`, `primeiro_anuncio`, `ultimo_contato` | [muda] + `apelido`, `modelo`, `firmware` |
| `experimento` | [existe] `id_experimento`, `id_celula`, `nome`, `organismo`, `inicio`, `fim`. Sem uso no código Python | [muda] **substituída** por outra estrutura |
| `calibracao` | [existe] `id_calibracao`, `id_celula`, `versao`, `a`, `b`, `ativa`, `criada_em` | [muda] + `sensor`, `pontos`, `r2`, `organismo`, `id_pessoa` |
| `calibracao_padrao` | [existe] | Sem mudança |
| `leitura` | [existe] chave `(id_celula, seq)` | [muda] + `extras` |
| `pedido_setpoint` | [existe] `solicitado_por` texto | [muda] + `id_pessoa` |
| `alerta` | [existe] 3 tipos | [muda] + tipos `ph_fora_da_faixa`, `colisao_seq` |
| `pessoa` | — | [novo] |
| `experimento_acesso` | — | [novo] |
| `cultivo` | — | [novo] |
| `leitura_cultivo` (visão) | — | [novo] |

O SQL completo, validado num PostgreSQL 16 (ver E.1), está no **Apêndice A**.

### B.3 Tabelas novas

#### `pessoa` [novo]

Quem usa o sistema.

| Campo | Tipo | Obrig. | Padrão | Regra |
|---|---|---|---|---|
| `id_pessoa` | SERIAL | PK | | |
| `nome` | TEXT | sim | | Não vazio |
| `email` | TEXT | sim | | Único; sempre em minúsculas e sem espaços nas pontas (CHECK); contém `@` |
| `senha_hash` | TEXT | sim | | Resumo da senha no formato da seção E.7. A senha nunca é gravada |
| `criado_em` | TIMESTAMPTZ | sim | `now()` | |

A API normaliza o e-mail (`lower(strip())`) antes de gravar. O CHECK do banco recusa o que escapar.

#### `experimento` [muda: substitui a tabela atual]

A ficha do estudo.

| Campo | Tipo | Obrig. | Padrão | Regra |
|---|---|---|---|---|
| `id_experimento` | SERIAL | PK | | Exibido como código "EXP-01" (P-8) |
| `nome` | TEXT | sim | | Não vazio |
| `descricao` | TEXT | não | | |
| `modo` | TEXT | sim | | `curva_crescimento`, `turbidostato` ou `quimiostato` |
| `status` | TEXT | sim | `cadastrado` | `cadastrado` (na tela, "Stand by"), `em_andamento`, `encerrado`, `cancelado` |
| `duracao_prevista_dias` | INTEGER | não | | > 0. Só previsão: o sistema nunca encerra sozinho |
| `temperatura_alvo_c` | DOUBLE PRECISION | não | | Temperatura enviada a cada célula quando o cultivo começa. A API valida contra `TEMPERATURA_MIN_C`/`TEMPERATURA_MAX_C` |
| `ph_ref_min`, `ph_ref_max` | DOUBLE PRECISION | não | | Faixa de pH de referência, copiada para cada cultivo. Se as duas existem, `min < max` |
| `metadados` | JSONB | sim | `'{}'` | Organismo, cepa, meio, volume, lote, inóculo. Lista de chaves ainda indefinida |
| `id_responsavel` | INTEGER | sim | | FK `pessoa`. Quem criou |
| `id_origem` | INTEGER | não | | FK `experimento`. De qual foi duplicado |
| `criado_em` | TIMESTAMPTZ | sim | `now()` | |
| `iniciado_em` | TIMESTAMPTZ | não | | Início do primeiro cultivo |
| `encerrado_em` | TIMESTAMPTZ | não | | |

CHECK de coerência entre status e datas:

| status | `iniciado_em` | `encerrado_em` |
|---|---|---|
| `cadastrado` | nulo | nulo |
| `em_andamento` | preenchido | nulo |
| `encerrado` | preenchido | preenchido |
| `cancelado` | qualquer | preenchido |

E `encerrado_em >= iniciado_em` quando os dois existem.

O campo `organismo` da tabela antiga não existe mais: o organismo vai em `metadados`.

#### `experimento_acesso` [novo]

Com quem o experimento é compartilhado.

| Campo | Tipo | Obrig. | Padrão | Regra |
|---|---|---|---|---|
| `id_experimento` | INTEGER | PK | | FK `experimento` |
| `id_pessoa` | INTEGER | PK | | FK `pessoa` |
| `permissao` | TEXT | sim | | `leitura` ("Só leitura") ou `edicao` ("Pode modificar") |
| `concedido_em` | TIMESTAMPTZ | sim | `now()` | |

O responsável **não** tem linha aqui: o acesso total dele vem de `experimento.id_responsavel`. Conceder acesso ao próprio responsável é recusado pela API (regra RN-10), porque um CHECK não consegue olhar outra tabela.

#### `cultivo` [novo]

Uma célula rodando um experimento durante um período.

| Campo | Tipo | Obrig. | Padrão | Regra |
|---|---|---|---|---|
| `id_cultivo` | SERIAL | PK | | |
| `id_experimento` | INTEGER | sim | | FK `experimento` |
| `id_celula` | TEXT | sim | | FK `celula` |
| `condicao` | TEXT | não | | Rótulo do grupo, ex.: "30 °C" |
| `replica` | SMALLINT | não | | > 0 |
| `ph_ref_min`, `ph_ref_max` | DOUBLE PRECISION | não | | Copiados do experimento ao iniciar; ajustáveis depois. `min < max` |
| `status` | TEXT | sim | `em_andamento` | `em_andamento`, `encerrado`, `cancelado` |
| `iniciado_em` | TIMESTAMPTZ | sim | `now()` | Atribuir a célula é iniciar o cultivo |
| `encerrado_em` | TIMESTAMPTZ | não | | Nulo se e somente se `status = em_andamento`. `>= iniciado_em` |
| `motivo_encerramento` | TEXT | não | | Obrigatório (não vazio) quando `status = cancelado` |
| `id_iniciado_por` | INTEGER | não | | FK `pessoa`. A API sempre preenche (exige login) |
| `id_encerrado_por` | INTEGER | não | | FK `pessoa`. A API sempre preenche ao encerrar ou cancelar |
| `continua_de` | INTEGER | não | | FK `cultivo`. A cultura veio deste cultivo (troca de placa ou de célula). Diferente do próprio id |
| `metadados` | JSONB | sim | `'{}'` | Livre |

Restrição de exclusão `cultivo_sem_sobreposicao`: para a mesma `id_celula`, os intervalos `[iniciado_em, encerrado_em)` (fim nulo = infinito) nunca se sobrepõem. Consequências:
- uma célula tem no máximo um cultivo aberto;
- um cultivo novo pode começar exatamente no instante em que o anterior terminou;
- cada leitura pertence a no máximo um cultivo.

A temperatura alvo da célula **não** é coluna do cultivo: é o último `pedido_setpoint` da célula (ver RN-17).

### B.4 Tabelas existentes que mudam

| Tabela | Coluna nova | Tipo | Obrig. | Padrão | Uso |
|---|---|---|---|---|---|
| `celula` | `apelido` | TEXT | não | | Nome de exibição ("c08"). Único (índice `celula_apelido_unico`; vários nulos são permitidos) |
| `celula` | `modelo` | TEXT | não | | Modelo da placa ("ESP32"). Não vem no contrato; é informado pela API (P-11) |
| `celula` | `firmware` | TEXT | não | | Campo `versao` da mensagem de estado |
| `calibracao` | `sensor` | TEXT | sim | `'od'` | Só `od` por enquanto (CHECK) |
| `calibracao` | `pontos` | JSONB | não | | Branco e padrões: lista de `{"od_referencia": n, "bruto": n}` |
| `calibracao` | `r2` | DOUBLE PRECISION | não | | Qualidade do ajuste, calculada por quem cadastra |
| `calibracao` | `organismo` | TEXT | não | | Com qual cultura a curva foi feita |
| `calibracao` | `id_pessoa` | INTEGER | não | | FK `pessoa`. Nulo na calibração padrão |
| `pedido_setpoint` | `id_pessoa` | INTEGER | não | | FK `pessoa`. Preenchido quando o pedido vem de alguém logado |
| `leitura` | `extras` | JSONB | não | | Campos da mensagem que o contrato não conhece |
| `alerta` | — | — | — | — | CHECK de `tipo` passa a aceitar também `ph_fora_da_faixa` e `colisao_seq` |

Nada é removido nem renomeado nas tabelas existentes. As restrições `UNIQUE (id_celula, versao)` e `calibracao_uma_ativa` continuam como estão (com um único sensor, não precisam incluir `sensor`).

### B.5 Visão `leitura_cultivo` [novo]

Liga cada leitura ao cultivo da mesma célula em cujo período ela foi medida: `ts_origem >= iniciado_em` e (`encerrado_em` nulo ou `ts_origem < encerrado_em`). Colunas: `id_cultivo`, `id_experimento`, `condicao`, `replica` e as colunas da `leitura` (lista explícita, não `l.*`). Não guarda nada. Leituras fora de qualquer cultivo continuam só na `leitura`.

O índice existente `leitura_por_tempo (id_celula, ts_origem)` atende a essa junção. Nenhum índice novo é necessário para ela.

### B.6 Exemplo

A pesquisadora Ana (`id_pessoa = 1`) cria o EXP-01 e o compartilha com o Henry (`id_pessoa = 2`) para edição. Ela inicia três cultivos; no dia 30 a placa da célula `c04` queima e a cultura vai para a `c07`.

| id_cultivo | id_celula | condicao | replica | status | iniciado_em | encerrado_em | motivo | continua_de |
|---|---|---|---|---|---|---|---|---|
| 1 | c01 | 30 °C | 1 | em_andamento | 03/11 14:00 | — | — | — |
| 2 | c04 | 34 °C | 1 | encerrado | 03/11 14:00 | 03/12 09:00 | placa queimou | — |
| 3 | c07 | 34 °C | 1 | em_andamento | 03/12 09:00 | — | — | 2 |

Uma leitura da `c04` medida em 02/12 e recebida em 04/12 (a placa ficou sem rede) aparece no cultivo 2 pela visão, porque a ligação usa o horário da medição.

---

## C. Regras de negócio e integridade

Cada regra indica onde é garantida (banco, repositório, API, consumidor ou regras) e de onde vem. Nenhuma regra fora desta lista deve ser criada sem aprovação.

### C.1 Garantidas pelo banco

| Id | Regra | Restrição |
|---|---|---|
| RB-01 | E-mail único, em minúsculas | `pessoa.email` UNIQUE + CHECK |
| RB-02 | Status do experimento coerente com as datas | `experimento_datas_do_status` |
| RB-03 | Faixa de pH com mínimo menor que máximo | `experimento_faixa_ph`, `cultivo_faixa_ph` |
| RB-04 | Uma célula, um cultivo por vez, sem sobreposição de períodos | `cultivo_sem_sobreposicao` (exclusão GiST) |
| RB-05 | Cultivo aberto não tem fim; cultivo fechado tem | `cultivo_aberto_sem_fim` |
| RB-06 | Cancelar exige motivo | `cultivo_cancelado_com_motivo` |
| RB-07 | Uma única permissão por pessoa e experimento, só `leitura` ou `edicao` | PK + CHECK em `experimento_acesso` |
| RB-08 | Apelido de célula único | `celula_apelido_unico` |
| RB-09 | Leitura sem duplicata | PK `(id_celula, seq)` [existe] |
| RB-10 | Uma calibração ativa por célula | `calibracao_uma_ativa` [existe] |
| RB-11 | Um alerta aberto por célula e tipo | `alerta_um_aberto` [existe] |

### C.2 Garantidas pelo código

| Id | Regra | Onde | Origem |
|---|---|---|---|
| RN-01 | Experimento novo nasce `cadastrado`, com o responsável = pessoa logada | API + repositório | Figma (Novo experimento); MVP |
| RN-02 | **Iniciar cultivo**, numa transação: travar a linha do experimento (`SELECT ... FOR UPDATE`); recusar se o experimento estiver `encerrado` ou `cancelado`; inserir o cultivo com `ph_ref_*` copiados do experimento e `id_iniciado_por`; se o experimento estava `cadastrado`, passar para `em_andamento` com `iniciado_em` = início do cultivo. Depois da transação, se `temperatura_alvo_c` existe, criar e publicar o pedido de setpoint pelo mesmo caminho do `POST /celulas/{id}/setpoint` | Repositório + API | MVP; Figma ("A atribuição envia os parâmetros à célula e marca o início") |
| RN-03 | Se o broker estiver desconectado e o experimento tiver `temperatura_alvo_c`, iniciar o cultivo é recusado com 503 **antes** de qualquer gravação | API | Regra existente "A API não publica com o broker desconectado" |
| RN-04 | Célula ocupada (violação de RB-04) responde 409 com mensagem que nomeia a célula | API | MVP |
| RN-05 | **Encerrar cultivo**: `status = encerrado`, `encerrado_em = now()`, `id_encerrado_por`, motivo opcional. Só cultivo `em_andamento` | Repositório + API | MVP (R2) |
| RN-06 | **Cancelar cultivo**: como RN-05, com `status = cancelado` e motivo obrigatório. Os dados nunca são apagados | Repositório + API | MVP (R2) |
| RN-07 | **Encerrar experimento**: só o responsável; ver P-9 sobre os cultivos abertos | Repositório + API | MVP + Figma, em conflito (P-9) |
| RN-08 | **Cancelar experimento**: só o responsável; motivo obrigatório; cancela na mesma transação os cultivos abertos, com o mesmo motivo | Repositório + API | MVP |
| RN-09 | **Duplicar**: cria um experimento `cadastrado` com `nome`, `descricao`, `modo`, `duracao_prevista_dias`, `temperatura_alvo_c`, `ph_ref_*` e `metadados` copiados; `id_origem` = original; responsável = quem duplicou. Cultivos, leituras e acessos não são copiados. Qualquer pessoa com acesso ao original pode duplicar | Repositório + API | Figma ("Copia nome, descrição, tipo, duração e parâmetros. Células e leituras não são copiadas"; "Duplicar cria uma cópia sua") |
| RN-10 | **Compartilhar**: só o responsável concede, altera ou revoga acesso. A pessoa precisa já ter conta. Não se concede acesso ao próprio responsável | API | Figma (Compartilhar); MVP |
| RN-11 | **Permissões por experimento**: `leitura` vê o experimento, seus cultivos e leituras, e duplica; `edicao` faz tudo da leitura e também inicia, encerra e cancela cultivos e altera a faixa de pH dos cultivos; o responsável faz tudo e é o único que edita a ficha, encerra ou cancela o experimento e gerencia acessos | API | Figma (Compartilhar); reunião de 22/10 |
| RN-12 | **Visibilidade**: a lista de experimentos mostra só os do responsável e os compartilhados com a pessoa. Células, leituras e alertas continuam visíveis a todos, como hoje | API | Figma ("Cada pesquisador vê só os próprios experimentos"; Historiador "aberto a todos os usuários logados") |
| RN-13 | **Edição da ficha**: em `cadastrado`, o responsável altera todos os campos. Depois do início, ver P-3 | API | Figma ("Não podem ser alteradas depois que o experimento começar") |
| RN-14 | **Medição nunca é rejeitada por estar fora da faixa.** Sai o limite 0 a 14 do pH no contrato. Comandos continuam validados (setpoint fora de `TEMPERATURA_MIN_C`/`MAX_C` dá 422, como hoje) | Contrato | MVP (R6) |
| RN-15 | **Campos desconhecidos na leitura** vão para `leitura.extras` em vez de rejeitar a mensagem. As outras mensagens (`estado`, `setpoint`, `setpoint/resposta`) continuam rejeitando campos desconhecidos | Contrato + consumidor | MVP (R7) |
| RN-16 | **Colisão de `seq`**: leitura com `(id_celula, seq)` já gravado e `ts` **diferente** do gravado não substitui a original (RB-09 continua) e abre o alerta `colisao_seq`. Reenvio legítimo traz o mesmo `ts` e continua só sendo descartado, sem alerta. Fechamento do alerta: P-5 | Consumidor (via repositório) | MVP |
| RN-17 | **Temperatura alvo da célula** é o último `pedido_setpoint` da célula. O histórico de mudanças é a lista de pedidos, com `id_pessoa` quando houver login | Sem mudança de lógica | MVP |
| RN-18 | **Alerta `ph_fora_da_faixa`**: para cada célula com cultivo aberto e faixa de pH definida, se o pH da última leitura (dentro do período do cultivo) estiver fora da faixa, abre; se estiver dentro, fecha. Célula sem cultivo aberto ou sem faixa: fecha o alerta, se houver. Ver P-6 sobre tempo mínimo | Regras | MVP; Figma (Alertas) |
| RN-19 | **Firmware**: ao receber `estado` online com `versao`, gravar em `celula.firmware` | Consumidor (via repositório) | MVP |
| RN-20 | **Apelido**: definido por `PATCH /celulas/{id}`. Placa nova aparece sem apelido até alguém nomeá-la | API | MVP |
| RN-21 | **Perder a conexão nunca encerra cultivo nem experimento.** Nenhuma regra automática muda status de cultivo ou experimento | Todos | MVP (R1). O texto do Figma que diz o contrário ("retira do experimento sozinho após 24 h") não deve ser implementado |
| RN-22 | **Calibração**: o comportamento atual (versão nova, uma ativa, recálculo opcional a partir de `recalcular_desde`, `od_bruto` intocado) não muda. Os campos novos são opcionais na entrada | Sem mudança de lógica | MVP; código atual |

### C.3 Comportamentos existentes que precisam continuar iguais

- Idempotência das leituras (`ON CONFLICT (id_celula, seq) DO NOTHING`) e do setpoint (`avancar_pedido` nunca volta estado).
- `seq` contínuo por célula; a conferência de `/integridade` continua dando `completo: true` nas 3 células simuladas.
- `od_bruto` nunca é sobrescrito.
- Consumidor com `clean_session=False`, `client_id` fixo e o arquivo `/tmp/consumidor-inscrito`.
- A API não publica com o broker desconectado.
- Regras idempotentes.
- Cadastro automático de célula com calibração padrão (`registrar_celula`).

---

## D. Mapeamento para a arquitetura existente

### D.1 Componentes envolvidos

| Componente | Caminho [existe] | Papel hoje | O que muda |
|---|---|---|---|
| Schema | `infra/postgres/init/01_tabelas.sql` | Cria as 7 tabelas na primeira subida | Remove o bloco da tabela `experimento` antiga (linhas 16 a 24 no commit analisado) |
| Schema | `infra/postgres/init/03_modelo_mvp.sql` | — | [novo] Script idempotente do Apêndice A |
| Repositórios | `backend/app/banco/repositorios.py` | Todo o SQL do sistema, separado por assunto | Seções novas (pessoas, experimentos, acessos, cultivos); ajustes em `registrar_celula`, `listar_celulas`, `gravar_leitura`, `nova_calibracao`, `criar_pedido` |
| Conexão | `backend/app/banco/conexao.py` | `conectar()` e `criar_pool()` com autocommit e `dict_row` | Sem mudança |
| Configuração | `backend/app/config.py`, `.env.example`, `docker-compose.yml` | Variáveis de ambiente | + `SEGREDO_SESSAO`, `SESSAO_HORAS` (etapa 6) |
| Contrato | `contrato/mensagens.py`, `docs/contrato-mqtt.md` | Pydantic com `extra="forbid"` | `Leitura`: aceita extras e perde o limite do pH |
| Consumidor | `backend/app/consumidor/tratadores.py` | Valida, converte OD, grava | Passa `extras` e `versao` aos repositórios; registra colisões |
| Regras | `backend/app/regras/verificacoes.py` | 4 verificações em `TODAS` | + `ph_fora_da_faixa` |
| API | `backend/app/api/main.py`, `backend/app/api/esquemas.py` | Rotas de células, leituras, setpoint, calibração, alertas, integridade | Rotas novas; `GET /celulas` ganha campos; setpoint e calibração aceitam dados novos opcionais |
| Autenticação | `backend/app/api/autenticacao.py` | — | [novo] [sugerido] Resumo de senha e token (etapa 6) |
| Testes | `tests/unidade/test_contrato.py`, `tests/integracao/test_ponta_a_ponta.py`, `tests/integracao/ambiente.py` | 17 testes de unidade, 11 etapas ponta a ponta | Ajustes e etapas novas; `ambiente.py` sem mudança |
| Testes | `tests/integracao/test_modelo_dados.py` | — | [novo] [sugerido] Testes do schema, dos repositórios e da API nova |
| Simulador | `simulador/` | Faz o papel das placas, com IDs `c01` a `c03` | **Sem mudança** |
| Interface | `interface/` | Telas com dados de exemplo | **Sem mudança** neste trabalho |

### D.2 Pontos de integração

**Fluxo de uma leitura (consumidor):** `tratadores.Tratador._leitura` recebe `Leitura` validada → `repositorios.gravar_leitura` tenta inserir. Hoje devolve `bool`. Passa a devolver o resultado `"gravada"`, `"duplicada"` ou `"colisao"` (ou equivalente tipado), e a contagem do tratador ganha a chave `colisoes`. O alerta de colisão é aberto pelo repositório, na mesma transação, com `abrir_alerta` (idempotente).

> Mudança de responsabilidade a registrar no `CLAUDE.md`: hoje só o processo de regras abre alertas. O `colisao_seq` passa a ser aberto pelo consumidor, porque só ele vê a mensagem que colidiu.

**Fluxo do estado (consumidor):** `Tratador._estado` → `registrar_celula(conn, id, estado, sensores, firmware=msg.versao)` grava `firmware` quando vier.

**Regras:** nova função `ph_fora_da_faixa(conn, cfg)` em `verificacoes.py`, adicionada a `TODAS`. Usa só o banco.

**API:** usa o pool de `criar_pool()` e as funções de `repositorios.py`. Nenhuma rota faz SQL direto. Rotas novas seguem o estilo atual: `Conexao` como dependência, `HTTPException` com mensagem em português que diz o que aconteceu e como resolver.

**Interface:** consome a API pelo prefixo `/api`. As mudanças em `GET /celulas` são só acréscimos de campos, então `interface/src/api/tipos.ts` continua compatível.

**Simulador e testes:** continuam usando IDs `c01`, `c02`, `c03`. Este trabalho **não** adiciona o CHECK de formato MAC (P-1).

---

## E. Orientações de implementação

### E.1 Esquema SQL

**Onde:** um arquivo novo, `infra/postgres/init/03_modelo_mvp.sql` [novo], com o conteúdo do Apêndice A, e a remoção do bloco da tabela `experimento` antiga de `infra/postgres/init/01_tabelas.sql` [muda].

**Por que um arquivo novo em vez de editar o 01:** o PostgreSQL do Compose executa `infra/postgres/init/*.sql` em ordem alfabética só na primeira subida (volume vazio), e `tests/integracao/ambiente.py` (modo local) aplica os mesmos arquivos na mesma ordem. Um 03 idempotente serve aos dois casos e também pode ser aplicado à mão num banco que já tem dados (E.10). Editar só o 01 obrigaria a apagar o volume para ver as mudanças.

**Por que tirar o experimento antigo do 01:** com o bloco antigo no 01, todo banco novo criaria a tabela errada e o 03 teria de removê-la. O 03 continua sabendo remover a tabela antiga (protegido, ver abaixo) para bancos que já existem.

**Comportamentos do 03 que precisam ser mantidos:**
- Rodar duas vezes seguidas não dá erro nem muda nada (só avisos `NOTICE`).
- Se a tabela `experimento` antiga (reconhecida pela coluna `id_celula`) existir **vazia**, é removida. Se tiver **qualquer linha**, o script para com erro e nada é apagado.
- Colunas novas em tabelas existentes são todas anuláveis ou têm padrão (`calibracao.sensor DEFAULT 'od'`), então não falham em tabelas com dados.
- O CHECK de `alerta.tipo` é trocado pelo nome `alerta_tipo_check`, que é o nome que o PostgreSQL deu ao CHECK em linha do 01. **Confirmar** com `\d alerta` antes de confiar nesse nome.

**Validação já feita (PostgreSQL 16.x local, fora do Compose):**

| Cenário | Resultado |
|---|---|
| Banco novo: 01 sem o experimento antigo, 02, 03, 03 de novo | Sem erros. Todas as restrições do Apêndice A recusaram os casos inválidos e aceitaram os válidos (lista em G.2) |
| Banco antigo com 100 leituras, 1 pedido, 1 alerta e tabela antiga vazia: 03 duas vezes | Dados preservados; `calibracao.sensor` preenchido com `od`; tabela antiga removida |
| Banco antigo com 1 linha na tabela antiga | Script parou com a mensagem esperada; nenhuma tabela alterada |

Essa validação **não** substitui rodar no Compose (etapa 1).

### E.2 Tipos e restrições

| Escolha | Motivo |
|---|---|
| `DOUBLE PRECISION` para medidas e limites (`temperatura_alvo_c`, `ph_ref_*`, `r2`) | Igual às colunas existentes (`leitura`, `calibracao`, `pedido_setpoint`) e ao `float` do Pydantic. O documento do MVP dizia `NUMERIC`; a troca evita conversões `Decimal`↔`float` no Python e comparações entre tipos diferentes no SQL. Divergência registrada em "Divergências" (item 4) |
| `TIMESTAMPTZ` em tudo, em UTC | Igual ao existente. A interface converte para o fuso local |
| `TEXT` + `CHECK (... IN (...))` para status, modo, permissão, sensor | Igual ao existente (`celula.estado`, `pedido_setpoint.estado`, `alerta.tipo`). Acrescentar um valor depois é trocar um CHECK; com `ENUM`, exigiria `ALTER TYPE` |
| `JSONB` para `metadados`, `pontos`, `extras` | Campos ainda indefinidos (princípio 5). Igual a `celula.sensores` |
| `SERIAL` nas chaves novas | Igual a `experimento`, `calibracao`, `alerta` existentes |
| Restrição de exclusão com `btree_gist` | É a única forma de o próprio banco garantir "períodos não sobrepostos". Um índice único parcial (`WHERE encerrado_em IS NULL`) garantiria só "um aberto por vez", e não impediria dois períodos encerrados sobrepostos, o que faria a mesma leitura cair em dois cultivos. `btree_gist` faz parte do PostgreSQL (contrib) e já está na imagem `postgres:16-alpine` |

### E.3 Índices

| Índice | Justificativa |
|---|---|
| `cultivo_por_experimento (id_experimento)` | Toda tela de experimento lista seus cultivos |
| índice GiST da restrição `cultivo_sem_sobreposicao` | Criado pela restrição. Também atende "cultivo aberto desta célula" |
| `celula_apelido_unico (apelido)` | Garante RB-08 |
| PK `experimento_acesso (id_experimento, id_pessoa)` | Atende "acesso de X ao experimento Y" |
| `leitura_por_tempo (id_celula, ts_origem)` [existe] | Atende a visão `leitura_cultivo`. Não criar outro |

**Não criar** índices em `experimento.id_responsavel` ou `experimento_acesso.id_pessoa` no MVP: o volume previsto é de dezenas de experimentos e poucas pessoas. Se a lista de experimentos ficar lenta, o índice entra depois, com medição.

### E.4 Repositórios e transações

**Regra:** todo SQL novo vai em `backend/app/banco/repositorios.py`, em seções novas com o mesmo estilo de comentário (`# ---- pessoas`, `# ---- experimentos`, `# ---- cultivos`). Se o arquivo ficar grande demais, **não** dividir em vários módulos sem perguntar: a regra do `CLAUDE.md` cita esse arquivo.

**Conexões:** as conexões de `conexao.py` estão em autocommit. Operações com mais de um comando que precisam ser atômicas usam `with conn.transaction():` (psycopg 3). Isso vale para:
- `iniciar_cultivo` (trava o experimento, insere o cultivo, muda o status do experimento);
- `cancelar_experimento` (cancela o experimento e os cultivos abertos);
- `encerrar_experimento`, se P-9 decidir encerrar os cultivos junto;
- `gravar_leitura` quando houver colisão (insere, confere, abre alerta).

**Funções novas [sugerido]** (assinaturas indicativas; nomes podem mudar, comportamento não):

| Função | Faz |
|---|---|
| `criar_pessoa(conn, nome, email, senha_hash) -> dict` | INSERT; deixa a `UniqueViolation` subir |
| `buscar_pessoa_por_email(conn, email) -> dict \| None` | |
| `buscar_pessoa(conn, id_pessoa) -> dict \| None` | |
| `criar_experimento(conn, id_responsavel, **campos) -> dict` | RN-01 |
| `buscar_experimento(conn, id_experimento) -> dict \| None` | Com lista de cultivos e de acessos (nome e e-mail da pessoa) |
| `listar_experimentos_visiveis(conn, id_pessoa, filtro) -> list[dict]` | RN-12. `filtro` em `todos`, `meus`, `compartilhados`. Cada item diz o acesso da pessoa (`responsavel`, `edicao`, `leitura`) e a contagem de cultivos abertos |
| `acesso_de(conn, id_experimento, id_pessoa) -> str \| None` | `responsavel`, `edicao`, `leitura` ou `None` |
| `atualizar_experimento(conn, id_experimento, **campos) -> dict` | Só campos recebidos. Regras de P-3 ficam na API |
| `encerrar_experimento(...)` | Depende de P-9 |
| `cancelar_experimento(conn, id_experimento, id_pessoa, motivo)` | RN-08, transação |
| `duplicar_experimento(conn, id_experimento, id_pessoa) -> dict` | RN-09 |
| `conceder_acesso(conn, id_experimento, id_pessoa, permissao)` | Upsert (`ON CONFLICT ... DO UPDATE SET permissao`) |
| `revogar_acesso(conn, id_experimento, id_pessoa) -> bool` | |
| `iniciar_cultivo(conn, id_experimento, id_celula, id_pessoa, condicao, replica, continua_de) -> dict` | RN-02, transação |
| `encerrar_cultivo(conn, id_cultivo, id_pessoa, motivo=None) -> dict \| None` | RN-05. `None` se não estava em andamento |
| `cancelar_cultivo(conn, id_cultivo, id_pessoa, motivo) -> dict \| None` | RN-06 |
| `atualizar_cultivo(conn, id_cultivo, **campos) -> dict \| None` | `condicao`, `replica`, `ph_ref_*`, só se em andamento |
| `buscar_cultivo(conn, id_cultivo) -> dict \| None` | |
| `cultivo_aberto_da_celula(conn, id_celula) -> dict \| None` | |
| `listar_leituras_do_cultivo(conn, id_cultivo, desde=None, limite=1000)` | Pela visão, mesma forma de `listar_leituras` |
| `atualizar_celula(conn, id_celula, apelido=..., descricao=..., modelo=...)` | Só campos recebidos |

**Funções existentes que mudam:**

| Função | Mudança | Compatibilidade |
|---|---|---|
| `registrar_celula` | + parâmetro `firmware: str \| None = None`; grava em `celula.firmware` quando não for `None` | Chamadas atuais continuam valendo |
| `listar_celulas` | + `apelido`, `modelo`, `firmware`, `cultivo_atual` (objeto com `id_cultivo`, `id_experimento`, `condicao`, `iniciado_em`, ou `null`) | Só acréscimo de chaves |
| `gravar_leitura` | + parâmetro `extras: dict \| None = None`; retorno passa de `bool` para `"gravada" \| "duplicada" \| "colisao"`. Quem chama precisa ser ajustado (só `tratadores.py`, conferir com grep) | Mudança de retorno: ajustar todos os usos |
| `nova_calibracao` | + `pontos`, `r2`, `organismo`, `id_pessoa`, todos opcionais | Chamadas atuais continuam valendo |
| `criar_pedido` | + `id_pessoa: int \| None = None` | Chamadas atuais continuam valendo |

**Erros do banco:** os repositórios **não** capturam erros de restrição; a API traduz (E.8). Assim o teste do repositório consegue verificar a restrição diretamente.

### E.5 Contrato e consumidor

**`contrato/mensagens.py` [muda]:**
- `Leitura` passa a usar `model_config = ConfigDict(extra="allow")` (sobrescrevendo o `forbid` herdado só nela). Os campos desconhecidos ficam em `msg.model_extra`.
- `Leitura.ph` perde `ge=0, le=14` e continua `float | None`. `seq` continua `ge=0` (é estrutura, não medição).
- `Estado`, `PedidoSetpoint`, `RespostaSetpoint` **não** mudam.

Essa mudança aceita mais do que antes e não exige nada novo das placas, então continua sendo `v1`. O `CLAUDE.md` exige `v2` só para mudança incompatível.

**`docs/contrato-mqtt.md` [muda]:** atualizar na mesma etapa (regra do `CLAUDE.md`): pH sem faixa; campos desconhecidos da leitura vão para `extras` e geram aviso no log; demais mensagens continuam rejeitando campos desconhecidos; colisão de `seq` gera o alerta `colisao_seq`; `versao` do estado é gravada como firmware.

**`backend/app/consumidor/tratadores.py` [muda]:**
- `_leitura`: passa `extras=msg.model_extra or None` para `gravar_leitura`. Se houver extras, registra aviso no log com os nomes dos campos (frequência: P-12). Trata o novo retorno; contagem ganha `colisoes`.
- `_estado`: passa `firmware=msg.versao` para `registrar_celula`.
- Nada mais muda no consumidor. A sequência de inscrição, o `clean_session`, o arquivo `/tmp/consumidor-inscrito` e o tratamento de mensagem inválida continuam iguais.

**Detecção de colisão em `gravar_leitura`:** dentro de `conn.transaction()`:
1. `INSERT ... ON CONFLICT (id_celula, seq) DO NOTHING RETURNING seq`.
2. Se inseriu: atualizar `ultimo_contato` (como hoje) e devolver `"gravada"`.
3. Se não inseriu: `SELECT ts_origem = %(ts)s FROM leitura WHERE id_celula = ... AND seq = ...`. Igual: `"duplicada"`. Diferente: `abrir_alerta(conn, id_celula, "colisao_seq", mensagem)` com o `seq` e os dois horários na mensagem, e devolver `"colisao"`.

A leitura original nunca é alterada. A mensagem colidida é descartada (é confirmada ao broker, como hoje).

### E.6 Regras

`backend/app/regras/verificacoes.py` [muda]: nova função `ph_fora_da_faixa(conn, cfg)`, adicionada a `TODAS`, no estilo das outras.

> Fato do código: as verificações existentes fazem as consultas de seleção dentro de `verificacoes.py` (`conn.execute(...)`) e usam `repositorios.py` só para abrir e fechar alertas. Isso já diverge da regra "SQL só em `repositorios.py`" do `CLAUDE.md` (divergência 15). A função nova **segue o padrão do arquivo** e não move as consultas existentes. Se a equipe preferir mover tudo para os repositórios, isso é outra tarefa.

Lógica (RN-18):
1. Para cada cultivo `em_andamento` com `ph_ref_min` ou `ph_ref_max` definido, pegar a última leitura da célula com `ph` não nulo e `ts_origem >= iniciado_em`.
2. Fora da faixa (abaixo do mínimo, se existir; acima do máximo, se existir): `abrir_alerta` (idempotente). Dentro: `fechar_alerta`.
3. Sem leitura com pH no período: não faz nada.
4. Fechar `ph_fora_da_faixa` aberto de células que não têm mais cultivo aberto com faixa.

Sem tempo mínimo fora da faixa (P-6). Nenhuma configuração nova.

### E.7 Autenticação

**Bloqueada por P-2.** O desenho abaixo é a proposta padrão. Não implementar antes da confirmação.

**Sem bibliotecas novas.** A biblioteca padrão do Python 3.12 tem o necessário (`hashlib.scrypt`, `hmac`, `secrets`, `base64`, `json`), e o `requirements.txt` fica como está. Alternativas avaliadas e não escolhidas: `passlib`/`bcrypt` (dependência nova; `passlib` sem manutenção ativa) e `PyJWT` (dependência nova para algo que um HMAC resolve).

**Resumo de senha:** `hashlib.scrypt(senha, salt=16 bytes de secrets.token_bytes, n=2**14, r=8, p=1, dklen=32)`, gravado como `scrypt$16384$8$1$<sal_b64>$<resumo_b64>`. Verificação recalcula com os parâmetros gravados e compara com `hmac.compare_digest`.

**Token de sessão:** `base64url(json {"p": id_pessoa, "exp": epoch}) + "." + base64url(hmac_sha256(segredo, parte1))`. Enviado no cabeçalho `Authorization: Bearer <token>`. Sem tabela de sessões e sem "sair" no servidor (a interface descarta o token).

**Configuração (regra do `CLAUDE.md`: `config.py` + `.env.example` + `docker-compose.yml`):**
- `SEGREDO_SESSAO`: obrigatório. Sem ele, a API não sobe (erro claro no início). No Compose, um valor de desenvolvimento explícito.
- `SESSAO_HORAS`: padrão 12.

**Regras de senha:** 8 caracteres ou mais, com pelo menos uma letra e um número (texto do Figma). Validadas no esquema Pydantic da API.

**Dependências do FastAPI [sugerido]:** `pessoa_logada` (exige token válido, senão 401) e `pessoa_opcional` (sem token devolve `None`; token presente e inválido dá 401).

**Rotas existentes continuam sem login** (P-2): exigir login nelas quebraria o teste de ponta a ponta e o uso atual sem interface. Elas só passam a gravar `id_pessoa` quando o token vier.

### E.8 API

Arquivos: `backend/app/api/main.py` e `backend/app/api/esquemas.py` [muda]. Se `main.py` crescer demais, usar `APIRouter` em módulos novos dentro de `backend/app/api/` é aceitável, **desde que** a montagem (`/api`, pool, cliente MQTT) continue num lugar só. Propor no plano antes de fazer.

**Rotas novas** (todas com `pessoa_logada`, exceto cadastro e entrada):

| Rota | Quem pode | Sucesso | Bloqueio |
|---|---|---|---|
| `POST /auth/cadastro {nome, email, senha}` | qualquer um | 201 + token + pessoa | P-2 |
| `POST /auth/entrar {email, senha}` | qualquer um | 200 + token + pessoa | P-2 |
| `GET /auth/eu` | logado | 200 pessoa | P-2 |
| `POST /experimentos` | logado | 201 | P-2 |
| `GET /experimentos?filtro=` | logado | 200 lista (RN-12) | P-2 |
| `GET /experimentos/{id}` | qualquer acesso | 200 com cultivos e acessos | P-2 |
| `PATCH /experimentos/{id}` | responsável | 200 | P-2, **P-3** |
| `POST /experimentos/{id}/encerrar` | responsável | 200 | P-2, **P-9** |
| `POST /experimentos/{id}/cancelar {motivo}` | responsável | 200 | P-2 |
| `POST /experimentos/{id}/duplicar` | qualquer acesso | 201 | P-2 |
| `POST /experimentos/{id}/acessos {email, permissao}` | responsável | 200 | P-2 |
| `DELETE /experimentos/{id}/acessos/{id_pessoa}` | responsável | 204 | P-2 |
| `POST /experimentos/{id}/cultivos {id_celula, condicao?, replica?, continua_de?}` | responsável ou edição | 201 | P-2 |
| `PATCH /cultivos/{id} {condicao?, replica?, ph_ref_min?, ph_ref_max?}` | responsável ou edição | 200 | P-2 |
| `POST /cultivos/{id}/encerrar {motivo?}` | responsável ou edição | 200 | P-2 |
| `POST /cultivos/{id}/cancelar {motivo}` | responsável ou edição | 200 | P-2 |
| `GET /cultivos/{id}/leituras` | qualquer acesso ao experimento | 200 | P-2 |
| `PATCH /celulas/{id} {apelido?, descricao?, modelo?}` | logado | 200 | P-2 |

**Rotas existentes que mudam (só acréscimos):**
- `GET /celulas`: campos de E.4.
- `POST /celulas/{id}/calibracoes`: aceita `pontos`, `r2`, `organismo` opcionais; grava `id_pessoa` com `pessoa_opcional`.
- `POST /celulas/{id}/setpoint`: grava `id_pessoa` com `pessoa_opcional`. A lógica de validação, publicação e espera (`wait_for_publish`) é extraída para uma função interna reaproveitada por `iniciar cultivo`, **sem mudar** o comportamento da rota.

**Tradução de erros do banco** (psycopg 3, `psycopg.errors`):

| Erro | HTTP | Exemplo de mensagem |
|---|---|---|
| `ExclusionViolation` | 409 | "A célula c01 já está em outro cultivo. Encerre o cultivo atual antes de iniciar outro." |
| `UniqueViolation` | 409 | "Já existe uma conta com este e-mail." / "Já existe uma célula com este apelido." |
| `CheckViolation` | 422 | "A faixa de pH precisa ter o mínimo menor que o máximo." |
| `ForeignKeyViolation` | 404 ou 422 | "Célula c99 não encontrada." |

As mensagens seguem o padrão do `CLAUDE.md`: o que aconteceu e como resolver. Mensagens genéricas como "Erro de integridade" não são aceitas.

Experimento ou cultivo fora do alcance da pessoa responde **404** (não revela que existe). Pessoa com acesso de leitura tentando editar responde **403**.

### E.9 Compatibilidade com testes e Compose

- **Compose:** nenhum serviço novo. O `banco` já monta `./infra/postgres/init`, então o 03 roda sozinho num volume novo. A `api` ganha `SEGREDO_SESSAO` e `SESSAO_HORAS` (etapa 6).
- **`tests/integracao/ambiente.py`:** não muda. O modo Compose faz `down -v` e sobe do zero; o modo local aplica `infra/postgres/init/*.sql` em ordem, então pega o 03. No modo local, o PostgreSQL instalado precisa do contrib (`btree_gist`) (P-13).
- **11 etapas atuais:** precisam continuar passando sem mudar o que verificam. Exceção esperada: na etapa 9 (leitura repetida), a c01 republica o `seq` 0 com `ts` atual, o que agora abre `colisao_seq`. É o comportamento correto. A etapa deve **ganhar** a verificação de que o alerta abriu e de que a leitura original continua intacta. Conferir se alguma etapa seguinte conta alertas da c01 e ajustar só a contagem, se for o caso.
- **Ordem:** a etapa de integridade continua sendo a última.
- **Testes de unidade:** `test_leitura_rejeita_campo_desconhecido` e `test_leitura_rejeita_seq_negativo_e_ph_impossivel` mudam de sentido (ver G.1). Os nomes mudam junto.
- **Interface e simulador:** não mudam. `npm run build` em `interface/` continua passando (os campos da API só crescem).

### E.10 Atualização do esquema sem perda de dados

O projeto **não tem** sistema de migração e o `CLAUDE.md` diz "sem migração (`down -v`)". Para o MVP:

- **Não** introduzir Alembic, yoyo, Flyway ou similar. O 03 idempotente resolve o MVP, e a escolha de ferramenta fica para depois (P-14).
- Em ambiente de desenvolvimento e teste: `docker compose down -v` continua sendo o caminho.
- Num banco com dados que importam (por exemplo, se o CNPEM já estiver gravando leituras reais):
  1. `pg_dump` antes de qualquer coisa;
  2. aplicar o 03 à mão com `psql ... -v ON_ERROR_STOP=1 -f infra/postgres/init/03_modelo_mvp.sql`;
  3. **nunca** `down -v`.
- O 03 só apaga uma coisa: a tabela `experimento` antiga, e só se estiver vazia.
- O `CLAUDE.md` deve passar a explicar esses dois caminhos (etapa 8).

---

## F. Etapas de implementação

Cada etapa termina com um **ponto de parada**: relatório curto (o que mudou, arquivos, resultado dos testes, divergências) e espera de aprovação antes da próxima. Commits pequenos, um por etapa ou menos, em português, como no histórico. **Não** fazer push, abrir PR ou mexer em `main`/`develop` remotos sem pedido explícito.

### Etapa 0 — Análise e plano (sem alterar arquivos)

- **Objetivo:** conferir esta especificação contra o código atual.
- **Arquivos:** leitura de `CLAUDE.md`, `README.md`, `docs/`, `infra/postgres/init/`, `backend/app/`, `contrato/`, `tests/`, `docker-compose.yml`, `.env.example`.
- **Saída:**
  1. confirmação ou correção de cada item [existe] das seções B.2, D.1 e E.4;
  2. divergências novas (além da lista "Divergências");
  3. respostas que faltam para as pendências que bloqueiam etapas;
  4. plano de execução, com o que será feito em cada etapa.
- **Validação:** testes atuais rodando **antes** de qualquer mudança (linha de base): `pytest tests/unidade` e, se o ambiente permitir, `pytest -m integracao`.
- **Parada obrigatória.**

### Etapa 1 — Esquema

- **Objetivo:** banco novo com o modelo do MVP, sem quebrar nada.
- **Arquivos:** `infra/postgres/init/03_modelo_mvp.sql` [novo]; `infra/postgres/init/01_tabelas.sql` [muda: remove o bloco da tabela `experimento`]; `tests/integracao/test_modelo_dados.py` [novo, sugerido].
- **Alterações:** SQL do Apêndice A, sem mudar restrições. Ajustes só para corrigir erro real, explicados no relatório.
- **Dependências:** etapa 0 aprovada.
- **Validação:** testes de restrição de G.2 (direto por SQL, usando `criar_ambiente()` de `ambiente.py`); 11 etapas atuais passando; aplicar o 03 duas vezes no banco do teste sem erro.
- **Parada.**

### Etapa 2 — Repositórios de pessoas, experimentos, acessos e cultivos

- **Objetivo:** operações de banco do E.4 que não dependem de autenticação nem de P-3/P-9.
- **Arquivos:** `backend/app/banco/repositorios.py` [muda]; `tests/integracao/test_modelo_dados.py`.
- **Fora desta etapa:** `encerrar_experimento` (P-9) e as regras de edição da ficha (P-3).
- **Dependências:** etapa 1.
- **Validação:** testes de G.3 chamando os repositórios direto (sem API).
- **Parada.**

### Etapa 3 — Contrato e consumidor

- **Objetivo:** RN-14, RN-15, RN-16, RN-19.
- **Arquivos:** `contrato/mensagens.py`, `docs/contrato-mqtt.md`, `backend/app/banco/repositorios.py` (`gravar_leitura`, `registrar_celula`), `backend/app/consumidor/tratadores.py`, `tests/unidade/test_contrato.py`, `tests/integracao/test_ponta_a_ponta.py` [todos muda].
- **Dependências:** etapa 1. P-5 e P-12 têm proposta padrão e não bloqueiam.
- **Validação:** G.1 e G.4; etapa 9 do ponta a ponta verificando `colisao_seq`; etapa nova de ponta a ponta com campo extra (ver G.4); integridade por último.
- **Parada.**

### Etapa 4 — Regra `ph_fora_da_faixa`

- **Objetivo:** RN-18.
- **Arquivos:** `backend/app/regras/verificacoes.py`; teste.
- **Dependências:** etapas 1 e 2 (precisa de cultivo).
- **Validação:** G.5. Etapa nova no ponta a ponta só se der para provocar pH fora da faixa com o simulador sem mudá-lo; se não der, teste de integração chamando a função direto, e registrar no relatório.
- **Parada.**

### Etapa 5 — Células e calibração na API (sem login)

- **Objetivo:** acréscimos em rotas existentes que não precisam de login.
- **Arquivos:** `backend/app/banco/repositorios.py` (`listar_celulas`, `nova_calibracao`), `backend/app/api/main.py`, `backend/app/api/esquemas.py`.
- **Alterações:** `GET /celulas` com `apelido`, `modelo`, `firmware`, `cultivo_atual`; calibração aceita `pontos`, `r2`, `organismo`.
- **Dependências:** etapa 2.
- **Validação:** G.6 (parte sem login); `npm run build` em `interface/`.
- **Parada.**

### Etapa 6 — Autenticação

- **Bloqueada por P-2.**
- **Objetivo:** E.7.
- **Arquivos:** `backend/app/config.py`, `.env.example`, `docker-compose.yml`, `backend/app/api/autenticacao.py` [novo, sugerido], `backend/app/api/main.py`, `backend/app/api/esquemas.py`; testes.
- **Validação:** G.7.
- **Parada.**

### Etapa 7 — API de experimentos, acessos e cultivos

- **Objetivo:** rotas de E.8.
- **Dependências:** etapas 2 e 6. `PATCH /experimentos/{id}` espera P-3; `POST /experimentos/{id}/encerrar` espera P-9 (e o repositório correspondente). As outras rotas não esperam.
- **Arquivos:** `backend/app/api/main.py` (ou routers, se aprovado), `backend/app/api/esquemas.py`, `backend/app/banco/repositorios.py`; testes.
- **Validação:** G.6 e G.8; etapa nova no ponta a ponta: iniciar cultivo numa célula simulada com `temperatura_alvo_c` e ver o pedido chegar a `aplicado`.
- **Parada.**

### Etapa 8 — Documentação

- **Objetivo:** deixar o repositório dizendo a verdade.
- **Arquivos:** `CLAUDE.md` (tabelas, regras novas, responsabilidade do consumidor sobre `colisao_seq`, como aplicar o 03, problemas conhecidos, contagem de testes), `README.md` (se citar tabelas ou rotas), este documento (marcar o que foi feito e o que divergiu). Corrigir o comentário de `interface/src/api/tipos.ts` que cita `banco/init/01_tabelas.sql` **só se** a equipe da interface concordar (é arquivo da outra frente).
- **Validação:** releitura; nenhuma afirmação do `CLAUDE.md` contradiz o código.

---

## G. Testes e critérios de aceitação

Testes novos de banco e API vão em `tests/integracao/` com o marcador `integracao` (já configurado no `pyproject.toml`) e usam `criar_ambiente()`. Testes que precisam de MQTT entram como etapas em `test_ponta_a_ponta.py` (regra do `CLAUDE.md`).

### G.1 Contrato (unidade)

- `Leitura` com campo desconhecido é aceita e `model_extra` traz o campo.
- `Leitura` com `ph = 15` e com `ph = -1` é aceita.
- `Leitura` com `seq = -1` continua recusada.
- `Estado`, `PedidoSetpoint`, `RespostaSetpoint` com campo desconhecido continuam recusados.

### G.2 Esquema (integração, SQL direto)

Recusas esperadas:
- e-mail com maiúscula ou sem `@`; e-mail repetido;
- experimento `cadastrado` com `iniciado_em`; `em_andamento` sem `iniciado_em`; `encerrado_em < iniciado_em`; `modo` inválido; `status` inválido; `ph_ref_min >= ph_ref_max`; `duracao_prevista_dias = 0`;
- segundo cultivo aberto na mesma célula; cultivo encerrado cujo período sobrepõe outro; cultivo `em_andamento` com `encerrado_em`; `encerrado` sem `encerrado_em`; `cancelado` sem motivo ou com motivo em branco; `continua_de` igual ao próprio id; `replica = 0`;
- permissão fora de `leitura`/`edicao`; segunda linha para a mesma pessoa e experimento;
- apelido repetido;
- alerta com tipo inventado;
- FK: cultivo com célula inexistente; experimento com responsável inexistente.

Aceites esperados:
- cultivo novo começando exatamente no `encerrado_em` do anterior, com `continua_de`;
- duas células sem apelido (vários nulos);
- alertas `ph_fora_da_faixa` e `colisao_seq`;
- leitura com `extras`.

Visão: com cultivos 1 (fechado) e 2 (aberto) na mesma célula, leituras antes do 1, dentro do 1, na fronteira e dentro do 2 aparecem no cultivo certo e só nele; leitura antes de tudo não aparece.

Idempotência: aplicar o 03 de novo no banco do teste não dá erro e não muda contagens.

### G.3 Repositórios (integração)

- `iniciar_cultivo` no experimento `cadastrado` muda para `em_andamento` com `iniciado_em` = início do cultivo; copia a faixa de pH; segundo cultivo não muda `iniciado_em`.
- `iniciar_cultivo` em experimento `encerrado` ou `cancelado` é recusado e nada é gravado.
- `iniciar_cultivo` em célula ocupada levanta `ExclusionViolation` e o experimento não muda de status (rollback).
- `encerrar_cultivo` e `cancelar_cultivo` só agem em cultivo `em_andamento`; cancelar sem motivo é recusado.
- `cancelar_experimento` cancela os cultivos abertos com o mesmo motivo, numa transação.
- `duplicar_experimento` copia os campos de RN-09, com `id_origem`, status `cadastrado`, sem cultivos e sem acessos.
- `listar_experimentos_visiveis` mostra só os do responsável e os compartilhados; o filtro funciona.
- `conceder_acesso` repetido atualiza a permissão.
- Nenhuma operação apaga leituras.

### G.4 Consumidor (ponta a ponta)

- Etapa 9 atual: leitura original intacta **e** alerta `colisao_seq` aberto na c01.
- Reenvio com o mesmo `seq` e o mesmo `ts`: não abre alerta (pode ser coberto por teste de integração do repositório se publicar a mensagem idêntica for difícil).
- Leitura publicada com um campo a mais: gravada, com o campo em `extras`; contagem de inválidas não sobe.
- `firmware` da c01 igual ao `versao` que o simulador envia (`sim-0.1`).
- Integridade final continua `completo: true`.

### G.5 Regras

- Cultivo aberto com faixa 6,5–7,5 e última leitura com pH 8: abre `ph_fora_da_faixa`. Rodar de novo: continua um só.
- Última leitura volta para 7: fecha.
- Encerrar o cultivo com o alerta aberto: o alerta fecha na próxima rodada.
- Cultivo sem faixa: nunca abre.

### G.6 API

- `GET /celulas` mantém todos os campos atuais e acrescenta os novos.
- Calibração sem os campos novos se comporta exatamente como hoje.
- Fluxo do Apêndice B completo, pela API.
- Erros: célula ocupada 409; faixa invertida 422; e-mail repetido 409; experimento de outra pessoa 404; leitura tentando editar 403; iniciar cultivo com broker parado e `temperatura_alvo_c` definida 503 sem nada gravado.

### G.7 Autenticação

- Cadastro com senha curta ou sem número: 422.
- Entrada com senha errada e com e-mail inexistente: mesma resposta 401 "E-mail ou senha incorretos.".
- Token expirado, adulterado (um caractere trocado) ou assinado com outro segredo: 401.
- `senha_hash` nunca aparece em resposta da API nem no log.
- Rotas existentes sem token continuam funcionando.

### G.8 Integração com setpoint

- Iniciar cultivo com `temperatura_alvo_c` cria um `pedido_setpoint` com `id_pessoa`, que avança até `aplicado` numa célula `normal` do simulador.

### Critérios de aceitação do MVP

O MVP do modelo de dados está implementado quando:
1. as 11 etapas de ponta a ponta originais passam (a 9 com a verificação nova) e as etapas novas também, no Compose, a partir de `down -v`;
2. todos os testes de unidade passam, incluindo os alterados;
3. os testes de G.2 a G.8 das etapas liberadas passam;
4. aplicar o 03 duas vezes num banco com dados não perde nenhuma linha;
5. `npm run build` em `interface/` passa sem mudança na interface;
6. `CLAUDE.md` e `docs/contrato-mqtt.md` descrevem o que o código faz;
7. as pendências que ficaram sem resposta estão listadas no relatório final, com o que ficou de fora por causa delas.

---

## H. Restrições e cuidados

**Não alterar:**
- O simulador (`simulador/`) e a interface (`interface/`), salvo o comentário da etapa 8 com acordo.
- A chave da leitura `(id_celula, seq)`, a idempotência das leituras e do setpoint, o `seq` contínuo e a regra de nunca sobrescrever `od_bruto`.
- `clean_session=False`, o `client_id` fixo do consumidor e o arquivo de inscrição.
- O comportamento das rotas existentes (só acrescentar campos e parâmetros opcionais).
- As variáveis de ambiente existentes e seus padrões.
- Os IDs `c01`, `c02`, `c03` do Compose e dos testes.

**Não introduzir:**
- Biblioteca, framework ou ferramenta de migração novos (E.7 e E.10 explicam por quê).
- CHECK de formato MAC em `celula.id_celula` (P-1).
- Tabela, coluna ou rota fora deste documento, mesmo que pareça útil (a lista "Fora" da seção A.4 vale como proibição).
- Encerramento automático de cultivo ou experimento por tempo ou por falta de conexão (RN-21).
- Validação de faixa em medições (RN-14).

**Não presumir:**
- Que as respostas às pendências são as propostas padrão.
- Que este documento está certo onde ele contradiz o código: reportar.
- Que os nomes de restrição gerados pelo PostgreSQL são os esperados: conferir.

**Cuidados:**
- SQL novo só em `repositorios.py`; a API não faz SQL. Única exceção: a regra nova de E.6, que segue o padrão já existente em `verificacoes.py`.
- Tudo em português (nomes, mensagens, comentários, commits), como o resto do projeto.
- Senha e token nunca no log.
- Rodar a linha de base dos testes antes de mudar e rodar tudo de novo no fim de cada etapa.

---

## Divergências encontradas entre modelo, documentação e código

| # | Onde | O que diverge | Tratamento nesta especificação |
|---|---|---|---|
| 1 | `CLAUDE.md` | Descreve a tabela `experimento` antiga e diz "Sem endpoints de experimento" | Atualizar na etapa 8 |
| 2 | `docs/contrato-mqtt.md` | Campos desconhecidos rejeitados; pH de 0 a 14; exemplo de ID `c01` | Os dois primeiros mudam na etapa 3 (R6, R7). O ID de exemplo fica (P-1) |
| 3 | Simulador, testes, Compose | IDs `c01`–`c03`; o MVP decidiu MAC como ID | Mantidos. A regex do contrato já aceita MAC. P-1 |
| 4 | Documento do MVP × código | MVP diz `NUMERIC`; código usa `DOUBLE PRECISION` | Adotado `DOUBLE PRECISION` (E.2). Atualizar o documento do MVP |
| 5 | `interface/src/funcionalidades/experimentos/modelo.ts` | Sem status "cancelado"; tem convites pendentes e fases; pH no experimento | Banco segue o MVP. Avisar a frente da interface (P-4) |
| 6 | Figma × MVP v1 | Figma: ficha não muda depois do início; v1: campos descritivos sempre editáveis | P-3 |
| 7 | Figma × MVP v1 | Figma: encerrar experimento libera as células; v1: só encerra sem cultivo aberto | P-9 |
| 8 | Contrato × MVP | `modelo` da placa não vem no contrato | Informado por `PATCH /celulas` (P-11) |
| 9 | `interface/src/api/tipos.ts` | Comentário cita `banco/init/01_tabelas.sql`, que não existe | Etapa 8, com acordo |
| 10 | `tratadores.py` | `Estado.versao` chega e é ignorado | Gravado em `firmware` (etapa 3) |
| 11 | `tests/unidade/test_contrato.py` | Dois testes afirmam o contrário de R6 e R7 | Mudam na etapa 3 |
| 12 | `test_ponta_a_ponta.py` etapa 9 | Passará a abrir `colisao_seq` | Comportamento correto; a etapa ganha a verificação |
| 13 | `CLAUDE.md` | Só o processo de regras abre alertas | O consumidor passa a abrir `colisao_seq`; registrar |
| 14 | Figma (Alertas) | "Retira do experimento sozinho após 24 h sem comunicação" | Não implementar (RN-21, R1) |
| 15 | `CLAUDE.md` × `backend/app/regras/verificacoes.py` | `CLAUDE.md` diz "SQL só em `repositorios.py`", mas as regras fazem as consultas de seleção no próprio arquivo | A regra nova segue o padrão do arquivo (E.6). Registrar a exceção no `CLAUDE.md` na etapa 8 |

---

## I. Pendências e decisões em aberto

Nenhuma destas está decidida. "Proposta padrão" é o que esta especificação sugere; não é decisão.

| # | Pergunta | Proposta padrão | Impacto | Bloqueia |
|---|---|---|---|---|
| **P-1** | Quando e em que formato exigir MAC em `id_celula`? Como migrar `c01`–`c03` do simulador e dos testes? | Adiar. Nenhum CHECK no MVP; decidir com o hardware | Sem ele, qualquer ID aceito pelo contrato entra | Nada |
| **P-2** | O desenho de autenticação de E.7 está aprovado? (scrypt, token HMAC, `SEGREDO_SESSAO`, 12 h, rotas existentes abertas) | E.7 | Define etapa 6 e todas as rotas da etapa 7 | **Etapas 6 e 7** |
| **P-3** | O que pode ser editado na ficha depois que o experimento começa? | Pelo Figma: só `metadados` (e talvez `descricao`). Antes do início, tudo | Regra do `PATCH /experimentos/{id}` | **`PATCH /experimentos`** |
| **P-4** | A interface vai ganhar o status "cancelado" e tirar "convites pendentes"? | Banco segue o MVP; frente da interface decide | Nenhum no backend | Nada no backend |
| **P-5** | Quando o alerta `colisao_seq` fecha? | Fica aberto até ação humana. Não há rota para fechar alertas hoje, e criar uma está fora deste escopo | O alerta pode ficar aberto até o próximo `down -v` | Nada |
| **P-6** | O alerta de pH exige tempo mínimo fora da faixa (o Figma mostra 10 min)? | Não: última leitura (MVP) | Pode gerar alerta por uma leitura ruidosa | Nada (etapa 4 segue a proposta) |
| **P-7** | Pode iniciar cultivo com horário retroativo? | Não: `now()`. A API não aceita `iniciado_em` | Atribuição feita depois do início real perde os primeiros minutos na visão | Nada |
| **P-8** | Formato do código exibido ("EXP-01")? | `EXP-` + id com no mínimo 2 dígitos, calculado na API, não gravado | Só exibição | Nada |
| **P-9** | Encerrar experimento com cultivos abertos: recusar (v1) ou encerrar os cultivos junto (Figma)? | Nenhuma; decidir | Comportamento da rota e do repositório | **`POST /experimentos/{id}/encerrar`** |
| **P-10** | Quem pode mandar setpoint para uma célula com cultivo aberto? | Sem mudança: rota aberta, como hoje | Alguém sem acesso ao experimento pode mudar a temperatura | Nada |
| **P-11** | De onde vem `modelo` da placa? | `PATCH /celulas/{id}`. Entrar no contrato depende do hardware | Campo fica vazio até alguém preencher | Nada |
| **P-12** | Com que frequência avisar no log sobre `extras`? | Uma vez por nome de campo e célula, por execução do consumidor | Volume de log | Nada |
| **P-13** | O PostgreSQL local de quem roda `AMBIENTE=local` tem o contrib (`btree_gist`)? | Conferir na etapa 0. No Compose já tem | Sem ele, o 03 falha no modo local | Etapa 1 só no modo local |
| **P-14** | Qual processo de migração usar depois do MVP? | Decidir depois da entrega | Até lá, mudanças futuras exigem script idempotente ou `down -v` | Nada |

---

## Apêndice A — SQL do esquema (`infra/postgres/init/03_modelo_mvp.sql`)

Validado conforme E.1. Este é o conteúdo a criar. Remover também, de `01_tabelas.sql`, o bloco `CREATE TABLE experimento (...)` (linhas 16 a 24 no commit `fdaf1b3`).

```sql
-- Modelo de dados do MVP: pessoas, experimentos, cultivos e os acréscimos
-- nas tabelas que já existem. Especificação em
-- docs/especificacao-modelo-dados-mvp.md.
--
-- Idempotente: roda sozinho na primeira subida do PostgreSQL (depois do
-- 01 e do 02) e também pode ser aplicado à mão num banco que já existe,
-- sem apagar dados:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/postgres/init/03_modelo_mvp.sql

-- Exclusão de períodos sobrepostos por célula (cultivo) precisa de "=" em
-- TEXT dentro de um índice GiST. Extensão do próprio PostgreSQL (contrib).
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A tabela experimento antiga (um experimento por célula) não é usada por
-- nenhum código. Só é removida se estiver vazia; com dados, nada é apagado
-- e o script para com erro.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'experimento' AND column_name = 'id_celula') THEN
        IF EXISTS (SELECT 1 FROM experimento) THEN
            RAISE EXCEPTION 'A tabela experimento antiga tem dados. Exporte-os e remova a tabela antes de aplicar este script.';
        END IF;
        DROP TABLE experimento;
    END IF;
END $$;

-- ---------------------------------------------------------------- pessoas

-- Quem usa o sistema. Login por e-mail e senha; a senha nunca é guardada,
-- só o resumo (ver especificação, seção de autenticação).
CREATE TABLE IF NOT EXISTS pessoa (
    id_pessoa  SERIAL PRIMARY KEY,
    nome       TEXT NOT NULL CHECK (btrim(nome) <> ''),
    email      TEXT NOT NULL UNIQUE CHECK (email = lower(btrim(email)) AND email LIKE '_%@_%'),
    senha_hash TEXT NOT NULL,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- experimentos

-- A ficha do estudo. Começa em cadastrado ("Stand by" na tela) e passa a
-- em_andamento quando o primeiro cultivo é iniciado.
CREATE TABLE IF NOT EXISTS experimento (
    id_experimento        SERIAL PRIMARY KEY,
    nome                  TEXT NOT NULL CHECK (btrim(nome) <> ''),
    descricao             TEXT,
    modo                  TEXT NOT NULL
                          CHECK (modo IN ('curva_crescimento', 'turbidostato', 'quimiostato')),
    status                TEXT NOT NULL DEFAULT 'cadastrado'
                          CHECK (status IN ('cadastrado', 'em_andamento', 'encerrado', 'cancelado')),
    duracao_prevista_dias INTEGER CHECK (duracao_prevista_dias > 0),
    temperatura_alvo_c    DOUBLE PRECISION,
    ph_ref_min            DOUBLE PRECISION,
    ph_ref_max            DOUBLE PRECISION,
    metadados             JSONB NOT NULL DEFAULT '{}',
    id_responsavel        INTEGER NOT NULL REFERENCES pessoa,
    id_origem             INTEGER REFERENCES experimento,
    criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
    iniciado_em           TIMESTAMPTZ,
    encerrado_em          TIMESTAMPTZ,
    CONSTRAINT experimento_faixa_ph CHECK (ph_ref_min IS NULL OR ph_ref_max IS NULL OR ph_ref_min < ph_ref_max),
    CONSTRAINT experimento_datas_do_status CHECK (CASE status
        WHEN 'cadastrado'   THEN iniciado_em IS NULL AND encerrado_em IS NULL
        WHEN 'em_andamento' THEN iniciado_em IS NOT NULL AND encerrado_em IS NULL
        WHEN 'encerrado'    THEN iniciado_em IS NOT NULL AND encerrado_em IS NOT NULL
        WHEN 'cancelado'    THEN encerrado_em IS NOT NULL
    END),
    CONSTRAINT experimento_ordem_datas CHECK (encerrado_em IS NULL OR iniciado_em IS NULL OR encerrado_em >= iniciado_em)
);

-- Com quem o experimento é compartilhado. O responsável não entra aqui:
-- ele tem acesso total por experimento.id_responsavel.
CREATE TABLE IF NOT EXISTS experimento_acesso (
    id_experimento INTEGER NOT NULL REFERENCES experimento,
    id_pessoa      INTEGER NOT NULL REFERENCES pessoa,
    permissao      TEXT NOT NULL CHECK (permissao IN ('leitura', 'edicao')),
    concedido_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_experimento, id_pessoa)
);

-- Uma célula rodando um experimento durante um período. As leituras não
-- apontam para cá: a ligação é pela célula e pelo horário (leitura_cultivo).
CREATE TABLE IF NOT EXISTS cultivo (
    id_cultivo          SERIAL PRIMARY KEY,
    id_experimento      INTEGER NOT NULL REFERENCES experimento,
    id_celula           TEXT NOT NULL REFERENCES celula,
    condicao            TEXT,
    replica             SMALLINT CHECK (replica > 0),
    ph_ref_min          DOUBLE PRECISION,
    ph_ref_max          DOUBLE PRECISION,
    status              TEXT NOT NULL DEFAULT 'em_andamento'
                        CHECK (status IN ('em_andamento', 'encerrado', 'cancelado')),
    iniciado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
    encerrado_em        TIMESTAMPTZ,
    motivo_encerramento TEXT,
    id_iniciado_por     INTEGER REFERENCES pessoa,
    id_encerrado_por    INTEGER REFERENCES pessoa,
    continua_de         INTEGER REFERENCES cultivo,
    metadados           JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT cultivo_faixa_ph CHECK (ph_ref_min IS NULL OR ph_ref_max IS NULL OR ph_ref_min < ph_ref_max),
    CONSTRAINT cultivo_aberto_sem_fim CHECK ((status = 'em_andamento') = (encerrado_em IS NULL)),
    CONSTRAINT cultivo_cancelado_com_motivo CHECK (status <> 'cancelado' OR coalesce(btrim(motivo_encerramento), '') <> ''),
    CONSTRAINT cultivo_ordem_datas CHECK (encerrado_em IS NULL OR encerrado_em >= iniciado_em),
    CONSTRAINT cultivo_nao_continua_de_si CHECK (continua_de IS NULL OR continua_de <> id_cultivo),
    -- Uma célula, um cultivo por vez, inclusive no passado: períodos da
    -- mesma célula nunca se sobrepõem, e cada leitura cai em no máximo um.
    CONSTRAINT cultivo_sem_sobreposicao EXCLUDE USING gist (
        id_celula WITH =,
        tstzrange(iniciado_em, coalesce(encerrado_em, 'infinity'::timestamptz), '[)') WITH &&
    )
);
CREATE INDEX IF NOT EXISTS cultivo_por_experimento ON cultivo (id_experimento);

-- ---------------------------------------------------------------- acréscimos

-- Célula: nome de exibição ("c08"), modelo da placa e firmware (o firmware
-- chega no campo "versao" da mensagem de estado).
ALTER TABLE celula ADD COLUMN IF NOT EXISTS apelido  TEXT;
ALTER TABLE celula ADD COLUMN IF NOT EXISTS modelo   TEXT;
ALTER TABLE celula ADD COLUMN IF NOT EXISTS firmware TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS celula_apelido_unico ON celula (apelido);

-- Calibração: sensor, pontos medidos (branco e padrões), qualidade do
-- ajuste, cultura usada e quem calibrou.
ALTER TABLE calibracao ADD COLUMN IF NOT EXISTS sensor    TEXT NOT NULL DEFAULT 'od' CHECK (sensor IN ('od'));
ALTER TABLE calibracao ADD COLUMN IF NOT EXISTS pontos    JSONB;
ALTER TABLE calibracao ADD COLUMN IF NOT EXISTS r2        DOUBLE PRECISION;
ALTER TABLE calibracao ADD COLUMN IF NOT EXISTS organismo TEXT;
ALTER TABLE calibracao ADD COLUMN IF NOT EXISTS id_pessoa INTEGER REFERENCES pessoa;

-- Setpoint: quem pediu, quando houver login. solicitado_por continua.
ALTER TABLE pedido_setpoint ADD COLUMN IF NOT EXISTS id_pessoa INTEGER REFERENCES pessoa;

-- Leitura: campos que a placa mandou e o contrato ainda não conhece.
ALTER TABLE leitura ADD COLUMN IF NOT EXISTS extras JSONB;

-- Alerta: dois tipos novos.
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta ADD CONSTRAINT alerta_tipo_check CHECK (tipo IN (
    'sem_comunicacao', 'setpoint_sem_confirmacao', 'desvio_temperatura',
    'ph_fora_da_faixa', 'colisao_seq'));

-- ---------------------------------------------------------------- visão

-- Liga cada leitura ao cultivo da mesma célula em cujo período ela foi
-- medida. Não guarda nada: leituras fora de qualquer cultivo continuam só
-- no historiador (tabela leitura).
CREATE OR REPLACE VIEW leitura_cultivo AS
SELECT c.id_cultivo, c.id_experimento, c.condicao, c.replica,
       l.id_celula, l.seq, l.ts_origem, l.ts_recebido,
       l.temperatura_c, l.od_bruto, l.od, l.ph, l.id_calibracao, l.extras
  FROM cultivo c
  JOIN leitura l
    ON l.id_celula = c.id_celula
   AND l.ts_origem >= c.iniciado_em
   AND (c.encerrado_em IS NULL OR l.ts_origem < c.encerrado_em);
```

---

## Apêndice B — Fluxo de referência pela API

Este é o fluxo que os testes da etapa 7 devem cobrir de ponta a ponta. Ele conta a mesma história da seção B.6, adaptada às células `c01` a `c03` do Compose de teste.

1. Ana: `POST /auth/cadastro` → token. Henry faz o mesmo.
2. Ana: `POST /experimentos {nome: "Crescimento de E. coli em 30 e 34 °C", modo: "curva_crescimento", duracao_prevista_dias: 30, temperatura_alvo_c: 30, ph_ref_min: 6.5, ph_ref_max: 7.5, metadados: {organismo: "E. coli K-12"}}` → status `cadastrado`.
3. Ana: `POST /experimentos/1/acessos {email: "henry@...", permissao: "edicao"}`.
4. Henry: `GET /experimentos?filtro=compartilhados` → vê o EXP-01 com acesso `edicao`.
5. Ana: `POST /experimentos/1/cultivos {id_celula: "c01", condicao: "30 °C", replica: 1}` → experimento passa a `em_andamento`; pedido de 30 °C publicado.
6. Henry: `POST /experimentos/1/cultivos {id_celula: "c02", condicao: "34 °C", replica: 1}`. Em seguida, `POST /celulas/c02/setpoint {temperatura_c: 34}` (a temperatura por condição é um setpoint comum; RN-17).
7. Ana tenta `POST /experimentos/1/cultivos {id_celula: "c01"}` de novo → 409.
8. Henry: `POST /cultivos/2/encerrar {motivo: "placa queimou"}`; `POST /experimentos/1/cultivos {id_celula: "c03", condicao: "34 °C", replica: 1, continua_de: 2}`.
9. `GET /cultivos/2/leituras` só traz leituras da c02 do período do cultivo 2.
10. Ana: `POST /experimentos/1/duplicar` → EXP-02 `cadastrado`, `id_origem = 1`, sem cultivos.

> No Compose de teste, a c03 está em modo `ignorar_setpoint`. Se o passo 8 depender do setpoint da c03 chegar a `aplicado`, usar outra célula livre ou verificar só a criação do pedido.

---

## Decisões da implementação

Registro das decisões tomadas durante a implementação. Onde contradizem o texto acima, valem estas. O texto acima será corrigido na etapa 8.

### Decisões sobre as divergências da etapa 0 (06/11/2026)

| # | Ponto | Decisão | Etapa |
|---|---|---|---|
| D1 | E.5 dizia que `gravar_leitura` atualiza `ultimo_contato` só quando insere ("como hoje"), mas hoje atualiza sempre | Manter o comportamento atual: `ultimo_contato` é atualizado também em duplicatas e colisões. A E.5 estava errada | 3 |
| D2 | `SEGREDO_SESSAO` obrigatório, mas o modo local do teste (`ambiente.py`) não define a variável, e `config.py` é lido pelos três processos | `ambiente.py` ganha `SEGREDO_SESSAO` com valor de teste. A obrigatoriedade é checada só no `ciclo_de_vida` da API. No Compose, a variável vai só no serviço `api`, não na âncora `x-backend` | 6 |
| D3 | `AmbienteCompose` não isolava a porta da interface: o teste falhava com um `docker compose up` de desenvolvimento no ar (porta 8080) | `PORTA_INTERFACE: 58080` em `AmbienteCompose.PORTAS`. Mudança mínima, só na infraestrutura de teste | 1 (feito) |
| D4 | No Apêndice A, o `CREATE EXTENSION` vinha antes da guarda da tabela antiga: com dados nela, o script parava, mas a extensão já tinha sido instalada | O bloco `DO` vem antes do `CREATE EXTENSION`. Com dados na tabela antiga, o script para sem mudar nada | 1 (feito) |
| D5 | `PATCH /celulas/{id}` aceita `descricao`, mas `GET /celulas` não a devolve | `GET /celulas` passa a devolver também `descricao` | 5 |
| D6 | RN-02/RN-03 não diziam o que fazer se o broker cair depois do commit do cultivo | O cultivo fica criado. A resposta é 201 com o cultivo, o pedido de setpoint e o campo `setpoint_confirmado` (`true`/`false`), ligado ao mesmo `is_published()` da rota de setpoint. Sem 503 depois do commit. A rota `POST /celulas/{id}/setpoint` não muda. O `solicitado_por` do pedido é o nome da pessoa logada | 7b |
| D7 | RN-18/E.6: um cultivo aberto sem leitura de pH no período deixava aberto o alerta herdado de um cultivo anterior; "última leitura" não estava definida | Se o cultivo aberto não tiver nenhuma leitura com pH no seu período, o alerta `ph_fora_da_faixa` da célula é fechado. "Última leitura" é a de maior `ts_origem` dentro do período do cultivo | 4 |

Comportamento atual da rota `POST /celulas/{id}/setpoint`, que a D6 segue: se o broker cai depois da checagem `is_connected()`, o pedido já está gravado como `solicitado`, o paho guarda a mensagem e a envia sozinho ao reconectar, a rota registra um aviso no log e responde 202 com o pedido. O mesmo vale quando o broker não confirma em 5 s. Se a mensagem nunca chegar, as regras abrem `setpoint_sem_confirmacao`.

### Decisões da etapa 2 (repositórios, 06/11/2026)

| Ponto | Decisão |
|---|---|
| Recusa por status | `repositorios.OperacaoRecusada` é levantada quando a operação não vale para o status atual (por exemplo, iniciar cultivo num experimento encerrado ou cancelado). Nada é gravado. A API traduz para 409 (etapa 7a) |
| `cancelar_experimento` | Só para experimento `cadastrado` ou `em_andamento`; motivo vazio é recusado. O motivo vai para os cultivos cancelados e também para `experimento.metadados`, na chave `motivo_cancelamento`, na mesma transação. Sem coluna nova |
| `continua_de` | Só a FK. Pode apontar para cultivo de outro experimento ou ainda aberto; nenhuma restrição extra no MVP |
| `atualizar_experimento` | Genérica: altera só os campos da ficha recebidos, sem as regras de P-3, que ficam na API |
| `senha_hash` | Só `buscar_pessoa_por_email` o devolve, para conferir o login. As demais funções de pessoa e a lista de acessos nunca o devolvem |
| E-mail | Normalizado só na API. Os repositórios não normalizam; o CHECK do banco recusa o que escapar |
| `listar_leituras_do_cultivo` | Mesmas colunas de `listar_leituras`, sem `extras` |
| `atualizar_celula` | Fica para a etapa 7a, junto com o `PATCH /celulas/{id}` |

### Decisões da etapa 3 (contrato e consumidor, 06/11/2026)

| Ponto | Decisão |
|---|---|
| **Desvio de G.4:** leitura com campo a mais | Sem etapa no ponta a ponta. Gravar uma leitura nova exige um `seq` novo: em c01 a c03 ele colidiria com o que o simulador vai mandar, e uma quarta célula quebraria as conferências de integridade (`historico_completo` e `len(CELULAS)`). O caso é coberto em `test_modelo_dados.py` pelo `Tratador` do consumidor com o banco do teste, sem broker: gravação em `extras`, contagem de inválidas que não sobe e aviso único no log. Nenhuma quarta célula é criada |
| Firmware | `celula.firmware` só é atualizado quando a mensagem de estado traz `versao`. Um `online` sem `versao` e o `offline` do LWT não apagam o valor gravado |
| Aviso de colisão no log | Um aviso por colisão, sem a deduplicação usada para os campos extras (P-12). O alerta `colisao_seq` continua sendo um só por célula |
| Extras de mensagem descartada | Numa duplicata ou colisão, os campos extras da mensagem descartada não são gravados: a leitura original é mantida inteira |
| Numeração do ponta a ponta | As etapas novas entram antes da integridade, que continua sendo a última e muda de número (`test_11_integridade_final` virou `test_13_integridade_final`; o que ela verifica não muda) |

### Correções do texto

| Onde | Texto atual | Correção |
|---|---|---|
| D.1 (Schema) | `01_tabelas.sql` "cria as 7 tabelas" | O 01 criava 6 tabelas (a `calibracao_padrao` vem do 02). Sem a `experimento` antiga, passa a criar 5 |
| D.2 e E.8 | A API é montada sob `/api` | O FastAPI não tem prefixo. Quem retira o `/api` é o proxy do Vite (`interface/vite.config.ts`) e o `interface/nginx.conf`. As rotas novas ficam na raiz (por exemplo, `/auth/entrar`) |
| E.5 | Atualizar `ultimo_contato` só se inseriu | Ver D1 |
| RN-02, RN-03, E.8 | Sem resposta para broker caindo depois do commit | Ver D6 |
| RN-18, E.6 | Passo 3: sem leitura com pH no período, não faz nada | Ver D7 |
| Apêndice A | `CREATE EXTENSION` antes do bloco `DO` | Ver D4 |

### Plano aprovado

- Ordem das etapas mantida (1 a 8).
- **Etapa 4:** ganha uma etapa no ponta a ponta sem mudar o simulador: um cultivo na c01 com faixa que exclui o pH simulado (entre 6,7 e 7,0) abre o alerta; trocar a faixa para uma que o inclui fecha.
- **Etapa 7** dividida em **7a** (rotas de experimentos, acessos e cultivos, sem setpoint) e **7b** (setpoint ao iniciar cultivo, D6, G.8 e a etapa no ponta a ponta).
- `APIRouter` em módulos novos só depois de perguntar.
- P-2, P-3, P-9 e P-13 continuam abertas. Nada que dependa delas é implementado antes da resposta.
