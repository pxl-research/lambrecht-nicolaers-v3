// Live kennis-lookup in Supabase Data LN voor zijvragen tijdens het gesprek.
// Wordt aangeroepen wanneer de klant tussendoor vraagt naar een specifiek
// materiaal, stijl, kleur of kamer. Geeft een korte feiten-samenvatting terug
// die de AI als context kan gebruiken voor een natuurlijk antwoord.

import { fetchAllRows, COL, type DataLNRow } from "./supabaseClient";

/** Trefwoorden die we herkennen voor proactieve lookup. */
const LOOKS = [
  "marmer", "natuursteen", "parket", "betonlook", "beton", "terrazzo",
  "travertijn", "ceppo di gres", "ceppo", "mortex", "zelliges",
  "mozaiek", "mozaïek", "hout", "houtlook", "tegel",
];
const KAMERS = [
  "badkamer", "keuken", "woonkamer", "hal", "terras",
  "slaapkamer", "toilet", "zwembad", "zwembadomgeving",
];
const KLEUREN = [
  "wit", "grijs", "beige", "bruin", "zwart", "blauw",
  "groen", "taupe", "zand", "greige", "antraciet", "lichtgrijs",
  "middengrijs", "donkergrijs", "zilver", "ivoor", "crème", "creme",
];

export interface KennisQuery {
  look?: string;
  kamer?: string;
  kleur?: string;
}

/** Detecteer of een klantvraag iets is waar we DB-kennis voor moeten ophalen. */
export function detectKennisQuery(text: string): KennisQuery | null {
  const t = text.toLowerCase();

  // Alleen triggeren bij vraag-achtige zinnen of inventaris-vragen
  const isVraag =
    /\?/.test(text) ||
    /\b(hebben jullie|heb je|heeft u|wat hebben|welke|welk|in welke|tonen|bestaat|verkopen jullie|bieden jullie|laten zien)\b/i.test(t);

  const look = LOOKS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(t));
  const kamer = KAMERS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(t));
  const kleur = KLEUREN.find((w) => new RegExp(`\\b${w}\\b`, "i").test(t));

  if (!isVraag) return null;
  if (!look && !kamer && !kleur) return null;
  return { look, kamer, kleur };
}

function norm(v: unknown): string {
  return String(v ?? "").toLowerCase();
}

/** Splits een cel met meerdere waarden ("wit/grijs/beige") in losse tokens. */
function splitCell(v: unknown): string[] {
  return String(v ?? "")
    .split(/[\/,;]| en /i)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface KennisResultaat {
  matches: number;
  looks: string[];
  kleuren: string[];
  formaten: string[];
  kamers: string[];
  voorbeeldBoxes: string[];
}

/** Voer de lookup uit en bouw een samenvatting voor de AI. */
export async function lookupKennis(q: KennisQuery): Promise<KennisResultaat> {
  const rows = await fetchAllRows();

  const filtered = rows.filter((row: DataLNRow) => {
    if (q.look && !norm(row[COL.LOOK]).includes(q.look.toLowerCase().replace("look", "").trim() || q.look.toLowerCase())) {
      // Kleine tolerantie: "betonlook" → match op "beton"
      const lookKey = q.look.toLowerCase().replace("look", "").trim();
      if (!norm(row[COL.LOOK]).includes(lookKey || q.look.toLowerCase())) return false;
    }
    if (q.kamer && !norm(row[COL.KAMER]).includes(q.kamer.toLowerCase())) return false;
    if (q.kleur && !norm(row[COL.KLEUR]).includes(q.kleur.toLowerCase())) return false;
    return true;
  });

  const setLooks = new Set<string>();
  const setKleuren = new Set<string>();
  const setFormaten = new Set<string>();
  const setKamers = new Set<string>();
  const boxes: string[] = [];

  for (const r of filtered) {
    splitCell(r[COL.LOOK]).forEach((x) => setLooks.add(x));
    splitCell(r[COL.KLEUR]).forEach((x) => setKleuren.add(x));
    splitCell(r[COL.FORMAAT]).forEach((x) => setFormaten.add(x));
    splitCell(r[COL.KAMER]).forEach((x) => setKamers.add(x));
    if (r[COL.BOX] != null) boxes.push(String(r[COL.BOX]));
  }

  return {
    matches: filtered.length,
    looks: [...setLooks].slice(0, 8),
    kleuren: [...setKleuren].slice(0, 10),
    formaten: [...setFormaten].slice(0, 8),
    kamers: [...setKamers].slice(0, 8),
    voorbeeldBoxes: boxes.slice(0, 5),
  };
}

/** Format de DB-kennis als compact context-blok voor de AI. */
export function formatKennisContext(q: KennisQuery, res: KennisResultaat): string {
  if (res.matches === 0) {
    return `[DB_INFO] Geen rijen gevonden voor zoekopdracht ${JSON.stringify(q)}. Vertel de klant eerlijk dat je dit specifieke item niet in de actuele collectie ziet, en stel een verwante optie of showroombezoek voor.`;
  }
  const lines: string[] = [];
  lines.push(`[DB_INFO] Live data uit "Data LN" voor zoekopdracht ${JSON.stringify(q)}:`);
  lines.push(`- Aantal passende tegels in collectie: ${res.matches}`);
  if (res.looks.length) lines.push(`- Beschikbare looks: ${res.looks.join(", ")}`);
  if (res.kleuren.length) lines.push(`- Beschikbare kleuren/tinten: ${res.kleuren.join(", ")}`);
  if (res.formaten.length) lines.push(`- Beschikbare formaten (cm): ${res.formaten.join(", ")}`);
  if (res.kamers.length) lines.push(`- Veel toegepast in: ${res.kamers.join(", ")}`);
  lines.push(
    `Gebruik bovenstaande feiten om de klantvraag deskundig te beantwoorden in 2 à 3 vloeiende zinnen. Noem GEEN Box-nummers. Keer daarna soepel terug naar het volgende ontbrekende datapunt zodat we tot het eindadvies kunnen komen.`
  );
  return lines.join("\n");
}
