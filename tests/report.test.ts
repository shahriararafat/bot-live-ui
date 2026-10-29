import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test, before, after } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts/report.sh");
const dashboardScript = path.join(root, "scripts/report-dashboard.sh");
const bash = "/bin/bash";
const TOKEN = "ingest-token-should-not-leak-9f3a";
const PASS = "passcode-test";

type ReportResult = { stdout: string; stderr: string; code: number };

async function report(args: string[], env: Record<string, string | undefined>): Promise<ReportResult> {
  try {
    const { stdout, stderr } = await execFileAsync(bash, [script, ...args], {
      env: env as NodeJS.ProcessEnv,
      encoding: "utf8",
      timeout: 20_000,
    });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
      code: typeof failed.code === "number" ? failed.code : 1,
    };
  }
}

function runDashboard(
  args: string[],
  env: Record<string, string | undefined>,
  input?: string,
): ReportResult {
  const result = spawnSync(bash, [dashboardScript, ...args], {
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

function assertNoToken(result: ReportResult) {
  assert.equal(result.stdout.includes(TOKEN), false);
  assert.equal(result.stderr.includes(TOKEN), false);
  assert.equal(result.stdout.includes(PASS), false);
}

test("report.sh prints usage and refuses to run a command from the env file", async () => {
  const usage = await report([], { PATH: process.env.PATH });
  assert.notEqual(usage.code, 0);
  assert.equal(usage.stdout, "usage: report.sh <bot-slug> <status> [doing] [result]\n");

  const dir = await mkdtemp(path.join(tmpdir(), "bot-office-env-"));
  const marker = path.join(dir, "pwned");
  const envFile = path.join(dir, "office.env");
  await writeFile(envFile, `BOT_OFFICE_URL=http://127.0.0.1:9\nBOT_OFFICE_TOKEN=$(touch ${marker})\n`);
  const leaked = await report(["pikachu", "idle"], {
    PATH: process.env.PATH,
    BOT_OFFICE_ENV: envFile,
    LANG: "C.UTF-8",
  });
  assert.notEqual(leaked.code, 0);
  assert.equal(
    await exists(marker),
    false,
  );
  assert.equal(leaked.stdout.includes("touch"), false);
  await rm(dir, { recursive: true, force: true });
});

test("report.sh gives up after the 8 second timeout", async () => {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const started = Date.now();
  const result = await report(["pikachu", "idle"], {
    PATH: process.env.PATH,
    BOT_OFFICE_URL: `http://127.0.0.1:${address.port}`,
    BOT_OFFICE_TOKEN: "timeout-token",
    LANG: "C.UTF-8",
  });
  const elapsed = Date.now() - started;
  server.close();
  assert.notEqual(result.code, 0);
  assert.match(result.stdout, /^report failed:.*\n$/);
  assert.equal(result.stdout.includes("timeout-token"), false);
  assert.ok(elapsed >= 7_000 && elapsed < 12_000, `elapsed ${elapsed}`);
});

describe("report.sh against the dev server", { timeout: 180_000 }, () => {
  let proc: ChildProcess | undefined;
  let base = "";
  let log = "";
  let shim = "";

  before(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    const env = { ...process.env };
    delete env.UPSTASH_REDIS_REST_URL;
    delete env.UPSTASH_REDIS_REST_TOKEN;
    delete env.KV_REST_API_URL;
    delete env.KV_REST_API_TOKEN;
    env.INGEST_TOKEN = TOKEN;
    env.APP_PASSCODE = PASS;
    env.NEXT_TELEMETRY_DISABLED = "1";
    proc = spawn(path.join(root, "node_modules/next/dist/bin/next"), ["dev", "-p", String(port), "-H", "127.0.0.1"], {
      cwd: root,
      env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.stdout?.on("data", (chunk) => {
      log += chunk.toString();
    });
    proc.stderr?.on("data", (chunk) => {
      log += chunk.toString();
    });
    await waitForLogin(base, () => proc?.exitCode ?? null, () => log);

    shim = await mkdtemp(path.join(tmpdir(), "bot-office-path-"));
    const curl = (await execFileAsync("which", ["curl"], { encoding: "utf8" })).stdout.trim();
    await mkdir(path.join(shim, "bin"));
    await symlink(curl, path.join(shim, "bin/curl"));
  }, { timeout: 120_000 });

  after(async () => {
    if (proc?.pid) {
      try {
        process.kill(-proc.pid, "SIGTERM");
      } catch {
        proc.kill("SIGTERM");
      }
    }
    if (shim) await rm(shim, { recursive: true, force: true });
  });

  test("gates the page and read API, and posts through report.sh", async () => {
    const home = await fetch(`${base}/`, { redirect: "manual" });
    assert.ok([301, 302, 303, 307, 308].includes(home.status), `home ${home.status}`);
    assert.match(home.headers.get("location") ?? "", /\/login$/);

    const office = await fetch(`${base}/api/office`);
    assert.equal(office.status, 401);

    const loginPage = await fetch(`${base}/login`);
    assert.equal(loginPage.status, 200);

    const denied = await fetch(`${base}/api/status`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bot: "pikachu", status: "idle" }),
    });
    assert.equal(denied.status, 401);

    const doing = 'say "hi" \\ there';
    const posted = await report(["mailguard", "working", doing, "line\ntwo"], {
      PATH: process.env.PATH,
      BOT_OFFICE_URL: base,
      BOT_OFFICE_TOKEN: TOKEN,
      LANG: "C.UTF-8",
    });
    assert.equal(posted.code, 0, posted.stdout + posted.stderr);
    assert.equal(posted.stdout, "ok mailguard working\n");
    assertNoToken(posted);

    const kept = await report(["mailguard", "working"], {
      PATH: process.env.PATH,
      BOT_OFFICE_URL: `${base}/`,
      BOT_OFFICE_TOKEN: TOKEN,
      LANG: "C.UTF-8",
    });
    assert.equal(kept.code, 0, kept.stdout);
    assert.equal(kept.stdout, "ok mailguard working\n");

    const fallback = await report(["pikachu", "waiting", 'need a "yes"', "ready"], {
      PATH: path.join(shim, "bin"),
      BOT_OFFICE_URL: base,
      BOT_OFFICE_TOKEN: TOKEN,
      LANG: "C.UTF-8",
    });
    assert.equal(fallback.code, 0, `${fallback.stdout}\n${fallback.stderr}`);
    assert.equal(fallback.stdout, "ok pikachu waiting\n");
    assertNoToken(fallback);

    const bad = await report(["not-a-bot", "idle"], {
      PATH: process.env.PATH,
      BOT_OFFICE_URL: base,
      BOT_OFFICE_TOKEN: TOKEN,
    });
    assert.notEqual(bad.code, 0);
    assert.match(bad.stdout, /^report failed: HTTP 400 /);
    assert.equal(bad.stdout.trim().split("\n").length, 1);
    assertNoToken(bad);

    const wrong = await report(["pikachu", "idle"], {
      PATH: process.env.PATH,
      BOT_OFFICE_URL: base,
      BOT_OFFICE_TOKEN: "wrong-token",
    });
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.stdout, /HTTP 401/);
    assert.equal(wrong.stdout.includes(TOKEN), false);
    assert.equal(wrong.stdout.includes("wrong-token"), false);

    const dir = await mkdtemp(path.join(tmpdir(), "bot-office-file-"));
    const envFile = path.join(dir, ".env");
    await writeFile(envFile, `export BOT_OFFICE_URL="${base}"\nBOT_OFFICE_TOKEN='${TOKEN}'\n`);
    const fromFile = await report(["ekaceo", "done", "", "pitch notes filed"], {
      PATH: process.env.PATH,
      BOT_OFFICE_ENV: envFile,
      LANG: "C.UTF-8",
    });
    assert.equal(fromFile.code, 0, fromFile.stdout + fromFile.stderr);
    assert.equal(fromFile.stdout, "ok ekaceo done\n");
    assertNoToken(fromFile);
    await rm(dir, { recursive: true, force: true });

    const login = await fetch(`${base}/api/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: PASS }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(cookie);
    const board = await fetch(`${base}/api/office`, { headers: { cookie } });
    assert.equal(board.status, 200);
    const body = (await board.json()) as {
      bots: Array<{ slug: string; status: string; doing: string; result: string }>;
    };
    const mail = body.bots.find((bot) => bot.slug === "mailguard");
    const pika = body.bots.find((bot) => bot.slug === "pikachu");
    const eka = body.bots.find((bot) => bot.slug === "ekaceo");
    assert.equal(mail?.status, "working");
    assert.equal(mail?.doing, doing);
    assert.equal(mail?.result, "line\ntwo");
    assert.equal(pika?.status, "waiting");
    assert.equal(pika?.doing, 'need a "yes"');
    assert.equal(pika?.result, "ready");
    assert.equal(eka?.status, "done");
    assert.equal(eka?.doing, "");
    assert.equal(eka?.result, "pitch notes filed");
  });

  test("posts dashboard sections through report-dashboard.sh", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "bot-office-dash-"));
    const growthFile = path.join(dir, "growth.json");
    const spendFile = path.join(dir, "spend.json");
    const botsFile = path.join(dir, "bots.json");
    const envFile = path.join(dir, ".env");
    await writeFile(
      growthFile,
      JSON.stringify({
        followers: 42,
        history: [{ date: "2026-10-01", followers: 40 }],
        topPosts: [{ text: 'SAMPLE "post"', url: "https://x.com/sample/status/1", views: 3 }],
      }),
    );
    await writeFile(
      spendFile,
      JSON.stringify({
        month: "2026-10",
        currency: "BDT",
        total: 12,
        categories: [{ name: 'SAMPLE "food"', amount: 12 }],
      }),
    );
    await writeFile(
      botsFile,
      JSON.stringify({
        bots: [{ slug: "money-kick", job: "SAMPLE job", recent: ["SAMPLE result"] }],
      }),
    );
    await writeFile(envFile, `export BOT_OFFICE_URL="${base}/"\nBOT_OFFICE_TOKEN='${TOKEN}'\n`);

    const env = {
      PATH: process.env.PATH,
      BOT_OFFICE_URL: base,
      BOT_OFFICE_TOKEN: TOKEN,
      LANG: "C.UTF-8",
    };

    const growth = runDashboard(["x_growth", growthFile], env);
    assert.equal(growth.code, 0, growth.stdout + growth.stderr);
    assert.equal(growth.stdout, "ok x_growth\n");
    assertNoToken(growth);

    const advice = runDashboard(
      ["x_advice", "-"],
      env,
      JSON.stringify({ summary: "SAMPLE advice", actions: ["SAMPLE: post it"] }),
    );
    assert.equal(advice.code, 0, advice.stdout + advice.stderr);
    assert.equal(advice.stdout, "ok x_advice\n");

    const spending = runDashboard(["spending", spendFile], {
      PATH: path.join(shim, "bin"),
      BOT_OFFICE_URL: base,
      BOT_OFFICE_TOKEN: TOKEN,
      LANG: "C.UTF-8",
    });
    assert.equal(spending.code, 0, `${spending.stdout}\n${spending.stderr}`);
    assert.equal(spending.stdout, "ok spending\n");
    assertNoToken(spending);

    const bots = runDashboard(["bot_results", botsFile], {
      PATH: process.env.PATH,
      BOT_OFFICE_ENV: envFile,
      LANG: "C.UTF-8",
    });
    assert.equal(bots.code, 0, bots.stdout + bots.stderr);
    assert.equal(bots.stdout, "ok bot_results\n");
    assertNoToken(bots);

    const bad = runDashboard(["nope", growthFile], env);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stdout, /^report failed: HTTP 400 /);
    assert.equal(bad.stdout.trim().split("\n").length, 1);
    assertNoToken(bad);

    const wrong = runDashboard(["x_growth", growthFile], { ...env, BOT_OFFICE_TOKEN: "wrong-token" });
    assert.notEqual(wrong.code, 0);
    assert.match(wrong.stdout, /HTTP 401/);
    assert.equal(wrong.stdout.includes(TOKEN), false);
    assert.equal(wrong.stdout.includes("wrong-token"), false);

    const login = await fetch(`${base}/api/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: PASS }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(cookie);
    const board = await fetch(`${base}/api/office`, { headers: { cookie } });
    assert.equal(board.status, 200);
    const body = (await board.json()) as {
      dashboard: {
        x_growth: { data: { followers: number; topPosts: Array<{ text: string }> } };
        x_advice: { data: { summary: string; actions: string[] } };
        spending: { data: { total: number; categories: Array<{ name: string }> } };
        bot_results: { data: { bots: Array<{ slug: string; job: string; recent: string[] }> } };
      };
    };
    assert.equal(body.dashboard.x_growth.data.followers, 42);
    assert.equal(body.dashboard.x_growth.data.topPosts[0].text, 'SAMPLE "post"');
    assert.equal(body.dashboard.x_advice.data.summary, "SAMPLE advice");
    assert.equal(body.dashboard.x_advice.data.actions[0], "SAMPLE: post it");
    assert.equal(body.dashboard.spending.data.total, 12);
    assert.equal(body.dashboard.spending.data.categories[0].name, 'SAMPLE "food"');
    assert.equal(body.dashboard.bot_results.data.bots[0].slug, "money-kick");
    assert.equal(body.dashboard.bot_results.data.bots[0].job, "SAMPLE job");
    assert.equal(body.dashboard.bot_results.data.bots[0].recent[0], "SAMPLE result");

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

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("no port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForLogin(url: string, exitCode: () => number | null, logs: () => string) {
  const started = Date.now();
  let last = "";
  while (Date.now() - started < 90_000) {
    if (exitCode() !== null) {
      throw new Error(`dev server exited ${exitCode()}\n${logs()}`);
    }
    try {
      const res = await fetch(`${url}/login`);
      if (res.status === 200) return;
      last = `status ${res.status}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`dev server not ready: ${last}\n${logs()}`);
}
