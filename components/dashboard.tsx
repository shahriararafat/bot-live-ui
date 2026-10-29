"use client";

import { useId } from "react";
import { Character } from "@/components/characters";
import { botBySlug } from "@/lib/bots";
import { followerChange } from "@/lib/dashboard";
import { formatAgo } from "@/lib/time";
import type {
  DashboardState,
  FollowerPoint,
  SpendingData,
  TopPost,
  XAdviceData,
  XGrowthData,
} from "@/lib/types";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatCount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatDelta(value: number | null): string {
  if (value === null) return "—";
  if (value > 0) return `+${formatCount(value)}`;
  return formatCount(value);
}

function deltaClass(value: number | null): string {
  const base = "text-lg font-black tabular-nums";
  if (value === null || value === 0) return `${base} text-[#5c4a3a]`;
  if (value > 0) return `${base} text-[#1f7a45]`;
  return `${base} text-[#a12323]`;
}

function taka(value: number): string {
  return `৳${formatCount(value)}`;
}

function formatMonth(month: string): string {
  const [year, raw] = month.split("-");
  const name = MONTHS[Number(raw) - 1];
  return name ? `${name} ${year}` : month;
}

function postStats(post: TopPost): string {
  const parts: string[] = [];
  if (post.views !== undefined) parts.push(`${formatCount(post.views)} views`);
  if (post.likes !== undefined) parts.push(`${formatCount(post.likes)} likes`);
  return parts.join(" · ");
}

export function Dashboard({ state, now }: { state: DashboardState; now: number }) {
  const labelId = useId();
  const today = Number.isNaN(now) ? "" : new Date(now).toISOString().slice(0, 10);
  return (
    <section aria-labelledby={labelId} className="mt-6">
      <p id={labelId} className="px-1 text-[10px] font-bold uppercase tracking-[0.22em] text-[#e7c89a]">
        Dashboard
      </p>
      <div className="mt-2 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <GrowthPanel entry={state.x_growth} now={now} today={today} />
        <AdvicePanel entry={state.x_advice} now={now} />
        <BotsPanel entry={state.bot_results} now={now} />
        <SpendingPanel entry={state.spending} now={now} />
      </div>
    </section>
  );
}

