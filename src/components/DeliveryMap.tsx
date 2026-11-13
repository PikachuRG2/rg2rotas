/// <reference types="@types/google.maps" />
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { searchPlaces, planRoute, snapPath, reverseGeocode, resolveMapsLink } from "@/lib/maps.functions";
import { parseOrder } from "@/lib/order.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InstallPrompt } from "@/components/InstallPrompt";
import { ArrowUp, CornerUpLeft, CornerUpRight, Flag, Navigation, RotateCcw, RotateCw } from "lucide-react";
import { advanceStep, distanceBetween, navigationDistance, type NavigationPlan } from "@/lib/navigation";
import { parseCoords } from "@/lib/coords";
import { useKeepAwake } from "@/hooks/use-keep-awake";
import { useHeading, requestCompassPermission } from "@/hooks/use-heading";

type LatLng = { lat: number; lng: number };
type Client = { id: string; name: string; street: string; address: string; lat: number; lng: number };
const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
type Stop = { id: string; name: string; address: string; lat: number; lng: number };
type SavedRoute = {
  id: string; name: string; stops: Stop[]; snapped_path: LatLng[]; raw_path: LatLng[];
  distance_m: number; started_at: string | null; ended_at: string | null; created_at: string;
};

const REC_KEY = "rotamoto-recording";
const COLORS = { plan: "#7aa7ff", live: "#ff8a3d", snapped: "#f5c518", stop: "#2fd07a" };

