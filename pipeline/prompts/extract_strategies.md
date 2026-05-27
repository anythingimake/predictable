# Extract Stu's multi-call strategies

You are reviewing a Predictable episode + extracted Calls. Identify **Strategies** — groups of related calls Stu executes as a single play.

## Pattern types

- **tier-ladder**: One market with multiple cut-off tiers. Example: "Vivek over 50% / over 60% / over 70% / over 80%" — Stu plays the whole ladder, sizing decreases up the ladder.
- **basket**: Multiple similar races on the same night. Example: "Indiana primary basket — 12 races all in one evening, all favorites." Calls share a thesis and risk.
- **free-roll**: Use guaranteed profit from sure-thing calls to fund a longshot. Example: "Used Vivek 50% gains to buy free shares of Vivek 80%."
- **pair**: Two opposing or complementary calls on related markets. Example: "Long Massie's challenger AND short Massie favorite outcome."

## Output schema

Return JSON via the `record_strategies` tool:

```json
{
  "strategies": [
    {
      "name": "Short label: 'Vivek Ladder' or 'Indiana Primary Basket'",
      "pattern_type": "tier-ladder" | "basket" | "free-roll" | "pair",
      "description": "1-3 sentences explaining what Stu's doing and why",
      "call_market_hints": ["market hints from the call list — match by `market_hint` field"]
    }
  ]
}
```

## Rules

1. Don't invent strategies that aren't real groupings — single isolated calls are not strategies.
2. Free-roll requires Stu to EXPLICITLY say he's using gains from X to buy Y. Don't infer from sequencing alone.
3. A basket requires ≥3 related calls. 2 = pair.
