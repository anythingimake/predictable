import { useMemo, useState } from "react";
import { ConvictionBadge } from "../components/ConvictionBadge";
import type { Conviction } from "../types";

type Platform = {
  name: string;
  color: string;
  strength: string;
  caveat: string;
  url: string;
};

const PLATFORMS: Platform[] = [
  {
    name: "Kalshi",
    color: "var(--color-accent)",
    strength: "U.S.-regulated. Deepest liquidity on politics & sports.",
    caveat: "Some markets only exist here — Stu's primary home base.",
    url: "kalshi.com",
  },
  {
    name: "Polymarket",
    color: "var(--color-mark)",
    strength: "Crypto-backed. Biggest single-market liquidity on huge events.",
    caveat: "Was offshore until 2025; needs a crypto on-ramp.",
    url: "polymarket.com",
  },
  {
    name: "PredictIt",
    color: "var(--color-tier-flyer)",
    strength: "Academic research license. U.S.-legal old-guard.",
    caveat: "$850 per-contract cap, ~5,000 traders per market.",
    url: "predictit.org",
  },
];

type FrameworkRule = {
  n: number;
  title: string;
  body: string;
  quote?: string;
};

const FRAMEWORK: FrameworkRule[] = [
  {
    n: 1,
    title: "Find what won't happen",
    body: "Easier to identify the loser than the winner. NO on the 2–3 weakest in a multi-way race often beats picking the winner.",
    quote: "It's easier to pick out what's not going to happen rather than what is.",
  },
  {
    n: 2,
    title: "Stack small gains, build the bankroll",
    body: "1–3% gains on near-certainties compound. Boring is the alpha.",
  },
  {
    n: 3,
    title: "Free rolls",
    body: "Lock in profit from a sure thing, use it to buy a longshot. Worst case: you break even. Best case: 10–20x.",
  },
  {
    n: 4,
    title: "Trump revenge tour ≠ endorsement",
    body: "Different success rates. Endorsements have a mixed record. Revenge tours almost always succeed.",
  },
  {
    n: 5,
    title: "Be in love with a pick",
    body: "Most primary markets aren't worth a big bet. Wait for high-conviction setups.",
    quote: "You do not have to take huge risks.",
  },
];

type Concept = {
  term: string;
  def: string;
  formula: string;
};

const CONCEPTS: Concept[] = [
  {
    term: "Expected Value",
    def: "Your edge per dollar bet. Positive EV is the whole game.",
    formula: "EV = (p × payout) − (1 − p) × cost",
  },
  {
    term: "Kelly criterion",
    def: "Optimal long-run bet size given your edge.",
    formula: "f* = (bp − q) / b",
  },
  {
    term: "Bankroll management",
    def: "Treat your prediction-market pool separately from savings.",
    formula: "max_bet ≤ 5% bankroll",
  },
  {
    term: "Diversification",
    def: "8 Indiana primary positions ≠ 8 independent bets. Spread across themes.",
    formula: "low correlation = real diversification",
  },
  {
    term: "Variance & sample size",
    def: "Even a 60% hit rate has losing streaks. The math plays out over hundreds.",
    formula: "n > 100 before judging",
  },
  {
    term: "Half-Kelly",
    def: "The practical default. Full Kelly is too volatile in real life.",
    formula: "f = 0.5 × f*",
  },
];

type GlossaryEntry = {
  term: string;
  def: string;
  tier?: Conviction;
};

const GLOSSARY: GlossaryEntry[] = [
  { term: "YES contract", def: "Pays $1 if the event resolves true, $0 otherwise." },
  { term: "NO contract", def: "Pays $1 if the event resolves false, $0 otherwise." },
  { term: "Cents on the dollar", def: "Price quoted in cents 0–100, equal to implied probability 0–100%." },
  { term: "Long shot", def: "Low-price contract; pays a lot if it hits." },
  { term: "Boring (the alpha)", def: "High-price near-certainty; small but consistent gains." },
  { term: "Free roll", def: "A position where you've already locked in profit from a related call." },
  { term: "Bankroll", def: "Total capital allocated to prediction markets." },
  { term: "Edge", def: "Your believed probability minus the market price." },
  { term: "Resolution", def: "When the market closes and YES/NO is determined." },
  { term: "EV", def: "Expected value. Per-dollar profit you'd average over many identical bets." },
  { term: "Kelly", def: "Bet-sizing formula for optimal long-run growth. Use Half-Kelly in practice." },
  { term: "The play", def: "Stu's top conviction tier — he's in love with the pick.", tier: "play" },
  { term: "Solid", def: "Stu's second tier — 'I'm in', but not betting the farm.", tier: "solid" },
  { term: "Flyer", def: "Stu's third tier — a few shares, longshot energy.", tier: "flyer" },
  { term: "Watch", def: "Stu's fourth tier — interesting but not entered.", tier: "watch" },
  { term: "Opinion", def: "Stu's fifth tier — directional view only, no position.", tier: "opinion" },
  { term: "Pass", def: "Stu's sixth tier — mentioned but skipping it.", tier: "pass" },
];

