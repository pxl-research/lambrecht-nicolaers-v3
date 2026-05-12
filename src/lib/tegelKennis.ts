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

export type Toepassing = "vloer" | "wand" | "";

export interface KennisQuery {
  look?: string;
  kamer?: string;
  kleur?: string;
  toepassing?: Toepassing;
}

/** Detecteer of een klantvraag iets is waar we DB-kennis voor moeten ophalen. */
export function detectKennisQuery(text: string): KennisQuery | null {
  const t = text.toLowerCase();

  // Alleen triggeren bij vraag-achtige zinnen of inventaris-vragen
  const isVraag =
    /\?/.test(text) ||
    /\b(hebben jullie|heb je|heeft u|wat hebben|welke|welk|in welke|tonen|bestaat|verkopen jullie|bieden jullie|laten zien|kan ik|mag ik|geschikt|geschikte)\b/i.test(t);

  const look = LOOKS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(t));
  const kamer = KAMERS.find((w) => new RegExp(`\\b${w}\\b`, "i").test(t));
  const kleur = KLEUREN.find((w) => new RegExp(`\\b${w}\\b`, "i").test(t));

  // Toepassing-detectie. "zwembadvloer" telt expliciet als vloer.
  let toepassing: Toepassing = "";
  const heeftVloer = /\b(vloer|vloertegel|vloertegels|zwembadvloer|op de grond|op de vloer)\b/i.test(t);
  const heeftWand = /\b(wand|wandtegel|wandtegels|muur|muurtegel|aan de muur|op de muur)\b/i.test(t);
  if (heeftVloer && !heeftWand) toepassing = "vloer";
  else if (heeftWand && !heeftVloer) toepassing = "wand";

  if (!isVraag) return null;
  if (!look && !kamer && !kleur && !toepassing) return null;
  return { look, kamer, kleur, toepassing };
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
  /** Welke toepassingen ("vloer" / "wand") komen voor in de matchende rijen. */
  toepassingen: Toepassing[];
  /** Hoeveelheid rijen voor de gevraagde look ongeacht toepassing (voor conflict-detectie). */
  looksMatchesAlleToepassingen: number;
}

/** Bepaal of een rij vloer of wand is op basis van COL.VLOER_WAND (F* / W*). */
function rowToepassing(row: DataLNRow): Toepassing {
  const v = String(row[COL.VLOER_WAND] ?? "").trim().toLowerCase();
  if (v.startsWith("f")) return "vloer";
  if (v.startsWith("w")) return "wand";
  return "";
}

/** Voer de lookup uit en bouw een samenvatting voor de AI. */
export async function lookupKennis(q: KennisQuery): Promise<KennisResultaat> {
  const rows = await fetchAllRows();

  const matchesLook = (row: DataLNRow): boolean => {
    if (!q.look) return true;
    const lookKey = q.look.toLowerCase().replace("look", "").trim() || q.look.toLowerCase();
    return norm(row[COL.LOOK]).includes(lookKey);
  };
  const matchesKamer = (row: DataLNRow): boolean => {
    if (!q.kamer) return true;
    return norm(row[COL.KAMER]).includes(q.kamer.toLowerCase());
  };
  const matchesKleur = (row: DataLNRow): boolean => {
    if (!q.kleur) return true;
    return norm(row[COL.KLEUR]).includes(q.kleur.toLowerCase());
  };
  const matchesToepassing = (row: DataLNRow): boolean => {
    if (!q.toepassing) return true;
    return rowToepassing(row) === q.toepassing;
  };

  // Volledige filter (incl. toepassing)
  const filtered = rows.filter(
    (r) => matchesLook(r) && matchesKamer(r) && matchesKleur(r) && matchesToepassing(r)
  );

  // Voor conflict-detectie: zelfde filter zonder toepassing-restrictie
  const filteredZonderToepassing = rows.filter(
    (r) => matchesLook(r) && matchesKamer(r) && matchesKleur(r)
  );

  const setLooks = new Set<string>();
  const setKleuren = new Set<string>();
  const setFormaten = new Set<string>();
  const setKamers = new Set<string>();
  const setToepassingen = new Set<Toepassing>();
  const boxes: string[] = [];

  for (const r of filtered) {
    splitCell(r[COL.LOOK]).forEach((x) => setLooks.add(x));
    splitCell(r[COL.KLEUR]).forEach((x) => setKleuren.add(x));
    splitCell(r[COL.FORMAAT]).forEach((x) => setFormaten.add(x));
    splitCell(r[COL.KAMER]).forEach((x) => setKamers.add(x));
    const t = rowToepassing(r);
    if (t) setToepassingen.add(t);
    if (r[COL.BOX] != null) boxes.push(String(r[COL.BOX]));
  }

  return {
    matches: filtered.length,
    looks: [...setLooks].slice(0, 8),
    kleuren: [...setKleuren].slice(0, 10),
    formaten: [...setFormaten].slice(0, 8),
    kamers: [...setKamers].slice(0, 8),
    voorbeeldBoxes: boxes.slice(0, 5),
    toepassingen: [...setToepassingen],
    looksMatchesAlleToepassingen: filteredZonderToepassing.length,
  };
}

