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
| `/experimentos` | Experimentos · compartilhados | Filtro Todos, Meus e Compartilhados comigo |
| `/experimentos/novo?base=EXP-01` | Novo experimento · etapas e metadados | Cria o experimento em Stand by |
| `/experimentos/{código}` | Experimento EXP-01, · só leitura, · compartilhar | Compartilhar e encerrar, conforme o acesso |
| `/historiador?celulas=c04,c08` | Historiador | Gráfico das leituras pela API (no modo `api`) |
| `/alertas` | Alertas · regras | Abertos e Histórico vêm da API (no modo `api`) |
| `/exportar` | Exportar dados e · por célula e período | CSV de dados brutos, pelo `GET /celulas/{id}/leituras.csv` |

A interface ainda não usa as rotas de experimentos da API, e a API não tem
regras de alerta configuráveis nem exportação agrupada. Até lá, essas telas usam dados de exemplo e as mudanças
(novo experimento, compartilhar, encerrar, nova regra) ficam na memória até
recarregar a página. Os botões que dependem do que falta ficam como no Figma
e explicam o motivo ao passar o mouse.

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

Os experimentos de exemplo têm como responsável `pedro.ximenes@cnpem.br`.
Com outra conta, eles aparecem sem permissão de edição até a tela de
Experimentos passar a usar a API.

### Permissões dos experimentos

Cada experimento tem um responsável e convidados com "Só leitura" ou "Pode
modificar". O que a pessoa logada pode fazer vem de `acessoDe()` em
`funcionalidades/experimentos/modelo.ts`. Sem acesso, o botão fica esmaecido
com cadeado e, ao clicar, aparece o Aviso de acesso por 5 s
(`compartilhado/componentes/AvisoDeAcesso.tsx`).

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
    experimentos/       lista, NovoExperimento, DetalheDoExperimento, Compartilhar,
                        TaxaDeCrescimento, modelo, exemplo e ExperimentosProvider
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
