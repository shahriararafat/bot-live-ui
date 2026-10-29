import { NextResponse } from "next/server";
import { COOKIE_NAME, readCookie, verifySession } from "@/lib/session";
import { getOffice } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!verifySession(readCookie(req.headers.get("cookie"), COOKIE_NAME))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const office = await getOffice();
  return NextResponse.json(office, {
    headers: { "Cache-Control": "no-store" },
  });
}
