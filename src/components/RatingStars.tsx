import { useState } from "react";
import { Star } from "lucide-react";

interface RatingStarsProps {
  onRate: (rating: number) => void;
  disabled?: boolean;
  value?: number;
}

const RatingStars = ({ onRate, disabled, value = 0 }: RatingStarsProps) => {
  const [hover, setHover] = useState(0);
  const [submitted, setSubmitted] = useState(value > 0);
  const [current, setCurrent] = useState(value);

  const handleClick = (n: number) => {
    if (disabled || submitted) return;
    setCurrent(n);
    setSubmitted(true);
    onRate(n);
  };

  const active = hover || current;

  return (
    <div className="flex flex-col items-center gap-1.5 animate-fade-in">
      <span className="text-[11px] text-muted-foreground font-body tracking-[0.12em] uppercase">
        {submitted ? "Bedankt voor uw beoordeling" : "Hoe was uw ervaring?"}
      </span>
      <div
        className="flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= active;
          return (
            <button
              key={n}
              type="button"
              onClick={() => handleClick(n)}
              onMouseEnter={() => !submitted && setHover(n)}
              disabled={disabled || submitted}
              aria-label={`${n} ${n === 1 ? "ster" : "sterren"}`}
              className="p-0.5 transition-transform hover:scale-110 disabled:hover:scale-100 disabled:cursor-default"
            >
              <Star
                className={
                  filled
                    ? "w-5 h-5 fill-primary text-primary"
                    : "w-5 h-5 text-muted-foreground/40"
                }
                strokeWidth={1.5}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default RatingStars;