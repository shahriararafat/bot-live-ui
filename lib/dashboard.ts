import { isBotSlug } from "./bots";
import { DASHBOARD_SECTIONS, type BotResultEntry, type DashboardData, type DashboardSection, type FollowerPoint, type SpendCategory, type SpendingData, type TopPost, type XAdviceData, type XGrowthData } from "./types";
import { charCount } from "./validate";

export const MAX_DASHBOARD_BYTES = 16 * 1024;
export const MAX_BOT_RESULTS = 30;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_MONTH = /^(\d{4})-(\d{2})$/;

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function asObject(value: unknown, label: string): Parsed<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `${label} must be a JSON object` };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function rejectUnknown(record: Record<string, unknown>, allowed: readonly string[]): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) return `Unexpected field: ${key}`;
  }
  return null;
}

function asNumber(value: unknown, label: string): Parsed<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { ok: false, error: `${label} must be a number` };
  }
  return { ok: true, value };
}

function asText(value: unknown, label: string, max: number): Parsed<string> {
  if (typeof value !== "string") return { ok: false, error: `${label} must be a string` };
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: `${label} is required` };
  if (charCount(trimmed) > max) return { ok: false, error: `${label} must be ${max} characters or fewer` };
  return { ok: true, value: trimmed };
}

function asList(value: unknown, label: string, max: number): Parsed<unknown[]> {
  if (!Array.isArray(value)) return { ok: false, error: `${label} must be a list` };
  if (value.length > max) return { ok: false, error: `${label} must have ${max} entries or fewer` };
  return { ok: true, value };
}

function optionalNumber(record: Record<string, unknown>, key: string): Parsed<number | undefined> {
  if (!(key in record)) return { ok: true, value: undefined };
  return asNumber(record[key], key);
}

function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isIsoMonth(value: string): boolean {
  const match = ISO_MONTH.exec(value);
  if (!match) return false;
  const month = Number(match[2]);
  return month >= 1 && month <= 12;
}

function isDashboardSection(value: string): value is DashboardSection {
  return (DASHBOARD_SECTIONS as readonly string[]).includes(value);
}

function validatePoint(value: unknown): Parsed<FollowerPoint> {
  const object = asObject(value, "history entry");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["date", "followers"]);
  if (extra) return { ok: false, error: extra };
  if (typeof object.value.date !== "string" || !isIsoDate(object.value.date)) {
    return { ok: false, error: "date must be YYYY-MM-DD" };
  }
  const followers = asNumber(object.value.followers, "followers");
  if (!followers.ok) return followers;
  return { ok: true, value: { date: object.value.date, followers: followers.value } };
}

function validateUrl(value: unknown): Parsed<string> {
  if (typeof value !== "string") return { ok: false, error: "url must be a string" };
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: "url must be an https://x.com/... link" };
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "x.com" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    !/^\/[^/]/.test(url.pathname)
  ) {
    return { ok: false, error: "url must be an https://x.com/... link" };
  }
  return { ok: true, value: trimmed };
}

function validatePost(value: unknown): Parsed<TopPost> {
  const object = asObject(value, "top post");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["text", "url", "views", "likes"]);
  if (extra) return { ok: false, error: extra };
  const text = asText(object.value.text, "text", 280);
  if (!text.ok) return text;
  const url = validateUrl(object.value.url);
  if (!url.ok) return url;
  const views = optionalNumber(object.value, "views");
  if (!views.ok) return views;
  const likes = optionalNumber(object.value, "likes");
  if (!likes.ok) return likes;
  const post: TopPost = { text: text.value, url: url.value };
  if (views.value !== undefined) post.views = views.value;
  if (likes.value !== undefined) post.likes = likes.value;
  return { ok: true, value: post };
}

function validateGrowth(value: unknown): Parsed<XGrowthData> {
  const object = asObject(value, "data");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["followers", "history", "topPosts"]);
  if (extra) return { ok: false, error: extra };
  const followers = asNumber(object.value.followers, "followers");
  if (!followers.ok) return followers;
  const history = asList(object.value.history, "history", 90);
  if (!history.ok) return history;
  const points: FollowerPoint[] = [];
  for (const item of history.value) {
    const point = validatePoint(item);
    if (!point.ok) return point;
    points.push(point.value);
  }
  const posts = asList(object.value.topPosts, "topPosts", 5);
  if (!posts.ok) return posts;
  const topPosts: TopPost[] = [];
  for (const item of posts.value) {
    const post = validatePost(item);
    if (!post.ok) return post;
    topPosts.push(post.value);
  }
  return { ok: true, value: { followers: followers.value, history: points, topPosts } };
}

function validateAdvice(value: unknown): Parsed<XAdviceData> {
  const object = asObject(value, "data");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["summary", "actions"]);
  if (extra) return { ok: false, error: extra };
  const summary = asText(object.value.summary, "summary", 500);
  if (!summary.ok) return summary;
  const actions = asList(object.value.actions, "actions", 5);
  if (!actions.ok) return actions;
  const lines: string[] = [];
  for (const item of actions.value) {
    const line = asText(item, "action", 200);
    if (!line.ok) return line;
    lines.push(line.value);
  }
  return { ok: true, value: { summary: summary.value, actions: lines } };
}

