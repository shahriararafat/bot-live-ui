import assert from "node:assert/strict";
import { before, beforeEach, describe, test } from "node:test";
import { resolveRedisEnv, STALE_MS, applyUpdate, getOffice, resetStoreForTests } from "../lib/store";

before(() => {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

beforeEach(() => {
  resetStoreForTests();
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

describe("office store", { concurrency: 1 }, () => {
describe("staleness", () => {
  test("a bot that has not reported stays idle and is not stale", async () => {
    const office = await getOffice(new Date("2026-10-29T12:00:00.000Z"));
    const pikachu = office.bots.find((bot) => bot.slug === "pikachu");
    assert.ok(pikachu);
    assert.equal(pikachu.status, "idle");
    assert.equal(pikachu.displayStatus, "idle");
    assert.equal(pikachu.stale, false);
    assert.equal(pikachu.result, "");
    assert.equal(pikachu.updatedAt, null);
  });

  test("shows an old report as idle while keeping the stored status and result", async () => {
    const now = new Date("2026-10-29T12:00:00.000Z");
    const reportedAt = new Date(now.getTime() - STALE_MS);
    await applyUpdate(
      { bot: "buildbot", status: "working", doing: "compiling", result: "tests green" },
      reportedAt,
    );

    const stale = await getOffice(now);
    const buildbot = stale.bots.find((bot) => bot.slug === "buildbot");
    assert.ok(buildbot);
    assert.equal(buildbot.stale, true);
    assert.equal(buildbot.displayStatus, "idle");
    assert.equal(buildbot.status, "working");
    assert.equal(buildbot.doing, "compiling");
    assert.equal(buildbot.result, "tests green");

    const freshNow = new Date(reportedAt.getTime() + STALE_MS - 1);
    const fresh = await getOffice(freshNow);
    const still = fresh.bots.find((bot) => bot.slug === "buildbot");
    assert.ok(still);
    assert.equal(still.stale, false);
    assert.equal(still.displayStatus, "working");
    assert.equal(still.result, "tests green");
  });
});

describe("redis env", () => {
  test("uses Upstash names, then KV aliases, and ignores a partial pair", () => {
    assert.equal(resolveRedisEnv(), null);

    process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example";
    assert.equal(resolveRedisEnv(), null);

    process.env.UPSTASH_REDIS_REST_TOKEN = "upstash-token";
    process.env.KV_REST_API_URL = "https://kv.example";
    process.env.KV_REST_API_TOKEN = "kv-token";
    assert.deepEqual(resolveRedisEnv(), {
      url: "https://upstash.example",
      token: "upstash-token",
    });

    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    assert.deepEqual(resolveRedisEnv(), { url: "https://kv.example", token: "kv-token" });

    delete process.env.KV_REST_API_TOKEN;
    assert.equal(resolveRedisEnv(), null);
  });
});
});
