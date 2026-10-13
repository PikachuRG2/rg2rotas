import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { AuthScreen } from "@/components/AuthScreen";
import { DeliveryMap } from "@/components/DeliveryMap";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Rota Moto — mapa inteligente de entregas" },
      { name: "description", content: "Busque endereços, planeje e grave o trajeto real das suas entregas de moto." },
      { property: "og:title", content: "Rota Moto — mapa inteligente de entregas" },
      { property: "og:description", content: "Busque endereços, planeje e grave o trajeto real das suas entregas de moto." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div className="min-h-screen bg-background" />;
  if (!session) return <AuthScreen />;
  return <DeliveryMap />;
}
