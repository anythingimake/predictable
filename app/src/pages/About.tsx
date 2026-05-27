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

export function About() {
  return (
    <div className="space-y-12">
      <Hero />
      <WhereToFind />
      <NotSection />
      <ReachOut />
      <ConservanerdsBanner />
    </div>
  );
}

function ConservanerdsBanner() {
  return (
    <section
      className="relative overflow-hidden rounded-xl border text-center py-7 md:py-9 px-5 max-w-2xl mx-auto"
      style={{
        borderColor: "var(--color-mark)",
        background:
          "radial-gradient(ellipse at 50% 50%, rgba(34,197,94,0.15), rgba(7,9,26,0.6) 70%), linear-gradient(180deg, #0a1a0e 0%, #0f2b1c 100%)",
        boxShadow: "0 0 32px var(--color-mark-glow), inset 0 0 24px rgba(34,197,94,0.06)",
      }}
    >
      <h2
        className="font-black uppercase leading-none tracking-tight"
        style={{
          fontFamily: '"Space Grotesk", "Inter", system-ui, sans-serif',
          fontSize: "clamp(1.5rem, 5vw, 2.5rem)",
          color: "#eef1ff",
          textShadow: "0 0 12px var(--color-mark-glow), 0 2px 0 rgba(0,0,0,0.4)",
        }}
      >
        Conservanerds{" "}
        <span
          style={{
            color: "var(--color-mark)",
            textShadow: "0 0 18px var(--color-mark), 0 2px 0 rgba(0,0,0,0.5)",
          }}
        >
          Unite!
        </span>
      </h2>
      <p
        className="mt-3 text-[10px] md:text-xs uppercase tracking-[0.3em] font-medium"
        style={{ color: "rgba(238,241,255,0.6)" }}
      >
        For nerds · for numbers · for the show
      </p>
    </section>
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
