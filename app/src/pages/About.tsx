type PlatformLink = {
  name: string;
  url: string;
  icon: string;
  blurb: string;
};

const PLATFORMS: PlatformLink[] = [
  {
    name: "Substack",
    url: "https://predictable.substack.com",
    icon: "📰",
    blurb: "Daily written posts, charts, and the comment thread where Stu replies.",
  },
  {
    name: "YouTube",
    url: "https://www.youtube.com/@PredictableShow",
    icon: "📺",
    blurb: "Full episodes, clips, and the occasional live stream.",
  },
  {
    name: "Apple Podcasts",
    url: "https://podcasts.apple.com/us/podcast/predictable-with-stu-burguiere/id1490615866",
    icon: "🍎",
    blurb: "Subscribe and download episodes in Apple's player.",
  },
  {
    name: "Spotify",
    url: "https://open.spotify.com/show/38KfpYGXgSKS2n63a04wX1",
    icon: "🎵",
    blurb: "Stream every episode from the Spotify app.",
  },
  {
    name: "X / Twitter",
    url: "https://x.com/StuDoesAmerica",
    icon: "𝕏",
    blurb: "Stu's main feed for hot takes, market screenshots, and reactions.",
  },
  {
    name: "Podcast RSS",
    url: "https://feeds.megaphone.fm/BMDC7674164347",
    icon: "📡",
    blurb: "Plug this feed into any podcast app — the canonical source.",
  },
  {
    name: "iHeart",
    url: "https://www.iheart.com/podcast/175-predictable-with-stu-burgu-57532207/",
    icon: "❤️",
    blurb: "Listen via iHeartRadio's web and mobile apps.",
  },
  {
    name: "Podbean",
    url: "https://www.podbean.com/podcast-detail/her7r-ade89/Predictable-with-Stu-Burguiere-Podcast",
    icon: "🎙",
    blurb: "Alternate podcast host with episode archive.",
  },
];

type PipelineStep = {
  glyph: string;
  title: string;
  detail: string;
};

const PIPELINE: PipelineStep[] = [
  {
    glyph: "🎧",
    title: "Megaphone audio",
    detail: "Nightly RSS check for new episodes; download fresh MP3s only.",
  },
  {
    glyph: "📝",
    title: "Whisper transcript",
    detail: "Local two-pass Whisper (small → large-v3 on shaky segments) — no cloud audio upload.",
  },
  {
    glyph: "🤖",
    title: "Claude extraction",
    detail: "Each transcript becomes structured calls: market, side, conviction tier, entry price, quotes.",
  },
  {
    glyph: "💾",
    title: "SQLite store",
    detail: "Calls, events, clarifications, and price history land in one local SQLite file.",
  },
  {
    glyph: "🌐",
    title: "Website",
    detail: "This site reads from a tiny read-only API. Daily refresh, fully hands-off.",
  },
];

type StackItem = { name: string; role: string };

const STACK: StackItem[] = [
  { name: "React + Vite + TypeScript", role: "Frontend" },
  { name: "Tailwind v4", role: "Styling" },
  { name: "Node + Express + better-sqlite3", role: "Read-only API" },
  { name: "faster-whisper", role: "Local transcription" },
  { name: "Claude (Anthropic)", role: "Structured extraction" },
  { name: "Kalshi · Polymarket · PredictIt", role: "Market price data" },
];

export function About() {
  return (
    <div className="space-y-12">
      <Hero />
      <WhereToFind />
      <NotSection />
      <ReachOut />
    </div>
  );
}

function Hero() {
  return (
    <section className="space-y-4">
      <h1 className="text-3xl md:text-4xl font-semibold leading-tight">
        <span
          className="bg-clip-text text-transparent"
          style={{
            backgroundImage:
              "linear-gradient(90deg, var(--color-mark) 0%, var(--color-accent) 60%, var(--color-text) 100%)",
          }}
        >
          An unofficial scoreboard
        </span>{" "}
        for Stu's calls.
      </h1>
      <p className="text-base md:text-lg text-[var(--color-text-muted)] max-w-2xl leading-relaxed">
        Stu Burguiere calls positions on air every weekday — markets, sides, entry prices,
        and conviction tiers in his own vocabulary. Listeners have no good way to verify the
        results or browse the full track record. This site does exactly that, automatically.
      </p>
      <p
        className="text-sm md:text-base font-semibold tracking-wide uppercase pt-1"
        style={{
          color: "var(--color-mark)",
          textShadow: "0 0 12px var(--color-mark-glow)",
        }}
      >
        Conservanerds Unite!
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
        <AudienceCard
          glyph="🎯"
          title="For fans of the show"
          detail="Browse every tracked call, sort by hit rate, and jump straight to the moment Stu said it."
        />
        <AudienceCard
          glyph="📊"
          title="Maybe useful to the show"
          detail="If the Predictable team ever wants a structured archive of past calls — this is it."
        />
      </div>
    </section>
  );
}

