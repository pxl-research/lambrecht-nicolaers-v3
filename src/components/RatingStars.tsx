import { useState } from "react";
import { Star } from "lucide-react";

interface RatingStarsProps {
  onRate: (rating: number) => void;
  disabled?: boolean;
  value?: number;
}

const RatingStars = ({ onRate, disabled, value = 0 }: RatingStarsProps) => {
  const [hover, setHover] = useState(0);
  const [current, setCurrent] = useState(value);

  const handleClick = (n: number) => {
    if (disabled) return;
    setCurrent(n);
    onRate(n);
  };

  const active = hover || current;

  return (
    <div className="flex flex-col items-center gap-1.5 animate-fade-in">
      <span className="text-[13px] text-foreground font-body font-medium tracking-[0.14em] uppercase">
        {current > 0 ? "Bedankt voor uw beoordeling" : "Hoe was uw ervaring?"}
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
              onMouseEnter={() => setHover(n)}
              disabled={disabled}
              aria-label={`${n} ${n === 1 ? "ster" : "sterren"}`}
              className="p-0.5 transition-transform hover:scale-110 disabled:hover:scale-100 disabled:cursor-default"
            >
              <Star
                className={
                  filled
                    ? "w-6 h-6 fill-primary text-primary"
                    : "w-6 h-6 text-muted-foreground/40"
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