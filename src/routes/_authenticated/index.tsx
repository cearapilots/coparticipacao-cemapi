import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboard } from "@/lib/dashboard.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { centsToMoney } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

function Dashboard() {
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const fetchDashboard = useServerFn(getDashboard);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", month],
    queryFn: () => fetchDashboard({ data: { month: toMonthISO(month) } }),
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Visão do mês {data ? formatMonthPtBR(data.month) : ""}</p>
        </div>
        <div>
          <Label>Mês</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
        </div>
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard label="Novo lançado (competência)" value={centsToMoney(data.total_new_cents)} />
            <StatCard label="Previsto para desconto" value={centsToMoney(data.total_deduct_cents)} />
            <StatCard label="Remanejado p/ mês seguinte" value={centsToMoney(data.total_carryover_out_cents)} />
            <StatCard label="Colaboradores c/ desconto" value={String(data.employees_with_deduct)} />
            <StatCard label="Atingiram o teto" value={String(data.employees_capped)} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Últimos lançamentos</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Colaborador</TableHead><TableHead>Competência</TableHead><TableHead className="text-right">Valor</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.recent_usages.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm">Sem lançamentos</TableCell></TableRow>
                    )}
                    {data.recent_usages.map((u: any) => (
                      <TableRow key={u.id}>
                        <TableCell>{u.employees?.full_name}</TableCell>
                        <TableCell>{formatMonthPtBR(u.competence_month)}</TableCell>
                        <TableCell className="text-right">{centsToMoney(u.amount_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Últimos fechamentos</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Mês</TableHead><TableHead>Colab.</TableHead><TableHead className="text-right">Total</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {data.recent_exports.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground text-sm">Nenhum fechamento</TableCell></TableRow>
                    )}
                    {data.recent_exports.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell>{formatMonthPtBR(e.payroll_month)}</TableCell>
                        <TableCell>{e.total_employees}</TableCell>
                        <TableCell className="text-right">{centsToMoney(e.total_amount_cents ?? 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardDescription>{label}</CardDescription></CardHeader>
      <CardContent><div className="text-2xl font-semibold">{value}</div></CardContent>
    </Card>
  );
}
