import { prisma } from "@/lib/db";
import { config, MOCK_SCENARIOS, validateConfig } from "@/lib/config";
import { getTokenInfo } from "@/lib/viettel/token";

export async function GET() {
  const counts = await prisma.invoice.groupBy({ by: ["status"], _count: true });
  return Response.json({
    mockMode: config.mockMode,
    baseUrl: config.baseUrl,
    supplierTaxCode: config.supplierTaxCode,
    templateCode: config.templateCode,
    invoiceSeries: config.invoiceSeries,
    invoiceType: config.invoiceType,
    timeoutMs: config.timeoutMs,
    minResendGapMs: config.minResendGapMs,
    configErrors: validateConfig(),
    token: await getTokenInfo(),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    scenarios: config.mockMode ? MOCK_SCENARIOS : {},
  });
}
