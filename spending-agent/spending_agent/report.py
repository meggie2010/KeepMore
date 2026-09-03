"""Stage 3: render a monthly spending report from categorized transactions.

Usage:
    python -m spending_agent.report                      # latest month
    python -m spending_agent.report --month 2026-07
    python -m spending_agent.report --all                # one report per month present

Shows the 5-number Conscious Spending Plan view: Total Take Home Pay, Fixed
Costs, Guilt-Free Spending, Savings, and Investments - plus category
breakdowns, a 6-month trend, and top merchants. Reads report_config.yaml (if
present) to add pre-tax payroll deductions (401k, HSA, etc.) that never show
up as bank transactions, on top of both Income and Investments.
"""

import argparse
import datetime
from pathlib import Path

import pandas as pd
import yaml

PALETTE = {
    "blue": "#2a78d6",
    "orange": "#eb6834",
    "aqua": "#1baf7a",
    "yellow": "#eda100",
    "text_primary": "#0b0b0b",
    "text_secondary": "#52514e",
    "text_muted": "#898781",
    "gridline": "#e1e0d9",
    "baseline": "#c3c2b7",
    "surface": "#fcfcfb",
    "page": "#f9f9f7",
    "card": "#ffffff",
    "border": "rgba(11,11,11,0.10)",
    "good": "#006300",
    "bad": "#d03b3b",
}

GROUP_COLOR = {
    "fixed": PALETTE["blue"],
    "investments": PALETTE["orange"],
    "savings": PALETTE["aqua"],
    "guiltfree": PALETTE["yellow"],
}


# ---------- data ----------

def load_report_config(path: Path) -> dict:
    if not path.exists():
        return {}
    with open(path) as f:
        return yaml.safe_load(f) or {}


def monthly_additions_total(config: dict, key: str = "investments", month: str = None) -> float:
    """Sums a monthly_additions entry. Two supported shapes:
      - a flat dict {label: amount} - always applied, every month (e.g. 401k/HSA)
      - a list of {label, amount, start_month?} - applied only from start_month
        onward, for things that didn't exist for your whole history (e.g. a
        rental property you started renting out partway through)
    """
    additions = (config.get("monthly_additions") or {}).get(key)
    if not additions:
        return 0.0
    if isinstance(additions, dict):
        return float(sum(additions.values()))
    total = 0.0
    for entry in additions:
        start = entry.get("start_month")
        if start and month and month < start:
            continue
        total += float(entry.get("amount", 0))
    return total


def month_key(date_str: str) -> str:
    return (date_str or "")[:7]


def list_months(df: pd.DataFrame) -> list:
    return sorted(df["date"].astype(str).str.slice(0, 7).dropna().unique())


def month_label(key: str) -> str:
    y, m = key.split("-")
    return datetime.date(int(y), int(m), 1).strftime("%b %Y")


def last_n_months(months: list, n: int) -> list:
    return months[-n:]


def _signed_group_sum(df_month: pd.DataFrame, group: str) -> float:
    return df_month.loc[df_month["category_group"] == group, "amount"].sum()


def compute_summary(df: pd.DataFrame, key: str, config: dict) -> dict:
    in_month = df[df["date"].astype(str).str.slice(0, 7) == key]

    income_txn = _signed_group_sum(in_month, "income")
    fixed = -_signed_group_sum(in_month, "fixed")
    guiltfree = -_signed_group_sum(in_month, "guiltfree")
    savings = -_signed_group_sum(in_month, "savings")
    investments_txn = -_signed_group_sum(in_month, "investments")

    manual_investments = monthly_additions_total(config, "investments", key)
    manual_income = monthly_additions_total(config, "income", key)
    investments = investments_txn + manual_investments
    take_home_pay = income_txn + manual_investments + manual_income

    allocated = fixed + investments + savings + guiltfree
    unallocated = take_home_pay - allocated
    # Net out overspend: if the month's total spend + savings + investing
    # exceeded take-home pay (unallocated < 0), some of that Savings/
    # Investments total wasn't new money - it was funded by drawing down
    # cash already on hand. A positive unallocated (leftover cash not yet
    # swept anywhere) also doesn't count as wealth-building until it's
    # actually moved, so it's excluded either way - only a shortfall
    # lowers the rate.
    net_wealth_building = savings + investments + min(unallocated, 0)
    wealth_building_rate = net_wealth_building / take_home_pay * 100 if take_home_pay > 0 else None

    return {
        "take_home_pay": take_home_pay,
        "fixed": fixed,
        "guiltfree": guiltfree,
        "savings": savings,
        "investments": investments,
        "investments_txn": investments_txn,
        "manual_investments": manual_investments,
        "manual_income": manual_income,
        "unallocated": unallocated,
        "net_wealth_building": net_wealth_building,
        "wealth_building_rate": wealth_building_rate,
    }


