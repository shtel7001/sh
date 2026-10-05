import ExcelJS from "exceljs";

const INVESTOR_ORDER = [
  ["foreign", "외국인"],
  ["institution", "기관"],
  ["individual", "개인"]
];

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function flatRows(payload) {
  const out = [];
  for (const row of payload.rows || []) {
    for (const [id, label] of INVESTOR_ORDER) {
      const m = row.investors?.[id];
      if (!m) continue;
      out.push({
        날짜: row.date,
        종목명: payload.stock?.name || "",
        종목코드: payload.stock?.code || "",
        시장: payload.stock?.market || "",
        투자자: label,
        종가: row.close || 0,
        시장거래량: row.marketVolume || 0,
        매수수량: m.buyVol || 0,
        매도수량: m.sellVol || 0,
        순매수수량: m.netVol || 0,
        총회전량: m.grossVolume || 0,
        양방향매칭가능량: m.matchedVolume || 0,
        매수비중: m.buySharePct || 0,
        매도비중: m.sellSharePct || 0,
        양방향참여율: m.twoSideSharePct || 0,
        상계율: m.offsetPct || 0,
        평균매수가: m.avgBuyPrice || 0,
        평균매도가: m.avgSellPrice || 0,
        평균가격차이: m.avgPriceDiffPct || 0,
        매수대금: m.buyVal || 0,
        매도대금: m.sellVal || 0,
        순매수대금: m.netVal || 0,
        패턴: m.pattern || ""
      });
    }
  }
  return out;
}

function setupSheet(sheet, rows) {
  const headers = Object.keys(rows[0] || {
    날짜: "", 종목명: "", 종목코드: "", 시장: "", 투자자: "", 종가: "", 시장거래량: "",
    매수수량: "", 매도수량: "", 순매수수량: "", 총회전량: "", 양방향매칭가능량: "",
    매수비중: "", 매도비중: "", 양방향참여율: "", 상계율: "", 평균매수가: "",
    평균매도가: "", 평균가격차이: "", 매수대금: "", 매도대금: "", 순매수대금: "", 패턴: ""
  });

  sheet.columns = headers.map((h) => ({
    header: h,
    key: h,
    width: ["종목명", "패턴"].includes(h) ? 18 : ["날짜", "투자자"].includes(h) ? 13 : 16
  }));

  rows.forEach((r) => sheet.addRow(r));
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(headers.length).letter}1` };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17324D" } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  for (const h of ["매수비중", "매도비중", "양방향참여율", "상계율", "평균가격차이"]) {
    const c = headers.indexOf(h) + 1;
    if (c > 0) sheet.getColumn(c).numFmt = '0.00"%"';
  }
  for (const h of ["종가", "시장거래량", "매수수량", "매도수량", "순매수수량", "총회전량", "양방향매칭가능량", "평균매수가", "평균매도가", "매수대금", "매도대금", "순매수대금"]) {
    const c = headers.indexOf(h) + 1;
    if (c > 0) sheet.getColumn(c).numFmt = "#,##0";
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST만 지원합니다." });
      return;
    }

    const payload = await readBody(req);
    if (!Array.isArray(payload.rows) || payload.rows.length === 0) throw new Error("저장할 조회 결과가 없습니다.");
    if (payload.rows.length > 1000) throw new Error("엑셀 저장은 날짜 1,000개 이하만 지원합니다.");

    const all = flatRows(payload);
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KR Investor Gross Flow Radar";
    workbook.created = new Date();

    const allSheet = workbook.addWorksheet("전체");
    setupSheet(allSheet, all);

    for (const [, label] of INVESTOR_ORDER) {
      const sheet = workbook.addWorksheet(label);
      setupSheet(sheet, all.filter((r) => r.투자자 === label));
    }

    const guide = workbook.addWorksheet("설명");
    guide.addRows([
      ["항목", "설명"],
      ["총회전량", "해당 투자자군의 매수수량 + 매도수량"],
      ["양방향참여율", "(매수수량 + 매도수량) / (시장거래량 × 2) × 100"],
      ["상계율", "1 - |순매수| / (매수수량 + 매도수량). 높을수록 같은 날 매수와 매도가 모두 큼"],
      ["주의", "투자자군 합산 통계이므로 동일 계좌의 당일 왕복매매를 직접 증명하지 않습니다."],
      ["시장범위", "KRX 투자자별 거래실적 기준. KRX+NXT 통합 거래량과 다를 수 있습니다."]
    ]);
    guide.getRow(1).font = { bold: true };
    guide.columns = [{ width: 20 }, { width: 90 }];

    const buffer = await workbook.xlsx.writeBuffer();
    const safeName = String(payload.stock?.name || "investor-flow").replace(/[\\/:*?"<>|]/g, "_");
    const filename = `${safeName}_투자자_총매수매도_${payload.period?.start || ""}_${payload.period?.end || ""}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.status(200).send(Buffer.from(buffer));
  } catch (error) {
    res.status(500).json({ error: error?.message || "엑셀 생성 중 오류가 발생했습니다." });
  }
}
