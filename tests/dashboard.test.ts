import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { NextRequest } from "next/server";
import { POST as postDashboard } from "../app/api/dashboard/route";
import { GET as getOfficeRoute } from "../app/api/office/route";
import { MAX_DASHBOARD_BYTES, followerChange } from "../lib/dashboard";
import { COOKIE_NAME, signSession } from "../lib/session";
import { getOffice, resetStoreForTests } from "../lib/store";
import { proxy } from "../proxy";

const TOKEN = "test-ingest-token";
const PASS = "test-passcode";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashScript = path.join(root, "scripts/report-dashboard.sh");

before(() => {
  process.env.INGEST_TOKEN = TOKEN;
  process.env.APP_PASSCODE = PASS;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
});

beforeEach(() => {
  resetStoreForTests();
});

function dashboardRequest(body: unknown, token?: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("authorization", `Bearer ${token === undefined ? TOKEN : token}`);
  return postDashboard(
    new Request("http://localhost/api/dashboard", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

function runDashboard(args: string[], env: Record<string, string | undefined>, input?: string) {
  const result = spawnSync("/bin/bash", [dashScript, ...args], {
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    input,
    timeout: 20_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? 1,
  };
}

describe("dashboard", { concurrency: 1 }, () => {
  test("stores a good payload for each section and replaces one section at a time", async () => {
    const empty = await getOffice();
    assert.deepEqual(empty.dashboard, {
      x_growth: null,
      x_advice: null,
      bot_results: null,
      spending: null,
    });

    const growth = await dashboardRequest({
      section: "x_growth",
      data: {
        followers: 12840,
        history: [
          { date: "2026-09-29", followers: 11000 },
          { date: "2026-10-22", followers: 12400 },
        ],
        topPosts: [
          {
            text: "  SAMPLE: the hallway plant  ",
            url: " https://x.com/sample/status/1 ",
            views: 12,
            likes: 3,
          },
        ],
      },
    });
    assert.equal(growth.status, 200);
    const growthBody = await growth.json();
    assert.equal(growthBody.section, "x_growth");
    assert.equal(growthBody.data.followers, 12840);
    assert.equal(growthBody.data.topPosts[0].text, "SAMPLE: the hallway plant");
    assert.equal(growthBody.data.topPosts[0].url, "https://x.com/sample/status/1");
    assert.equal(Number.isNaN(Date.parse(growthBody.updatedAt)), false);
    assert.equal("updatedAt" in growthBody.data, false);

    const advice = await dashboardRequest({
      section: "x_advice",
      data: { summary: " SAMPLE: reply once ", actions: [" SAMPLE: post the photo "] },
    });
    assert.equal(advice.status, 200);
    assert.equal((await advice.json()).data.summary, "SAMPLE: reply once");

    const bots = await dashboardRequest({
      section: "bot_results",
      data: {
        bots: [{ slug: " pikachu ", job: `  ${"d".repeat(140)}  `, recent: [" SAMPLE: agenda drafted "] }],
      },
    });
    assert.equal(bots.status, 200);
    const botsBody = await bots.json();
    assert.equal(botsBody.data.bots[0].slug, "pikachu");
    assert.equal(botsBody.data.bots[0].job, "d".repeat(140));
    assert.equal(botsBody.data.bots[0].recent[0], "SAMPLE: agenda drafted");

    const lean = await dashboardRequest({
      section: "spending",
      data: { month: "2026-10", currency: "BDT", total: 10, categories: [] },
    });
    assert.equal(lean.status, 200);
    const leanBody = await lean.json();
    assert.equal("budget" in leanBody.data, false);
    assert.equal("todaySpent" in leanBody.data, false);

    const spending = await dashboardRequest({
      section: "spending",
      data: {
        month: "2026-10",
        currency: "BDT",
        total: 48250,
        budget: 80000,
        todaySpent: 1260,
        categories: [{ name: " SAMPLE food ", amount: 14500 }],
      },
    });
    assert.equal(spending.status, 200);

    const replaced = await dashboardRequest({
      section: "x_growth",
      data: { followers: 13000, history: [], topPosts: [] },
    });
    assert.equal(replaced.status, 200);

    const closed = await getOfficeRoute(new Request("http://localhost/api/office"));
    assert.equal(closed.status, 401);

    const cookie = `${COOKIE_NAME}=${signSession(PASS)}`;
    const open = await getOfficeRoute(new Request("http://localhost/api/office", { headers: { cookie } }));
    assert.equal(open.status, 200);
    const office = await open.json();
    assert.equal(office.dashboard.x_growth.data.followers, 13000);
    assert.equal(office.dashboard.x_growth.data.history.length, 0);
    assert.equal(office.dashboard.x_advice.data.actions[0], "SAMPLE: post the photo");
    assert.equal(office.dashboard.bot_results.data.bots[0].slug, "pikachu");
    assert.equal(office.dashboard.spending.data.total, 48250);
    assert.equal(office.dashboard.spending.data.categories[0].name, "SAMPLE food");
    assert.equal(office.bots.length, 14);
  });

  test("a bad section is 400", async () => {
    const res = await dashboardRequest({ section: "notes", data: {} });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: "section must be x_growth, x_advice, bot_results, or spending",
    });
    const office = await getOffice();
    assert.equal(office.dashboard.x_growth, null);
  });

  test("rejects a bad shape", async () => {
    const history = Array.from({ length: 91 }, (_, index) => ({
      date: "2026-10-01",
      followers: index,
    }));
    const cases: Array<{ body: unknown; error: string }> = [
      { body: "{", error: "Invalid JSON" },
      { body: [], error: "Body must be a JSON object" },
      {
        body: { section: "x_growth", data: { followers: 1, history: [], topPosts: [] }, note: "x" },
        error: "Unexpected field: note",
      },
      {
        body: { section: "x_growth", data: { followers: 1, history, topPosts: [] } },
        error: "history must have 90 entries or fewer",
      },
      {
        body: {
          section: "x_growth",
          data: { followers: 1, history: [{ date: "2026-02-31", followers: 1 }], topPosts: [] },
        },
        error: "date must be YYYY-MM-DD",
      },
      {
        body: {
          section: "x_growth",
          data: {
            followers: 1,
            history: [],
            topPosts: [{ text: "hi", url: "https://example.com/post" }],
          },
        },
        error: "url must be an https://x.com/... link",
      },
      {
        body: {
          section: "x_growth",
          data: {
            followers: 1,
            history: [],
            topPosts: [{ text: "a".repeat(281), url: "https://x.com/sample/status/1" }],
          },
        },
        error: "text must be 280 characters or fewer",
      },
      {
        body: { section: "x_advice", data: { summary: "📦".repeat(501), actions: [] } },
        error: "summary must be 500 characters or fewer",
      },
      {
        body: { section: "x_advice", data: { summary: "ok", actions: ["a", "b", "c", "d", "e", "f"] } },
        error: "actions must have 5 entries or fewer",
      },
      {
        body: { section: "spending", data: { month: "2026-13", currency: "BDT", total: 1, categories: [] } },
        error: "month must be YYYY-MM",
      },
      {
        body: { section: "spending", data: { month: "2026-10", currency: "USD", total: 1, categories: [] } },
        error: "currency must be BDT",
      },
      {
        body: {
          section: "bot_results",
          data: {
            bots: [
              { slug: "pikachu", job: "one", recent: [] },
              { slug: "pikachu", job: "two", recent: [] },
            ],
          },
        },
        error: "Duplicate bot: pikachu",
      },
    ];

    for (const entry of cases) {
      const res = await dashboardRequest(entry.body);
      assert.equal(res.status, 400, JSON.stringify(entry.body));
      assert.deepEqual(await res.json(), { error: entry.error });
    }

    const exact = await dashboardRequest({
      section: "x_advice",
      data: { summary: "📦".repeat(500), actions: ["b".repeat(200)] },
    });
    assert.equal(exact.status, 200);
  });

  test("an oversize body is 400 and is not stored", async () => {
    const raw = JSON.stringify({
      section: "x_advice",
      data: { summary: "x".repeat(MAX_DASHBOARD_BYTES), actions: [] },
    });
    assert.ok(Buffer.byteLength(raw) > MAX_DASHBOARD_BYTES);
    const res = await dashboardRequest(raw);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Body too large" });
    const office = await getOffice();
    assert.equal(office.dashboard.x_advice, null);
  });

  test("a bad or missing token is 401 and does not change the stored section", async () => {
    assert.equal(
      (await dashboardRequest({ section: "x_growth", data: { followers: 10, history: [], topPosts: [] } })).status,
      200,
    );

    for (const token of [null, "", "nope"]) {
      const res = await dashboardRequest(
        { section: "x_growth", data: { followers: 99, history: [], topPosts: [] } },
        token,
      );
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "Unauthorized" });
    }

    const wrongScheme = await postDashboard(
      new Request("http://localhost/api/dashboard", {
        method: "POST",
        headers: { authorization: `Token ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ section: "x_growth", data: { followers: 99, history: [], topPosts: [] } }),
      }),
    );
    assert.equal(wrongScheme.status, 401);

    const office = await getOffice();
    assert.equal(office.dashboard.x_growth?.data.followers, 10);
  });

  test("a slug that is not in the roster is 400", async () => {
    const res = await dashboardRequest({
      section: "bot_results",
      data: { bots: [{ slug: "shadow-bot", job: "nope", recent: [] }] },
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Unknown bot: shadow-bot" });
    const office = await getOffice();
    assert.equal(office.dashboard.bot_results, null);
  });

  test("7-day and 30-day follower change uses current followers and the latest point on or before the cutoff", () => {
    const history = [
      { date: "2026-10-28", followers: 450 },
      { date: "2026-09-01", followers: 100 },
      { date: "2026-10-22", followers: 400 },
      { date: "2026-09-29", followers: 200 },
    ];
    assert.equal(followerChange(500, history, 7, "2026-10-29"), 100);
    assert.equal(followerChange(500, history, 30, "2026-10-29"), 300);
    assert.equal(followerChange(500, [{ date: "2026-10-01", followers: 300 }], 30, "2026-10-29"), null);
    assert.equal(followerChange(12, [], 7, "2026-10-29"), null);
    assert.equal(followerChange(12, [{ date: "2026-10-29", followers: 12 }], 7, "2026-10-29"), null);
    assert.equal(
      followerChange(12, [
        { date: "2026-10-22", followers: 1 },
        { date: "2026-10-22", followers: 9 },
      ], 7, "2026-10-29"),
      3,
    );
    assert.equal(followerChange(10, [{ date: "2026-02-22", followers: 7 }], 7, "2026-03-01"), 3);
    assert.equal(followerChange(10, [{ date: "2026-02-23", followers: 7 }], 7, "2026-03-01"), null);
    assert.equal(followerChange(10, [{ date: "2024-02-23", followers: 4 }], 7, "2024-03-01"), 6);
    assert.equal(followerChange(10, [{ date: "2024-02-24", followers: 4 }], 7, "2024-03-01"), null);
  });

  test("proxy lets dashboard ingest through and keeps the office read private", () => {
    const posted = proxy(new NextRequest("http://localhost/api/dashboard", { method: "POST" }));
    assert.equal(posted.headers.get("x-middleware-next"), "1");
    const closed = proxy(new NextRequest("http://localhost/api/office"));
    assert.equal(closed.status, 401);
  });

  test("report-dashboard.sh prints usage, rejects an empty stdin, and does not run the env file", async () => {
    const usage = runDashboard([], { PATH: process.env.PATH });
    assert.notEqual(usage.code, 0);
    assert.equal(usage.stdout, "usage: report-dashboard.sh <section> <json-file-or-stdin>\n");

    const empty = runDashboard(["x_advice", "-"], {
      PATH: process.env.PATH,
      BOT_OFFICE_URL: "http://127.0.0.1:9",
      BOT_OFFICE_TOKEN: "token-should-stay-hidden",
      LANG: "C.UTF-8",
    }, "");
    assert.notEqual(empty.code, 0);
    assert.equal(empty.stdout, "report failed: empty JSON\n");
    assert.equal(empty.stdout.includes("token-should-stay-hidden"), false);

    const dir = await mkdtemp(path.join(tmpdir(), "bot-office-dash-env-"));
    const marker = path.join(dir, "pwned");
    const envFile = path.join(dir, "office.env");
    const missing = path.join(dir, "missing.json");
    await writeFile(envFile, `BOT_OFFICE_URL=http://127.0.0.1:9\nBOT_OFFICE_TOKEN=$(touch ${marker})\n`);
    const leaked = runDashboard(["x_growth", "-"], {
      PATH: process.env.PATH,
      BOT_OFFICE_ENV: envFile,
      LANG: "C.UTF-8",
    }, "{}");
    assert.notEqual(leaked.code, 0);
    assert.equal(await exists(marker), false);
    assert.equal(leaked.stdout.includes("touch"), false);

    const unread = runDashboard(["x_growth", missing], {
      PATH: process.env.PATH,
      BOT_OFFICE_URL: "http://127.0.0.1:9",
      BOT_OFFICE_TOKEN: "token-should-stay-hidden",
      LANG: "C.UTF-8",
    });
    assert.match(unread.stdout, /^report failed: cannot read /);
    assert.equal(unread.stdout.includes("token-should-stay-hidden"), false);
    await rm(dir, { recursive: true, force: true });
  });
});

async function exists(file: string): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(file);
    return true;
  } catch {
    return false;
  }
}
