// Mistral AI integratie via een beveiligde Edge Function (Lovable Cloud).
// De frontend stuurt enkel de gespreksgeschiedenis; de system prompt,
// het model en de API key blijven server-side. Bestandsnaam blijft
// "puterAI.ts" zodat alle bestaande imports werken — de inhoud is volledig
// vervangen door een Mistral SSE-stream client.

// De Lovable Cloud backend host de edge function. Dit is een ANDER project
// dan het oude Supabase project (vbjowjvyfttfpmqyziwg) waar de tegeldata
// "Data LN" staat — dat blijft in src/lib/supabaseClient.ts.
const CLOUD_URL = import.meta.env.VITE_SUPABASE_URL as string;
const CLOUD_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

const CHAT_URL = `${CLOUD_URL}/functions/v1/mistral-chat`;

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export async function streamPuterChat(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  onDone: () => void
): Promise<void> {
  try {
    const resp = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CLOUD_KEY}`,
        apikey: CLOUD_KEY,
      },
      body: JSON.stringify({ messages }),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text().catch(() => "");
      console.error("[mistral-chat] HTTP fout:", resp.status, errText);
      onDelta("Er is helaas iets misgegaan bij het ophalen van het antwoord. Probeer het nog eens.");
      onDone();
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "";
    let streamDone = false;

    const handleDataLine = (jsonStr: string): boolean => {
      // returns true if [DONE] received
      if (jsonStr === "[DONE]") return true;
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed?.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          onDelta(content);
        }
      } catch {
        // partial — ignore here, caller will re-buffer
      }
      return false;
    };

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(line.indexOf(":") + 1).trim();
        if (jsonStr === "[DONE]") {
          streamDone = true;
          break;
        }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content.length > 0) {
            onDelta(content);
          }
        } catch {
          // partial JSON across chunks — put line back and wait
          textBuffer = line + "\n" + textBuffer;
          break;
        }
      }
    }

    // Final flush
    if (textBuffer.trim()) {
      for (let raw of textBuffer.split("\n")) {
        if (!raw) continue;
        if (raw.endsWith("\r")) raw = raw.slice(0, -1);
        if (raw.startsWith(":") || raw.trim() === "") continue;
        if (!raw.startsWith("data:")) continue;
        const jsonStr = raw.slice(raw.indexOf(":") + 1).trim();
        if (jsonStr === "[DONE]") continue;
        handleDataLine(jsonStr);
      }
    }

    onDone();
  } catch (error) {
    console.error("Mistral AI error:", error);
    onDelta("Er is helaas iets misgegaan. Probeer het nog eens.");
    onDone();
  }
}
