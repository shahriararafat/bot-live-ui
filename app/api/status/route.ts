import { NextResponse } from "next/server";
import { bearerToken, safeEqual } from "@/lib/session";
import { applyUpdate } from "@/lib/store";
import { validateStatusBody } from "@/lib/validate";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const expected = process.env.INGEST_TOKEN ?? "";
  const presented = bearerToken(req.headers.get("authorization"));
  if (!expected || !presented || !safeEqual(presented, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = validateStatusBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const saved = await applyUpdate(parsed.value);
  return NextResponse.json({ bot: parsed.value.bot, ...saved });
}
