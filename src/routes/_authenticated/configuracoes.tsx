import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listSettings, updateSetting, getMyRoles, listUsers, setUserRole } from "@/lib/settings.functions";
import { listAuditLog } from "@/lib/audit.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { centsToMoney, moneyToCents } from "@/lib/calc/money";

function auditActionLabel(a: string): string {
  const map: Record<string, string> = {
    "setting.update": "Alterou configuração",
    "role.grant": "Concedeu papel",
    "role.revoke": "Removeu papel",
    "employee.create": "Cadastrou colaborador",
    "employee.update": "Editou colaborador",
    "usage.create": "Criou lançamento",
    "usage.create.retroactive_adjustment": "Lançamento (ajuste retroativo)",
    "opening_balance.create": "Cadastrou saldo inicial",
    "installments.renegotiate": "Re-parcelou saldo",
    "cap_override.set": "Ajustou teto do mês",
    "cap_override.remove": "Removeu teto do mês",
    "import.batch.create": "Criou lote de importação",
    "import.batch.confirm": "Confirmou lote",
    "import.batch.cancel": "Cancelou lote",
    "import.batch.delete": "Apagou lote",
    "import.pre_marker_override": "Override de competência (marco)",
    "import_item.amount_correct": "Corrigiu valor do item",
    "import_item.amount_correction_clear": "Reverteu valor do item",
    "import_item.installments_override": "Alterou parcelas do item",
    "import_item.installments_clear": "Reverteu parcelas do item",
    "month.close": "Fechou mês",
    "payroll.xlsx.preview": "Gerou XLSX (prévia)",
    "payroll.xlsx.generate": "Gerou XLSX (oficial)",
    "employee_statement.generate": "Gerou demonstrativo PDF",
    "employee_statement.delete": "Apagou demonstrativo PDF",
  };
  return map[a] ?? a;
}

export const Route = createFileRoute("/_authenticated/configuracoes")({
  component: SettingsPage,
});

