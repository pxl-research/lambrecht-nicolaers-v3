// Verborgen webhook-logger naar Power Automate
export const WEBHOOK_URL =
  "https://default0bff66c545db46ed8b8187959e069b.90.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/b8a22310a97c455a88823183092f58ec/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=7QHLoLNoFOjUtGStmQqprKbYSWRl56FSt7C2Vw_vweI";

// Marker waarmee de AI eventueel gestructureerde data meegeeft.
export const LOG_MARKER_START = "<<<LOG_JSON";
export const LOG_MARKER_END = "LOG_JSON>>>";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AdviesPayload {
  Kamer: string;
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
      Look: String(parsed.Look ?? ""),
      Kleur: String(parsed.Kleur ?? ""),
      Huisdieren: String(parsed.Huisdieren ?? ""),
      Plaatsing: String(parsed.Plaatsing ?? ""),
      Advies_box: String(parsed.Advies_box ?? ""),
    };
  } catch {
    return null;
  }
}

export function detectBox(text: string): string | null {
  const m = text.match(/\bBox\s*(\d{1,3})\b/i);
  return m ? `Box ${m[1]}` : null;
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
  if (/\b(geen huisdier|geen dieren|geen)\b/.test(userText)) huisdieren = "nee";
  if (/\b(hond|kat|huisdier|dier)\b/.test(userText)) huisdieren = "ja";

  let plaatsing = "";
  if (/\b(zelf|doe het zelf|diy)\b/.test(userText)) plaatsing = "zelf";
  else if (/\b(vakman|tegelzetter|laten leggen|laten plaatsen)\b/.test(userText))
    plaatsing = "vakman";

  return {
    Kamer: kamer,
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

export interface ExcelPayload {
  Datum: string;
  Kamer: string;
  Look: string;
  Kleur: string;
  Huisdieren: string;
  Plaatsing: string;
  Advies_box: string;
  Volledig_Gesprek: string;
}

export function buildPayload(
  advies: AdviesPayload,
  turns: ConversationTurn[]
): ExcelPayload {
  return {
    Datum: new Date().toISOString(),
    Kamer: advies.Kamer,
    Look: advies.Look,
    Kleur: advies.Kleur,
    Huisdieren: advies.Huisdieren,
    Plaatsing: advies.Plaatsing,
    Advies_box: advies.Advies_box,
    Volledig_Gesprek: formatGesprek(turns),
  };
}

// Robuuste verzendfunctie. Geeft null bij succes, anders een foutmelding.
export async function sendToExcel(payload: ExcelPayload): Promise<string | null> {
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      mode: "cors",
      headers: { "Content-Type": "application/json" },
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
