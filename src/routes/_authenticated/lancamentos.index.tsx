import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listRecentUsages } from "@/lib/closing.functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { centsToMoney } from "@/lib/calc/money";
import { formatMonthPtBR } from "@/lib/calc/date";
import { sourceLabel } from "@/lib/labels";
import { Loading } from "@/components/ui/spinner";
import { Plus, Search, AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/lancamentos/")({
  component: LaunchesIndex,
});

function LaunchesIndex() {
  const fetchList = useServerFn(listRecentUsages);
  const { data = [], isLoading } = useQuery({
    queryKey: ["recent-usages"],
    queryFn: () => fetchList(),
  });
  const [q, setQ] = useState("");
  const filtered = data.filter((u: any) =>
    !q || (u.employees?.full_name ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">Ajustes manuais</h1>
          <p className="text-sm text-muted-foreground">Últimos 100 lançamentos de coparticipação.</p>
        </div>
        <Button asChild>
          <Link to="/lancamentos/novo"><Plus className="h-4 w-4 mr-2" />Novo lançamento</Link>
        </Button>
      </div>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Ferramenta administrativa, não o fluxo mensal padrão</AlertTitle>
        <AlertDescription>
          A partir de agosto/2026 os valores mensais entram pelo PDF da UNIMED (tela Importações).
          Use lançamento manual apenas para correções e ajustes pontuais.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar por colaborador" value={q} onChange={(e) => setQ(e.target.value)} className="pl-8" />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Colaborador</TableHead>
              <TableHead>Competência</TableHead>
              <TableHead className="text-right">Valor novo</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={7} className="py-6"><Loading /></TableCell></TableRow>}
              {!isLoading && filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">Nenhum lançamento</TableCell></TableRow>}
              {filtered.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.employees?.full_name ?? "—"}</TableCell>
                  <TableCell>{formatMonthPtBR(u.competence_month)}</TableCell>
                  <TableCell className="text-right">{centsToMoney(u.amount_cents)}</TableCell>
                  <TableCell><Badge variant="secondary">{sourceLabel(u.source_type)}</Badge></TableCell>
                  <TableCell><Badge variant="outline">{u.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/colaboradores/$id" params={{ id: u.employee_id }}>Abrir</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

