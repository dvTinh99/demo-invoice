import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic Auth cho bản deploy công khai (bật khi đặt BASIC_AUTH_USER + BASIC_AUTH_PASSWORD).
 * Bỏ qua: Mock server (app tự gọi chính nó) và cron (có CRON_SECRET riêng).
 */
export function proxy(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) return NextResponse.next();

  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    const idx = decoded.indexOf(":");
    if (idx >= 0 && decoded.slice(0, idx) === user && decoded.slice(idx + 1) === pass) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="demo-invoice", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ["/((?!api/mock-viettel|api/cron|_next/static|_next/image|favicon.ico).*)"],
};
