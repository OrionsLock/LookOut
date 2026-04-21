import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/dashboard")) return NextResponse.next();
  if (req.cookies.get("lookout_session")?.value === "1") return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/dashboard/:path*"] };
