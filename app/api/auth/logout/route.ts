import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("pitstop_auth",       "", { maxAge: 0, path: "/" });
  res.cookies.set("pitstop_owner_auth", "", { maxAge: 0, path: "/" });
  return res;
}
