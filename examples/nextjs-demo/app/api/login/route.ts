import { NextResponse } from "next/server";
import { isValidLogin } from "../../../lib/auth";

export async function POST(req: Request) {
  const body = (await req.json()) as { email?: string; password?: string };
  if (!body.email || !body.password || !isValidLogin(body.email, body.password)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("lookout_session", "1", { httpOnly: true, path: "/" });
  return res;
}
