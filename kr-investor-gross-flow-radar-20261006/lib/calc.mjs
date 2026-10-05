export const INVESTORS = {
  foreign: { label: "외국인", key: "TRDVAL4" },
  institution: { label: "기관합계", key: "TRDVAL1" },
  individual: { label: "개인", key: "TRDVAL3" }
};

export function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;
  const normalized = String(value).replace(/,/g, "").replace(/[^0-9.+-]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeDate(value) {
  return String(value || "").replaceAll("/", "-");
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

export function calcInvestorMetrics({
  buyVol = 0,
  sellVol = 0,
  netVol = 0,
  buyVal = 0,
  sellVal = 0,
  netVal = 0,
  marketVolume = 0
}) {
  buyVol = toNumber(buyVol);
  sellVol = toNumber(sellVol);
  netVol = toNumber(netVol);
  buyVal = toNumber(buyVal);
  sellVal = toNumber(sellVal);
  netVal = toNumber(netVal);
  marketVolume = toNumber(marketVolume);

  const grossVolume = buyVol + sellVol;
  const matchedVolume = Math.min(buyVol, sellVol);
  const buySharePct = marketVolume > 0 ? (buyVol / marketVolume) * 100 : 0;
  const sellSharePct = marketVolume > 0 ? (sellVol / marketVolume) * 100 : 0;
  const twoSideSharePct = marketVolume > 0 ? (grossVolume / (marketVolume * 2)) * 100 : 0;
  const offsetPct = grossVolume > 0 ? (1 - Math.min(1, Math.abs(netVol) / grossVolume)) * 100 : 0;
  const netToGrossPct = grossVolume > 0 ? (Math.abs(netVol) / grossVolume) * 100 : 0;
  const avgBuyPrice = buyVol > 0 ? buyVal / buyVol : 0;
  const avgSellPrice = sellVol > 0 ? sellVal / sellVol : 0;
  const avgPriceDiffPct = avgBuyPrice > 0 && avgSellPrice > 0
    ? ((avgSellPrice / avgBuyPrice) - 1) * 100
    : 0;

  return {
    buyVol,
    sellVol,
    netVol,
    grossVolume,
    matchedVolume,
    buySharePct: round(buySharePct),
    sellSharePct: round(sellSharePct),
    twoSideSharePct: round(twoSideSharePct),
    offsetPct: round(offsetPct),
    netToGrossPct: round(netToGrossPct),
    buyVal,
    sellVal,
    netVal,
    avgBuyPrice: round(avgBuyPrice, 0),
    avgSellPrice: round(avgSellPrice, 0),
    avgPriceDiffPct: round(avgPriceDiffPct)
  };
}

export function mapRowsByDate(rows = []) {
  const out = new Map();
  for (const row of rows) out.set(normalizeDate(row.TRD_DD), row);
  return out;
}

export function classifyRotation(metric) {
  if (!metric || metric.grossVolume <= 0) return "거래없음";
  if (metric.twoSideSharePct >= 20 && metric.offsetPct >= 90) return "고회전·상계형";
  if (metric.buySharePct >= 20 && metric.sellSharePct >= 20) return "양방향 대량";
  if (metric.buySharePct >= 20) return "매수집중";
  if (metric.sellSharePct >= 20) return "매도집중";
  return "보통";
}
