import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { previewMonthClosing, closeMonth, getMonthComposition, listPayrollExports } from "@/lib/closing.functions";
import { generatePayrollXlsx, getPayrollExportDownloadUrl } from "@/lib/payroll-exports.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { centsToMoney } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Download, Info, Lock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/fechamento")({
  component: ClosingPage,
});

type Filter = "all" | "with_deduct" | "no_deduct" | "capped" | "with_carryover";

function ClosingPage() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [previewData, setPreviewData] = useState<any>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [compEmp, setCompEmp] = useState<{ id: string; name: string } | null>(null);
  const qc = useQueryClient();

  const preview = useServerFn(previewMonthClosing);
  const close = useServerFn(closeMonth);
  const composition = useServerFn(getMonthComposition);
  const generateXlsx = useServerFn(generatePayrollXlsx);
  const getDownloadUrl = useServerFn(getPayrollExportDownloadUrl);
  const listExports = useServerFn(listPayrollExports);

  const previewMut = useMutation({
    mutationFn: () => preview({ data: { payroll_month: toMonthISO(month) } }),
    onSuccess: (d) => setPreviewData(d),
    onError: (e: Error) => toast.error(e.message),
  });

  const closeMut = useMutation({
    mutationFn: () => close({ data: { payroll_month: toMonthISO(month) } }),
    onSuccess: (r) => {
      toast.success(`Mês fechado. Total: ${centsToMoney(r.total_amount_cents)}`);
      qc.invalidateQueries();
      previewMut.mutate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const xlsxMut = useMutation({
    mutationFn: async () => {
      const mode = previewData?.rows?.some((r: any) => r.status === "closed" || r.status === "exported") ? "closed" : "preview";
      return generateXlsx({ data: { payroll_month: toMonthISO(month), mode } });
    },
    onSuccess: (r) => {
      if (r.warnings?.length) toast.warning(`${r.warnings.length} aviso(s): ${r.warnings.slice(0, 2).join("; ")}`);
      window.open(r.download_url, "_blank");
      toast.success(`XLSX gerado: ${r.file_name}`);
      exportsQuery.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportsQuery = useQuery({
    queryKey: ["payroll-exports"],
    queryFn: () => listExports(),
  });

  const isClosed = previewData?.rows?.some((r: any) => r.status === "closed" || r.status === "exported");

  const rows = previewData?.rows ?? [];
  const filteredRows = useMemo(() => {
    const s = search.toLowerCase();
    return rows.filter((r: any) => {
      if (s && !r.full_name.toLowerCase().includes(s)) return false;
      if (filter === "with_deduct" && r.amount_to_deduct_cents <= 0) return false;
      if (filter === "no_deduct" && r.amount_to_deduct_cents > 0) return false;
      if (filter === "capped" && !r.capped) return false;
      if (filter === "with_carryover" && r.carryover_out_cents <= 0) return false;
      return true;
    });
  }, [rows, search, filter]);

  const compQuery = useQuery({
    queryKey: ["composition", compEmp?.id, month],
    queryFn: () => composition({ data: { employee_id: compEmp!.id, payroll_month: toMonthISO(month) } }),
    enabled: !!compEmp,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fechamento mensal</h1>
        <p className="text-sm text-muted-foreground">
          Gere a prévia, revise linha a linha, feche o mês e baixe o XLSX contábil.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 items-end pt-6">
          <div>
            <Label>Mês de desconto</Label>
            <Input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPreviewData(null); }} className="w-48" />
          </div>
          <Button onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>
            {previewMut.isPending ? "Calculando..." : "Gerar prévia"}
          </Button>
          {previewData && !isClosed && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="default"><Lock className="h-4 w-4 mr-2" />Fechar mês</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Fechar {formatMonthPtBR(toMonthISO(month))}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Após o fechamento, este mês <b>não poderá ser alterado silenciosamente</b>.
                    Novos lançamentos com competência anterior virarão <b>ajustes</b> no próximo mês aberto.
                    <br /><br />
                    Total: <b>{centsToMoney(previewData.totals.total_deduct)}</b> em <b>{previewData.totals.active_count}</b> colaborador(es).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => closeMut.mutate()}>Confirmar fechamento</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {isClosed && <Badge variant="default"><Lock className="h-3 w-3 mr-1" />Mês fechado</Badge>}
          <Button variant="outline" onClick={() => xlsxMut.mutate()} disabled={!previewData || xlsxMut.isPending}>
            <Download className="h-4 w-4 mr-2" />
            {xlsxMut.isPending ? "Gerando..." : isClosed ? "Baixar XLSX" : "Baixar XLSX (prévia)"}
          </Button>
        </CardContent>
      </Card>

      {previewData && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total a descontar" value={centsToMoney(previewData.totals.total_deduct)} />
            <StatCard title="Carryover recebido" value={centsToMoney(previewData.totals.total_carryover_in)} />
            <StatCard title="Remanejado p/ próximo" value={centsToMoney(previewData.totals.total_carryover_out)} />
            <StatCard title="Atingiram teto" value={String(previewData.totals.capped_count)} />
          </div>

          {isClosed && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Este mês já foi fechado. Os valores exibidos são o snapshot registrado.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader>
              <div className="flex flex-wrap gap-2 justify-between items-center">
                <CardTitle className="text-base">Prévia — {formatMonthPtBR(previewData.month)}</CardTitle>
                <div className="flex gap-2">
                  <Input placeholder="Buscar colaborador" value={search} onChange={(e) => setSearch(e.target.value)} className="w-56" />
                  <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos ({rows.length})</SelectItem>
                      <SelectItem value="with_deduct">Com desconto</SelectItem>
                      <SelectItem value="no_deduct">Sem desconto</SelectItem>
                      <SelectItem value="capped">Atingiu teto</SelectItem>
                      <SelectItem value="with_carryover">Com carryover</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Cód.</TableHead>
                  <TableHead className="text-right">Parcelas previstas</TableHead>
                  <TableHead className="text-right">Carryover entrante</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">A descontar</TableHead>
                  <TableHead className="text-right">Carryover p/ próx.</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {filteredRows.length === 0 && (
                    <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">Nenhum registro</TableCell></TableRow>
                  )}
                  {filteredRows.map((r: any) => (
                    <TableRow key={r.employee_id}>
                      <TableCell className="font-medium">{r.full_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.payroll_code ?? "—"}</TableCell>
                      <TableCell className="text-right">{centsToMoney(r.scheduled_amount_cents)}</TableCell>
                      <TableCell className="text-right">{centsToMoney(r.carryover_in_cents)}</TableCell>
                      <TableCell className="text-right">{centsToMoney(r.gross_due_cents)}</TableCell>
                      <TableCell className="text-right font-semibold">{centsToMoney(r.amount_to_deduct_cents)}</TableCell>
                      <TableCell className="text-right">{centsToMoney(r.carryover_out_cents)}</TableCell>
                      <TableCell>
                        {r.capped && <Badge variant="destructive" className="mr-1">Teto</Badge>}
                        <Badge variant="outline">
                          {r.status === "projected" ? "Projetado" : r.status === "closed" ? "Fechado" : "Exportado"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => setCompEmp({ id: r.employee_id, name: r.full_name })}>
                          Ver composição
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!compEmp} onOpenChange={(o) => { if (!o) setCompEmp(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Composição — {compEmp?.name}</DialogTitle>
            <CardDescription>Mês de desconto: {formatMonthPtBR(toMonthISO(month))}</CardDescription>
          </DialogHeader>
          {compQuery.isLoading && <p className="text-sm text-muted-foreground">Carregando...</p>}
          {compQuery.data && (
            <div className="space-y-3">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Competência</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-center">Parcela</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {compQuery.data.items.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-4">Nenhuma parcela neste mês</TableCell></TableRow>
                  )}
                  {compQuery.data.items.map((it: any) => (
                    <TableRow key={it.id}>
                      <TableCell>{it.competence_month ? formatMonthPtBR(it.competence_month) : "—"}</TableCell>
                      <TableCell><Badge variant="secondary">{it.installment_plans?.source_type ?? "—"}</Badge></TableCell>
                      <TableCell className="text-center">{it.installment_number}/{it.installment_count}</TableCell>
                      <TableCell className="text-right">{centsToMoney(it.scheduled_amount_cents)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {compQuery.data.ledger && (
                <div className="border rounded-md p-3 text-sm space-y-1 bg-muted/30">
                  <div className="flex justify-between"><span>Soma das parcelas:</span><b>{centsToMoney(compQuery.data.ledger.scheduled_amount_cents)}</b></div>
                  <div className="flex justify-between"><span>Carryover entrante:</span><b>+ {centsToMoney(compQuery.data.ledger.carryover_in_cents)}</b></div>
                  <div className="flex justify-between border-t pt-1"><span>Bruto do mês:</span><b>{centsToMoney(compQuery.data.ledger.gross_due_cents)}</b></div>
                  <div className="flex justify-between text-muted-foreground text-xs"><span>Teto aplicado:</span><span>{centsToMoney(compQuery.data.ledger.cap_cents)}</span></div>
                  <div className="flex justify-between text-base font-semibold border-t pt-1"><span>A descontar:</span><span>{centsToMoney(compQuery.data.ledger.amount_to_deduct_cents)}</span></div>
                  <div className="flex justify-between"><span>Carryover para próximo mês:</span><b>{centsToMoney(compQuery.data.ledger.carryover_out_cents)}</b></div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardDescription>{title}</CardDescription></CardHeader>
      <CardContent><div className="text-2xl font-semibold">{value}</div></CardContent>
    </Card>
  );
}
