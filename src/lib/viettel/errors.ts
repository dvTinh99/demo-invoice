/** Lỗi KHÔNG chắc chắn: không biết Viettel đã lập hóa đơn hay chưa (timeout, mất mạng, 5xx). */
export class ViettelAmbiguousError extends Error {
  constructor(
    message: string,
    public reason: "TIMEOUT" | "NETWORK" | "SERVER_ERROR",
  ) {
    super(message);
    this.name = "ViettelAmbiguousError";
  }
}

/** Lỗi CHẮC CHẮN: Viettel trả lỗi nghiệp vụ / 4xx => hóa đơn không được lập. */
export class ViettelBusinessError extends Error {
  constructor(
    message: string,
    public code: string,
    public httpStatus?: number,
  ) {
    super(message);
    this.name = "ViettelBusinessError";
  }
}

export class ViettelAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViettelAuthError";
  }
}
