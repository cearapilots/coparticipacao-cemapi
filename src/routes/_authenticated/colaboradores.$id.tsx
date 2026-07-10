import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getEmployeeDetail } from "@/lib/employee-detail.functions";
import { upsertAlias, deleteAlias } from "@/lib/employees.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { centsToMoney } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/colaboradores/$id")({
  component: EmployeeDetail,
});

function sourceLabel(s: string) {
  return s === "manual" ? "Manual"
    : s === "opening_balance" ? "Saldo inicial"
    : s === "adjustment" ? "Ajuste"
    : s === "monthly_usage" ? "Lançamento"
    : s === "import" ? "Importação" : s;
}

function statusBadge(s: string) {
  const map: Record<string, { label: string; variant: any }> = {
    projected: { label: "Projetado", variant: "outline" },
    closed: { label: "Fechado", variant: "default" },
    exported: { label: "Exportado", variant: "default" },
    confirmed: { label: "Confirmado", variant: "secondary" },
    active: { label: "Ativo", variant: "default" },
  };
  const cfg = map[s] ?? { label: s, variant: "outline" };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function EmployeeDetail() {
  const { id } = Route.useParams();
  const fetchDetail = useServerFn(getEmployeeDetail);
  const addAlias = useServerFn(upsertAlias);
  const rmAlias = useServerFn(deleteAlias);
  const qc = useQueryClient();
  const [newAlias, setNewAlias] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["employee-detail", id],
    queryFn: () => fetchDetail({ data: { id } }),
  });

  const addMut = useMutation({
    mutationFn: () => addAlias({ data: { employee_id: id, alias_name: newAlias } }),
    onSuccess: () => { setNewAlias(""); toast.success("Alias adicionado"); qc.invalidateQueries({ queryKey: ["employee-detail", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (aliasId: string) => rmAlias({ data: { id: aliasId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employee-detail", id] }),
  });

  if (isLoading || !data) return <p className="text-muted-foreground">Carregando...</p>;

  const { employee, aliases, monthly_usages, installment_plans, installment_items, ledger } = data;
  const currentMonth = toMonthISO(new Date());
  const currentLedger = ledger.find((r: any) => toMonthISO(r.payroll_month) === currentMonth);
  const futureBalance = installment_items
    .filter((i: any) => toMonthISO(i.due_month) >= currentMonth)
    .reduce((s: number, i: any) => s + (i.scheduled_amount_cents ?? 0), 0);
  const lastUsage = monthly_usages[0];
  const lastClosed = ledger.filter((r: any) => r.status === "closed" || r.status === "exported").slice(-1)[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{employee.full_name}</h1>
        <p className="text-sm text-muted-foreground">
          {employee.payroll_code ? `Cód. ${employee.payroll_code} · ` : ""}
          {employee.registration_number ? `Matr. ${employee.registration_number} · ` : ""}
          {employee.section_name ?? ""}{" "}
          <span className="ml-2">{statusBadge(employee.status)}</span>
        </p>
      </div>

      <Tabs defaultValue="resumo">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="lancamentos">Lançamentos</TabsTrigger>
          <TabsTrigger value="parcelas">Parcelas</TabsTrigger>
          <TabsTrigger value="ledger">Ledger mensal</TabsTrigger>
          <TabsTrigger value="aliases">Aliases ({aliases.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="space-y-4 mt-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Previsto p/ desconto no mês atual" value={centsToMoney(currentLedger?.amount_to_deduct_cents ?? 0)} desc={formatMonthPtBR(currentMonth)} />
            <StatCard label="Saldo futuro projetado" value={centsToMoney(futureBalance)} desc="Soma de parcelas futuras" />
            <StatCard label="Função" value={employee.role || "—"} desc={employee.section_name || ""} />
            <StatCard label="Aliases cadastrados" value={String(aliases.length)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Último lançamento</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {lastUsage ? (
                  <>
                    <div>Competência: <b>{formatMonthPtBR(lastUsage.competence_month)}</b></div>
                    <div>Valor: <b>{centsToMoney(lastUsage.amount_cents)}</b></div>
                    <div>Origem: {sourceLabel(lastUsage.source_type)}</div>
                    {lastUsage.notes && <div className="text-muted-foreground mt-1">{lastUsage.notes}</div>}
                  </>
                ) : <span className="text-muted-foreground">Nenhum lançamento</span>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Último fechamento</CardTitle></CardHeader>
              <CardContent className="text-sm">
                {lastClosed ? (
                  <>
                    <div>Mês de desconto: <b>{formatMonthPtBR(lastClosed.payroll_month)}</b></div>
                    <div>Valor descontado: <b>{centsToMoney(lastClosed.amount_to_deduct_cents)}</b></div>
                    <div>Carryover p/ próximo mês: {centsToMoney(lastClosed.carryover_out_cents)}</div>
                    <div className="mt-1">{statusBadge(lastClosed.status)}</div>
                  </>
                ) : <span className="text-muted-foreground">Nenhum mês fechado ainda</span>}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="lancamentos" className="mt-4">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Competência</TableHead>
                <TableHead className="text-right">Valor novo</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Observação</TableHead>
                <TableHead>Criado em</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {monthly_usages.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nenhum lançamento</TableCell></TableRow>}
                {monthly_usages.map((u: any) => (
                  <TableRow key={u.id}>
                    <TableCell>{formatMonthPtBR(u.competence_month)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(u.amount_cents)}</TableCell>
                    <TableCell><Badge variant="secondary">{sourceLabel(u.source_type)}</Badge></TableCell>
                    <TableCell>{statusBadge(u.status)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{u.notes ?? ""}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(u.created_at).toLocaleDateString("pt-BR")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="parcelas" className="mt-4">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Competência</TableHead>
                <TableHead>Mês de desconto</TableHead>
                <TableHead className="text-center">Parcela</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {installment_items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nenhuma parcela</TableCell></TableRow>}
                {installment_items.map((it: any) => {
                  const plan = installment_plans.find((p: any) => p.id === it.installment_plan_id);
                  return (
                    <TableRow key={it.id}>
                      <TableCell>{it.competence_month ? formatMonthPtBR(it.competence_month) : "—"}</TableCell>
                      <TableCell className="font-medium">{formatMonthPtBR(it.due_month)}</TableCell>
                      <TableCell className="text-center">{it.installment_number}/{it.installment_count}</TableCell>
                      <TableCell className="text-right">{centsToMoney(it.scheduled_amount_cents)}</TableCell>
                      <TableCell><Badge variant="secondary">{sourceLabel(plan?.source_type ?? "")}</Badge></TableCell>
                      <TableCell>{statusBadge(it.status)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="ledger" className="mt-4">
          <Card><CardContent className="pt-6">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Mês de desconto</TableHead>
                <TableHead className="text-right">Parcelas previstas</TableHead>
                <TableHead className="text-right">Carryover entrante</TableHead>
                <TableHead className="text-right">Bruto</TableHead>
                <TableHead className="text-right">Teto</TableHead>
                <TableHead className="text-right">A descontar</TableHead>
                <TableHead className="text-right">Carryover p/ próx.</TableHead>
                <TableHead>Status</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {ledger.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">Sem ledger</TableCell></TableRow>}
                {ledger.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{formatMonthPtBR(r.payroll_month)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(r.scheduled_amount_cents)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(r.carryover_in_cents)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(r.gross_due_cents)}</TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs">{centsToMoney(r.cap_cents)}</TableCell>
                    <TableCell className="text-right font-semibold">{centsToMoney(r.amount_to_deduct_cents)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(r.carryover_out_cents)}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="aliases" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Adicionar alias</CardTitle>
              <CardDescription>Nomes alternativos que aparecem em planilhas ou no PDF da UNIMED.</CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input placeholder="Nome alternativo" value={newAlias} onChange={(e) => setNewAlias(e.target.value)} />
              <Button onClick={() => addMut.mutate()} disabled={!newAlias || addMut.isPending}>Adicionar</Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              {aliases.length === 0 && <p className="text-sm text-muted-foreground">Nenhum alias cadastrado.</p>}
              <div className="flex flex-wrap gap-2">
                {aliases.map((a: any) => (
                  <Badge key={a.id} variant="outline" className="gap-1 text-sm py-1">
                    {a.alias_name}
                    <button onClick={() => delMut.mutate(a.id)} className="hover:text-destructive ml-1" title="Remover">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatCard({ label, value, desc }: { label: string; value: string; desc?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
        {desc && <div className="text-xs text-muted-foreground mt-1">{desc}</div>}
      </CardContent>
    </Card>
  );
}
