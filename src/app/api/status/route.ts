import { prisma } from "@/lib/db";
import { config, currentProvider, MOCK_SCENARIOS, PROVIDERS, validateConfig } from "@/lib/config";
import { getTokenInfo as matbaoToken } from "@/lib/matbao";
import { getTokenInfo as sepayToken } from "@/lib/sepay";
import { getTokenInfo as viettelToken } from "@/lib/viettel/token";

export async function GET() {
  const provider = await currentProvider();
  const s = config.sepay;
  const m = config.matbao;
  const { token, ...info } = {
    viettel: {
      baseUrl: config.baseUrl, supplierTaxCode: config.supplierTaxCode, templateCode: config.templateCode,
      invoiceSeries: config.invoiceSeries, invoiceType: config.invoiceType, timeoutMs: config.timeoutMs,
      minResendGapMs: config.minResendGapMs, token: viettelToken,
    },
    sepay: {
      baseUrl: s.baseUrl, supplierTaxCode: "—", templateCode: s.templateCode, invoiceSeries: s.invoiceSeries,
      invoiceType: "—", timeoutMs: s.timeoutMs, minResendGapMs: 0, token: sepayToken,
    },
    matbao: {
      baseUrl: m.baseUrl, supplierTaxCode: m.taxCode || "—", templateCode: m.pattern, invoiceSeries: m.serial,
      invoiceType: "—", timeoutMs: m.timeoutMs, minResendGapMs: 0, token: matbaoToken,
    },
  }[provider];
  const mockMode = provider === "viettel" && config.mockMode;
  const counts = await prisma.invoice.groupBy({ by: ["status"], _count: true });
  return Response.json({
    provider,
    providers: PROVIDERS,
    mockMode,
    ...info,
    configErrors: validateConfig(provider),
    token: await token(),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    scenarios: mockMode ? MOCK_SCENARIOS : {},
  });
}
