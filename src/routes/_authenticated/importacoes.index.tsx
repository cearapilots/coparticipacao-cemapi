import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Upload, FileText, AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { centsToMoney } from "@/lib/calc/money";
import { formatMonthPtBR, toMonthISO } from "@/lib/calc/date";
import { extractPdfText, sha256Hex } from "@/lib/pdf-client";
import { createImportBatchFromPdf, listImportBatches, getImportMarker, deleteImportBatch } from "@/lib/imports.functions";
import { getMyRoles } from "@/lib/settings.functions";

export const Route = createFileRoute("/_authenticated/importacoes/")({
  component: ImportsPage,
});

function statusBadge(status: string) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    draft: { label: "Rascunho", variant: "outline" },
    pending_review: { label: "Aguardando revisão", variant: "secondary" },
    confirmed: { label: "Confirmado", variant: "default" },
    cancelled: { label: "Cancelado", variant: "outline" },
    error: { label: "Erro", variant: "destructive" },
  };
  const s = map[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function ImportsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const listFn = useServerFn(listImportBatches);
  const createFn = useServerFn(createImportBatchFromPdf);
  const markerFn = useServerFn(getImportMarker);
  const rolesFn = useServerFn(getMyRoles);
  const deleteFn = useServerFn(deleteImportBatch);

  const { data: batches = [] } = useQuery({ queryKey: ["import-batches"], queryFn: () => listFn() });
  const { data: marker } = useQuery({ queryKey: ["import-marker"], queryFn: () => markerFn() });
  const { data: myRoles = [] } = useQuery({ queryKey: ["my-roles"], queryFn: () => rolesFn() });
  const isAdmin = myRoles.includes("admin");

  const deleteMut = useMutation({
    mutationFn: (batchId: string) => deleteFn({ data: { batch_id: batchId } }),
    onSuccess: () => { toast.success("Lote apagado."); qc.invalidateQueries({ queryKey: ["import-batches"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const [competence, setCompetence] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [extracted, setExtracted] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleExtract() {
    if (!file) return;
    setBusy(true);
    try {
      const text = await extractPdfText(file);
      if (!text || text.trim().length < 20) {
        toast.error("Não consegui extrair texto do PDF. Cole o texto manualmente abaixo.");
      } else {
        setExtracted(text);
        toast.success("Texto extraído. Confira e clique em processar.");
      }
    } catch (e) {
      console.error(e);
      toast.error("Falha ao extrair PDF. Cole o texto manualmente abaixo.");
    } finally {
      setBusy(false);
    }
  }

  const competenceISO = competence ? toMonthISO(competence) : "";
  const markerISO = marker?.first_unimed_import_month ?? "2026-08-01";
  const isBeforeMarker = !!competenceISO && competenceISO < markerISO;

  async function submit(opts: { confirmReprocess?: boolean; overrideReason?: string } = {}) {
    const rawText = extracted || pastedText;
    if (!rawText.trim()) { toast.error("Nenhum texto para processar."); return; }
    if (!competence) { toast.error("Escolha a competência operacional."); return; }

    // Bloqueio de competência anterior ao marco operacional
    if (isBeforeMarker && !opts.overrideReason) {
      if (!isAdmin) {
        toast.error(
          "Esta competência já foi coberta pela carga inicial de saldo devedor. Importação bloqueada para RH — solicite a um administrador.",
        );
        return;
      }
      const reason = window.prompt(
        `Atenção: a competência ${competenceISO.substring(0, 7)} é anterior ao marco operacional (${markerISO.substring(0, 7)}) e já foi coberta pela carga inicial de saldo devedor.\n\nImportar aqui pode DUPLICAR valores.\n\nInforme uma justificativa (mín. 10 caracteres) para prosseguir:`,
        "",
      );
      if (!reason || reason.trim().length < 10) {
        toast.error("Justificativa obrigatória (mínimo 10 caracteres). Importação cancelada.");
        return;
      }
      return submit({ ...opts, overrideReason: reason.trim() });
    }

    setBusy(true);
    try {
      let hash: string;
      let storagePath: string | null = null;
      let fileName = "colado.txt";

      if (file) {
        hash = await sha256Hex(file);
        fileName = file.name;
        const path = `${new Date().toISOString().slice(0, 7)}/${hash}-${encodeURIComponent(file.name)}`;
        const up = await supabase.storage.from("unimed-pdfs").upload(path, file, {
          upsert: true, contentType: file.type || "application/pdf",
        });
        if (up.error) {
          console.warn("Upload storage falhou (seguindo assim mesmo):", up.error.message);
        } else {
          storagePath = up.data?.path ?? null;
        }
      } else {
        const enc = new TextEncoder().encode(rawText);
        const h = await crypto.subtle.digest("SHA-256", enc);
        hash = Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
      }

      const res = await createFn({ data: {
        raw_text: rawText,
        source_file_name: fileName,
        source_file_hash: hash,
        source_file_storage_path: storagePath,
        competence_month: toMonthISO(competence),
        confirm_reprocess: opts.confirmReprocess,
        pre_marker_override_reason: opts.overrideReason,
      }});

      if (res.duplicate) {
        const reason = res.reason === "hash"
          ? "Este arquivo já foi importado antes."
          : "Já existe um lote confirmado para esta competência.";
        if (confirm(`${reason}\nDeseja reprocessar mesmo assim?`)) {
          await submit({ ...opts, confirmReprocess: true });
        }
        return;
      }

      toast.success("Lote criado. Revise os itens antes de confirmar.");
      qc.invalidateQueries({ queryKey: ["import-batches"] });
      router.navigate({ to: "/importacoes/$id", params: { id: res.batch_id! } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold">Importações UNIMED</h1>
        <p className="text-sm text-muted-foreground">
          Envie o PDF mensal. O sistema extrai os titulares e valores de "Total da Família",
          faz o matching com colaboradores e envia para revisão manual antes de gerar lançamentos.
        </p>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Marco operacional: importações a partir de {markerISO.substring(0, 7)}</AlertTitle>
        <AlertDescription>
          Os valores anteriores a agosto/2026 foram carregados como <strong>saldo inicial</strong>
          {marker?.opening_balance_source_note ? ` (${marker.opening_balance_source_note})` : ""}.
          A partir de 08/2026, os arquivos da UNIMED devem ser importados mensalmente. Para cada
          titular, o sistema usa o valor de <strong>Total da Família</strong> como valor novo
          mensal de coparticipação — procedimentos individuais e Ref. Produção não são usados
          como competência principal.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Novo lote</CardTitle>
          <CardDescription>
            Nenhum lançamento é criado automaticamente — sempre passa por revisão.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Competência operacional *</Label>
              <Input type="month" value={competence} onChange={(e) => setCompetence(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Mês da despesa que este lote representa.</p>
            </div>
            <div>
              <Label>PDF da UNIMED</Label>
              <Input
                ref={fileRef}
                type="file"
                accept="application/pdf"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setExtracted("");
                }}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExtract} disabled={!file || busy}>
              <FileText className="h-4 w-4 mr-2" /> Extrair texto do PDF
            </Button>
            <Button
              onClick={() => submit()}
              disabled={busy || (!extracted && !pastedText.trim()) || (isBeforeMarker && !isAdmin)}
            >
              {busy ? "Processando..." : "Processar e criar lote"}
            </Button>
          </div>

          {isBeforeMarker && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Competência anterior ao marco operacional</AlertTitle>
              <AlertDescription>
                Este mês ({competenceISO.substring(0, 7)}) já está coberto pela carga inicial
                de saldo devedor. Importar este arquivo pode duplicar valores. A primeira
                importação operacional da UNIMED deve ser a partir de {markerISO.substring(0, 7)}.
                {isAdmin
                  ? " Como administrador, você pode prosseguir informando uma justificativa obrigatória."
                  : " Importação bloqueada para usuários RH — solicite a um administrador."}
              </AlertDescription>
            </Alert>
          )}

          {extracted && (
            <>
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Texto extraído ({extracted.length.toLocaleString("pt-BR")} caracteres)</AlertTitle>
                <AlertDescription>Confira abaixo se "Titular" e "Total da Família" aparecem juntos e em ordem. Pode editar antes de processar.</AlertDescription>
              </Alert>
              <div>
                <Label>Texto extraído (revise antes de processar)</Label>
                <Textarea
                  value={extracted}
                  onChange={(e) => setExtracted(e.target.value)}
                  className="min-h-48 font-mono text-xs"
                />
              </div>
            </>
          )}

          <div>
            <Label>Fallback: colar texto do PDF manualmente</Label>
            <Textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Se a extração automática falhar, cole aqui o texto do PDF (Mês/Ano, blocos Titular, Total da Família, Total Cobrado Empresa)."
              className="min-h-32 font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Use apenas se o botão de extrair não funcionar com o seu PDF.
            </p>
          </div>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              O parser ignora linhas de serviços, procedimentos e prestadores.
              Apenas nome do titular, "Total da Família" e "Total Cobrado Empresa" são armazenados.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Lotes recentes</CardTitle></CardHeader>
        <CardContent>
          {batches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lote ainda.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Arquivo</TableHead>
                <TableHead>Competência</TableHead>
                <TableHead>Mês relatório</TableHead>
                <TableHead className="text-right">Itens</TableHead>
                <TableHead className="text-right">Soma</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {batches.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-mono text-xs">{b.source_file_name}</TableCell>
                    <TableCell>{b.competence_month ? formatMonthPtBR(toMonthISO(b.competence_month)) : "—"}</TableCell>
                    <TableCell>{b.billing_month ? formatMonthPtBR(toMonthISO(b.billing_month)) : "—"}</TableCell>
                    <TableCell className="text-right">{b.total_items ?? 0}</TableCell>
                    <TableCell className="text-right">{centsToMoney(b.total_amount_cents ?? 0)}</TableCell>
                    <TableCell>{statusBadge(b.status)}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/importacoes/$id" params={{ id: b.id }}>Abrir</Link>
                      </Button>
                      {b.status !== "confirmed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (confirm(`Apagar definitivamente o lote "${b.source_file_name}"? Esta ação não pode ser desfeita.`)) {
                              deleteMut.mutate(b.id);
                            }
                          }}
                          title="Apagar lote"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