const STEPS: string[] = [
  "Open a Kalshi account. Deposit $50–$100 just to learn the mechanics.",
  "Watch a week of Predictable episodes. Track Stu's calls in your head before risking a dollar.",
  "Browse the Calls tab on this site to see his full history and outcomes.",
  "Use the Calculator before sizing your first real position. Half-Kelly, every time.",
  "Start with boring trades — 95%+ favorites for 1–3% gains. Build the bankroll first.",
];

export function Guide() {
  return (
    <div className="mx-auto max-w-4xl space-y-10">
      <Hero />
      <Concept />
      <Platforms />
      <CentsCalculator />
      <Framework />
      <PositionTheory />
      <Glossary />
      <WhereToStart />
    </div>
  );
}

function Hero() {
  return (
    <header className="relative overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-8">
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{
          background: "linear-gradient(90deg, var(--color-accent), var(--color-mark))",
          boxShadow: "0 0 12px var(--color-accent-glow)",
        }}
      />
      <h1 className="text-3xl font-semibold tracking-tight">
        Getting Started with Prediction Markets
      </h1>
      <p className="mt-3 text-base text-[var(--color-text-muted)] leading-relaxed">
        A field guide for fans of the show who are new to Kalshi, Polymarket, or PredictIt —
        and who want to understand <em>how Stu thinks</em> before they trade.
      </p>
    </header>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-medium">{title}</h2>
        {subtitle && (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{subtitle}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Concept() {
  return (
    <Section title="What's a prediction market?">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6 space-y-3">
        <p className="text-sm leading-relaxed text-[var(--color-text)]">
          A prediction market lets you buy and sell <strong>YES</strong> or{" "}
          <strong>NO</strong> contracts on whether a real-world event happens. Each contract
          pays $1 if it resolves your way, $0 if not. You can buy either side at any time and
          sell before resolution.
        </p>
        <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
          Profit comes from buying low and selling higher — or holding to resolution if you
          have edge over the crowd.
        </p>
        <Callout>
          <span className="font-medium text-[var(--color-text)]">Key fact:</span> Price = implied
          probability. <span className="font-mono text-[var(--color-mark)]">30¢</span> = 30%
          chance.
        </Callout>
      </div>
    </Section>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-md border-l-4 px-4 py-3 text-sm"
      style={{
        borderLeftColor: "var(--color-mark)",
        background: "rgba(34, 197, 94, 0.06)",
        color: "var(--color-text)",
      }}
    >
      {children}
    </div>
  );
}

function Platforms() {
  return (
    <Section
      title="The three platforms"
      subtitle="Stu names all three on the show. Most of his calls happen on Kalshi."
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {PLATFORMS.map((p) => (
          <div
            key={p.name}
            className="rounded-lg border bg-[var(--color-bg-elev)] p-5 transition-colors hover:border-[var(--color-border-strong)]"
            style={{
              borderColor: "var(--color-border)",
              borderTop: `3px solid ${p.color}`,
            }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-lg font-medium" style={{ color: p.color }}>
                {p.name}
              </h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--color-text)]">
              {p.strength}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
              {p.caveat}
            </p>
            <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
              <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-faint)]">
                On-air URL
              </div>
              <div className="mt-0.5 font-mono text-xs text-[var(--color-text-muted)]">
                {p.url}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function CentsCalculator() {
  const [cents, setCents] = useState<string>("8.82");
  const [bet, setBet] = useState<string>("100");

  const result = useMemo(() => {
    const c = parseFloat(cents);
    const b = parseFloat(bet);
    if (!isFinite(c) || !isFinite(b) || c <= 0 || c >= 100 || b <= 0) {
      return null;
    }
    const prob = c;
    const contracts = b / (c / 100);
    const ifYes = contracts - b;
    const ifNo = b;
    const returnPct = (ifYes / b) * 100;
    return { prob, ifYes, ifNo, returnPct };
  }, [cents, bet]);

  return (
    <Section
      title="Cents → Probability"
      subtitle="Punch in any contract price to see the math live."
    >
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <NumField
            label="Contract price (cents)"
            value={cents}
            onChange={setCents}
            suffix="¢"
            step="0.01"
            min="0.01"
            max="99.99"
          />
          <NumField
            label="Your bet size"
            value={bet}
            onChange={setBet}
            prefix="$"
            step="1"
            min="1"
          />
        </div>

        {result ? (
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            <ResultCard
              label="Implied probability"
              value={`${result.prob.toFixed(2)}%`}
              accent="var(--color-accent)"
            />
            <ResultCard
              label="If YES, you win"
              value={`+$${result.ifYes.toFixed(2)}`}
              accent="var(--color-tier-play)"
            />
            <ResultCard
              label="If NO, you lose"
              value={`−$${result.ifNo.toFixed(2)}`}
              accent="var(--color-status-resolved-loss)"
            />
            <ResultCard
              label="Return if correct"
              value={`${result.returnPct.toFixed(2)}%`}
              accent="var(--color-mark)"
            />
          </div>
        ) : (
          <div className="mt-6 text-sm text-[var(--color-text-faint)]">
            Enter valid values (0.01–99.99¢, &gt;$0) to compute.
          </div>
        )}

        <p className="mt-5 text-xs italic text-[var(--color-text-muted)]">
          That's the math behind Stu's 1000% Paxton position — entering a longshot at ~9¢ and
          letting the market come to him.
        </p>
      </div>
    </Section>
  );
}

function NumField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  step,
  min,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  suffix?: string;
  step?: string;
  min?: string;
  max?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      <div
        className="mt-1.5 flex items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 focus-within:border-[var(--color-accent)] transition-colors"
      >
        {prefix && (
          <span className="text-sm text-[var(--color-text-faint)] mr-2">{prefix}</span>
        )}
        <input
          type="number"
          inputMode="decimal"
          value={value}
          step={step}
          min={min}
          max={max}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-base font-medium text-[var(--color-text)] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        {suffix && (
          <span className="text-sm text-[var(--color-text-faint)] ml-2">{suffix}</span>
        )}
      </div>
    </label>
  );
}

function ResultCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}

function Framework() {
  return (
    <Section
      title="How Stu thinks"
      subtitle="Five rules that show up in nearly every episode."
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {FRAMEWORK.map((rule) => (
          <div
            key={rule.n}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-5 transition-colors hover:border-[var(--color-border-strong)]"
          >
            <div className="flex items-start gap-4">
              <div
                className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full text-base font-semibold"
                style={{
                  background: "rgba(91, 141, 246, 0.12)",
                  color: "var(--color-accent)",
                  border: "1px solid rgba(91, 141, 246, 0.3)",
                }}
              >
                {rule.n}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-medium leading-tight">{rule.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">
                  {rule.body}
                </p>
                {rule.quote && (
                  <blockquote className="mt-3 pl-3 border-l-2 border-[var(--color-border-strong)] text-sm italic text-[var(--color-text-muted)]">
                    "{rule.quote}"
                  </blockquote>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function PositionTheory() {
  return (
    <Section
      title="Position theory"
      subtitle="The math behind sane bet sizing."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {CONCEPTS.map((c) => (
          <div
            key={c.term}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4"
          >
            <h3 className="text-base font-medium text-[var(--color-text)]">{c.term}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-text-muted)]">
              {c.def}
            </p>
            <div
              className="mt-3 rounded px-2 py-1.5 font-mono text-xs"
              style={{
                background: "var(--color-surface)",
                color: "var(--color-accent)",
                border: "1px solid var(--color-border)",
              }}
            >
              {c.formula}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Glossary() {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GLOSSARY;
    return GLOSSARY.filter(
      (g) =>
        g.term.toLowerCase().includes(q) || g.def.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <Section title="Glossary" subtitle="Search the lingo Stu uses on the show.">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-5">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms — e.g. 'kelly', 'free roll', 'play'"
          className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-faint)] outline-none focus:border-[var(--color-accent)] transition-colors"
        />
        <div className="mt-4 divide-y divide-[var(--color-border)]">
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-sm text-[var(--color-text-faint)]">
              No matches for "{query}".
            </div>
          ) : (
            filtered.map((g) => (
              <div
                key={g.term}
                className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-2 sm:gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-start gap-2">
                  {g.tier ? (
                    <ConvictionBadge conviction={g.tier} />
                  ) : (
                    <span className="text-sm font-medium text-[var(--color-text)]">
                      {g.term}
                    </span>
                  )}
                </div>
                <div className="text-sm leading-relaxed text-[var(--color-text-muted)]">
                  {g.def}
                </div>
              </div>
            ))
          )}
        </div>
        <div className="mt-4 pt-3 border-t border-[var(--color-border)] text-xs text-[var(--color-text-faint)]">
          {filtered.length} of {GLOSSARY.length} terms shown
        </div>
      </div>
    </Section>
  );
}

function WhereToStart() {
  return (
    <Section title="Where to start" subtitle="Five steps, in order. Don't skip.">
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6">
        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <span
                className="flex-shrink-0 mt-0.5 flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold"
                style={{
                  background: "rgba(34, 197, 94, 0.12)",
                  color: "var(--color-mark)",
                  border: "1px solid rgba(34, 197, 94, 0.35)",
                }}
              >
                {i + 1}
              </span>
              <span className="text-sm leading-relaxed text-[var(--color-text)]">
                {step}
              </span>
            </li>
          ))}
        </ol>
        <div
          className="mt-6 rounded-md border-l-4 px-4 py-3 text-xs"
          style={{
            borderLeftColor: "var(--color-status-resolved-loss)",
            background: "rgba(239, 68, 68, 0.06)",
            color: "var(--color-text)",
          }}
        >
          <span className="font-medium">Reminder:</span> Nothing on this site is investment
          advice. Prediction markets carry real financial risk.
        </div>
      </div>
    </Section>
  );
}
