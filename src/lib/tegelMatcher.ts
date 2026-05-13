// Matching-logica op basis van de 5 criteria tegen de Supabase tabel "Data LN".
// Gebruikt de werkelijke kolomnamen (zie COL in supabaseClient.ts).

import { fetchAllRows, COL, type DataLNRow } from "./supabaseClient";

export interface MatchCriteria {
  kamer: string;        // bv. "badkamer"
  toepassing: string;   // "vloer" | "wand" | "beide" | ""
  look: string;         // bv. "marmer"
  kleur: string;        // bv. "wit"
  huisdieren: string;   // "ja" | "nee" | vrije tekst
  plaatsing: string;    // "zelf" | "vakman" | vrije tekst
}

export interface AlternativeItem {
  box: string;
  formaat: string;
  look: string;
  kleur: string;
  omschrijving: string; // korte naam zoals "Beton in lichtgrijs"
}

export interface MatchResult {
  box: string;
  formaat: string;
  look: string;
  kleur: string;
  kamer: string;
  raw: DataLNRow;
  alternatives: DataLNRow[];
  alternativeItems?: AlternativeItem[];
  isFallback?: boolean;
  fallbackBoxes?: string[];
  conflictReason?: "look_niet_in_toepassing";
  conflictLook?: string;
  conflictToepassing?: string;
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
  return /\b(ja|hond|kat|huisdier|dier|kind|kinderen|kindjes|baby|peuter|kleuter)\b/i.test(c);
}

/**
 * Detecteer "maakt niet uit" / "geen voorkeur" / "alles" antwoorden.
 * Zulke filters worden volledig genegeerd in de matching.
 */
export function isOnverschillig(v: string): boolean {
  if (!v) return true;
  const s = v.toLowerCase().trim();
  if (s.length === 0) return true;
  return /\b(maakt niet uit|maakt me niet uit|geen voorkeur|geen idee|geen mening|alles|allemaal|om het even|n\.?v\.?t\.?|onbekend|weet ik niet|weet niet|no preference|any|whatever)\b/.test(
    s
  );
}

/**
 * Bepaal de preferentie-tier van een rij t.o.v. de gevraagde look.
 * - 2 = "aangeraden voor [look]" en de look matcht de klantvraag → TOP prioriteit
 * - 1 = leeg of aangeraden voor andere look → STANDAARD
 * - -1 = "niet aangeraden" → LAAGSTE prioriteit (alleen tonen als er niets anders is)
 */
function preferentieTier(row: DataLNRow, c: MatchCriteria): number {
  const raw = String(row[COL.PREFERENTIE] ?? "").toLowerCase().trim();
  if (!raw) return 1;
  if (raw.includes("niet aangeraden")) return -1;

  if (raw.includes("aangeraden voor")) {
    if (!c.look || isOnverschillig(c.look)) return 1;
    const cLook = norm(c.look).replace(/look$/, "").trim();
    // Tolerante substring-match: "aangeraden voor parketlook" bevat "parket"
    if (cLook && raw.includes(cLook)) return 2;
    return 1;
  }
  return 1;
}

/** Score op hoeveel criteria deze rij matcht. Plaatsing wordt NIET gebruikt voor matching. */
function scoreRow(row: DataLNRow, c: MatchCriteria): number {
  let score = 0;

  const rowKamer = norm(row[COL.KAMER]);
  const rowLook = norm(row[COL.LOOK]);
  const rowKleur = norm(row[COL.KLEUR]);
  const rowHuisdierenBool = asBool(row[COL.HUISDIEREN]);

  const useKamer = !isOnverschillig(c.kamer);
  const useLook = !isOnverschillig(c.look);
  const useKleur = !isOnverschillig(c.kleur);
  const useHuisdieren = !isOnverschillig(c.huisdieren);

  const cKamer = norm(c.kamer);
  const cLook = norm(c.look);
  const cKleur = norm(c.kleur);
  const wantHuisdieren = useHuisdieren && isHuisdierenJa(c.huisdieren);

  if (useKamer && cKamer && rowKamer) {
    if (rowKamer.includes(cKamer)) score += 3;
    else if (tokens(cKamer).some((t) => rowKamer.includes(t))) score += 2;
  }

  if (useLook && cLook && rowLook) {
    if (rowLook.includes(cLook)) score += 3;
    else if (tokens(cLook).some((t) => rowLook.includes(t))) score += 1;
  }

  if (useKleur && cKleur && rowKleur) {
    if (rowKleur.includes(cKleur)) score += 2;
    else if (tokens(cKleur).some((t) => rowKleur.includes(t))) score += 1;
  }

  if (useHuisdieren) {
    if (wantHuisdieren) {
      if (rowHuisdierenBool) score += 2;
      else score -= 2;
    }
  }

  return score;
}

