# Interface web

React com TypeScript e Vite, feita a partir do Figma (arquivo **Telas**).
Fala só com a API, sempre pelo prefixo `/api`.

## Rodar

```bash
cd interface
npm install
npm run dev          # http://localhost:5173, repassa /api para http://localhost:8000
npm run build        # verifica os tipos e gera dist/
```

No Docker Compose, o serviço `interface` gera o build e serve com nginx em
http://localhost:8080 (porta em `PORTA_INTERFACE`).

## Fonte dos dados

Há duas fontes:

| `VITE_FONTE_DADOS` | O que mostra |
|---|---|
| `exemplo` (padrão) | Dados iguais aos do Figma, em `src/dados/exemplo.ts` e nos `exemplo.ts` de cada tela. As mudanças ficam na memória até recarregar a página |
| `api` | Tudo pela API: células, alertas, experimentos, acessos e cultivos. O que a API não informa (estado do consumidor e das regras, setpoints aguardando, MAC, calibração em uso, bombas, manutenção) aparece como "sem dados" ou "—" |

O login é sempre pela API, nos dois modos. No modo `api`, nenhuma tela usa
dados de exemplo: a lista de células do Historiador e do Exportar vem de
`GET /celulas`, e a aba Regras dos Alertas mostra as regras fixas do backend.
O que falta na API está em "Ainda falta na API", abaixo.

```bash
VITE_FONTE_DADOS=api npm run dev
```

No Docker, defina a variável no `.env` e rode `docker compose up --build`.

As telas da célula (`/celulas/{id}`, `/ajustes` e `/diagnostico`) seguem a
mesma variável. No modo `exemplo`, qualquer célula mostra os dados da c08 do
Figma. No modo `api`, o experimento da célula vem do cultivo aberto nela
(ver Cultivos abaixo), e o que a API ainda não tem (MAC, calibração em uso,
bombas, manutenção, mensagens recebidas) aparece como "—" ou com aviso. Os
botões dessas ações ficam como no Figma, mas não fazem nada e explicam o
motivo ao passar o mouse. O único comando para a placa é o setpoint de
temperatura, pelo `POST /celulas/{id}/setpoint`.
Os dados são atualizados a cada 20 s (`src/dados/DadosProvider.tsx`).
Células sem experimento nos dados de exemplo (a c04) mostram a tela
"Célula c04 · livre", com Atribuir experimento no lugar dos Comandos.

## Telas

| Rota | Tela do Figma | O que já funciona de verdade |
|---|---|---|
| `/entrar`, `/cadastro`, `/recuperar-senha`, `/nova-senha?email=` | Login, Login · erro, Cadastro, Recuperar senha, e-mail enviado, Nova senha | Login e cadastro pela API, sempre (ver Login abaixo). Recuperar e trocar a senha ainda não |
| `/` | Visão geral | Igual antes |
| `/celulas/{id}` (e `/ajustes`, `/diagnostico`) | Célula c08 e Célula c04 · livre, modal Confirmar temperatura | Setpoint com confirmação. No modo `api`: atribuir, encerrar e resetar a participação e a faixa de pH do cultivo |
| `/celulas/{id}/ajustes/calibracao` | Célula c08 · nova calibração de OD | Salva a nova curva pelo `POST /celulas/{id}/calibracoes` (no modo `api`) |
| `/experimentos?de=meus&status=andamento,standby` | Experimentos · compartilhados | Lista com filtro Todos, Meus e Compartilhados comigo e, combinado, o filtro por status (não está no Figma: escolha um ou mais entre Em andamento, Stand by, Encerrado e Cancelado, com a contagem de cada); os dois ficam na URL. Duplicar. Pela API no modo `api` (ver Experimentos abaixo) |
| `/experimentos/novo?base=EXP-01` | Novo experimento · etapas e metadados | Cria o experimento em Stand by. Pela API no modo `api` |
| `/experimentos/{código}/editar` | Não está no Figma: o mesmo formulário do Novo experimento | Edita conforme o status. Pela API no modo `api` |
| `/experimentos/{código}` | Experimento EXP-01, · só leitura, · compartilhar, · mais ações, · só leitura · mais ações | Compartilhar e Duplicar no cabeçalho; Editar, Encerrar e Cancelar no menu "Mais ações", conforme o acesso. Pela API no modo `api` |
| `/historiador?celulas=c04,c08` | Historiador | Gráfico das leituras pela API (no modo `api`) |
| `/alertas` | Alertas · regras | Abertos e Histórico vêm da API (no modo `api`) |
| `/exportar` | Exportar dados e · por célula e período | CSV de dados brutos, pelo `GET /celulas/{id}/leituras.csv` |

