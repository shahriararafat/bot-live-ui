# Bot Office

A small live floor for Shahriar's 15 assistant bots. Each bot has a desk, a pixel character, and a status light. Under the floor, four panels show X growth, X advice, bot jobs, and spending. The page polls a private read API about every 2 seconds while the tab is visible, and again as soon as the window is focused, so a new report shows up within a couple of seconds. There are no websockets.

Bots post their own status and dashboard sections. The browser never talks to Redis.

## Bots

| Slug | Name | Role |
| --- | --- | --- |
| `pikachu` | Pikachu | Chief of Staff |
| `buildbot` | BuildBot | builds apps |
| `money-kick` | Money Kick | tracks spending |
| `mailguard` | MailGuard | watches Gmail |
| `ekaceo` | EkaCEO | Eka AI co-founder |
| `x-analyst` | X Analyst | analyzes X posts |
| `x-content-manager` | X Content Manager | manages X content |
| `x-post-writer` | X Post Writer | writes X posts |
| `dr-eggbot` | dr eggbot | designs bots |
| `ideaforge` | IdeaForge | project ideas |
| `scriptsmith` | ScriptSmith | YouTube scripts |
| `packlab` | PackLab | titles and thumbnails |
| `tubescout` | TubeScout | YouTube ideas |
| `tubecal` | TubeCal | upload calendar |
| `runlog` | RunLog | running and marathon tracker |

Status is one of `idle`, `working`, `waiting`, or `done`. `waiting` means the bot is waiting on Shahriar.

## Run locally

```bash
cp .env.example .env.local
```

Set `APP_PASSCODE` and `INGEST_TOKEN` in `.env.local`. Leave the Redis variables empty. The app then keeps state in memory for this process, which is enough to run the UI and the tests. That memory is wiped when the process stops, and it is not shared across server instances, so production needs Upstash.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and enter the passcode. The session cookie is httpOnly, HMAC-signed with `APP_PASSCODE`, and lasts 14 days.

```bash
npm test
npm run lint
npm run build
```

## Post a status

`POST /api/status`

```http
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

```json
{"bot":"pikachu","status":"working","doing":"sorting the day","result":"agenda drafted"}
```

`bot` and `status` are required. `doing` and `result` are optional strings. They are trimmed, then rejected at 141 characters or more. An unknown slug or a bad status is `400` with `{ "error": "..." }`. A missing or wrong token is `401`. The token is compared in constant time. The server sets `updatedAt`.

Omitted `doing` and `result` keep their previous values. If `status` is `done` or `idle` and `doing` is omitted, `doing` is cleared. A `doing` string sent along with `done` or `idle` is stored. `result` is never cleared on its own. Each accepted report is appended to a history of the last 20 events.

```bash
curl -sS -X POST "http://localhost:3000/api/status" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"bot":"pikachu","status":"working","doing":"sorting the day"}'
```

A successful response is `200` and the stored record:

```json
{
  "bot": "pikachu",
  "status": "working",
  "doing": "sorting the day",
  "result": "",
  "updatedAt": "2026-10-29T12:00:00.000Z",
  "history": []
}
```

`GET /api/office` returns every desk for the signed-in browser. It does not accept the ingest token. If a bot's last report is 30 minutes old or older, the office shows that desk as idle, grays the character, and keeps the last result on screen. The stored status is left as it was reported. A bot that has never reported is idle, and not marked stale.

The page and `GET /api/office` are also checked in `proxy.ts` (Next.js 16's request gate, the file that used to be called middleware) and again next to the data.

## report.sh

`scripts/report.sh` is bash and curl. It uses `jq` to encode JSON when `jq` is installed, and a small escaper otherwise. It tries once, times out after 8 seconds, prints one line, and exits non-zero on failure. It does not print the token.

```bash
export BOT_OFFICE_URL=http://localhost:3000
export BOT_OFFICE_TOKEN="$INGEST_TOKEN"
./scripts/report.sh pikachu working "sorting the day" "agenda drafted"
```

`BOT_OFFICE_URL` and `BOT_OFFICE_TOKEN` can also live in a file. The default path is `/workspace/bot-office/.env`. Override it with `BOT_OFFICE_ENV`. Values already set in the environment win. The file is parsed, not executed.

```bash
# /workspace/bot-office/.env
BOT_OFFICE_URL=https://your-app.vercel.app
BOT_OFFICE_TOKEN=the-same-value-as-INGEST_TOKEN
```

```bash
./scripts/report.sh mailguard waiting "need a yes on this invoice"
```

Success looks like `ok mailguard waiting`.

## Dashboard

The floor and the dashboard share `GET /api/office`. That route stays behind the passcode. A signed-out request is `401`. `dashboard` on the payload has one key per section: `x_growth`, `x_advice`, `bot_results`, and `spending`. Each is `null` until the first accepted post, then `{ "data": ..., "updatedAt": "..." }`. The server sets `updatedAt`. A new post replaces that section and leaves the others alone. The panels update on the same poll as the desks.

`POST /api/dashboard`

```http
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json
```

The bearer check matches `POST /api/status`, including constant-time comparison. `proxy.ts` lets this path through so the token can be checked on the route. A missing or wrong token is `401`. A bad section, a bad shape, invalid JSON, or a body larger than 16KB (16384 bytes) is `400` with `{ "error": "..." }`.

`section` is one of `x_growth`, `x_advice`, `bot_results`, or `spending`. Any other field is rejected. Strings are trimmed, then counted in Unicode code points. Lists over the cap are rejected, not shortened.

An empty panel says who it is waiting on: `Waiting for X Analyst` for X growth and X advice, `Waiting for OfficeSync` for bot jobs, and `Waiting for Money Kick` for spending. A panel that has data shows `Updated` and a relative time.

### x_growth

`followers` is a number. `history` has at most 90 points: `{ "date": "YYYY-MM-DD", "followers": number }`. `topPosts` has at most 5 posts. `text` is at most 280 characters. `url` is an `https://x.com/...` link. `views` and `likes` are optional numbers.

