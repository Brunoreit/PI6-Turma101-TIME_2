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

A API ainda não devolve tudo que a tela mostra: experimento e alvo de
temperatura, estado do consumidor e das regras, setpoints aguardando. Por isso há duas fontes:

| `VITE_FONTE_DADOS` | O que mostra |
|---|---|
| `exemplo` (padrão) | Dados iguais aos do Figma, em `src/dados/exemplo.ts` |
| `api` | Dados reais. O que a API não informa aparece como "sem dados" |

```bash
VITE_FONTE_DADOS=api npm run dev
```

No Docker, defina a variável no `.env` e rode `docker compose up --build`.

As telas da célula (`/celulas/{id}`, `/ajustes` e `/diagnostico`) seguem a
mesma variável. No modo `exemplo`, qualquer célula mostra os dados da c08 do
Figma. No modo `api`, o que a API ainda não tem (experimento, placa,
calibração em uso, bombas, manutenção, mensagens recebidas) aparece como "—"
ou com aviso. Os botões dessas ações ficam como no Figma, mas não fazem nada e
explicam o motivo ao passar o mouse. O único comando que funciona é o
setpoint de temperatura, pelo `POST /celulas/{id}/setpoint`.
Os dados são atualizados a cada 20 s (`src/dados/DadosProvider.tsx`).
Células sem experimento nos dados de exemplo (a c04) mostram a tela
"Célula c04 · livre", com Atribuir experimento no lugar dos Comandos.

## Telas

| Rota | Tela do Figma | O que já funciona de verdade |
|---|---|---|
| `/entrar`, `/cadastro`, `/recuperar-senha`, `/nova-senha?email=` | Login, Login · erro, Cadastro, Recuperar senha, e-mail enviado, Nova senha | Login e cadastro pela API, sempre (ver Login abaixo). Recuperar e trocar a senha ainda não |
| `/` | Visão geral | Igual antes |
| `/celulas/{id}` (e `/ajustes`, `/diagnostico`) | Célula c08 e Célula c04 · livre, modal Confirmar temperatura | Setpoint de temperatura, agora com confirmação |
| `/celulas/{id}/ajustes/calibracao` | Célula c08 · nova calibração de OD | Salva a nova curva pelo `POST /celulas/{id}/calibracoes` (no modo `api`) |
| `/experimentos` | Experimentos · compartilhados | Lista e filtro Todos, Meus e Compartilhados comigo; Duplicar. Pela API no modo `api` (ver Experimentos abaixo) |
| `/experimentos/novo?base=EXP-01` | Novo experimento · etapas e metadados | Cria o experimento em Stand by. Pela API no modo `api` |
| `/experimentos/{código}/editar` | Não está no Figma: o mesmo formulário do Novo experimento | Edita conforme o status. Pela API no modo `api` |
| `/experimentos/{código}` | Experimento EXP-01, · só leitura, · compartilhar | Duplicar, editar, encerrar e cancelar, conforme o acesso. Compartilhar só no modo `exemplo` |
| `/historiador?celulas=c04,c08` | Historiador | Gráfico das leituras pela API (no modo `api`) |
| `/alertas` | Alertas · regras | Abertos e Histórico vêm da API (no modo `api`) |
| `/exportar` | Exportar dados e · por célula e período | CSV de dados brutos, pelo `GET /celulas/{id}/leituras.csv` |

A API não tem regras de alerta configuráveis nem exportação agrupada, e a
interface ainda não usa as rotas de acessos (Compartilhar) e de cultivos. No
modo `exemplo`, as mudanças (novo experimento, compartilhar, encerrar,
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

- **Código e id.** A URL usa o código que a API devolve (`EXP-01`). As
  chamadas usam o `id_experimento`, guardado junto com o experimento. Link
  aberto direto carrega a lista antes, para achar o id.
- **Status.** `cadastrado` aparece como "Stand by", `em_andamento` como "Em
  andamento", `encerrado` como "Encerrado" e `cancelado` como "Cancelado".
  O selo de cancelado não está no Figma: segue o desenho dos outros, em
  vermelho. Cancelados aparecem na lista e contam nos filtros.
- **Encerrar e cancelar.** Encerrar só aparece em andamento (a API recusa
  encerrar o que não começou). "Cancelar experimento" não está no Figma: é um
  botão Perigo ao lado de Encerrar, em Stand by ou em andamento, com um modal
  que pede o motivo (obrigatório). O detalhe mostra o motivo depois.
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
- **Ainda não ligado:** Compartilhar (fica indisponível no modo `api`, com a
  explicação) e iniciar ou encerrar cultivos de células.

### Permissões dos experimentos

Cada experimento tem um responsável e convidados com "Só leitura" ou "Pode
modificar". No modo `api`, o acesso vem da resposta da API: o campo `acesso`
da lista e, no detalhe, `id_responsavel` e a lista de `acessos` comparados com
a pessoa logada. No modo `exemplo`, vem de `acessoDe()` em
`funcionalidades/experimentos/modelo.ts`. Editar, encerrar e cancelar são só
do responsável. Sem acesso, o botão fica esmaecido com cadeado e, ao clicar,
aparece o Aviso de acesso por 5 s (`compartilhado/componentes/AvisoDeAcesso.tsx`).

## Estrutura

```
src/
  main.tsx              rotas
  app/                  casca do app: Layout, BarraLateral, ContaDoUsuario, ExigeLogin e
                        EmConstrucao (página não encontrada)
  sessao/               SessaoProvider: conta logada, entrar, cadastrar e sair, pela API
  api/                  cliente tipado, com o token em Authorization: /auth/cadastro,
                        /auth/entrar, /auth/eu, /celulas, /alertas, /celulas/{id}/leituras,
                        /saude, /celulas/{id}/setpoint(s), /calibracoes, /integridade
  dados/                dados gerais, atualizados a cada 20 s e usados por todas as telas:
                        modelo, fonte (API ou exemplo), exemplo e DadosProvider
  compartilhado/        formatar.ts e componentes reaproveitáveis: Botao, Campo,
                        CaixaDeSelecao, AvisoDeAcesso, GraficoDeLinha, SeloDeStatus,
                        CurvaDeCalibracao
  funcionalidades/      uma pasta por funcionalidade, com tudo dela junto
    visao-geral/        VisaoGeral, CardDeCelula, HistoricoOd
    celula/             VisaoDaCelula/, NovaCalibracao/, Ajustes, Diagnostico e os dados próprios da
                        célula (modelo, fonte, exemplo, useCelula)
    conta/              Entrar, Cadastro, RecuperarSenha, NovaSenha e o CartaoDeConta comum
    experimentos/       lista, NovoExperimento (novo e editar), DetalheDoExperimento,
                        CancelarExperimento, Compartilhar, TaxaDeCrescimento, modelo,
                        exemplo, api (tradução da API) e ExperimentosProvider
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
