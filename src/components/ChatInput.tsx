import { useState, useRef, useEffect } from "react";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSend, disabled }: ChatInputProps) => {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus bij mount (zodra de chat geopend wordt)
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Hernieuw focus zodra de AI klaar is met antwoorden (disabled -> false)
  useEffect(() => {
    if (!disabled) {
      // kleine vertraging zodat de input zeker enabled is in de DOM
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [disabled]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value.trim());
    setValue("");
    inputRef.current?.focus();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-center gap-3 px-8 py-6 bg-card"
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Stel uw vraag…"
        className="flex-1 bg-secondary/60 text-foreground placeholder:text-muted-foreground/70
                   font-body text-[14px] font-light px-5 py-3.5 rounded-xl border-0 outline-none
                   focus:ring-1 focus:ring-primary/30 focus:bg-secondary
                   transition-all duration-300 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={!value.trim() || disabled}
        aria-label="Verstuur bericht"
        className="w-12 h-12 rounded-full cta-red flex items-center justify-center
                   disabled:opacity-25 disabled:cursor-not-allowed disabled:transform-none
                   transition-all duration-300"
      >
        <Send className="w-4 h-4" />
      </button>
    </form>
  );
};

export default ChatInput;
