import test from "node:test";
import assert from "node:assert/strict";
import { calcInvestorMetrics, classifyRotation, INVESTORS, mapRowsByDate, toNumber } from "../lib/calc.mjs";

test("KRX comma numbers parse correctly", () => {
  assert.equal(toNumber("1,048,880"), 1048880);
  assert.equal(toNumber("-48,880"), -48880);
  assert.equal(toNumber(""), 0);
});

test("investor column mapping matches KRX general investor layout", () => {
  assert.equal(INVESTORS.institution.key, "TRDVAL1");
  assert.equal(INVESTORS.individual.key, "TRDVAL3");
  assert.equal(INVESTORS.foreign.key, "TRDVAL4");
});

test("1m buy + 1.04888m sell exposes large gross flow despite small net", () => {
  const m = calcInvestorMetrics({
    buyVol: 1000000,
    sellVol: 1048880,
    netVol: -48880,
    buyVal: 10500000000,
    sellVal: 13635440000,
    netVal: 3135440000,
    marketVolume: 2656597
  });

  assert.equal(m.grossVolume, 2048880);
  assert.equal(m.matchedVolume, 1000000);
  assert.equal(m.avgBuyPrice, 10500);
  assert.equal(m.avgSellPrice, 13000);
  assert.ok(m.offsetPct > 97 && m.offsetPct < 98);
  assert.ok(m.twoSideSharePct > 38 && m.twoSideSharePct < 39);
  assert.equal(classifyRotation(m), "고회전·상계형");
});

test("date rows are normalized and indexed", () => {
  const map = mapRowsByDate([{ TRD_DD: "2026/10/02", TRDVAL4: "-48,880" }]);
  assert.equal(map.get("2026-10-02").TRDVAL4, "-48,880");
});