/**
 * Filter rijen op basis van toepassing (vloer/wand/beide).
 * - "vloer" → alleen rijen waar Vloer/Wand begint met F
 * - "wand"  → alleen rijen waar Vloer/Wand begint met W
 * - "beide" of leeg → geen filter
 */
function filterByToepassing(rows: DataLNRow[], toepassing: string): DataLNRow[] {
  const t = (toepassing || "").toLowerCase().trim();
  if (!t || t === "beide" || isOnverschillig(t)) return rows;
  let prefix: "f" | "w" | null = null;
  if (t.startsWith("vloer")) prefix = "f";
  else if (t.startsWith("wand") || t.startsWith("muur")) prefix = "w";
  if (!prefix) return rows;
  return rows.filter((r) => {
    const v = String(r[COL.VLOER_WAND] ?? "").trim().toLowerCase();
    return v.startsWith(prefix as string);
  });
}

/**
 * Pak de N meest voorkomende boxnummers binnen rijen die op kamer matchen.
 * "niet aangeraden" rijen worden uitgesloten — die mogen nooit als top-fallback verschijnen.
 */
function topBoxesVoorKamer(rows: DataLNRow[], kamer: string, n = 2): string[] {
  const cKamer = norm(kamer);
  const baseFiltered = isOnverschillig(kamer)
    ? rows
    : rows.filter((r) => {
        const rk = norm(r[COL.KAMER]);
        return rk && (rk.includes(cKamer) || tokens(cKamer).some((t) => rk.includes(t)));
      });
  const filtered = baseFiltered.filter((r) => {
    const pref = String(r[COL.PREFERENTIE] ?? "").toLowerCase();
    return !pref.includes("niet aangeraden");
  });
  const counts = new Map<string, number>();
  for (const r of filtered) {
    const b = String(r[COL.BOX] ?? "").trim();
    if (!b) continue;
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([box]) => box);
}

