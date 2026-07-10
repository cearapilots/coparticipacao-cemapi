# Checklist de Homologação — Coparticipação UNIMED

Checklist manual para validar o sistema ponta a ponta antes de cada release.
Todos os itens devem ser marcados em um ambiente com pelo menos 3 usuários de
teste (admin, rh, leitura) e 2–3 colaboradores cadastrados.

## 1. Autenticação e papéis
- [ ] Login como **admin** — acessa Configurações, Colaboradores, Lançamentos, Saldo inicial, Fechamento, Importações.
- [ ] Login como **rh** — acessa todas as telas operacionais; NÃO edita papéis/configurações críticas.
- [ ] Login como **leitura** — consulta dados; NÃO consegue criar lançamentos, confirmar lote, fechar mês ou gerar XLSX.
- [ ] Logout limpa a sessão e redireciona para `/auth`.

## 2. Cadastro
- [ ] Criar colaborador novo (nome, código folha, matrícula, seção, função).
- [ ] Adicionar alias ao colaborador (ex.: apelido/variação de nome).
- [ ] Busca em Colaboradores encontra o alias criado.
- [ ] Inativar e reativar colaborador; ativos aparecem por padrão.

## 3. Lançamento manual
- [ ] Criar lançamento manual com valor > R$150 e conferir prévia de parcelamento.
- [ ] Valor até R$150 → 1 parcela; até R$250 → 2 parcelas; acima → 3 parcelas.
- [ ] Aviso visual quando prévia sinaliza teto atingido.
- [ ] Aviso visual quando competência afeta mês fechado (ajuste retroativo).

## 4. Saldo inicial
- [ ] Cadastrar saldo devedor inicial com edição manual das parcelas.
- [ ] Soma das parcelas editadas confere com total informado.

## 5. Ledger e Fechamento
- [ ] Gerar prévia de fechamento — todos os ativos aparecem, mesmo sem desconto.
- [ ] Filtros funcionam (com desconto, sem desconto, atingiu teto, com carryover).
- [ ] Diálogo “Ver composição” lista as parcelas que compõem o mês.
- [ ] Fechar mês — status vira `closed`; novo `payroll_exports` snapshot criado.
- [ ] Tentar refechar mês já fechado → mensagem de bloqueio.
- [ ] Novo lançamento com competência de mês fechado → gera adjustment no próximo mês aberto.

## 6. XLSX contábil
- [ ] Botão “Baixar XLSX (prévia)” gera arquivo antes do fechamento e NÃO altera status do ledger.
- [ ] Após fechar o mês, botão “Baixar XLSX” marca ledger como `exported` e registra `file_storage_path` em `payroll_exports`.
- [ ] Layout do XLSX: linha 1 nome da empresa, linha 3 “V”, linha 4 cabeçalhos, linha 5 código “543”, dados a partir da linha 6.
- [ ] Coluna I em BRL; vazio quando valor = 0 e `accounting_export_blank_when_zero=true`.
- [ ] Colaborador ativo sem desconto aparece com linha em branco (config default).
- [ ] Aviso quando colaborador não tem `payroll_code`.
- [ ] Tentativa de gerar XLSX “oficial” em mês NÃO fechado → mensagem clara de bloqueio.
- [ ] Login como **leitura**: botão de download NÃO gera link válido (bloqueio server-fn + policy de storage).

## 7. Importação PDF UNIMED
- [ ] Upload de PDF em Importações — extração de texto funciona no navegador; fallback de texto colado disponível.
- [ ] Novo lote criado com status `pending_review`.
- [ ] Itens `auto_matched` aparecem com badge; `needs_review` sugere colaborador; `not_found` marcado.
- [ ] Associar manualmente colaborador em item `needs_review` / `not_found`.
- [ ] Ignorar linha com justificativa; restaurar linha ignorada.
- [ ] Tentar **confirmar** lote com item pendente → bloqueado com mensagem “ainda possui X item(ns) sem associação ou revisão”.
- [ ] Conferência financeira: soma dos itens × Total Cobrado Empresa exibe diferença quando houver.
- [ ] Reimportar mesmo arquivo (mesmo hash) → aviso de duplicidade; reimportar mesma competência já confirmada → aviso; ambos exigem confirmação explícita.
- [ ] Confirmar lote com pendências resolvidas → `monthly_usage` + `installment_plans` + `installment_plan_items` criados; ledger recalculado; status do lote vira `confirmed`.
- [ ] Se confirmação falhar no meio, lote continua com status `pending_review` (não vira `confirmed` parcial).
- [ ] Cancelar lote não confirmado → status `cancelled`; tentar cancelar lote confirmado → bloqueado.

## 8. Auditoria e privacidade
- [ ] `audit_log` registra: `import.batch.create`, `import.batch.confirm`, `import.batch.cancel`, `month.close`, `payroll.xlsx.preview`, `payroll.xlsx.generate`.
- [ ] `import_items` armazena apenas nome do titular, valor, referência curta de texto — **nenhum procedimento, prestador ou dado clínico**.
- [ ] Snapshot XLSX (`payroll_export_items`) contém apenas valores agregados por colaborador.
- [ ] Buckets `unimed-pdfs` e `payroll-exports` são privados; download exige signed URL de curta duração.

## 9. Storage / policies
- [ ] Login como **leitura** → tentativa de baixar XLSX via signed URL antiga → falha (403/expira).
- [ ] Login como **leitura** → tentativa de baixar PDF UNIMED → bloqueado.
- [ ] Delete de arquivo em `unimed-pdfs` só funciona como **admin**.

## 10. Regressão
- [ ] `bun run vitest run` → 23/23 testes do motor de cálculo passam.
- [ ] `bun run build` → build limpo.
- [ ] Após rodar tudo acima, dashboard continua exibindo indicadores consistentes.
