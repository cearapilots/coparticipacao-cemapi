import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getDashboard } from "@/lib/dashboard.functions";
import { getMyRoles } from "@/lib/settings.functions";
import { generateEmployeeStatementPdf } from "@/lib/employee-statements.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { centsToMoney } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FileDown, AlertTriangle, LayoutDashboard, Wallet, TrendingUp, Users2, AlertOctagon } from "lucide-react";
import { Loading } from "@/components/ui/spinner";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

function Dashboard() {
  const [month, setMonth] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const fetchDashboard = useServerFn(getDashboard);
  const fetchRoles = useServerFn(getMyRoles);
  const generateStatement = useServerFn(generateEmployeeStatementPdf);
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", month],
    queryFn: () => fetchDashboard({ data: { month: toMonthISO(month) } }),
  });
  const { data: myRoles = [] } = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles() });
  const isAdminOrRh = myRoles.includes("admin") || myRoles.includes("rh");

  const exportMut = useMutation({
    mutationFn: (employeeId: string) =>
      generateStatement({ data: { employee_id: employeeId, reference_month: data!.month } }),
    onSuccess: (r) => {
      window.open(r.download_url, "_blank");
      toast.success(`PDF gerado: ${r.file_name}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Mês de desconto: ${data ? formatMonthPtBR(data.month) : ""}`}
        actions={
          <div>
            <Label className="text-xs">Mês</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-40" />
          </div>
        }
      />

      {isLoading || !data ? (
        <Loading />
      ) : (
        <>
          {isAdminOrRh && data.pending_batches.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>
                {data.pending_batches.length} lote(s) de importação aguardando revisão
              </AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                <span>
                  {data.pending_batches.slice(0, 3).map((b: any) => b.source_file_name).join(", ")}
                  {data.pending_batches.length > 3 ? "…" : ""}
                </span>
                <Button asChild size="sm" variant="outline">
                  <Link to="/importacoes">Revisar agora</Link>
                </Button>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard label="Valor novo lançado (competência)" value={centsToMoney(data.total_new_cents)} icon={LayoutDashboard} />
            <StatCard label="Previsto para desconto no mês" value={centsToMoney(data.total_deduct_cents)} icon={Wallet} accent="primary" />
            <StatCard label="Remanejado para meses futuros" value={centsToMoney(data.total_carryover_out_cents)} icon={TrendingUp} />
            <StatCard label="Colaboradores com desconto" value={String(data.employees_with_deduct)} icon={Users2} />
            <StatCard label="Atingiram o teto (R$ 700)" value={String(data.employees_capped)} icon={AlertOctagon} accent={data.employees_capped > 0 ? "warning" : undefined} />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap gap-2 justify-between items-center">
                <div>
                  <CardTitle className="text-base">Resumo de descontos do mês</CardTitle>
                  <CardDescription>
                    Colaboradores com valor a descontar em {formatMonthPtBR(data.month)} — conferência rápida antes do fechamento.
                  </CardDescription>
                </div>
                <Badge variant="secondary">
                  {data.deduct_breakdown.length} colaborador(es) · {centsToMoney(data.total_deduct_cents)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead className="text-right">Valor a descontar</TableHead>
                  {isAdminOrRh && <TableHead className="text-right">Exportar PDF</TableHead>}
                </TableRow></TableHeader>
                <TableBody>
                  {data.deduct_breakdown.length === 0 && (
                    <TableRow><TableCell colSpan={isAdminOrRh ? 3 : 2} className="text-center text-muted-foreground text-sm py-6">Nenhum colaborador com desconto neste mês</TableCell></TableRow>
                  )}
                  {data.deduct_breakdown.map((r: any) => (
                    <TableRow key={r.employee_id}>
                      <TableCell className="font-medium">
                        <Link to="/colaboradores/$id" params={{ id: r.employee_id }} className="hover:underline">{r.full_name}</Link>
                        {r.payroll_code && <span className="text-xs text-muted-foreground ml-1">({r.payroll_code})</span>}
                        {r.has_carryover && <Badge variant="outline" className="ml-2">Carryover</Badge>}
                        {r.capped && <Badge variant="destructive" className="ml-1">Atingiu teto</Badge>}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{centsToMoney(r.amount_to_deduct_cents)}</TableCell>
                      {isAdminOrRh && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={exportMut.isPending && exportMut.variables === r.employee_id}
                            onClick={() => exportMut.mutate(r.employee_id)}
                          >
                            <FileDown className="h-4 w-4 mr-1" />
                            {exportMut.isPending && exportMut.variables === r.employee_id ? "Gerando..." : "Exportar PDF"}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                {data.deduct_breakdown.length > 0 && (
                  <tfoot>
                    <TableRow>
                      <TableCell className="font-semibold">Total ({data.deduct_breakdown.length} colaborador(es))</TableCell>
                      <TableCell className="text-right font-semibold">{centsToMoney(data.total_deduct_cents)}</TableCell>
                      {isAdminOrRh && <TableCell></TableCell>}
                    </TableRow>
                  </tfoot>
                )}
              </Table>
            </CardContent>
          </Card>

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

function StatCard({ label, value, icon: Icon, accent }: {
  label: string;
  value: string;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: "primary" | "warning";
}) {
  const iconCls =
    accent === "primary" ? "text-primary"
    : accent === "warning" ? "text-destructive"
    : "text-muted-foreground";
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardDescription className="leading-tight">{label}</CardDescription>
          {Icon && <Icon className={`h-4 w-4 shrink-0 ${iconCls}`} />}
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-semibold ${accent === "warning" ? "text-destructive" : ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