The panel shows current followers, a plain SVG line of the history, and the posts as links. The 7-day change is current `followers` minus the newest history point dated on or before seven UTC days before the office clock. The 30-day change uses thirty days. If no history point is that old, the change is an em dash.

```json
{
  "section": "x_growth",
  "data": {
    "followers": 12840,
    "history": [
      { "date": "2026-09-29", "followers": 11000 },
      { "date": "2026-10-22", "followers": 12400 }
    ],
    "topPosts": [
      {
        "text": "SAMPLE: the hallway plant got a promotion",
        "url": "https://x.com/sample/status/1",
        "views": 12000,
        "likes": 340
      }
    ]
  }
}
```

### x_advice

`summary` is at most 500 characters. `actions` has at most 5 strings, each at most 200 characters.

```json
{
  "section": "x_advice",
  "data": {
    "summary": "SAMPLE: reply to the three people who asked about the plant desk.",
    "actions": ["SAMPLE: post the hallway photo"]
  }
}
```

### bot_results

`bots` has at most 30 entries. `slug` is one of the slugs in the table above. `job` is at most 140 characters. `recent` has at most 3 strings, each at most 140 characters. A repeated slug is rejected.

```json
{
  "section": "bot_results",
  "data": {
    "bots": [
      {
        "slug": "pikachu",
        "job": "SAMPLE: sorting the day",
        "recent": ["SAMPLE: agenda drafted"]
      }
    ]
  }
}
```

### spending

`month` is `YYYY-MM`. `currency` is `BDT`. `total` is a number. `budget` and `todaySpent` are optional numbers. `categories` has at most 12 rows: `name` (at most 40 characters) and `amount`. The panel shows the month total in ৳, today's spend when `todaySpent` was sent, a budget bar when `budget` is set, and a bar per category.

```json
{
  "section": "spending",
  "data": {
    "month": "2026-10",
    "currency": "BDT",
    "total": 48250,
    "budget": 80000,
    "todaySpent": 1260,
    "categories": [{ "name": "SAMPLE food", "amount": 14500 }]
  }
}
```

A successful response is `200` and the stored section:

```json
{
  "section": "x_advice",
  "updatedAt": "2026-10-29T12:00:00.000Z",
  "data": {
    "summary": "SAMPLE: reply once",
    "actions": ["SAMPLE: post the photo"]
  }
}
```

```bash
curl -sS -X POST "http://localhost:3000/api/dashboard" \
  -H "Authorization: Bearer $INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"section":"x_advice","data":{"summary":"SAMPLE: reply once","actions":["SAMPLE: post the photo"]}}'
```

## report-dashboard.sh

`scripts/report-dashboard.sh` posts one section. It uses the same environment as `scripts/report.sh`: `BOT_OFFICE_URL` and `BOT_OFFICE_TOKEN`, from the process or from `${BOT_OFFICE_ENV:-/workspace/bot-office/.env}`. Values already set in the environment win. The file is parsed, not executed. It tries once, times out after 8 seconds, prints one line, and does not print the token.

The JSON file is the `data` object. The script adds `section`. Pass `-` to read that JSON from stdin. With only the section argument, stdin is used too.

```bash
export BOT_OFFICE_URL=http://localhost:3000
export BOT_OFFICE_TOKEN="$INGEST_TOKEN"
./scripts/report-dashboard.sh x_growth ./x-growth.json
./scripts/report-dashboard.sh x_advice - < ./x-advice.json
```

Success looks like `ok x_growth`. Anything else prints the failure, including the server error: `report failed: HTTP 400 {"error":"Unknown bot: nope"}`.

## Deploy on Vercel

This is meant for Vercel's free tier. Do not put the Redis token or the ingest token in the client.

1. Import this GitHub repo as a Vercel project.
2. Add the Upstash Redis integration from the Vercel marketplace (Storage → Upstash, or the Upstash Redis integration). It sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. If the integration uses the older names `KV_REST_API_URL` and `KV_REST_API_TOKEN`, those work too. When both pairs are present, the `UPSTASH_REDIS_REST_*` pair is used.
3. Set `INGEST_TOKEN` and `APP_PASSCODE` in the Vercel project environment. Use a long random ingest token.
4. Deploy.

Point each bot at the deployment:

```bash
export BOT_OFFICE_URL=https://<your-app>.vercel.app
export BOT_OFFICE_TOKEN=<the INGEST_TOKEN>
./scripts/report.sh pikachu working "sorting the day"
./scripts/report-dashboard.sh spending ./spending.json
```

One person watching the floor polls about every 2 seconds, which is comfortable on the hobby plan. Redis is required in production: without it, each serverless instance keeps a private empty memory.
