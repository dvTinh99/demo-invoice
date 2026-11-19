# Viettel S-Invoice 2.0 Integration Demo (POC)

Ứng dụng demo quy trình xuất Hóa đơn điện tử Viettel S-Invoice 2.0 qua REST API. Phần triển khai bám theo tài liệu **"Mô tả webservice hóa đơn điện tử đối tác v2.50"** (`docs/tailieu_mo_ta_webservice_hoadondientu_doitac_v2.50_public-*.docx`). Số mục ghi trong README là số mục của tài liệu này.

Ứng dụng có sẵn các cơ chế production cơ bản:

- **Token tự động** (mục 5.5, cách 2): gọi `POST /auth/login`, rồi gửi kèm header `Cookie: access_token=...`. Token được cache trong memory và DB, refresh trước khi hết hạn 60s. Nhiều request đồng thời chỉ login 1 lần.
- **Interceptor token hết hạn**: xử lý cả `401` và `500 {"message":"GENERAL"}` (mục 8: Viettel báo token hết hạn theo cách này). Interceptor login lại và retry đúng 1 lần.
- **Chống xuất trùng** (mục 5.3): header `Idempotency-Key` + unique constraint + hash payload. Mỗi hóa đơn có một `transactionUuid` (UUID v4) cố định cho mọi lần gửi lại và đối soát. Khóa `PROCESSING` trong DB ngăn 2 request cùng `transactionUuid` chạy đồng thời.
- **Đối soát** (mục 7.21, bắt buộc): khi gặp timeout, lỗi mạng hoặc 5xx, hệ thống tra cứu `searchInvoiceByTransactionUuid` trước khi gửi lại. Hệ thống chỉ gửi lại khi Viettel xác nhận chưa có hóa đơn **và** đã qua ≥ 90s kể từ lần gửi trước.
- **Xử lý bất đồng bộ**: khi `invoiceNo` trả về rỗng, hóa đơn chuyển sang `AWAITING_NUMBER`. Sau đó hệ thống tra cứu lại để lấy số, không gửi lại.
- **Mock Mode**: Mock server nội bộ có cùng endpoint, định dạng response, ràng buộc dữ liệu và mã lỗi như tài liệu.
- **Log kỹ thuật**: ghi mọi request/response ra Viettel (đã che password và token), hiển thị dạng timeline theo từng hóa đơn.

Tech stack: Next.js 16 (App Router) · TypeScript · Prisma 6 + PostgreSQL 17 · Tailwind CSS 4 · native `fetch` · Docker Compose (Postgres + pgAdmin).

## Chạy nhanh

Yêu cầu: Node.js 22 và Docker (có Compose v2).

```bash
npm install
npm run setup      # tạo .env (nếu chưa có), bật Postgres bằng Docker, chạy migration
npm run dev        # http://localhost:3000 — mỗi lần chạy đều tự bật DB + migrate (xem bên dưới)
```

Mặc định `VIETTEL_MOCK_MODE=true`, không cần tài khoản Viettel.

## Docker Compose

| Service   | Image                  | Cổng host | Ghi chú |
| --------- | ---------------------- | --------- | ------- |
| `db`      | `postgres:17-alpine`   | `5432`    | user / pass / db: `invoice` / `invoice` / `invoice`, dữ liệu trong volume `pgdata` |
| `pgadmin` | `dpage/pgadmin4`       | `5050`    | http://localhost:5050, không cần đăng nhập, đã đăng ký sẵn server **demo-invoice** (không phải nhập mật khẩu) |
| `app`     | build từ `Dockerfile`  | `3000`    | Tùy chọn (profile `app`), chạy app production trong Docker |

```bash
npm run db:up                                  # chỉ Postgres + pgAdmin (dùng khi dev bằng npm run dev)
docker compose --profile app up -d --build     # chạy thêm app trong Docker (cần tắt npm run dev hoặc đặt APP_PORT=3001)
npm run db:down                                # dừng tất cả (giữ dữ liệu)
docker compose down -v                         # dừng và XÓA dữ liệu Postgres/pgAdmin
```

Cổng và thông tin đăng nhập có thể đổi bằng biến môi trường khi chạy compose: `POSTGRES_PORT`, `PGADMIN_PORT`, `APP_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`. Nếu đổi user/mật khẩu DB, cần cập nhật cả `DATABASE_URL` trong `.env`, `docker/pgadmin/servers.json` và `docker/pgadmin/pgpass`.

