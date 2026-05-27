import ReactMarkdown from "react-markdown";

const GUIDE = `
# Getting Started with Prediction Markets

Welcome. This guide is for fans of the show who are new to Kalshi, Polymarket, or PredictIt — and who want to understand *how Stu thinks* before trying it themselves.

## What's a prediction market?

A prediction market lets you buy and sell **YES** or **NO** contracts on whether a real-world event happens. Each contract pays $1 if it resolves your way, $0 if not.

- **Price** is the market's implied probability. A YES contract trading at 30¢ means the market thinks there's a 30% chance.
- You can buy YES or NO at any time, and sell before resolution.
- Profit comes from buying low and selling higher — or holding to resolution if you have edge.

## The three platforms

| Platform | What it's good at | Caveats |
|---|---|---|
| **Kalshi** | U.S.-regulated, deepest liquidity on politics & sports | Some markets only on Kalshi |
| **Polymarket** | Crypto-backed, biggest single market liquidity on big events | Was offshore until 2025; needs crypto on-ramp |
| **PredictIt** | Academic research license, U.S.-legal | $850 per-contract cap, ~5,000 traders per market |

Stu names all three on the show. Most of his calls happen on Kalshi.

## Cents → Probability

A contract trading at **8.82¢** means:
- The market thinks there's an **8.82% chance** it resolves YES
- If you buy at 8.82¢ and it resolves YES, you turn $1 into $11.34 — a **999.79% return**
- If you buy at 8.82¢ and it resolves NO, you lose your $1

That's the math behind the "1000% Position in Nine Hours" — Stu's Paxton call.

## How Stu thinks (the framework)

### 1. Find what *won't* happen
"It's easier to pick out what's not going to happen rather than what is." If 8 candidates each have ~13% odds, betting NO on the weakest 2–3 is often higher-edge than picking the winner.

### 2. Stack small gains, build the bankroll
Boring is often the alpha. A 1–3% gain on a 95%+ favorite, repeated, compounds. Stu calls this his bankroll-builder pattern.

### 3. Free rolls
Use profits from sure-things to fund longshots. If you locked in $50 from a 95% favorite, you can buy a longshot at 5¢ on a "free ticket" — worst case you break even, best case 20x.

### 4. Trump revenge tour ≠ Trump endorsement
Different success rates. Endorsements have a mixed record; revenge tours (active campaigns to oust) almost always succeed.

### 5. Don't dump your bankroll
"Be in love with a pick before you make it." Most primary markets aren't worth a big bet — wait for generals or the rare high-conviction setup.

## Position theory

### Expected value
\`EV = (true_probability × payout_if_yes) − (1 − true_probability) × cost\`. If you think the true probability is 30% and a YES contract is selling at 20¢, your EV per dollar is positive — that's edge.

### Kelly sizing
The Kelly criterion tells you how much to bet for optimal long-run growth. Use the **Calculator** tab to compute it. **Half-Kelly** is the practical default — full Kelly is too volatile in practice.

### Bankroll management
Never bet more than you can afford to lose. Treat your prediction-market bankroll separately from your savings. Stu emphasizes "you do not have to take huge risks" — patience and discipline beat hero-bets.

### Diversification
8 Indiana primary positions are not 8 independent bets — they share a thesis. Concentration risk is real. Spread across independent themes (politics, courts, finance, sports) to reduce correlation.

### Variance & sample size
Even a 60% hit rate has losing streaks. Don't change your framework after one loss. The math only plays out over hundreds of decisions.

## Glossary

| Term | Meaning |
|---|---|
| **YES / NO contract** | The two sides of any binary market |
| **Cents on the dollar** | Price quoted in cents 0–100 = implied probability 0–100% |
| **Long shot** | Low-price contract; pays a lot if it hits |
| **Boring (the alpha)** | High-price near-certainty; small but consistent gains |
| **Free roll** | A position where you've already locked in profit from a related call |
| **Bankroll** | Total capital allocated to prediction markets |
| **Edge** | Your believed probability minus the market price |
| **Resolution** | When the market closes and YES/NO is determined |

## Where to start

1. Open a Kalshi account, deposit $50–$100 to learn the mechanics
2. Watch a week of Predictable episodes; track Stu's calls in your head
3. Browse the **Calls** tab on this site to see his full history
4. Use the **Calculator** before sizing your first real position
5. Start with **boring** trades — 95%+ favorites for 1–3% gains. Build the bankroll first.

**Nothing on this site is investment advice. Prediction markets carry real financial risk.**
`;

export function Guide() {
  return (
    <article className="prose prose-invert max-w-3xl">
      <ReactMarkdown
        components={{
          h1: (p) => <h1 className="text-2xl font-semibold mb-3 mt-0">{p.children}</h1>,
          h2: (p) => <h2 className="text-xl font-medium mt-6 mb-2">{p.children}</h2>,
          h3: (p) => <h3 className="text-lg font-medium mt-4 mb-1.5">{p.children}</h3>,
          p: (p) => <p className="text-sm leading-relaxed text-[var(--color-text)] mb-3">{p.children}</p>,
          ul: (p) => <ul className="text-sm list-disc list-inside space-y-1 mb-3">{p.children}</ul>,
          ol: (p) => <ol className="text-sm list-decimal list-inside space-y-1 mb-3">{p.children}</ol>,
          table: (p) => (
            <div className="overflow-x-auto mb-4">
              <table className="text-sm border border-[var(--color-border)]">{p.children}</table>
            </div>
          ),
          th: (p) => (
            <th className="text-left px-3 py-2 bg-[var(--color-surface)] border border-[var(--color-border)] font-medium">
              {p.children}
            </th>
          ),
          td: (p) => <td className="px-3 py-2 border border-[var(--color-border)]">{p.children}</td>,
          code: (p) => <code className="px-1 py-0.5 rounded bg-[var(--color-surface)] text-xs">{p.children}</code>,
          strong: (p) => <strong className="text-[var(--color-text)]">{p.children}</strong>,
          a: (p) => <a className="text-[var(--color-accent)] underline" href={(p as any).href}>{p.children}</a>,
        }}
      >{GUIDE}</ReactMarkdown>
    </article>
  );
}
