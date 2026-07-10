import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getEmployeeDetail } from "@/lib/employee-detail.functions";
import { upsertAlias, deleteAlias } from "@/lib/employees.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { centsToMoney } from "@/lib/calc/money";
import { formatMonthPtBR } from "@/lib/calc/date";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/colaboradores/$id")({
  component: EmployeeDetail,
});

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
    onSuccess: () => { setNewAlias(""); qc.invalidateQueries({ queryKey: ["employee-detail", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const delMut = useMutation({
    mutationFn: (aliasId: string) => rmAlias({ data: { id: aliasId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["employee-detail", id] }),
  });

  if (isLoading || !data) return <p className="text-muted-foreground">Carregando...</p>;

  const { employee, aliases, monthly_usages, installment_plans, installment_items, ledger } = data;
  const futureBalance = installment_items
    .filter((i: any) => i.due_month >= new Date().toISOString().slice(0, 7) + "-01")
    .reduce((s: number, i: any) => s + (i.scheduled_amount_cents ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{employee.full_name}</h1>
        <p className="text-sm text-muted-foreground">
          {employee.payroll_code ? `Cód. ${employee.payroll_code} · ` : ""}
          {employee.section_name ?? ""}{" "}
          <Badge variant={employee.status === "active" ? "default" : "secondary"} className="ml-2">
            {employee.status === "active" ? "Ativo" : "Inativo"}
          </Badge>
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-normal">Saldo futuro projetado</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{centsToMoney(futureBalance)}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-normal">Planos ativos</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{installment_plans.filter((p:any)=>p.status==='active').length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-normal">Aliases cadastrados</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-semibold">{aliases.length}</div></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Aliases de nome</CardTitle></CardHeader>
        <CardContent>
          <div className="flex gap-2 mb-3">
            <Input placeholder="Nome alternativo" value={newAlias} onChange={(e) => setNewAlias(e.target.value)} />
            <Button onClick={() => addMut.mutate()} disabled={!newAlias || addMut.isPending}>Adicionar</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {aliases.length === 0 && <p className="text-sm text-muted-foreground">Nenhum alias.</p>}
            {aliases.map((a: any) => (
              <Badge key={a.id} variant="outline" className="gap-1">
                {a.alias_name}
                <button onClick={() => delMut.mutate(a.id)} className="hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Ledger mensal</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right">Parcelas previstas</TableHead>
              <TableHead className="text-right">Carryover in</TableHead>
              <TableHead className="text-right">Bruto</TableHead>
              <TableHead className="text-right">A descontar</TableHead>
              <TableHead className="text-right">Carryover out</TableHead>
              <TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {ledger.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Sem ledger</TableCell></TableRow>}
              {ledger.map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell>{formatMonthPtBR(r.payroll_month)}</TableCell>
                  <TableCell className="text-right">{centsToMoney(r.scheduled_amount_cents)}</TableCell>
                  <TableCell className="text-right">{centsToMoney(r.carryover_in_cents)}</TableCell>
                  <TableCell className="text-right">{centsToMoney(r.gross_due_cents)}</TableCell>
                  <TableCell className="text-right font-semibold">{centsToMoney(r.amount_to_deduct_cents)}</TableCell>
                  <TableCell className="text-right">{centsToMoney(r.carryover_out_cents)}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === "projected" ? "outline" : "default"}>
                      {r.status === "projected" ? "Projetado" : r.status === "closed" ? "Fechado" : "Exportado"}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Lançamentos (competências)</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Competência</TableHead><TableHead>Origem</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Obs.</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {monthly_usages.length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum lançamento</TableCell></TableRow>}
              {monthly_usages.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell>{formatMonthPtBR(u.competence_month)}</TableCell>
                  <TableCell><Badge variant="secondary">{u.source_type}</Badge></TableCell>
                  <TableCell className="text-right">{centsToMoney(u.amount_cents)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.notes ?? ""}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Planos de parcelamento</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {installment_plans.length === 0 && <p className="text-muted-foreground text-sm">Nenhum plano.</p>}
          {installment_plans.map((p: any) => {
            const items = installment_items.filter((i: any) => i.installment_plan_id === p.id);
            return (
              <div key={p.id} className="border rounded-md p-3">
                <div className="flex justify-between mb-2">
                  <div>
                    <Badge className="mr-2">{p.source_type}</Badge>
                    <span className="text-sm">{p.installment_count}x · início {formatMonthPtBR(p.first_due_month)}</span>
                  </div>
                  <span className="font-semibold">{centsToMoney(p.total_amount_cents)}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                  {items.map((it: any) => (
                    <div key={it.id} className="border rounded px-2 py-1">
                      <span className="text-muted-foreground">#{it.installment_number} {formatMonthPtBR(it.due_month)}</span>
                      <div className="font-medium">{centsToMoney(it.scheduled_amount_cents)}</div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