- Service `app` đọc biến môi trường từ `.env`, nhưng ghi đè `DATABASE_URL` để trỏ tới host `db`. Khi khởi động, nó chạy `prisma migrate deploy`.
- pgAdmin chạy ở chế độ desktop (`SERVER_MODE=False`) cho tiện khi dev. **Không** mở cổng 5050 ra ngoài internet.
- Bảng trong pgAdmin: `Servers → demo-invoice → Databases → invoice → Schemas → public → Tables` (`Invoice`, `ApiLog`, `TokenCache`, `MockInvoice`, `MockToken`). Tên bảng có chữ hoa, nên khi viết SQL cần đặt trong ngoặc kép, vd `select * from "Invoice";`.

## Database migration

Schema được quản lý bằng Prisma Migrate. Migration nằm trong `prisma/migrations/`.

Mỗi lần chạy `npm run dev`, script `predev` tự chạy trước:

```
docker compose up -d --wait db   # bật Postgres nếu chưa chạy, chờ healthy
prisma migrate deploy            # áp dụng các migration chưa chạy (không tạo migration mới, không xóa dữ liệu)
prisma generate                  # cập nhật Prisma Client
```

Khi đổi `prisma/schema.prisma`:

```bash
npm run db:migrate -- --name ten_thay_doi   # tạo file migration mới + áp dụng vào DB dev
```

Sau đó commit thư mục `prisma/migrations/`. Người khác chỉ cần `npm run dev` là DB của họ được cập nhật.

| Script | Lệnh | Dùng khi |
| --- | --- | --- |
| `npm run db:migrate` | `prisma migrate dev` | Tạo migration mới từ thay đổi schema (dev) |
| `npm run db:deploy` | `prisma migrate deploy` | Chỉ áp dụng migration có sẵn (CI / production) |
| `npm run db:status` | `prisma migrate status` | Xem migration nào đã/chưa chạy |

> Nếu đổi schema trong khi `npm run dev` đang chạy, cần **khởi động lại** dev server. Dev server cache Prisma Client trong bộ nhớ.

## Kết nối hệ thống test của Viettel

Sửa `.env` (giải thích từng biến xem trong `.env.example`):

```env
VIETTEL_MOCK_MODE=false
VIETTEL_BASE_URL=https://api-vinvoice.viettel.vn
VIETTEL_USERNAME=0100109106-xxx        # tài khoản test (mục 5.5), mật khẩu do đầu mối tích hợp Viettel cấp
VIETTEL_PASSWORD=...
VIETTEL_SUPPLIER_TAX_CODE=...          # [0-9-], ≤ 20 ký tự
VIETTEL_TEMPLATE_CODE=1/001            # mẫu số đã khai báo trên vinvoice.viettel.vn, ≤ 20 ký tự
VIETTEL_INVOICE_SERIES=C24TAA          # ký hiệu [a-zA-Z0-9/], ≤ 25 ký tự
VIETTEL_INVOICE_TYPE=1                 # TT78: 1-6
VIETTEL_TIMEOUT_MS=90000               # tài liệu khuyến nghị 60-90s; app ép tối thiểu 60s
```

Lưu ý:
- Trước khi gọi API, doanh nghiệp phải khai báo mẫu hóa đơn, dải hóa đơn, thông báo phát hành và chứng thư số trên web SInvoice (mục 3). Nếu không, Viettel trả `INVOICE_SERIAL_NOT_FOUND` hoặc `500 NullPointerException`.
- Trong ví dụ của tài liệu, MST người bán trùng với username (vd `0100109106-712`).
- Dashboard kiểm tra cấu hình theo ràng buộc của tài liệu và hiển thị lỗi nếu có. Request xuất hóa đơn bị chặn (`500 CONFIG_INVALID`) khi cấu hình sai.

## Đối chiếu yêu cầu tài liệu → triển khai

