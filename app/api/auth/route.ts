import { NextResponse } from "next/server";
import { COOKIE_NAME, SESSION_SECONDS, safeEqual, signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let passcode = "";
  try {
    const body = (await req.json()) as { passcode?: unknown };
    if (typeof body?.passcode === "string") passcode = body.passcode;
  } catch {
    passcode = "";
  }

  const expected = process.env.APP_PASSCODE ?? "";
  if (!expected || !safeEqual(passcode, expected)) {
    return NextResponse.json({ error: "Wrong passcode" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set({
    name: COOKIE_NAME,
    value: signSession(expected),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return res;
}
