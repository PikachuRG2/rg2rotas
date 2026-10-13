/// <reference types="@types/google.maps" />
import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { searchPlaces, planRoute, snapPath } from "@/lib/maps.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type LatLng = { lat: number; lng: number };
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
const pathLength = (p: LatLng[]) => p.reduce((s, c, i) => (i ? s + haversine(p[i - 1]!, c) : 0), 0);
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
  const [plan, setPlan] = useState<{ distanceMeters: number; durationSeconds: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [raw, setRaw] = useState<LatLng[]>([]);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [routes, setRoutes] = useState<SavedRoute[]>([]);
  const [tab, setTab] = useState<"entregas" | "historico">("entregas");
  const [open, setOpen] = useState(true);

  const doSearch = useServerFn(searchPlaces);
  const doPlan = useServerFn(planRoute);
  const doSnap = useServerFn(snapPath);

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
    if (!ready || !me) return;
    if (!meMarker.current) {
      meMarker.current = new google.maps.Marker({
        map: map.current!, position: me, zIndex: 999,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#4ea1ff", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 },
      });
    } else meMarker.current.setPosition(me);
  }, [ready, me]);

  // Stop markers
  useEffect(() => {
    if (!ready) return;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = stops.map((s, i) => new google.maps.Marker({
      map: map.current!, position: s, title: s.name,
      label: { text: String(i + 1), color: "#111", fontWeight: "700" },
      icon: { path: google.maps.SymbolPath.CIRCLE, scale: 13, fillColor: COLORS.stop, fillOpacity: 1, strokeColor: "#111", strokeWeight: 2 },
    }));
  }, [ready, stops]);

  // Live recorded line
  useEffect(() => {
    if (!ready) return;
    if (!liveLine.current) liveLine.current = new google.maps.Polyline({ map: map.current!, strokeColor: COLORS.live, strokeOpacity: 0.9, strokeWeight: 5 });
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

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 3) return;
    setSearching(true);
    try {
      setResults(await doSearch({ data: { query, ...(me ? { bias: me } : {}) } }));
    } catch (err) { toast.error((err as Error).message); }
    setSearching(false);
  }

  function addStop(s: Stop) {
    setStops((prev) => (prev.some((p) => p.id === s.id) ? prev : [...prev, s]));
    setResults([]); setQuery(""); setPlan(null);
    map.current?.panTo(s);
  }

  function clearLines() {
    planLine.current?.setMap(null); planLine.current = null;
    snapLine.current?.setMap(null); snapLine.current = null;
  }

  async function optimize() {
    if (!me) { toast.error("Preciso da sua localização para planejar."); return; }
    if (!stops.length) return;
    setBusy(true);
    try {
      const r = await doPlan({ data: { origin: me, stops: stops.map(({ lat, lng }) => ({ lat, lng })) } });
      setStops(r.order.map((i) => stops[i]).filter((x): x is Stop => !!x));
      clearLines();
      planLine.current = new google.maps.Polyline({
        map: map.current!, path: google.maps.geometry.encoding.decodePath(r.polyline),
        strokeColor: COLORS.plan, strokeOpacity: 0, strokeWeight: 4,
        icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 3 }, offset: "0", repeat: "14px" }],
      });
      const b = new google.maps.LatLngBounds();
      planLine.current.getPath().forEach((p) => b.extend(p));
      map.current?.fitBounds(b, 60);
      setPlan(r);
    } catch (err) { toast.error((err as Error).message); }
    setBusy(false);
  }

  function startWatch() {
    if (!navigator.geolocation) { toast.error("Seu aparelho não tem GPS disponível."); return; }
    setRecording(true);
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude };
        setMe(pos);
        if (p.coords.accuracy > 35) return; // ignore imprecise fixes
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

  function start() {
    clearLines();
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
    setRaw([]); setStops([]); setPlan(null);
    toast.success("Rota salva!");
    loadRoutes();
  }

  function drawSnapped(path: LatLng[]) {
    clearLines();
    snapLine.current = new google.maps.Polyline({ map: map.current!, path, strokeColor: COLORS.snapped, strokeOpacity: 1, strokeWeight: 6, zIndex: 10 });
    const b = new google.maps.LatLngBounds();
    path.forEach((p) => b.extend(p));
    if (path.length) map.current?.fitBounds(b, 60);
  }

  function showRoute(r: SavedRoute) {
    drawSnapped(r.snapped_path?.length ? r.snapped_path : r.raw_path);
    markers.current.forEach((m) => m.setMap(null));
    markers.current = (r.stops ?? []).map((s, i) => new google.maps.Marker({
      map: map.current!, position: s, label: { text: String(i + 1), color: "#111", fontWeight: "700" },
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

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-background">
      <div ref={mapEl} className="absolute inset-0" />

      {/* Top bar */}
      <header className="absolute left-3 right-3 top-3 z-10 flex items-center justify-between gap-2">
        <span className="rounded-lg bg-card/90 px-3 py-1.5 font-display text-2xl font-extrabold uppercase text-primary shadow-panel backdrop-blur">Rota Moto</span>
        <Button variant="secondary" size="sm" onClick={() => supabase.auth.signOut()}>Sair</Button>
      </header>

      {recording && (
        <div className="absolute left-1/2 top-16 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-card/95 px-4 py-2 shadow-panel">
          <span className="rec-pulse h-3 w-3 rounded-full bg-destructive" />
          <span className="font-display text-lg font-bold">GRAVANDO · {km(recDistance)}</span>
        </div>
      )}

      {/* Bottom sheet */}
      <section className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-xl rounded-t-2xl border-t border-border bg-card/95 shadow-panel backdrop-blur md:bottom-4 md:left-4 md:right-auto md:w-[420px] md:rounded-2xl md:border">
        <button onClick={() => setOpen(!open)} className="flex w-full justify-center py-2" aria-label="Abrir painel">
          <span className="h-1.5 w-12 rounded-full bg-muted-foreground/40" />
        </button>

        <div className="px-4 pb-4">
          {recording ? (
            <Button variant="destructive" disabled={busy} onClick={finish} className="h-14 w-full font-display text-xl font-bold uppercase">
              {busy ? "Alinhando às ruas…" : "Finalizar e salvar rota"}
            </Button>
          ) : (
            <Button disabled={busy} onClick={start} className="h-14 w-full font-display text-xl font-bold uppercase">
              Iniciar trajeto {stops.length ? `(${stops.length} entregas)` : ""}
            </Button>
          )}

          {open && !recording && (
            <div className="mt-4">
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                {(["entregas", "historico"] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`rounded-md py-1.5 text-sm font-semibold capitalize transition ${tab === t ? "bg-secondary text-foreground" : "text-muted-foreground"}`}>
                    {t === "historico" ? "Rotas salvas" : "Entregas"}
                  </button>
                ))}
              </div>

              {tab === "entregas" ? (
                <div className="space-y-3">
                  <form onSubmit={search} className="flex gap-2">
                    <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Endereço da entrega…" className="h-11" />
                    <Button type="submit" variant="secondary" disabled={searching} className="h-11">{searching ? "…" : "Buscar"}</Button>
                  </form>
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
                        <button onClick={() => { setStops(stops.filter((x) => x.id !== s.id)); setPlan(null); }} className="text-muted-foreground hover:text-destructive" aria-label="Remover">✕</button>
                      </li>
                    ))}
                    {!stops.length && <li className="py-2 text-center text-sm text-muted-foreground">Busque e adicione os endereços das entregas.</li>}
                  </ol>
                  {stops.length > 0 && (
                    <Button variant="outline" disabled={busy} onClick={optimize} className="w-full">
                      {busy ? "Calculando…" : "Planejar melhor ordem"}
                    </Button>
                  )}
                  {plan && (
                    <p className="text-center text-sm text-muted-foreground">
                      Previsto: <b className="text-foreground">{km(plan.distanceMeters)}</b> · {Math.round(plan.durationSeconds / 60)} min
                    </p>
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
