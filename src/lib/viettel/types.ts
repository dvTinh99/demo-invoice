export interface ViettelLoginResponse {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  expires_in: number;
  [k: string]: unknown;
}

/** Dạng lỗi thứ 2 của Viettel: {"code":400,"message":"BAD_REQUEST_...","data":"..."} */
export interface ViettelErrorEnvelope {
  code?: number;
  message?: string;
  data?: unknown;
  error?: string;
}

export interface ViettelCreateInvoiceResponse extends ViettelErrorEnvelope {
  errorCode: string | null;
  description: string | null;
  result?: {
    supplierTaxCode: string;
    invoiceNo: string;
    transactionID: string;
    reservationCode: string;
    codeOfTax?: string | null;
  } | null;
}

export interface ViettelSearchItem {
  invoiceNo?: string;
  transactionID?: string;
  reservationCode?: string;
  issueDate?: number | string;
  status?: string;
  exchangeStatus?: string;
  exchangeDes?: string;
  codeOfTax?: string | null;
  [k: string]: unknown;
}

export interface ViettelSearchResponse extends ViettelErrorEnvelope {
  errorCode: string | null;
  description: string | null;
  result?: ViettelSearchItem[] | ViettelSearchItem | null;
}

export interface ViettelFileResponse extends ViettelErrorEnvelope {
  errorCode: string | null;
  description: string | null;
  fileName?: string;
  fileToBytes?: string;
}