### Ainda falta na API

- **Regras de alerta configuráveis.** No modo `exemplo`, a aba Regras é a do
  Figma, em memória. No modo `api`, ela mostra as cinco verificações fixas do
  backend, e "Nova regra" fica indisponível.
- **Exportação agrupada** (média por hora ou dia, intervalos, Excel, anexos).
  Só sai o CSV de dados brutos, pelo `GET /celulas/{id}/leituras.csv`.
- **Recuperar e trocar senha**, **convite para quem não tem conta** e **fechar
  o alerta `colisao_seq`**.
- **Dados da placa e da calibração:** não há `GET` de calibrações (a versão
  em uso, a curva e o histórico de versões aparecem como "—"), nem MAC,
  período de leitura, bombas e modo manutenção.
- **Estado do consumidor e das regras** na barra lateral.

No modo `exemplo`, as mudanças (novo experimento, compartilhar, encerrar,
cancelar, nova regra) ficam na memória até recarregar a página. Os botões
que dependem do que falta ficam como no Figma e explicam o motivo ao passar
o mouse.

### Login

Todas as telas do sistema pedem login, e o login é sempre pela API, mesmo
no modo `exemplo` (`src/sessao/SessaoProvider.tsx`). Por isso a API precisa
estar no ar para entrar. Não há conta pronta: crie a sua em `/cadastro`.

| Ação | Rota da API |
|---|---|
| Criar conta (entra direto) | `POST /auth/cadastro` |
| Entrar | `POST /auth/entrar` |
| Conferir o token ao abrir o sistema | `GET /auth/eu` |

- O token vai no cabeçalho `Authorization: Bearer <token>` de todas as
  chamadas do cliente (`src/api/cliente.ts`).
- "Manter conectado" marcado guarda o token no `localStorage`; desmarcado,
  no `sessionStorage`, e a sessão acaba ao fechar o navegador. A chave é
  `tupa.sessao`.
- Se a API responder 401 a uma chamada com token (sessão vencida ou
  inválida), a sessão é apagada e o `ExigeLogin` leva para `/entrar`. Depois
  de entrar, a pessoa volta para a tela onde estava.
- As mensagens de erro na tela são o `detail` da API, como "E-mail ou senha
  incorretos." e "Já existe uma conta com este e-mail.". Os erros de
  validação (422, que vêm em lista) também aparecem só com o texto.
- Recuperar senha e Nova senha ficam como no Figma, mas a API ainda não tem
  essas rotas: o botão fica indisponível e explica o motivo ao passar o mouse.

No modo `exemplo`, os experimentos de exemplo têm como responsável
`pedro.ximenes@cnpem.br`. Com outra conta, eles aparecem sem permissão de
edição. No modo `api`, cada conta vê os próprios experimentos e os
compartilhados com ela.

### Outros dados da API nas telas

Todo campo que a API devolve aparece em alguma tela no modo `api`:

