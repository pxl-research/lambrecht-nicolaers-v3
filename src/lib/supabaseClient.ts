// Lichtgewicht Supabase REST client voor read-only queries op tabel "Data LN".
// Geen externe dependency nodig — we gebruiken alleen PostgREST via fetch.

export const SUPABASE_URL = "https://vbjowjvyfttfpmqyziwg.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZiam93anZ5ZnR0ZnBtcXl6aXdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY5MzYyNTEsImV4cCI6MjA5MjUxMjI1MX0.gr1WsqBz-RYHrfWC-LOk1kiNcfPUqTYfIS1jGviqPbc";

// Tabelnaam met spatie — moet URL-geëncodeerd worden.
export const DATA_TABLE = "Data LN";

// === Kolom-mapping (exact zoals in Supabase) ===
export const COL = {
  KAMER: "Veel voorkomend in (niet exclusief)",
  LOOK: "Look",
  KLEUR: "Kleur",
  HUISDIEREN: "Vuil/haren/vlekken moeilijk zichtbaar?", // boolean (let op het vraagteken)
  // PLAATSING: niet aanwezig in Data LN — wordt alleen in conversatie/log gebruikt, niet voor matching
  BOX: "Expo",
  FORMAAT: "Formaat (cm)",
  VLOER_WAND: "Vloer/Wand", // F* = vloer, W* = wand
  PREFERENTIE: "Preferentiële boxen", // "aangeraden voor [look]" | "niet aangeraden" | leeg (kolomnaam ongewijzigd in DB)
} as const;

// Tolerant rij-type — kolomnamen bevatten spaties en haakjes, dus indexed access.
export type DataLNRow = Record<string, unknown>;

/**
 * Voert een PostgREST GET uit op de Data LN tabel.
 * @param query rauwe query string zonder leading "?" (bv. 'select=*&"Look"=ilike.*marmer*&limit=20')
 */
export async function queryDataLN(query: string): Promise<DataLNRow[]> {
  const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(DATA_TABLE)}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Supabase query mislukt (${res.status}): ${txt.slice(0, 300)}`);
  }
  return (await res.json()) as DataLNRow[];
}

/** Test of we ten minste één rij kunnen lezen. */
export async function testConnection(): Promise<{ ok: boolean; sample?: DataLNRow; error?: string }> {
  try {
    const rows = await queryDataLN("select=*&limit=1");
    return { ok: true, sample: rows[0] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Haal alle rijen op (cache in-memory). */
let _cache: DataLNRow[] | null = null;
let _cachePromise: Promise<DataLNRow[]> | null = null;

export async function fetchAllRows(): Promise<DataLNRow[]> {
  if (_cache) return _cache;
  if (_cachePromise) return _cachePromise;
  _cachePromise = queryDataLN("select=*&limit=2000")
    .then((rows) => {
      _cache = rows;
      _cachePromise = null;
      return rows;
    })
    .catch((err) => {
      _cachePromise = null;
      throw err;
    });
  return _cachePromise;
}

export function clearCache(): void {
  _cache = null;
  _cachePromise = null;
}
