const KRX_URL = "https://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd";
const LOGIN_PAGE = "https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001.cmd";
const LOGIN_JSP = "https://data.krx.co.kr/contents/MDC/COMS/client/view/login.jsp?site=mdc";
const LOGIN_URL = "https://data.krx.co.kr/contents/MDC/COMS/client/MDCCOMS001D1.cmd";
const REFERER = "https://data.krx.co.kr/contents/MDC/MDI/outerLoader/index.cmd";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36";

let authCache = { cookie: "", expiresAt: 0 };
let publicCache = { cookie: "", expiresAt: 0 };

function appendCookies(jar, response) {
  const headers = response.headers;
  const rawCookies = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(Boolean);

  for (const raw of rawCookies) {
    if (!raw) continue;
    const first = raw.split(";")[0];
    const idx = first.indexOf("=");
    if (idx <= 0) continue;
    jar.set(first.slice(0, idx).trim(), first.slice(idx + 1).trim());
  }
}

function cookieString(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

async function timedFetch(url, options = {}) {
  const signal = AbortSignal.timeout(15000);
  return fetch(url, { ...options, signal, redirect: "follow" });
}

async function publicSessionCookie() {
  if (publicCache.cookie && Date.now() < publicCache.expiresAt) return publicCache.cookie;

  const jar = new Map();
  let res = await timedFetch(LOGIN_PAGE, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
    }
  });
  appendCookies(jar, res);

  res = await timedFetch(LOGIN_JSP, {
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": LOGIN_PAGE,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Cookie": cookieString(jar)
    }
  });
  appendCookies(jar, res);

  publicCache = { cookie: cookieString(jar), expiresAt: Date.now() + 25 * 60 * 1000 };
  return publicCache.cookie;
}

async function loginIfConfigured() {
  const id = process.env.KRX_ID;
  const pw = process.env.KRX_PW;
  if (!id || !pw) return publicSessionCookie();

  if (authCache.cookie && Date.now() < authCache.expiresAt) return authCache.cookie;

  const jar = new Map();
  let res = await timedFetch(LOGIN_PAGE, { headers: { "User-Agent": USER_AGENT } });
  appendCookies(jar, res);

  res = await timedFetch(LOGIN_JSP, {
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": LOGIN_PAGE,
      "Cookie": cookieString(jar)
    }
  });
  appendCookies(jar, res);

  const payload = new URLSearchParams({
    mbrNm: "",
    telNo: "",
    di: "",
    certType: "",
    mbrId: id,
    pw
  });

  res = await timedFetch(LOGIN_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": LOGIN_PAGE,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "Cookie": cookieString(jar)
    },
    body: payload
  });
  appendCookies(jar, res);
  let data = await res.json();

  if (data?._error_code === "CD011") {
    payload.set("skipDup", "Y");
    res = await timedFetch(LOGIN_URL, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Referer": LOGIN_PAGE,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Cookie": cookieString(jar)
      },
      body: payload
    });
    appendCookies(jar, res);
    data = await res.json();
  }

  if (data?._error_code !== "CD001") {
    throw new Error(`KRX 로그인 실패: ${data?._error_message || data?._error_code || "알 수 없는 오류"}`);
  }

  authCache = { cookie: cookieString(jar), expiresAt: Date.now() + 50 * 60 * 1000 };
  return authCache.cookie;
}

export async function postKrx(params) {
  const cookie = await loginIfConfigured();
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) body.set(key, String(value));
  }

  const res = await timedFetch(KRX_URL, {
    method: "POST",
    headers: {
      "User-Agent": USER_AGENT,
      "Referer": REFERER,
      "Origin": "https://data.krx.co.kr",
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      "X-Requested-With": "XMLHttpRequest",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      ...(cookie ? { Cookie: cookie } : {})
    },
    body
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`KRX HTTP ${res.status}`);

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("KRX 응답을 JSON으로 해석하지 못했습니다. KRX 로그인 정책 또는 일시적 차단을 확인하세요.");
  }

  if (json?._error_code && json._error_code !== "CD001") {
    throw new Error(`KRX 오류: ${json._error_message || json._error_code}`);
  }
  return json;
}

export async function searchStocks(query) {
  const json = await postKrx({
    bld: "dbms/comm/finder/finder_stkisu",
    locale: "ko_KR",
    mktsel: "ALL",
    searchText: query || "",
    typeNo: 0
  });

  return (json.block1 || []).map((r) => ({
    code: r.short_code,
    name: r.codeName,
    isin: r.full_code,
    market: r.marketName,
    marketCode: r.marketCode
  }));
}

export async function resolveStock(query) {
  const items = await searchStocks(query);
  const q = String(query || "").trim();
  const exact = items.find((x) => x.code === q)
    || items.find((x) => x.name === q)
    || items[0];
  if (!exact) throw new Error("종목을 찾지 못했습니다.");
  return exact;
}

export async function fetchInvestorRows(isin, start, end, trdVolVal, askBid) {
  const json = await postKrx({
    bld: "dbms/MDC/STAT/standard/MDCSTAT02302",
    strtDd: start,
    endDd: end,
    isuCd: isin,
    inqTpCd: 2,
    trdVolVal,
    askBid
  });
  return json.output || [];
}

export async function fetchPriceRows(isin, start, end) {
  const json = await postKrx({
    bld: "dbms/MDC/STAT/standard/MDCSTAT01701",
    strtDd: start,
    endDd: end,
    isuCd: isin,
    adjStkPrc: 1
  });
  return json.output || [];
}

export function authMode() {
  return process.env.KRX_ID && process.env.KRX_PW ? "KRX 로그인" : "KRX 공개조회";
}
