import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSend, disabled }: ChatInputProps) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Detecteer touch-apparaten — daar willen we GEEN auto-focus,
  // omdat dit het mobiele toetsenbord ongewenst opent/sluit.
  const isTouchDevice =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(hover: none)").matches ||
      "ontouchstart" in window);

  // Autofocus enkel op desktop
  useEffect(() => {
    if (isTouchDevice) return;
    inputRef.current?.focus();
  }, [isTouchDevice]);

  // Hernieuw focus zodra de AI klaar is met antwoorden — enkel op desktop
  useEffect(() => {
    if (isTouchDevice) return;
    if (!disabled) {
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [disabled, isTouchDevice]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
    // Op mobiel niet opnieuw focussen: behoud de huidige focus-staat
    // (toetsenbord blijft open als gebruiker net typte, anders niet).
    if (!isTouchDevice) inputRef.current?.focus();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-2 md:gap-3 px-3 py-3 md:px-8 md:py-6 bg-card"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Stel uw vraag…"
        className="flex-1 min-w-0 bg-secondary/60 text-foreground placeholder:text-muted-foreground/70
                   font-body text-[14px] font-light px-3.5 py-2.5 md:px-5 md:py-3.5 rounded-xl border-0 outline-none
                   focus:ring-1 focus:ring-primary/30 focus:bg-secondary
                   transition-all duration-300 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!value.trim() || disabled}
        aria-label="Verstuur bericht"
        className="shrink-0 w-10 h-10 md:w-12 md:h-12 rounded-full cta-red flex items-center justify-center
                   disabled:opacity-25 disabled:cursor-not-allowed disabled:transform-none
                   transition-all duration-300"
      >
        <Send className="w-4 h-4" />
      </button>
    </form>
  );
};

export default ChatInput;
