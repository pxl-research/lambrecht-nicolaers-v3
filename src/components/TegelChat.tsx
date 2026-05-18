import { useState, useRef, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import ChatWelcome from "./ChatWelcome";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import AdviceCard from "./AdviceCard";
import RatingStars from "./RatingStars";
import logoLambrechts from "@/assets/logo-lambrechts.png";
import { streamPuterChat, type ChatMessage as AIChatMessage } from "@/lib/puterAI";
import {
  stripLogBlock,
  extractAdvies,
  inferAdviesFromTurns,
  sendToExcel,
  sendRatingUpdate,
  buildPayload,
  normalizeBoxValue,
  type ConversationTurn,
} from "@/lib/webhookLogger";
import { findBestMatch, formatAdvice, type MatchCriteria } from "@/lib/tegelMatcher";
import { detectKennisQuery, lookupKennis, formatKennisContext } from "@/lib/tegelKennis";

interface AdviceAltItem { box: string; formaat: string; omschrijving: string }
interface AdviceCombinedSection {
  label: string;
  box: string;
  formaat: string;
  omschrijving?: string;
  alternatives?: AdviceAltItem[];
}
interface AdviceCardData {
  box: string;
  formaat: string;
  intro: string;
  outro: string;
  isFallback?: boolean;
  fallbackBoxes?: string[];
  kamer?: string;
  alternatives?: AdviceAltItem[];
  combined?: AdviceCombinedSection[];
}

interface Message {
  id: string;
  content: string;
  role: "assistant" | "user";
  kind?: "text" | "advice" | "system-warning";
  card?: AdviceCardData;
}

// === Rate limiting / kostenbeheersing ===
const MAX_USER_MESSAGES = 15;
const WARN_AT_USER_MESSAGES = 12;

// === Off-topic 3-strikes ===
const MAX_OFF_TOPIC = 3;
// Unieke zin uit de system prompt — als de AI hiermee antwoordt, is dat een off-topic weigering.
const OFF_TOPIC_REFUSAL_MARKER =
  "als interieuradviseur van Lambrechts-Nicolaers ben ik gespecialiseerd in tegels en vloeren";

// === Vinyl-afhandeling ===
const VINYL_REGEX = /\b(vinyl|vinylvloer|vinylvloeren|pvc|pvc-vloer|floorify|lamett)\b/i;
const VINYL_REPLY =
  "Op de eerste verdieping kan je vinyl vloeren terug vinden van Floorify en Lamett. Voor meer informatie over deze vloeren, zal een verkoper u persoonlijk advies geven. Wilt u nog verder kijken voor tegels?";

const isAffirmative = (text: string): boolean => {
  const t = text.toLowerCase().trim();
  if (!t) return false;
  if (/\b(nee|neen|nope|niet|geen|stop|hoeft niet|laat maar|dat was alles|ander(e)? keer)\b/.test(t)) return false;
  return /\b(ja|jaa+|jawel|graag|zeker|oké|ok(e|é)?|prima|tuurlijk|natuurlijk|doe maar|ga door|verder|klopt|inderdaad|voor)\b/.test(t);
};

const TegelChat = () => {
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationEnded, setConversationEnded] = useState(false);
  const [rating, setRating] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const adviceSentRef = useRef<boolean>(false);
  const warnedRef = useRef<boolean>(false);
  const limitReachedRef = useRef<boolean>(false);
  const offTopicCountRef = useRef<number>(0);
  const gratieResetsGebruiktRef = useRef<number>(0);
  const terminatedRef = useRef<boolean>(false);
  const vinylPendingRef = useRef<boolean>(false);
  const conversationIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  const userMessageCount = messages.filter((m) => m.role === "user").length;
  const limitReached = userMessageCount >= MAX_USER_MESSAGES;
  const adviceGiven = messages.some(
    (m) => m.kind === "advice" && m.card && !!m.card.box
  );

  useEffect(() => {
    let frame = 0;

    const updateAppHeight = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const height = window.visualViewport?.height ?? window.innerHeight;
        document.documentElement.style.setProperty("--app-height", `${Math.round(height)}px`);
      });
    };

    updateAppHeight();
    window.addEventListener("resize", updateAppHeight);
    window.visualViewport?.addEventListener("resize", updateAppHeight);
    window.visualViewport?.addEventListener("scroll", updateAppHeight);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateAppHeight);
      window.visualViewport?.removeEventListener("resize", updateAppHeight);
      window.visualViewport?.removeEventListener("scroll", updateAppHeight);
    };
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    const last = messages[messages.length - 1];
    // Bij een adviesblok: scroll zodat de TOP van de kaart in beeld is
    // (zo blijft de hoofdaanbeveling zichtbaar, niet enkel de alternatieven).
    if (last?.kind === "advice") {
      const el = scrollRef.current.querySelector<HTMLElement>(
        `[data-msg-id="${last.id}"]`
      );
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, messages[messages.length - 1]?.content]);

  const handleStart = () => {
    setStarted(true);
    setIsStreaming(true);

    streamPuterChat(
      [],
      (delta) => {
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.id === "welcome") {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: m.content + delta } : m
            );
          }
          return [...prev, { id: "welcome", content: delta, role: "assistant" }];
        });
      },
      () => setIsStreaming(false)
    );
  };

  const handleNewConversation = async () => {
    if (messages.length > 0 && !adviceSentRef.current) {
      const turns: ConversationTurn[] = messages
        .filter((m) => m.kind !== "system-warning")
        .map((m) => ({ role: m.role, content: m.content }));

      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const fromLog = lastAssistant ? extractAdvies(lastAssistant.content) : null;
      const advies = fromLog ?? inferAdviesFromTurns(turns, "");

      const payload = buildPayload(advies, turns, "Niet afgerond", undefined, {
        conversationId: conversationIdRef.current,
      });
      console.log("[Excel-log] Niet afgerond — verzenden:", payload);
      const error = await sendToExcel(payload);
      console.log("[Excel-log] Resultaat:", error ?? "OK");
    }

    adviceSentRef.current = false;
    warnedRef.current = false;
    limitReachedRef.current = false;
    offTopicCountRef.current = 0;
    gratieResetsGebruiktRef.current = 0;
    terminatedRef.current = false;
    vinylPendingRef.current = false;
    conversationIdRef.current =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `conv-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRating(0);
    setConversationEnded(false);
    setMessages([]);
    setIsStreaming(false);
    setStarted(false);
  };

  /**
   * Bouw een gecombineerd advies (vloer + wand) wanneer de klant beide vroeg.
   * Geeft per categorie een hoofd-box + 2 alternatieven.
   */
  const buildCombinedCard = async (
    baseCriteria: MatchCriteria
  ): Promise<{
    card: AdviceCardData;
    primaryLabel: string;
    primaryBox: string;
    primaryFormaat: string;
    primaryLook: string;
    primaryKleur: string;
    primaryAlts: AdviceAltItem[];
    secondaryLabel: string;
    secondaryBox: string;
    secondaryFormaat: string;
    secondaryLook: string;
    secondaryKleur: string;
    secondaryAlts: AdviceAltItem[];
  } | null> => {
    const vloerCrit = { ...baseCriteria, toepassing: "vloer" };
    const wandCrit = { ...baseCriteria, toepassing: "wand" };
    const [vloerMatch, wandMatch] = await Promise.all([
      findBestMatch(vloerCrit),
      findBestMatch(wandCrit),
    ]);

    const sections: AdviceCombinedSection[] = [];
    const buildSection = (label: string, m: typeof vloerMatch): AdviceCombinedSection | null => {
      if (!m || m.isFallback) return null;
      const alts: AdviceAltItem[] = (m.alternativeItems ?? []).slice(0, 2).map((a) => ({
        box: a.box,
        formaat: a.formaat,
        omschrijving: a.omschrijving,
      }));
      const omschrijving = m.look
        ? m.kleur
          ? `${m.look.charAt(0).toUpperCase() + m.look.slice(1)} in ${m.kleur}`
          : m.look.charAt(0).toUpperCase() + m.look.slice(1)
        : undefined;
      return {
        label,
        box: m.box,
        formaat: (m.formaat || "").split("/")[0].trim(),
        omschrijving,
        alternatives: alts,
      };
    };

    const vloerSection = buildSection("Vloertegel", vloerMatch);
    const wandSection = buildSection("Wandtegel", wandMatch);
    if (vloerSection) sections.push(vloerSection);
    if (wandSection) sections.push(wandSection);
    if (sections.length === 0) return null;

    const card: AdviceCardData = {
      box: "",
      formaat: "",
      intro:
        "Voor uw project heb ik zowel een vloer- als wandtegel uitgekozen, met telkens twee mooie alternatieven.",
      outro:
        "Kom gerust langs in de showroom om de tegels in het echt te ervaren — onze adviseurs helpen u graag verder.",
      combined: sections,
    };

    // Bepaal primary (voorkeur: vloer) en secondary (de andere).
    const vloerOk = vloerMatch && !vloerMatch.isFallback;
    const wandOk = wandMatch && !wandMatch.isFallback;
    const primaryMatch = vloerOk ? vloerMatch : wandMatch;
    const primaryLabel = vloerOk ? "Vloertegel" : "Wandtegel";
    const secondaryMatch = vloerOk && wandOk ? wandMatch : null;
    const secondaryLabel = vloerOk && wandOk ? "Wandtegel" : "";

    const mapAlts = (m: typeof vloerMatch): AdviceAltItem[] =>
      m?.alternativeItems?.slice(0, 2).map((a) => ({
        box: a.box,
        formaat: a.formaat,
        omschrijving: a.omschrijving,
      })) ?? [];

    return {
      card,
      primaryLabel,
      primaryBox: primaryMatch?.box ?? "",
      primaryFormaat: primaryMatch?.formaat ?? "",
      primaryLook: primaryMatch?.look ?? "",
      primaryKleur: primaryMatch?.kleur ?? "",
      primaryAlts: mapAlts(primaryMatch),
      secondaryLabel,
      secondaryBox: secondaryMatch?.box ?? "",
      secondaryFormaat: secondaryMatch?.formaat ?? "",
      secondaryLook: secondaryMatch?.look ?? "",
      secondaryKleur: secondaryMatch?.kleur ?? "",
      secondaryAlts: mapAlts(secondaryMatch),
    };
  };

  /**
   * Forceer een eindadvies op basis van wat we tot nu toe weten (gebruikt
   * inferAdviesFromTurns + Supabase match, ook bij onvolledige criteria).
   */
  const handleForceAdvice = async () => {
    if (adviceSentRef.current) return;
    adviceSentRef.current = true;

    const turns: ConversationTurn[] = messages
      .filter((m) => m.kind !== "system-warning")
      .map((m) => ({ role: m.role, content: m.content }));

    const inferred = inferAdviesFromTurns(turns, "");
    const criteria: MatchCriteria = {
      kamer: inferred.Kamer,
      toepassing: inferred.Toepassing,
      look: inferred.Look,
      kleur: inferred.Kleur,
      huisdieren: inferred.Huisdieren,
      plaatsing: inferred.Plaatsing,
    };

    let card: AdviceCardData;
    let realBox = "";
    let realFormaat = "";
    let realLook = "";
    let realKleur = "";
    let realAlternatives: { box: string; formaat: string; omschrijving: string }[] = [];
    let primaryLabel = "";
    let secondaryInfo: {
      label: string;
      box: string;
      formaat: string;
      look: string;
      kleur: string;
      alternatives: { box: string; formaat: string; omschrijving: string }[];
    } | undefined;

    try {
      const isBeide = (criteria.toepassing || "").toLowerCase().trim() === "beide";
      const combined = isBeide ? await buildCombinedCard(criteria) : null;
      const match = combined ? null : await findBestMatch(criteria);
      if (combined) {
        card = combined.card;
        realBox = combined.primaryBox;
        realFormaat = combined.primaryFormaat;
        realLook = combined.primaryLook;
        realKleur = combined.primaryKleur;
        realAlternatives = combined.primaryAlts;
        primaryLabel = combined.primaryLabel;
        if (combined.secondaryLabel) {
          secondaryInfo = {
            label: combined.secondaryLabel,
            box: combined.secondaryBox,
            formaat: combined.secondaryFormaat,
            look: combined.secondaryLook,
            kleur: combined.secondaryKleur,
            alternatives: combined.secondaryAlts,
          };
        }
      } else if (match) {
        if (match.isFallback) {
          card = {
            box: "",
            formaat: "",
            intro:
              "We hebben het maximum aantal vragen bereikt. Op basis van uw antwoorden tot nu toe:",
            outro: "Kom langs in de showroom voor persoonlijk advies.",
            isFallback: true,
            fallbackBoxes: match.fallbackBoxes,
            kamer: criteria.kamer,
          };
        } else {
          realBox = match.box;
          realFormaat = match.formaat;
          realLook = match.look;
          realKleur = match.kleur;
          realAlternatives =
            match.alternativeItems?.map((a) => ({
              box: a.box,
              formaat: a.formaat,
              omschrijving: a.omschrijving,
            })) ?? [];
          card = {
            box: match.box,
            formaat: match.formaat,
            intro: formatAdvice(match, criteria).split("\n\n")[0],
            outro:
              "Kom gerust langs om de tegel in het echt te ervaren — onze adviseurs helpen u graag verder.",
            alternatives: realAlternatives,
          };
        }
      } else {
        card = {
          box: "",
          formaat: "",
          intro:
            "We hebben het maximum aantal vragen bereikt en konden geen passende match vinden.",
          outro: "Kom langs in de showroom voor persoonlijk advies.",
          isFallback: true,
          fallbackBoxes: [],
          kamer: criteria.kamer,
        };
      }
    } catch (err) {
      console.error("[Force advice] match faalde:", err);
      card = {
        box: "",
        formaat: "",
        intro:
          "We hebben het maximum aantal vragen bereikt. De showroomdatabase is op dit moment niet bereikbaar.",
        outro: "Kom gerust langs in de showroom — wij adviseren u persoonlijk.",
        isFallback: true,
        fallbackBoxes: [],
        kamer: criteria.kamer,
      };
    }

    const adviceMsg: Message = {
      id: Date.now().toString() + "-force-advice",
      content: "",
      role: "assistant",
      kind: "advice",
      card,
    };
    const updated = [...messages, adviceMsg];
    setMessages(updated);

    const payload = buildPayload(
      {
        Kamer: inferred.Kamer,
        Toepassing: inferred.Toepassing,
        Look: inferred.Look,
        Kleur: inferred.Kleur,
        Huisdieren: inferred.Huisdieren,
        Plaatsing: inferred.Plaatsing,
        Advies_box: normalizeBoxValue(realBox || (card.fallbackBoxes?.[0] ?? "")),
      },
      updated
        .filter((m) => m.kind !== "system-warning" && m.kind !== "advice")
        .map((m) => ({ role: m.role, content: m.content })),
      "Voltooid",
      {
        formaat: realFormaat,
        look: realLook,
        kleur: realKleur,
        alternatives: realAlternatives,
        primaryLabel,
        secondary: secondaryInfo,
      }
    );
    (payload as unknown as Record<string, string>).Formaat_cm = realFormaat;
    console.log("[Excel-log] Force-advice verzenden:", payload);
    const error = await sendToExcel(payload);
    console.log("[Excel-log] Resultaat:", error ?? "OK");
  };

  const handleCompletedAssistantMessage = async (
    rawText: string,
    assistantId: string,
    allMessages: Message[]
  ) => {
    const advies = extractAdvies(rawText);
    if (!advies) return;
    if (adviceSentRef.current) return;

    const heeftAlles =
      advies.Kamer && advies.Toepassing && advies.Look && advies.Kleur && advies.Huisdieren && advies.Plaatsing;
    if (!heeftAlles) return;

    adviceSentRef.current = true;

    const criteria: MatchCriteria = {
      kamer: advies.Kamer,
      toepassing: advies.Toepassing,
      look: advies.Look,
      kleur: advies.Kleur,
      huisdieren: advies.Huisdieren,
      plaatsing: advies.Plaatsing,
    };

    let card: AdviceCardData;
    let realBox = "";
    let realFormaat = "";
    let realLook = "";
    let realKleur = "";
    let realAlternatives: { box: string; formaat: string; omschrijving: string }[] = [];
    let primaryLabel = "";
    let secondaryInfo: {
      label: string;
      box: string;
      formaat: string;
      look: string;
      kleur: string;
      alternatives: { box: string; formaat: string; omschrijving: string }[];
    } | undefined;

    try {
      const isBeide = (criteria.toepassing || "").toLowerCase().trim() === "beide";
      const combined = isBeide ? await buildCombinedCard(criteria) : null;
      const match = combined ? null : await findBestMatch(criteria);
      if (combined) {
        card = combined.card;
        realBox = combined.primaryBox;
        realFormaat = combined.primaryFormaat;
        realLook = combined.primaryLook;
        realKleur = combined.primaryKleur;
        realAlternatives = combined.primaryAlts;
        primaryLabel = combined.primaryLabel;
        if (combined.secondaryLabel) {
          secondaryInfo = {
            label: combined.secondaryLabel,
            box: combined.secondaryBox,
            formaat: combined.secondaryFormaat,
            look: combined.secondaryLook,
            kleur: combined.secondaryKleur,
            alternatives: combined.secondaryAlts,
          };
        }
      } else if (match?.isFallback) {
        card = {
          box: "",
          formaat: "",
          intro:
            "Ik vind geen exacte match voor deze specifieke combinatie, maar deze boxen passen het best bij uw kamer:",
          outro: "Kom gerust langs in de showroom om deze in het echt te bekijken.",
          isFallback: true,
          fallbackBoxes: match.fallbackBoxes,
          kamer: criteria.kamer,
        };
      } else if (match) {
        realBox = match.box;
        realFormaat = match.formaat;
        realLook = match.look;
        realKleur = match.kleur;
        realAlternatives =
          match.alternativeItems?.map((a) => ({
            box: a.box,
            formaat: a.formaat,
            omschrijving: a.omschrijving,
          })) ?? [];
        card = {
          box: match.box,
          formaat: match.formaat,
          intro: `Ik raad u de ${match.look || "geselecteerde tegel"}${
            match.kleur ? ` in ${match.kleur}` : ""
          } aan.`,
          outro:
            "Kom gerust langs in de showroom om de tegel in het echt te ervaren — onze adviseurs helpen u graag verder.",
          alternatives: realAlternatives,
        };
      } else {
        card = {
          box: "",
          formaat: "",
          intro:
            "Op basis van uw wensen heb ik in onze actuele collectie geen exacte match gevonden.",
          outro:
            "Kom langs in onze showroom — dan bekijken we samen de mogelijkheden.",
          isFallback: true,
          fallbackBoxes: [],
          kamer: criteria.kamer,
        };
      }
    } catch (err) {
      console.error("[Supabase match] Fout:", err);
      card = {
        box: "",
        formaat: "",
        intro: "Ik kan op dit moment de showroomdatabase niet bereiken.",
        outro: "Komt u gerust langs in de showroom — wij adviseren u persoonlijk.",
        isFallback: true,
        fallbackBoxes: [],
        kamer: criteria.kamer,
      };
    }

    const adviceMsg: Message = {
      id: assistantId + "-advice",
      content: "",
      role: "assistant",
      kind: "advice",
      card,
    };

    // Geef de klant tijd om het laatste chat-antwoord te lezen voordat
    // de adviceCard verschijnt. Leestijd ~25 tekens/seconde, tussen 2.5s en 7s.
    const lastAssistantText = stripLogBlock(rawText).trim();
    const readMs = Math.min(
      7000,
      Math.max(2500, Math.round((lastAssistantText.length / 25) * 1000))
    );
    await new Promise((resolve) => setTimeout(resolve, readMs));

    const updated = [...allMessages, adviceMsg];
    setMessages(updated);

    const turns: ConversationTurn[] = updated
      .filter((m) => m.kind !== "system-warning" && m.kind !== "advice")
      .map((m) => ({ role: m.role, content: m.content }));
    const payload = buildPayload(
      {
        Kamer: advies.Kamer,
        Toepassing: advies.Toepassing,
        Look: advies.Look,
        Kleur: advies.Kleur,
        Huisdieren: advies.Huisdieren,
        Plaatsing: advies.Plaatsing,
        Advies_box: normalizeBoxValue(realBox || advies.Advies_box || ""),
      },
      turns,
      "Voltooid",
      {
        formaat: realFormaat,
        look: realLook,
        kleur: realKleur,
        alternatives: realAlternatives,
        primaryLabel,
        secondary: secondaryInfo,
      }
    );
    (payload as unknown as Record<string, string>).Formaat_cm = realFormaat;

    console.log("[Excel-log] Verzenden:", payload);
    const error = await sendToExcel(payload);
    console.log("[Excel-log] Resultaat:", error ?? "OK");
  };

  /**
   * Beëindig het gesprek wegens herhaaldelijke off-topic vragen.
   * Logt de tot dan toe verzamelde data met status "Beëindigd - Off-topic"
   * en reset daarna alle state — gebruiker keert terug naar het welkomstscherm.
   */
  const terminateForOffTopic = async (currentMessages: Message[]) => {
    if (terminatedRef.current) return;
    terminatedRef.current = true;
    limitReachedRef.current = true; // blokkeer verdere AI-calls

    const farewell: Message = {
      id: Date.now().toString() + "-terminate",
      role: "assistant",
      content:
        "Leuk dat u langs bent gekomen! Ik merk dat we een beetje afdwalen — laten we straks even fris herstarten zodat ik u écht kan helpen met de juiste tegelkeuze. Ik bewaar uw voorkeuren en breng u terug naar het startscherm.",
      kind: "system-warning",
    };
    const withFarewell = [...currentMessages, farewell];
    setMessages(withFarewell);

    // Verzamel data tot nu toe
    const turns: ConversationTurn[] = withFarewell
      .filter((m) => m.kind !== "system-warning" && m.kind !== "advice")
      .map((m) => ({ role: m.role, content: m.content }));

    const lastAssistant = [...withFarewell]
      .reverse()
      .find((m) => m.role === "assistant" && m.kind !== "system-warning" && m.kind !== "advice");
    const fromLog = lastAssistant ? extractAdvies(lastAssistant.content) : null;
    const advies = fromLog ?? inferAdviesFromTurns(turns, "");

    const payload = buildPayload(advies, turns, "Beëindigd - Off-topic");
    console.log("[Excel-log] Off-topic beëindiging — verzenden:", payload);
    try {
      const error = await sendToExcel(payload);
      console.log("[Excel-log] Resultaat:", error ?? "OK");
    } catch (err) {
      console.error("[Excel-log] Fout bij off-topic verzenden:", err);
    }

    // Korte pauze zodat gebruiker het bericht kan lezen, dan reset
    setTimeout(() => {
      adviceSentRef.current = false;
      warnedRef.current = false;
      limitReachedRef.current = false;
      offTopicCountRef.current = 0;
      gratieResetsGebruiktRef.current = 0;
      terminatedRef.current = false;
      setMessages([]);
      setIsStreaming(false);
      setStarted(false);
    }, 4000);
  };

  const handleSend = async (content: string) => {
    if (limitReachedRef.current || terminatedRef.current || adviceGiven || conversationEnded) return;

    const userMsg: Message = {
      id: Date.now().toString() + "user",
      content,
      role: "user",
    };

    // === Vinyl-flow: wacht op ja/nee na het vaste vinyl-antwoord ===
    if (vinylPendingRef.current) {
      vinylPendingRef.current = false;
      if (isAffirmative(content)) {
        // Klant wil verder met tegels → reguliere flow vanaf hier hervatten.
        // (Val door naar de standaard handleSend-logica hieronder.)
      } else {
        // Klant wil niets meer → gesprek netjes beëindigen.
        const farewell: Message = {
          id: Date.now().toString() + "-vinyl-end",
          role: "assistant",
          content:
            "Bedankt voor uw bezoek. Onze verkopers helpen u graag verder in de showroom. Tot snel!",
        };
        setMessages((prev) => [...prev, userMsg, farewell]);
        setConversationEnded(true);
        return;
      }
    }

    // === Vinyl-trigger: pauzeer de tegel-flow met een vast antwoord ===
    if (VINYL_REGEX.test(content)) {
      const vinylMsg: Message = {
        id: Date.now().toString() + "-vinyl",
        role: "assistant",
        content: VINYL_REPLY,
      };
      vinylPendingRef.current = true;
      setMessages((prev) => [...prev, userMsg, vinylMsg]);
      return;
    }

    // Bereken de nieuwe count INCL. dit bericht
    const newCount = userMessageCount + 1;

    // Bouw de batch bericht-updates op
    const additions: Message[] = [userMsg];

    // Waarschuwing bij 12e bericht
    if (newCount === WARN_AT_USER_MESSAGES && !warnedRef.current) {
      warnedRef.current = true;
      additions.push({
        id: Date.now().toString() + "-warn",
        role: "assistant",
        content:
          "We zijn er bijna! Ik kan nog 3 vragen beantwoorden voordat we tot een advies komen.",
        kind: "system-warning",
      });
    }

    // Limiet bereikt → blokkeer verdere AI-call, toon afrond-knoppen
    if (newCount >= MAX_USER_MESSAGES) {
      limitReachedRef.current = true;
      additions.push({
        id: Date.now().toString() + "-limit",
        role: "assistant",
        content:
          "We hebben het maximum aantal vragen bereikt. Klik op 'Gesprek afronden & advies tonen' om uw persoonlijk advies te ontvangen, of start een nieuw gesprek.",
        kind: "system-warning",
      });
      setMessages((prev) => [...prev, ...additions]);
      return;
    }

    setMessages((prev) => [...prev, ...additions]);
    setIsStreaming(true);

    const assistantId = Date.now().toString() + "assistant";

    const history: AIChatMessage[] = messages
      .filter((m) => m.kind !== "system-warning" && m.kind !== "advice")
      .map((m) => ({ role: m.role, content: m.content }));
    history.push({ role: "user", content });

    const kennisQ = detectKennisQuery(content);
    if (kennisQ) {
      try {
        const res = await lookupKennis(kennisQ);
        const context = formatKennisContext(kennisQ, res);
        history.push({ role: "system", content: context });
        console.log("[DB_INFO] geïnjecteerd:", kennisQ, res);
      } catch (err) {
        console.error("[DB_INFO] lookup faalde:", err);
      }
    }

    let rawBuffer = "";

    streamPuterChat(
      history,
      (delta) => {
        rawBuffer += delta;
        const visible = stripLogBlock(rawBuffer);

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant" && last.id === assistantId) {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: visible } : m
            );
          }
          return [...prev, { id: assistantId, content: visible, role: "assistant" }];
        });
      },
      () => {
        setIsStreaming(false);
        const cleanText = stripLogBlock(rawBuffer);

        // Off-topic detectie: heeft de AI de verplichte weigeringszin gebruikt?
        const isOffTopic = cleanText
          .toLowerCase()
          .includes(OFF_TOPIC_REFUSAL_MARKER.toLowerCase());

        if (isOffTopic) {
          offTopicCountRef.current += 1;
        } else {
          // Herstel: serieuze tegel-vraag → reset enkel als gratie nog beschikbaar is
          if (
            offTopicCountRef.current > 0 &&
            gratieResetsGebruiktRef.current < 3
          ) {
            offTopicCountRef.current = 0;
            gratieResetsGebruiktRef.current += 1;
            console.log(
              `[Off-topic] Teller gereset (gratie ${gratieResetsGebruiktRef.current}/3 gebruikt)`
            );
          } else if (gratieResetsGebruiktRef.current >= 3) {
            console.log(
              "[Off-topic] Geen gratie meer — teller blijft staan op",
              offTopicCountRef.current
            );
          }
        }
        const strike = offTopicCountRef.current;

        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantId ? { ...m, content: cleanText } : m
          );

          // Strike 3 → beëindigen
          if (isOffTopic && strike >= MAX_OFF_TOPIC) {
            void terminateForOffTopic(updated);
            return updated;
          }

          // Strike 1 of 2 → waarschuwing toevoegen
          if (isOffTopic && strike < MAX_OFF_TOPIC) {
            const warn: Message = {
              id: Date.now().toString() + "-offtopic-warn-" + strike,
              role: "assistant",
              content:
                "Leuk dat u dit vraagt, maar ik ben vooral hier om u te helpen bij uw tegelkeuze. Laten we daarop focussen zodat we de beste match vinden!",
              kind: "system-warning",
            };
            const withWarn = [...updated, warn];
            void handleCompletedAssistantMessage(rawBuffer, assistantId, withWarn);
            return withWarn;
          }

          void handleCompletedAssistantMessage(rawBuffer, assistantId, updated);
          return updated;
        });
      }
    );
  };

  return (
    <div className="w-full max-w-xl lg:max-w-2xl mx-auto h-full md:h-[82vh] md:max-h-[760px] flex flex-col bg-card md:rounded-2xl md:shadow-float overflow-hidden animate-fade-in">
      <div className="px-4 pt-4 pb-3 md:px-8 md:pt-7 md:pb-5 flex items-center gap-3 md:gap-4 bg-card">
        <img
          src={logoLambrechts}
          alt="Lambrechts-Nicolaers"
          className="h-11 w-auto object-contain"
        />
        <div className="flex flex-col">
          <span className="font-display text-[20px] font-normal text-foreground leading-tight tracking-tight">
            Lambrechts-Nicolaers
          </span>
          <span className="text-[10px] text-[#1F2937] font-body font-medium tracking-[0.2em] uppercase mt-1">
            Digitale interieuradviseur · Tongeren
          </span>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse bg-lime-500" />
            <span className="text-[10px] text-[#374151] font-body font-medium tracking-[0.15em] uppercase">
              Online
            </span>
          </div>
          {started && (
            <button
              onClick={handleNewConversation}
              disabled={isStreaming}
              title="Nieuw gesprek starten"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-primary/70 text-primary text-[11px] font-body font-medium tracking-[0.15em] uppercase hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">Nieuw gesprek</span>
            </button>
          )}
        </div>
      </div>

      <div className="mx-4 md:mx-8 h-px bg-border/60" />

      {!started ? (
        <ChatWelcome onStart={handleStart} />
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-8 md:py-8 space-y-1">
            {messages.map((msg, i) => {
              if (msg.kind === "advice" && msg.card) {
                return (
                  <div key={msg.id} data-msg-id={msg.id} className="flex justify-start scroll-mt-4">
                    <AdviceCard {...msg.card} />
                  </div>
                );
              }
              if (msg.kind === "system-warning") {
                return (
                  <div key={msg.id} className="flex justify-center my-3 animate-fade-in">
                    <div className="px-4 py-2 rounded-full bg-primary/10 text-primary text-[12px] font-body font-medium tracking-wide text-center max-w-[88%]">
                      {msg.content}
                    </div>
                  </div>
                );
              }
              return (
                <ChatMessage
                  key={msg.id}
                  content={msg.content}
                  role={msg.role}
                  isNew={i === messages.length - 1}
                />
              );
            })}
            {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="flex justify-start animate-fade-in mb-8">
                <div className="px-5 py-4 rounded-2xl rounded-tl-md bg-secondary shadow-soft">
                  <span className="inline-block w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse mr-1.5" />
                  <span className="inline-block w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse mr-1.5 [animation-delay:0.2s]" />
                  <span className="inline-block w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-pulse [animation-delay:0.4s]" />
                </div>
              </div>
            )}
          </div>
          <div className="mx-8 h-px bg-border/60" />

          {adviceGiven || conversationEnded ? (
            <div className="flex justify-center px-8 py-6 bg-card">
              <button
                onClick={handleNewConversation}
                className="inline-flex items-center gap-2 px-8 py-4 rounded-full cta-red font-body font-medium text-[13px] tracking-wide uppercase"
              >
                <RefreshCw className="w-4 h-4" strokeWidth={1.75} />
                Nieuw gesprek starten
              </button>
            </div>
          ) : limitReached && !adviceSentRef.current ? (
            <div className="flex flex-col sm:flex-row gap-3 px-8 py-6 bg-card">
              <button
                onClick={handleForceAdvice}
                className="flex-1 cta-red font-body font-medium text-[13px] tracking-wide uppercase px-6 py-3.5 rounded-full"
              >
                Gesprek afronden &amp; advies tonen
              </button>
              <button
                onClick={handleNewConversation}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-full border border-primary/70 text-primary text-[13px] font-body font-medium tracking-wide uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
                Nieuw gesprek starten
              </button>
            </div>
          ) : limitReached ? (
            <div className="flex justify-center px-8 py-6 bg-card">
              <button
                onClick={handleNewConversation}
                className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full border border-primary/70 text-primary text-[13px] font-body font-medium tracking-wide uppercase hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" strokeWidth={1.75} />
                Nieuw gesprek starten
              </button>
            </div>
          ) : (
            <ChatInput onSend={handleSend} disabled={isStreaming} />
          )}
        </>
      )}
    </div>
  );
};

export default TegelChat;