function AudienceCard({ glyph, title, detail }: { glyph: string; title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4">
      <div className="text-2xl mb-2">{glyph}</div>
      <div className="font-medium mb-1">{title}</div>
      <div className="text-sm text-[var(--color-text-muted)] leading-relaxed">{detail}</div>
    </div>
  );
}

function HowItWorks() {
  return (
    <section>
      <h2 className="text-2xl font-semibold mb-1">How it works</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-5">
        One nightly pipeline. Everything else is just reading the database.
      </p>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-5">
        <ol className="flex flex-col md:flex-row md:items-stretch gap-3 md:gap-2">
          {PIPELINE.map((step, i) => (
            <li
              key={step.title}
              className="flex-1 flex md:flex-col md:items-start items-start gap-3 md:gap-2 relative"
            >
              <div className="rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 flex items-center gap-2 w-full">
                <span className="text-lg" aria-hidden="true">{step.glyph}</span>
                <span className="font-medium text-sm">{step.title}</span>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] leading-relaxed pl-1 md:pl-1">
                {step.detail}
              </p>
              {i < PIPELINE.length - 1 && (
                <span
                  aria-hidden="true"
                  className="hidden md:block absolute top-3 -right-2 text-[var(--color-text-faint)] text-xs"
                >
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <div className="mt-5 pt-4 border-t border-[var(--color-border)] text-xs text-[var(--color-text-faint)]">
          Audio transcription runs locally — nothing is sent to a cloud STT provider. The only
          outbound call is to Claude for structured extraction.
        </div>
      </div>
    </section>
  );
}

function WhereToFind() {
  return (
    <section>
      <h2 className="text-2xl font-semibold mb-1">Where to find the official show</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-5">
        This site is unofficial. If you want the source — Stu, his words, his platform —
        go here.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PLATFORMS.map((p) => (
          <a
            key={p.name}
            href={p.url}
            target="_blank"
            rel="noreferrer"
            className="group rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-4 transition-all hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface)]"
            style={{ display: "block" }}
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none" aria-hidden="true">{p.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-[var(--color-text)] group-hover:text-[var(--color-accent)] transition-colors">
                  {p.name}
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-1 leading-relaxed">
                  {p.blurb}
                </div>
                <div className="text-[10px] text-[var(--color-text-faint)] mt-2 truncate">
                  {prettyHost(p.url)} ↗
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}

function prettyHost(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
  } catch {
    return url;
  }
}

function NotSection() {
  const items: string[] = [
    "Not affiliated with Stu Burguiere or Predictable in any way. Yet.",
    "Not investment advice. Prediction markets carry real financial risk.",
    "Not paywall-evading — only publicly available Substack episodes are processed.",
    "Not a leaderboard for fans — no accounts, no trade submissions, no fantasy league. Possibly in Version 2.",
  ];
  return (
    <section>
      <h2 className="text-2xl font-semibold mb-1">What this site is NOT</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Worth being explicit about.
      </p>
      <ul className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] divide-y divide-[var(--color-border)]">
        {items.map((item) => (
          <li key={item} className="px-4 py-3 text-sm flex items-start gap-3">
            <span className="text-[var(--color-text-faint)] mt-0.5" aria-hidden="true">×</span>
            <span className="text-[var(--color-text)]">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BuiltWith() {
  return (
    <section>
      <h2 className="text-2xl font-semibold mb-1">Built with</h2>
      <p className="text-sm text-[var(--color-text-muted)] mb-4">
        Boring, well-loved tools. Source is open under the MIT license.
      </p>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-5">
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-y-2 gap-x-6 text-sm">
          {STACK.map((s) => (
            <li key={s.name} className="flex items-baseline justify-between gap-3">
              <span className="text-[var(--color-text)]">{s.name}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{s.role}</span>
            </li>
          ))}
        </ul>
        <div className="mt-5 pt-4 border-t border-[var(--color-border)] flex flex-wrap items-center gap-3 text-sm">
          <a
            href="https://github.com/anythingimake/predictable"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 hover:border-[var(--color-accent)] transition-colors"
          >
            <span aria-hidden="true">⌥</span>
            github.com/anythingimake/predictable
          </a>
          <span className="text-xs text-[var(--color-text-faint)]">
            MIT licensed · built by Benjamin (
            <a href="https://github.com/anythingimake" target="_blank" rel="noreferrer">
              @anythingimake
            </a>
            )
          </span>
        </div>
      </div>
    </section>
  );
}

function ReachOut() {
  return (
    <section>
      <h2 className="text-2xl font-semibold mb-1">Reach out</h2>
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-5">
        <p className="text-sm text-[var(--color-text)] leading-relaxed">
          Found a bug, spotted a miscategorized call, or want to suggest a feature? Open an
          issue at{" "}
          <a
            href="https://github.com/anythingimake/predictable/issues"
            target="_blank"
            rel="noreferrer"
          >
            github.com/anythingimake/predictable/issues
          </a>
          . PRs welcome too.
        </p>
      </div>
    </section>
  );
}
