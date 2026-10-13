import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } =
      mode === "in"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if (mode === "up" && !data.session) toast.success("Confira seu e-mail para confirmar a conta.");
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) toast.error("Não foi possível entrar com Google.");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-6xl font-extrabold uppercase leading-none text-primary">Rota Moto</h1>
        <p className="mt-2 text-muted-foreground">Suas entregas, seu trajeto real gravado rua por rua.</p>
        <form onSubmit={submit} className="mt-8 space-y-3">
          <Input type="email" required placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
          <Input type="password" required minLength={6} placeholder="Senha" value={password} onChange={(e) => setPassword(e.target.value)} className="h-12" />
          <Button type="submit" disabled={loading} className="h-12 w-full text-base font-bold">
            {mode === "in" ? "Entrar" : "Criar conta"}
          </Button>
        </form>
        <Button variant="secondary" onClick={google} className="mt-3 h-12 w-full">Continuar com Google</Button>
        <button onClick={() => setMode(mode === "in" ? "up" : "in")} className="mt-5 w-full text-sm text-muted-foreground underline">
          {mode === "in" ? "Não tem conta? Criar agora" : "Já tenho conta"}
        </button>
      </div>
    </main>
  );
}