def category_breakdown(df: pd.DataFrame, key: str, group: str) -> list:
    in_month = df[(df["date"].astype(str).str.slice(0, 7) == key) & (df["category_group"] == group)]
    totals = -in_month.groupby("category_name")["amount"].sum()
    totals = totals[totals > 0].sort_values(ascending=False)
    return list(totals.items())


def top_merchants(df: pd.DataFrame, key: str, limit: int = 10) -> list:
    in_month = df[
        (df["date"].astype(str).str.slice(0, 7) == key)
        & (df["category_group"] == "guiltfree")
        & (df["amount"] < 0)
    ]
    g = in_month.groupby(["description", "category_name"])["amount"].agg(total="sum", count="count")
    g["total"] = -g["total"]
    g = g.sort_values("total", ascending=False).head(limit)
    return [
        {"description": desc, "category": cat, "total": row["total"], "count": int(row["count"])}
        for (desc, cat), row in g.iterrows()
    ]


# ---------- formatting ----------

def fmt_money(n: float) -> str:
    sign = "-" if n < 0 else ""
    return f"{sign}${abs(n):,.0f}"


def esc(s) -> str:
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


# ---------- SVG chart builders (no JS - <title> gives native hover tooltips) ----------

def svg_split_bar(segments: list, width: int = 640, height: int = 56) -> str:
    """segments: [(label, value, color), ...]"""
    total = sum(v for _, v, _ in segments) or 1
    parts = []
    x = 0.0
    gap = 2
    for label, value, color in segments:
        w = max((value / total) * width - gap, 0)
        pct = (value / total) * 100
        title = f"{esc(label)}: {fmt_money(value)} ({pct:.0f}%)"
        parts.append(f'<rect x="{x:.1f}" y="0" width="{w:.1f}" height="{height}" rx="4" fill="{color}"><title>{title}</title></rect>')
        if pct > 10:
            parts.append(
                f'<text x="{x + w / 2:.1f}" y="{height / 2 + 5}" text-anchor="middle" '
                f'font-size="12" font-weight="600" fill="#fff">{pct:.0f}%</text>'
            )
        x += w + gap
    svg = f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" role="img">{"".join(parts)}</svg>'
    legend = "".join(
        f'<span class="legend-item"><i style="background:{color}"></i>{esc(label)} - {fmt_money(value)}</span>'
        for label, value, color in segments
    )
    return f'<div class="chart-wrap">{svg}<div class="chart-legend">{legend}</div></div>'


def svg_horizontal_bar(data: list, width: int = 640, bar_height: int = 24, gap: int = 14, color: str = None) -> str:
    """data: [(label, value), ...]"""
    color = color or PALETTE["blue"]
    if not data:
        return '<p class="chart-empty">No spending in this category.</p>'
    max_val = max(v for _, v in data) or 1
    label_w = 170
    plot_w = width - label_w - 70
    height = len(data) * (bar_height + gap) + gap
    parts = []
    for i, (label, value) in enumerate(data):
        y = gap + i * (bar_height + gap)
        bar_w = max((value / max_val) * plot_w, 2)
        parts.append(
            f'<text x="{label_w - 10}" y="{y + bar_height / 2 + 4}" text-anchor="end" '
            f'font-size="11" fill="{PALETTE["text_muted"]}">{esc(label)}</text>'
        )
        parts.append(f'<rect x="{label_w}" y="{y}" width="{plot_w}" height="{bar_height}" rx="4" fill="{PALETTE["gridline"]}"/>')
        parts.append(
            f'<rect x="{label_w}" y="{y}" width="{bar_w:.1f}" height="{bar_height}" rx="4" fill="{color}">'
            f"<title>{esc(label)}: {fmt_money(value)}</title></rect>"
        )
        parts.append(
            f'<text x="{label_w + bar_w + 8:.1f}" y="{y + bar_height / 2 + 4}" '
            f'font-size="12" font-weight="600" fill="{PALETTE["text_primary"]}">{fmt_money(value)}</text>'
        )
    svg = f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" role="img">{"".join(parts)}</svg>'
    return f'<div class="chart-wrap">{svg}</div>'


