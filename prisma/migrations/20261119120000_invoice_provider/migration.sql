-- Nhà cung cấp hóa đơn của từng bản ghi (viettel | sepay)
ALTER TABLE "Invoice" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'viettel';
