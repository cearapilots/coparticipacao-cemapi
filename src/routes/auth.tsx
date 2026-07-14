import { createFileRoute, useRouter, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import { HeartPulse } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/" });
  },
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    router.navigate({ to: "/" });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { full_name: fullName },
        emailRedirectTo: `${window.location.origin}/`,
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Conta criada! Faça login.");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-linear-to-b from-muted/40 to-muted/10 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="items-center text-center space-y-2">
          <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <HeartPulse className="h-6 w-6" />
          </div>
          <CardTitle className="text-xl">Coparticipação UNIMED</CardTitle>
          <CardDescription>Controle de parcelamento e folha — RH</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Cadastrar</TabsTrigger>
            </TabsList>
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-3 mt-4">
                <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div><Label>Senha</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Spinner className="mr-2" />}{loading ? "Entrando..." : "Entrar"}
                </Button>
              </form>
            </TabsContent>
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-3 mt-4">
                <div><Label>Nome completo</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} required /></div>
                <div><Label>E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
                <div><Label>Senha</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} /></div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading && <Spinner className="mr-2" />}{loading ? "Criando..." : "Cadastrar"}
                </Button>
                <p className="text-xs text-muted-foreground">O primeiro usuário cadastrado vira admin automaticamente.</p>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
