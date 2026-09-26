from __future__ import annotations

import math
from pathlib import Path
import pandas as pd

CUTOFF = pd.Timestamp('2026-09-03')
CFG = {
    'minMonths': 6.0,
    'maxMonths': 18.0,
    'spike1': 10.0,
    'spike5': 20.0,
    'spike20': 30.0,
    'minDrawdown': 15.0,
    'maPeriod': 20,
    'maLow': -2.0,
    'maHigh': 3.0,
    'touchTol': 1.5,
    'floorTol': 1.5,
    'supportDays': 2,
    'minSlope5': -0.5,
    'maxRecent1': 9.0,
    'maxRecent5': 18.0,
    'requireMa5Above': False,
}

ETF_PREFIXES = (
    'KODEX','TIGER','ACE ','ACE','RISE','KOSEF','HANARO','SOL ','SOL','PLUS','ARIRANG',
    'TIMEFOLIO','KBSTAR','FOCUS','히어로즈','WOORI','1Q','UNICORN','TREX','SMART','ITF'
)
ETN_TOKENS = (' ETN', 'ETN ', 'ETN(H', ' ETN(H', 'TRUE ', 'QV ', 'N2 ', '신한 ', '삼성 ', 'KB ', '미래에셋 ', '메리츠 ')


def pct(a: float, b: float) -> float:
    return (a / b - 1.0) * 100.0 if b else float('nan')


def clamp(x: float, a: float, b: float) -> float:
    return max(a, min(b, x))


def months_between(a: pd.Timestamp, b: pd.Timestamp) -> float:
    return (b - a).days / 30.4375


def looks_like_etf_etn(name: str) -> bool:
    n = str(name).strip()
    if any(n.startswith(p) for p in ETF_PREFIXES):
        return True
    if ' ETF' in n or n.endswith('ETF') or ' ETN' in n or n.endswith('ETN'):
        return True
    # Korean ETN names usually start with a securities-company brand and contain ETN.
    if 'ETN' in n and any(tok in (' ' + n) for tok in ETN_TOKENS):
        return True
    return False


