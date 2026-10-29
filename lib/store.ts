import { Redis } from "@upstash/redis";
import { BOTS, type BotSlug } from "./bots";
import type { BotRecord, HistoryEntry, OfficePayload, StatusPatch } from "./types";

export const STALE_MS = 30 * 60 * 1000;
const HISTORY_LIMIT = 20;

export interface OfficeStore {
  readAll(): Promise<Partial<Record<BotSlug, BotRecord>>>;
  write(slug: BotSlug, record: BotRecord): Promise<void>;
}

export function emptyRecord(): BotRecord {
  return { status: "idle", doing: "", result: "", updatedAt: null, history: [] };
}

export function isStale(updatedAt: string | null, now: Date): boolean {
  if (!updatedAt) return false;
  const then = Date.parse(updatedAt);
  if (Number.isNaN(then)) return false;
  return now.getTime() - then >= STALE_MS;
}

export function mergeRecord(prev: BotRecord, patch: StatusPatch, now: Date): BotRecord {
  let doing = prev.doing;
  if (patch.doing !== undefined) doing = patch.doing;
  else if (patch.status === "done" || patch.status === "idle") doing = "";

  const result = patch.result !== undefined ? patch.result : prev.result;
  const entry: HistoryEntry = {
    status: patch.status,
    doing,
    result,
    updatedAt: now.toISOString(),
  };
  return {
    ...entry,
    history: [...prev.history, entry].slice(-HISTORY_LIMIT),
  };
}

export function resolveRedisEnv(): { url: string; token: string } | null {
  const upstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (upstashUrl && upstashToken) return { url: upstashUrl, token: upstashToken };
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (kvUrl && kvToken) return { url: kvUrl, token: kvToken };
  return null;
}

class MemoryStore implements OfficeStore {
  private records = new Map<BotSlug, BotRecord>();

  async readAll(): Promise<Partial<Record<BotSlug, BotRecord>>> {
    const out: Partial<Record<BotSlug, BotRecord>> = {};
    for (const [slug, record] of this.records) out[slug] = structuredClone(record);
    return out;
  }

  async write(slug: BotSlug, record: BotRecord): Promise<void> {
    this.records.set(slug, structuredClone(record));
  }

  clear(): void {
    this.records.clear();
  }
}

class RedisStore implements OfficeStore {
  constructor(private redis: Redis) {}

  async readAll(): Promise<Partial<Record<BotSlug, BotRecord>>> {
    const slugs = BOTS.map((bot) => bot.slug);
    const values = await this.redis.mget<(BotRecord | string | null)[]>(...slugs.map(keyFor));
    const out: Partial<Record<BotSlug, BotRecord>> = {};
    slugs.forEach((slug, index) => {
      const record = parseRecord(values[index]);
      if (record) out[slug] = record;
    });
    return out;
  }

  async write(slug: BotSlug, record: BotRecord): Promise<void> {
    await this.redis.set(keyFor(slug), record);
  }
}

function keyFor(slug: BotSlug): string {
  return `office:bot:${slug}`;
}

function parseRecord(value: BotRecord | string | null): BotRecord | null {
  if (!value) return null;
  const record = typeof value === "string" ? (JSON.parse(value) as BotRecord) : value;
  if (!record || typeof record !== "object" || !Array.isArray(record.history)) return null;
  return record;
}

const globalStore = globalThis as typeof globalThis & {
  __botOfficeMemory?: MemoryStore;
  __botOfficeCached?: OfficeStore | null;
};

function memoryStore(): MemoryStore {
  if (!globalStore.__botOfficeMemory) globalStore.__botOfficeMemory = new MemoryStore();
  return globalStore.__botOfficeMemory;
}

export function getStore(): OfficeStore {
  if (globalStore.__botOfficeCached) return globalStore.__botOfficeCached;
  const cfg = resolveRedisEnv();
  globalStore.__botOfficeCached = cfg ? new RedisStore(new Redis(cfg)) : memoryStore();
  return globalStore.__botOfficeCached;
}

export function resetStoreForTests(): void {
  memoryStore().clear();
  globalStore.__botOfficeCached = null;
}

export async function applyUpdate(patch: StatusPatch, now = new Date()): Promise<BotRecord> {
  const store = getStore();
  const slug = patch.bot as BotSlug;
  const all = await store.readAll();
  const next = mergeRecord(all[slug] ?? emptyRecord(), patch, now);
  await store.write(slug, next);
  return next;
}

export async function getOffice(now = new Date()): Promise<OfficePayload> {
  const stored = await getStore().readAll();
  return {
    now: now.toISOString(),
    bots: BOTS.map((bot) => {
      const rec = stored[bot.slug] ?? emptyRecord();
      const stale = isStale(rec.updatedAt, now);
      return {
        slug: bot.slug,
        name: bot.name,
        role: bot.role,
        accent: bot.accent,
        status: rec.status,
        displayStatus: stale ? "idle" : rec.status,
        stale,
        doing: rec.doing,
        result: rec.result,
        updatedAt: rec.updatedAt,
        history: rec.history,
      };
    }),
  };
}
