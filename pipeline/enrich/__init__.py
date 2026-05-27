"""
Enrichment pipeline — runs AFTER ingest+extract+load have populated
episodes, calls, and call_events. Resolves Stu's free-text market_hint
strings to concrete market_ids on Kalshi/Polymarket, snapshots prices,
and scores resolved calls.

Three stages, designed to be re-run idempotently as a daily cron:
    market_resolver -> price_snapshot -> scoring

Entry point: `python -m pipeline.enrich.run_all`
"""
