import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const required = [
  "index.html",
  "api/krx.js",
  "api/excel.js",
  "lib/calc.mjs",
  "lib/krx.mjs",
  "vercel.json",
  "package.json"
];

for (const file of required) {
  const p = path.join(root, file);
  if (!fs.existsSync(p)) throw new Error(`필수 파일 누락: ${file}`);
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const api = fs.readFileSync(path.join(root, "api/krx.js"), "utf8");
const krx = fs.readFileSync(path.join(root, "lib/krx.mjs"), "utf8");
const excel = fs.readFileSync(path.join(root, "api/excel.js"), "utf8");

const checks = [
  [html.includes("총회전량"), "UI에 총회전량이 없습니다."],
  [html.includes("상계율"), "UI에 상계율이 없습니다."],
  [html.includes("Excel .xlsx 저장"), "엑셀 저장 버튼이 없습니다."],
  [html.includes("KRX+NXT"), "KRX/NXT 범위 안내가 없습니다."],
  [api.includes("MDCSTAT02302") || krx.includes("MDCSTAT02302"), "KRX 투자자별 개별종목 endpoint가 없습니다."],
  [krx.includes("MDCSTAT01701"), "KRX 시세 endpoint가 없습니다."],
  [excel.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "xlsx MIME type이 없습니다."],
  [krx.includes("process.env.KRX_ID") && krx.includes("process.env.KRX_PW"), "KRX 로그인 환경변수 지원이 없습니다."],
  [!krx.includes("KRX_ID=") && !krx.includes("KRX_PW="), "소스에 KRX 자격증명이 하드코딩된 것으로 보입니다."]
];

for (const [ok, message] of checks) if (!ok) throw new Error(message);

console.log("Static verification passed:", checks.length, "checks");