function Panel({
  title,
  accent,
  updatedAt,
  now,
  empty,
  className = "",
  children,
}: {
  title: string;
  accent: string;
  updatedAt: string | null;
  now: number;
  empty: string | null;
  className?: string;
  children?: React.ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-xl border-2 border-[#3a2918] bg-[#fff8ee] p-4 text-[#2a1d14] ${className}`}
      style={{ boxShadow: `inset 0 4px 0 ${accent}, 3px 3px 0 #3a2918` }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={titleId} className="text-sm font-black">
          {title}
        </h2>
        {updatedAt ? <p className="text-[10px] text-[#8a7362]">Updated {formatAgo(updatedAt, now)}</p> : null}
      </div>
      {empty ? <p className="mt-3 text-sm text-[#8a7362]">{empty}</p> : children}
    </section>
  );
}

function GrowthPanel({
  entry,
  now,
  today,
}: {
  entry: DashboardState["x_growth"];
  now: number;
  today: string;
}) {
  return (
    <Panel
      title="X growth"
      accent="#1c1c1c"
      updatedAt={entry?.updatedAt ?? null}
      now={now}
      empty={entry ? null : "Waiting for X Analyst"}
    >
      {entry ? <GrowthBody data={entry.data} today={today} /> : null}
    </Panel>
  );
}

function GrowthBody({ data, today }: { data: XGrowthData; today: string }) {
  const week = followerChange(data.followers, data.history, 7, today);
  const month = followerChange(data.followers, data.history, 30, today);
  return (
    <>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-[#8a5a32]">Followers</dt>
          <dd className="text-lg font-black tabular-nums">{formatCount(data.followers)}</dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-[#8a5a32]">7 days</dt>
          <dd className={deltaClass(week)} title={week === null ? "No history that old" : undefined}>
            {formatDelta(week)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-bold uppercase tracking-wide text-[#8a5a32]">30 days</dt>
          <dd className={deltaClass(month)} title={month === null ? "No history that old" : undefined}>
            {formatDelta(month)}
          </dd>
        </div>
      </dl>
      <FollowerChart history={data.history} />
      {data.topPosts.length === 0 ? (
        <p className="mt-3 text-sm text-[#8a7362]">No top posts.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {data.topPosts.map((post, index) => {
            const stats = postStats(post);
            return (
              <li key={`${post.url}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-[#3a2918]/10">
                <a
                  href={post.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-semibold break-words underline decoration-[#c9843f] underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#c9a227]"
                >
                  {post.text}
                </a>
                {stats ? <p className="mt-1 text-[11px] text-[#8a7362]">{stats}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

function FollowerChart({ history }: { history: FollowerPoint[] }) {
  const points = [...history].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (points.length === 0) return <p className="mt-3 text-sm text-[#8a7362]">No history yet.</p>;

  const width = 320;
  const height = 88;
  const padX = 4;
  const padY = 8;
  const min = Math.min(...points.map((point) => point.followers));
  const max = Math.max(...points.map((point) => point.followers));
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x =
      points.length === 1 ? width / 2 : padX + (index / (points.length - 1)) * (width - padX * 2);
    const y = padY + (1 - (point.followers - min) / span) * (height - padY * 2);
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const area = `${first.x},${height - 2} ${line} ${last.x},${height - 2}`;
  const label =
    points.length === 1
      ? `Follower history on ${points[0].date}`
      : `Follower history from ${points[0].date} to ${points[points.length - 1].date}`;

  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full" role="img" aria-label={label}>
        {coords.length > 1 ? <polygon points={area} fill="#f0d7b4" /> : null}
        {coords.length > 1 ? (
          <polyline points={line} fill="none" stroke="#3a2918" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ) : (
          <circle cx={first.x} cy={first.y} r="3.5" fill="#3a2918" />
        )}
      </svg>
      <figcaption className="flex justify-between text-[10px] text-[#8a7362]">
        <span>{points[0].date}</span>
        {points.length > 1 ? <span>{points[points.length - 1].date}</span> : null}
      </figcaption>
    </figure>
  );
}

function AdvicePanel({ entry, now }: { entry: DashboardState["x_advice"]; now: number }) {
  return (
    <Panel
      title="X advice"
      accent="#7a4ea3"
      updatedAt={entry?.updatedAt ?? null}
      now={now}
      empty={entry ? null : "Waiting for X Analyst"}
    >
      {entry ? <AdviceBody data={entry.data} /> : null}
    </Panel>
  );
}

function AdviceBody({ data }: { data: XAdviceData }) {
  return (
    <>
      <p className="mt-3 text-sm leading-relaxed break-words">{data.summary}</p>
      {data.actions.length === 0 ? null : (
        <ul className="mt-3 space-y-1.5">
          {data.actions.map((action, index) => (
            <li key={`${index}-${action}`} className="flex gap-2 text-sm leading-snug">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#3a2918]" aria-hidden="true" />
              <span className="min-w-0 break-words">{action}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BotsPanel({ entry, now }: { entry: DashboardState["bot_results"]; now: number }) {
  return (
    <Panel
      title="Bot jobs & results"
      accent="#e07a2f"
      updatedAt={entry?.updatedAt ?? null}
      now={now}
      empty={entry ? null : "Waiting for OfficeSync"}
      className="lg:col-span-2"
    >
      {entry ? (
        entry.data.bots.length === 0 ? (
          <p className="mt-3 text-sm text-[#8a7362]">No bots in this report.</p>
        ) : (
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {entry.data.bots.map((bot) => {
              const known = botBySlug(bot.slug);
              if (!known) return null;
              return (
                <li
                  key={bot.slug}
                  className="flex min-w-0 items-start gap-3 rounded-xl border-2 border-[#3a2918] bg-white p-3"
                  style={{ boxShadow: `inset 4px 0 0 ${known.accent}` }}
                >
                  <Character slug={known.slug} mode="idle" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[13px] font-black leading-tight">{known.name}</h3>
                    <p className="mt-1 text-[13px] font-semibold leading-snug break-words">{bot.job}</p>
                    {bot.recent.length === 0 ? (
                      <p className="mt-1 text-[11px] text-[#8a7362]">No recent results.</p>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {bot.recent.map((line, index) => (
                          <li key={`${bot.slug}-${index}`} className="text-[12px] leading-snug break-words text-[#5c4a3a]">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </Panel>
  );
}

function SpendingPanel({ entry, now }: { entry: DashboardState["spending"]; now: number }) {
  return (
    <Panel
      title="Spending"
      accent="#3aaa6d"
      updatedAt={entry?.updatedAt ?? null}
      now={now}
      empty={entry ? null : "Waiting for Money Kick"}
      className="lg:col-span-2"
    >
      {entry ? <SpendingBody data={entry.data} /> : null}
    </Panel>
  );
}

function SpendingBody({ data }: { data: SpendingData }) {
  const peak = data.categories.reduce((max, category) => Math.max(max, Math.abs(category.amount)), 0);
  const budget = data.budget;
  const ratio = budget !== undefined && budget > 0 ? data.total / budget : null;
  return (
    <>
      <p className="mt-3 text-2xl font-black tabular-nums">{taka(data.total)}</p>
      <p className="text-xs text-[#8a5a32]">{formatMonth(data.month)}</p>
      {data.todaySpent !== undefined ? (
        <p className="mt-2 text-sm">
          Today <span className="font-black tabular-nums">{taka(data.todaySpent)}</span>
        </p>
      ) : null}
      {budget === undefined ? null : ratio === null ? (
        <p className="mt-3 text-xs text-[#5c4a3a]">Budget {taka(budget)}</p>
      ) : (
        <div className="mt-3">
          <div className="flex flex-wrap justify-between gap-2 text-xs text-[#5c4a3a]">
            <span>
              {taka(data.total)} of {taka(budget)}
            </span>
            <span className="tabular-nums">{Math.round(ratio * 100)}%</span>
          </div>
          <div
            className="mt-1 h-2 overflow-hidden rounded-full bg-[#f0e2d0]"
            role="meter"
            aria-label="Spending against budget"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={Math.max(0, data.total)}
          >
            <div
              className={`h-full rounded-full ${ratio > 1 ? "bg-[#e07a2f]" : "bg-[#3aaa6d]"}`}
              style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%` }}
            />
          </div>
        </div>
      )}
      {data.categories.length === 0 ? (
        <p className="mt-3 text-sm text-[#8a7362]">No categories.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {data.categories.map((category, index) => (
            <li key={`${category.name}-${index}`} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 break-words font-semibold">{category.name}</span>
                <span className="shrink-0 tabular-nums">{taka(category.amount)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#f0e2d0]">
                <div
                  className="h-full rounded-full bg-[#c9843f]"
                  style={{ width: `${peak <= 0 ? 0 : Math.max(0, Math.min(100, (Math.abs(category.amount) / peak) * 100))}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
