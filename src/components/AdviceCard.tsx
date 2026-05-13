import { MapPin, Ruler } from "lucide-react";

export interface AdviceAlternative {
  box: string;
  formaat: string;
  omschrijving: string;
}

export interface AdviceSection {
  label: string;          // bv. "Vloertegel" / "Wandtegel"
  box: string;
  formaat: string;
  omschrijving?: string;  // bv. "Natuursteen in beige"
  alternatives?: AdviceAlternative[]; // 2 stuks
}

interface AdviceCardProps {
  box: string;        // bv. "11" of "Box 11" of ""
  formaat: string;    // bv. "60x120"
  intro?: string;     // korte intro/uitleg-tekst boven de gegevens
  outro?: string;     // afsluitende tekst onder de gegevens
  isFallback?: boolean;
  fallbackBoxes?: string[];
  kamer?: string;
  alternatives?: AdviceAlternative[];
  combined?: AdviceSection[]; // wanneer aanwezig: render vloer + wand naast elkaar
}

function normalizeBoxLabel(box: string): string {
  if (!box) return "";
  const m = box.match(/(\d{1,4})/);
  return m ? `Expo ${m[1]}` : box;
}

const Section = ({ section }: { section: AdviceSection }) => {
  const boxLabel = normalizeBoxLabel(section.box);
  return (
    <div className="rounded-xl border border-border/60 bg-background/40 p-4 space-y-3">
      <div className="text-[10px] text-primary font-body font-semibold tracking-[0.2em] uppercase">
        {section.label}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex items-start gap-3">
          <MapPin className="w-4 h-4 text-primary mt-1 shrink-0" strokeWidth={1.75} />
          <div>
            <div className="text-[10px] text-muted-foreground font-medium tracking-[0.18em] uppercase mb-1">
              Locatie
            </div>
            <div className="font-semibold text-foreground text-[15px]">
              {boxLabel || "—"}
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Ruler className="w-4 h-4 text-primary mt-1 shrink-0" strokeWidth={1.75} />
          <div>
            <div className="text-[10px] text-muted-foreground font-medium tracking-[0.18em] uppercase mb-1">
              Formaat
            </div>
            <div className="font-semibold text-foreground text-[15px]">
              {section.formaat ? `${section.formaat} cm` : "—"}
            </div>
          </div>
        </div>
      </div>
      {section.omschrijving && (
        <div className="text-[13px] text-muted-foreground font-light">
          {section.omschrijving}
        </div>
      )}
      {section.alternatives && section.alternatives.length > 0 && (
        <div className="border-t border-border/60 pt-3">
          <div className="text-[12px] font-semibold text-foreground mb-1.5">
            2 alternatieven:
          </div>
          <ul className="space-y-1">
            {section.alternatives.map((a) => (
              <li
                key={a.box}
                className="text-[13px] text-foreground font-light leading-snug"
              >
                <span className="font-semibold text-primary">Expo {a.box}</span>
                <span className="text-muted-foreground"> — </span>
                <span>{a.formaat ? `${a.formaat} cm` : "—"}</span>
                <span className="text-muted-foreground"> — </span>
                <span>{a.omschrijving}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

const AdviceCard = ({
  box,
  formaat,
  intro,
  outro,
  isFallback,
  fallbackBoxes,
  kamer,
  alternatives,
  combined,
}: AdviceCardProps) => {
  const boxLabel = normalizeBoxLabel(box);

  return (
    <div className="w-full max-w-[88%] my-4 rounded-2xl border border-primary/20 bg-card shadow-float overflow-hidden animate-fade-up">
      <div className="px-6 py-3 bg-primary/5 border-b border-primary/15">
        <span className="text-[10px] text-primary font-body font-semibold tracking-[0.2em] uppercase">
          Uw persoonlijk advies
        </span>
      </div>

      <div className="px-6 py-5 space-y-4 font-body text-[14px] text-foreground leading-[1.75]">
        {intro && <p className="font-light text-[15px]">{intro}</p>}

        {combined && combined.length > 0 ? (
          <div className="space-y-4">
            {combined.map((s) => (
              <Section key={s.label} section={s} />
            ))}
          </div>
        ) : isFallback ? (
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <MapPin className="w-4 h-4 text-primary" strokeWidth={1.75} />
                <span className="font-semibold text-foreground">
                  Aanbevolen expo's{kamer ? ` voor de ${kamer}` : ""}:
                </span>
              </div>
              <div className="flex flex-wrap gap-2 mt-2 ml-6">
                {(fallbackBoxes ?? []).map((b) => (
                  <span
                    key={b}
                    className="px-3 py-1 rounded-full bg-primary/10 text-primary text-[13px] font-medium"
                  >
                    Expo {b}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-primary mt-1 shrink-0" strokeWidth={1.75} />
              <div>
                <div className="text-[10px] text-muted-foreground font-medium tracking-[0.18em] uppercase mb-1">
                  Locatie
                </div>
                <div className="font-semibold text-foreground text-[15px]">
                  {boxLabel || "—"}
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Ruler className="w-4 h-4 text-primary mt-1 shrink-0" strokeWidth={1.75} />
              <div>
                <div className="text-[10px] text-muted-foreground font-medium tracking-[0.18em] uppercase mb-1">
                  Formaat
                </div>
                <div className="font-semibold text-foreground text-[15px]">
                  {formaat ? `${formaat} cm` : "—"}
                </div>
              </div>
            </div>
          </div>
        )}

        {!combined && !isFallback && alternatives && alternatives.length > 0 && (
          <div className="border-t border-border/60 pt-4 space-y-2">
            <div className="text-[13px] font-semibold text-foreground">
              Deze 3 alternatieven passen ook perfect bij uw project:
            </div>
            <ul className="space-y-1.5 mt-2">
              {alternatives.map((a) => (
                <li
                  key={a.box}
                  className="text-[14px] text-foreground font-light leading-snug"
                >
                  <span className="font-semibold text-primary">Expo {a.box}</span>
                  <span className="text-muted-foreground"> — </span>
                  <span>{a.formaat ? `${a.formaat} cm` : "—"}</span>
                  <span className="text-muted-foreground"> — </span>
                  <span>{a.omschrijving}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {outro && (
          <p className="font-light text-muted-foreground border-t border-border/60 pt-3">
            {outro}
          </p>
        )}
      </div>
    </div>
  );
};

export default AdviceCard;