| Tài liệu | Yêu cầu | Triển khai |
| --- | --- | --- |
| 5.3 Cơ chế kiểm trùng | `transactionUuid` duy nhất cho mỗi hóa đơn, gửi lại cùng uuid sẽ trả về hóa đơn cũ | UUID v4 sinh 1 lần, lưu DB, dùng lại cho mọi lần gửi |
| 5.3 | Chờ phản hồi hoặc timeout **≥ 90s** mới gửi lại cùng uuid | `minResendGapMs` = max(90s, timeout); vi phạm thì trả `409 RESEND_TOO_EARLY` |
| 5.3 | **2 request đồng thời cùng uuid sẽ tạo 2 hóa đơn** | Khóa `PROCESSING` + claim nguyên tử `updateMany` trong DB |
| 5.5 | Xác thực token qua `Cookie: access_token=...` | `viettel/token.ts`, `viettel/http.ts` |
| 7.1 | Timeout khuyến nghị 60–90s | Mặc định 90s, tối thiểu 60s |
| 7.2 | `invoiceNo: ""` do xử lý bất đồng bộ, tra cứu lại sau 30–90s | Trạng thái `AWAITING_NUMBER` + job đối soát |
| 7.2 | Lỗi dạng `{code, message, data}` hoặc `{errorCode, description}` | `parseError()` trong `viettel/api.ts` |
| 7.3 | Lấy file sau 2–5s kể từ khi phát hành; `fileType` = PDF/ZIP; `fileToBytes` base64 | Route PDF/ZIP chờ đủ 3s sau `issuedAt` |
| 7.21 | Tra cứu theo `transactionUuid` (form-urlencoded), **bắt buộc** | `searchByTransactionUuid()`. Nếu tra cứu có lỗi thì giữ `UNKNOWN`, không coi là "không tìm thấy" |
| 6 · generalInvoiceInfo | `templateCode`, `invoiceSeries`, `currencyCode`, `paymentStatus`, `transactionUuid` bắt buộc | `invoiceIssuedDate` để trống, Viettel tự lấy giờ GMT+7, tránh lỗi trình tự ngày lập |
| 6 · buyerInfo | Cần tên người mua **hoặc** tên đơn vị, và địa chỉ, khi `buyerNotGetInvoice = 0`. Có MST thì bắt buộc `buyerLegalName`. Nhiều email cách nhau bởi `;` | `validateInput()` + checkbox "Người mua không lấy hóa đơn" |
| 6 · payments | `paymentMethodName` bắt buộc, map theo `paymentMethod` 1–9; mã 5 (KHAC) cho nhập tự do | Danh mục `PAYMENT_METHODS` |
| 6 · itemInfo | `quantity × unitPrice` lệch ≤ 5đ so với `itemTotalAmountWithoutTax`; thuế suất `-2` KCT, `-1` KKKNT, `0/5/8/10` | Tính và làm tròn server-side, danh mục `TAX_RATES` |
| 6 · taxBreakdowns | Mỗi mức thuế xuất hiện 1 lần | Gom nhóm theo `taxPercentage` |
| 6 · summarizeInfo | `totalAmountWithoutTax`, `discountAmount` bắt buộc | Có; kèm số tiền bằng chữ |
| 8 | Bộ mã lỗi hay gặp | Mock trả đúng: `VAT_PERCENTAGE_INVALID`, `VAT_AMOUNT_INVALID`, `VAT_TAX_AMOUNT_NEGATE`, `IVI_TOTAL_A_WITHOUT_TAX_AND_UP_QUAN_NOT_COMPARED`, `INVOICE_SERIAL_NOT_FOUND`, `JSON_PARSE_ERROR`, `500 GENERAL` |

## Kiến trúc

```
src/
├── lib/
│   ├── config.ts               # env, validateConfig(), đường dẫn API, kịch bản mock
│   ├── viettel/
│   │   ├── token.ts            # token manager: cache memory+DB, refresh sớm, single-flight
│   │   ├── http.ts             # interceptor: Cookie access_token, timeout, retry 401/500 GENERAL, ghi log
│   │   ├── api.ts              # createInvoice / searchByTransactionUuid / getInvoiceFile
│   │   └── errors.ts           # Ambiguous (cần đối soát) vs Business/Auth (chắc chắn thất bại)
│   ├── invoice/
│   │   ├── constants.ts        # danh mục thuế suất, hình thức thanh toán (dùng chung client/server)
│   │   ├── payload.ts          # validate input + dựng payload theo mục 6
│   │   ├── service.ts          # máy trạng thái: issue / replay / submit / reconcile / retry
│   │   └── number-to-words.ts  # đọc số tiền bằng chữ
│   └── mock/                   # Mock Viettel server (validate + mã lỗi mục 8), PDF, ZIP
└── app/
    ├── api/invoices/...        # REST API của hệ thống tích hợp
    ├── api/mock-viettel/[...path]  # Mock server (chỉ hoạt động khi MOCK_MODE=true)
    └── (UI) /, /invoices/new, /invoices/[id], /logs
```

### Trạng thái hóa đơn

