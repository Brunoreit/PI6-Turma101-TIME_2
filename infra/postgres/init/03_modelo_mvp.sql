-- Modelo de dados do MVP: pessoas, experimentos, cultivos e os acréscimos
-- nas tabelas que já existem. Especificação em
-- docs/especificacao-modelo-dados-mvp.md.
--
-- Idempotente: roda sozinho na primeira subida do PostgreSQL (depois do
-- 01 e do 02) e também pode ser aplicado à mão num banco que já existe,
-- sem apagar dados:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f infra/postgres/init/03_modelo_mvp.sql

-- A tabela experimento antiga (um experimento por célula) não é usada por
-- nenhum código. Só é removida se estiver vazia; com dados, nada é apagado
-- e o script para com erro. Vem antes de tudo para que, nesse caso, o
-- script pare sem ter mudado nada no banco.
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

-- Exclusão de períodos sobrepostos por célula (cultivo) precisa de "=" em
-- TEXT dentro de um índice GiST. Extensão do próprio PostgreSQL (contrib).
CREATE EXTENSION IF NOT EXISTS btree_gist;

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

-- Alerta: tipos novos. Os dois do sistema (consumidor_parado e
-- broker_inacessivel) não são de uma célula e ficam com id_celula nulo.
-- Continua valendo um aberto por célula e tipo; para os do sistema, um
-- aberto por tipo (NULLS NOT DISTINCT).
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_tipo_check;
ALTER TABLE alerta ADD CONSTRAINT alerta_tipo_check CHECK (tipo IN (
    'sem_comunicacao', 'setpoint_sem_confirmacao', 'desvio_temperatura',
    'ph_fora_da_faixa', 'colisao_seq', 'consumidor_parado', 'broker_inacessivel'));
ALTER TABLE alerta ALTER COLUMN id_celula DROP NOT NULL;
ALTER TABLE alerta DROP CONSTRAINT IF EXISTS alerta_celula_check;
ALTER TABLE alerta ADD CONSTRAINT alerta_celula_check CHECK (
    (id_celula IS NULL) = (tipo IN ('consumidor_parado', 'broker_inacessivel')));
DROP INDEX IF EXISTS alerta_um_aberto;
CREATE UNIQUE INDEX alerta_um_aberto ON alerta (id_celula, tipo) NULLS NOT DISTINCT WHERE fechado_em IS NULL;

-- Sinal de vida dos processos do backend. O consumidor grava a cada
-- SINAL_VIDA_S e também quando conecta ou desconecta do broker; as regras
-- gravam a cada rodada. Sem isso, consumidor parado parece célula muda.
CREATE TABLE IF NOT EXISTS processo (
    nome             TEXT PRIMARY KEY CHECK (nome IN ('consumidor', 'regras')),
    iniciado_em      TIMESTAMPTZ NOT NULL,
    ultimo_sinal     TIMESTAMPTZ NOT NULL,
    -- Só o consumidor: se está conectado ao broker e desde quando.
    broker_conectado BOOLEAN,
    broker_desde     TIMESTAMPTZ
);

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
