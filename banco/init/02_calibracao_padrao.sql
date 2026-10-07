-- Calibração padrão aplicada a toda célula nova.
-- Os coeficientes correspondem ao sensor simulado (od_bruto = 2000 * od + 100).
-- Com as placas reais, cada célula precisa da sua própria curva,
-- cadastrada pela API em POST /celulas/{id}/calibracoes.

CREATE TABLE calibracao_padrao (
    unica BOOLEAN PRIMARY KEY DEFAULT true CHECK (unica),
    a     DOUBLE PRECISION NOT NULL,
    b     DOUBLE PRECISION NOT NULL
);

INSERT INTO calibracao_padrao (a, b) VALUES (0.0005, -0.05);
