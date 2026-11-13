import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

import { Button } from "@/components/ui/button";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

const DISMISS_KEY = "rota-moto-install-dismissed";

/**
 * Install-on-phone notice. Android/Chrome fires `beforeinstallprompt`, so we
 * show an "Instalar" button. iOS never fires it, so we show the manual steps
 * (Compartilhar → Adicionar à Tela de Início). Hidden once the app is already
 * running from the home screen.
 */
export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed) return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);

    const isIos =
      /iP(hone|od|ad)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIos) {
      setIosHint(true);
      setVisible(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible || (!promptEvent && !iosHint)) return null;

  const hide = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage blocked — the notice just comes back on the next visit.
    }
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    try {
      await promptEvent.userChoice;
    } catch {
      // Older browsers may not resolve userChoice; nothing to do about it.
    }
    setPromptEvent(null);
    hide();
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3">
      <Download className="h-5 w-5 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 text-sm leading-snug">
        {promptEvent ? (
          <>Instale o Rota Moto no celular para abrir pelo ícone, sem navegador.</>
        ) : (
          <>
            No iPhone: toque em <strong>Compartilhar</strong> e depois em{" "}
            <strong>Adicionar à Tela de Início</strong>.
          </>
        )}
      </p>
      {promptEvent ? (
        <Button size="sm" onClick={install}>
          Instalar
        </Button>
      ) : null}
      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={hide} aria-label="Fechar aviso de instalação">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
