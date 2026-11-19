import { config } from "@/lib/config";
import { logEvent } from "@/lib/logger";
import { expireLocalToken, getAccessToken, getTokenInfo } from "@/lib/viettel/token";

/**
 * Công cụ demo cho token:
 *  - refresh        : buộc login lại
 *  - expire-local   : đánh dấu token local hết hạn → lần gọi sau tự refresh chủ động
 *  - revoke-server  : (Mock) thu hồi token phía server → lần gọi sau nhận 401 → interceptor retry
 */
export async function POST(req: Request) {
  const { action } = await req.json().catch(() => ({}));
  try {
    if (action === "refresh") {
      await getAccessToken({ force: true, reason: "manual refresh" });
    } else if (action === "expire-local") {
      await expireLocalToken();
      await logEvent(null, "Demo: token local bị đánh dấu hết hạn");
    } else if (action === "revoke-server") {
      if (!config.mockMode) return Response.json({ message: "Chỉ dùng ở Mock Mode" }, { status: 400 });
      await fetch(`${config.baseUrl}/__admin/revoke-tokens`, { method: "POST" });
      await logEvent(null, "Demo: Mock server thu hồi toàn bộ token (token local vẫn còn trong cache)");
    } else {
      return Response.json({ message: "action không hợp lệ" }, { status: 400 });
    }
    return Response.json({ token: await getTokenInfo() });
  } catch (e) {
    return Response.json({ message: (e as Error).message }, { status: 502 });
  }
}
