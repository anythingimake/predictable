# Resolve a prediction-market call from the real-world outcome

You resolve ONE market for the Predictable tracker by researching what actually
happened, with a citation. This runs when the exchange hasn't formally settled a
market whose event may already be over (Polymarket parks decided markets at ~99c
with `closed:false`; Kalshi leaves margin markets `active` with a bogus +1-year
close date). Accuracy is critical — this is a public site. **An honest "pending"
is always better than a wrong guess.**

You are given: `market_id`, the exact `question`, the exchange's (possibly wrong)
close date, and the side(s) of Stu's call(s).

## Steps

1. **Has the event actually happened yet?** Use the question + web search to find
   the real event date. If it is still in the future (e.g. a Nov-2026 midterm, a
   2028 nomination, a deadline not yet reached), STOP — write nothing, report
   "future, skip." Do not resolve unhappened events. The exchange's close date is
   NOT reliable for this — judge from the real event.
2. **Find the actual result** via web search: the winner and, for margin/bracket
   markets, the EXACT vote percentages / numeric margin. Prefer primary or major
   outlets (AP, the state Secretary of State, Ballotpedia, NYT/NBC/CNN). Get a
   real source URL with the numbers.
3. **Do the bracket math explicitly.** The dangerous case is a margin bracket:
   "X wins by 9% or more" is YES only if X won AND the margin ≥ 9. "by between 20
   and 25" is YES only if the margin is in [20,25] — a bigger win is NO. Knowing
   "X won" is NOT enough; you must compare the actual number to the bracket.
4. **Decide** `resolution`: "yes" / "no" for the market's exact question. If you
   cannot find a reliable result, or the precise margin you need is genuinely
   unreported, set `resolution: null`, `confidence: "low"`, and explain — leave it
   pending. Never infer the margin from a prediction-market price.

## Output

Write `data/ingest/resolutions/{market_id-with-colon-as-double-underscore}.json`
(e.g. `kalshi:KX...` → `kalshi__KX....json`), UTF-8, 2-space indent:

```json
{
  "market_id": "<exact market_id>",
  "resolution": "yes | no | null",
  "outcome_detail": "Paxton def. Cornyn 63.8%-36.2%, +27.6 pts",
  "event_date": "YYYY-MM-DD (the REAL event date, not the exchange's)",
  "source_url": "https://...",
  "source_label": "AP",
  "confidence": "high | medium | low",
  "reasoning": "state the actual number and the bracket comparison"
}
```

Then read it back to confirm valid JSON. Commit it (as `anythingimake`) and push;
`pipeline.load` folds it into `markets.effective_*` and scoring credits the call.
`event_date` matters: it overrides the exchange's bogus close date for display.