def evaluate(g: pd.DataFrame, code: str, name: str, market: str):
    bars = g[g['Date'] <= CUTOFF].sort_values('Date').reset_index(drop=True)
    n = len(bars)
    ma_period = CFG['maPeriod']
    if n < max(120, ma_period + 25):
        return None
    last = n - 1
    if bars.loc[last, 'Date'] != CUTOFF:
        return None

    close = bars['Close'].astype(float)
    high = bars['High'].astype(float)
    low = bars['Low'].astype(float)
    volume = bars['Volume'].astype(float)

    def ma_at(idx: int, p: int) -> float:
        if idx - p + 1 < 0:
            return float('nan')
        return float(close.iloc[idx-p+1:idx+1].mean())

    now_close = float(close.iloc[last])
    ma = ma_at(last, ma_period)
    ma5 = ma_at(last, 5)
    ma_five_sessions_ago = ma_at(last - 5, ma_period)
    if not all(math.isfinite(x) for x in (ma, ma5, ma_five_sessions_ago)):
        return None

    dist = pct(now_close, ma)
    slope5 = pct(ma, ma_five_sessions_ago)
    change1 = pct(now_close, float(close.iloc[last-1]))
    change5 = pct(now_close, float(close.iloc[last-5]))

    if dist < CFG['maLow'] or dist > CFG['maHigh']:
        return None
    if slope5 < CFG['minSlope5']:
        return None
    if change1 > CFG['maxRecent1'] or change5 > CFG['maxRecent5']:
        return None
    if CFG['requireMa5Above'] and ma5 < ma:
        return None

    support = 0
    support_details = []
    for d in range(CFG['supportDays']):
        i = last - d
        m = ma_at(i, ma_period)
        if not math.isfinite(m):
            break
        bclose = float(close.iloc[i])
        blow = float(low.iloc[i])
        close_dist = pct(bclose, m)
        low_dist = pct(blow, m)
        touched = abs(low_dist) <= CFG['touchTol']
        held_close = close_dist >= -CFG['floorTol'] and close_dist <= CFG['maHigh']
        ok = touched and held_close
        support_details.append((bars.loc[i, 'Date'].strftime('%Y%m%d'), close_dist, low_dist, ok))
        if ok:
            support += 1
        else:
            break
    if support < CFG['supportDays']:
        return None

    best = None
    begin = max(20, ma_period)
    for i in range(begin, last - 20):
        age = months_between(bars.loc[i, 'Date'], CUTOFF)
        if age < CFG['minMonths'] or age > CFG['maxMonths']:
            continue
        r1 = pct(float(close.iloc[i]), float(close.iloc[i-1]))
        r5 = pct(float(close.iloc[i]), float(close.iloc[i-5]))
        whigh = float(high.iloc[i-19:i+1].max())
        wlow = float(low.iloc[i-19:i+1].min())
        r20 = pct(whigh, wlow)
        if r1 < CFG['spike1'] and r5 < CFG['spike5'] and r20 < CFG['spike20']:
            continue
        peak = float(high.iloc[i:min(last+1, i+21)].max())
        drawdown = (1.0 - now_close / peak) * 100.0
        if drawdown < CFG['minDrawdown']:
            continue
        strength = max(r1/CFG['spike1'], r5/CFG['spike5'], r20/CFG['spike20'])
        cand = {
            'date': bars.loc[i, 'Date'], 'age': age, 'r1': r1, 'r5': r5, 'r20': r20,
            'peak': peak, 'drawdown': drawdown, 'strength': strength,
        }
        if best is None or cand['strength'] > best['strength']:
            best = cand
    if best is None:
        return None

    vol20 = float(volume.iloc[max(0,last-19):last+1].mean())
    vol_ratio = float(volume.iloc[last]) / vol20 if vol20 else 0.0

    ma_score = clamp(30 - abs(dist) * 7, 5, 30)
    support_score = 12 if CFG['supportDays'] == 1 else (18 if CFG['supportDays'] == 2 else 21)
    slope_score = clamp(10 + slope5 * 4, 2, 15)
    spike_score = clamp(12 + best['strength'] * 6, 12, 25)
    dd_score = clamp(best['drawdown'] / 4, 4, 10)
    volume_score = clamp(3 + math.log2(max(0.3, vol_ratio)) * 2, 1, 7)
    score = round(clamp(ma_score + support_score + slope_score + spike_score + dd_score + volume_score, 0, 100))

    return {
        'score': score, 'market': market, 'code': code, 'name': name,
        'buy_date': CUTOFF, 'buy_close': now_close, 'change1': change1, 'change5': change5,
        'ma20': ma, 'ma_dist': dist, 'ma_slope5': slope5, 'support_days': support,
        'volume': float(volume.iloc[last]), 'vol_ratio': vol_ratio,
        'old_spike_date': best['date'], 'old_spike_age_months': best['age'],
        'old_r1': best['r1'], 'old_r5': best['r5'], 'old_r20': best['r20'],
        'old_peak': best['peak'], 'old_drawdown': best['drawdown'],
    }


def add_forward_performance(row: dict, g: pd.DataFrame) -> dict:
    g = g.sort_values('Date').reset_index(drop=True)
    after = g[g['Date'] > CUTOFF].copy()
    buy = row['buy_close']
    if after.empty:
        row.update({
            'latest_date': pd.NaT, 'latest_close': float('nan'), 'latest_return_pct': float('nan'),
            'max_high_date': pd.NaT, 'max_high': float('nan'), 'max_rise_pct': float('nan'),
            'min_low_date': pd.NaT, 'min_low': float('nan'), 'max_drawdown_after_buy_pct': float('nan'),
        })
        return row

    latest = after.iloc[-1]
    max_idx = after['High'].astype(float).idxmax()
    min_idx = after['Low'].astype(float).idxmin()
    mx = after.loc[max_idx]
    mn = after.loc[min_idx]
    row.update({
        'latest_date': latest['Date'],
        'latest_close': float(latest['Close']),
        'latest_return_pct': pct(float(latest['Close']), buy),
        'max_high_date': mx['Date'],
        'max_high': float(mx['High']),
        'max_rise_pct': pct(float(mx['High']), buy),
        'min_low_date': mn['Date'],
        'min_low': float(mn['Low']),
        'max_drawdown_after_buy_pct': pct(float(mn['Low']), buy),
    })
    for sessions in (1, 3, 5, 10):
        if len(after) >= sessions:
            b = after.iloc[sessions-1]
            row[f'd{sessions}_date'] = b['Date']
            row[f'd{sessions}_close'] = float(b['Close'])
            row[f'd{sessions}_return_pct'] = pct(float(b['Close']), buy)
        else:
            row[f'd{sessions}_date'] = pd.NaT
            row[f'd{sessions}_close'] = float('nan')
            row[f'd{sessions}_return_pct'] = float('nan')
    return row