| Campo | Onde aparece |
|---|---|
| `criado_em` da pessoa | Barra lateral, embaixo do nome ("desde 08/11/2026") |
| `criado_em` do experimento | Subtítulo do detalhe ("cadastrado em") |
| `concedido_em` do acesso | Modal Compartilhar ("acesso desde") |
| `id_iniciado_por` e `id_encerrado_por` do cultivo | Detalhe do experimento, coluna Período ("entrou por", "saiu por"); o nome vem do responsável e dos acessos |
| `metadados` do cultivo | Detalhe do experimento, coluna Condição |
| `recebido_em`, `aplicado_em` e `atingido_em` do pedido | Comandos, com o horário de cada etapa |
| `pedido_setpoint` ao atribuir | Aviso verde na tela da célula, com o número do cultivo e do pedido |
| `alertas_abertos` da célula | Card da Visão geral ("2 alertas") |
| `ts_recebido` e `id_calibracao` da leitura | Diagnóstico, painel Sensores (medida, recebida, atraso e calibração) |
| `primeiro_seq` da integridade | Diagnóstico, Integridade do histórico |
| Resposta da nova calibração (`id_calibracao`, `criada_em`, `sensor`, `r2`, `pontos`, `organismo`, `id_pessoa`) | Aviso em Ajustes ao voltar da calibração |

Outros dados ligados nesta parte:

- **Setpoint:** depois de Confirmar, o pedido é acompanhado pelo
  `GET /setpoints/{id}` a cada 2 s (até atingir, ser recusado ou passar
  3 min), em vez de esperar a atualização de 20 s.
- **Setpoints aguardando** (Visão geral): o último pedido de cada célula
  (`GET /celulas/{id}/setpoints`) que ainda está solicitado, recebido ou
  aplicado.
- **Nova calibração:** vão junto os padrões usados na reta (branco e
  padrões), o R² e o organismo (campo opcional). Ao voltar para Ajustes,
  aparece a versão gravada e quantas leituras tiveram a OD recalculada. A
  API não informa a versão em uso, então antes de salvar a tela diz "versão
  nova".
- **Diagnóstico:** primeiro anúncio, último contato e último `seq` gravado da
  placa, de `GET /celulas`.

### Apelido da célula

Em Ajustes, o painel Identificação (não está no Figma) edita o apelido, a
descrição e o modelo da placa pelo `PATCH /celulas/{id}`, que exige login. O
firmware vem de `GET /celulas` e só aparece. Em branco, o campo tira o valor.

- O apelido aparece no card da Visão geral, no cabeçalho e na trilha das
  telas da célula, no Historiador, no Exportar e nos Alertas, com o id
  pequeno ao lado. Sem apelido, aparece o id (`c01`). Quem decide o nome é
  `nomeDaCelula()` em `src/dados/modelo.ts`.
- O apelido é único: com 409, a tela mostra "Esse apelido já é usado por
  outra célula. Escolha outro."

### Alertas

Os títulos e a ajuda de cada tipo ficam em `TITULO_DO_ALERTA`
(`src/dados/fonte.ts`) e aparecem nos Alertas (abertos e histórico) e no
painel de alertas da célula.

| Tipo | Título | Fecha sozinho? |
|---|---|---|
| `sem_comunicacao` | Sem comunicação | Sim, quando a célula volta |
| `setpoint_sem_confirmacao` | Setpoint sem confirmação | Sim, quando a célula confirma |
| `desvio_temperatura` | Desvio de temperatura | Sim, quando a temperatura volta para perto do alvo |
| `ph_fora_da_faixa` | pH fora da faixa do cultivo | Sim, quando o pH volta para a faixa. A mensagem traz a faixa e o último valor |
| `colisao_seq` | Leitura repetida com horário diferente | Não. A leitura original foi mantida; não há rota para fechar, então não há botão |

Um tipo que a interface não conhece aparece com o próprio nome.

### Experimentos

O `ExperimentosProvider` segue `VITE_FONTE_DADOS`. No modo `exemplo`, usa
`exemplo.ts` como antes. No modo `api`:

