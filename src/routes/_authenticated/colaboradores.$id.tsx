import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getEmployeeDetail } from "@/lib/employee-detail.functions";
import { upsertAlias, deleteAlias } from "@/lib/employees.functions";
import { getMyRoles } from "@/lib/settings.functions";
import {
  generateEmployeeStatementPdf,
  getEmployeeStatementDownloadUrl,
  listEmployeeStatementExports,
  deleteEmployeeStatementExport,
} from "@/lib/employee-statements.functions";
import { previewRenegotiation, renegotiateInstallments } from "@/lib/renegotiation.functions";
import { listMonthlyCapOverrides, setMonthlyCapOverride, removeMonthlyCapOverride } from "@/lib/monthly-cap.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { centsToMoney, moneyToCents } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useMemo, useState } from "react";
import { Trash2, FileDown, Download, Info } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/colaboradores/$id")({
  component: EmployeeDetail,
});

function sourceLabel(s: string) {
  return s === "manual" ? "Manual"
    : s === "opening_balance" ? "Saldo inicial"
    : s === "adjustment" ? "Ajuste"
    : s === "monthly_usage" ? "Lançamento"
    : s === "renegotiation" ? "Re-parcelamento"
    : s === "import" ? "Importação" : s;
}

function statusBadge(s: string) {
  const map: Record<string, { label: string; variant: any }> = {
    projected: { label: "Projetado", variant: "outline" },
    closed: { label: "Fechado", variant: "default" },
    exported: { label: "Exportado", variant: "default" },
    confirmed: { label: "Confirmado", variant: "secondary" },
    active: { label: "Ativo", variant: "default" },
    superseded: { label: "Substituída", variant: "outline" },
  };
  const cfg = map[s] ?? { label: s, variant: "outline" };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function EmployeeDetail() {
  const { id } = Route.useParams();
  const fetchDetail = useServerFn(getEmployeeDetail);
  const addAlias = useServerFn(upsertAlias);
  const rmAlias = useServerFn(deleteAlias);
  const fetchRoles = useServerFn(getMyRoles);
  const fetchStatementExports = useServerFn(listEmployeeStatementExports);
  const generateStatement = useServerFn(generateEmployeeStatementPdf);
  const getStatementUrl = useServerFn(getEmployeeStatementDownloadUrl);
  const deleteStatement = useServerFn(deleteEmployeeStatementExport);
  const previewReneg = useServerFn(previewRenegotiation);
  const doReneg = useServerFn(renegotiateInstallments);
  const fetchCapOverrides = useServerFn(listMonthlyCapOverrides);
  const setCapFn = useServerFn(setMonthlyCapOverride);
  const removeCapFn = useServerFn(removeMonthlyCapOverride);
  const qc = useQueryClient();
  const [newAlias, setNewAlias] = useState("");
  const [pdfOpen, setPdfOpen] = useState(false);
  const [pdfMonth, setPdfMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [lastResult, setLastResult] = useState<{ download_url: string; file_name: string } | null>(null);
  const [renegOpen, setRenegOpen] = useState(false);
  const [renegCount, setRenegCount] = useState(3);
  const [renegReason, setRenegReason] = useState("");
  const [capMonth, setCapMonth] = useState<string | null>(null); // payroll_month ISO do mês em edição
  const [capDraft, setCapDraft] = useState("");
  const [capReason, setCapReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["employee-detail", id],
    queryFn: () => fetchDetail({ data: { id } }),
  });
  const { data: myRoles = [] } = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles() });
  const isAdmin = myRoles.includes("admin");
  const isAdminOrRh = isAdmin || myRoles.includes("rh");

  const { data: statementExports = [] } = useQuery({
    queryKey: ["statement-exports", id],
    queryFn: () => fetchStatementExports({ data: { employee_id: id } }),
    enabled: isAdminOrRh,
  });

  const { data: capOverrides = [] } = useQuery({
    queryKey: ["cap-overrides", id],
    queryFn: () => fetchCapOverrides({ data: { employee_id: id } }),
  });
  const capByMonth = new Map<string, number>(
    (capOverrides as any[]).map((o) => [toMonthISO(o.payroll_month), o.cap_cents]),
  );

  const setCapMut = useMutation({
    mutationFn: (v: { payroll_month: string; cap_cents: number; reason: string }) =>
      setCapFn({ data: { employee_id: id, ...v } }),
    onSuccess: () => {
      toast.success("Teto do mês atualizado.");
      setCapMonth(null);
      qc.invalidateQueries({ queryKey: ["employee-detail", id] });
      qc.invalidateQueries({ queryKey: ["cap-overrides", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeCapMut = useMutation({
    mutationFn: (v: { payroll_month: string; reason: string }) =>
      removeCapFn({ data: { employee_id: id, ...v } }),
    onSuccess: () => {
      toast.success("Teto personalizado removido.");
      setCapMonth(null);
      qc.invalidateQueries({ queryKey: ["employee-detail", id] });
      qc.invalidateQueries({ queryKey: ["cap-overrides", id] });
    },
    onError: (e: Error) => toast.error(e.message),
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

  const generateMut = useMutation({
    mutationFn: () => generateStatement({ data: { employee_id: id, reference_month: toMonthISO(pdfMonth) } }),
    onSuccess: (r) => {
      setLastResult({ download_url: r.download_url, file_name: r.file_name });
      toast.success(r.has_open_balance ? "PDF gerado com sucesso." : "PDF gerado (colaborador sem saldo em aberto).");
      qc.invalidateQueries({ queryKey: ["statement-exports", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadMut = useMutation({
    mutationFn: (exportId: string) => getStatementUrl({ data: { export_id: exportId } }),
    onSuccess: (r) => window.open(r.download_url, "_blank"),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteStatementMut = useMutation({
    mutationFn: (exportId: string) => deleteStatement({ data: { export_id: exportId } }),
    onSuccess: () => { toast.success("Demonstrativo apagado."); qc.invalidateQueries({ queryKey: ["statement-exports", id] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const renegPreviewQuery = useQuery({
    queryKey: ["reneg-preview", id, renegCount, renegOpen],
    queryFn: () => previewReneg({ data: { employee_id: id, installment_count: renegCount } }),
    enabled: renegOpen && isAdminOrRh && renegCount >= 1,
  });

  const renegMut = useMutation({
    mutationFn: () => doReneg({ data: { employee_id: id, installment_count: renegCount, reason: renegReason.trim() } }),
    onSuccess: (r) => {
      toast.success(`Saldo re-parcelado em ${r.installment_count}x a partir de ${formatMonthPtBR(r.first_due_month)}.`);
      setRenegOpen(false);
      setRenegReason("");
      qc.invalidateQueries({ queryKey: ["employee-detail", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pdfPreview = useMemo(() => {
    if (!data) return null;
    const refMonth = toMonthISO(pdfMonth);
    const futureItems = data.installment_items.filter((i: any) => toMonthISO(i.due_month) >= refMonth);
    const totalCents = futureItems.reduce((s: number, i: any) => s + (i.scheduled_amount_cents ?? 0), 0);
    const monthsCount = new Set(futureItems.map((i: any) => toMonthISO(i.due_month))).size;
    const ledgerRow = data.ledger.find((r: any) => toMonthISO(r.payroll_month) === refMonth);
    return {
      total_cents: totalCents,
      months_count: monthsCount,
      scheduled_for_month_cents: ledgerRow?.amount_to_deduct_cents ?? 0,
      has_open_balance: totalCents > 0,
    };
  }, [data, pdfMonth]);

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
          {isAdmin && <TabsTrigger value="aliases">Aliases ({aliases.length})</TabsTrigger>}
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

          {isAdminOrRh && (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap gap-3 justify-between items-center">
                  <div>
                    <CardTitle className="text-base">Demonstrativo individual</CardTitle>
                    <CardDescription>PDF financeiro para enviar ao colaborador.</CardDescription>
                  </div>
                  <Button onClick={() => { setLastResult(null); setPdfOpen(true); }}>
                    <FileDown className="h-4 w-4 mr-2" />Exportar PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="text-sm">
                {statementExports.length === 0 ? (
                  <span className="text-muted-foreground">Nenhum demonstrativo gerado ainda.</span>
                ) : (
                  <div className="space-y-1">
                    {statementExports.map((exp: any) => (
                      <div key={exp.id} className="flex items-center justify-between border-b last:border-b-0 py-1.5">
                        <div>
                          Gerado em <b>{new Date(exp.generated_at).toLocaleString("pt-BR")}</b>
                          {" "}— referência {formatMonthPtBR(toMonthISO(exp.reference_month))}
                        </div>
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={downloadMut.isPending}
                            onClick={() => downloadMut.mutate(exp.id)}
                          >
                            <Download className="h-4 w-4 mr-1" />Baixar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            disabled={deleteStatementMut.isPending}
                            onClick={() => {
                              if (confirm("Apagar este demonstrativo? O PDF será removido permanentemente.")) {
                                deleteStatementMut.mutate(exp.id);
                              }
                            }}
                            title="Apagar demonstrativo"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
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
          <Card>
            {isAdminOrRh && (
              <CardHeader>
                <div className="flex flex-wrap gap-3 justify-between items-center">
                  <div>
                    <CardTitle className="text-base">Parcelas</CardTitle>
                    <CardDescription>Re-parcelar redistribui o saldo restante (meses abertos) em outro número de parcelas.</CardDescription>
                  </div>
                  <Button variant="outline" onClick={() => { setRenegReason(""); setRenegOpen(true); }}>
                    Re-parcelar saldo
                  </Button>
                </div>
              </CardHeader>
            )}
            <CardContent className="pt-6">
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
                  const superseded = it.status === "superseded";
                  return (
                    <TableRow key={it.id} className={superseded ? "opacity-50" : ""}>
                      <TableCell>{it.competence_month ? formatMonthPtBR(it.competence_month) : "—"}</TableCell>
                      <TableCell className="font-medium">{formatMonthPtBR(it.due_month)}</TableCell>
                      <TableCell className="text-center">{it.installment_number}/{it.installment_count}</TableCell>
                      <TableCell className={`text-right ${superseded ? "line-through" : ""}`}>{centsToMoney(it.scheduled_amount_cents)}</TableCell>
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
          <Card>
            {isAdminOrRh && (
              <CardHeader>
                <CardTitle className="text-base">Ledger mensal</CardTitle>
                <CardDescription>
                  Em meses abertos você pode ajustar o teto de desconto do mês. A diferença é
                  remanejada para os meses seguintes, respeitando o teto de cada mês.
                </CardDescription>
              </CardHeader>
            )}
            <CardContent className="pt-6">
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
                {isAdminOrRh && <TableHead></TableHead>}
              </TableRow></TableHeader>
              <TableBody>
                {ledger.length === 0 && <TableRow><TableCell colSpan={isAdminOrRh ? 9 : 8} className="text-center text-muted-foreground py-6">Sem ledger</TableCell></TableRow>}
                {ledger.map((r: any) => {
                  const rMonth = toMonthISO(r.payroll_month);
                  const hasOverride = capByMonth.has(rMonth);
                  const isOpen = r.status === "projected";
                  return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{formatMonthPtBR(r.payroll_month)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(r.scheduled_amount_cents)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(r.carryover_in_cents)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(r.gross_due_cents)}</TableCell>
                    <TableCell className="text-right text-xs">
                      <span className={hasOverride ? "font-semibold" : "text-muted-foreground"}>{centsToMoney(r.cap_cents)}</span>
                      {hasOverride && <Badge variant="secondary" className="ml-1 text-[10px]">ajustado</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{centsToMoney(r.amount_to_deduct_cents)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(r.carryover_out_cents)}</TableCell>
                    <TableCell>{statusBadge(r.status)}</TableCell>
                    {isAdminOrRh && (
                      <TableCell className="text-right">
                        {isOpen && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setCapMonth(rMonth);
                              setCapDraft(centsToMoney(r.cap_cents).replace(/[^\d,]/g, ""));
                              setCapReason("");
                            }}
                          >
                            Ajustar teto
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {isAdmin && (
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
        )}
      </Tabs>

      <Dialog open={renegOpen} onOpenChange={setRenegOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-parcelar saldo — {employee.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Redistribui apenas o <b>saldo restante em meses abertos</b>. Parcelas já descontadas
                em meses fechados não são afetadas. As parcelas abertas atuais são substituídas.
              </AlertDescription>
            </Alert>

            <div className="text-sm border rounded-md p-3 bg-muted/30 space-y-1">
              <div className="flex justify-between">
                <span>Saldo em aberto a re-parcelar:</span>
                <b>{centsToMoney(renegPreviewQuery.data?.remaining_cents ?? 0)}</b>
              </div>
              {renegPreviewQuery.data && (
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>Primeira nova parcela em:</span>
                  <span>{formatMonthPtBR(renegPreviewQuery.data.first_due_month)}</span>
                </div>
              )}
            </div>

            <div>
              <Label>Número de parcelas</Label>
              <Input
                type="number"
                min={1}
                max={24}
                value={renegCount}
                onChange={(e) => setRenegCount(Math.max(1, Math.min(24, Number(e.target.value) || 1)))}
                className="w-32"
              />
            </div>

            {renegPreviewQuery.data && renegPreviewQuery.data.remaining_cents > 0 && (
              <div className="max-h-48 overflow-y-auto border rounded-md">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Parcela</TableHead>
                    <TableHead>Mês</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {renegPreviewQuery.data.items.map((it: any) => (
                      <TableRow key={it.installment_number}>
                        <TableCell>{it.installment_number}/{renegCount}</TableCell>
                        <TableCell>{formatMonthPtBR(it.due_month)}</TableCell>
                        <TableCell className="text-right">{centsToMoney(it.amount_cents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            <div>
              <Label>Justificativa (obrigatória)</Label>
              <Textarea
                value={renegReason}
                onChange={(e) => setRenegReason(e.target.value)}
                placeholder="Ex: parcelas muito altas para a renda do colaborador, acordado re-parcelamento em mais vezes."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenegOpen(false)}>Cancelar</Button>
            <Button
              onClick={() => {
                if (renegReason.trim().length < 10) { toast.error("Informe uma justificativa (mín. 10 caracteres)."); return; }
                if (!renegPreviewQuery.data || renegPreviewQuery.data.remaining_cents <= 0) { toast.error("Não há saldo em aberto para re-parcelar."); return; }
                renegMut.mutate();
              }}
              disabled={renegMut.isPending}
            >
              {renegMut.isPending ? "Re-parcelando..." : "Confirmar re-parcelamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={capMonth !== null} onOpenChange={(o) => { if (!o) setCapMonth(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajustar teto do mês{capMonth ? ` — ${formatMonthPtBR(capMonth)}` : ""}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Reduz (ou ajusta) o desconto deste mês. A diferença é remanejada para os meses
                seguintes, sempre respeitando o teto de cada mês. Use R$ 0,00 para pular o mês.
              </AlertDescription>
            </Alert>
            <div>
              <Label>Novo teto do mês (R$)</Label>
              <Input value={capDraft} onChange={(e) => setCapDraft(e.target.value)} placeholder="Ex: 400,00" className="w-48" />
            </div>
            <div>
              <Label>Justificativa (obrigatória)</Label>
              <Textarea
                value={capReason}
                onChange={(e) => setCapReason(e.target.value)}
                placeholder="Ex: colaborador solicitou reduzir o desconto deste mês; diferença remanejada."
              />
            </div>
          </div>
          <DialogFooter className="flex-wrap gap-2">
            {capMonth && capByMonth.has(capMonth) && (
              <Button
                variant="outline"
                onClick={() => {
                  if (capReason.trim().length < 10) { toast.error("Informe um motivo (mín. 10 caracteres)."); return; }
                  removeCapMut.mutate({ payroll_month: capMonth, reason: capReason.trim() });
                }}
                disabled={removeCapMut.isPending}
              >
                Remover teto personalizado
              </Button>
            )}
            <Button
              onClick={() => {
                if (!capMonth) return;
                if (capReason.trim().length < 10) { toast.error("Informe um motivo (mín. 10 caracteres)."); return; }
                const cents = moneyToCents(capDraft);
                if (cents < 0) { toast.error("Valor inválido."); return; }
                setCapMut.mutate({ payroll_month: capMonth, cap_cents: cents, reason: capReason.trim() });
              }}
              disabled={setCapMut.isPending}
            >
              {setCapMut.isPending ? "Salvando..." : "Salvar teto"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pdfOpen} onOpenChange={setPdfOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exportar demonstrativo — {employee.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Mês de referência</Label>
              <Input type="month" value={pdfMonth} onChange={(e) => { setPdfMonth(e.target.value); setLastResult(null); }} className="w-48" />
            </div>

            <div className="text-sm border rounded-md p-3 bg-muted/30 space-y-1">
              <div className="font-medium mb-1">Resumo do que será incluído</div>
              <div>Valor previsto para desconto em {formatMonthPtBR(toMonthISO(pdfMonth))}: <b>{centsToMoney(pdfPreview?.scheduled_for_month_cents ?? 0)}</b></div>
              <div>Total em aberto/projetado a partir deste mês: <b>{centsToMoney(pdfPreview?.total_cents ?? 0)}</b></div>
              <div>Meses com parcelas futuras: <b>{pdfPreview?.months_count ?? 0}</b></div>
              <div className="text-xs text-muted-foreground pt-1">
                Inclui lançamentos, parcelas previstas e projeção mensal (ledger) a partir do mês escolhido.
              </div>
            </div>

            {!pdfPreview?.has_open_balance && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  Este colaborador não possui saldo em aberto nem parcelas futuras a partir do mês escolhido.
                  O PDF ainda pode ser gerado, com status "Sem saldo em aberto".
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Este PDF é exclusivamente financeiro — não contém procedimentos, prestadores, exames ou qualquer dado médico.
              </AlertDescription>
            </Alert>

            {lastResult && (
              <div className="flex items-center justify-between text-sm border rounded-md p-3">
                <span>PDF gerado: {lastResult.file_name}</span>
                <Button variant="outline" size="sm" onClick={() => window.open(lastResult.download_url, "_blank")}>
                  <Download className="h-4 w-4 mr-1" />Baixar PDF
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPdfOpen(false)}>Fechar</Button>
            <Button onClick={() => generateMut.mutate()} disabled={generateMut.isPending}>
              {generateMut.isPending ? "Gerando..." : "Gerar PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
