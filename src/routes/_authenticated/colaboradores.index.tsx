import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEmployees, upsertEmployee } from "@/lib/employees.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useState, useMemo } from "react";
import { Plus, Search } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/colaboradores/")({
  component: EmployeesPage,
});

interface EmpForm {
  id?: string;
  full_name: string;
  payroll_code: string;
  registration_number: string;
  role: string;
  section_code: string;
  section_name: string;
  status: "active" | "inactive";
}

const emptyForm: EmpForm = {
  full_name: "", payroll_code: "", registration_number: "",
  role: "", section_code: "", section_name: "", status: "active",
};

function normalize(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function EmployeesPage() {
  const fetchList = useServerFn(listEmployees);
  const upsert = useServerFn(upsertEmployee);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<EmpForm>(emptyForm);

  const { data: employees = [] } = useQuery({ queryKey: ["employees"], queryFn: () => fetchList() });

  const mutation = useMutation({
    mutationFn: (payload: EmpForm) => upsert({ data: payload }),
    onSuccess: () => {
      toast.success(form.id ? "Colaborador atualizado" : "Colaborador criado");
      setDialogOpen(false);
      setForm(emptyForm);
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const filtered = useMemo(() => {
    const s = normalize(search);
    return employees.filter((e: any) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (!s) return true;
      if (normalize(e.full_name).includes(s)) return true;
      if ((e.payroll_code ?? "").toLowerCase().includes(s)) return true;
      if ((e.registration_number ?? "").toLowerCase().includes(s)) return true;
      return (e.aliases ?? []).some((a: any) => a.normalized_alias_name.includes(s));
    });
  }, [employees, search, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 justify-between items-center">
        <div>
          <h1 className="text-2xl font-semibold">Colaboradores</h1>
          <p className="text-sm text-muted-foreground">{employees.length} cadastrados · {filtered.length} exibidos</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) setForm(emptyForm); }}>
          <DialogTrigger asChild>
            <Button onClick={() => setForm(emptyForm)}><Plus className="h-4 w-4 mr-2" />Novo colaborador</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{form.id ? "Editar" : "Novo"} colaborador</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><Label>Nome completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
              <div><Label>Código folha</Label><Input value={form.payroll_code} onChange={(e) => setForm({ ...form, payroll_code: e.target.value })} /></div>
              <div><Label>Matrícula</Label><Input value={form.registration_number} onChange={(e) => setForm({ ...form, registration_number: e.target.value })} /></div>
              <div><Label>Função</Label><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div>
              <div><Label>Cód. seção</Label><Input value={form.section_code} onChange={(e) => setForm({ ...form, section_code: e.target.value })} /></div>
              <div className="col-span-2"><Label>Nome da seção</Label><Input value={form.section_name} onChange={(e) => setForm({ ...form, section_name: e.target.value })} /></div>
              <div><Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancelar</Button>
              <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending || !form.full_name}>
                {mutation.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-64 max-w-sm">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por nome, alias, código ou matrícula" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="active">Ativos</SelectItem>
                <SelectItem value="inactive">Inativos</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Código</TableHead>
              <TableHead>Matrícula</TableHead>
              <TableHead>Função</TableHead>
              <TableHead>Seção</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum colaborador</TableCell></TableRow>
              )}
              {filtered.map((emp: any) => (
                <TableRow key={emp.id}>
                  <TableCell className="font-medium">
                    <Link to="/colaboradores/$id" params={{ id: emp.id }} className="hover:underline">{emp.full_name}</Link>
                  </TableCell>
                  <TableCell>{emp.payroll_code ?? "—"}</TableCell>
                  <TableCell>{emp.registration_number ?? "—"}</TableCell>
                  <TableCell>{emp.role ?? "—"}</TableCell>
                  <TableCell>{emp.section_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={emp.status === "active" ? "default" : "secondary"}>
                      {emp.status === "active" ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/colaboradores/$id" params={{ id: emp.id }}>Histórico</Link>
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => {
                      setForm({
                        id: emp.id, full_name: emp.full_name,
                        payroll_code: emp.payroll_code ?? "", registration_number: emp.registration_number ?? "",
                        role: emp.role ?? "", section_code: emp.section_code ?? "",
                        section_name: emp.section_name ?? "", status: emp.status as any,
                      });
                      setDialogOpen(true);
                    }}>Editar</Button>
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
