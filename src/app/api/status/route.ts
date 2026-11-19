import { prisma } from "@/lib/db";
import { config, currentProvider, MOCK_SCENARIOS, PROVIDERS, validateConfig } from "@/lib/config";
import { getTokenInfo as sepayToken } from "@/lib/sepay";
import { getTokenInfo as viettelToken } from "@/lib/viettel/token";

export async function GET() {
  const provider = await currentProvider();
  const sepay = provider === "sepay";
  const mockMode = !sepay && config.mockMode;
  const counts = await prisma.invoice.groupBy({ by: ["status"], _count: true });
  return Response.json({
    provider,
    providers: PROVIDERS,
    mockMode,
    baseUrl: sepay ? config.sepay.baseUrl : config.baseUrl,
    supplierTaxCode: sepay ? "—" : config.supplierTaxCode,
    templateCode: sepay ? config.sepay.templateCode : config.templateCode,
    invoiceSeries: sepay ? config.sepay.invoiceSeries : config.invoiceSeries,
    invoiceType: sepay ? "—" : config.invoiceType,
    timeoutMs: sepay ? config.sepay.timeoutMs : config.timeoutMs,
    minResendGapMs: sepay ? 0 : config.minResendGapMs,
    configErrors: validateConfig(provider),
    token: await (sepay ? sepayToken() : viettelToken()),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    scenarios: mockMode ? MOCK_SCENARIOS : {},
  });
}