def svg_trend_stacked_bars(months_data: list, width: int = 640, height: int = 260) -> str:
    """months_data: [{'label': str, 'fixed':.., 'investments':.., 'savings':.., 'guiltfree':..}, ...]"""
    if not months_data:
        return '<p class="chart-empty">Not enough monthly data yet.</p>'
    order = ["fixed", "investments", "savings", "guiltfree"]
    max_total = max(sum(max(m[k], 0) for k in order) for m in months_data) or 1
    plot_h = height - 40
    bar_w = 28
    slot = width / len(months_data)
    gap = 2
    parts = []
    for i, m in enumerate(months_data):
        cx = i * slot + slot / 2
        x = cx - bar_w / 2
        y_cursor = plot_h
        for k in order:
            v = max(m[k], 0)
            h = (v / max_total) * plot_h
            y = y_cursor - h
            parts.append(
                f'<rect x="{x:.1f}" y="{max(y,0):.1f}" width="{bar_w}" height="{max(h - gap, 0):.1f}" '
                f'rx="4" fill="{GROUP_COLOR[k]}"><title>{m["label"]} {k}: {fmt_money(m[k])}</title></rect>'
            )
            y_cursor -= h
        parts.append(
            f'<text x="{cx:.1f}" y="{height - 8}" text-anchor="middle" font-size="11" '
            f'fill="{PALETTE["text_muted"]}">{esc(m["label"])}</text>'
        )
    svg = f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" role="img">{"".join(parts)}</svg>'
    labels = {"fixed": "Fixed Costs", "investments": "Investments", "savings": "Savings", "guiltfree": "Guilt-Free Spending"}
    legend = "".join(
        f'<span class="legend-item"><i style="background:{GROUP_COLOR[k]}"></i>{labels[k]}</span>' for k in order
    )
    return f'<div class="chart-wrap">{svg}<div class="chart-legend">{legend}</div></div>'


def svg_line_chart(points: list, width: int = 640, height: int = 200) -> str:
    """points: [(label, value_pct_or_none), ...]"""
    points = [p for p in points if p[1] is not None]
    if len(points) < 2:
        return '<p class="chart-empty">Need at least two months to show a trend.</p>'
    pad_l, pad_b, pad_t = 46, 26, 16
    plot_w = width - pad_l - 10
    plot_h = height - pad_b - pad_t
    values = [v for _, v in points]
    v_min = min(0, *values)
    v_max = max(values + [1])
    v_range = (v_max - v_min) or 1

    def x_at(i):
        return pad_l + (i / (len(points) - 1)) * plot_w

    def y_at(v):
        return pad_t + plot_h - ((v - v_min) / v_range) * plot_h

    zero_y = y_at(0)
    parts = [f'<line x1="{pad_l}" x2="{width-10}" y1="{zero_y:.1f}" y2="{zero_y:.1f}" stroke="{PALETTE["baseline"]}" stroke-width="1"/>']
    path = " ".join(f'{"M" if i == 0 else "L"} {x_at(i):.1f} {y_at(v):.1f}' for i, (_, v) in enumerate(points))
    parts.append(f'<path d="{path}" fill="none" stroke="{PALETTE["blue"]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>')
    for i, (label, v) in enumerate(points):
        cx, cy = x_at(i), y_at(v)
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="5" fill="{PALETTE["blue"]}" stroke="{PALETTE["surface"]}" stroke-width="2"><title>{esc(label)}: {v:.1f}%</title></circle>')
        parts.append(f'<text x="{cx:.1f}" y="{height-6}" text-anchor="middle" font-size="11" fill="{PALETTE["text_muted"]}">{esc(label)}</text>')
        if i == len(points) - 1:
            parts.append(f'<text x="{cx:.1f}" y="{cy-12:.1f}" text-anchor="middle" font-size="12" font-weight="600" fill="{PALETTE["text_primary"]}">{v:.1f}%</text>')
    svg = f'<svg viewBox="0 0 {width} {height}" width="100%" height="{height}" role="img">{"".join(parts)}</svg>'
    return f'<div class="chart-wrap">{svg}</div>'


