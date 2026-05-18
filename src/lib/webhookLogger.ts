// Verborgen webhook-logger — gaat via een edge function zodat de
// Power Automate URL (incl. SAS-signature) niet in de frontend exposed is.
const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL as string;
const CLOUD_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
const LOG_ENDPOINT = `${CLOUD_URL}/functions/v1/log-conversation`;

// Marker waarmee de AI eventueel gestructureerde data meegeeft.
export const LOG_MARKER_START = "<<<LOG_JSON";
export const LOG_MARKER_END = "LOG_JSON>>>";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AdviesPayload {
  Kamer: string;
  Toepassing: string;
  Look: string;
  Kleur: string;
  Huisdieren: string;
  Plaatsing: string;
  Advies_box: string;
}

// Verwijdert het verborgen JSON-blok uit de zichtbare tekst.
export function stripLogBlock(text: string): string {
  const start = text.indexOf(LOG_MARKER_START);
  if (start === -1) return text;
  const end = text.indexOf(LOG_MARKER_END, start);
  if (end === -1) return text.slice(0, start).trimEnd();
  return (text.slice(0, start) + text.slice(end + LOG_MARKER_END.length))
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function extractAdvies(text: string): AdviesPayload | null {
  const start = text.indexOf(LOG_MARKER_START);
  if (start === -1) return null;
  const end = text.indexOf(LOG_MARKER_END, start);
  if (end === -1) return null;
  const raw = text.slice(start + LOG_MARKER_START.length, end).trim();
  try {
    const parsed = JSON.parse(raw);
    return {
      Kamer: String(parsed.Kamer ?? ""),
      Toepassing: String(parsed.Toepassing ?? ""),
      Look: String(parsed.Look ?? ""),
      Kleur: String(parsed.Kleur ?? ""),
      Huisdieren: String(parsed.Huisdieren ?? ""),
      Plaatsing: String(parsed.Plaatsing ?? ""),
      Advies_box: String(parsed.Advies_expo ?? parsed.Advies_box ?? ""),
    };
  } catch {
    return null;
  }
}

export function detectBox(text: string): string | null {
  const m = text.match(/\b(?:Expo|Box)\s*(\d{1,3})\b/i);
  return m ? `Expo ${m[1]}` : null;
}

export function inferAdviesFromTurns(
  turns: ConversationTurn[],
  box: string
): AdviesPayload {
  const userText = turns
    .filter((t) => t.role === "user")
    .map((t) => t.content)
    .join(" \n ")
    .toLowerCase();
  const assistantText = turns
    .filter((t) => t.role === "assistant")
    .map((t) => t.content)
    .join(" \n ")
    .toLowerCase();
  const all = `${userText}\n${assistantText}`;

  const pick = (opts: string[]): string => {
    for (const o of opts) {
      const re = new RegExp(`\\b${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(all)) return o;
    }
    return "";
  };

  const kamer = pick([
    "badkamer", "keuken", "woonkamer", "hal", "terras",
    "slaapkamer", "toilet", "zwembad",
  ]);
  const look = pick([
    "marmer", "natuursteen", "parket", "betonlook", "beton",
    "terrazzo", "travertijn", "ceppo di gres", "mortex",
    "zelliges", "mozaiek",
  ]);
  const kleur = pick([
    "wit", "grijs", "beige", "bruin", "zwart", "blauw",
    "groen", "taupe", "zand", "greige", "antraciet",
  ]);

let huisdieren = "";
  if (/\b(geen huisdier|geen dieren|geen kinderen|geen kind|geen)\b/.test(userText)) huisdieren = "nee";
  if (/\b(hond|kat|huisdier|dier|kind|kinderen|kindjes|baby|peuter|kleuter)\b/.test(userText)) huisdieren = "ja";

  let plaatsing = "";
  if (/\b(zelf|doe het zelf|diy)\b/.test(userText)) plaatsing = "zelf";
  else if (/\b(vakman|tegelzetter|laten leggen|laten plaatsen)\b/.test(userText))
    plaatsing = "vakman";

  const heeftVloer = /\b(vloertegel|vloertegels|vloer)\b/.test(all);
  const heeftWand = /\b(wandtegel|wandtegels|wand|muur|muurtegel)\b/.test(all);
  let toepassing = "";
  if (heeftVloer && heeftWand) toepassing = "beide";
  else if (heeftVloer) toepassing = "vloer";
  else if (heeftWand) toepassing = "wand";

  return {
    Kamer: kamer,
    Toepassing: toepassing,
    Look: look,
    Kleur: kleur,
    Huisdieren: huisdieren,
    Plaatsing: plaatsing,
    Advies_box: box,
  };
}

function formatGesprek(turns: ConversationTurn[]): string {
  return turns
    .map((t) => `${t.role === "user" ? "Klant" : "Assistent"}: ${t.content}`)
    .join("\n\n");
}

function formatAdviesBlok(
  advies: AdviesPayload,
  details?: AdviesDetails
): string {
  const boxNr = normalizeBoxValue(advies.Advies_box);
  const alts = details?.alternatives ?? [];
  const hasSecondary = !!details?.secondary && (
    !!normalizeBoxValue(details.secondary.box) ||
    (details.secondary.alternatives?.length ?? 0) > 0
  );
  if (!boxNr && alts.length === 0 && !hasSecondary) return "";

  const blocks: string[] = [];

  const buildBlock = (
    title: string,
    box: string,
    formaat?: string,
    look?: string,
    kleur?: string,
    altList?: AdviesAlternatief[]
  ) => {
    const lines: string[] = [];
    lines.push(`Assistent: [${title}]`);
    const b = normalizeBoxValue(box);
    if (b) lines.push(`- Hoofdmatch: Expo ${b}`);
    if (formaat) lines.push(`- Formaat: ${formaat} cm`);
    if (look) lines.push(`- Look: ${look}`);
    if (kleur) lines.push(`- Kleur: ${kleur}`);
    if (altList && altList.length > 0) {
      lines.push("- Alternatieven:");
      altList.forEach((a, i) => {
        const ab = normalizeBoxValue(a.box);
        const parts = [
          ab ? `Expo ${ab}` : "",
          a.formaat ? `${a.formaat} cm` : "",
          a.omschrijving || "",
        ].filter(Boolean);
        lines.push(`  ${i + 1}. ${parts.join(" — ")}`);
      });
    }
    return lines.join("\n");
  };

  const primaryTitle = hasSecondary
    ? `Persoonlijk advies ${(details?.primaryLabel || "vloertegel").toLowerCase()}`
    : "Persoonlijk advies";
  if (boxNr || alts.length > 0) {
    blocks.push(
      buildBlock(
        primaryTitle,
        advies.Advies_box,
        details?.formaat,
        details?.look,
        details?.kleur,
        alts
      )
    );
  }

  if (hasSecondary && details?.secondary) {
    const sec = details.secondary;
    blocks.push(
      buildBlock(
        `Persoonlijk advies ${(sec.label || "wandtegel").toLowerCase()}`,
        sec.box,
        sec.formaat,
        sec.look,
        sec.kleur,
        sec.alternatives ?? []
      )
    );
  }

  return blocks.join("\n\n");
}

export type AdviesStatus =
  | "Voltooid"
  | "Niet afgerond"
  | "Beëindigd - Off-topic";

export interface AdviesAlternatief {
  box: string;
  formaat: string;
  omschrijving: string;
}

export interface AdviesDetails {
  formaat?: string; // hoofdmatch formaat (bv "60x120")
  look?: string;    // hoofdmatch look
  kleur?: string;   // hoofdmatch kleur
  alternatives?: AdviesAlternatief[]; // tot 3 alternatieven
  /** Label voor het hoofdadvies wanneer er ook een secundair advies is, bv "Vloertegel". */
  primaryLabel?: string;
  /** Tweede advies (bv. wandtegel) bij combinatie vloer+wand. */
  secondary?: {
    label: string;
    box: string;
    formaat?: string;
    look?: string;
    kleur?: string;
    alternatives?: AdviesAlternatief[];
  };
}

export interface ExcelPayload {
  Datum: string;
  ConversationId: string;
  Kamer: string;
  Toepassing: string;
  Look: string;
  Kleur: string;
  Huisdieren: string;
  Plaatsing: string;
  Advies_expo: string;
  Advies_formaat: string;
  Advies_look: string;
  Advies_kleur: string;
  Alt1_expo: string;
  Alt1_formaat: string;
  Alt1_omschrijving: string;
  Alt2_expo: string;
  Alt2_formaat: string;
  Alt2_omschrijving: string;
  Alt3_expo: string;
  Alt3_formaat: string;
  Alt3_omschrijving: string;
  // Tweede advies (bij toepassing "beide": vloer + wand)
  Advies2_label: string;
  Advies2_expo: string;
  Advies2_formaat: string;
  Advies2_look: string;
  Advies2_kleur: string;
  Alt2_1_expo: string;
  Alt2_1_formaat: string;
  Alt2_1_omschrijving: string;
  Alt2_2_expo: string;
  Alt2_2_formaat: string;
  Alt2_2_omschrijving: string;
  Volledig_Gesprek: string;
  status: AdviesStatus;
  Aantal_Sterren: string;
}

/**
 * Normaliseer Advies_box naar enkel het boxnummer (bv. "11").
 * Accepteert input als "Box 11", "box11", "11", "Box 11 in de showroom", etc.
 * Geeft "" terug als er geen nummer in zit.
 */
export function normalizeBoxValue(v: string): string {
  if (!v) return "";
  const m = String(v).match(/(\d{1,4})/);
  return m ? m[1] : "";
}

export function buildPayload(
  advies: AdviesPayload,
  turns: ConversationTurn[],
  status: AdviesStatus = "Voltooid",
  details?: AdviesDetails,
  options?: { conversationId?: string; rating?: number }
): ExcelPayload {
  const alts = details?.alternatives ?? [];
  const alt = (i: number) => alts[i] ?? { box: "", formaat: "", omschrijving: "" };
  const a1 = alt(0);
  const a2 = alt(1);
  const a3 = alt(2);
  const sec = details?.secondary;
  const secAlts = sec?.alternatives ?? [];
  const sAlt = (i: number) => secAlts[i] ?? { box: "", formaat: "", omschrijving: "" };
  const s1 = sAlt(0);
  const s2 = sAlt(1);
  return {
    Datum: new Date().toISOString(),
    ConversationId: options?.conversationId ?? "",
    Kamer: advies.Kamer,
    Toepassing: advies.Toepassing,
    Look: advies.Look,
    Kleur: advies.Kleur,
    Huisdieren: advies.Huisdieren,
    Plaatsing: advies.Plaatsing,
    Advies_expo: normalizeBoxValue(advies.Advies_box),
    Advies_formaat: details?.formaat ?? "",
    Advies_look: details?.look ?? "",
    Advies_kleur: details?.kleur ?? "",
    Alt1_expo: normalizeBoxValue(a1.box),
    Alt1_formaat: a1.formaat,
    Alt1_omschrijving: a1.omschrijving,
    Alt2_expo: normalizeBoxValue(a2.box),
    Alt2_formaat: a2.formaat,
    Alt2_omschrijving: a2.omschrijving,
    Alt3_expo: normalizeBoxValue(a3.box),
    Alt3_formaat: a3.formaat,
    Alt3_omschrijving: a3.omschrijving,
    Advies2_label: sec?.label ?? "",
    Advies2_expo: normalizeBoxValue(sec?.box ?? ""),
    Advies2_formaat: sec?.formaat ?? "",
    Advies2_look: sec?.look ?? "",
    Advies2_kleur: sec?.kleur ?? "",
    Alt2_1_expo: normalizeBoxValue(s1.box),
    Alt2_1_formaat: s1.formaat,
    Alt2_1_omschrijving: s1.omschrijving,
    Alt2_2_expo: normalizeBoxValue(s2.box),
    Alt2_2_formaat: s2.formaat,
    Alt2_2_omschrijving: s2.omschrijving,
    Volledig_Gesprek: (() => {
      const gesprek = formatGesprek(turns);
      const adviesBlok = formatAdviesBlok(advies, details);
      return adviesBlok ? `${gesprek}\n\n${adviesBlok}` : gesprek;
    })(),
    status,
    Aantal_Sterren: String(options?.rating ?? 0),
  };
}

// Robuuste verzendfunctie. Geeft null bij succes, anders een foutmelding.
export async function sendToExcel(payload: ExcelPayload): Promise<string | null> {
  try {
    const response = await fetch(LOG_ENDPOINT, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLOUD_KEY}`,
        apikey: CLOUD_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let extra = "";
      try {
        extra = await response.text();
      } catch {
        // negeer
      }
      return `HTTP ${response.status}${extra ? `: ${extra.slice(0, 120)}` : ""}`;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
      return `Netwerkfout / CORS: ${msg}`;
    }
    return `Fout: ${msg}`;
  }
}

// Behoud van oude API voor compatibiliteit (fire-and-forget variant).
export async function sendAdviesLog(
  advies: AdviesPayload,
  turns: ConversationTurn[]
): Promise<string | null> {
  return sendToExcel(buildPayload(advies, turns));
}

/**
 * Verstuur enkel een rating-update voor een bestaand gesprek.
 * Power Automate kan op basis van ConversationId de bestaande rij terugvinden
 * en het Rating-veld bijwerken (IsRatingUpdate=true als marker).
 */
export async function sendRatingUpdate(
  conversationId: string,
  rating: number
): Promise<string | null> {
  const payload = {
    ConversationId: conversationId,
    Aantal_Sterren: String(rating),
    IsRatingUpdate: true,
    Datum: new Date().toISOString(),
  };
  try {
    const response = await fetch(LOG_ENDPOINT, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLOUD_KEY}`,
        apikey: CLOUD_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      let extra = "";
      try {
        extra = await response.text();
      } catch {
        // negeer
      }
      return `HTTP ${response.status}${extra ? `: ${extra.slice(0, 120)}` : ""}`;
    }
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Fout: ${msg}`;
  }
}
