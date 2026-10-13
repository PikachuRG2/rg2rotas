import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { NavigationStep } from "@/lib/navigation";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";

type LatLng = { lat: number; lng: number };

function creds() {
  const lovable = process.env["LOVABLE_API_KEY"];
  const maps = process.env["GOOGLE_MAPS_API_KEY"];
  if (!lovable || !maps) throw new Error("Google Maps não está configurado.");
  return { Authorization: `Bearer ${lovable}`, "X-Connection-Api-Key": maps };
}

async function check(res: Response) {
  if (res.status === 403) {
    const body = await res.text();
    throw new Error(`Google Maps negou o acesso (403): ${body}`);
  }
  if (!res.ok) {
    const body = await res.text();
    console.error(`Gateway ${res.status}: ${body}`);
    throw new Error(`Erro do Google Maps [${res.status}]: ${body}`);
  }
  return res.json();
}

export const searchPlaces = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query: string; bias?: LatLng }) => {
    const query = String(d.query ?? "").trim().slice(0, 200);
    if (query.length < 3) throw new Error("Digite pelo menos 3 letras.");
    return { query, bias: d.bias };
  })
  .handler(async ({ data }) => {
    const body: Record<string, unknown> = { textQuery: data.query, pageSize: 6, languageCode: "pt-BR" };
    if (data.bias) {
      body["locationBias"] = {
        circle: { center: { latitude: data.bias.lat, longitude: data.bias.lng }, radius: 30000 },
      };
    }
    const res = await fetch(`${GATEWAY_URL}/places/v1/places:searchText`, {
      method: "POST",
      headers: {
        ...creds(),
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
      },
      body: JSON.stringify(body),
    });
    const json = (await check(res)) as {
      places?: { id: string; displayName?: { text: string }; formattedAddress?: string; location: { latitude: number; longitude: number } }[];
    };
    return (json.places ?? []).map((p) => ({
      id: p.id,
      name: p.displayName?.text ?? "",
      address: p.formattedAddress ?? "",
      lat: p.location.latitude,
      lng: p.location.longitude,
    }));
  });

export const planRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { origin: LatLng; stops: LatLng[] }) => {
    if (!d.origin || !Array.isArray(d.stops) || d.stops.length < 1 || d.stops.length > 25)
      throw new Error("Adicione de 1 a 25 entregas.");
    return d;
  })
  .handler(async ({ data }) => {
    const wp = (p: LatLng) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    const stops = data.stops;
      const destination = stops[stops.length - 1];
      if (!destination) throw new Error("Adicione uma entrega.");
    const res = await fetch(`${GATEWAY_URL}/routes/directions/v2:computeRoutes`, {
      method: "POST",
      headers: {
        ...creds(),
        "Content-Type": "application/json",
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.startLocation,routes.legs.steps.endLocation",
      },
      body: JSON.stringify({
        origin: wp(data.origin),
        destination: wp(destination),
        intermediates: stops.slice(0, -1).map(wp),
        travelMode: "TWO_WHEELER",
        optimizeWaypointOrder: stops.length > 2,
        languageCode: "pt-BR",
      }),
    });
    const json = (await check(res)) as {
      routes?: {
        distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string }; optimizedIntermediateWaypointIndex?: number[];
        legs?: { steps?: {
          navigationInstruction?: { instructions?: string; maneuver?: string };
          distanceMeters?: number;
          startLocation?: { latLng?: { latitude?: number; longitude?: number } };
          endLocation?: { latLng?: { latitude?: number; longitude?: number } };
        }[] }[];
      }[];
    };
    const r = json.routes?.[0];
    if (!r?.polyline?.encodedPolyline) throw new Error("Nenhuma rota encontrada.");
    const durationSeconds = Number(r.duration?.replace(/s$/, ""));
    if (!r.duration || !Number.isFinite(durationSeconds) || durationSeconds < 0) throw new Error("Tempo da rota inválido.");
    const steps: NavigationStep[] = (r.legs ?? []).flatMap((leg) => (leg.steps ?? []).flatMap((step) => {
      const start = step.startLocation?.latLng;
      const end = step.endLocation?.latLng;
      if (!start || !end || !step.navigationInstruction?.instructions) return [];
      const startLat = start.latitude ?? 0, startLng = start.longitude ?? 0;
      const endLat = end.latitude ?? 0, endLng = end.longitude ?? 0;
      if (![startLat, startLng, endLat, endLng].every(Number.isFinite)) throw new Error("Coordenadas da rota inválidas.");
      return [{
        instruction: step.navigationInstruction.instructions,
        maneuver: step.navigationInstruction.maneuver ?? "STRAIGHT",
        distanceMeters: step.distanceMeters ?? 0,
        start: { lat: startLat, lng: startLng },
        end: { lat: endLat, lng: endLng },
      }];
    }));
    const middle = stops.length - 1;
    const order = r.optimizedIntermediateWaypointIndex && r.optimizedIntermediateWaypointIndex.length === middle
      ? [...r.optimizedIntermediateWaypointIndex, middle]
      : stops.map((_, i) => i);
    return {
      polyline: r.polyline.encodedPolyline,
      distanceMeters: r.distanceMeters ?? 0,
      durationSeconds,
      steps,
      order,
    };
  });

export const snapPath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { points: LatLng[] }) => {
    if (!Array.isArray(d.points) || d.points.length < 2) throw new Error("Trajeto muito curto.");
    return { points: d.points.slice(0, 3000) };
  })
  .handler(async ({ data }) => {
    const pts = data.points;
    const out: LatLng[] = [];
    // Roads API: max 100 points per request; overlap chunks by 1 point for continuity.
    for (let i = 0; i < pts.length - 1; i += 99) {
      const chunk = pts.slice(i, i + 100);
      const path = chunk.map((p) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join("|");
      const res = await fetch(
        `${GATEWAY_URL}/roads/v1/snapToRoads?interpolate=true&path=${encodeURIComponent(path)}`,
        { headers: creds() },
      );
      const json = (await check(res)) as { snappedPoints?: { location: { latitude: number; longitude: number } }[] };
      for (const s of json.snappedPoints ?? []) out.push({ lat: s.location.latitude, lng: s.location.longitude });
    }
    return out;
  });