# ---------- HTML ----------

STYLE = """
<style>
:root{color-scheme:light;--surface:#fcfcfb;--page:#f9f9f7;--card:#ffffff;--text:#0b0b0b;--text2:#52514e;
--muted:#898781;--grid:#e1e0d9;--border:rgba(11,11,11,0.10);--good:#006300;--bad:#d03b3b}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--page);color:var(--text)}
header{padding:20px 28px;border-bottom:1px solid var(--border);background:var(--card)}
header h1{margin:0;font-size:1.3rem}
header p{margin:4px 0 0;color:var(--text2);font-size:0.9rem}
main{max-width:960px;margin:0 auto;padding:24px}
h2{font-size:1.05rem;margin:0 0 12px}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:20px}
.kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.stat-tile{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.stat-tile .label{color:var(--text2);font-size:0.8rem}
.stat-tile .value{font-size:1.4rem;font-weight:600;margin-top:4px}
.stat-tile .sub{font-size:0.78rem;color:var(--muted);margin-top:3px}
table{width:100%;border-collapse:collapse;font-size:0.87rem}
th,td{text-align:left;padding:7px 9px;border-bottom:1px solid var(--grid)}
th{color:var(--text2);font-weight:600;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.02em}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:0.76rem;background:var(--grid)}
.chart-legend{display:flex;gap:16px;margin-top:10px;flex-wrap:wrap}
.legend-item{font-size:0.8rem;color:var(--text2);display:inline-flex;align-items:center;gap:6px}
.legend-item i{width:10px;height:10px;border-radius:3px;display:inline-block}
.chart-empty{color:var(--muted);font-size:0.87rem}
.chart-wrap{overflow-x:auto}
.note{font-size:0.8rem;color:var(--muted);margin-top:24px;text-align:center;padding-bottom:20px}
.unalloc.good{color:var(--good)} .unalloc.bad{color:var(--bad)}
</style>
"""


def render_report(df: pd.DataFrame, key: str, all_months: list, config: dict) -> str:
    s = compute_summary(df, key, config)
    fixed_cats = category_breakdown(df, key, "fixed")
    guiltfree_cats = category_breakdown(df, key, "guiltfree")
    merchants = top_merchants(df, key)

    trend_months = last_n_months(all_months, 6)
    trend_data = []
    rate_points = []
    for m in trend_months:
        ms = compute_summary(df, m, config)
        trend_data.append({"label": month_label(m), "fixed": ms["fixed"], "investments": ms["investments"], "savings": ms["savings"], "guiltfree": ms["guiltfree"]})
        rate_points.append((month_label(m), ms["wealth_building_rate"]))

    unalloc_class = "good" if s["unallocated"] >= 0 else "bad"
    unalloc_note = "unallocated (still in checking)" if s["unallocated"] >= 0 else "over take-home pay this month"

    kpis = f"""
    <div class="kpi-row">
      <div class="stat-tile"><div class="label">Total Take Home Pay</div><div class="value">{fmt_money(s['take_home_pay'])}</div></div>
      <div class="stat-tile"><div class="label">Fixed Costs</div><div class="value">{fmt_money(s['fixed'])}</div></div>
      <div class="stat-tile"><div class="label">Investments</div><div class="value">{fmt_money(s['investments'])}</div></div>
      <div class="stat-tile"><div class="label">Savings</div><div class="value">{fmt_money(s['savings'])}</div></div>
      <div class="stat-tile"><div class="label">Guilt-Free Spending</div><div class="value">{fmt_money(s['guiltfree'])}</div></div>
      <div class="stat-tile"><div class="label">Wealth-Building Rate</div><div class="value">{f"{s['wealth_building_rate']:.1f}%" if s['wealth_building_rate'] is not None else "-"}</div><div class="sub">Net Savings + Investments (after overspend) / Take Home Pay</div></div>
    </div>
    <p class="chart-empty"><span class="unalloc {unalloc_class}">{fmt_money(s['unallocated'])} {unalloc_note}</span></p>
    """

    split_segments = [
        ("Fixed Costs", max(s["fixed"], 0), GROUP_COLOR["fixed"]),
        ("Investments", max(s["investments"], 0), GROUP_COLOR["investments"]),
        ("Savings", max(s["savings"], 0), GROUP_COLOR["savings"]),
        ("Guilt-Free Spending", max(s["guiltfree"], 0), GROUP_COLOR["guiltfree"]),
    ]

    merchants_html = "<p class='chart-empty'>No spending this month.</p>"
    if merchants:
        rows = "".join(
            f"<tr><td>{esc(m['description'])}</td><td><span class='badge'>{esc(m['category'])}</span></td>"
            f"<td class='num'>{m['count']}</td><td class='num'>{fmt_money(m['total'])}</td></tr>"
            for m in merchants
        )
        merchants_html = f"""<table><thead><tr><th>Merchant</th><th>Category</th><th class="num">Transactions</th><th class="num">Total</th></tr></thead><tbody>{rows}</tbody></table>"""

    month_options = "".join(
        f'<option value="{m}"{" selected" if m == key else ""}>{month_label(m)}</option>' for m in reversed(all_months)
    )

    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Spending Report - {month_label(key)}</title>{STYLE}</head>