function toepassingLabel(ts: Toepassing[]): string {
  if (ts.length === 0) return "onbekend";
  if (ts.length === 1) return ts[0] === "vloer" ? "alleen vloertegel" : "alleen wandtegel";
  return "vloer- én wandtegel";
}

/** Format de DB-kennis als compact context-blok voor de AI. */
export function formatKennisContext(q: KennisQuery, res: KennisResultaat): string {
  // Conflict: klant vraagt vloer/wand, maar de look bestaat alleen in de andere toepassing.
  if (q.toepassing && res.matches === 0 && res.looksMatchesAlleToepassingen > 0) {
    const andereToep = q.toepassing === "vloer" ? "wand" : "vloer";
    const lookTxt = q.look ?? "deze look";
    return [
      `[DB_INFO] Conflict gedetecteerd in onze collectie:`,
      `- De klant vraagt naar ${lookTxt} als ${q.toepassing}tegel.`,
      `- In onze actuele collectie bestaat ${lookTxt} UITSLUITEND als ${andereToep}tegel — er is GEEN ${q.toepassing}tegel-variant.`,
      `Vertel de klant hier eerlijk over: ${lookTxt} is bij Lambrechts-Nicolaers niet beschikbaar als ${q.toepassing}tegel, alleen als ${andereToep}tegel. Stel een geschikte alternatieve look voor de gevraagde toepassing voor (uit de collectie). Verzin NIETS bij. Noem GEEN Box-nummers. Keer daarna soepel terug naar het volgende ontbrekende datapunt.`,
    ].join("\n");
  }

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
  lines.push(`- Beschikbaar als: ${toepassingLabel(res.toepassingen)}`);
  if (res.toepassingen.length === 1) {
    const enige = res.toepassingen[0];
    const andere = enige === "vloer" ? "wand" : "vloer";
    lines.push(
      `BELANGRIJK: deze look is in onze collectie UITSLUITEND beschikbaar als ${enige}tegel. Adviseer hem NOOIT als ${andere}tegel — ook niet wanneer de kamer "zwembadomgeving" of een gemengde ruimte is. Een vermelding van "zwembadomgeving" bij een wandtegel betekent een wand/accent in die ruimte, niet de zwembadvloer.`
    );
  }
  lines.push(
    `Gebruik bovenstaande feiten om de klantvraag deskundig te beantwoorden in 2 à 3 vloeiende zinnen. Verzin NOOIT extra kleuren, formaten of toepassingen. Noem GEEN Box-nummers. Keer daarna soepel terug naar het volgende ontbrekende datapunt zodat we tot het eindadvies kunnen komen.`
  );
  return lines.join("\n");
}
