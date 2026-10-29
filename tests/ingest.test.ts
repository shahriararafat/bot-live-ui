import assert from "node:assert/strict";
import { before, beforeEach, describe, test } from "node:test";
import { POST as postStatus } from "../app/api/status/route";
import { POST as postAuth } from "../app/api/auth/route";
import { GET as getOfficeRoute } from "../app/api/office/route";
import { COOKIE_NAME, signSession, verifySession } from "../lib/session";
import { resetStoreForTests } from "../lib/store";

const TOKEN = "test-ingest-token";
const PASS = "test-passcode";

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

function statusRequest(body: unknown, token?: string | null) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token !== null) headers.set("authorization", `Bearer ${token === undefined ? TOKEN : token}`);
  return postStatus(
    new Request("http://localhost/api/status", {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("ingest and passcode", { concurrency: 1 }, () => {
describe("POST /api/status", () => {
  test("missing or wrong token is 401", async () => {
    for (const token of [null, "", "nope", "Bearer"]) {
      const res = await statusRequest({ bot: "pikachu", status: "idle" }, token);
      assert.equal(res.status, 401);
      assert.deepEqual(await res.json(), { error: "Unauthorized" });
    }

    const wrongScheme = await postStatus(
      new Request("http://localhost/api/status", {
        method: "POST",
        headers: { authorization: `Token ${TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify({ bot: "pikachu", status: "idle" }),
      }),
    );
    assert.equal(wrongScheme.status, 401);
  });

  test("rejects unknown bots, bad status, and text over 140 characters", async () => {
    const cases: Array<{ body: unknown; error: string }> = [
      { body: "{", error: "Invalid JSON" },
      { body: [], error: "Body must be a JSON object" },
      { body: { status: "idle" }, error: "bot is required" },
      { body: { bot: "  ", status: "idle" }, error: "bot is required" },
      { body: { bot: "nope", status: "idle" }, error: "Unknown bot: nope" },
      { body: { bot: "pikachu" }, error: "status is required" },
      { body: { bot: "pikachu", status: "Working" }, error: "status must be idle, working, waiting, or done" },
      { body: { bot: "pikachu", status: "working", doing: 12 }, error: "doing must be a string" },
      { body: { bot: "pikachu", status: "working", result: null }, error: "result must be a string" },
      {
        body: { bot: "pikachu", status: "working", doing: "a".repeat(141) },
        error: "doing must be 140 characters or fewer",
      },
      {
        body: { bot: "pikachu", status: "working", result: "b".repeat(141) },
        error: "result must be 140 characters or fewer",
      },
      {
        body: { bot: "pikachu", status: "working", doing: `${" ".repeat(4)}${"c".repeat(141)}` },
        error: "doing must be 140 characters or fewer",
      },
    ];

    for (const entry of cases) {
      const res = await statusRequest(entry.body);
      assert.equal(res.status, 400, JSON.stringify(entry.body));
      assert.deepEqual(await res.json(), { error: entry.error });
    }
  });

  test("stores a report and merges omitted fields", async () => {
    const created = await statusRequest({
      bot: " pikachu ",
      status: "working",
      doing: "  sorting the day  ",
      result: "agenda drafted",
      updatedAt: "1999-01-01T00:00:00.000Z",
    });
    assert.equal(created.status, 200);
    const first = await created.json();
    assert.equal(first.bot, "pikachu");
    assert.equal(first.status, "working");
    assert.equal(first.doing, "sorting the day");
    assert.equal(first.result, "agenda drafted");
    assert.notEqual(first.updatedAt, "1999-01-01T00:00:00.000Z");
    assert.equal(Number.isNaN(Date.parse(first.updatedAt)), false);
    assert.equal(first.history.length, 1);

    const kept = await statusRequest({ bot: "pikachu", status: "working", doing: "writing the note" });
    const second = await kept.json();
    assert.equal(second.doing, "writing the note");
    assert.equal(second.result, "agenda drafted");
    assert.equal(second.history.length, 2);

    const keptDoing = await statusRequest({ bot: "pikachu", status: "waiting" });
    const third = await keptDoing.json();
    assert.equal(third.status, "waiting");
    assert.equal(third.doing, "writing the note");
    assert.equal(third.result, "agenda drafted");

    const done = await statusRequest({ bot: "pikachu", status: "done", result: "note sent" });
    const fourth = await done.json();
    assert.equal(fourth.status, "done");
    assert.equal(fourth.doing, "");
    assert.equal(fourth.result, "note sent");

    const idle = await statusRequest({ bot: "pikachu", status: "idle" });
    const fifth = await idle.json();
    assert.equal(fifth.status, "idle");
    assert.equal(fifth.doing, "");
    assert.equal(fifth.result, "note sent");

    const explicit = await statusRequest({ bot: "pikachu", status: "done", doing: "left a note" });
    const sixth = await explicit.json();
    assert.equal(sixth.doing, "left a note");
    assert.equal(sixth.result, "note sent");

    const exact = await statusRequest({ bot: "buildbot", status: "working", doing: "d".repeat(140) });
    assert.equal(exact.status, 200);
    assert.equal((await exact.json()).doing.length, 140);

    const padded = await statusRequest({
      bot: "buildbot",
      status: "working",
      result: `  ${"e".repeat(140)}  `,
    });
    assert.equal((await padded.json()).result, "e".repeat(140));

    const emoji = await statusRequest({ bot: "mailguard", status: "working", doing: "📦".repeat(140) });
    assert.equal(emoji.status, 200);
    const tooMany = await statusRequest({ bot: "mailguard", status: "working", doing: "📦".repeat(141) });
    assert.equal(tooMany.status, 400);
  });

  test("keeps the last 20 history events", async () => {
    let last: { doing: string; history: Array<{ doing: string }> } = { doing: "", history: [] };
    for (let i = 0; i < 21; i += 1) {
      const res = await statusRequest({ bot: "ideaforge", status: "working", doing: `step ${i}` });
      last = await res.json();
    }
    assert.equal(last.history.length, 20);
    assert.equal(last.history[0].doing, "step 1");
    assert.equal(last.history[19].doing, "step 20");
    assert.equal(last.doing, "step 20");
  });

  test("a rejected report does not change the stored state", async () => {
    assert.equal((await statusRequest({ bot: "tubecal", status: "working", doing: "picking Friday" })).status, 200);
    assert.equal((await statusRequest({ bot: "tubecal", status: "working", doing: "nope" }, "wrong")).status, 401);
    const res = await statusRequest({ bot: "tubecal", status: "idle" });
    const body = await res.json();
    assert.equal(body.history.length, 2);
    assert.equal(body.history[0].doing, "picking Friday");
  });
});

describe("passcode gate", () => {
  test("signs an httpOnly cookie and rejects a wrong passcode", async () => {
    const wrong = await postAuth(
      new Request("http://localhost/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: "nope" }),
      }),
    );
    assert.equal(wrong.status, 401);
    assert.equal(wrong.headers.get("set-cookie"), null);

    const ok = await postAuth(
      new Request("http://localhost/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: PASS }),
      }),
    );
    assert.equal(ok.status, 200);
    const setCookie = ok.headers.get("set-cookie") ?? "";
    assert.match(setCookie, new RegExp(`${COOKIE_NAME}=`));
    assert.match(setCookie, /HttpOnly/i);
    const token = setCookie.split(";")[0].slice(COOKIE_NAME.length + 1);
    assert.equal(verifySession(token, PASS), true);

    const tampered = `${token.slice(0, -2)}aa`;
    assert.equal(verifySession(tampered, PASS), false);
    assert.equal(verifySession(signSession(PASS, Date.now() - 15 * 24 * 60 * 60 * 1000), PASS), false);
  });

  test("GET /api/office requires the signed cookie", async () => {
    const closed = await getOfficeRoute(new Request("http://localhost/api/office"));
    assert.equal(closed.status, 401);

    const bad = await getOfficeRoute(
      new Request("http://localhost/api/office", { headers: { cookie: `${COOKIE_NAME}=nope` } }),
    );
    assert.equal(bad.status, 401);

    await statusRequest({ bot: "scriptsmith", status: "done", result: "hook is ready" });
    const cookie = `${COOKIE_NAME}=${signSession(PASS)}`;
    const open = await getOfficeRoute(new Request("http://localhost/api/office", { headers: { cookie } }));
    assert.equal(open.status, 200);
    assert.equal(open.headers.get("cache-control"), "no-store");
    const body = await open.json();
    const bot = body.bots.find((entry: { slug: string }) => entry.slug === "scriptsmith");
    assert.equal(bot.result, "hook is ready");
    assert.equal(bot.displayStatus, "done");
    assert.equal(body.bots.length, 14);
  });
});
});
