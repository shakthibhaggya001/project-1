import { useState } from 'react';
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  ClipboardList,
  Menu,
  Search,
  Timer,
  Trophy,
  X,
  type LucideIcon,
} from 'lucide-react';

type Props = {
  onTakeQuiz: () => void;
  onCheckRank: () => void;
  onAdmin: () => void;
};

const navItems = [
  { label: 'Home', action: 'home' },
  { label: 'Take Exam', action: 'quiz' },
  { label: 'Results', action: 'results' },
  { label: 'Admin', action: 'admin' },
] as const;

export default function Home({ onTakeQuiz, onCheckRank, onAdmin }: Props) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleNavAction = (action: string) => {
    setMobileMenuOpen(false);

    if (action === 'quiz') {
      onTakeQuiz();
      return;
    }

    if (action === 'results') {
      onCheckRank();
      return;
    }

    if (action === 'admin') {
      onAdmin();
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-slate-950/90 backdrop-blur-md">
        <div className="responsive-shell flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/30">
              <Brain className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-lime-300">AM Class</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-slate-400">Exam Portal</p>
            </div>
          </div>

          <nav className="hidden items-center gap-6 md:flex">
            {navItems.map(({ label, action }) => (
              <button
                key={label}
                type="button"
                onClick={() => handleNavAction(action)}
                className="text-sm font-medium text-slate-300 transition hover:text-white"
              >
                {label}
              </button>
            ))}
          </nav>

          <button
            type="button"
            onClick={onTakeQuiz}
            className="hidden rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-500 md:inline-flex md:items-center md:gap-2"
          >
            Take Exam
            <ArrowRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white md:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="responsive-shell pb-4 md:hidden">
            <nav className="rounded-2xl border border-white/10 bg-slate-900/90 p-3 shadow-2xl">
              {navItems.map(({ label, action }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleNavAction(action)}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-3 text-left text-sm font-medium text-slate-200 transition hover:bg-white/5"
                >
                  {label}
                  <ArrowRight className="h-4 w-4 text-lime-300" />
                </button>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className="responsive-shell py-5 md:py-8">
        <section className="hero-grid">
          <aside className="order-1 mt-0 md:order-2 md:mt-0">
            <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/5 p-2 shadow-2xl shadow-slate-950/30">
              <img
                src="/ChatGPT_Image_Sep_3,_2026,_08_13_21_AM.png"
                alt="History AM Class poster"
                className="poster-image"
              />
            </div>
          </aside>

          <div className="order-2 rounded-[2rem] border border-white/10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-5 shadow-2xl shadow-slate-950/40 sm:p-6 md:order-1 md:p-8">
            <div className="mb-4 inline-flex items-center rounded-full border border-lime-300/40 bg-lime-300/10 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.24em] text-lime-300">
              Online Examination Portal
            </div>

            <h1 className="max-w-lg text-3xl font-black leading-tight text-white sm:text-4xl md:text-5xl">
              Test your knowledge. Claim your rank.
            </h1>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-300 md:text-lg">
              40 questions. 40 minutes. Take the timed exam and check your results as soon as they are published.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row md:flex-col xl:flex-row">
              <button
                type="button"
                onClick={onTakeQuiz}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-500"
              >
                <ClipboardList className="h-4 w-4" />
                Take Exam
              </button>

              <button
                type="button"
                onClick={onCheckRank}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
              >
                <Search className="h-4 w-4" />
                Check Result
              </button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatPill label="40" sublabel="Questions" />
              <StatPill label="40" sublabel="Minutes" />
              <StatPill label="1" sublabel="Rank Check" />
            </div>
          </div>
        </section>

        <section className="feature-grid mt-6 md:mt-8">
          <FeatureCard
            icon={Timer}
            title="Timed Exam"
            description="A server-controlled timer keeps every attempt fair and consistent."
          />
          <FeatureCard
            icon={CheckCircle2}
            title="Submit & Wait"
            description="Submit your work and view your score after publication time."
          />
          <FeatureCard
            icon={Trophy}
            title="Check Your Rank"
            description="Measure your score, percentage, and leaderboard position instantly."
          />
        </section>
      </main>
    </div>
  );
}

function StatPill({ label, sublabel }: { label: string; sublabel: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-center">
      <p className="text-xl font-black text-lime-300">{label}</p>
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">{sublabel}</p>
    </div>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-slate-950/10 md:p-5">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/15 text-lime-300">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mb-1 text-lg font-semibold text-white">{title}</h3>
      <p className="text-sm leading-relaxed text-slate-300">{description}</p>
    </div>
  );
}
