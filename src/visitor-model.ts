export const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export interface ReservationSummary {
  date: string;
  gate: string;
  purpose: string;
  status: "valid" | "visited" | "pending" | "cancelled" | "expired";
}

export interface VisitorSnapshot {
  date: string;
  captured_at: number;
  state: "ready" | "no_reservation";
  reservations: ReservationSummary[];
  qr: { source: "official-page"; png_base64: string } | null;
}

export function beijingDate(now = Date.now()): string {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}

export function schoolDate(value: unknown): string | null {
  const s = String(value);
  if (!/^\d{8}$/.test(s)) return null;
  const date = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  const parsed = Date.parse(`${date}T00:00:00+08:00`);
  return Number.isFinite(parsed) && beijingDate(parsed) === date ? date : null;
}

export function recordStatus(record: Record<string, unknown>, today: string): ReservationSummary["status"] {
  if (record.approved === -1 || record.approved === -100) return "cancelled";
  if (record.approved !== 0) return "pending";
  if ((schoolDate(record.Vdate) || "") < today) return "expired";
  return record.Rtimein || record.RtimeinUTC ? "visited" : "valid";
}

export function usableToday(record: Record<string, unknown>, profileId: unknown, now = Date.now()): boolean {
  return Boolean(profileId) && String(record.VVID) === String(profileId)
    && schoolDate(record.Vdate) === beijingDate(now) && record.approved === 0
    && typeof record.regcode === "string" && /^\d{6,20}$/.test(record.regcode);
}

export function snapshotFresh(snapshot: VisitorSnapshot, now = Date.now()): boolean {
  return snapshot.date === beijingDate(now) && snapshot.captured_at <= now + 30000
    && snapshot.captured_at > now - SNAPSHOT_TTL_MS;
}

export function validateSnapshot(value: unknown, now = Date.now()): VisitorSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const s = value as VisitorSnapshot;
  if (s.date !== beijingDate(now) || !Number.isFinite(s.captured_at) || !snapshotFresh(s, now)) return null;
  if (!["ready", "no_reservation"].includes(s.state) || !Array.isArray(s.reservations) || s.reservations.length > 100) return null;
  const statuses = ["valid", "visited", "pending", "cancelled", "expired"];
  for (const r of s.reservations) {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || typeof r.gate !== "string" || r.gate.length > 100
      || typeof r.purpose !== "string" || r.purpose.length > 200 || !statuses.includes(r.status)) return null;
  }
  if (s.state === "no_reservation") return s.qr === null ? s : null;
  if (!s.reservations.some(r => r.date === s.date && ["valid", "visited"].includes(r.status))) return null;
  if (s.qr?.source !== "official-page" || typeof s.qr.png_base64 !== "string" || s.qr.png_base64.length > 180000) return null;
  try {
    const png = atob(s.qr.png_base64);
    if (!png.startsWith("\x89PNG\r\n\x1a\n") || png.length < 100) return null;
  } catch { return null; }
  return s;
}
