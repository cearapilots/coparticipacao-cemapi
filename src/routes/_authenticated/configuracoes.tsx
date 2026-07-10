import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listSettings, updateSetting, getMyRoles, listUsers, setUserRole } from "@/lib/settings.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { centsToMoney, moneyToCents } from "@/lib/calc/money";

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
        </TabsList>

        <TabsContent value="params" className="space-y-4 mt-4">
          <ParamsPanel isAdmin={isAdmin} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="users" className="mt-4">
            <UsersPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
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
