import { calcInvestorMetrics, classifyRotation, INVESTORS, mapRowsByDate, normalizeDate, toNumber } from "../lib/calc.mjs";
import { authMode, fetchInvestorRows, fetchPriceRows, resolveStock, searchStocks } from "../lib/krx.mjs";

function ymd(value) {
  const s = String(value || "").replaceAll("-", "");
  if (!/^\d{8}$/.test(s)) throw new Error("날짜 형식이 올바르지 않습니다.");
  return s;
}

function calendarDays(start, end) {
  const a = Date.parse(`${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T00:00:00Z`);
  const b = Date.parse(`${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T00:00:00Z`);
  return Math.floor((b - a) / 86400000);
}

function metricAt(date, key, maps, marketVolume) {
  const read = (name) => toNumber(maps[name].get(date)?.[key]);
  return calcInvestorMetrics({
    buyVol: read("buyVol"),
    sellVol: read("sellVol"),
    netVol: read("netVol"),
    buyVal: read("buyVal"),
    sellVal: read("sellVal"),
    netVal: read("netVal"),
    marketVolume
  });
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.status(405).json({ error: "GET만 지원합니다." });
      return;
    }

    if (req.query.action === "search") {
      const q = String(req.query.q || "").trim();
      if (q.length < 1) {
        res.status(200).json({ items: [] });
        return;
      }
      const items = await searchStocks(q);
      res.setHeader("Cache-Control", "s-maxage=3600, stale-while-revalidate=86400");
      res.status(200).json({ items: items.slice(0, 30) });
      return;
    }

    const code = String(req.query.code || "").trim();
    if (!code) throw new Error("종목코드 또는 종목명을 입력하세요.");
    const start = ymd(req.query.start);
    const end = ymd(req.query.end);
    const days = calendarDays(start, end);
    if (days < 0) throw new Error("시작일이 종료일보다 늦습니다.");
    if (days > 730) throw new Error("한 번에 조회 가능한 기간은 최대 730일입니다.");

    const stock = await resolveStock(code);

    const [sellVol, buyVol, netVol] = await Promise.all([
      fetchInvestorRows(stock.isin, start, end, 1, 1),
      fetchInvestorRows(stock.isin, start, end, 1, 2),
      fetchInvestorRows(stock.isin, start, end, 1, 3)
    ]);

    const [sellVal, buyVal, netVal, prices] = await Promise.all([
      fetchInvestorRows(stock.isin, start, end, 2, 1),
      fetchInvestorRows(stock.isin, start, end, 2, 2),
      fetchInvestorRows(stock.isin, start, end, 2, 3),
      fetchPriceRows(stock.isin, start, end)
    ]);

    const maps = {
      sellVol: mapRowsByDate(sellVol),
      buyVol: mapRowsByDate(buyVol),
      netVol: mapRowsByDate(netVol),
      sellVal: mapRowsByDate(sellVal),
      buyVal: mapRowsByDate(buyVal),
      netVal: mapRowsByDate(netVal),
      prices: mapRowsByDate(prices)
    };

    const dates = [...new Set([
      ...sellVol.map((r) => normalizeDate(r.TRD_DD)),
      ...prices.map((r) => normalizeDate(r.TRD_DD))
    ])].sort();

    const rows = dates.map((date) => {
      const price = maps.prices.get(date) || {};
      const marketVolume = toNumber(price.ACC_TRDVOL) || toNumber(maps.buyVol.get(date)?.TRDVAL_TOT);
      const close = toNumber(price.TDD_CLSPRC);
      const investors = {};

      for (const [id, def] of Object.entries(INVESTORS)) {
        const metric = metricAt(date, def.key, maps, marketVolume);
        investors[id] = { ...metric, label: def.label, pattern: classifyRotation(metric) };
      }

      return {
        date,
        close,
        marketVolume,
        marketValue: toNumber(price.ACC_TRDVAL),
        investors
      };
    });

    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=1800");
    res.status(200).json({
      stock,
      period: { start, end },
      rows,
      meta: {
        source: "KRX Data Marketplace",
        investorEndpoint: "MDCSTAT02302",
        priceEndpoint: "MDCSTAT01701",
        authMode: authMode(),
        finalizedAfter: "KRX 최종 투자자별 매매내역은 장 종료 후 확정되며 당일 자료는 갱신 지연이 있을 수 있습니다.",
        nxtNote: "이 화면은 KRX 투자자별 거래실적을 기준으로 합니다. 증권사 통합(KRX+NXT) 거래량과는 차이가 날 수 있습니다.",
        interpretation: "외국인·기관·개인 구분은 집단 합산값입니다. 매수와 매도가 동시에 커도 동일 계좌가 저가매수 후 고가매도했다는 뜻은 아닙니다."
      }
    });
  } catch (error) {
    res.status(500).json({
      error: error?.message || "조회 중 오류가 발생했습니다.",
      hint: "KRX 정책 변경으로 로그인이 필요한 경우 Vercel 환경변수 KRX_ID, KRX_PW를 설정하면 로그인 세션 방식으로 자동 전환됩니다."
    });
  }
}
