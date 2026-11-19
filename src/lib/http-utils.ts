import { Prisma } from "@prisma/client";
import { ServiceError } from "./invoice/service";

export function errorResponse(e: unknown) {
  if (e instanceof ServiceError) {
    return Response.json({ error: e.code, message: e.message }, { status: e.httpStatus });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
    return Response.json({ error: "NOT_FOUND", message: "Không tìm thấy" }, { status: 404 });
  }
  console.error(e);
  return Response.json({ error: "INTERNAL", message: (e as Error).message }, { status: 500 });
}
