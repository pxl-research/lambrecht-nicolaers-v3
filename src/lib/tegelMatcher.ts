// Matching-logica op basis van de 5 criteria tegen de Supabase tabel "Data LN".
// Gebruikt de werkelijke kolomnamen (zie COL in supabaseClient.ts).

import { fetchAllRows, COL, type DataLNRow } from "./supabaseClient";

export interface MatchCriteria {
  kamer: string;        // bv. "badkamer"
  look: string;         // bv. "marmer"
  kleur: string;        // bv. "wit"
  huisdieren: string;   // "ja" | "nee" | vrije tekst
  plaatsing: string;    // "zelf" | "vakman" | vrije tekst
}

export interface MatchResult {
  box: string;
  formaat: string;
  look: string;
  kleur: string;
  kamer: string;
  raw: DataLNRow;
  alternatives: DataLNRow[];
}

function norm(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/,()-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(v: string): string[] {
  return norm(v)
    .split(/[\s,/()-]+/)
    .filter((t) => t.length > 2);
}

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (v == null) return false;
  const s = String(v).toLowerCase().trim();
  return s === "true" || s === "ja" || s === "yes" || s === "1" || s === "x" || s === "✓";
}

function isHuisdierenJa(c: string): boolean {
  return /\b(ja|hond|kat|huisdier|dier)\b/i.test(c);
}

/** Score op hoeveel criteria deze rij matcht. Plaatsing wordt NIET gebruikt voor matching. */
function scoreRow(row: DataLNRow, c: MatchCriteria): number {
  let score = 0;

  const rowKamer = norm(row[COL.KAMER]);          // tekst, kan meerdere kamers bevatten
  const rowLook = norm(row[COL.LOOK]);
  const rowKleur = norm(row[COL.KLEUR]);
  const rowHuisdierenBool = asBool(row[COL.HUISDIEREN]); // boolean kolom

  const cKamer = norm(c.kamer);
  const cLook = norm(c.look);
  const cKleur = norm(c.kleur);
  const wantHuisdieren = isHuisdierenJa(c.huisdieren);

  // Kamer (zoekt of klant-kamer voorkomt in de tekst — meerdere kamers per cel)
  if (cKamer && rowKamer) {
    if (rowKamer.includes(cKamer)) score += 3;
    else if (tokens(cKamer).some((t) => rowKamer.includes(t))) score += 2;
  }

  // Look (3 punten)
  if (cLook && rowLook) {
    if (rowLook.includes(cLook)) score += 3;
    else if (tokens(cLook).some((t) => rowLook.includes(t))) score += 1;
  }

  // Kleur (2 punten)
  if (cKleur && rowKleur) {
    if (rowKleur.includes(cKleur)) score += 2;
    else if (tokens(cKleur).some((t) => rowKleur.includes(t))) score += 1;
  }

  // Huisdieren: als klant 'ja' zegt, moet de boolean true zijn
  if (wantHuisdieren) {
    if (rowHuisdierenBool) score += 2;
    else score -= 2;
  }

  return score;
}

/** Zoekt de best matchende rij in Data LN voor de gegeven criteria. */
export async function findBestMatch(c: MatchCriteria): Promise<MatchResult | null> {
  const rows = await fetchAllRows();
  if (rows.length === 0) return null;

  const scored = rows
    .map((row) => ({ row, score: scoreRow(row, c) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score <= 0) return null;

  const topScore = best.score;
  const topRows = scored.filter((s) => s.score === topScore).map((s) => s.row);
  const pick = topRows[Math.floor(Math.random() * topRows.length)];

  return {
    box: String(pick[COL.BOX] ?? ""),
    formaat: String(pick[COL.FORMAAT] ?? ""),
    look: String(pick[COL.LOOK] ?? ""),
    kleur: String(pick[COL.KLEUR] ?? ""),
    kamer: String(pick[COL.KAMER] ?? ""),
    raw: pick,
    alternatives: topRows.filter((r) => r !== pick).slice(0, 3),
  };
}

/** Formatteer een MatchResult als nette adviestekst voor de klant. */
export function formatAdvice(m: MatchResult, c: MatchCriteria): string {
  const heeftHuisdieren = isHuisdierenJa(c.huisdieren);
  const doetZelf = /\b(zelf|diy|doe het zelf)\b/i.test(c.plaatsing);

  let txt = "Ik heb een mooie match voor u gevonden.\n\n";
  txt += `Ik raad u de ${m.look || "geselecteerde tegel"} aan`;
  if (m.kleur) txt += ` in ${m.kleur}`;
  if (m.formaat) txt += `, formaat ${m.formaat} cm`;
  txt += ".";
  txt += `\n\nU kunt deze tegel bekijken in Box ${m.box} in onze showroom.`;

  if (heeftHuisdieren) {
    txt += "\n\nOmdat u huisdieren heeft, is bij deze keuze gelet op het feit dat vuil, haren en vlekken minder zichtbaar zijn.";
  }
  if (doetZelf && m.formaat) {
    txt += `\n\nOmdat u zelf gaat plaatsen, is het goed om te weten dat het formaat ${m.formaat} cm hier past bij uw aanpak.`;
  }

  txt += "\n\nKom gerust langs om de tegel in het echt te ervaren. Wenst u nog een alternatief?";
  return txt;
}
