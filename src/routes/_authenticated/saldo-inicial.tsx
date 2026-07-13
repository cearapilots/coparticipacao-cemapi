import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { listEmployees } from "@/lib/employees.functions";
import { previewOpeningBalance, createOpeningBalance } from "@/lib/opening-balance.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { centsToMoney, moneyToCents, centsToDecimalString } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info } from "lucide-react";

export const Route = createFileRoute("/_authenticated/saldo-inicial")({
  component: OpeningBalancePage,
});

interface Item { due_month: string; amount_cents: number; }

function OpeningBalancePage() {
  const router = useRouter();
  const fetchList = useServerFn(listEmployees);
  const preview = useServerFn(previewOpeningBalance);
  const create = useServerFn(createOpeningBalance);

  const [employeeId, setEmployeeId] = useState("");
  const [total, setTotal] = useState("");
  const [firstMonth, setFirstMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [count, setCount] = useState(1);
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<Item[]>([]);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => fetchList() });

  const totalCents = moneyToCents(total);

  async function handleGeneratePreview() {
    if (totalCents <= 0 || count <= 0) return;
    const rows = await preview({ data: {
      total_amount_cents: totalCents,
      first_due_month: toMonthISO(firstMonth),
      installment_count: count,
    } });
    setItems(rows.map((r) => ({ due_month: r.due_month, amount_cents: r.amount_cents })));
  }

  function updateItem(idx: number, patch: Partial<Item>) {
    setItems((prev) => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  }

  const editedTotal = items.reduce((s, it) => s + it.amount_cents, 0);
  const totalMatches = items.length > 0 && editedTotal === totalCents;

  const mut = useMutation({
    mutationFn: () => create({ data: { employee_id: employeeId, notes: notes || null, items } }),
    onSuccess: () => {
      toast.success("Saldo inicial registrado");
      router.navigate({ to: "/colaboradores/$id", params: { id: employeeId } });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Saldo inicial</h1>
        <p className="text-sm text-muted-foreground">Base anterior já existente — não passa pela regra nova de parcelamento.</p>
      </div>

      <Alert variant="destructive">
        <Info className="h-4 w-4" />
        <AlertDescription>
          Ferramenta usada apenas para a carga inicial de 07/2026. Não faz parte do fluxo mensal —
          daqui em diante os valores vêm do PDF mensal da UNIMED (tela Importações).
        </AlertDescription>
      </Alert>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          O saldo inicial representa dívida anterior. Você pode gerar uma prévia automática e depois <b>editar cada parcela manualmente</b> antes de confirmar. A soma das parcelas deve bater com o total informado.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader><CardTitle className="text-base">Parâmetros</CardTitle></CardHeader>
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
            <Label>Valor total</Label>
            <Input placeholder="R$ 0,00" value={total} onChange={(e) => setTotal(e.target.value)} />
            <p className="text-xs text-muted-foreground mt-1">{centsToMoney(totalCents)}</p>
          </div>
          <div>
            <Label>Mês da 1ª parcela</Label>
            <Input type="month" value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} />
          </div>
          <div>
            <Label>Nº de parcelas</Label>
            <Input type="number" min={1} max={60} value={count} onChange={(e) => setCount(Number(e.target.value))} />
          </div>
          <div className="col-span-2">
            <Label>Observação</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="col-span-2">
            <Button variant="outline" onClick={handleGeneratePreview} disabled={!totalCents}>Gerar prévia</Button>
          </div>
        </CardContent>
      </Card>

      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Parcelas (editáveis)</CardTitle>
            <p className={`text-xs ${totalMatches ? "text-muted-foreground" : "text-destructive"}`}>
              Soma atual: {centsToMoney(editedTotal)} / Total: {centsToMoney(totalCents)}
              {!totalMatches && " — ajuste até bater."}
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow>
                <TableHead>#</TableHead><TableHead>Mês</TableHead><TableHead>Valor (R$)</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {items.map((it, idx) => (
                  <TableRow key={idx}>
                    <TableCell>{idx + 1}</TableCell>
                    <TableCell>
                      <Input type="month" value={it.due_month.slice(0, 7)}
                        onChange={(e) => updateItem(idx, { due_month: toMonthISO(e.target.value) })} />
                    </TableCell>
                    <TableCell>
                      <Input value={centsToDecimalString(it.amount_cents)}
                        onChange={(e) => updateItem(idx, { amount_cents: moneyToCents(e.target.value) })} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.history.back()}>Cancelar</Button>
        <Button onClick={() => mut.mutate()} disabled={!employeeId || !totalMatches || mut.isPending}>
          {mut.isPending ? "Salvando..." : "Confirmar saldo inicial"}
        </Button>
      </div>
    </div>
  );
}
