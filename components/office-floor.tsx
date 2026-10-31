"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Character, type CharacterMode } from "@/components/characters";
import { Dashboard } from "@/components/dashboard";
import type { BotSlug } from "@/lib/bots";
import { formatAgo } from "@/lib/time";
import { STATUSES, type OfficeBot, type OfficePayload, type Status } from "@/lib/types";

const LIGHT: Record<Status, string> = {
  idle: "#a89880",
  working: "#2faf6a",
  waiting: "#f0a202",
  done: "#3d8bfd",
};

function modeFor(bot: OfficeBot): CharacterMode {
  return bot.stale ? "stale" : bot.displayStatus;
}

function countsFor(bots: OfficeBot[]): Record<Status, number> {
  const counts: Record<Status, number> = { idle: 0, working: 0, waiting: 0, done: 0 };
  for (const bot of bots) counts[bot.displayStatus] += 1;
  return counts;
}

export function OfficeFloor({ initial }: { initial: OfficePayload }) {
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const titleId = useId();
  const now = Date.parse(data.now);
  const counts = countsFor(data.bots);
  const open = data.bots.find((bot) => bot.slug === openSlug) ?? null;

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function pull() {
      try {
        const res = await fetch("/api/office", { cache: "no-store" });
        if (stop) return;
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        if (!res.ok) {
          setOffline(true);
          return;
        }
        setOffline(false);
        setData((await res.json()) as OfficePayload);
      } catch {
        if (!stop) setOffline(true);
      }
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      if (stop || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        void pull().finally(() => {
          if (!stop) schedule();
        });
      }, 2000);
    }

    function wake() {
      void pull();
      schedule();
    }

    function onVisibility() {
      if (document.visibilityState === "visible") wake();
      else if (timer) clearTimeout(timer);
    }

    schedule();
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenSlug(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-screen bg-[#241c17]">
      <header className="mx-auto flex max-w-[1240px] flex-wrap items-end justify-between gap-4 px-4 py-4 text-[#f6e6cf]">
        <div className="flex items-center gap-3">
          <Plant />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#e7c89a]">
              {offline ? "reconnecting" : "live"}
            </p>
            <h1 className="text-2xl font-black leading-none">Bot Office</h1>
            <p className="mt-1 text-xs text-[#e7c89a]">Fifteen desks. Updates while this tab is open.</p>
          </div>
        </div>
        <ul className="flex flex-wrap gap-2" aria-label="Bots by status">
          {STATUSES.map((status) => (
            <li key={status} className="flex items-center gap-1.5 rounded-full bg-[#3a2c24] px-2.5 py-1 text-xs">
              <span className="h-2 w-2 rounded-full" style={{ background: LIGHT[status] }} />
              <span className="font-black tabular-nums">{counts[status]}</span>
              <span className="text-[#e7c89a]">{status}</span>
            </li>
          ))}
        </ul>
      </header>

      <main className="mx-auto max-w-[1240px] px-3 pb-8">
        <section className="office-floor rounded-2xl p-3" aria-label="Office floor">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden">
            {data.bots.map((bot) => (
              <Desk key={bot.slug} bot={bot} now={now} variant="row" onOpen={setOpenSlug} />
            ))}
          </div>
          <div className="hidden lg:block">
            <div className="grid grid-cols-5 gap-2">
              {data.bots.slice(0, 5).map((bot) => (
                <Desk key={bot.slug} bot={bot} now={now} variant="desk" onOpen={setOpenSlug} />
              ))}
            </div>
            <div className="my-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-[#6e4124]">
              <span className="h-px flex-1 bg-[#6e4124]/50" />
              hallway
              <span className="h-px flex-1 bg-[#6e4124]/50" />
            </div>
            <div className="grid grid-cols-5 gap-2">
              {data.bots.slice(5).map((bot) => (
                <Desk key={bot.slug} bot={bot} now={now} variant="desk" onOpen={setOpenSlug} />
              ))}
            </div>
          </div>
        </section>
        <Dashboard state={data.dashboard} now={now} />
      </main>

      {open ? (
        <div
          className="fixed inset-0 z-20 flex items-end justify-center bg-[#1a120e]/60 p-3 sm:items-center"
          onClick={() => setOpenSlug(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="max-h-[80vh] w-full max-w-md overflow-auto rounded-2xl border-2 border-[#3a2918] bg-[#fff8ee] p-4 shadow-[6px_6px_0_#1a120e]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-lg font-black">
                  {open.name}
                </h2>
                <p className="text-xs text-[#5c4a3a]">{open.role}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpenSlug(null)}
                className="rounded-lg border-2 border-[#3a2918] px-2 py-1 text-xs font-bold"
              >
                Close
              </button>
            </div>
            <p className="mt-3 text-sm">
              <span className="font-bold uppercase">{open.displayStatus}</span>
              {open.stale ? <span className="text-[#8a7362]"> · stale, last result kept</span> : null}
              <span className="text-[#8a7362]"> · {formatAgo(open.updatedAt, now)}</span>
            </p>
            {open.doing ? <p className="mt-2 text-sm font-semibold">{open.doing}</p> : null}
            {open.result ? <p className="mt-1 text-sm text-[#5c4a3a]">{open.result}</p> : null}
            <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-[#8a5a32]">Recent reports</h3>
            {open.history.length === 0 ? (
              <p className="mt-2 text-sm text-[#8a7362]">No reports yet.</p>
            ) : (
              <ol className="mt-2 space-y-2">
                {[...open.history].reverse().map((entry, index) => (
                  <li key={`${entry.updatedAt}-${index}`} className="rounded-lg bg-white px-3 py-2 text-sm ring-1 ring-[#3a2918]/10">
                    <p className="text-xs font-bold uppercase text-[#5c4a3a]">
                      {entry.status} · {formatAgo(entry.updatedAt, now)}
                    </p>
                    {entry.doing ? <p className="mt-1">{entry.doing}</p> : null}
                    {entry.result ? <p className="text-[#5c4a3a]">{entry.result}</p> : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Desk({
  bot,
  now,
  variant,
  onOpen,
}: {
  bot: OfficeBot;
  now: number;
  variant: "row" | "desk";
  onOpen: (slug: string) => void;
}) {
  const mode = modeFor(bot);
  const label = `${bot.name}, ${bot.displayStatus}${bot.stale ? ", stale" : ""}. ${bot.doing} ${bot.result}`.trim();
  const bubble = (
    <div className="rounded-lg bg-white px-1.5 py-1 ring-1 ring-[#3a2918]/10">
      {bot.doing ? <p className="line-clamp-2 text-[11px] font-semibold leading-snug">{bot.doing}</p> : null}
      {bot.result ? <p className="line-clamp-2 text-[11px] leading-snug text-[#5c4a3a]">{bot.result}</p> : null}
      {!bot.doing && !bot.result && !bot.updatedAt ? <p className="text-[11px] text-[#8a7362]">No report yet</p> : null}
      <p className="mt-0.5 text-[10px] text-[#8a7362]" title={bot.updatedAt ?? undefined}>
        {formatAgo(bot.updatedAt, now)}
        {bot.stale ? " · stale" : ""}
      </p>
    </div>
  );

  return (
    <button
      type="button"
      className={variant === "desk" ? "desk flex h-full flex-col items-center p-2" : "desk flex w-full items-start gap-3 p-3"}
      style={{ boxShadow: `inset 0 4px 0 ${bot.accent}, 3px 3px 0 #3a2918` }}
      onClick={() => onOpen(bot.slug)}
      aria-label={label}
    >
      <Character slug={bot.slug as BotSlug} mode={mode} />
      <div className={variant === "desk" ? "mt-1 w-full" : "min-w-0 flex-1"}>
        <div className="flex items-start justify-between gap-1">
          <h2 className="text-[12px] font-black leading-tight">{bot.name}</h2>
          <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-[#5c4a3a]">
            <span
              className={`h-2 w-2 rounded-full ${bot.displayStatus === "working" ? "light-working" : ""}`}
              style={{ background: LIGHT[bot.displayStatus] }}
            />
            {bot.displayStatus}
          </span>
        </div>
        <p className="text-[10px] leading-tight text-[#8a5a32]">{bot.role}</p>
        <div className={variant === "desk" ? "mt-1" : "mt-1.5"}>{bubble}</div>
      </div>
    </button>
  );
}

function Plant() {
  return (
    <svg viewBox="0 0 16 16" className="h-10 w-10" shapeRendering="crispEdges" aria-hidden="true">
      <rect x="6" y="10" width="4" height="4" fill="#8a5a32" />
      <rect x="7" y="6" width="2" height="4" fill="#2f6b3a" />
      <rect x="3" y="5" width="4" height="3" fill="#3aaa6d" />
      <rect x="9" y="4" width="4" height="3" fill="#2faf6a" />
      <rect x="6" y="2" width="4" height="3" fill="#7dcea0" />
    </svg>
  );
}