<body>
<header>
  <h1>Spending Report - {month_label(key)}</h1>
  <p>Generated from {len(df)} categorized transactions. Other months: {month_options and '<select onchange="location.href=this.value+&quot;_report.html&quot;">' + month_options + '</select>'}</p>
</header>
<main>
  {kpis}
  <div class="card"><h2>Take-Home Pay Allocation</h2>{svg_split_bar(split_segments)}</div>
  <div class="card"><h2>Fixed Costs by Category</h2>{svg_horizontal_bar(fixed_cats, color=GROUP_COLOR['fixed'])}</div>
  <div class="card"><h2>Guilt-Free Spending by Category</h2>{svg_horizontal_bar(guiltfree_cats, color=GROUP_COLOR['guiltfree'])}</div>
  <div class="card"><h2>Allocation - Last {len(trend_months)} Months</h2>{svg_trend_stacked_bars(trend_data)}</div>
  <div class="card"><h2>Wealth-Building Rate - Last {len(trend_months)} Months</h2>{svg_line_chart(rate_points)}</div>
  <div class="card"><h2>Top Guilt-Free Merchants</h2>{merchants_html}</div>
</main>
<p class="note">Generated locally - this file lives on your machine only.</p>
</body></html>"""


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=Path("data/categorized_transactions.csv"))
    parser.add_argument("--config", type=Path, default=Path("report_config.yaml"))
    parser.add_argument("--output-dir", type=Path, default=Path("reports"))
    parser.add_argument("--month", type=str, default=None, help="YYYY-MM; defaults to the latest month present")
    parser.add_argument("--all", action="store_true", help="Generate a report for every month present")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Error: {args.input} not found. Run categorize first: python -m spending_agent.categorize")

    df = pd.read_csv(args.input, dtype={"id": str}, keep_default_na=False, encoding="utf-8")
    df["amount"] = pd.to_numeric(df["amount"])
    all_months = list_months(df)
    if not all_months:
        raise SystemExit("Error: no transactions found.")

    config = load_report_config(args.config)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    targets = all_months if args.all else [args.month or all_months[-1]]
    for key in targets:
        if key not in all_months:
            print(f"Skipping {key}: no transactions in that month.")
            continue
        html = render_report(df, key, all_months, config)
        out_path = args.output_dir / f"{key}_report.html"
        out_path.write_text(html, encoding="utf-8")
        s = compute_summary(df, key, config)
        print(
            f"{key}: Take Home {fmt_money(s['take_home_pay'])} | Fixed {fmt_money(s['fixed'])} | "
            f"Investments {fmt_money(s['investments'])} | Savings {fmt_money(s['savings'])} | "
            f"Guilt-Free {fmt_money(s['guiltfree'])} -> {out_path}"
        )


if __name__ == "__main__":
    main()
