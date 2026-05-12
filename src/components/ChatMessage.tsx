import { cn } from "@/lib/utils";

interface ChatMessageProps {
  content: string;
  role: "assistant" | "user";
  isNew?: boolean;
}

// Strip markdown-tekens (sterretjes, underscores, hashes, backticks) die de
// AI soms per ongeluk produceert ondanks de system prompt.
const stripMarkdown = (text: string): string => {
  return text
    // **bold** of *italic* → inhoud behouden
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
    // Losse/overgebleven sterretjes
    .replace(/\*+/g, "")
    // __bold__ of _italic_ → inhoud behouden (alleen rond woorden)
    .replace(/_{1,3}([^_\n]+)_{1,3}/g, "$1")
    // Heading hashes aan begin van een regel
    .replace(/^#{1,6}\s+/gm, "")
    // Inline code backticks
    .replace(/`+/g, "")
    // Lijst-bullets aan begin van regel (-, +)
    .replace(/^\s*[-+]\s+/gm, "");
};

const ChatMessage = ({ content, role, isNew }: ChatMessageProps) => {
  const isAI = role === "assistant";
  const cleaned = isAI ? stripMarkdown(content) : content;

  return (
    <div
      className={cn(
        "flex w-full mb-4 md:mb-8",
        isAI ? "justify-start" : "justify-end",
        isNew && "animate-fade-up"
      )}
    >
      {isAI ? (
        <div className="max-w-[90%] md:max-w-[82%] px-3.5 py-2.5 md:px-5 md:py-4 rounded-2xl rounded-tl-md bg-secondary text-foreground font-body text-[15px] md:text-[16.5px] font-normal leading-[1.65] md:leading-[1.85] tracking-[0.005em] shadow-soft">
          {cleaned.split("\n").map((line, i, arr) => (
            <span key={i}>
              {line}
              {i < arr.length - 1 && <br />}
            </span>
          ))}
        </div>
      ) : (
        <div className="max-w-[85%] md:max-w-[78%] px-3.5 py-2.5 md:px-5 md:py-3.5 rounded-2xl rounded-tr-md cta-red font-body text-[14.5px] md:text-[15.5px] font-normal leading-[1.6] md:leading-[1.75] shadow-cta">
          {cleaned.split("\n").map((line, i, arr) => (
            <span key={i}>
              {line}
              {i < arr.length - 1 && <br />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
