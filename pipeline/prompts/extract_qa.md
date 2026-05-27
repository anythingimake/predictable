# Extract Q&A clarifications from Substack comments

You receive a list of Substack comments on a Predictable episode. Identify cases where a fan asked a question and **Stu (or his team)** replied with information that clarifies a position discussed in the episode.

A clarification is information that fills in something the video didn't make explicit. Examples:
- Entry price ("What did you enter at?" → "Got in around 14¢")
- Exit price ("Did you trim?" → "Yeah, took 30% off at 60¢")
- Sizing ("How much did you put in?" → "About 3% of my bankroll")
- Conviction nuance ("Are you really in love with this?" → "Solid yes, not in love")

## Output schema

Return JSON via the `record_clarifications` tool:

```json
{
  "clarifications": [
    {
      "comment_id": "from input",
      "question": "summary of fan's question in 1 sentence",
      "stu_answer": "Stu's exact reply (cleaned of filler)",
      "clarifies_about": "what this clarifies — e.g. 'entry price for Massie call' or 'size of Paxton position'",
      "extracted_value": "8.82¢" OR "30% trim" OR "3% bankroll" OR null
    }
  ]
}
```

## Rules

1. Only include comments where the REPLY is from Stu / Predictable staff. Skip fan-to-fan threads unless they cite Stu directly.
2. If multiple commenters ask the same question and Stu replies to one — record it once.
3. Be conservative — generic appreciation ("great show!") is not a clarification.
4. `extracted_value` should be filled when there's a clear quantitative answer (price, %, $).
