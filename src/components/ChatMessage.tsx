import { cn } from "@/lib/utils";

interface ChatMessageProps {
  content: string;
  role: "assistant" | "user";
  isNew?: boolean;
}

const ChatMessage = ({ content, role, isNew }: ChatMessageProps) => {
  const isAI = role === "assistant";

  return (
    <div
      className={cn(
        "flex w-full mb-8",
        isAI ? "justify-start" : "justify-end",
        isNew && "animate-fade-up"
      )}
    >
      {isAI ? (
        <div className="max-w-[82%] px-5 py-4 rounded-2xl rounded-tl-md bg-secondary text-foreground font-body text-[15px] font-light leading-[1.85] tracking-[0.005em] shadow-soft">
          {content.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {i < content.split("\n").length - 1 && <br />}
            </span>
          ))}
        </div>
      ) : (
        <div className="max-w-[78%] px-5 py-3.5 rounded-2xl rounded-tr-md cta-red font-body text-[14px] font-normal leading-[1.7] shadow-cta">
          {content.split("\n").map((line, i) => (
            <span key={i}>
              {line}
              {i < content.split("\n").length - 1 && <br />}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatMessage;