def main():
    root = Path(__file__).resolve().parent
    data_dir = root / 'data'
    frames = []
    for year in (2025, 2026):
        p = data_dir / f'marcap-{year}.parquet'
        if not p.exists():
            raise FileNotFoundError(p)
        frames.append(pd.read_parquet(p))
    df = pd.concat(frames, ignore_index=True)
    df['Date'] = pd.to_datetime(df['Date'])
    df['Code'] = df['Code'].astype(str).str.zfill(6)
    df['Name'] = df['Name'].astype(str)
    df['Market'] = df['Market'].astype(str)
    df = df[df['Market'].isin(['KOSPI', 'KOSDAQ'])]
    df = df[df['Volume'].fillna(0) > 0]
    df = df[~df['Name'].str.contains('스팩|SPAC', case=False, regex=True, na=False)]
    df = df[~df['Name'].map(looks_like_etf_etn)]

    # Only securities that actually traded on the target date are in the historical universe.
    target_codes = set(df.loc[df['Date'] == CUTOFF, 'Code'])
    df = df[df['Code'].isin(target_codes)]

    grouped = {code: g.copy() for code, g in df.groupby('Code', sort=False)}
    results = []
    for code, g in grouped.items():
        at = g[g['Date'] == CUTOFF]
        if at.empty:
            continue
        last = at.iloc[-1]
        r = evaluate(g, code, str(last['Name']), str(last['Market']))
        if r is not None:
            results.append(r)

    results.sort(key=lambda x: (-x['score'], abs(x['ma_dist']), x['code']))
    top10 = results[:10]
    top10 = [add_forward_performance(r, grouped[r['code']]) for r in top10]
    out = pd.DataFrame(top10)

    # Stable formatting for CSV/Markdown while preserving numeric columns.
    out_path = root / 'old_spike_ma20_20260903_top10.csv'
    out.to_csv(out_path, index=False, encoding='utf-8-sig')

    portfolio = {
        'candidate_count': len(results),
        'top10_latest_equal_weight_return_pct': out['latest_return_pct'].mean() if len(out) else float('nan'),
        'top10_average_max_rise_pct': out['max_rise_pct'].mean() if len(out) else float('nan'),
        'top10_win_rate_latest_pct': (out['latest_return_pct'] > 0).mean() * 100 if len(out) else float('nan'),
    }

    md_cols = [
        'score','market','name','code','buy_close','latest_date','latest_close','latest_return_pct',
        'max_high_date','max_high','max_rise_pct','min_low','max_drawdown_after_buy_pct',
        'ma_dist','ma_slope5','old_spike_date','old_drawdown'
    ]
    md = out[md_cols].copy()
    for c in ['latest_date','max_high_date','old_spike_date']:
        md[c] = pd.to_datetime(md[c]).dt.strftime('%Y-%m-%d')
    md_path = root / 'old_spike_ma20_20260903_top10.md'
    with md_path.open('w', encoding='utf-8') as f:
        f.write('# 과거 급등 × 20일선 지지 레이더 백테스트 — 2026-09-03\n\n')
        f.write('사이트 기본값을 동일하게 적용하고 2026-09-03 종가를 매수가로 가정했습니다. 수수료·세금·슬리피지는 제외했습니다.\n\n')
        f.write(md.to_markdown(index=False, floatfmt='.2f'))
        f.write('\n\n## 요약\n\n')
        for k, v in portfolio.items():
            f.write(f'- {k}: {v:.2f}\n' if isinstance(v, (int, float)) else f'- {k}: {v}\n')
        f.write(f'\n- 전체 기술조건 후보 수: {len(results)}\n')
    print(out.to_string(index=False))
    print(portfolio)
    print(f'WROTE {out_path} and {md_path}')


if __name__ == '__main__':
    main()
