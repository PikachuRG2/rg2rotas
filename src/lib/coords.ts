// Extracts "lat, lng" from pasted text or Google Maps links (…@-23.5,-46.6,17z / ?q=-23.5,-46.6 / !3d-23.5!4d-46.6).
export function parseCoords(text: string): { lat: number; lng: number } | null {
  const t = decodeURIComponent(text.trim());
  const pats = [
    /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)/,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && (m[1]!.includes(".") || m[2]!.includes("."))) {
      return { lat, lng };
    }
  }
  return null;
}
