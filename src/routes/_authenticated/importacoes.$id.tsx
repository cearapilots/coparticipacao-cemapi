import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { centsToMoney, centsToDecimalString, moneyToCents } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import {
  getImportBatchDetails, updateImportItemMatch, ignoreImportItem,
  confirmImportBatch, cancelImportBatch, updateImportItemAmount,
} from "@/lib/imports.functions";

export const Route = createFileRoute("/_authenticated/importacoes/$id")({
  component: BatchDetail,
});

function matchStatusBadge(s: string | null) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    auto_matched: { label: "Auto", variant: "default" },
    manually_matched: { label: "Manual", variant: "default" },
    needs_review: { label: "Revisar", variant: "secondary" },
    not_found: { label: "Não encontrado", variant: "destructive" },
    ignored: { label: "Ignorado", variant: "outline" },
  };
  const m = map[s ?? ""] ?? { label: s ?? "—", variant: "outline" as const };
  return <Badge variant={m.variant}>{m.label}</Badge>;
}

function BatchDetail() {
  const { id } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const getFn = useServerFn(getImportBatchDetails);
  const updateMatch = useServerFn(updateImportItemMatch);
  const ignoreFn = useServerFn(ignoreImportItem);
  const confirmFn = useServerFn(confirmImportBatch);
  const cancelFn = useServerFn(cancelImportBatch);
  const correctAmountFn = useServerFn(updateImportItemAmount);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["import-batch", id],
    queryFn: () => getFn({ data: { batch_id: id } }),
  });

  const [empSearch, setEmpSearch] = useState("");
  const [ignoreReason, setIgnoreReason] = useState<Record<string, string>>({});
  const [amountDraft, setAmountDraft] = useState<Record<string, string>>({});
  const [amountReason, setAmountReason] = useState<Record<string, string>>({});

  const mMatch = useMutation({
    mutationFn: (v: { item_id: string; employee_id: string | null }) =>
      updateMatch({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-batch", id] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const mIgnore = useMutation({
    mutationFn: (v: { item_id: string; ignore: boolean; reason?: string }) =>
      ignoreFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["import-batch", id] }),
    onError: (e: Error) => toast.error(e.message),
  });
  const mCorrectAmount = useMutation({
    mutationFn: (v: { item_id: string; corrected_amount_cents: number | null; reason: string }) =>
      correctAmountFn({ data: v }),
    onSuccess: () => {
      toast.success("Valor atualizado.");
      qc.invalidateQueries({ queryKey: ["import-batch", id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mConfirm = useMutation({
    mutationFn: () => confirmFn({ data: { batch_id: id } }),
    onSuccess: (r) => {
      toast.success(`Lote confirmado — ${r.processed_items} lançamento(s), ${r.employees_affected} colaborador(es).`);
      qc.invalidateQueries();
      router.navigate({ to: "/importacoes" });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const mCancel = useMutation({
    mutationFn: () => cancelFn({ data: { batch_id: id } }),
    onSuccess: () => { toast.success("Lote cancelado."); router.navigate({ to: "/importacoes" }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isError) {
    return (
      <div className="space-y-4">
        <div className="text-xs text-muted-foreground">
          <Link to="/importacoes" className="hover:underline">← Importações</Link>
        </div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Não foi possível carregar este lote</AlertTitle>
          <AlertDescription>{(error as Error)?.message ?? "Erro desconhecido. Tente novamente."}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (isLoading || !data) return <p className="text-sm text-muted-foreground">Carregando...</p>;
  const { batch, items, employees } = data;

  const filteredEmp = employees.filter((e) =>
    empSearch ? e.full_name.toLowerCase().includes(empSearch.toLowerCase()) : true,
  );

  const effectiveAmount = (it: { amount_cents: number | null; corrected_amount_cents?: number | null }) =>
    it.corrected_amount_cents ?? it.amount_cents ?? 0;

  const sumActive = items
    .filter((it) => it.review_status !== "ignored")
    .reduce((a, b) => a + effectiveAmount(b), 0);
  const pending = items.filter(
    (it) => it.review_status !== "ignored" &&
      (it.match_status === "not_found" || it.match_status === "needs_review" || !it.matched_employee_id),
  );
  const diffFromCharged = batch.total_charged_company_cents != null
    ? sumActive - batch.total_charged_company_cents
    : null;

  const isFinal = batch.status === "confirmed" || batch.status === "cancelled";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link to="/importacoes" className="hover:underline">← Importações</Link>
          </div>
          <h1 className="text-2xl font-semibold">Revisão do lote</h1>
          <p className="text-sm text-muted-foreground font-mono">{batch.source_file_name}</p>
        </div>
        <div className="flex gap-2">
          {!isFinal && (
            <>
              <Button variant="outline" onClick={() => {
                if (confirm("Cancelar este lote? Nada será lançado.")) mCancel.mutate();
              }}>Cancelar lote</Button>
              <Button
                onClick={() => {
                  if (pending.length > 0) { toast.error(`${pending.length} item(ns) pendente(s).`); return; }
                  if (confirm(`Confirmar e gerar ${items.filter((i) => i.review_status !== "ignored").length} lançamento(s)?`))
                    mConfirm.mutate();
                }}
                disabled={pending.length > 0 || mConfirm.isPending}
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                {mConfirm.isPending ? "Confirmando..." : "Confirmar lote"}
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Competência</div>
          <div className="font-semibold">{batch.competence_month ? formatMonthPtBR(toMonthISO(batch.competence_month)) : "—"}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Mês do relatório</div>
          <div className="font-semibold">{batch.billing_month ? formatMonthPtBR(toMonthISO(batch.billing_month)) : "—"}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Titulares</div>
          <div className="font-semibold">{items.length}</div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="text-xs text-muted-foreground">Status</div>
          <div className="font-semibold capitalize">{batch.status}</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Conferência financeira</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span>Soma "Total da Família" (ativos)</span><b>{centsToMoney(sumActive)}</b></div>
          <div className="flex justify-between"><span>Total Cobrado Empresa</span><b>{batch.total_charged_company_cents != null ? centsToMoney(batch.total_charged_company_cents) : "—"}</b></div>
          {diffFromCharged !== null && diffFromCharged !== 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Diferença detectada</AlertTitle>
              <AlertDescription>
                Diferença entre soma dos itens ativos e Total Cobrado Empresa: <b>{centsToMoney(diffFromCharged)}</b>.
                Revise valores e itens ignorados antes de confirmar.
              </AlertDescription>
            </Alert>
          )}
          {batch.notes && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Avisos do parser</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap text-xs">{batch.notes}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {pending.length > 0 && !isFinal && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{pending.length} item(ns) pendente(s) de revisão</AlertTitle>
          <AlertDescription>Associe um colaborador ou ignore cada item antes de confirmar o lote.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Itens ({items.length})</CardTitle></CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Nenhum item extraído deste PDF</AlertTitle>
              <AlertDescription>
                O parser não encontrou titulares/valores no texto extraído. Verifique os avisos acima,
                confira o texto extraído (cole manualmente se necessário) e considere cancelar este lote
                e tentar novamente.
              </AlertDescription>
            </Alert>
          ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nome no PDF</TableHead>
              <TableHead>Colaborador associado</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>Confiança</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Ações</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {items.map((it) => {
                const matchedEmp = employees.find((e) => e.id === it.matched_employee_id);
                const isIgnored = it.review_status === "ignored";
                return (
                  <TableRow key={it.id} className={isIgnored ? "opacity-50" : ""}>
                    <TableCell className="font-medium">
                      {it.raw_employee_name}
                      {it.raw_text_reference && (
                        <div className="text-xs text-muted-foreground truncate max-w-xs" title={it.raw_text_reference}>
                          {it.raw_text_reference}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {matchedEmp ? matchedEmp.full_name : <span className="text-destructive text-xs">—</span>}
                    </TableCell>
                    <TableCell>{matchStatusBadge(it.match_status)}</TableCell>
                    <TableCell className="text-xs">
                      {it.match_confidence != null ? `${Math.round(Number(it.match_confidence) * 100)}%` : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {it.corrected_amount_cents != null ? (
                        <div>
                          <div className="text-xs text-muted-foreground line-through">{centsToMoney(it.amount_cents ?? 0)}</div>
                          <div className="font-semibold">{centsToMoney(it.corrected_amount_cents)}</div>
                          <Badge variant="secondary" className="text-[10px]">Corrigido</Badge>
                        </div>
                      ) : (
                        <div>{centsToMoney(it.amount_cents ?? 0)}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      {!isFinal && (
                        <div className="flex gap-1">
                          <Dialog
                            onOpenChange={(open) => {
                              if (open) {
                                setAmountDraft((s) => ({
                                  ...s,
                                  [it.id]: centsToDecimalString(it.corrected_amount_cents ?? it.amount_cents ?? 0),
                                }));
                                setAmountReason((s) => ({ ...s, [it.id]: "" }));
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm"><Pencil className="h-3 w-3 mr-1" />Editar valor</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Editar valor extraído</DialogTitle>
                                <DialogDescription>
                                  Titular no PDF: <b>{it.raw_employee_name}</b>
                                  {matchedEmp && <> · Colaborador: <b>{matchedEmp.full_name}</b></>}
                                </DialogDescription>
                              </DialogHeader>
                              <div className="space-y-3">
                                <div className="text-sm text-muted-foreground">
                                  Valor extraído originalmente: <b>{centsToMoney(it.amount_cents ?? 0)}</b>
                                </div>
                                <div>
                                  <label className="text-sm font-medium">Valor corrigido (R$)</label>
                                  <Input
                                    value={amountDraft[it.id] ?? ""}
                                    onChange={(e) => setAmountDraft((s) => ({ ...s, [it.id]: e.target.value }))}
                                  />
                                </div>
                                <div>
                                  <label className="text-sm font-medium">Motivo da correção (obrigatório)</label>
                                  <Textarea
                                    value={amountReason[it.id] ?? ""}
                                    onChange={(e) => setAmountReason((s) => ({ ...s, [it.id]: e.target.value }))}
                                    placeholder="Ex: parser leu errado o valor de Total da Família, conferido no PDF original."
                                  />
                                </div>
                              </div>
                              <DialogFooter className="flex-wrap gap-2">
                                {it.corrected_amount_cents != null && (
                                  <Button
                                    variant="outline"
                                    onClick={() => {
                                      const reason = amountReason[it.id]?.trim();
                                      if (!reason || reason.length < 10) {
                                        toast.error("Informe um motivo (mín. 10 caracteres) para reverter ao valor original.");
                                        return;
                                      }
                                      mCorrectAmount.mutate({ item_id: it.id, corrected_amount_cents: null, reason });
                                    }}
                                  >
                                    Reverter para valor original
                                  </Button>
                                )}
                                <Button
                                  onClick={() => {
                                    const reason = amountReason[it.id]?.trim();
                                    if (!reason || reason.length < 10) {
                                      toast.error("Informe um motivo (mín. 10 caracteres) para a correção.");
                                      return;
                                    }
                                    const cents = moneyToCents(amountDraft[it.id] ?? "0");
                                    mCorrectAmount.mutate({ item_id: it.id, corrected_amount_cents: cents, reason });
                                  }}
                                  disabled={mCorrectAmount.isPending}
                                >
                                  Salvar correção
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="sm">Associar</Button>
                            </DialogTrigger>
                            <DialogContent>
                              <DialogHeader>
                                <DialogTitle>Associar colaborador</DialogTitle>
                                <DialogDescription>Selecione o colaborador para "{it.raw_employee_name}".</DialogDescription>
                              </DialogHeader>
                              <Input placeholder="Buscar..." value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
                              <Select
                                value={it.matched_employee_id ?? ""}
                                onValueChange={(v) => mMatch.mutate({ item_id: it.id, employee_id: v || null })}
                              >
                                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                <SelectContent className="max-h-72">
                                  {filteredEmp.map((e) => (
                                    <SelectItem key={e.id} value={e.id}>
                                      {e.full_name}{e.payroll_code ? ` (${e.payroll_code})` : ""}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <DialogFooter>
                                <Button variant="outline" onClick={() => mMatch.mutate({ item_id: it.id, employee_id: null })}>
                                  Limpar
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>

                          {!isIgnored ? (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="ghost" size="sm">Ignorar</Button>
                              </DialogTrigger>
                              <DialogContent>
                                <DialogHeader>
                                  <DialogTitle>Ignorar item</DialogTitle>
                                  <DialogDescription>Justifique o motivo (opcional).</DialogDescription>
                                </DialogHeader>
                                <Textarea
                                  value={ignoreReason[it.id] ?? ""}
                                  onChange={(e) => setIgnoreReason((s) => ({ ...s, [it.id]: e.target.value }))}
                                  placeholder="Ex: dependente sem vínculo, cobrança duplicada..."
                                />
                                <DialogFooter>
                                  <Button onClick={() => mIgnore.mutate({ item_id: it.id, ignore: true, reason: ignoreReason[it.id] || undefined })}>
                                    Confirmar ignorar
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                          ) : (
                            <Button variant="ghost" size="sm" onClick={() => mIgnore.mutate({ item_id: it.id, ignore: false })}>
                              Restaurar
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
