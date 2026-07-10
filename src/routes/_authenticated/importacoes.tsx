import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Upload, FileText, CheckCircle2, ListChecks, PlayCircle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/importacoes")({
  component: ImportsPage,
});

const steps = [
  { icon: Upload, title: "1. Upload do PDF", desc: "RH envia o PDF de faturamento UNIMED do mês." },
  { icon: FileText, title: "2. Extração (staging)", desc: "Sistema lê 'Titular' e 'Total da Família' e grava em import_items." },
  { icon: ListChecks, title: "3. Matching de nomes", desc: "Cruza cada linha com colaboradores e aliases cadastrados." },
  { icon: CheckCircle2, title: "4. Revisão manual", desc: "RH confirma matches ambíguos e ajusta valores se necessário." },
  { icon: PlayCircle, title: "5. Geração dos lançamentos", desc: "Ao confirmar o lote, cria monthly_usage + planos de parcelamento." },
];

function ImportsPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Importações</h1>
        <p className="text-sm text-muted-foreground">
          Importação automática do PDF da UNIMED.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Status</CardTitle>
            <Badge variant="secondary">Em preparação</Badge>
          </div>
          <CardDescription>
            A importação de PDF será implementada em etapa posterior. A estrutura de staging
            (<code className="text-xs">import_batches</code> e <code className="text-xs">import_items</code>) já está pronta no banco.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Fluxo futuro</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {steps.map((s) => (
            <div key={s.title} className="flex gap-3 items-start border rounded-md p-3">
              <s.icon className="h-5 w-5 mt-0.5 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-sm">{s.title}</div>
                <div className="text-sm text-muted-foreground">{s.desc}</div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Enquanto isso</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use a tela <b>Lançamentos → Novo lançamento</b> para registrar coparticipações manualmente
          e <b>Saldo inicial</b> para carregar dívidas anteriores ao sistema.
        </CardContent>
      </Card>
    </div>
  );
}