| Ação na tela | Rota da API |
|---|---|
| Lista | `GET /experimentos?filtro=todos` (o filtro Meus e Compartilhados é feito na tela, pelo acesso de cada um) |
| Detalhe e editar | `GET /experimentos/{id}`, com cultivos e acessos |
| Novo experimento | `POST /experimentos` |
| Duplicar | `POST /experimentos/{id}/duplicar`; a cópia abre direto em editar |
| Salvar alterações | `PATCH /experimentos/{id}` |
| Encerrar experimento | `POST /experimentos/{id}/encerrar` |
| Cancelar experimento | `POST /experimentos/{id}/cancelar {motivo}` |
| Compartilhar: convidar e trocar a permissão | `POST /experimentos/{id}/acessos {email, permissao}` |
| Compartilhar: remover | `DELETE /experimentos/{id}/acessos/{id_pessoa}` |

- **Código e id.** A URL usa o código que a API devolve (`EXP-01`). As
  chamadas usam o `id_experimento`, guardado junto com o experimento. Link
  aberto direto carrega a lista antes, para achar o id.
- **Status.** `cadastrado` aparece como "Stand by", `em_andamento` como "Em
  andamento", `encerrado` como "Encerrado" e `cancelado` como "Cancelado".
  O selo de cancelado não está no Figma: segue o desenho dos outros, em
  vermelho. Cancelados aparecem na lista e contam nos filtros. O motivo
  aparece na lista (no lugar da descrição), no detalhe, no Exportar e no
  histórico da célula; o Historiador marca o experimento cancelado ou
  encerrado na faixa de contexto. Encerrado e cancelado são fechados: nada
  pode ser editado, e nenhum dos dois aparece para atribuir célula nem para
  criar regra.
- **Menu "Mais ações".** Editar, Encerrar e Cancelar ficam num menu
  (`compartilhado/componentes/MenuSuspenso.tsx`), para o título caber numa
  linha. Editar e Cancelar só aparecem com o experimento aberto; Encerrar só
  em andamento (a API recusa encerrar o que não começou). Sem nenhum item
  (encerrado ou cancelado), o botão some. Fecha ao clicar fora, com Esc e ao
  escolher; as setas andam pelos itens e Enter escolhe.
- **Encerrar e cancelar.** Os dois abrem um modal (não estão no Figma; seguem
  o desenho do Confirmar temperatura). Encerrar só confirma; Cancelar pede o
  motivo (obrigatório), e o detalhe mostra o motivo depois.
- **Editar respeita o status.** Em Stand by, tudo muda. Em andamento, só a
  descrição e os metadados: nome, tipo, duração, faixa de pH e fases ficam
  desabilitados, com a explicação, como o cadeado do Figma. Encerrado ou
  cancelado: nada, e o botão Editar some.
- **Campos sem coluna na API.** As fases de temperatura, a OD mínima e
  máxima do turbidostato e a agitação vão dentro de `metadados` (chaves
  `fases`, `od_min`, `od_max`, `agitacao_rpm`), junto com `organismo`,
  `meio`, `volume_ml`, `lote_meio` e `inoculo_od`. **O backend ainda não usa
  esses campos**: só guarda. O modo, a duração, a temperatura alvo (a da
  primeira fase) e a faixa de pH vão nos campos próprios. Ao editar, as
  outras chaves de `metadados` (como `motivo_cancelamento`) são mantidas.
- **Células.** A lista da API só traz quantos cultivos estão abertos; os ids
  das células aparecem no detalhe, que lê os cultivos e completa
  temperatura, OD e pH com os dados gerais das células.
- **Erros.** 404 mostra "Experimento não encontrado ou sem acesso"; 403 abre
  o Aviso de acesso; os outros mostram o `detail` da API.

### Cultivos

Um cultivo é uma célula dentro de um experimento durante um período. No modo
`api`:

| Ação na tela | Rota da API |
|---|---|
| Experimento da célula (faixa de status, "Abrir experimento", alvo e pH) | `cultivo_atual` de `GET /celulas` e `GET /experimentos/{id}` |
| Atribuir e iniciar (célula livre) | `POST /experimentos/{id}/cultivos {id_celula, condicao, replica, continua_de}` e, se a temperatura mudou, `POST /celulas/{id}/setpoint` |
| Salvar a faixa de pH, a condição e a réplica (Comandos) | `PATCH /cultivos/{id}` |
| Encerrar participação | `POST /cultivos/{id}/encerrar {motivo?}`, com o motivo opcional pedido num modal |
| Resetar célula | `POST /cultivos/{id}/cancelar {motivo}`, com o motivo pedido num modal |
| Taxa de crescimento do detalhe do experimento | `GET /cultivos/{id}/leituras` |

