import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { previewMonthClosing, closeMonth } from "@/lib/closing.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { centsToMoney } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/fechamento")({
  component: ClosingPage,
});

function ClosingPage() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [previewData, setPreviewData] = useState<any>(null);
  const qc = useQueryClient();

  const preview = useServerFn(previewMonthClosing);
  const close = useServerFn(closeMonth);

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

  const isClosed = previewData?.rows?.some((r: any) => r.status === "closed" || r.status === "exported");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Fechamento mensal</h1>
        <p className="text-sm text-muted-foreground">
          Nesta iteração é gerado apenas o snapshot do fechamento. O XLSX binário será feito na próxima entrega.
        </p>
      </div>

      <Card>
        <CardContent className="flex gap-3 items-end pt-6">
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
                <Button variant="default">Fechar mês</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Fechar {formatMonthPtBR(toMonthISO(month))}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Após o fechamento, o mês não poderá ser alterado silenciosamente.
                    Ajustes retroativos serão lançados no próximo mês aberto.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={() => closeMut.mutate()}>Confirmar fechamento</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {isClosed && <Badge variant="default">Mês já fechado</Badge>}
        </CardContent>
      </Card>

      {previewData && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title="Total a descontar" value={centsToMoney(previewData.totals.total_deduct)} />
            <StatCard title="Carryover recebido" value={centsToMoney(previewData.totals.total_carryover_in)} />
            <StatCard title="Remanejado" value={centsToMoney(previewData.totals.total_carryover_out)} />
            <StatCard title="Atingiram teto" value={String(previewData.totals.capped_count)} />
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">Prévia — {formatMonthPtBR(previewData.month)}</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Colaborador</TableHead>
                  <TableHead>Cód.</TableHead>
                  <TableHead className="text-right">Parcelas</TableHead>
                  <TableHead className="text-right">Carryover in</TableHead>
                  <TableHead className="text-right">Bruto</TableHead>
                  <TableHead className="text-right">A descontar</TableHead>
                  <TableHead className="text-right">Carryover out</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {previewData.rows.map((r: any) => (
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
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
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
