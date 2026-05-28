import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import type { SagaDetail as SagaDetailT } from "../types";
import { BackLink } from "../components/BackLink";
import { ErrorBanner, Loading } from "./Scoreboard";

export function SagaDetail() {
  const { id } = useParams<{ id: string }>();
  const [saga, setSaga] = useState<SagaDetailT | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.saga(id).then(setSaga).catch((e) => setErr(String(e)));
  }, [id]);

  if (err) return <ErrorBanner message={err} />;
  if (!saga) return <Loading />;

  return (
    <div className="space-y-5">
      <div>
        <BackLink to="/sagas" label="All sagas" />
        <h1 className="text-xl md:text-2xl font-semibold mt-3 mb-1">{saga.name}</h1>
        {saga.market_question && (
          <p className="text-sm text-[var(--color-text-muted)]">
            {saga.market_source && (
              <span className="uppercase text-[10px] mr-2 opacity-70">{saga.market_source}</span>
            )}
            {saga.market_question}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat label="Episodes" value={saga.episodes.length} />
        <Stat label="Status" value={saga.status} />
        {saga.current_price != null && (
          <Stat label="Last price" value={`${Math.round(saga.current_price * 100)}¢`} />
        )}
        {saga.resolution && <Stat label="Resolution" value={saga.resolution} />}
      </div>

      <section>
        <h2 className="text-base md:text-lg font-medium mb-3">Episodes</h2>
        <div className="space-y-2">
          {saga.episodes.map((e) => (
            <Link
              key={e.id}
              to={`/episodes/${e.id}`}
              className="tap flex items-center justify-between gap-3 rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] px-4 py-3 hover:border-[var(--color-border-strong)]"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{e.episode_title}</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  {e.publish_date}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-3">
      <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</div>
      <div className="text-base font-semibold mt-1">{value}</div>
    </div>
  );
}
