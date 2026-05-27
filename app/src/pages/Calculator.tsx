import { useMemo, useState } from "react";

export function Calculator() {
  const [price, setPrice] = useState(50);
  const [trueProb, setTrueProb] = useState(60);
  const [bankroll, setBankroll] = useState(1000);
  const [feeBps, setFeeBps] = useState(7);

  const m = useMemo(() => {
    // Clamp to defensible ranges so a stray paste like 105 or a NaN doesn't blow up Kelly.
    const safePrice = clampNum(price, 1, 99);
    const safeProb = clampNum(trueProb, 0, 100);
    const safeBankroll = Math.max(0, Number.isFinite(bankroll) ? bankroll : 0);
    const safeFee = clampNum(feeBps, 0, 10_000);

    const p = safePrice / 100; // price in dollars (0..1)
    const q = safeProb / 100; // your believed probability
    const fee = safeFee / 10000;
    const ev = q * (1 - p - fee) - (1 - q) * p; // per $1 staked
    const edge = q - p;
    // Kelly: f* = (b*q - (1-q)) / b, where b = (1-p)/p (decimal odds minus 1)
    const b = (1 - p) / p;
    const kelly = b > 0 ? (b * q - (1 - q)) / b : 0;
    const kellySize = Math.max(0, kelly) * safeBankroll;
    const halfKellySize = kellySize / 2;
    return { ev, edge, kelly, kellySize, halfKellySize, p, q };
  }, [price, trueProb, bankroll, feeBps]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold mb-1">Calculator</h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          Expected value, Kelly sizing, and break-even for a single prediction-market position.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field
          label="Market price (cents)"
          help="What you'd pay per share, 0–100"
          value={price}
          onChange={setPrice}
          min={1}
          max={99}
        />
        <Field
          label="Your believed probability (%)"
          help="What you think the true probability is"
          value={trueProb}
          onChange={setTrueProb}
          min={0}
          max={100}
        />
        <Field
          label="Bankroll ($)"
          help="Capital available"
          value={bankroll}
          onChange={setBankroll}
          min={0}
          max={1_000_000}
        />
        <Field
          label="Fee (bps)"
          help="Round-trip fee. Kalshi ≈ 7 bps, Polymarket ≈ 0–200"
          value={feeBps}
          onChange={setFeeBps}
          min={0}
          max={500}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Edge" value={`${(m.edge * 100).toFixed(1)} pp`} accent={m.edge > 0 ? "var(--color-tier-play)" : "var(--color-status-resolved-loss)"} />
        <Stat label="EV per $1" value={`${m.ev >= 0 ? "+" : ""}${(m.ev * 100).toFixed(1)}¢`} accent={m.ev > 0 ? "var(--color-tier-play)" : "var(--color-status-resolved-loss)"} />
        <Stat label="Kelly %" value={`${(m.kelly * 100).toFixed(1)}%`} />
        <Stat label="Kelly $" value={`$${m.kellySize.toFixed(0)}`} />
      </div>

      <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 text-sm space-y-1">
        <div>
          <span className="text-[var(--color-text-muted)]">Half-Kelly (safer): </span>
          <span className="font-medium">${m.halfKellySize.toFixed(0)}</span>
        </div>
        <div>
          <span className="text-[var(--color-text-muted)]">Break-even probability: </span>
          <span className="font-medium">{(m.p * 100).toFixed(1)}%</span>
        </div>
        {m.ev <= 0 && (
          <div className="text-[var(--color-status-resolved-loss)] mt-2">
            Negative EV at these inputs — don't take this side.
          </div>
        )}
      </div>
    </div>
  );
}

function clampNum(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function Field({
  label,
  help,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  help: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <label className="block">
      <div className="text-xs uppercase text-[var(--color-text-muted)]">{label}</div>
      <input
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            onChange(min);
            return;
          }
          const n = Number(raw);
          onChange(Number.isFinite(n) ? n : min);
        }}
        className="mt-1 w-full bg-[var(--color-bg-elev)] border border-[var(--color-border)] rounded px-3 py-2 text-base text-[var(--color-text)] focus:outline-none focus:border-[var(--color-accent)]"
      />
      <div className="text-xs text-[var(--color-text-faint)] mt-1">{help}</div>
    </label>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3">
      <div className="text-xs uppercase text-[var(--color-text-muted)]">{label}</div>
      <div className="text-lg font-semibold mt-1" style={{ color: accent }}>
        {value}
      </div>
    </div>
  );
}
