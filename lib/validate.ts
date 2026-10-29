import { isBotSlug } from "./bots";
import { STATUSES, type Status, type StatusPatch } from "./types";

const MAX_CHARS = 140;

export function charCount(value: string): number {
  return Array.from(value).length;
}

export function validateStatusBody(body: unknown): { ok: true; value: StatusPatch } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body must be a JSON object" };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.bot !== "string" || record.bot.trim() === "") {
    return { ok: false, error: "bot is required" };
  }
  const bot = record.bot.trim();
  if (!isBotSlug(bot)) {
    return { ok: false, error: `Unknown bot: ${bot}` };
  }

  if (record.status === undefined || typeof record.status !== "string") {
    return { ok: false, error: "status is required" };
  }
  if (!STATUSES.includes(record.status as Status)) {
    return { ok: false, error: "status must be idle, working, waiting, or done" };
  }

  const patch: StatusPatch = { bot, status: record.status as Status };

  if ("doing" in record) {
    if (typeof record.doing !== "string") return { ok: false, error: "doing must be a string" };
    const doing = record.doing.trim();
    if (charCount(doing) > MAX_CHARS) {
      return { ok: false, error: "doing must be 140 characters or fewer" };
    }
    patch.doing = doing;
  }

  if ("result" in record) {
    if (typeof record.result !== "string") return { ok: false, error: "result must be a string" };
    const result = record.result.trim();
    if (charCount(result) > MAX_CHARS) {
      return { ok: false, error: "result must be 140 characters or fewer" };
    }
    patch.result = result;
  }

  return { ok: true, value: patch };
}