/** Zoekt de best matchende rij in Data LN voor de gegeven criteria. */
export async function findBestMatch(c: MatchCriteria): Promise<MatchResult | null> {
  const allRows = await fetchAllRows();
  if (allRows.length === 0) return null;

  // Harde filter op toepassing (vloer/wand). Bij "beide" of leeg = geen filter.
  const rows = filterByToepassing(allRows, c.toepassing);
  if (rows.length === 0) return null;

  // Conflictdetectie: look bestaat in collectie maar niet voor de gevraagde toepassing.
  // Bv. zelliges (alleen wand) terwijl klant vloer vraagt → eerlijke uitleg i.p.v. willekeurige andere look.
  const useLook = !isOnverschillig(c.look);
  const useToepassing = c.toepassing && !isOnverschillig(c.toepassing) && c.toepassing.toLowerCase().trim() !== "beide";
  if (useLook && useToepassing) {
    const cLook = norm(c.look).replace(/look$/, "").trim();
    const lookInToepassing = rows.some((r) => {
      const rl = norm(r[COL.LOOK]);
      return rl && (rl.includes(cLook) || tokens(cLook).some((t) => rl.includes(t)));
    });
    const lookInCollectie = allRows.some((r) => {
      const rl = norm(r[COL.LOOK]);
      return rl && (rl.includes(cLook) || tokens(cLook).some((t) => rl.includes(t)));
    });
    if (!lookInToepassing && lookInCollectie) {
      const fallbackBoxes = topBoxesVoorKamer(rows, c.kamer, 2);
      return {
        box: "",
        formaat: "",
        look: "",
        kleur: "",
        kamer: c.kamer,
        raw: {},
        alternatives: [],
        isFallback: true,
        fallbackBoxes,
        conflictReason: "look_niet_in_toepassing",
        conflictLook: c.look,
        conflictToepassing: c.toepassing,
      };
    }
  }

  // Score elke rij + bepaal preferentie-tier (2=top, 1=standaard, -1=niet aangeraden).
  // Primair sorteren op tier (hoog → laag), secundair op score (hoog → laag).
  const scored = rows
    .map((row) => ({ row, score: scoreRow(row, c), tier: preferentieTier(row, c) }))
    .sort((a, b) => (b.tier - a.tier) || (b.score - a.score));

  const best = scored[0];

  // Geen enkele zinvolle match → fallback met top-boxes voor de kamer
  if (!best || best.score <= 0) {
    const fallbackBoxes = topBoxesVoorKamer(rows, c.kamer, 2);
    if (fallbackBoxes.length === 0) return null;
    return {
      box: "",
      formaat: "",
      look: "",
      kleur: "",
      kamer: c.kamer,
      raw: {},
      alternatives: [],
      isFallback: true,
      fallbackBoxes,
    };
  }

  // Hoofdmatch: kies binnen de hoogste tier+score-combinatie (random tie-break)
  const topTier = best.tier;
  const topScore = best.score;
  const topRows = scored
    .filter((s) => s.tier === topTier && s.score === topScore)
    .map((s) => s.row);
  const pick = topRows[Math.floor(Math.random() * topRows.length)];
  const pickBox = String(pick[COL.BOX] ?? "");

  // Alternatieven: doorloop in tier+score-volgorde, "niet aangeraden" (tier -1)
  // alleen als laatste vulling wanneer er anders niets is.
  const seenBoxes = new Set<string>([pickBox]);
  const alternativeItems: AlternativeItem[] = [];

  const pushAlt = (row: DataLNRow) => {
    const b = String(row[COL.BOX] ?? "").trim();
    if (!b || seenBoxes.has(b)) return;
    seenBoxes.add(b);
    const look = String(row[COL.LOOK] ?? "").trim();
    const kleur = String(row[COL.KLEUR] ?? "").split("/")[0].trim();
    const formaat = String(row[COL.FORMAAT] ?? "").split("/")[0].trim();
    const omschrijving = look
      ? kleur
        ? `${look.charAt(0).toUpperCase() + look.slice(1)} in ${kleur}`
        : look.charAt(0).toUpperCase() + look.slice(1)
      : "Tegel";
    alternativeItems.push({ box: b, formaat, look, kleur, omschrijving });
  };

  // Stap 1: tier >= 1 (top + standaard) met positieve score
  for (const s of scored) {
    if (alternativeItems.length >= 3) break;
    if (s.tier < 1) continue;
    if (s.score <= 0) continue;
    pushAlt(s.row);
  }
  // Stap 2: aanvullen met "niet aangeraden" alleen als we nog geen 3 hebben
  if (alternativeItems.length < 3) {
    for (const s of scored) {
      if (alternativeItems.length >= 3) break;
      if (s.tier !== -1) continue;
      if (s.score <= 0) continue;
      pushAlt(s.row);
    }
  }

  return {
    box: pickBox,
    formaat: String(pick[COL.FORMAAT] ?? ""),
    look: String(pick[COL.LOOK] ?? ""),
    kleur: String(pick[COL.KLEUR] ?? ""),
    kamer: String(pick[COL.KAMER] ?? ""),
    raw: pick,
    alternatives: topRows.filter((r) => r !== pick).slice(0, 3),
    alternativeItems,
  };
}

/** Formatteer een MatchResult als nette adviestekst voor de klant. */
export function formatAdvice(m: MatchResult, c: MatchCriteria): string {
  if (m.isFallback) {
    const boxen = (m.fallbackBoxes ?? []).map((b) => `Box ${b}`);
    const boxenTxt =
      boxen.length === 2 ? `${boxen[0]} en ${boxen[1]}` : boxen.join(", ");
    const kamer = c.kamer && !isOnverschillig(c.kamer) ? c.kamer : "deze ruimte";

    if (m.conflictReason === "look_niet_in_toepassing") {
      const lookTxt = (m.conflictLook || c.look || "deze look").toLowerCase();
      const toep = (m.conflictToepassing || c.toepassing || "").toLowerCase();
      const andere = toep.startsWith("vloer") ? "wandtegel" : "vloertegel";
      const gevraagd = toep.startsWith("vloer") ? "vloer" : "wand";
      const altTxt = boxenTxt
        ? ` Voor de ${gevraagd} in de ${kamer} zijn onze bestverkochte keuzes ${boxenTxt} — die zou ik u graag tonen als alternatief.`
        : "";
      return (
        `In onze collectie hebben we ${lookTxt} alleen als ${andere} — niet als ${gevraagd}tegel.${altTxt} ` +
        `Kom gerust langs in de showroom om de mogelijkheden samen met onze adviseur te bekijken.`
      );
    }

    return (
      `Ik vind geen exacte match voor deze specifieke combinatie, maar onze bestverkochte boxen voor de ${kamer} zijn ${boxenTxt}. ` +
      `Kom gerust langs in de showroom om deze in het echt te bekijken — onze adviseurs helpen u graag persoonlijk verder.`
    );
  }

  const heeftHuisdieren = !isOnverschillig(c.huisdieren) && isHuisdierenJa(c.huisdieren);
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
