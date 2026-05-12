import TegelChat from "@/components/TegelChat";

const Index = () => {
  return (
    <div className="h-[var(--app-height,100vh)] bg-card md:marble-gradient flex flex-col items-center justify-center md:px-6 md:py-20 overflow-hidden">
      <TegelChat />
    </div>
  );
};

export default Index;
