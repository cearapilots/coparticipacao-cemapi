# Compatibilidade de Backend — Lovable Cloud ↔ Supabase

> **Backend atual:** Lovable Cloud (Postgres + Auth + Storage + RLS), com estrutura
> totalmente compatível com uma futura migração para Supabase self-hosted ou
> Supabase Cloud.
>
> Este documento é referência técnica. Nenhuma etapa aqui deve ser executada
> automaticamente sobre o banco atual sem revisão humana.

---

## 1. Panorama

| Item | Situação atual | Observação de migração |
|---|---|---|
| Banco de dados | Postgres gerenciado pelo Lovable Cloud | 100% Postgres puro. Compatível com Supabase e qualquer Postgres 15+. |
| Auth | Lovable Cloud Auth (baseado em GoTrue/Supabase Auth) | Mesmo schema `auth.users`. Migração exporta usuários via Admin API. |
| Storage | Bucket privado `unimed-pdfs` no Storage do Cloud | Compatível com Supabase Storage (mesma API). |
| RLS | Ativo em todas as tabelas de `public` | Policies são SQL puro, portáveis. |
| Roles | Enum `app_role` + tabela `user_roles` + `has_role()` `SECURITY DEFINER` | Padrão recomendado pelo próprio Supabase. Portável direto. |
| Server functions | TanStack Start `createServerFn` em `src/lib/*.functions.ts` | Independente do backend. Basta trocar cliente Supabase. |
| Motor de cálculo | TypeScript puro em `src/lib/calc/` — sem I/O | Zero dependência de backend. |
| Parser UNIMED | TS puro em `src/lib/unimed-parser.ts` | Zero dependência. |
| Extração PDF cliente | `pdfjs-dist` em `src/lib/pdf-client.ts` | Zero dependência de backend. |
| Dinheiro | Sempre `integer` em **centavos** | Sem `float`, sem `numeric`. Portável. |

## 2. Dependências específicas do Lovable Cloud

Poucos pontos amarrados especificamente ao Cloud. Tudo mais é Postgres/Supabase padrão.