function loadMaps(): Promise<void> {
  const w = window as unknown as Record<string, unknown>;
  if (w["google"] && (w["google"] as { maps?: unknown }).maps) return Promise.resolve();
  if (w["__mapsPromise"]) return w["__mapsPromise"] as Promise<void>;
  const p = new Promise<void>((resolve, reject) => {
    w["__initRotaMoto"] = () => resolve();
    const env = import.meta.env as Record<string, string>;
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"]}&libraries=geometry&loading=async&callback=__initRotaMoto&channel=${env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"]}&language=pt-BR`;
    s.async = true;
    s.onerror = () => reject(new Error("Falha ao carregar o mapa"));
    document.head.appendChild(s);
  });
  w["__mapsPromise"] = p;
  return p;
}

function haversine(a: LatLng, b: LatLng) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLng = (b.lng - a.lng) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const pathLength = (p: LatLng[]) => p.reduce((s, c, i) => { const previous = p[i - 1]; return previous ? s + haversine(previous, c) : s; }, 0);
const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

export function DeliveryMap() {
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const meMarker = useRef<google.maps.Marker | null>(null);
  const planLine = useRef<google.maps.Polyline | null>(null);
  const liveLine = useRef<google.maps.Polyline | null>(null);
  const snapLine = useRef<google.maps.Polyline | null>(null);
  const watchId = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<LatLng | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Stop[]>([]);
  const [searching, setSearching] = useState(false);
  const [stops, setStops] = useState<Stop[]>([]);
  const [plan, setPlan] = useState<NavigationPlan | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [recording, setRecording] = useState(false);
  const [raw, setRaw] = useState<LatLng[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [tab, setTab] = useState<"entregas" | "clientes" | "historico">("entregas");
  const [clients, setClients] = useState<Client[]>([]);
  const [clientName, setClientName] = useState("");
  const [savingClient, setSavingClient] = useState(false);
  const doReverse = useServerFn(reverseGeocode);
  const doResolve = useServerFn(resolveMapsLink);
  const doParseOrder = useServerFn(parseOrder);
  const [orderText, setOrderText] = useState("");
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderNote, setOrderNote] = useState("");
  const [open, setOpen] = useState(true);

  const doSearch = useServerFn(searchPlaces);
  const doPlan = useServerFn(planRoute);
  const doSnap = useServerFn(snapPath);

  // Mantém a tela acesa enquanto o app estiver aberto em primeiro plano.
  useKeepAwake(true);
  const compass = useHeading(recording);
  const [gpsHeading, setGpsHeading] = useState<number | null>(null);
  const heading = recording ? compass ?? gpsHeading ?? 0 : 0;

  useEffect(() => {
    if (!recording || !me || !plan) return;
    setStepIndex((current) => advanceStep(plan.steps, current, me));
  }, [recording, me, plan]);

  // Map init
  useEffect(() => {
    let cancelled = false;
    loadMaps().then(() => {
      if (cancelled || !mapEl.current) return;
      map.current = new google.maps.Map(mapEl.current, {
        center: { lat: -23.55, lng: -46.63 }, zoom: 14, clickableIcons: false,
        disableDefaultUI: true, zoomControl: true, gestureHandling: "greedy",
        styles: [
          { elementType: "geometry", stylers: [{ color: "#1d2129" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#9aa3b2" }] },
          { elementType: "labels.text.stroke", stylers: [{ color: "#1d2129" }] },
          { featureType: "road", elementType: "geometry", stylers: [{ color: "#3a404c" }] },
          { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#59606e" }] },
          { featureType: "water", stylers: [{ color: "#0f1a2a" }] },
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] },
        ],
      });
      setReady(true);
    }).catch((e) => toast.error(e.message));
    return () => { cancelled = true; };
  }, []);

  // Locate me (one-shot) for search bias and centering
  useEffect(() => {
    if (!ready || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMe(pos);
        map.current?.setCenter(pos);
      },
      () => toast("Ative a localização para gravar seu trajeto."),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, [ready]);

  // My position marker
  useEffect(() => {
    if (!ready || !me || !map.current) return;
    const icon: google.maps.Symbol = recording
      ? { path: "M0,-14 L10,10 L0,4 L-10,10 Z", scale: 1.6, fillColor: "#4ea1ff", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 2.5, rotation: heading, anchor: new google.maps.Point(0, 0) }
      : { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#4ea1ff", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 };
    if (!meMarker.current) {
      meMarker.current = new google.maps.Marker({ map: map.current, position: me, zIndex: 999, icon });
    } else { meMarker.current.setPosition(me); meMarker.current.setIcon(icon); }
  }, [ready, me, recording, heading]);

  // Stop markers
  useEffect(() => {
    if (!ready || !map.current) return;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = stops.map((s, i) => new google.maps.Marker({
      map: map.current, position: s, title: s.name,
      label: { text: String(i + 1), color: "#111", fontWeight: "700" },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: COLORS.stop, fillOpacity: 1, strokeColor: "#111", strokeWeight: 2 },
    }));
  }, [ready, stops]);

  // Live recorded line
  useEffect(() => {
    if (!ready || !map.current) return;
    if (!liveLine.current) liveLine.current = new google.maps.Polyline({ map: map.current, strokeColor: COLORS.live, strokeOpacity: 0.9, strokeWeight: 5 });
    liveLine.current.setPath(raw);
  }, [ready, raw]);

  const loadRoutes = useCallback(async () => {
    const { data, error } = await supabase.from("delivery_routes").select("*").order("created_at", { ascending: false }).limit(50);
    if (error) { toast.error(error.message); return; }
    setRoutes((data ?? []) as unknown as SavedRoute[]);
  }, []);
  useEffect(() => { loadRoutes(); }, [loadRoutes]);

  // Resume an interrupted recording
  useEffect(() => {
    const saved = localStorage.getItem(REC_KEY);
    if (!saved) return;
    try {
      const s = JSON.parse(saved) as { raw: LatLng[]; stops: Stop[]; startedAt: string };
      setRaw(s.raw); setStops(s.stops); setStartedAt(s.startedAt);
      startWatch();
      toast("Gravação retomada.");
    } catch { localStorage.removeItem(REC_KEY); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (recording && startedAt) localStorage.setItem(REC_KEY, JSON.stringify({ raw, stops, startedAt }));
  }, [recording, raw, stops, startedAt]);

  const loadClients = useCallback(async () => {
    const { data } = await supabase.from("clients").select("id,name,street,address,lat,lng").order("name");
    setClients(data ?? []);
  }, []);
  useEffect(() => { loadClients(); }, [loadClients]);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: ok } = await supabase.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
      setIsAdmin(!!ok);
    });
  }, []);

  async function saveClient() {
    const name = clientName.trim();
    if (!name) { toast.error("Digite o nome do cliente."); return; }
    if (!navigator.geolocation) { toast.error("GPS indisponível."); return; }
    setSavingClient(true);
    try {
      const p = await new Promise<GeolocationPosition>((ok, fail) =>
        navigator.geolocation.getCurrentPosition(ok, fail, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }));
      const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
      let addr = { address: "", street: "" };
      try { addr = await doReverse({ data: pos }); } catch { /* keep coords */ }
      const { error } = await supabase.from("clients").insert({ name: name.slice(0, 100), ...addr, ...pos });
      if (error) throw error;
      toast.success(`${name} salvo${p.coords.accuracy > 30 ? ` (precisão ${Math.round(p.coords.accuracy)} m)` : ""}`);
      setClientName("");
      loadClients();
    } catch (err) { toast.error((err as Error).message || "Não consegui pegar sua localização."); }
    setSavingClient(false);
  }

  async function deleteClient(id: string) {
    await supabase.from("clients").delete().eq("id", id);
    setClients((c) => c.filter((x) => x.id !== id));
  }

  async function routeToClient(c: Client) {
    const s: Stop = { id: `client-${c.id}`, name: `👤 ${c.name}`, address: c.address || c.street, lat: c.lat, lng: c.lng };
    const list = stops.some((p) => p.id === s.id) ? stops : [...stops, s];
    setStops(list); setResults([]); setQuery(""); setTab("entregas");
    await optimize(list);
  }

  const q = norm(query.trim());
  const matchedClients = q.length >= 2 ? clients.filter((c) => norm(`${c.name} ${c.street} ${c.address}`).includes(q)).slice(0, 8) : [];

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 3) return;
    setSearching(true);
    try {
      let text = query.trim();
      if (/^https:\/\/(maps\.app\.)?goo\.gl\//.test(text)) {
        text = (await doResolve({ data: { url: text } })).url;
      }
      const c = parseCoords(text);
      if (!c && text !== query.trim()) throw new Error("Não achei a localização nesse link.");
      if (c) {
        let addr = { address: "", street: "" };
        try { addr = await doReverse({ data: c }); } catch { /* keep coords */ }
        setResults([{ id: `coord-${c.lat},${c.lng}`, name: addr.street || "Coordenada", address: addr.address || `${c.lat.toFixed(6)}, ${c.lng.toFixed(6)}`, ...c }]);
      } else
      setResults(await doSearch({ data: { query, ...(me ? { bias: me } : {}) } }));
    } catch (err) { toast.error((err as Error).message); }
    setSearching(false);
  }

  async function readOrder() {
    if (orderText.trim().length < 10) { toast.error("Cole o texto completo do pedido."); return; }
    setOrderBusy(true);
    try {
      const parsed = await doParseOrder({ data: { text: orderText } });
      setOrderNote(parsed.instructions.trim());
      setQuery(parsed.address);
      setResults(await doSearch({ data: { query: parsed.address, ...(me ? { bias: me } : {}) } }));
      toast.success("Endereço encontrado! Toque no resultado para adicionar.");
    } catch (err) { toast.error((err as Error).message); }
    setOrderBusy(false);
  }

  function addStop(s: Stop) {
    setStops((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
    setResults([]); setQuery(""); setPlan(null);
    clearLines();
    map.current?.panTo(s);
  }

  function clearLines() {
    planLine.current?.setMap(null); planLine.current = null;
    snapLine.current?.setMap(null); snapLine.current = null;
  }

  async function optimize(list: Stop[] = stops) {
    if (!me) { toast.error("Preciso da sua localização para planejar."); return false; }
    if (!list.length || !ready || !map.current) return false;
    setBusy(true);
    try {
      const r = await doPlan({ data: { origin: me, stops: list.map(({ lat, lng }) => ({ lat, lng })) } });
      setStops(r.order.map((i) => list[i]).filter((x): x is Stop => !!x));
      clearLines();
      planLine.current = new google.maps.Polyline({
        map: map.current, path: google.maps.geometry.encoding.decodePath(r.polyline),
        strokeColor: COLORS.plan, strokeOpacity: 1, strokeWeight: 7, zIndex: 20,
        icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, fillColor: COLORS.plan, fillOpacity: 1, strokeColor: getComputedStyle(document.documentElement).getPropertyValue("--route-arrow").trim(), strokeOpacity: 1, strokeWeight: 2, scale: 3 }, offset: "35px", repeat: "90px" }],
      });
      const b = new google.maps.LatLngBounds();
      planLine.current.getPath().forEach((p) => b.extend(p));
      map.current?.fitBounds(b, 60);
      setPlan(r);
      setStepIndex(0);
      return true;
    } catch (err) { toast.error((err as Error).message); return false; }
    finally { setBusy(false); }
  }

  function startWatch() {
    if (!navigator.geolocation) { toast.error("Seu aparelho não tem GPS disponível."); return; }
    setRecording(true);
    void requestCompassPermission();
    map.current?.setZoom(18);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        if (p.coords.accuracy > 35) return; // ignore imprecise fixes
        setMe(pos);
        if (p.coords.heading !== null && !Number.isNaN(p.coords.heading) && (p.coords.speed ?? 0) > 2) setGpsHeading(p.coords.heading);
        setRaw((prev) => {
          const last = prev[prev.length - 1];
          if (last && haversine(last, pos) < 6) return prev;
          return [...prev, pos];
        });
        map.current?.panTo(pos);
      },
      (err) => toast.error(`GPS: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  async function start() {
    if (!ready) return;
    if (stops.length && !plan && !(await optimize())) return;
    snapLine.current?.setMap(null); snapLine.current = null;
    setRaw(me ? [me] : []);
    setStartedAt(new Date().toISOString());
    startWatch();
    setOpen(false);
  }

  async function finish() {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    watchId.current = null;
    setRecording(false);
    if (raw.length < 2) {
      localStorage.removeItem(REC_KEY);
      setRaw([]);
      { toast("Trajeto muito curto, nada foi salvo."); return; }
    }
    setBusy(true);
    let snapped: LatLng[] = raw;
    try {
      snapped = await doSnap({ data: { points: raw } });
    } catch (err) {
      toast.error(`Não consegui alinhar às ruas: ${(err as Error).message}. Salvando trajeto do GPS.`);
    }
    const name = stops.length ? stops.map((s) => s.name).slice(0, 2).join(" → ") : "Trajeto livre";
    const { error } = await supabase.from("delivery_routes").insert({
      name, stops, raw_path: raw, snapped_path: snapped, distance_m: pathLength(snapped),
      started_at: startedAt, ended_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    localStorage.removeItem(REC_KEY);
    drawSnapped(snapped);
    setRaw([]); setStops([]); setPlan(null); setStepIndex(0);
    toast.success("Rota salva!");
    loadRoutes();
  }

  function drawSnapped(path: LatLng[]) {
    if (!map.current) return;
    clearLines();
    snapLine.current = new google.maps.Polyline({ map: map.current, path, strokeColor: COLORS.snapped, strokeOpacity: 1, strokeWeight: 6, zIndex: 10 });
    const b = new google.maps.LatLngBounds();
    path.forEach((p) => b.extend(p));
    if (path.length) map.current?.fitBounds(b, 60);
  }

  function showRoute(r: SavedRoute) {
    if (!map.current || recording) return;
    setPlan(null);
    drawSnapped(r.snapped_path?.length ? r.snapped_path : r.raw_path);
    markers.current.forEach((m) => m.setMap(null));
    markers.current = (r.stops ?? []).map((s, i) => new google.maps.Marker({
      map: map.current, position: s, label: { text: String(i + 1), color: "#111", fontWeight: "700" },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: COLORS.stop, fillOpacity: 1, strokeColor: "#111", strokeWeight: 2 },
    }));
    setOpen(false);
  }

  async function removeRoute(id: string) {
    const { error } = await supabase.from("delivery_routes").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    clearLines();
    loadRoutes();
  }

  const recDistance = pathLength(raw);
  const currentStep = plan?.steps[stepIndex];
  const nextStep = plan?.steps[stepIndex + 1];
  const guidance = recording ? nextStep ?? currentStep : currentStep;
  const distanceToTurn = recording && currentStep && me ? distanceBetween(me, currentStep.end) : null;
  const arrived = recording && !!plan?.steps.length && stepIndex >= plan.steps.length;
  const maneuver = guidance?.maneuver ?? "";
  const DirectionIcon = arrived ? Flag : maneuver.includes("U_TURN") ? (maneuver.includes("LEFT") ? RotateCcw : RotateCw)
    : maneuver.includes("LEFT") ? CornerUpLeft : maneuver.includes("RIGHT") ? CornerUpRight : ArrowUp;

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      <div
        ref={mapEl}
        className="absolute left-1/2 top-1/2 transition-transform duration-300 ease-out"
        style={recording
          ? { width: "150vmax", height: "150vmax", transform: `translate(-50%, -50%) rotate(${-heading}deg)` }
          : { width: "100%", height: "100%", transform: "translate(-50%, -50%)" }}
      />

      {/* Top bar */}
      <header className="absolute left-3 right-3 top-3 z-10 flex items-center justify-between gap-2">
        <span className="rounded-lg bg-card/90 px-3 py-1.5 font-display text-2xl font-extrabold uppercase text-primary shadow-panel backdrop-blur">Rota Moto</span>
        <Button variant="secondary" size="sm" onClick={() => supabase.auth.signOut()}>Sair</Button>
      </header>

      {(guidance || arrived) && (
        <aside aria-label="Próxima direção" aria-live="polite" className="absolute inset-x-3 top-16 z-10 mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-border bg-card/95 p-3 shadow-panel">
          <DirectionIcon className="h-9 w-9 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-primary">{arrived ? "Destino alcançado" : distanceToTurn !== null ? `${nextStep ? "Em" : "Destino em"} aproximadamente ${navigationDistance(distanceToTurn)}` : "Saída"}</p>
            <p className="text-base font-bold leading-tight">{arrived ? "Fim do caminho planejado" : guidance?.instruction}</p>
          </div>
          <Button variant="secondary" size="icon" aria-label="Centralizar na minha localização" title="Minha localização" onClick={() => { if (me) { map.current?.panTo(me); map.current?.setZoom(18); } }}><Navigation /></Button>
        </aside>
      )}

      {recording && (
        <div className={`absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card/95 px-4 py-2 shadow-panel ${guidance || arrived ? "bottom-24" : "top-16"}`}>
          <span className="rec-pulse h-3 w-3 rounded-full bg-destructive" />
          <span className="font-display text-lg font-bold">GRAVANDO · {km(recDistance)}</span>
        </div>
      )}

      {/* Bottom sheet */}
      <section className="absolute inset-x-0 bottom-0 z-10 mx-auto max-h-[calc(100dvh-12rem)] max-w-xl overflow-y-auto rounded-t-2xl border-t border-border bg-card/95 shadow-panel backdrop-blur md:bottom-4 md:left-4 md:right-auto md:w-[420px] md:rounded-2xl md:border">
        <button onClick={() => setOpen(!open)} className="flex w-full justify-center py-2" aria-label="Abrir painel">
          <span className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
        </button>

        <div className="px-4 pb-4">
          <InstallPrompt />
          {recording ? (
            <Button variant="destructive" disabled={busy} onClick={finish} className="h-14 w-full font-display text-xl font-bold uppercase">
              {busy ? "Alinhando às ruas…" : "Finalizar e salvar rota"}
            </Button>
          ) : (
            <Button disabled={busy || !ready} onClick={start} className="h-14 w-full font-display text-xl font-bold uppercase">
              {busy ? "Calculando caminho…" : `Iniciar trajeto ${stops.length ? `(${stops.length} entregas)` : ""}`}
            </Button>
          )}

          {open && !recording && (
            <div className="mt-4">
              <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1">
                {(["entregas", "clientes", "historico"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`rounded-md py-1.5 text-sm font-semibold capitalize transition ${tab === t ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>
                    {t === "historico" ? "Rotas salvas" : t === "clientes" ? "Clientes" : "Entregas"}
                  </button>
                ))}
              </div>

              {tab === "clientes" ? (
                <div className="space-y-3">
                  {isAdmin ? (<>
                  <p className="text-sm text-muted-foreground">Na porta do cliente, digite o nome e salve. Todos os motoboys vão ver.</p>
                  <div className="flex gap-2">
                    <Input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Nome do cliente…" className="h-11" />
                    <Button onClick={saveClient} disabled={savingClient} className="h-11">{savingClient ? "Salvando…" : "Salvar minha localização"}</Button>
                  </div>
                  </>) : (
                  <p className="text-sm text-muted-foreground">Clientes cadastrados pelo administrador. Toque em um para ver a rota.</p>
                  )}
                  <ul className="max-h-60 space-y-1.5 overflow-auto">
                    {clients.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2">
                        <button onClick={() => routeToClient(c)} className="min-w-0 flex-1 text-left">
                          <div className="truncate font-semibold">{c.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{c.address || `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`}</div>
                        </button>
                        {isAdmin && <button onClick={() => deleteClient(c.id)} className="text-muted-foreground hover:text-destructive" aria-label={`Apagar ${c.name}`}>✕</button>}
                      </li>
                    ))}
                    {!clients.length && <li className="py-2 text-center text-sm text-muted-foreground">Nenhum cliente salvo ainda.</li>}
                  </ul>
                </div>
              ) : tab === "entregas" ? (
                <div className="space-y-3">
                  <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm font-semibold">📋 Colar pedido (iFood, WhatsApp…)</summary>
                    <textarea
                      value={orderText}
                      onChange={(e) => setOrderText(e.target.value)}
                      placeholder="Cole aqui o texto completo do pedido…"
                      rows={4}
                      className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <Button onClick={readOrder} disabled={orderBusy} variant="secondary" className="mt-2 w-full">
                      {orderBusy ? "Lendo pedido…" : "Ler pedido com IA"}
                    </Button>
                  </details>
                  {orderNote && (
                    <p className="rounded-lg border border-primary/50 bg-primary/10 px-3 py-2 text-sm">
                      <b>Instruções de entrega:</b> {orderNote}
                    </p>
                  )}
                  <form onSubmit={search} className="flex gap-2">
                    <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Endereço da entrega…" className="h-11" />
                    <Button type="submit" variant="secondary" disabled={searching} className="h-11">{searching ? "…" : "Buscar"}</Button>
                  </form>
                  {matchedClients.length > 0 && (
                    <ul aria-label="Clientes encontrados" className="max-h-48 overflow-auto rounded-lg border border-primary/50">
                      {matchedClients.map((c) => (
                        <li key={c.id}>
                          <button onClick={() => routeToClient(c)} className="w-full border-b border-border px-3 py-2 text-left last:border-0 hover:bg-secondary">
                            <div className="font-semibold"><span className="mr-2 rounded bg-primary px-1.5 py-0.5 text-xs font-bold text-primary-foreground">CLIENTE</span>{c.name}</div>
                            <div className="text-xs text-muted-foreground">{c.address || c.street}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {results.length > 0 && (
                    <ul className="max-h-48 overflow-auto rounded-lg border border-border">
                      {results.map((r) => (
                        <li key={r.id}>
                          <button onClick={() => addStop(r)} className="w-full border-b border-border px-3 py-2 text-left last:border-0 hover:bg-secondary">
                            <div className="font-semibold">{r.name}</div>
                            <div className="text-xs text-muted-foreground">{r.address}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <ol className="max-h-52 space-y-1.5 overflow-auto">
                    {stops.map((s, i) => (
                      <li key={s.id} className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent font-bold text-accent-foreground">{i + 1}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-semibold">{s.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{s.address}</div>
                        </div>
                         <button onClick={() => { setStops(stops.filter((x) => x.id !== s.id)); setPlan(null); clearLines(); }} className="text-muted-foreground hover:text-destructive" aria-label="Remover">✕</button>
                      </li>
                    ))}
                    {!stops.length && <li className="py-2 text-center text-sm text-muted-foreground">Busque e adicione os endereços das entregas.</li>}
                  </ol>
                  {stops.length > 0 && (
                    <Button variant="outline" disabled={busy} onClick={() => optimize()} className="w-full">
                      {busy ? "Calculando…" : "Planejar melhor ordem"}
                    </Button>
                  )}
                  {plan && (
                    <>
                    <p className="text-center text-sm text-muted-foreground">
                      Previsto: <b className="text-foreground">{km(plan.distanceMeters)}</b> · {Math.round(plan.durationSeconds / 60)} min
                    </p>
                    <p className="text-xs text-muted-foreground">Rotas de moto estão em fase de testes no Google; podem não incluir vias adequadas. Respeite a sinalização.</p>
                    {plan.steps.length > 0 && <details className="border-t border-border pt-2">
                      <summary className="cursor-pointer text-sm font-semibold">Conversões · {plan.steps.length}</summary>
                      <ol className="mt-2 max-h-36 space-y-2 overflow-auto">
                        {plan.steps.map((step, i) => <li key={i} className="flex gap-2 text-sm"><span className="text-primary">{i + 1}.</span><div>{step.instruction}<span className="block text-xs text-muted-foreground">{navigationDistance(step.distanceMeters)}</span></div></li>)}
                      </ol>
                    </details>}
                    </>
                  )}
                </div>
              ) : (
                <ul className="max-h-72 space-y-1.5 overflow-auto">
                  {routes.map((r) => (
                    <li key={r.id} className="flex items-center gap-2 rounded-lg bg-secondary px-3 py-2">
                      <button onClick={() => showRoute(r)} className="min-w-0 flex-1 text-left">
                        <div className="truncate font-semibold">{r.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(r.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · {km(r.distance_m)}
                        </div>
                      </button>
                      <button onClick={() => removeRoute(r.id)} className="text-muted-foreground hover:text-destructive" aria-label="Apagar">✕</button>
                    </li>
                  ))}
                  {!routes.length && <li className="py-2 text-center text-sm text-muted-foreground">Nenhuma rota salva ainda.</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
