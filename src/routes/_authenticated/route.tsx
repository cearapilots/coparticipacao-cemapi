import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getMyRoles } from "@/lib/settings.functions";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  Wrench,
  ClipboardCheck,
  Settings,
  LogOut,
  Upload,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});

// Fluxo mensal padrão (visível para rh/admin/leitura).
const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/colaboradores", label: "Colaboradores", icon: Users },
  { to: "/importacoes", label: "Importações", icon: Upload },
  { to: "/fechamento", label: "Fechamento mensal", icon: ClipboardCheck },
] as const;

// Ferramentas administrativas: ajuste manual pontual e configuração do
// sistema. "Saldo inicial" não entra aqui — só foi necessária para a carga
// de 07/2026 e não faz parte do fluxo operacional a partir da UNIMED.
const adminNav = [
  { to: "/lancamentos", label: "Ajustes manuais", icon: Wrench },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
] as const;

function AuthenticatedLayout() {
  const router = useRouter();
  const [email, setEmail] = useState<string>("");
  const fetchRoles = useServerFn(getMyRoles);
  const { data: myRoles = [] } = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles() });
  const isAdmin = myRoles.includes("admin");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.navigate({ to: "/auth", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="w-64 border-r bg-background flex flex-col">
        <div className="p-4 border-b">
          <h1 className="font-semibold text-lg">Coparticipação</h1>
          <p className="text-xs text-muted-foreground">UNIMED · RH</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              activeProps={{ className: "bg-accent text-accent-foreground" }}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
          {isAdmin && (
            <>
              <div className="pt-3 pb-1 px-3 text-[11px] font-medium uppercase text-muted-foreground tracking-wide">
                Administração
              </div>
              {adminNav.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeProps={{ className: "bg-accent text-accent-foreground" }}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent transition-colors"
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
            </>
          )}
        </nav>
        <div className="p-3 border-t space-y-2">
          <div className="text-xs text-muted-foreground truncate" title={email}>{email}</div>
          <Button variant="outline" size="sm" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-4 w-4 mr-2" />Sair
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="max-w-7xl mx-auto p-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
