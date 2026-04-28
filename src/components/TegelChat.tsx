import { useState, useRef, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import ChatWelcome from "./ChatWelcome";
import ChatMessage from "./ChatMessage";
import ChatInput from "./ChatInput";
import logoLambrechts from "@/assets/logo-lambrechts.png";
import { streamPuterChat, type ChatMessage as AIChatMessage } from "@/lib/puterAI";
import {
  stripLogBlock,
  extractAdvies,
  inferAdviesFromTurns,
  sendToExcel,
  buildPayload,
  type ConversationTurn,
} from "@/lib/webhookLogger";
import { findBestMatch, formatAdvice, type MatchCriteria } from "@/lib/tegelMatcher";
import { detectKennisQuery, lookupKennis, formatKennisContext } from "@/lib/tegelKennis";

interface Message {
  id: string;
  content: string;
  role: "assistant" | "user";
}

const TegelChat = () => {
  const [started, setStarted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Onthoudt of het advies van dit gesprek al gelogd is.
  const adviceSentRef = useRef<boolean>(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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

  /**
   * Verwerkt een voltooid AI-bericht: detecteert LOG_JSON, doet Supabase-match
   * en voegt het echte advies (Box + Formaat uit Data LN) toe als nieuw bericht.
   */
  const handleCompletedAssistantMessage = async (
    rawText: string,
    assistantId: string,
    allMessages: Message[]
  ) => {
    const advies = extractAdvies(rawText);
    if (!advies) return;
    if (adviceSentRef.current) return;

    // Alle 5 criteria moeten aanwezig zijn
    const heeftAlles =
      advies.Kamer && advies.Look && advies.Kleur && advies.Huisdieren && advies.Plaatsing;
    if (!heeftAlles) return;

    adviceSentRef.current = true;

    const criteria: MatchCriteria = {
      kamer: advies.Kamer,
      look: advies.Look,
      kleur: advies.Kleur,
      huisdieren: advies.Huisdieren,
      plaatsing: advies.Plaatsing,
    };

    let adviceText = "";
    let realBox = "";
    let realFormaat = "";

    try {
      const match = await findBestMatch(criteria);
      if (match) {
        adviceText = formatAdvice(match, criteria);
        realBox = match.box ? `Box ${match.box}` : "";
        realFormaat = match.formaat;
      } else {
        adviceText =
          "Op basis van uw wensen heb ik in onze actuele collectie geen exacte match gevonden. Ik raad u aan om langs te komen in onze showroom, dan bekijken we samen de mogelijkheden.";
      }
    } catch (err) {
      console.error("[Supabase match] Fout:", err);
      adviceText =
        "Ik kan op dit moment de showroomdatabase niet bereiken. Komt u gerust langs in de showroom, dan adviseren wij u persoonlijk.";
    }

    // Voeg het concrete advies als opvolgend bericht toe
    const adviceMsg: Message = {
      id: assistantId + "-advice",
      content: adviceText,
      role: "assistant",
    };
    const updated = [...allMessages, adviceMsg];
    setMessages(updated);

    // Webhook-log met de echte Box uit Supabase
    const turns: ConversationTurn[] = updated.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const payload = buildPayload(
      {
        Kamer: advies.Kamer,
        Look: advies.Look,
        Kleur: advies.Kleur,
        Huisdieren: advies.Huisdieren,
        Plaatsing: advies.Plaatsing,
        Advies_box: realBox || advies.Advies_box || "",
      },
      turns
    );
    // Voeg ook formaat toe als extra info in de payload (compatible blijft)
    (payload as unknown as Record<string, string>).Formaat_cm = realFormaat;

    console.log("[Excel-log] Verzenden:", payload);
    const error = await sendToExcel(payload);
    console.log("[Excel-log] Resultaat:", error ?? "OK");
  };

  const handleSend = async (content: string) => {
    const userMsg: Message = {
      id: Date.now().toString() + "user",
      content,
      role: "user",
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    const assistantId = Date.now().toString() + "assistant";

    const history: AIChatMessage[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    history.push({ role: "user", content });

    // Live DB-lookup als de klant een materiaal/stijl/kleur-vraag stelt
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

        setMessages((prev) => {
          const updated = prev.map((m) =>
            m.id === assistantId ? { ...m, content: cleanText } : m
          );
          // Trigger Supabase-match + log als de AI het LOG-blok heeft afgegeven
          void handleCompletedAssistantMessage(rawBuffer, assistantId, updated);
          return updated;
        });
      }
    );
  };

  return (
    <div className="w-full max-w-xl lg:max-w-2xl mx-auto h-[82vh] max-h-[760px] flex flex-col bg-card rounded-2xl shadow-float overflow-hidden animate-fade-in">
      <div className="px-8 pt-7 pb-5 flex items-center gap-4 bg-card">
        <img
          src={logoLambrechts}
          alt="Lambrechts-Nicolaers"
          className="h-11 w-auto object-contain"
        />
        <div className="flex flex-col">
          <span className="font-display text-[20px] font-normal text-foreground leading-tight tracking-tight">
            Lambrechts-Nicolaers
          </span>
          <span className="text-[10px] text-muted-foreground/70 font-body font-light tracking-[0.2em] uppercase mt-1">
            Digitale interieuradviseur · Tongeren
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary/80 animate-pulse" />
          <span className="text-[10px] text-muted-foreground/70 font-body font-light tracking-[0.15em] uppercase">
            Online
          </span>
        </div>
      </div>

      <div className="mx-8 h-px bg-border/60" />

      {!started ? (
        <ChatWelcome onStart={handleStart} />
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-8 py-8 space-y-1">
            {messages.map((msg, i) => (
              <ChatMessage
                key={msg.id}
                content={msg.content}
                role={msg.role}
                isNew={i === messages.length - 1}
              />
            ))}
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
          <ChatInput onSend={handleSend} disabled={isStreaming} />
        </>
      )}
    </div>
  );
};

export default TegelChat;
