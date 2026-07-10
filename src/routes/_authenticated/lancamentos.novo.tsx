import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { listEmployees } from "@/lib/employees.functions";
import { previewInstallmentPlan, createMonthlyUsage } from "@/lib/usage.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { centsToMoney, moneyToCents } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useState, useEffect } from "react";
import { toast } from "sonner";

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
      toast.success("Lançamento confirmado");
      router.navigate({ to: "/colaboradores/$id", params: { id: employeeId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl font-semibold">Novo lançamento</h1>

      <Card>
        <CardHeader><CardTitle className="text-base">Dados</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>Colaborador</Label>
            <Select value={employeeId} onValueChange={setEmployeeId}>
              <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
              <SelectContent>
                {employees.filter((e) => e.status === "active").map((e) => (
                  <SelectItem key={e.id} value={e.id}>{e.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Competência</Label>
            <Input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} />
          </div>
          <div>
            <Label>Valor</Label>
            <Input placeholder="R$ 0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">{centsToMoney(cents)}</p>
          </div>
          <div className="col-span-2">
            <Label>Observação</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {preview_ && (
        <Card>
          <CardHeader><CardTitle className="text-base">Prévia do parcelamento</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">
              {preview_.installmentCount} parcela(s), início {formatMonthPtBR(preview_.firstDueMonth)}.
              O motor no servidor recalcula tudo ao confirmar (fonte de verdade).
            </p>
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>Mês</TableHead><TableHead className="text-right">Valor</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {preview_.items.map((it: any) => (
                  <TableRow key={it.installmentNumber}>
                    <TableCell>{it.installmentNumber}</TableCell>
                    <TableCell>{formatMonthPtBR(it.dueMonth)}</TableCell>
                    <TableCell className="text-right">{centsToMoney(it.amountCents)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.history.back()}>Cancelar</Button>
        <Button onClick={() => mut.mutate()} disabled={!employeeId || cents <= 0 || mut.isPending}>
          {mut.isPending ? "Salvando..." : "Confirmar lançamento"}
        </Button>
      </div>
    </div>
  );
}
