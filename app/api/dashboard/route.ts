import { NextResponse } from "next/server";
import { MAX_DASHBOARD_BYTES, validateDashboardBody } from "@/lib/dashboard";
import { bearerToken, safeEqual } from "@/lib/session";
import { applyDashboard } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const expected = process.env.INGEST_TOKEN ?? "";
  const presented = bearerToken(req.headers.get("authorization"));
  if (!expected || !presented || !safeEqual(presented, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_DASHBOARD_BYTES) {
    return NextResponse.json({ error: "Body too large" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateDashboardBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const saved = await applyDashboard(parsed.value.section, parsed.value.data);
  return NextResponse.json({ section: parsed.value.section, ...saved });
}
