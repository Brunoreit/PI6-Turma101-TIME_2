-- Modelo de dados do sistema de monitoramento do eVOLVER.
-- Executado automaticamente pelo container do PostgreSQL na primeira subida.

-- Célula de cultivo. Criada sozinha quando a célula se anuncia ou manda a
-- primeira leitura, sem cadastro manual.
CREATE TABLE celula (
    id_celula        TEXT PRIMARY KEY,
    descricao        TEXT,
    sensores         JSONB NOT NULL DEFAULT '[]',
    estado           TEXT NOT NULL DEFAULT 'online'
                     CHECK (estado IN ('online', 'offline')),
    primeiro_anuncio TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_contato   TIMESTAMPTZ
);

-- Um cultivo numa célula. Uma célula passa por vários experimentos.
CREATE TABLE experimento (
    id_experimento SERIAL PRIMARY KEY,
    id_celula      TEXT NOT NULL REFERENCES celula,
    nome           TEXT NOT NULL,
    organismo      TEXT,
    inicio         TIMESTAMPTZ NOT NULL DEFAULT now(),
    fim            TIMESTAMPTZ
);

-- Curva de calibração da densidade óptica: od = a * od_bruto + b.
-- Cada nova calibração é uma nova versão, e só uma fica ativa por célula.
CREATE TABLE calibracao (
    id_calibracao SERIAL PRIMARY KEY,
    id_celula     TEXT NOT NULL REFERENCES celula,
    versao        INTEGER NOT NULL,
    a             DOUBLE PRECISION NOT NULL,
    b             DOUBLE PRECISION NOT NULL,
    ativa         BOOLEAN NOT NULL DEFAULT true,
    criada_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (id_celula, versao)
);
CREATE UNIQUE INDEX calibracao_uma_ativa ON calibracao (id_celula) WHERE ativa;

-- Medições. A chave (id_celula, seq) garante que uma leitura repetida,
-- seja por reenvio depois de uma queda ou pela entrega "ao menos uma vez"
-- do MQTT, nunca entre duas vezes no histórico.
CREATE TABLE leitura (
    id_celula     TEXT NOT NULL REFERENCES celula,
    seq           BIGINT NOT NULL,
    ts_origem     TIMESTAMPTZ NOT NULL,
    ts_recebido   TIMESTAMPTZ NOT NULL DEFAULT now(),
    temperatura_c DOUBLE PRECISION,
    od_bruto      DOUBLE PRECISION,
    od            DOUBLE PRECISION,
    ph            DOUBLE PRECISION,
    id_calibracao INTEGER REFERENCES calibracao,
    PRIMARY KEY (id_celula, seq)
);
CREATE INDEX leitura_por_tempo ON leitura (id_celula, ts_origem);

-- Pedido de mudança de temperatura e seu andamento.
-- solicitado -> recebido -> aplicado -> atingido, ou recusado.
CREATE TABLE pedido_setpoint (
    id_pedido      TEXT PRIMARY KEY,
    id_celula      TEXT NOT NULL REFERENCES celula,
    temperatura_c  DOUBLE PRECISION NOT NULL,
    estado         TEXT NOT NULL DEFAULT 'solicitado'
                   CHECK (estado IN ('solicitado', 'recebido', 'aplicado', 'atingido', 'recusado')),
    motivo         TEXT,
    solicitado_por TEXT NOT NULL DEFAULT 'anonimo',
    solicitado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    recebido_em    TIMESTAMPTZ,
    aplicado_em    TIMESTAMPTZ,
    atingido_em    TIMESTAMPTZ
);
CREATE INDEX pedido_por_celula ON pedido_setpoint (id_celula, solicitado_em DESC);

-- Alertas abertos pelas regras. Só pode existir um alerta aberto
-- do mesmo tipo para a mesma célula.
CREATE TABLE alerta (
    id_alerta  SERIAL PRIMARY KEY,
    id_celula  TEXT NOT NULL REFERENCES celula,
    tipo       TEXT NOT NULL
               CHECK (tipo IN ('sem_comunicacao', 'setpoint_sem_confirmacao', 'desvio_temperatura')),
    mensagem   TEXT NOT NULL,
    aberto_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    fechado_em TIMESTAMPTZ
);
CREATE UNIQUE INDEX alerta_um_aberto ON alerta (id_celula, tipo) WHERE fechado_em IS NULL;