| Trạng thái        | Ý nghĩa                                                        | Hành động cho phép                         |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `PROCESSING`      | Đang gửi `createInvoice` (giữ khóa)                            | Không có (request khác nhận 409)           |
| `ISSUED`          | Đã có số hóa đơn                                               | Xem PDF / tải ZIP                          |
| `AWAITING_NUMBER` | Viettel đã nhận nhưng trả `invoiceNo: ""` (xử lý bất đồng bộ) | Chỉ đối soát, **không gửi lại**            |
| `FAILED`          | Viettel từ chối (lỗi nghiệp vụ / xác thực), chắc chắn chưa lập | Gửi lại                                    |
| `UNKNOWN`         | Timeout / lỗi mạng / 5xx, chưa biết Viettel đã lập hay chưa    | Đối soát → gửi lại nếu không thấy và đã qua ≥ 90s |

### Luồng xuất hóa đơn

```
POST /api/invoices  (Idempotency-Key: K)
  ├─ K đã tồn tại?
  │    ├─ payload khác  → 422 IDEMPOTENCY_KEY_REUSED
  │    ├─ PROCESSING    → 409 IN_PROGRESS
  │    ├─ UNKNOWN / AWAITING_NUMBER → đối soát rồi trả kết quả (200, replayed)
  │    └─ ISSUED / FAILED → trả kết quả cũ (200, Idempotent-Replayed: true)
  └─ chưa tồn tại → INSERT (unique K, transactionUuid mới, PROCESSING)
       └─ createInvoice
            ├─ OK + invoiceNo        → ISSUED
            ├─ OK + invoiceNo rỗng   → AWAITING_NUMBER
            ├─ 4xx / errorCode       → FAILED
            └─ timeout / mạng / 5xx  → UNKNOWN → searchInvoiceByTransactionUuid
                                         ├─ tìm thấy     → ISSUED
                                         ├─ không thấy  → UNKNOWN (NOT_FOUND_ON_VIETTEL, gửi lại được sau ≥ 90s)
                                         └─ tra cứu lỗi → giữ UNKNOWN
```

## Kịch bản Mock

Chọn ở trang **Tạo hóa đơn**. Mỗi kịch bản chỉ xảy ra **1 lần cho mỗi transactionUuid**, nên lần gửi lại hoặc đối soát sau đó đi theo luồng bình thường. Trong Mock Mode, timeout là 5s và khoảng chờ gửi lại cũng là 5s, để demo nhanh.

| Kịch bản            | Mô phỏng                                                          | Kết quả mong đợi                           |
| ------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| `success`           | Thành công                                                        | `ISSUED`                                   |
| `token_expired`     | Server thu hồi token → `401`                                      | Tự login lại, retry → `ISSUED`             |
| `token_general_500` | `500 {"message":"GENERAL"}`, cách Viettel thật báo token hết hạn  | Tự login lại, retry → `ISSUED`             |
| `async_number`      | Trả `invoiceNo: ""`, số có sau ~8s                                 | `AWAITING_NUMBER` → đối soát → `ISSUED`    |
| `timeout_created`   | Đã lập hóa đơn nhưng phản hồi chậm hơn timeout                    | `UNKNOWN` → đối soát tìm thấy → `ISSUED`   |
| `timeout_lost`      | Phản hồi chậm hơn timeout, không lập hóa đơn                      | `UNKNOWN` (not found) → Gửi lại → `ISSUED` |
| `business_error`    | `400 {"code":400,"message":"INVOICE_SERIAL_NOT_FOUND",...}`       | `FAILED` → Gửi lại → `ISSUED`              |

Ngoài các kịch bản trên, Mock luôn kiểm tra payload theo mục 6 và mục 8. Ví dụ: thuế suất 7% trả `VAT_PERCENTAGE_INVALID`; `quantity × unitPrice` lệch quá 5đ trả `IVI_TOTAL_A_WITHOUT_TAX_AND_UP_QUAN_NOT_COMPARED`. Số hóa đơn Mock có dạng `<ký hiệu><số thứ tự>` (vd `C26THI7`), giống ví dụ trong tài liệu.

Các công cụ demo khác trên Dashboard:
- **Hết hạn local**: token local hết hạn, lần gọi sau tự refresh chủ động.
- **Thu hồi phía server**: token local vẫn "còn hạn", nhưng server trả 401, interceptor xử lý.
- **Test double-submit**: bắn 3 request song song cùng key. Kết quả là 1 request `201` và 2 request `409`, chỉ 1 hóa đơn được lập.

## REST API

