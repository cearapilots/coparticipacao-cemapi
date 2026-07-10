import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { listEmployees } from "@/lib/employees.functions";
import { previewInstallmentPlan, createMonthlyUsage } from "@/lib/usage.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { centsToMoney, moneyToCents } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { AlertTriangle, Info } from "lucide-react";

export const Route = createFileRoute("/_authenticated/lancamentos/novo")({
  component: NewLaunch,
});

function NewLaunch() {
  const router = useRouter();
  const fetchList = useServerFn(listEmployees);
  const preview = useServerFn(previewInstallmentPlan);
  const create = useServerFn(createMonthlyUsage);
  const [employeeId, setEmployeeId] = useState("");
  const [competence, setCompetence] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [preview_, setPreview_] = useState<any>(null);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => fetchList() });

  const cents = moneyToCents(amount);
  useEffect(() => {
    if (!competence || cents <= 0) { setPreview_(null); return; }
    preview({ data: { competence_month: toMonthISO(competence), amount_cents: cents } })
      .then(setPreview_).catch(() => setPreview_(null));
  }, [competence, cents, preview]);

  const mut = useMutation({
    mutationFn: () => create({ data: {
      employee_id: employeeId, competence_month: toMonthISO(competence),
      amount_cents: cents, notes: notes || null,
    } }),
    onSuccess: () => {
      toast.success("Lançamento confirmado — ledger recalculado.");
      router.navigate({ to: "/colaboradores/$id", params: { id: employeeId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ruleLabel = preview_
    ? preview_.installmentCount === 1
      ? "1x — cobra no próximo mês"
      : `${preview_.installmentCount}x — inicia no mês da competência`
    : "";

  const capThreshold = 70000; // valor de referência para aviso; motor no servidor é a verdade
  const anyCapWarning = preview_?.items?.some((it: any) => it.amountCents > capThreshold);

  const employee = employees.find((e: any) => e.id === employeeId);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Novo lançamento</h1>
        <p className="text-sm text-muted-foreground">
          Registre uma coparticipação. O motor no servidor aplica as faixas de parcelamento e o teto mensal.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Dados do lançamento</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Colaborador *</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {employees.filter((e: any) => e.status === "active").map((e: any) => (
                  <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Competência (mês da despesa)</Label>
            <Input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">Mês em que a coparticipação foi originada.</p>
          </div>
          <div>
            <Label>Valor *</Label>
            <Input placeholder="R$ 0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">{centsToMoney(cents)}</p>
          </div>
          <div className="col-span-2">
            <Label>Observação</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Informação livre para conferência interna (não registre dados médicos)." />
          </div>
        </CardContent>
      </Card>

      {preview_ && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prévia do parcelamento</CardTitle>
            <CardDescription>Regra aplicada: <b>{ruleLabel}</b></CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead>
                <TableHead>Mês de desconto</TableHead>
                <TableHead className="text-right">Valor da parcela</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {preview_.items.map((it: any) => (
                  <TableRow key={it.installmentNumber}>
                    <TableCell>{it.installmentNumber}/{preview_.installmentCount}</TableCell>
                    <TableCell>{formatMonthPtBR(it.dueMonth)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(it.amountCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {anyCapWarning && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Uma ou mais parcelas ultrapassam o teto de referência ({centsToMoney(capThreshold)}) e podem gerar carryover para meses seguintes.
                </AlertDescription>
              </Alert>
            )}

            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                Ao confirmar, o servidor grava o lançamento, gera o plano de parcelas, aplica o teto mensal
                e recalcula o ledger a partir do próximo mês aberto. Se a competência afetar um mês já
                <b> fechado</b>, o valor vira <b>ajuste</b> no próximo mês aberto.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap justify-between items-center gap-2">
        <Button variant="ghost" asChild>
          <Link to="/lancamentos">← Voltar para lançamentos</Link>
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.history.back()}>Cancelar</Button>
          <Button onClick={() => mut.mutate()} disabled={!employeeId || cents <= 0 || mut.isPending}>
            {mut.isPending ? "Salvando..." : "Confirmar lançamento"}
          </Button>
        </div>
      </div>

      {employee && (
        <p className="text-xs text-muted-foreground">
          Após confirmar você será levado ao histórico de <b>{employee.full_name}</b>.
        </p>
      )}
    </div>
  );
}