- **Atribuir.** A lista mostra só os experimentos em Stand by ou em andamento
  em que a pessoa é responsável ou tem edição. A temperatura começa com a do
  cadastro (a da primeira fase). Se o experimento tem temperatura alvo, a
  API já manda o setpoint ao abrir o cultivo; se a pessoa mudou a
  temperatura desta célula, a tela manda um segundo pedido com o valor novo.
  A condição e a réplica são opcionais; sem condição, vale a temperatura
  escolhida, como "32,0 °C". "Continua a cultura de" aparece quando o
  experimento tem células que já saíram dele, para troca de placa ou de
  célula (`continua_de`).
- **Erros ao atribuir.** 503: "A célula não foi atribuída porque o broker está
  fora do ar. Tente de novo em instantes." 409: a mensagem da API (célula já
  em outro cultivo, ou experimento fechado). Se o cultivo começou mas a
  temperatura não foi enviada (`setpoint_confirmado: false`, ou o segundo
  pedido falhou), aparece um aviso no topo da tela da célula.
- **Resetar não apaga nada.** A API não apaga o armazenamento local da placa
  nem as leituras: o cultivo fica marcado como cancelado. Por isso a frase
  "apaga o armazenamento local da placa" do Figma saiu. A frase do Figma
  sobre retirar a célula sozinha depois de 24 h sem comunicação também saiu:
  perder a conexão nunca encerra um cultivo.
- **Permissões.** Só o responsável ou quem tem edição atribui, encerra,
  reseta e muda o pH. Quem só lê vê os botões esmaecidos com o Aviso de
  acesso. Célula num experimento não compartilhado com a pessoa aparece como
  "experimento de outra pessoa", sem link.
- **Detalhe do experimento.** A tabela de células vem dos cultivos, com início
  e fim, a condição, a réplica, de onde a cultura continua e o motivo de
  quem saiu; cultivo cancelado aparece com o selo "Cancelada". Um
  experimento duplicado mostra "duplicado do EXP-xx" no subtítulo. A taxa de
  crescimento é a inclinação de ln(OD) nas leituras dos últimos 7 dias de
  cada cultivo (cancelados não entram), dividida por ln 2, em divisões por
  hora, com a média por condição. "Ver no historiador" abre o historiador com
  as células e o período que cobre todas elas (`?celulas=...&inicio=...&fim=...`),
  e a faixa de contexto mostra o período de cada uma.
- No modo `exemplo`, os botões de cultivo explicam que não há para onde
  enviar.

### Compartilhar

O modal Compartilhar só abre para o responsável. Para quem tem "Pode
modificar" ou "Só leitura", o botão fica esmaecido e mostra o Aviso de acesso.

