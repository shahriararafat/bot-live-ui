import { Redis } from "@upstash/redis";
import { BOTS, type BotSlug } from "./bots";
import { DASHBOARD_SECTIONS, type BotRecord, type DashboardData, type DashboardSection, type DashboardState, type HistoryEntry, type OfficePayload, type StatusPatch } from "./types";

export const STALE_MS = 30 * 60 * 1000;
const HISTORY_LIMIT = 20;

export interface OfficeStore {
  readAll(): Promise<Partial<Record<BotSlug, BotRecord>>>;
  write(slug: BotSlug, record: BotRecord): Promise<void>;
  readDashboard(): Promise<DashboardState>;
  writeDashboard(section: DashboardSection, entry: { data: DashboardData; updatedAt: string }): Promise<void>;
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
  private dashboard: DashboardState = blankDashboard();

  async readAll(): Promise<Partial<Record<BotSlug, BotRecord>>> {
    const out: Partial<Record<BotSlug, BotRecord>> = {};
    for (const [slug, record] of this.records) out[slug] = structuredClone(record);
    return out;
  }

  async write(slug: BotSlug, record: BotRecord): Promise<void> {
    this.records.set(slug, structuredClone(record));
  }

  async readDashboard(): Promise<DashboardState> {
    return structuredClone(this.dashboard);
  }

  async writeDashboard(section: DashboardSection, entry: { data: DashboardData; updatedAt: string }): Promise<void> {
    this.dashboard = assignDashboard(this.dashboard, section, structuredClone(entry));
  }

  clear(): void {
    this.records.clear();
    this.dashboard = blankDashboard();
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

  async readDashboard(): Promise<DashboardState> {
    const values = await this.redis.mget<(unknown | null)[]>(...DASHBOARD_SECTIONS.map(dashboardKey));
    let state = blankDashboard();
    DASHBOARD_SECTIONS.forEach((section, index) => {
      const entry = parseDashboard(values[index]);
      if (entry) state = assignDashboard(state, section, entry);
    });
    return state;
  }

  async writeDashboard(section: DashboardSection, entry: { data: DashboardData; updatedAt: string }): Promise<void> {
    await this.redis.set(dashboardKey(section), entry);
  }
}

function keyFor(slug: BotSlug): string {
  return `office:bot:${slug}`;
}

function dashboardKey(section: DashboardSection): string {
  return `office:dashboard:${section}`;
}

function blankDashboard(): DashboardState {
  return { x_growth: null, x_advice: null, bot_results: null, spending: null };
}

function assignDashboard(
  state: DashboardState,
  section: DashboardSection,
  entry: { data: DashboardData; updatedAt: string },
): DashboardState {
  const next = { ...state };
  if (section === "x_growth") next.x_growth = entry as DashboardState["x_growth"];
  else if (section === "x_advice") next.x_advice = entry as DashboardState["x_advice"];
  else if (section === "bot_results") next.bot_results = entry as DashboardState["bot_results"];
  else next.spending = entry as DashboardState["spending"];
  return next;
}

function parseDashboard(value: unknown): { data: DashboardData; updatedAt: string } | null {
  if (!value) return null;
  let record: unknown = value;
  if (typeof value === "string") {
    try {
      record = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) return null;
  const entry = record as { data?: unknown; updatedAt?: unknown };
  if (typeof entry.updatedAt !== "string" || !entry.data || typeof entry.data !== "object" || Array.isArray(entry.data)) {
    return null;
  }
  return { data: entry.data as DashboardData, updatedAt: entry.updatedAt };
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

export async function applyDashboard(
  section: DashboardSection,
  data: DashboardData,
  now = new Date(),
): Promise<{ data: DashboardData; updatedAt: string }> {
  const entry = { data, updatedAt: now.toISOString() };
  await getStore().writeDashboard(section, entry);
  return entry;
}

export async function getOffice(now = new Date()): Promise<OfficePayload> {
  const store = getStore();
  const [stored, dashboard] = await Promise.all([store.readAll(), store.readDashboard()]);
  return {
    now: now.toISOString(),
    dashboard,
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