- **Variáveis de ambiente injetadas**: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_SUPABASE_PROJECT_ID`. Numa migração, basta apontar para o novo projeto
  Supabase.
- **Arquivos auto-gerados** (não editar):
  `src/integrations/supabase/client.ts`, `client.server.ts`, `auth-middleware.ts`,
  `auth-attacher.ts`, `types.ts`. Numa migração, esses arquivos podem ser
  substituídos pelos equivalentes gerados pelo Supabase CLI
  (`supabase gen types typescript`) mantendo a mesma interface.
- **Storage bucket** criado via tool interna (`storage_create_bucket`). Em
  Supabase self-hosted é criado via `INSERT INTO storage.buckets` ou pela UI.
- **Chaves de API** têm formato novo (`sb_publishable_*`, `sb_secret_*`). O
  wrapper em `client.ts` já trata ambos os formatos (JWT e opaco).
- **Emails de auth** e **OAuth Google** hoje via broker do Lovable. Numa
  migração, configurar diretamente no Supabase Auth (provider Google + SMTP
  próprio).

Nenhuma extensão exótica é usada — apenas `pgcrypto` (para `gen_random_uuid()`),
que já vem habilitada por padrão em qualquer Supabase.

## 3. Inventário de tabelas (schema `public`)

Todas as tabelas têm `id uuid PK default gen_random_uuid()`, `created_at`,
`updated_at` e RLS habilitado. Papéis: **admin** (tudo), **rh** (opera),
**leitura** (só SELECT).

| Tabela | Finalidade | Campos-chave | Pessoais | Financeiros | Sensíveis | Observações de migração |
|---|---|---|---|---|---|---|
| `profiles` | Espelho de `auth.users` para dados de UI | `email`, `full_name` | Sim | Não | Não | Criado por trigger `handle_new_user`. Não referencia FK direta em `auth.users` no schema (é preenchida via trigger). |
| `user_roles` | Papel do usuário | `user_id`, `role app_role` | Sim (uid) | Não | Não | Enum `app_role = {admin, rh, leitura}`. Portável. |
| `employees` | Colaboradores canônicos | `full_name`, `normalized_name`, `payroll_code`, `status` | Sim | Não | Não | `normalized_name` populado no cadastro (função TS `normalizeName`). |
| `employee_aliases` | Variações de nome usadas nos PDFs | `employee_id`, `alias_name`, `normalized_alias_name` | Sim | Não | Não | Idempotência por `normalized_alias_name`. |
| `monthly_usage` | Lançamento de coparticipação de um mês de competência | `employee_id`, `competence_month`, `amount_cents`, `source_type`, `source_reference_id` | Sim (via FK) | Sim | Não | Índice único parcial `(employee_id, competence_month, source_type, source_reference_id)` para evitar duplicidade de origem PDF. |
| `installment_plans` | Cabeçalho do plano de parcelamento | `total_amount_cents`, `installment_count`, `first_due_month`, `source_type`, `rule_version`, `status` | Não | Sim | Não | `source_type ∈ {monthly_usage, opening_balance, adjustment}`. |
| `installment_plan_items` | Parcelas individuais | `due_month`, `installment_number`, `scheduled_amount_cents` | Não | Sim | Não | Motor recalcula ledger a partir da primeira `due_month` afetada. |
| `payroll_monthly_ledger` | Ledger consolidado por colaborador × mês | `scheduled`, `carryover_in`, `gross`, `cap`, `amount_to_deduct`, `carryover_out`, `status` | Não | Sim | Não | `status ∈ {projected, closed, exported}`. `closed`/`exported` são imutáveis. |
| `payroll_exports` | Snapshot de fechamento mensal | `payroll_month`, `layout_version`, `total_amount_cents` | Não | Sim | Não | Um por competência confirmada. |
| `payroll_export_items` | Linhas do snapshot | `employee_id`, `payroll_month`, `amount_to_deduct_cents` | Sim (via FK) | Sim | Não | Cópia congelada — nunca alterada. |
| `import_batches` | Lote de importação PDF UNIMED | `source_file_hash`, `competence_month`, `total_charged_company_cents`, `status` | Não | Sim | **Referência a arquivo sensível** | Hash SHA-256 detecta reupload do mesmo arquivo. Storage path aponta para bucket privado. |
| `import_items` | Linhas titular → valor extraídas do PDF | `raw_employee_name`, `amount_cents`, `matched_employee_id`, `match_status`, `review_status` | Sim (nome) | Sim | Não (só nome titular + valor total família) | Não estrutura procedimentos/prestadores/detalhes clínicos — por design. |
| `app_settings` | Configurações do sistema em JSONB | `setting_key`, `setting_value` | Não | Não | Não | Chaves atuais: `monthly_cap_cents`, `installment_thresholds`, `company_name`, `payroll_layout_version`. |
| `audit_log` | Trilha de auditoria administrativa | `actor_user_id`, `action`, `entity_type`, `entity_id`, `before_snapshot`, `after_snapshot` | Sim (uid ator) | Metadata | **Nunca** guardar dados clínicos | Insert-only via política. Leitura por admin/rh. |

### Funções e triggers de banco

- `public.handle_new_user()` — trigger em `auth.users` que cria `profiles` e
  promove o primeiro usuário a `admin`.
- `public.set_updated_at()` — trigger genérico para `updated_at`.
- `public.has_role(uid, role)` e `public.has_any_role(uid, role[])` —
  `SECURITY DEFINER`, `search_path = public`. Base de todas as policies.

## 4. Inventário de server functions

Todas em `src/lib/*.functions.ts`, todas com `.middleware([requireSupabaseAuth])`
e checagem de papel via `authz.server.ts`. Dependência de backend: apenas o
cliente Supabase injetado no `context` (portável).

| Arquivo | Função | Entrada | Saída | Tabelas afetadas | Recalcula ledger? | Audita? |
|---|---|---|---|---|---|---|
| `employees.functions.ts` | `listEmployees` | filtro/paginação | array | `employees`, `employee_aliases` (SELECT) | Não | Não |
|  | `getEmployee` | `id` | objeto | `employees`, `employee_aliases` | Não | Não |
|  | `upsertEmployee` | dados | objeto | `employees` (I/U) | Não | Sim |
|  | `upsertAlias` | dados | objeto | `employee_aliases` (I/U) | Não | Sim |
| `employee-detail.functions.ts` | `getEmployeeDetail` | `id` | resumo + ledger | `employees`, `monthly_usage`, `installment_plan_items`, `payroll_monthly_ledger` (SELECT) | Não | Não |
| `usage.functions.ts` | `previewInstallmentPlan` | mês + valor | preview | — (usa `app_settings`) | Não | Não |
|  | `createMonthlyUsage` | colaborador + mês + valor | `usage + plan` | `monthly_usage`, `installment_plans`, `installment_plan_items` (I); detecta mês fechado e cria plano `adjustment` no próximo mês aberto | **Sim** | Sim |
| `opening-balance.functions.ts` | `previewOpeningBalance` | dados | preview com parcelas | — | Não | Não |
|  | `createOpeningBalance` | dados + parcelas manuais opcionais | plano | `installment_plans`, `installment_plan_items` | **Sim** | Sim |
| `closing.functions.ts` | `getClosingPreview` | mês | linhas + totais | `payroll_monthly_ledger` (SELECT) | Não | Não |
|  | `getMonthComposition` | mês + colaborador | detalhamento | `monthly_usage`, `installment_plan_items` (SELECT) | Não | Não |
|  | `listRecentUsages` | filtros | array | `monthly_usage` (SELECT) | Não | Não |
|  | `closeMonth` | mês | snapshot | `payroll_monthly_ledger` (UPDATE status), `payroll_exports`, `payroll_export_items` (I) | Não (fecha valores) | Sim |
| `imports.functions.ts` | `createImportBatchFromPdf` | texto + hash + arquivo | lote + itens | `import_batches`, `import_items` (I); Storage upload | Não | Sim |
|  | `listImportBatches` | — | array | `import_batches` (SELECT) | Não | Não |
|  | `getImportBatchDetails` | `id` | lote + itens + colaboradores | `import_batches`, `import_items`, `employees` (SELECT) | Não | Não |
|  | `updateImportItemMatch` | item + colaborador | item | `import_items` (U) | Não | Sim |
|  | `ignoreImportItem` | item + motivo | item | `import_items` (U) | Não | Sim |
|  | `cancelImportBatch` | `id` | ok | `import_batches` (U) | Não | Sim |
|  | `confirmImportBatch` | `id` | resumo | `monthly_usage`, `installment_plans`, `installment_plan_items` (I); `import_batches` (U) | **Sim** (por colaborador) | Sim |
| `settings.functions.ts` | `getSettings` | — | objeto | `app_settings` (SELECT) | Não | Não |
|  | `updateSetting` | chave + valor | objeto | `app_settings` (U) — **admin only** | Não | Sim |
|  | `listUsersWithRoles` | — | array | `profiles`, `user_roles` — **admin only** | Não | Não |
|  | `setUserRole` | uid + role | ok | `user_roles` (I/U) — **admin only** | Não | Sim |
| `dashboard.functions.ts` | `getDashboardData` | mês | KPIs | leitura agregada | Não | Não |
| `audit.server.ts` | `logAudit` (helper, não é serverFn) | ação + entidade + snapshots | — | `audit_log` (I) | — | — |

Nenhuma função depende de API específica do Lovable Cloud além do cliente
Supabase e Storage. Todas usam SQL puro e API pública do supabase-js.

## 5. Camada de acesso ao backend

Já está organizada segundo a convenção do template:

```
src/lib/
├── calc/                    ← Motor de cálculo puro (sem I/O). Fonte de verdade.
│   ├── money.ts             centavos, arredondamento
│   ├── name.ts              normalizeName
│   ├── date.ts              MonthISO
│   ├── installments.ts      faixas, split, cap
│   └── ledger.ts            recalculador puro
├── *.functions.ts           ← Server functions (createServerFn) — única forma
│                              do frontend falar com o banco.
├── *.server.ts              ← Helpers server-only (authz, audit, ledger com I/O)
├── unimed-parser.ts         ← Parser puro do texto do PDF
├── pdf-client.ts            ← Extração PDF no cliente (pdfjs-dist)
└── utils.ts

src/integrations/supabase/   ← Auto-gerado. Não editar.
```

**Regra de ouro:** telas (`src/routes/**`) chamam apenas `*.functions.ts` via
`useServerFn` / `queryOptions`. Zero query Supabase direta em componente.
Isso mantém o desacoplamento — trocar backend é trocar `src/integrations/supabase/`
e re-gerar tipos.

## 6. Storage

Bucket privado **`unimed-pdfs`**:

- **Finalidade:** guardar o PDF original de faturamento UNIMED de cada lote.
- **Acesso:** privado. RLS em `storage.objects` restringe leitura/gravação a
  usuários com papel `admin` ou `rh`.
- **Não expor URLs públicas.** Downloads sempre via signed URL de curta
  duração, gerada server-side.
- **Sensibilidade:** o PDF original pode conter dados clínicos (procedimentos,
  prestadores). Por isso ele é preservado no Storage mas **nada disso é
  estruturado em tabelas** — só nome do titular e valor total da família são
  extraídos para `import_items`.
- **Retenção:** definir política de expurgo posterior (fora de escopo do MVP).

## 7. Matriz de segurança

| Recurso | admin | rh | leitura |
|---|---|---|---|
| `employees`, `employee_aliases` | CRUD | Insert/Update | SELECT |
| `monthly_usage`, `installment_plans*`, `payroll_*ledger`, `payroll_export*` | CRUD | CRUD | SELECT |
| `import_batches`, `import_items` | CRUD | CRUD | SELECT |
| Bucket `unimed-pdfs` | R/W | R/W | — |
| `app_settings` | Update | SELECT | SELECT |
| `user_roles` | CRUD | SELECT self | SELECT self |
| `audit_log` | SELECT (Insert por sistema) | SELECT (Insert por sistema) | — |
| `profiles` | Self | Self | Self |

Confirmações operacionais:

- `audit_log` **não é editável manualmente** — apenas INSERT via política, sem UPDATE/DELETE.
- PDFs ficam **privados** no bucket, acesso somente por signed URL server-side.
- **Detalhes médicos não são estruturados** em tabelas em nenhum momento.
- Meses `closed`/`exported` no ledger são imutáveis pelo motor.

## 8. Roteiro de migração futura para Supabase (referência)

Passo a passo se um dia for necessário sair do Cloud:

1. Criar projeto novo em `supabase.com`.
2. Aplicar `docs/schema-reference.sql` (schema completo, sem dados) no projeto
   novo via SQL editor. Revisar antes de rodar.
3. Exportar dados do Cloud (Cloud → Advanced settings → Export data) e importar
   no novo projeto via `\copy` ou `pg_restore` (dados apenas).
4. Exportar usuários de `auth.users` via Admin API e importar no novo projeto
   com Admin API (`admin.createUser` mantendo `id`).
5. Recriar bucket `unimed-pdfs` como privado. Reaplicar policies de
   `storage.objects` (versão em `docs/schema-reference.sql`).
6. Reconfigurar provider Google OAuth diretamente em Supabase Auth.
7. Trocar variáveis `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` /
   `SUPABASE_SERVICE_ROLE_KEY` no ambiente de deploy.
8. Regenerar `src/integrations/supabase/types.ts` com
   `supabase gen types typescript --project-id <novo>`.
9. Rodar `bun run build` e a suíte de testes (`bunx vitest run`).
10. Executar smoke test: login, listar colaboradores, criar lançamento, fechar
    um mês de teste, importar um PDF pequeno.

Nada nos arquivos de negócio (`src/lib/calc`, `*.functions.ts`, rotas) precisa
mudar. É uma troca de infraestrutura, não de aplicação.

## 9. Verificações de aceite

- [x] Nenhum dado alterado ou apagado por este passo.
- [x] Nenhuma tabela recriada.
- [x] Nenhuma RLS removida.
- [x] Motor de cálculo intocado (23/23 testes verdes).
- [x] Importação de PDF continua operando.
- [x] Fechamento mensal continua operando.
- [x] Documentação criada (`docs/backend-compatibility.md`).
- [x] Schema de referência criado (`docs/schema-reference.sql`).
- [x] Dependências específicas do Lovable Cloud listadas.