- **Só quem já tem conta.** A API não tem convite pendente: o e-mail precisa
  ser de uma conta que já existe. Se não for, a mensagem da API ("Nenhuma
  conta com o e-mail ...") aparece embaixo do campo, como o erro do login.
  Por isso o estado "convite enviado, ainda não entrou" do Figma saiu, e
  ninguém recebe e-mail.
- **Permissões.** "Só leitura" é `leitura` e "Pode modificar" é `edicao` na
  API.
- **Trocar a permissão** usa a mesma rota de convidar: com a pessoa que já
  tem acesso, a API troca a permissão. É uma chamada só, então a pessoa nunca
  fica sem acesso no meio da troca.
- **Responsável no topo.** A lista de acessos da API não inclui o
  responsável. O modal mostra ele no topo, com o selo "Responsável", a partir
  dos dados do experimento. A API não devolve o e-mail do responsável; o
  modal mostra o e-mail quando o responsável é a pessoa logada.
- **Depois de cada mudança**, o experimento e a lista são recarregados, para
  o modal e os selos da lista ("só leitura", "pode modificar") ficarem certos.
- No modo `exemplo`, qualquer e-mail é aceito e a mudança fica na memória.

### Permissões dos experimentos

Cada experimento tem um responsável e convidados com "Só leitura" ou "Pode
modificar". No modo `api`, o acesso vem da resposta da API: o campo `acesso`
da lista e, no detalhe, `id_responsavel` e a lista de `acessos` comparados com
a pessoa logada. No modo `exemplo`, vem de `acessoDe()` em
`funcionalidades/experimentos/modelo.ts`. Editar, encerrar e cancelar são só
do responsável. Sem acesso, o botão fica esmaecido com cadeado e, ao clicar,
aparece o Aviso de acesso por 5 s (`compartilhado/componentes/AvisoDeAcesso.tsx`).
No menu "Mais ações", quem não é o responsável vê os itens esmaecidos, com
cadeado, e o rodapé "Só o responsável, {nome}, pode usar estas opções."

## Estrutura

```
src/
  main.tsx              rotas
  app/                  casca do app: Layout, BarraLateral, ContaDoUsuario, ExigeLogin e
                        EmConstrucao (página não encontrada)
  sessao/               SessaoProvider: conta logada, entrar, cadastrar e sair, pela API
  api/                  cliente tipado, com o token em Authorization: /auth/cadastro,
                        /auth/entrar, /auth/eu, /celulas, /alertas, /celulas/{id}/leituras,
                        /saude, /celulas/{id}/setpoint(s), /calibracoes, /integridade,
                        /experimentos (e acessos) e /cultivos
  dados/                dados gerais, atualizados a cada 20 s e usados por todas as telas:
                        modelo, fonte (API ou exemplo), exemplo, DadosProvider
                        e useCelulas (lista de células e o nome de cada uma, com apelido)
  compartilhado/        formatar.ts e componentes reaproveitáveis: Botao, Campo,
                        CaixaDeSelecao, AvisoDeAcesso, ModalDeMotivo, MenuSuspenso, GraficoDeLinha,
                        SeloDeStatus, CurvaDeCalibracao
  funcionalidades/      uma pasta por funcionalidade, com tudo dela junto
    visao-geral/        VisaoGeral, CardDeCelula, HistoricoOd
    celula/             VisaoDaCelula/ (com Atribuir e Tirar do experimento), NovaCalibracao/,
                        Ajustes, Diagnostico e os dados próprios da célula (modelo, fonte
                        com as ações de cultivo, exemplo, useCelula)
    conta/              Entrar, Cadastro, RecuperarSenha, NovaSenha e o CartaoDeConta comum
    experimentos/       lista, NovoExperimento (novo e editar), DetalheDoExperimento,
                        CancelarExperimento, EncerrarExperimento, Compartilhar, TaxaDeCrescimento, taxa
                        (cálculo pelas leituras do cultivo), modelo, exemplo, api
                        (tradução da API) e ExperimentosProvider
    historiador/        Historiador, GraficoDeComparacao e dados (séries de leituras)
    alertas/            Alertas, NovaRegra e modelo (regras de exemplo)
    exportar/           Exportar
  estilos/              tokens.css (cores do Figma) e global.css
  assets/               SVGs exportados do Figma
```

Imports entre pastas usam o atalho `@/`, que aponta para `src/`
(`import * as formatar from "@/compartilhado/formatar"`). Dentro da mesma
pasta, use `./`. Um componente vai para `compartilhado/` quando é genérico
ou usado por mais de uma funcionalidade; senão, fica na pasta da funcionalidade.

## Cores

As variáveis da coleção "T.U.P.A" do Figma estão em `src/estilos/tokens.css`
com os mesmos nomes. No CSS a barra é escapada:

```css
color: var(--texto\/secundario);
border-color: var(--status\/alerta-borda);
```

Use sempre os tokens, nunca a cor direto. As cores das linhas de cada célula
no Historiador não têm variável no Figma; ficam em `--serie\/1` a `--serie\/4`.
