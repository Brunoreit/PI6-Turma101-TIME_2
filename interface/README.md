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
Os dados são atualizados a cada 20 s (`src/dados/DadosProvider.tsx`).

## Estrutura

```
src/
  api/            cliente tipado: GET /celulas, /alertas, /celulas/{id}/leituras, /saude
  dados/          modelo da tela, conversão da API, dados de exemplo, atualização a cada 20 s
  componentes/    BarraLateral, CardDeCelula, SeloDeStatus, HistoricoOd
  telas/          VisaoGeral e EmConstrucao (rotas ainda vazias)
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
