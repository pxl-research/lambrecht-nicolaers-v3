import { MessageSquare } from "lucide-react";

interface ChatWelcomeProps {
  onStart: () => void;
}

const ChatWelcome = ({ onStart }: ChatWelcomeProps) => {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-10 py-16 animate-fade-in">
      {/* Icon */}
      <div className="w-14 h-14 rounded-full bg-secondary/60 flex items-center justify-center mb-10">
        <MessageSquare className="w-6 h-6 text-muted-foreground" strokeWidth={1.25} />
      </div>

      {/* Heading */}
      <h1 className="font-display text-4xl md:text-5xl font-normal text-foreground mb-5 tracking-tight leading-[1.15]">
        Lambrechts-Nicolaers
      </h1>
      <p className="text-[10px] text-[#1F2937] font-body font-medium tracking-[0.2em] uppercase mb-5 -mt-3">
        Digitale interieuradviseur · Tongeren
      </p>

      {/* Divider */}
      <div className="w-10 h-px bg-primary/60 mb-8" />

      {/* Subtitle */}
      <p className="text-muted-foreground font-body font-light text-[15px] md:text-base max-w-md leading-[1.85] mb-12">
        Welkom bij Lambrechts-Nicolaers in Tongeren. Wij begeleiden u persoonlijk
        naar de tegel die perfect past bij uw interieur — in alle rust, met deskundig advies.
      </p>

      {/* CTA — enige rode accent */}
      <button
        onClick={onStart}
        className="cta-red font-body font-medium text-[14px] tracking-wide uppercase px-10 py-4 rounded-full"
      >
        Start uw zoektocht
      </button>

      {/* Trust indicators */}
      <div className="flex items-center gap-8 mt-16 text-muted-foreground/70 text-[11px] font-body font-light tracking-[0.15em] uppercase">
        <span>Persoonlijk advies</span>
        <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
        <span>2000+ tegels</span>
        <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
        <span>Gratis inspiratie</span>
      </div>
    </div>
  );
};

export default ChatWelcome;
