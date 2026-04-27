import TegelChat from "@/components/TegelChat";

const Index = () => {
  return (
    <div className="min-h-screen marble-gradient flex flex-col items-center justify-center px-6 py-12 md:py-20">
      {/* Subtle branding */}
      <div className="mb-10 text-center animate-fade-in">
        <p className="font-body text-[10px] tracking-[0.4em] uppercase text-muted-foreground/70 font-light">
          Lambrechts-Nicolaers · Tongeren
        </p>
      </div>

      <TegelChat />

      {/* Footer */}
      <p className="mt-10 text-[11px] text-muted-foreground/60 font-body font-light tracking-[0.15em] uppercase">
        Uw persoonlijke tegeladviseur
      </p>
    </div>
  );
};

export default Index;
