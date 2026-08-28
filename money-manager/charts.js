// Small hand-rolled SVG chart builders — no charting library, keeps the
// app fully offline. Follows the house dataviz rules: thin marks, 4px
// rounded bar ends, one hue for magnitude, a fixed 2-color order for
// Fixed vs Guilt-Free, direct labels, hover tooltips.

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function makeTooltip(container) {
  const tip = document.createElement('div');
  tip.className = 'chart-tooltip';
  tip.hidden = true;
  container.appendChild(tip);
  return {
    show(html, x, y) {
      tip.innerHTML = html;
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.hidden = false;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

// Horizontal bar chart, single sequential hue, sorted by caller.
// data: [{label, value}]
export function horizontalBarChart(data, { width = 640, barHeight = 24, gap = 14, color = 'var(--series-1)' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  if (!data.length) {
    wrap.innerHTML = '<p class="chart-empty">No spending yet.</p>';
    return wrap;
  }
  const max = Math.max(...data.map((d) => d.value), 1);
  const labelWidth = 150;
  const plotWidth = width - labelWidth - 70;
  const height = data.length * (barHeight + gap) + gap;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });
  const tooltip = makeTooltip(wrap);

  data.forEach((d, i) => {
    const y = gap + i * (barHeight + gap);
    const barW = Math.max((d.value / max) * plotWidth, 2);

    const label = el('text', {
      x: labelWidth - 10,
      y: y + barHeight / 2 + 4,
      'text-anchor': 'end',
      class: 'chart-axis-label',
    });
    label.textContent = d.label;
    svg.appendChild(label);

    const track = el('rect', {
      x: labelWidth,
      y,
      width: plotWidth,
      height: barHeight,
      rx: 4,
      class: 'chart-track',
    });
    svg.appendChild(track);

    const bar = el('rect', {
      x: labelWidth,
      y,
      width: barW,
      height: barHeight,
      rx: 4,
      fill: color,
      class: 'chart-hover-target',
    });
    bar.addEventListener('mousemove', (ev) => {
      const rect = wrap.getBoundingClientRect();
      tooltip.show(`<strong>${d.label}</strong><br>${fmtMoney(d.value)}`, ev.clientX - rect.left + 12, ev.clientY - rect.top - 8);
    });
    bar.addEventListener('mouseleave', () => tooltip.hide());
    svg.appendChild(bar);

    const value = el('text', {
      x: labelWidth + barW + 8,
      y: y + barHeight / 2 + 4,
      class: 'chart-value-label',
    });
    value.textContent = fmtMoney(d.value);
    svg.appendChild(value);
  });

  wrap.appendChild(svg);
  return wrap;
}

// Full-width single stacked bar split into 2+ segments. Used for the
// Fixed vs Guilt-Free part-to-whole view.
export function splitBar(segments, { width = 640, height = 48 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });
  const tooltip = makeTooltip(wrap);
  const gapPx = 2;
  let x = 0;
  segments.forEach((seg) => {
    const w = Math.max((seg.value / total) * width - gapPx, 0);
    const rect = el('rect', { x, y: 0, width: w, height, rx: 4, fill: seg.color, class: 'chart-hover-target' });
    rect.addEventListener('mousemove', (ev) => {
      const r = wrap.getBoundingClientRect();
      const pct = ((seg.value / total) * 100).toFixed(0);
      tooltip.show(`<strong>${seg.label}</strong><br>${fmtMoney(seg.value)} (${pct}%)`, ev.clientX - r.left + 12, ev.clientY - r.top - 8);
    });
    rect.addEventListener('mouseleave', () => tooltip.hide());
    svg.appendChild(rect);

    const pct = (seg.value / total) * 100;
    if (pct > 12) {
      const label = el('text', { x: x + w / 2, y: height / 2 + 5, 'text-anchor': 'middle', class: 'chart-inline-label' });
      label.textContent = `${pct.toFixed(0)}%`;
      svg.appendChild(label);
    }
    x += w + gapPx;
  });
  wrap.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  segments.forEach((seg) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<i style="background:${seg.color}"></i>${seg.label} — ${fmtMoney(seg.value)}`;
    legend.appendChild(item);
  });
  wrap.appendChild(legend);
  return wrap;
}

// Grouped stacked bars over time — one stacked bar per month, 2 series
// (Fixed, Guilt-Free). months: [{label, fixed, guiltfree}]
export function stackedBarsOverTime(months, { width = 640, height = 220 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  if (!months.length) {
    wrap.innerHTML = '<p class="chart-empty">Not enough monthly data yet.</p>';
    return wrap;
  }
  const max = Math.max(...months.map((m) => m.fixed + m.guiltfree), 1);
  const plotH = height - 30;
  const barW = 24;
  const slot = width / months.length;
  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });
  const tooltip = makeTooltip(wrap);
  const gapPx = 2;

  months.forEach((m, i) => {
    const cx = i * slot + slot / 2;
    const x = cx - barW / 2;
    const fixedH = (m.fixed / max) * plotH;
    const gfH = (m.guiltfree / max) * plotH;

    const gfY = plotH - gfH;
    const gf = el('rect', { x, y: gfY, width: barW, height: Math.max(gfH - gapPx, 0), rx: 4, fill: 'var(--series-2)', class: 'chart-hover-target' });
    gf.addEventListener('mousemove', (ev) => {
      const r = wrap.getBoundingClientRect();
      tooltip.show(`<strong>${m.label}</strong><br>Guilt-Free: ${fmtMoney(m.guiltfree)}`, ev.clientX - r.left + 12, ev.clientY - r.top - 8);
    });
    gf.addEventListener('mouseleave', () => tooltip.hide());
    svg.appendChild(gf);

    const fixedY = gfY - fixedH - gapPx;
    const fx = el('rect', { x, y: Math.max(fixedY, 0), width: barW, height: Math.max(fixedH - gapPx, 0), rx: 4, fill: 'var(--series-1)', class: 'chart-hover-target' });
    fx.addEventListener('mousemove', (ev) => {
      const r = wrap.getBoundingClientRect();
      tooltip.show(`<strong>${m.label}</strong><br>Fixed: ${fmtMoney(m.fixed)}`, ev.clientX - r.left + 12, ev.clientY - r.top - 8);
    });
    fx.addEventListener('mouseleave', () => tooltip.hide());
    svg.appendChild(fx);

    const label = el('text', { x: cx, y: height - 8, 'text-anchor': 'middle', class: 'chart-axis-label' });
    label.textContent = m.label;
    svg.appendChild(label);
  });

  wrap.appendChild(svg);
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  legend.innerHTML = `<span class="legend-item"><i style="background:var(--series-1)"></i>Fixed Costs</span><span class="legend-item"><i style="background:var(--series-2)"></i>Guilt-Free Spending</span>`;
  wrap.appendChild(legend);
  return wrap;
}

// Single-series line chart for savings rate % over time.
// points: [{label, value}] value in percent.
export function lineChart(points, { width = 640, height = 200 } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  if (points.length < 2) {
    wrap.innerHTML = '<p class="chart-empty">Need at least two months to show a trend.</p>';
    return wrap;
  }
  const padL = 46;
  const padB = 26;
  const padT = 16;
  const plotW = width - padL - 10;
  const plotH = height - padB - padT;
  const values = points.map((p) => p.value);
  const min = Math.min(0, ...values);
  const max = Math.max(...values, 1);
  const range = max - min || 1;

  const xAt = (i) => padL + (i / (points.length - 1)) * plotW;
  const yAt = (v) => padT + plotH - ((v - min) / range) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });
  const tooltip = makeTooltip(wrap);

  // gridline + zero baseline
  const zeroY = yAt(0);
  svg.appendChild(el('line', { x1: padL, x2: width - 10, y1: zeroY, y2: zeroY, class: 'chart-baseline' }));

  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i)} ${yAt(p.value)}`).join(' ');
  svg.appendChild(el('path', { d, fill: 'none', stroke: 'var(--series-1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  points.forEach((p, i) => {
    const cx = xAt(i);
    const cy = yAt(p.value);
    const dot = el('circle', { cx, cy, r: 5, fill: 'var(--series-1)', stroke: 'var(--surface-1)', 'stroke-width': 2, class: 'chart-hover-target' });
    dot.addEventListener('mousemove', (ev) => {
      const r = wrap.getBoundingClientRect();
      tooltip.show(`<strong>${p.label}</strong><br>${p.value.toFixed(1)}%`, ev.clientX - r.left + 12, ev.clientY - r.top - 8);
    });
    dot.addEventListener('mouseleave', () => tooltip.hide());
    svg.appendChild(dot);

    const label = el('text', { x: cx, y: height - 6, 'text-anchor': 'middle', class: 'chart-axis-label' });
    label.textContent = p.label;
    svg.appendChild(label);

    if (i === points.length - 1) {
      const endLabel = el('text', { x: cx, y: cy - 12, 'text-anchor': 'middle', class: 'chart-value-label' });
      endLabel.textContent = `${p.value.toFixed(1)}%`;
      svg.appendChild(endLabel);
    }
  });

  wrap.appendChild(svg);
  return wrap;
}