function validateBot(value: unknown): Parsed<BotResultEntry> {
  const object = asObject(value, "bot");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["slug", "job", "recent"]);
  if (extra) return { ok: false, error: extra };
  if (typeof object.value.slug !== "string" || object.value.slug.trim() === "") {
    return { ok: false, error: "slug is required" };
  }
  const slug = object.value.slug.trim();
  if (!isBotSlug(slug)) return { ok: false, error: `Unknown bot: ${slug}` };
  const job = asText(object.value.job, "job", 140);
  if (!job.ok) return job;
  const recent = asList(object.value.recent, "recent", 3);
  if (!recent.ok) return recent;
  const lines: string[] = [];
  for (const item of recent.value) {
    const line = asText(item, "recent", 140);
    if (!line.ok) return line;
    lines.push(line.value);
  }
  return { ok: true, value: { slug, job: job.value, recent: lines } };
}

function validateBots(value: unknown): Parsed<{ bots: BotResultEntry[] }> {
  const object = asObject(value, "data");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["bots"]);
  if (extra) return { ok: false, error: extra };
  const bots = asList(object.value.bots, "bots", MAX_BOT_RESULTS);
  if (!bots.ok) return bots;
  const entries: BotResultEntry[] = [];
  const seen = new Set<string>();
  for (const item of bots.value) {
    const bot = validateBot(item);
    if (!bot.ok) return bot;
    if (seen.has(bot.value.slug)) return { ok: false, error: `Duplicate bot: ${bot.value.slug}` };
    seen.add(bot.value.slug);
    entries.push(bot.value);
  }
  return { ok: true, value: { bots: entries } };
}

function validateCategory(value: unknown): Parsed<SpendCategory> {
  const object = asObject(value, "category");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["name", "amount"]);
  if (extra) return { ok: false, error: extra };
  const name = asText(object.value.name, "name", 40);
  if (!name.ok) return name;
  const amount = asNumber(object.value.amount, "amount");
  if (!amount.ok) return amount;
  return { ok: true, value: { name: name.value, amount: amount.value } };
}

function validateSpending(value: unknown): Parsed<SpendingData> {
  const object = asObject(value, "data");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["month", "currency", "total", "budget", "todaySpent", "categories"]);
  if (extra) return { ok: false, error: extra };
  if (typeof object.value.month !== "string" || !isIsoMonth(object.value.month)) {
    return { ok: false, error: "month must be YYYY-MM" };
  }
  if (object.value.currency !== "BDT") return { ok: false, error: "currency must be BDT" };
  const total = asNumber(object.value.total, "total");
  if (!total.ok) return total;
  const budget = optionalNumber(object.value, "budget");
  if (!budget.ok) return budget;
  const todaySpent = optionalNumber(object.value, "todaySpent");
  if (!todaySpent.ok) return todaySpent;
  const categories = asList(object.value.categories, "categories", 12);
  if (!categories.ok) return categories;
  const rows: SpendCategory[] = [];
  for (const item of categories.value) {
    const row = validateCategory(item);
    if (!row.ok) return row;
    rows.push(row.value);
  }
  const data: SpendingData = {
    month: object.value.month,
    currency: "BDT",
    total: total.value,
    categories: rows,
  };
  if (budget.value !== undefined) data.budget = budget.value;
  if (todaySpent.value !== undefined) data.todaySpent = todaySpent.value;
  return { ok: true, value: data };
}

export function validateDashboardBody(body: unknown): Parsed<{ section: DashboardSection; data: DashboardData }> {
  const object = asObject(body, "Body");
  if (!object.ok) return object;
  const extra = rejectUnknown(object.value, ["section", "data"]);
  if (extra) return { ok: false, error: extra };
  if (typeof object.value.section !== "string" || !isDashboardSection(object.value.section)) {
    return { ok: false, error: "section must be x_growth, x_advice, bot_results, or spending" };
  }
  const section = object.value.section;
  if (section === "x_growth") {
    const data = validateGrowth(object.value.data);
    if (!data.ok) return data;
    return { ok: true, value: { section, data: data.value } };
  }
  if (section === "x_advice") {
    const data = validateAdvice(object.value.data);
    if (!data.ok) return data;
    return { ok: true, value: { section, data: data.value } };
  }
  if (section === "bot_results") {
    const data = validateBots(object.value.data);
    if (!data.ok) return data;
    return { ok: true, value: { section, data: data.value } };
  }
  const data = validateSpending(object.value.data);
  if (!data.ok) return data;
  return { ok: true, value: { section, data: data.value } };
}

function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function followerChange(
  followers: number,
  history: readonly FollowerPoint[],
  days: number,
  today: string,
): number | null {
  if (!isIsoDate(today)) return null;
  const cutoff = shiftIsoDate(today, -days);
  const points = history.map((point, index) => ({ ...point, index }));
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index));
  let baseline: number | null = null;
  for (const point of points) {
    if (!isIsoDate(point.date)) continue;
    if (point.date <= cutoff) baseline = point.followers;
  }
  if (baseline === null) return null;
  return followers - baseline;
}