| Method | Path                           | Mô tả                                                     |
| ------ | ------------------------------ | --------------------------------------------------------- |
| POST   | `/api/invoices`                | Xuất hóa đơn. Header `Idempotency-Key` (8–128 ký tự) bắt buộc. Body `{ input, mockScenario? }` |
| GET    | `/api/invoices`                | Danh sách                                                 |
| GET    | `/api/invoices/:id`            | Chi tiết kèm log                                          |
| POST   | `/api/invoices/:id/reconcile`  | Đối soát theo transactionUuid                             |
| POST   | `/api/invoices/:id/retry`      | Gửi lại (với `UNKNOWN`: kiểm tra ≥ 90s và đối soát trước) |
| GET    | `/api/invoices/:id/pdf[?type=ZIP]` | Bản thể hiện PDF hoặc gói ZIP (`getInvoiceRepresentationFile`) |
| POST   | `/api/reconcile`               | Job đối soát hàng loạt (`UNKNOWN`, `AWAITING_NUMBER`, `PROCESSING` bị treo). Nên gắn cron. |
| GET    | `/api/status`                  | Cấu hình, lỗi cấu hình, trạng thái token, thống kê        |
| GET    | `/api/logs?kind=&limit=`       | Log kỹ thuật                                              |

`input`:

| Trường | Bắt buộc | Ghi chú |
| --- | --- | --- |
| `orderRef` | ✔ | Mã đơn hàng nội bộ |
| `buyer.name` / `buyer.legalName` | 1 trong 2 (khi lấy hóa đơn) | `legalName` bắt buộc nếu có `taxCode` |
| `buyer.taxCode` | | `0312770607` hoặc `0312770607-001` |
| `buyer.address` | ✔ (khi lấy hóa đơn) | |
| `buyer.email`, `buyer.phone` | | email nhiều địa chỉ cách nhau bởi `;`, phone ≤ 15 ký tự |
| `buyer.notGetInvoice` | | `true` → `buyerNotGetInvoice = 1` |
| `paymentMethod` | ✔ | `"1"`–`"9"` (1 TM, 2 CK, 3 TM/CK, 4 DTCN, 5 KHAC, 6 Tiền mặt, 7 Chuyển khoản, 8 Tiền mặt/Chuyển khoản, 9 Thẻ quốc tế) |
| `paymentMethodName` | | Chỉ dùng khi `paymentMethod = "5"` |
| `paid` | | Mặc định `true` → `paymentStatus` |
| `note` | | `invoiceNote`, ≤ 500 ký tự |
| `items[]` | ✔ | `name`, `unit`, `quantity`, `unitPrice`, `taxPercentage` ∈ {-2, -1, 0, 5, 8, 10}, tùy chọn `code`, `note` |

Ví dụ:

```bash
curl -X POST http://localhost:3000/api/invoices \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-123-invoice' \
  -d '{"input":{"orderRef":"DH-123","buyer":{"name":"Nguyễn Văn An","legalName":"Công ty TNHH An Phát","taxCode":"0312770607","address":"Q1, HCM"},"paymentMethod":"3","paid":true,"items":[{"name":"Laptop","unit":"Chiếc","quantity":1,"unitPrice":18500000,"taxPercentage":10}]}}'
```

## Giới hạn của POC (cần bổ sung khi lên production)

- **Phạm vi nghiệp vụ**: chỉ hỗ trợ hóa đơn gốc (`adjustmentType = 1`), hàng hóa thường (`selection = 1`), tiền VND, chữ ký số **HSM** (API 7.2). Chưa làm:
  - hóa đơn thay thế/điều chỉnh (mục 7.2 với `adjustmentType` 3/5);
  - hủy hóa đơn (7.10), lập nháp (7.8);
  - luồng USB-Token/CloudCA (7.15–7.16, 7.31–7.32);
  - chiết khấu, ngoại tệ, trường động (`metadata`), hàng hóa đặc thù (`specialInfo`).
- **Xác thực**: chỉ dùng cách 2 (token). Tài liệu còn hỗ trợ Basic Auth và API Key (`APP-KID`, `X-KID`, `X-API-KEY`).
- **Bảo mật API nội bộ**: chưa có xác thực/phân quyền. `/api/admin/reset` và `/api/token` chỉ dùng cho demo.
- **Nhiều instance**: khóa `PROCESSING` nằm trong DB nên vẫn đúng. Tuy nhiên token single-flight chỉ áp dụng trong 1 process. Nên dùng Redis lock, hoặc chấp nhận mỗi instance login riêng.
- **Job đối soát**: đang gọi thủ công. Production nên chạy cron 1–5 phút/lần (tài liệu đề xuất quét lại hóa đơn chưa có số sau 30–90s).
- **Docker**: image `app` copy toàn bộ `node_modules` cho đơn giản. Production nên build Next.js `output: "standalone"` để image gọn hơn.
