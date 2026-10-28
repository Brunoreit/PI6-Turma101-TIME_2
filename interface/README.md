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

## Estrutura

```
src/
  api/            cliente tipado: /celulas, /alertas, /celulas/{id}/leituras, /saude,
                  /celulas/{id}/setpoint(s), /integridade
  dados/          modelo das telas, conversão da API, dados de exemplo, atualização a cada 20 s
  componentes/    BarraLateral, CardDeCelula, SeloDeStatus, HistoricoOd, Botao, Campo,
                  GraficoDeLinha, CurvaDeCalibracao
  telas/          VisaoGeral, celula/ (Visão da célula, Ajustes, Diagnóstico) e
                  EmConstrucao (rotas ainda vazias)
  estilos/        tokens.css (cores do Figma) e global.css
  assets/icones/  SVGs exportados do Figma
```

## Cores

As variáveis da coleção "T.U.P.A" do Figma estão em `src/estilos/tokens.css`
com os mesmos nomes. No CSS a barra é escapada:

```css
color: var(--texto\/secundario);
border-color: var(--status\/alerta-borda);
```

Use sempre os tokens, nunca a cor direto.
