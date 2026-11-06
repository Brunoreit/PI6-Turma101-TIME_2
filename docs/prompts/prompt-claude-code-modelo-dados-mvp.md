Você vai implementar o MVP do modelo de dados do T.U.P.A (eVOLVER). A referência técnica é `docs/especificacao-modelo-dados-mvp.md`. Este prompt diz **como** trabalhar; **o que** fazer está só na especificação. Não acrescente escopo que não esteja nela.

## 1. Leia antes de tudo

1. `CLAUDE.md` (regras invioláveis e convenções; valem acima de qualquer sugestão sua).
2. `docs/especificacao-modelo-dados-mvp.md` inteiro, principalmente as seções F (etapas), H (restrições) e I (pendências).
3. `README.md` e `docs/contrato-mqtt.md`.

## 2. Etapa 0: análise, sem alterar nenhum arquivo

Faça a etapa 0 da seção F:

- Confira contra o código atual cada item marcado como [existe] e [muda] nas seções B.2, D.1 e E.4. A especificação foi escrita sobre o commit `fdaf1b3` da `develop`. Diga em qual commit você está.
- Confirme também os pontos que a especificação pede para conferir: o nome `alerta_tipo_check`, as linhas do bloco `experimento` no `01_tabelas.sql`, todos os usos de `gravar_leitura`, as etapas do ponta a ponta afetadas pela colisão de `seq` e a disponibilidade do `btree_gist` no modo local (P-13).
- Rode os testes atuais como linha de base: `pytest tests/unidade` e, se o ambiente permitir, `pytest -m integracao`. Se não conseguir rodar algum, diga por quê.

Depois me apresente, nesta ordem:

1. **Divergências:** o que no código não bate com a especificação, além das 15 que ela já lista. Para cada uma: arquivo, o que a especificação diz, o que o código faz.
2. **Pendências que bloqueiam:** quais das pendências da seção I impedem quais etapas, com as perguntas que preciso responder. Não escolha a resposta por mim; a "proposta padrão" da especificação não é decisão.
3. **Plano:** as etapas 1 a 8 da seção F, com os arquivos de cada uma e como cada uma será validada. Se achar que alguma etapa deve ser dividida, reordenada ou que algo da especificação está errado, diga e explique. Não mude o plano por conta própria.

**Pare aqui e espere minha aprovação.**

## 3. Implementação, uma etapa por vez

Depois da aprovação, implemente **somente a etapa aprovada**. Ao terminar cada etapa:

- rode os testes de unidade e as validações que a seção F indica para aquela etapa; rode a integração completa quando a etapa tocar banco, consumidor, regras ou API;
- faça um commit local em português, só com os arquivos da etapa;
- me mande um relatório curto: o que mudou (arquivos), resultado dos testes, desvios da especificação e por quê, e o que ficou para depois;
- **pare e espere** antes da próxima etapa.

Regras durante a implementação:

- Siga a seção H. Em especial: não mexa em `simulador/` nem em `interface/` (a única exceção é o comentário citado na etapa 8, e só com meu acordo), não adicione dependências, não crie sistema de migração, não mude o comportamento das rotas existentes e não implemente nada da lista "Fora" da seção A.4.
- Etapas ou rotas bloqueadas por pendência sem resposta (a coluna "Bloqueia" da seção I) não são implementadas, nem com a proposta padrão. Siga com o resto e registre o que ficou de fora.
- Se um teste existente falhar e você não souber se a especificação ou o teste está certo, pare e pergunte. Não altere o que um teste verifica para fazê-lo passar, exceto nas mudanças que a especificação prevê (seção E.9 e G.1).
- Se encontrar algo que a especificação não cobre, pergunte em vez de decidir.
- Não faça push, não abra PR e não altere branches remotos sem eu pedir.

## 4. Relatório final

Quando a última etapa liberada terminar, entregue:

1. As etapas feitas, com os commits.
2. O resultado completo dos testes (unidade e integração), comparado com a linha de base.
3. Os critérios de aceitação da seção G, um a um: atendido, não atendido ou bloqueado (e por qual pendência).
4. Os desvios em relação à especificação.
5. As pendências que continuam abertas e o que cada uma ainda impede.
6. Os trechos da especificação que precisam ser atualizados para refletir o que foi feito.
