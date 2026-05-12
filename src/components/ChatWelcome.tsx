import { MessageSquare } from "lucide-react";

interface ChatWelcomeProps {
  onStart: () => void;
}

const ChatWelcome = ({ onStart }: ChatWelcomeProps) => {
  return (
    <div className="flex flex-col items-center text-center px-10 py-8 animate-fade-in h-full overflow-y-auto">
      {/* Icon */}
      <div className="w-14 h-14 rounded-full bg-secondary/60 flex items-center justify-center mb-6">
        <MessageSquare className="w-6 h-6 text-muted-foreground" strokeWidth={1.25} />
      </div>

      {/* Divider */}
      <div className="w-10 h-px bg-primary/60 mb-6" />

      {/* Subtitle */}
      <p className="text-muted-foreground font-body font-light text-[15px] md:text-base max-w-md leading-[1.7] mb-8">
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

      {/* Disclaimer */}
      <p className="mt-6 max-w-md text-[11px] text-muted-foreground font-body font-light leading-[1.7]">
        Deze adviseur maakt deel uit van een onderzoeksproject en kan dus nog foutjes maken.
        Indien iets onduidelijk of foutief is, gelieve dan het personeel te contacteren, zij zullen
        je de juiste informatie geven. De ingevoerde informatie wordt anoniem verwerkt en enkel
        voor onderzoeksdoeleinden gebruikt. Deze assistent dient enkel in de fysieke winkel getest
        te worden.
      </p>
    </div>
  );
};

export default ChatWelcome;