function SettingsPage() {
  const fetchRoles = useServerFn(getMyRoles);
  const { data: myRoles = [] } = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles() });
  const isAdmin = myRoles.includes("admin");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? "Você é admin — pode alterar configurações e papéis." : "Apenas leitura. Somente admin pode alterar."}
        </p>
      </div>

      <Tabs defaultValue="params">
        <TabsList>
          <TabsTrigger value="params">Parâmetros</TabsTrigger>
          {isAdmin && <TabsTrigger value="users">Usuários e papéis</TabsTrigger>}
          {isAdmin && <TabsTrigger value="audit">Auditoria</TabsTrigger>}
        </TabsList>

        <TabsContent value="params" className="space-y-4 mt-4">
          <ParamsPanel isAdmin={isAdmin} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="users" className="mt-4">
            <UsersPanel />
          </TabsContent>
        )}

        {isAdmin && (
          <TabsContent value="audit" className="mt-4">
            <AuditPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function AuditPanel() {
  const fetchAudit = useServerFn(listAuditLog);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["audit-log"],
    queryFn: () => fetchAudit({ data: { limit: 200 } }),
  });
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<any | null>(null);

  const filtered = (rows as any[]).filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      auditActionLabel(r.action).toLowerCase().includes(s) ||
      (r.action ?? "").toLowerCase().includes(s) ||
      (r.entity_type ?? "").toLowerCase().includes(s) ||
      (r.actor_email ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap gap-2 justify-between items-center">
          <div>
            <CardTitle className="text-base">Trilha de auditoria</CardTitle>
            <CardDescription>Últimas 200 ações registradas. Somente leitura.</CardDescription>
          </div>
          <Input placeholder="Filtrar (ação, usuário, entidade)" value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : (
          <Table>
            <TableHeader><TableRow>
              <TableHead>Data/hora</TableHead>
              <TableHead>Usuário</TableHead>
              <TableHead>Ação</TableHead>
              <TableHead>Entidade</TableHead>
              <TableHead></TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">Nenhum registro</TableCell></TableRow>
              )}
              {filtered.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(r.created_at).toLocaleString("pt-BR")}</TableCell>
                  <TableCell className="text-xs">{r.actor_email ?? <span className="text-muted-foreground">sistema</span>}</TableCell>
                  <TableCell><Badge variant="outline">{auditActionLabel(r.action)}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{r.entity_type}</TableCell>
                  <TableCell className="text-right">
                    {(r.before_snapshot || r.after_snapshot) && (
                      <Button variant="ghost" size="sm" onClick={() => setDetail(r)}>Detalhes</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detail ? auditActionLabel(detail.action) : ""}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-3 text-xs">
              <div className="text-muted-foreground">
                {new Date(detail.created_at).toLocaleString("pt-BR")} · {detail.actor_email ?? "sistema"} · {detail.entity_type}
                {detail.entity_id ? ` · ${detail.entity_id}` : ""}
              </div>
              {detail.before_snapshot && (
                <div>
                  <div className="font-medium mb-1">Antes</div>
                  <pre className="bg-muted/40 rounded-md p-2 overflow-x-auto">{JSON.stringify(detail.before_snapshot, null, 2)}</pre>
                </div>
              )}
              {detail.after_snapshot && (
                <div>
                  <div className="font-medium mb-1">Depois</div>
                  <pre className="bg-muted/40 rounded-md p-2 overflow-x-auto">{JSON.stringify(detail.after_snapshot, null, 2)}</pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ParamsPanel({ isAdmin }: { isAdmin: boolean }) {
  const fetchList = useServerFn(listSettings);
  const update = useServerFn(updateSetting);
  const qc = useQueryClient();
  const { data: settings = [] } = useQuery({ queryKey: ["settings"], queryFn: () => fetchList() });

  const [cap, setCap] = useState("");
  const [thresholds, setThresholds] = useState("");
  const [company, setCompany] = useState("");
  const [layout, setLayout] = useState("");

  useEffect(() => {
    for (const s of settings) {
      if (s.setting_key === "monthly_cap_cents") setCap(String(s.setting_value ?? ""));
      if (s.setting_key === "installment_thresholds") setThresholds(JSON.stringify(s.setting_value, null, 2));
      if (s.setting_key === "company_name") setCompany(typeof s.setting_value === "string" ? s.setting_value : "");
      if (s.setting_key === "export_layout_version") setLayout(typeof s.setting_value === "string" ? s.setting_value : "");
    }
  }, [settings]);

  async function save(key: string, value: any) {
    try {
      await update({ data: { setting_key: key, setting_value: value } });
      toast.success("Salvo");
      qc.invalidateQueries({ queryKey: ["settings"] });
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Teto mensal por colaborador</CardTitle>
          <CardDescription>Atual: {centsToMoney(Number(cap) || 0)}</CardDescription></CardHeader>
        <CardContent className="flex gap-2 items-end">
          <div className="flex-1"><Label>Valor (R$)</Label>
            <Input placeholder="700,00" onChange={(e) => setCap(String(moneyToCents(e.target.value)))} defaultValue={((Number(cap)||0)/100).toString().replace(".",",")} />
          </div>
          <Button disabled={!isAdmin} onClick={() => save("monthly_cap_cents", Number(cap))}>Salvar</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Faixas de parcelamento</CardTitle>
          <CardDescription>Valores em centavos. Cuidado ao editar o JSON.</CardDescription></CardHeader>
        <CardContent className="space-y-2">
          <Textarea rows={10} value={thresholds} onChange={(e) => setThresholds(e.target.value)} className="font-mono text-xs" />
          <Button disabled={!isAdmin} onClick={() => {
            try { save("installment_thresholds", JSON.parse(thresholds)); }
            catch { toast.error("JSON inválido"); }
          }}>Salvar faixas</Button>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Nome da empresa</CardTitle></CardHeader>
          <CardContent className="flex gap-2 items-end">
            <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            <Button disabled={!isAdmin} onClick={() => save("company_name", company)}>Salvar</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Versão do layout de exportação</CardTitle></CardHeader>
          <CardContent className="flex gap-2 items-end">
            <Input value={layout} onChange={(e) => setLayout(e.target.value)} />
            <Button disabled={!isAdmin} onClick={() => save("export_layout_version", layout)}>Salvar</Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function UsersPanel() {
  const fetchList = useServerFn(listUsers);
  const setRole = useServerFn(setUserRole);
  const qc = useQueryClient();
  const { data: users = [] } = useQuery({ queryKey: ["users-list"], queryFn: () => fetchList() });

  const toggleMut = useMutation({
    mutationFn: (p: { user_id: string; role: "admin" | "rh" | "leitura"; grant: boolean }) => setRole({ data: p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users-list"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const roles: Array<"admin" | "rh" | "leitura"> = ["admin", "rh", "leitura"];

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Usuários</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Usuário</TableHead>
            {roles.map((r) => <TableHead key={r} className="text-center">{r}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {users.map((u: any) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.full_name || u.email}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </TableCell>
                {roles.map((r) => {
                  const has = (u.roles ?? []).includes(r);
                  return (
                    <TableCell key={r} className="text-center">
                      <Checkbox
                        checked={has}
                        onCheckedChange={(v) => toggleMut.mutate({ user_id: u.id, role: r, grant: !!v })}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
