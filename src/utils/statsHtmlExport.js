// مرحلهٔ ۴۶ §۲ — گزارشِ HTMLِ مستقلِ آماربندی (src/utils/statsHtmlExport.js).
// یک تابعِ خالص که از رویِ اسنپ‌شاتِ آماربندی، یک رشتهٔ HTMLِ کامل و
// مستقل می‌سازد: بدونِ هیچ منبعِ خارجی (بدونِ CDN، بدونِ فونتِ خارجی،
// بدونِ شبکه)؛ با همان ۶ نمودارِ SVG و همان طراحیِ نئونِ داشبوردِ
// درون‌برنامه‌ایِ ProfileView (مرحلهٔ ۴۴ §۲، CSS و منطقِ DASH44).
// پی‌لودِ واردات هم در خودِ فایل جاسازی می‌شود تا همین فایل، بعداً
// دوباره به‌عنوانِ آماربندی وارد شود.
// قراردادِ اسنپ‌شات (ساختهٔ ProfileView، تغییر نمی‌کند):
//   { format: 'comic-reader-stat-view-html-v1', exportedAt,
//     statView: { id, name, color, bookKeys, metrics, goalHours, goalPages },
//     snapshotData: { days, notesByDay, books, aptitude, summary, goal } }
// همهٔ مشتق‌ها (گیج‌ها، وافلی، ساعت، تراس، روبان) در همین‌جا از رویِ
// دادهٔ خام حساب می‌شوند؛ دادهٔ خالی، حالتِ خالیِ صادقانه می‌دهد،
// نه عددِ ساختگی، و هیچ‌جا تقسیم بر صفر رخ نمی‌دهد.

export const STATS_HTML_FORMAT = 'comic-reader-stat-view-html-v1';

const PAYLOAD_SCRIPT_ID = 'cr-exported-stat-view-payload';

const VIEW_COLORS = ['#22d3ee', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#f97316'];
const DASH44_ACC = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#fb7185'];

const DUAL_METRICS = [
  { id: 'minutes', label: 'زمان مطالعه', unit: 'دقیقه' },
  { id: 'pages', label: 'صفحات خوانده‌شده', unit: 'صفحه' },
  { id: 'marks', label: 'یادداشت‌ها و بوک‌مارک‌ها', unit: 'نشانه' },
  { id: 'speed', label: 'سرعت مطالعه (صفحه بر ساعت)', unit: 'صفحه در ساعت' },
];
const DUAL_RANGES = [7, 14, 30, 90];

const WEEKDAY_LABELS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toNonNeg(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function toNonNegInt(value) {
  return Math.floor(toNonNeg(value));
}

function toStr(value) {
  return typeof value === 'string' ? value : '';
}

function clampScore(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(value))));
}

function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localDateKey(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

// سریِ روند برای N روزِ اخیرِ تقویمی (محلی) — همان buildTrendSeries در
// ProfileView؛ marks از notesByDay می‌آید و speed از pages/hours همان روز.
function buildTrendSeries(daysMap, n, metric, notesByDay) {
  const out = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = localDateKey(d);
    const entry = (daysMap && daysMap[key]) || {};
    const minutes = Math.round(toNonNeg(entry.seconds) / 60);
    const pages = toNonNeg(entry.pages);
    const marks = (notesByDay && notesByDay[key]) || 0;
    const speed = toNonNeg(entry.seconds) > 0 ? pages / (toNonNeg(entry.seconds) / 3600) : 0;
    const value = metric === 'pages' ? pages : (metric === 'marks' ? marks : (metric === 'speed' ? speed : minutes));
    out.push({ key, label: key.slice(5).replace('-', '/'), value, minutes, pages, marks, speed });
  }
  return out;
}

// منحنیِ هموارِ Catmull-Rom به بزیر — همان buildSmoothPath در ProfileView.
function buildSmoothPath(pts) {
  if (pts.length === 0) return '';
  if (pts.length === 1) return 'M ' + pts[0].x + ' ' + pts[0].y;
  let d = 'M ' + pts[0].x + ' ' + pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ' C ' + c1x + ' ' + c1y + ', ' + c2x + ' ' + c2y + ', ' + p2.x + ' ' + p2.y;
  }
  return d;
}

// کمانِ SVG بینِ دو زاویه — همان dashArcPath در ProfileView.
function dashArcPath(cx, cy, r, a0, a1) {
  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const laf = (a1 - a0) > Math.PI ? 1 : 0;
  return 'M' + x0.toFixed(1) + ',' + y0.toFixed(1) + ' A' + r + ',' + r + ' 0 ' + laf + ' 1 ' + x1.toFixed(1) + ',' + y1.toFixed(1);
}

// تخصیصِ کاشی‌هایِ وافلی با الگوریتمِ باقیماندهٔ بزرگ‌تر: دقیقاً ۱۰۰ کاشی.
// همان largestRemainderTiles در ProfileView.
function largestRemainderTiles(values, total) {
  const out = new Array(100).fill(-1);
  const safeTotal = Math.max(0, Number(total) || 0);
  const vals = (values || []).map((v) => Math.max(0, Number(v) || 0));
  if (safeTotal <= 0 || vals.length === 0) return out;
  const exact = vals.map((v) => (v / safeTotal) * 100);
  const floors = exact.map((e) => Math.floor(e));
  let assigned = floors.reduce((s, f) => s + f, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  let k = 0;
  while (assigned < 100 && k < order.length) {
    floors[order[k].i] += 1;
    assigned += 1;
    k += 1;
  }
  let t = 0;
  floors.forEach((count, bi) => {
    for (let j = 0; j < count && t < 100; j++) {
      out[t] = bi;
      t += 1;
    }
  });
  return out;
}

// میانگینِ متحرکِ ۳ روزه — همان movingAverage3 در ProfileView.
function movingAverage3(values) {
  const arr = (values || []).map((v) => Number(v) || 0);
  return arr.map((v, i) => {
    const win = arr.slice(Math.max(0, i - 2), i + 1);
    return win.reduce((s, x) => s + x, 0) / Math.max(1, win.length);
  });
}

// سقفِ محورِ عمودیِ نمودارِ ۶ — همان dualScaleMax در ProfileView.
function dualScaleMax(maxV) {
  const m = Math.max(0, Number(maxV) || 0);
  return Math.max(50, Math.ceil(m / 50) * 50);
}

// شعاعِ تیکِ ساعتِ ماه — همان clockRadiusFor در ProfileView.
function clockRadiusFor(minutes) {
  return 70 + Math.min(180, Math.max(0, Number(minutes) || 0)) * 0.55;
}

// مسیرِ پلکانیِ تراس — همان terracePaths در ProfileView.
function terracePaths(week, mx) {
  if (!week || week.length === 0) return { ys: [], stroke: '', fill: '' };
  const safeMx = Math.max(1, Number(mx) || 0);
  const ys = week.map((w) => 222 - ((Number(w.minutes) || 0) / safeMx) * 168);
  let stroke = 'M960,' + ys[0];
  let fill = 'M960,232 L960,' + ys[0];
  for (let i = 0; i < 7; i++) {
    const xr = 940 - i * 132;
    const xl = xr - 132;
    if (i) stroke += ' L' + xr + ',' + ys[i];
    stroke += ' L' + xl + ',' + ys[i];
    fill += ' L' + xr + ',' + ys[i] + ' L' + xl + ',' + ys[i];
  }
  fill += ' L36,232 Z';
  return { ys, stroke, fill };
}

// عدد، بدونِ اعشارِ اضافی — همان dashFormatNum در ProfileView.
function dashFormatNum(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// نرمال‌سازیِ دفاعیِ اسنپ‌شات: فیلدِ گم‌شده یا بدریخت، مقدارِ امنِ
// پیش‌فرض می‌گیرد و هیچ‌وقت استثنا پرتاب نمی‌کند. فیلدهایِ ناشناخته
// با spread حفظ می‌شوند تا دورِ رفت‌وبرگشتِ پی‌لود دقیق بماند.
function normalizeSnapshot(snapshot) {
  const src = isPlainObject(snapshot) ? snapshot : {};
  const data = isPlainObject(src.snapshotData) ? src.snapshotData : {};
  const rawView = isPlainObject(src.statView) ? src.statView : {};

  const days = {};
  if (isPlainObject(data.days)) {
    for (const [key, entry] of Object.entries(data.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const e = isPlainObject(entry) ? entry : {};
      days[key] = { ...e, seconds: toNonNeg(e.seconds), pages: toNonNeg(e.pages) };
    }
  }
  const notesByDay = {};
  if (isPlainObject(data.notesByDay)) {
    for (const [key, value] of Object.entries(data.notesByDay)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      notesByDay[key] = toNonNegInt(value);
    }
  }
  const books = Array.isArray(data.books) ? data.books.filter(isPlainObject).map((b, i) => ({
    ...b,
    key: toStr(b.key) || toStr(b.name) || ('book-' + i),
    name: toStr(b.name) || toStr(b.key) || ('کتاب ' + (i + 1)),
    seconds: toNonNeg(b.seconds),
    pages: toNonNeg(b.pages),
    totalPages: toNonNeg(b.totalPages),
  })) : [];
  const aptitude = Array.isArray(data.aptitude) ? data.aptitude.filter(isPlainObject).map((a, i) => ({
    ...a,
    id: toStr(a.id) || ('apt-' + i),
    name: toStr(a.name) || ('شاخص ' + (i + 1)),
    short: toStr(a.short) || toStr(a.name) || ('شاخص ' + (i + 1)),
    value: clampScore(a.value),
    color: toStr(a.color) || DASH44_ACC[i % DASH44_ACC.length],
    desc: toStr(a.desc),
  })) : [];
  const rawSummary = isPlainObject(data.summary) ? data.summary : {};
  const summarySeconds = toNonNeg(rawSummary.seconds);
  const summary = {
    ...rawSummary,
    seconds: summarySeconds,
    pages: toNonNeg(rawSummary.pages),
    hours: Number.isFinite(Number(rawSummary.hours)) ? Number(rawSummary.hours) : summarySeconds / 3600,
    speed: toNonNeg(rawSummary.speed),
    progress: toNonNeg(rawSummary.progress),
    bookmarks: toNonNegInt(rawSummary.bookmarks),
    highlights: toNonNegInt(rawSummary.highlights),
    totalBooks: toNonNegInt(rawSummary.totalBooks),
    finishedBooks: toNonNegInt(rawSummary.finishedBooks),
    currentStreak: toNonNegInt(rawSummary.currentStreak),
    bestStreak: toNonNegInt(rawSummary.bestStreak),
    todayPages: toNonNegInt(rawSummary.todayPages),
    todaySeconds: toNonNeg(rawSummary.todaySeconds),
    todayGoalPages: toNonNegInt(rawSummary.todayGoalPages),
  };
  const rawGoal = isPlainObject(data.goal) ? data.goal : null;
  const goal = rawGoal ? {
    ...rawGoal,
    hours: rawGoal.hours == null ? null : toNonNeg(rawGoal.hours),
    pages: rawGoal.pages == null ? null : toNonNegInt(rawGoal.pages),
  } : null;
  const goalHours = rawView.goalHours == null ? null : toNonNeg(rawView.goalHours);
  const goalPages = rawView.goalPages == null ? null : toNonNegInt(rawView.goalPages);
  const statView = {
    ...rawView,
    id: toStr(rawView.id) || 'stat-view',
    name: toStr(rawView.name) || 'آماربندی',
    color: toStr(rawView.color) || '#22d3ee',
    bookKeys: Array.isArray(rawView.bookKeys) ? rawView.bookKeys.filter((k) => typeof k === 'string') : [],
    metrics: Array.isArray(rawView.metrics) ? rawView.metrics : [],
    goalHours,
    goalPages,
  };
  const exportedAt = Number.isFinite(Number(src.exportedAt)) ? Number(src.exportedAt) : Date.now();
  return { statView, days, notesByDay, books, aptitude, summary, goal, exportedAt };
}

// ---------------------------------------------------------------------------
// مشتق‌هایِ ۶ نمودار از رویِ دادهٔ نرمال‌شده (همهٔ فرمول‌ها همانِ ProfileView).
// ---------------------------------------------------------------------------

function deriveDial(norm) {
  const days = buildTrendSeries(norm.days, 7, 'pages', norm.notesByDay);
  const mx = Math.max(1, ...days.map((d) => d.value));
  return days.map((d, i) => ({
    key: d.key,
    label: d.label,
    pages: d.value,
    delta: i === 0 ? null : d.value - days[i - 1].value,
    max: mx,
  }));
}

function deriveBlob(norm) {
  const list = norm.aptitude;
  const c = 170;
  const cy = 160;
  const R = 104;
  const n = list.length;
  if (n === 0) return { list, pts: [], path: '', c, cy, R, n: 0, ax: () => 0 };
  const ax = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pts = list.map((s, i) => [c + Math.cos(ax(i)) * R * (s.value / 100), cy + Math.sin(ax(i)) * R * (s.value / 100)]);
  let path = '';
  if (n >= 3) {
    path = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n];
      const p1 = pts[i];
      const p2 = pts[(i + 1) % n];
      const p3 = pts[(i + 2) % n];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6;
      const c1y = p1[1] + (p2[1] - p0[1]) / 6;
      const c2x = p2[0] - (p3[0] - p1[0]) / 6;
      const c2y = p2[1] - (p3[1] - p1[1]) / 6;
      path += ' C' + c1x.toFixed(1) + ',' + c1y.toFixed(1) + ' ' + c2x.toFixed(1) + ',' + c2y.toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    path += 'Z';
  }
  return { list, pts, path, c, cy, R, n, ax };
}

function deriveWaffle(norm) {
  const entries = norm.books.filter((e) => e.seconds > 0 || e.pages > 0);
  const totalSeconds = entries.reduce((s, e) => s + e.seconds, 0);
  const tiles = largestRemainderTiles(entries.map((e) => e.seconds), totalSeconds);
  return { entries, totalSeconds, totalMinutes: Math.round(totalSeconds / 60), tiles };
}

function deriveClock(norm) {
  const days = buildTrendSeries(norm.days, 30, 'minutes', norm.notesByDay).map((d) => ({ key: d.key, label: d.label, minutes: Math.max(0, d.minutes || 0) }));
  const total = days.reduce((s, d) => s + d.minutes, 0);
  const active = days.filter((d) => d.minutes > 0).length;
  let maxV = 0;
  let maxI = 0;
  days.forEach((d, i) => {
    if (d.minutes > maxV) { maxV = d.minutes; maxI = i; }
  });
  return { days, total, active, maxV, maxI };
}

function deriveTerrace(norm) {
  const sums = WEEKDAY_ORDER.map(() => ({ seconds: 0, pages: 0 }));
  for (const [key, e] of Object.entries(norm.days || {})) {
    const d = new Date(key + 'T00:00:00');
    if (Number.isNaN(d.getTime())) continue;
    const idx = WEEKDAY_ORDER.indexOf(d.getDay());
    if (idx < 0) continue;
    sums[idx].seconds += toNonNeg(e.seconds);
    sums[idx].pages += toNonNeg(e.pages);
  }
  const dow = sums.map((s, i) => ({ label: WEEKDAY_LABELS[i], minutes: Math.round(s.seconds / 60), pages: s.pages, seconds: s.seconds }));
  const dowMax = Math.max(1, ...dow.map((d) => d.minutes));
  const best = dow.reduce((bestSoFar, cur) => (cur.minutes > (bestSoFar ? bestSoFar.minutes : 0) ? cur : bestSoFar), null);
  return { dow, dowMax, best, geom: terracePaths(dow, dowMax) };
}

function deriveDual(norm, metricIdx, rangeIdx) {
  const metric = DUAL_METRICS[metricIdx] || DUAL_METRICS[0];
  const range = DUAL_RANGES[rangeIdx] || DUAL_RANGES[0];
  const trend = buildTrendSeries(norm.days, range, metric.id, norm.notesByDay);
  const a = trend.map((d) => d.value);
  const b = movingAverage3(a);
  const scale = dualScaleMax(Math.max(1, ...a, ...b));
  const n = trend.length;
  const W = 1000;
  const H = 360;
  const P = 40;
  const base = H - 40;
  const sc = 240 / Math.max(1, scale);
  const step = n > 1 ? (W - 2 * P) / (n - 1) : 0;
  const pts = (vals) => vals.map((v, i) => ({ x: P + i * step, y: base - v * sc }));
  const pa = pts(a);
  const pb = pts(b);
  const lineA = buildSmoothPath(pa);
  const lineB = buildSmoothPath(pb);
  const areaA = pa.length > 0 ? lineA + ' L ' + pa[pa.length - 1].x + ' ' + base + ' L ' + pa[0].x + ' ' + base + ' Z' : '';
  const areaB = pb.length > 0 ? lineB + ' L ' + pb[pb.length - 1].x + ' ' + base + ' L ' + pb[0].x + ' ' + base + ' Z' : '';
  return { trend, a, b, metric, scale, step, base, pa, pb, lineA, lineB, areaA, areaB };
}

// ---------------------------------------------------------------------------
// رندرِ سمتِ سرورِ ۶ نمودار (رشتهٔ SVG/HTML؛ همان ساختارِ JSX در ProfileView).
// عددهایِ شمارنده با data-cu نشانه‌گذاری می‌شوند تا اسکریپتِ صفحه،
// Count-Up را رویِ همان عددِ نهایی اجرا کند.
// ---------------------------------------------------------------------------

function renderDialSection(dial) {
  const gauges = [...dial].reverse().map((d, ri) => {
    const cx = 930 - ri * 140;
    const cy = 95;
    const R = 52;
    const a0 = Math.PI * 0.75;
    const sw = Math.PI * 1.5 * (d.pages / Math.max(1, d.max));
    const len = R * sw;
    const acc = DASH44_ACC[ri % DASH44_ACC.length];
    const deltaTxt = d.delta === null ? '' : (d.delta >= 0 ? '+' : '−') + Math.abs(d.delta);
    const deltaCol = d.delta === null ? 'var(--c3)' : (d.delta >= 0 ? 'var(--c3)' : 'var(--c5)');
    const ticks = [0, 1, 2, 3, 4].map((k) => {
      const an = a0 + (Math.PI * 1.5 * k) / 4;
      return '<line class="dtick" x1="' + (cx + Math.cos(an) * 60).toFixed(1) + '" y1="' + (cy + Math.sin(an) * 60).toFixed(1) + '" x2="' + (cx + Math.cos(an) * 66).toFixed(1) + '" y2="' + (cy + Math.sin(an) * 66).toFixed(1) + '" />';
    }).join('');
    const arc = sw > 0.02
      ? '<path class="darcGlow" style="--len:' + len.toFixed(1) + ';--d:' + (ri * 100) + 'ms;color:' + acc + ';stroke:currentColor" d="' + dashArcPath(cx, cy, R, a0, a0 + sw) + '" />'
        + '<path class="darc" style="--len:' + len.toFixed(1) + ';--d:' + (ri * 100) + 'ms;color:' + acc + ';stroke:currentColor" d="' + dashArcPath(cx, cy, R, a0, a0 + sw) + '" />'
      : '';
    const delta = deltaTxt
      ? '<text class="ddl" x="' + cx + '" y="' + (cy + 26) + '" text-anchor="middle" fill="' + deltaCol + '">' + deltaTxt + '</text>'
      : '';
    return '<g class="dialG" data-tip="' + escHtml(d.label + ' — ' + d.pages + ' صفحه') + '">'
      + '<path class="dtrack" d="' + dashArcPath(cx, cy, R, a0, a0 + Math.PI * 1.5) + '" />'
      + arc + ticks
      + '<text class="dnum num" x="' + cx + '" y="' + (cy + 8) + '" text-anchor="middle" data-cu="' + d.pages + '">' + d.pages + '</text>'
      + delta
      + '<text x="' + cx + '" y="' + (cy + 88) + '" text-anchor="middle">' + escHtml(d.label) + '</text>'
      + '</g>';
  }).join('');
  return '<section class="card reveal" style="--tag:var(--c1)">'
    + '<h2>نمودار ۱ — گیج‌های هفتهٔ خواندن</h2>'
    + '<p class="mut">هر روز یک گیجِ ۲۷۰ درجه با درجه‌بندی؛ عددِ مرکز = صفحات دقیق، عددِ پایین = تغییر نسبت به روز قبل</p>'
    + '<svg class="chart" viewBox="0 0 1000 210" style="margin-top:16px">' + gauges + '</svg>'
    + '</section>';
}

function renderBlobSection(blob) {
  if (blob.n === 0) {
    return '<section class="card reveal" style="--tag:var(--c2)">'
      + '<h2>نمودار ۲ — بلابِ استعداد و مهارت مطالعه</h2>'
      + '<p class="mut">یک شکل ارگانیک برای پنج شاخص؛ هاور روی رأس‌ها یا کارت‌ها همگام می‌شود.</p>'
      + '<p class="mut">داده‌ای نیست — هنوز شاخصِ استعدادی ثبت نشده است.</p>'
      + '</section>';
  }
  const spokes = blob.list.map((s, i) => {
    const x = blob.c + Math.cos(blob.ax(i)) * blob.R;
    const y = blob.cy + Math.sin(blob.ax(i)) * blob.R;
    return '<line class="bsp" x1="' + blob.c + '" y1="' + blob.cy + '" x2="' + x.toFixed(1) + '" y2="' + y.toFixed(1) + '" />';
  }).join('');
  const grid = [0.33, 0.66, 1].map((f) => '<circle class="bgrid" cx="' + blob.c + '" cy="' + blob.cy + '" r="' + (blob.R * f).toFixed(1) + '" />').join('');
  const vertices = blob.pts.map((p, i) => {
    const s = blob.list[i];
    return '<circle class="bvHalo" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="9" style="--dd:' + (0.45 + i * 0.11).toFixed(2) + 's;stroke:' + escHtml(s.color) + '" data-blob="' + i + '" />'
      + '<circle class="bv" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="5.5" style="--dd:' + (0.45 + i * 0.11).toFixed(2) + 's;stroke:' + escHtml(s.color) + ';color:' + escHtml(s.color) + '" data-blob="' + i + '" data-tip="' + escHtml(s.name + ' — ' + s.value + ' از 100') + '" />';
  }).join('');
  const labels = blob.list.map((s, i) => {
    const x = blob.c + Math.cos(blob.ax(i)) * blob.R * 1.26;
    const y = blob.cy + Math.sin(blob.ax(i)) * blob.R * 1.26;
    const co = Math.cos(blob.ax(i));
    const an = co > 0.35 ? 'start' : (co < -0.35 ? 'end' : 'middle');
    return '<text class="blab" x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="' + an + '" style="--dd:' + (0.45 + i * 0.11).toFixed(2) + 's">' + escHtml(s.short) + '</text>';
  }).join('');
  const poly = blob.path
    ? '<path class="blobGlow" d="' + blob.path + '" stroke="url(#bS)" /><path class="blobP" d="' + blob.path + '" fill="url(#bG)" stroke="url(#bS)" stroke-width="2.5" stroke-linejoin="round" />'
    : '';
  const chips = blob.list.map((s, i) => '<div class="chip" style="--ac:' + escHtml(s.color) + ';--d:' + (0.15 + i * 0.09).toFixed(2) + 's" data-chip="' + i + '"><i></i><div><h4>' + escHtml(s.name) + '</h4><p>' + escHtml(s.desc) + '</p><div class="cbar" style="--w:' + s.value + '%"><i></i></div></div><b class="num" data-cu="' + s.value + '">' + s.value + '</b></div>').join('');
  return '<section class="card reveal" style="--tag:var(--c2)">'
    + '<h2>نمودار ۲ — بلابِ استعداد و مهارت مطالعه</h2>'
    + '<p class="mut">یک شکل ارگانیک برای پنج شاخص؛ هاور روی رأس‌ها یا کارت‌ها همگام می‌شود.</p>'
    + '<div class="blobWrap"><div class="blobRel"><svg class="chart" viewBox="0 0 340 320">'
    + '<defs><linearGradient id="bS" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22d3ee" /><stop offset="1" stop-color="#a78bfa" /></linearGradient>'
    + '<radialGradient id="bG"><stop offset="0" stop-color="rgba(34,211,238,.30)" /><stop offset="1" stop-color="rgba(167,139,250,.10)" /></radialGradient></defs>'
    + '<circle class="spin" cx="' + blob.c + '" cy="' + blob.cy + '" r="132" />'
    + grid + spokes
    + '<g id="bpoly">' + poly + vertices + '</g>'
    + labels
    + '</svg></div><div class="chips">' + chips + '</div></div>'
    + '</section>';
}

function renderWaffleSection(waffle) {
  const tiles = waffle.tiles.map((bi, t) => {
    const row = Math.floor(t / 10);
    const col = 9 - (t % 10);
    const x = 10 + col * 40;
    const y = 10 + row * 40;
    const entry = bi < 0 ? null : waffle.entries[bi];
    const color = bi < 0 ? '#22303c' : DASH44_ACC[bi % DASH44_ACC.length];
    const pct = entry ? Math.round((entry.seconds / Math.max(1, waffle.totalSeconds)) * 100) : 0;
    const tip = entry ? entry.name + ' — ' + pct + '٪ (' + Math.round(entry.seconds / 60) + ' دقیقه)' : 'بدونِ زمانِ ثبت‌شده';
    return '<rect class="wtile" x="' + x + '" y="' + y + '" width="34" height="34" rx="8" fill="' + color + '" fill-opacity="' + (bi < 0 ? 0.35 : 0.7) + '" style="--d:' + (t * 9) + 'ms" data-tip="' + escHtml(tip) + '" />';
  }).join('');
  const legend = waffle.entries.length > 0
    ? waffle.entries.map((e, i) => {
      const pct = Math.round((e.seconds / Math.max(1, waffle.totalSeconds)) * 100);
      const tilesCount = waffle.tiles.filter((bi) => bi === i).length;
      return '<div class="chip" style="--ac:' + DASH44_ACC[i % DASH44_ACC.length] + ';--d:' + (0.2 + i * 0.08).toFixed(2) + 's"><i></i><div><h4>' + escHtml(e.name) + '</h4><p>' + Math.round(e.seconds / 60) + ' دقیقه · ' + tilesCount + ' کاشی</p></div><b class="num">' + pct + '٪</b></div>';
    }).join('')
    : '<p class="mut">هنوز زمانِ ثبت‌شده‌ای برایِ کتاب‌هایِ این آماربندی وجود ندارد؛ پس از چند نشستِ مطالعه، موزاییک این‌جا پر می‌شود.</p>';
  return '<section class="card reveal" style="--tag:var(--c4)">'
    + '<h2>نمودار ۳ — موزاییکِ سهم کتاب‌ها</h2>'
    + '<p class="mut">هر کاشی = دقیقاً ۱٪ از زمان مطالعه؛ مجموع زمان: <b class="num" data-cu="' + waffle.totalMinutes + '">' + waffle.totalMinutes + '</b> دقیقه</p>'
    + '<svg class="chart" viewBox="0 0 410 410" style="margin-top:14px;max-width:430px;margin-inline:auto">' + tiles + '</svg>'
    + '<div class="wleg chips">' + legend + '</div>'
    + '</section>';
}

function renderClockSection(clock, currentStreak) {
  const rings = [60, 120, 180].map((gm) => '<g><circle class="cring" cx="170" cy="170" r="' + clockRadiusFor(gm).toFixed(1) + '" /><text class="glab" x="176" y="' + (170 - clockRadiusFor(gm) - 5).toFixed(1) + '">' + gm + '</text></g>').join('');
  const ticks = clock.days.map((d, i) => {
    const a = -Math.PI / 2 + i * (Math.PI * 2 / 30);
    const r1 = clockRadiusFor(d.minutes);
    const len = Math.max(r1 - 70, 2);
    const stroke = d.minutes > 0 ? 'rgba(34,211,238,' + (0.35 + 0.55 * (Math.min(d.minutes, 180) / 180)).toFixed(2) + ')' : '#22303c';
    return '<line class="ctic" style="--len:' + len.toFixed(1) + ';--d:' + (i * 35) + 'ms" x1="' + (170 + Math.cos(a) * 70).toFixed(1) + '" y1="' + (170 + Math.sin(a) * 70).toFixed(1) + '" x2="' + (170 + Math.cos(a) * r1).toFixed(1) + '" y2="' + (170 + Math.sin(a) * r1).toFixed(1) + '" stroke="' + stroke + '" data-tip="' + escHtml(d.label + ' — ' + d.minutes + ' دقیقه') + '" />';
  }).join('');
  const maxLabel = clock.days[clock.maxI] ? 'روز ' + clock.days[clock.maxI].label : '—';
  return '<section class="card reveal" style="--d:.1s;--tag:var(--c3)">'
    + '<h2>نمودار ۴ — ساعتِ ماه: تیک‌های دقیقه‌ای</h2>'
    + '<p class="mut">هر تیک یک روز؛ طول تیک روی خط‌کش حلقه‌ای (۶۰ / ۱۲۰ / ۱۸۰ دقیقه) قابل سنجش است</p>'
    + '<div class="clockWrap"><div class="clockRel"><svg class="chart" viewBox="0 0 340 340">'
    + rings + ticks
    + '<text class="cnum num" x="170" y="166" text-anchor="middle" data-cu="' + clock.total + '">' + clock.total + '</text>'
    + '<text x="170" y="186" text-anchor="middle">دقیقه در ۳۰ روز</text>'
    + '<text class="cstk" x="170" y="206" text-anchor="middle">' + currentStreak + ' روز پیوسته</text>'
    + '</svg></div><div class="chips">'
    + '<div class="chip" style="--ac:var(--c1);--d:.1s"><i></i><div><h4>مجموع دقیقه</h4><p>سی روز اخیر</p></div><b class="num" data-cu="' + clock.total + '">' + clock.total + '</b></div>'
    + '<div class="chip" style="--ac:var(--c3);--d:.2s"><i></i><div><h4>روزهای فعال</h4><p>از ۳۰ روز</p></div><b class="num" data-cu="' + clock.active + '">' + clock.active + '</b></div>'
    + '<div class="chip" style="--ac:var(--c5);--d:.3s"><i></i><div><h4>سنگین‌ترین روز</h4><p>' + escHtml(maxLabel) + '</p></div><b class="num" data-cu="' + clock.maxV + '">' + clock.maxV + '</b></div>'
    + '</div></div></section>';
}

function renderTerraceSection(terrace) {
  const best = terrace.best && terrace.best.minutes > 0
    ? '<p class="mut">پربازده‌ترین روزِ هفتهٔ شما: ' + escHtml(terrace.best.label) + ' (' + terrace.best.minutes + ' دقیقه، ' + terrace.best.pages + ' صفحه)</p>'
    : '';
  const cols = terrace.dow.map((w, i) => {
    const xr = 940 - i * 132;
    const cx = xr - 66;
    const col = w.minutes === terrace.dowMax && w.minutes > 0 ? 'var(--c5)' : 'var(--c1)';
    const y = terrace.geom.ys[i];
    return '<g><rect class="tcol" x="' + (xr - 132) + '" y="26" width="132" height="206" data-tip="' + escHtml(w.label + ' — ' + w.minutes + ' دقیقه') + '" />'
      + '<circle class="terHalo" cx="' + cx + '" cy="' + y + '" r="10" style="--d:' + (0.35 + i * 0.09).toFixed(2) + 's;stroke:' + col + '" />'
      + '<circle class="terDot" cx="' + cx + '" cy="' + y + '" r="6" fill="' + col + '" style="--d:' + (0.35 + i * 0.09).toFixed(2) + 's;color:' + col + '" data-tip="' + escHtml(w.label + ' — ' + w.minutes + ' دقیقه') + '" />'
      + '<text class="terLv" x="' + cx + '" y="' + (y - 14) + '" text-anchor="middle" style="--d:' + (0.35 + i * 0.09).toFixed(2) + 's">' + w.minutes + '</text>'
      + '<text x="' + cx + '" y="252" text-anchor="middle">' + escHtml(w.label) + '</text></g>';
  }).join('');
  return '<section class="card reveal" style="--tag:var(--c5)">'
    + '<h2>نمودار ۵ — تراسِ روزهای هفته</h2>'
    + '<p class="mut">پله‌ها سطحِ دقیقهٔ هر روز را نشان می‌دهند؛ اعداد روی هر پله درج شده‌اند</p>'
    + best
    + '<svg class="chart" viewBox="0 0 1000 262" style="margin-top:16px">'
    + '<defs><linearGradient id="terG" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(34,211,238,.30)" /><stop offset="1" stop-color="rgba(34,211,238,.02)" /></linearGradient></defs>'
    + (terrace.geom.fill ? '<path class="terF" fill="url(#terG)" d="' + terrace.geom.fill + '" />' : '')
    + (terrace.geom.stroke ? '<path class="terGlow" d="' + terrace.geom.stroke + '" />' : '')
    + (terrace.geom.stroke ? '<path class="terL" d="' + terrace.geom.stroke + '" />' : '')
    + cols
    + '</svg></section>';
}

// رندرِ SVG نمودارِ ۶ (روبانِ دوتایی) برایِ یک معیار و بازه — هم در
// سمتِ سرور (حالتِ اولیه) و هم در اسکریپتِ صفحه (پس از کلیک رویِ قرص‌ها).
// نسخهٔ اسکریپتِ صفحه، همین منطق را با دادهٔ پی‌لود بازتولید می‌کند.
// حالتِ اولیه دقیقاً مثلِ ProfileView است: معیارِ ۰ (دقیقه) و بازهٔ ۱ (۱۴ روز).
function renderDualSvg(dual) {
  const grid = [];
  for (let v = 0; v <= dual.scale; v += 50) {
    const gy = 320 - (v * 240) / dual.scale;
    grid.push('<g><line class="grid" x1="40" y1="' + gy.toFixed(1) + '" x2="960" y2="' + gy.toFixed(1) + '" /><text class="glab" x="34" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">' + v + '</text></g>');
  }
  const dotsA = dual.pa.map((p, i) => '<circle class="pdA" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4.5" data-tip="' + escHtml('روز ' + dual.trend[i].label + ' — ' + dual.metric.label + ': ' + dashFormatNum(dual.a[i]) + ' ' + dual.metric.unit) + '" />').join('');
  const dotsB = dual.pb.map((p, i) => '<circle class="pdB" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" data-tip="' + escHtml('روز ' + dual.trend[i].label + ' — میانگینِ متحرکِ ۳ روزه: ' + dashFormatNum(dual.b[i]) + ' ' + dual.metric.unit) + '" />').join('');
  const endLabels = dual.pa.length > 0
    ? '<text class="elab" x="' + (dual.pa[dual.pa.length - 1].x - 10).toFixed(1) + '" y="' + (dual.pa[dual.pa.length - 1].y - 10).toFixed(1) + '" text-anchor="end" fill="var(--c1)">' + dashFormatNum(dual.a[dual.a.length - 1]) + '</text>'
      + '<text class="elab" x="' + (dual.pb[dual.pb.length - 1].x - 10).toFixed(1) + '" y="' + (dual.pb[dual.pb.length - 1].y + 18).toFixed(1) + '" text-anchor="end" fill="var(--c5)">' + dashFormatNum(dual.b[dual.b.length - 1]) + '</text>'
    : '';
  const lastIdx = dual.trend.length - 1;
  const xlX = 40 + Math.max(0, lastIdx) * dual.step;
  return '<svg class="chart dualSvg go" viewBox="0 0 1000 360" data-dual-svg="1">'
    + '<defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(34,211,238,.42)" /><stop offset="1" stop-color="rgba(34,211,238,.02)" /></linearGradient>'
    + '<linearGradient id="gB2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(244,114,182,.34)" /><stop offset="1" stop-color="rgba(244,114,182,.02)" /></linearGradient>'
    + '<clipPath id="clipMain"><rect x="0" y="0" width="1000" height="360" /></clipPath></defs>'
    + grid.join('')
    + '<g clipPath="url(#clipMain)">'
    + (dual.areaA ? '<path class="arA" fill="url(#gA)" d="' + dual.areaA + '" />' : '')
    + (dual.areaB ? '<path class="arB" fill="url(#gB2)" d="' + dual.areaB + '" />' : '')
    + (dual.lineA ? '<path class="eAGlow" d="' + dual.lineA + '" />' : '')
    + (dual.lineA ? '<path class="eA" d="' + dual.lineA + '" />' : '')
    + (dual.lineB ? '<path class="eBGlow" d="' + dual.lineB + '" />' : '')
    + (dual.lineB ? '<path class="eB" d="' + dual.lineB + '" />' : '')
    + '</g>'
    + dotsA + dotsB + endLabels
    + '<line class="xl" id="dualXl" x1="' + xlX + '" x2="' + xlX + '" y1="28" y2="332" style="opacity:0" />'
    + '</svg>';
}

function renderDualSection(dual) {
  const metricPills = DUAL_METRICS.map((m, i) => '<button type="button" class="pill' + (i === 0 ? ' on' : '') + '" data-dual-metric="' + i + '">' + escHtml(m.label) + '</button>').join('');
  const rangePills = DUAL_RANGES.map((r, i) => '<button type="button" class="pill' + (i === 1 ? ' on' : '') + '" data-dual-range="' + i + '">' + r + ' روز</button>').join('');
  const lastIdx = dual.trend.length - 1;
  const last = dual.trend[lastIdx];
  return '<section class="card reveal" style="--tag:var(--c6)">'
    + '<div class="lineHead"><div><h2>نمودار ۶ — روبانِ عملکرد با پنل خوانش دقیق</h2>'
    + '<p class="mut">پنل شیشه‌ای همیشه اعداد دقیق روز را نشان می‌دهد؛ با حرکت ماوس روی نمودار، روز به‌روز می‌شود</p></div>'
    + '<div class="pills">' + metricPills + '</div>'
    + '<div class="pills">' + rangePills + '</div></div>'
    + '<div class="wbox"><div class="hud" id="hud">'
    + '<span id="hud-date">' + (last ? 'روز ' + escHtml(last.label) : '—') + '</span>'
    + '<div><i style="background:var(--c1)"></i><span id="hud-metric">' + escHtml(dual.metric.label) + '</span> <b id="hud-a">' + (last ? dashFormatNum(dual.a[lastIdx]) : '—') + '</b> <span id="hud-unit">' + escHtml(dual.metric.unit) + '</span></div>'
    + '<div><i style="background:var(--c5)"></i>میانگینِ متحرکِ ۳ روزه <b id="hud-b">' + (last ? dashFormatNum(dual.b[lastIdx]) : '—') + '</b> <span>' + escHtml(dual.metric.unit) + '</span></div>'
    + '</div><div id="dual-svg-wrap">' + renderDualSvg(dual) + '</div></div>'
    + '<p class="mut">یادداشت‌ها و بوک‌مارک‌ها در این نمودار، فقط بوک‌مارک‌هایِ دارایِ تاریخِ ساخت هستند؛ حاشیه‌نویسی‌ها تاریخِ ساخت ندارند و در این معیار شمرده نمی‌شوند.</p>'
    + '</section>';
}

// ---------------------------------------------------------------------------
// استایلِ صفحهٔ مستقل — همان DASH44_CSS در ProfileView با فونتِ سیستمی
// (بدونِ فونتِ خارجی؛ Tahoma در ویندوز و فونتِ پیش‌فرضِ سیستم در بقیه).
// ---------------------------------------------------------------------------
const STANDALONE_CSS = `
body{margin:0;background:#0a0e14;color:#eaf2fa;font-family:Tahoma,'Segoe UI',sans-serif;direction:rtl}
.page{max-width:1080px;margin:0 auto;padding:22px 18px 40px}
.dash44{--bg:#0a0e14;--card:#10161f;--card2:#0d131b;--line:#1e2a38;--line2:#2b3b4e;--ink:#eaf2fa;--mut:#9aa8b8;--c1:#22d3ee;--c2:#a78bfa;--c3:#34d399;--c4:#fbbf24;--c5:#f472b6;--c6:#60a5fa;--c7:#fb7185;background:var(--bg);color:var(--ink);font-family:Tahoma,'Segoe UI',sans-serif;border:1px solid var(--line);border-radius:18px;padding:26px;background-image:radial-gradient(900px 380px at 82% -10%,rgba(34,211,238,.08),transparent 60%),radial-gradient(700px 340px at 8% -6%,rgba(167,139,250,.07),transparent 60%)}
.dash44 .num,.dash44 b{font-family:Tahoma,'Segoe UI',sans-serif}
.dash44 svg text{font-family:Tahoma,'Segoe UI',sans-serif;fill:var(--mut);font-size:11px}
.dash44 .reveal{opacity:0;transform:translateY(26px);transition:opacity .85s ease,transform .85s cubic-bezier(.2,.75,.2,1);transition-delay:var(--d,0s)}
.dash44 .reveal.in{opacity:1;transform:none}
.dash44 .eyebrow{display:flex;gap:10px;align-items:center;color:var(--mut);font-size:12.5px}
.dash44 .eyebrow i{width:8px;height:8px;border-radius:50%;background:var(--c3);box-shadow:0 0 12px var(--c3);animation:dash44beat 1.8s infinite}
@keyframes dash44beat{50%{transform:scale(1.5);opacity:.5}}
.dash44 .dashTitle{font-size:clamp(25px,3.8vw,40px);font-weight:800;margin:12px 0 20px}
.dash44 .dashTitle em{font-style:normal;color:var(--c1);text-shadow:0 0 22px rgba(34,211,238,.5)}
.dash44 .goal{display:flex;align-items:center;gap:14px}
.dash44 .badge{color:#04121a;background:linear-gradient(90deg,var(--c1),#67e8f9);padding:6px 15px;border-radius:99px;font-weight:800;font-size:12.5px;box-shadow:0 0 22px rgba(34,211,238,.45)}
.dash44 .track{flex:1;height:12px;border-radius:99px;background:#141c27;overflow:hidden;position:relative}
.dash44 .fill{position:absolute;inset:0;border-radius:inherit;background:linear-gradient(90deg,var(--c1),var(--c3));box-shadow:0 0 24px rgba(34,211,238,.55);width:0;transition:width 1.8s cubic-bezier(.2,.8,.2,1) .3s}
.dash44 .in .fill{width:var(--w)}
.dash44 .fill::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,255,255,.22) 0 10px,transparent 10px 20px);animation:dash44slide 1.1s linear infinite}
@keyframes dash44slide{to{background-position:28px 0}}
.dash44 .card{position:relative;background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px;margin-top:26px;overflow:hidden;transition:transform .35s cubic-bezier(.2,.8,.2,1),border-color .35s,box-shadow .35s}
.dash44 .card::before{content:"";position:absolute;top:0;right:0;width:42%;height:2px;background:linear-gradient(90deg,var(--c1),transparent);opacity:.7}
.dash44 .card:hover{transform:translateY(-5px);border-color:var(--line2);box-shadow:0 22px 54px rgba(0,0,0,.5),0 0 0 1px rgba(34,211,238,.14)}
.dash44 h2{font-size:16.5px;font-weight:700;display:flex;align-items:center;gap:9px}
.dash44 h2::before{content:"";width:8px;height:8px;border-radius:2px;background:var(--tag,var(--c1));box-shadow:0 0 10px var(--tag,var(--c1))}
.dash44 .mut{color:var(--mut);font-size:12.5px;margin-top:7px;line-height:1.9}
.dash44 .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.dash44 svg.chart{width:100%;height:auto;display:block}
.dash44 .dtrack{fill:none;stroke:rgba(255,255,255,.08);stroke-width:9;stroke-linecap:round}
.dash44 .darc{fill:none;stroke-width:9;stroke-linecap:round;transition:stroke-width .25s;stroke-dasharray:var(--len);stroke-dashoffset:var(--len);transition:stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1) var(--d),stroke-width .25s}
.dash44 .in .darc{stroke-dashoffset:0}
.dash44 .darcGlow{fill:none;stroke-width:13;stroke-linecap:round;opacity:.22;stroke-dasharray:var(--len);stroke-dashoffset:var(--len);transition:stroke-dashoffset 1.2s cubic-bezier(.2,.8,.2,1) var(--d)}
.dash44 .in .darcGlow{stroke-dashoffset:0}
.dash44 .dialG{cursor:pointer}
.dash44 .dialG:hover .darc{stroke-width:13}
.dash44 .dtick{stroke:rgba(255,255,255,.22);stroke-width:2}
.dash44 .dnum{fill:var(--ink);font-size:20px;font-weight:700;font-family:Tahoma,'Segoe UI',sans-serif}
.dash44 .ddl{font-size:10px;font-family:Tahoma,'Segoe UI',sans-serif}
.dash44 .blobWrap{display:flex;gap:28px;align-items:center;flex-wrap:wrap;margin-top:16px}
.dash44 .blobRel{width:340px;max-width:100%;margin:auto;flex-shrink:0}
.dash44 .spin{fill:none;stroke:rgba(34,211,238,.28);stroke-width:1.5;stroke-dasharray:3 10;transform-box:fill-box;transform-origin:center;animation:dash44rot 16s linear infinite}
@keyframes dash44rot{to{transform:rotate(360deg)}}
.dash44 .bgrid{fill:none;stroke:rgba(255,255,255,.07)}
.dash44 .bsp{stroke:rgba(255,255,255,.09)}
.dash44 #bpoly{transform-box:view-box;transform-origin:50% 50%;transform:scale(0);transition:transform 1s cubic-bezier(.3,1.45,.4,1) .2s}
.dash44 .in #bpoly{transform:scale(1)}
.dash44 .blobGlow{fill:none;stroke-width:7;stroke-linejoin:round;opacity:.22}
.dash44 .bv{fill:var(--bg);stroke-width:2.5;cursor:pointer;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .5s cubic-bezier(.3,1.5,.4,1) var(--dd),r .2s,stroke-width .2s}
.dash44 .in .bv{transform:scale(1)}
.dash44 .bvHalo{fill:none;stroke-width:2;opacity:.25;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .5s cubic-bezier(.3,1.5,.4,1) var(--dd)}
.dash44 .in .bvHalo{transform:scale(1)}
.dash44 .bv.hot,.dash44 .bv:hover{r:8.5;stroke-width:3.5}
.dash44 .blab{opacity:0;transition:opacity .7s calc(var(--dd) + .2s);font-size:10.5px}
.dash44 .in .blab{opacity:1}
.dash44 .chips{flex:1;min-width:240px;display:grid;gap:10px}
.dash44 .chip{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;border:1px solid var(--line);background:var(--card2);border-radius:14px;padding:12px 14px;cursor:pointer;transition:.4s;opacity:0;transform:translateX(14px);transition:.5s;transition-delay:var(--d)}
.dash44 .in .chip{opacity:1;transform:none}
.dash44 .chip.hot,.dash44 .chip:hover{border-color:var(--ac);transform:translateX(-3px);box-shadow:0 0 0 1px var(--ac),0 8px 24px rgba(0,0,0,.35)}
.dash44 .chip i{width:10px;height:10px;border-radius:3px;background:var(--ac);box-shadow:0 0 10px var(--ac)}
.dash44 .chip h4{font-size:12.5px;font-weight:600}
.dash44 .chip p{font-size:10.5px;color:var(--mut);margin-top:3px}
.dash44 .cbar{height:4px;border-radius:99px;background:#182231;overflow:hidden;margin-top:7px}
.dash44 .cbar i{display:block;height:100%;width:0;border-radius:inherit;background:var(--ac);box-shadow:0 0 8px var(--ac);transition:width 1.3s cubic-bezier(.2,.8,.2,1) calc(var(--d) + .4s)}
.dash44 .in .cbar i{width:var(--w)}
.dash44 .chip b{font-size:17px;color:var(--ac);text-shadow:0 0 12px var(--ac)}
.dash44 .wtile{cursor:pointer;transition:fill-opacity .25s;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .5s cubic-bezier(.3,1.5,.4,1) var(--d),fill-opacity .25s}
.dash44 .in .wtile{transform:scale(1)}
.dash44 .wtile:hover{fill-opacity:1;transform:scale(1.15)}
.dash44 .wleg{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px}
.dash44 .clockWrap{display:flex;gap:26px;align-items:center;flex-wrap:wrap;margin-top:14px}
.dash44 .clockRel{width:330px;max-width:100%;margin:auto;flex-shrink:0}
.dash44 .cring{fill:none;stroke:rgba(255,255,255,.09);stroke-dasharray:2 6}
.dash44 .glab{font-family:Tahoma,'Segoe UI',sans-serif;font-size:9px;fill:var(--mut)}
.dash44 .ctic{stroke-width:6;stroke-linecap:round;cursor:pointer;transition:stroke-width .2s;stroke-dasharray:var(--len);stroke-dashoffset:var(--len);transition:stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1) var(--d),stroke-width .2s}
.dash44 .in .ctic{stroke-dashoffset:0}
.dash44 .ctic:hover{stroke-width:10}
.dash44 .cnum{fill:var(--ink);font-size:26px;font-weight:800;font-family:Tahoma,'Segoe UI',sans-serif}
.dash44 .cstk{fill:var(--c1);font-size:11px}
.dash44 .terF{fill-opacity:0;transition:fill-opacity 1.2s .4s}
.dash44 .in .terF{fill-opacity:1}
.dash44 .terL{fill:none;stroke:var(--c1);stroke-width:2.5;stroke-linejoin:round;stroke-dasharray:2400;stroke-dashoffset:2400;transition:stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1) .3s}
.dash44 .in .terL{stroke-dashoffset:0}
.dash44 .terGlow{fill:none;stroke:var(--c1);stroke-width:7;stroke-linejoin:round;opacity:.22;stroke-dasharray:2400;stroke-dashoffset:2400;transition:stroke-dashoffset 1.6s cubic-bezier(.4,0,.2,1) .3s}
.dash44 .in .terGlow{stroke-dashoffset:0}
.dash44 .terDot{cursor:pointer;transition:r .2s;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .5s cubic-bezier(.3,1.5,.4,1) var(--d),r .2s}
.dash44 .in .terDot{transform:scale(1)}
.dash44 .terHalo{fill:none;stroke-width:2;opacity:.25;transform-box:fill-box;transform-origin:center;transform:scale(0);transition:transform .5s cubic-bezier(.3,1.5,.4,1) var(--d)}
.dash44 .in .terHalo{transform:scale(1)}
.dash44 .terDot:hover{r:9}
.dash44 .terLv{opacity:0;transition:opacity .6s calc(var(--d) + .5s);fill:var(--ink);font-size:11.5px;font-family:Tahoma,'Segoe UI',sans-serif}
.dash44 .in .terLv{opacity:1}
.dash44 .tcol{fill:transparent}
.dash44 .lineHead{display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:flex-start}
.dash44 .pills{display:flex;gap:8px;flex-wrap:wrap}
.dash44 .pill{font-family:inherit;font-size:11.5px;color:var(--mut);background:var(--card2);border:1px solid var(--line);border-radius:99px;padding:8px 15px;cursor:pointer;transition:.3s}
.dash44 .pill:hover{color:var(--ink);border-color:var(--line2);transform:translateY(-2px)}
.dash44 .pill.on{color:#04121a;background:linear-gradient(90deg,var(--c1),#67e8f9);border-color:transparent;font-weight:700;box-shadow:0 0 20px rgba(34,211,238,.4)}
.dash44 .wbox{position:relative;margin-top:16px;border:1px solid var(--line);border-radius:16px;background:var(--card2);padding:10px}
.dash44 .hud{position:absolute;top:18px;left:18px;background:rgba(13,19,27,.92);border:1px solid var(--line2);border-radius:12px;padding:10px 14px;font-size:11.5px;display:grid;gap:6px;pointer-events:none;box-shadow:0 10px 26px rgba(0,0,0,.45);min-width:150px;z-index:2}
.dash44 .hud span{color:var(--mut);font-size:10.5px}
.dash44 .hud div{display:flex;gap:7px;align-items:center}
.dash44 .hud i{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dash44 .hud b{margin-inline-start:6px;color:var(--ink)}
.dash44 #clipMain rect{transform:scaleX(0);transform-origin:100% 50%;transform-box:fill-box;transition:transform 1.6s cubic-bezier(.4,0,.2,1) .1s}
.dash44 svg.go #clipMain rect{transform:scaleX(1)}
.dash44 .grid{stroke:rgba(255,255,255,.06)}
.dash44 .arA,.dash44 .arB,.dash44 .eA,.dash44 .eB{transition:opacity 1s .6s;opacity:0}
.dash44 svg.go .arA,.dash44 svg.go .arB,.dash44 svg.go .eA,.dash44 svg.go .eB{opacity:1}
.dash44 .eA{fill:none;stroke:var(--c1);stroke-width:2.4}
.dash44 .eB{fill:none;stroke:var(--c5);stroke-width:2.2}
.dash44 .eAGlow,.dash44 .eBGlow{transition:opacity 1s .6s;opacity:0}
.dash44 .eAGlow{fill:none;stroke:var(--c1);stroke-width:7}
.dash44 .eBGlow{fill:none;stroke:var(--c5);stroke-width:6.5}
.dash44 svg.go .eAGlow{opacity:.22}
.dash44 svg.go .eBGlow{opacity:.22}
.dash44 .pdA,.dash44 .pdB{fill:var(--bg);stroke-width:2.5;cursor:pointer;transition:r .2s}
.dash44 .pdA{stroke:var(--c1)}
.dash44 .pdB{stroke:var(--c5)}
.dash44 .pdA:hover,.dash44 .pdB:hover{r:7}
.dash44 .elab{font-family:Tahoma,'Segoe UI',sans-serif;font-size:11px;font-weight:700}
.dash44 .xl{stroke:rgba(255,255,255,.28);stroke-dasharray:3 5;opacity:0;transition:.2s}
.dash44 .dualSvg:hover .xl{opacity:1}
.dash44 .dashFoot{margin-top:46px;text-align:center;color:var(--mut);font-size:11.5px}
.dash44Tip{position:fixed;z-index:60;pointer-events:none;background:rgba(13,19,27,.96);border:1px solid rgba(34,211,238,.4);color:var(--ink);padding:8px 13px;border-radius:11px;font-size:12px;opacity:0;transform:translate(-50%,-135%);transition:.2s;box-shadow:0 10px 30px rgba(0,0,0,.55)}
.dash44Tip.on{opacity:1;transform:translate(-50%,-145%)}
.dash44 .sumRow{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:18px}
.dash44 .sumCell{border:1px solid var(--line);background:var(--card2);border-radius:12px;padding:10px 12px}
.dash44 .sumCell span{display:block;color:var(--mut);font-size:11px}
.dash44 .sumCell b{font-size:17px}
@media(max-width:900px){.dash44 .two{grid-template-columns:1fr}.dash44 .blobWrap,.dash44 .clockWrap{gap:14px}.dash44 .wleg{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.dash44 *{animation:none!important;transition:none!important}.dash44 .reveal{opacity:1;transform:none}}
`;

// اسکریپتِ صفحهٔ مستقل: ورودِ مرحله‌ای + Count-Up + تولتیپ + همگام‌سازیِ
// بلاب + قرص‌هایِ نمودارِ ۶ (بازرندر از رویِ پی‌لودِ جاسازی‌شده).
// کاملاً ایستاست؛ هیچ رشتهٔ درون‌یابی‌شده‌ای ندارد تا در قالبِ سازنده
// به‌درستی جاسازی شود. هیچ درخواستِ شبکه‌ای نمی‌فرستد.
const STANDALONE_SCRIPT = `
(function () {
  'use strict';
  var payloadEl = document.getElementById('cr-exported-stat-view-payload');
  var payload = null;
  try { payload = payloadEl ? JSON.parse(payloadEl.textContent) : null; } catch (e) { payload = null; }
  var data = (payload && payload.snapshotData) || {};
  var days = data.days || {};
  var notesByDay = data.notesByDay || {};
  var METRICS = [
    { id: 'minutes', label: 'زمان مطالعه', unit: 'دقیقه' },
    { id: 'pages', label: 'صفحات خوانده‌شده', unit: 'صفحه' },
    { id: 'marks', label: 'یادداشت‌ها و بوک‌مارک‌ها', unit: 'نشانه' },
    { id: 'speed', label: 'سرعت مطالعه (صفحه بر ساعت)', unit: 'صفحه در ساعت' }
  ];
  var RANGES = [7, 14, 30, 90];
  var metricIdx = 0;
  var rangeIdx = 1;
  var hudIdx = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmt(v) {
    var n = Number(v) || 0;
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }
  function dateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function trend(n, metricId) {
    var out = [];
    var today = new Date();
    for (var i = n - 1; i >= 0; i--) {
      var d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      var key = dateKey(d);
      var e = days[key] || {};
      var sec = Number(e.seconds) || 0;
      var pg = Number(e.pages) || 0;
      var minutes = Math.round(Math.max(0, sec) / 60);
      var marks = Number(notesByDay[key]) || 0;
      var speed = sec > 0 ? pg / (sec / 3600) : 0;
      var value = metricId === 'pages' ? pg : (metricId === 'marks' ? marks : (metricId === 'speed' ? speed : minutes));
      out.push({ key: key, label: key.slice(5).replace('-', '/'), value: value });
    }
    return out;
  }
  function movAvg3(vals) {
    return vals.map(function (v, i) {
      var win = vals.slice(Math.max(0, i - 2), i + 1);
      var s = 0;
      for (var k = 0; k < win.length; k++) s += win[k];
      return s / Math.max(1, win.length);
    });
  }
  function scaleMax(m) {
    return Math.max(50, Math.ceil(Math.max(0, Number(m) || 0) / 50) * 50);
  }
  function smooth(pts) {
    if (pts.length === 0) return '';
    if (pts.length === 1) return 'M ' + pts[0].x + ' ' + pts[0].y;
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[Math.max(0, i - 1)];
      var p1 = pts[i];
      var p2 = pts[i + 1];
      var p3 = pts[Math.min(pts.length - 1, i + 2)];
      d += ' C ' + (p1.x + (p2.x - p0.x) / 6) + ' ' + (p1.y + (p2.y - p0.y) / 6) + ', ' + (p2.x - (p3.x - p1.x) / 6) + ' ' + (p2.y - (p3.y - p1.y) / 6) + ', ' + p2.x + ' ' + p2.y;
    }
    return d;
  }
  function dualData() {
    var metric = METRICS[metricIdx];
    var tr = trend(RANGES[rangeIdx], metric.id);
    var a = tr.map(function (d) { return d.value; });
    var b = movAvg3(a);
    var scale = scaleMax(Math.max.apply(null, [1].concat(a, b)));
    var n = tr.length;
    var P = 40;
    var base = 320;
    var sc = 240 / Math.max(1, scale);
    var step = n > 1 ? (1000 - 2 * P) / (n - 1) : 0;
    var mk = function (vals) { return vals.map(function (v, i) { return { x: P + i * step, y: base - v * sc }; }); };
    var pa = mk(a);
    var pb = mk(b);
    var lineA = smooth(pa);
    var lineB = smooth(pb);
    var areaA = pa.length > 0 ? lineA + ' L ' + pa[pa.length - 1].x + ' ' + base + ' L ' + pa[0].x + ' ' + base + ' Z' : '';
    var areaB = pb.length > 0 ? lineB + ' L ' + pb[pb.length - 1].x + ' ' + base + ' L ' + pb[0].x + ' ' + base + ' Z' : '';
    return { metric: metric, trend: tr, a: a, b: b, scale: scale, step: step, base: base, pa: pa, pb: pb, lineA: lineA, lineB: lineB, areaA: areaA, areaB: areaB };
  }
  function dualSvg(dual) {
    var g = '';
    for (var v = 0; v <= dual.scale; v += 50) {
      var gy = 320 - (v * 240) / dual.scale;
      g += '<g><line class="grid" x1="40" y1="' + gy.toFixed(1) + '" x2="960" y2="' + gy.toFixed(1) + '" /><text class="glab" x="34" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">' + v + '</text></g>';
    }
    var dotsA = dual.pa.map(function (p, i) {
      return '<circle class="pdA" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4.5" data-tip="' + esc('روز ' + dual.trend[i].label + ' — ' + dual.metric.label + ': ' + fmt(dual.a[i]) + ' ' + dual.metric.unit) + '" />';
    }).join('');
    var dotsB = dual.pb.map(function (p, i) {
      return '<circle class="pdB" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="4" data-tip="' + esc('روز ' + dual.trend[i].label + ' — میانگینِ متحرکِ ۳ روزه: ' + fmt(dual.b[i]) + ' ' + dual.metric.unit) + '" />';
    }).join('');
    var labels = '';
    if (dual.pa.length > 0) {
      labels = '<text class="elab" x="' + (dual.pa[dual.pa.length - 1].x - 10).toFixed(1) + '" y="' + (dual.pa[dual.pa.length - 1].y - 10).toFixed(1) + '" text-anchor="end" fill="var(--c1)">' + fmt(dual.a[dual.a.length - 1]) + '</text>'
        + '<text class="elab" x="' + (dual.pb[dual.pb.length - 1].x - 10).toFixed(1) + '" y="' + (dual.pb[dual.pb.length - 1].y + 18).toFixed(1) + '" text-anchor="end" fill="var(--c5)">' + fmt(dual.b[dual.b.length - 1]) + '</text>';
    }
    var lastIdx = Math.max(0, dual.trend.length - 1);
    var xlX = 40 + lastIdx * dual.step;
    return '<svg class="chart dualSvg go" viewBox="0 0 1000 360" data-dual-svg="1">'
      + '<defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(34,211,238,.42)" /><stop offset="1" stop-color="rgba(34,211,238,.02)" /></linearGradient>'
      + '<linearGradient id="gB2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="rgba(244,114,182,.34)" /><stop offset="1" stop-color="rgba(244,114,182,.02)" /></linearGradient>'
      + '<clipPath id="clipMain"><rect x="0" y="0" width="1000" height="360" /></clipPath></defs>'
      + g
      + '<g clipPath="url(#clipMain)">'
      + (dual.areaA ? '<path class="arA" fill="url(#gA)" d="' + dual.areaA + '" />' : '')
      + (dual.areaB ? '<path class="arB" fill="url(#gB2)" d="' + dual.areaB + '" />' : '')
      + (dual.lineA ? '<path class="eAGlow" d="' + dual.lineA + '" />' : '')
      + (dual.lineA ? '<path class="eA" d="' + dual.lineA + '" />' : '')
      + (dual.lineB ? '<path class="eBGlow" d="' + dual.lineB + '" />' : '')
      + (dual.lineB ? '<path class="eB" d="' + dual.lineB + '" />' : '')
      + '</g>' + dotsA + dotsB + labels
      + '<line class="xl" id="dualXl" x1="' + xlX + '" x2="' + xlX + '" y1="28" y2="332" style="opacity:0" />'
      + '</svg>';
  }
  function updateHud(dual, idx) {
    var last = dual.trend.length - 1;
    var i = (idx == null) ? last : Math.max(0, Math.min(last, idx));
    var d = document.getElementById('hud-date');
    var m = document.getElementById('hud-metric');
    var a = document.getElementById('hud-a');
    var b = document.getElementById('hud-b');
    var u = document.getElementById('hud-unit');
    if (d) d.textContent = dual.trend[i] ? 'روز ' + dual.trend[i].label : '—';
    if (m) m.textContent = dual.metric.label;
    if (a) a.textContent = dual.trend[i] ? fmt(dual.a[i]) : '—';
    if (b) b.textContent = dual.trend[i] ? fmt(dual.b[i]) : '—';
    if (u) u.textContent = dual.metric.unit;
    var xl = document.getElementById('dualXl');
    if (xl) {
      var x = 40 + i * dual.step;
      xl.setAttribute('x1', String(x));
      xl.setAttribute('x2', String(x));
      xl.style.opacity = (idx == null) ? '0' : '1';
    }
  }
  function renderDual() {
    var wrap = document.getElementById('dual-svg-wrap');
    if (!wrap) return;
    var dual = dualData();
    wrap.innerHTML = dualSvg(dual);
    hudIdx = null;
    updateHud(dual, null);
    wrap._dual = dual;
  }
  function countUp() {
    var els = document.querySelectorAll('[data-cu]');
    for (var k = 0; k < els.length; k++) {
      (function (el) {
        var goal = Math.max(0, Math.floor(Number(el.getAttribute('data-cu')) || 0));
        var start = null;
        function tick(now) {
          if (start === null) start = now;
          var p = Math.min((now - start) / 1300, 1);
          el.textContent = String(Math.round(goal * (1 - Math.pow(1 - p, 3))));
          if (p < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      })(els[k]);
    }
  }
  function reveal() {
    var els = document.querySelectorAll('.reveal');
    for (var k = 0; k < els.length; k++) els[k].classList.add('in');
    requestAnimationFrame(function () { countUp(); });
  }
  var tip = document.getElementById('cr-tip');
  document.addEventListener('mouseover', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t && tip) {
      tip.textContent = t.getAttribute('data-tip');
      tip.style.left = e.clientX + 'px';
      tip.style.top = e.clientY + 'px';
      tip.classList.add('on');
    } else if (tip) {
      tip.classList.remove('on');
    }
    var b = e.target && e.target.closest ? e.target.closest('[data-blob]') : null;
    var c = e.target && e.target.closest ? e.target.closest('[data-chip]') : null;
    var idx = b ? b.getAttribute('data-blob') : (c ? c.getAttribute('data-chip') : null);
    var all = document.querySelectorAll('[data-blob], [data-chip]');
    for (var k = 0; k < all.length; k++) {
      if (idx === null) { all[k].classList.remove('hot'); continue; }
      var mine = all[k].getAttribute('data-blob') || all[k].getAttribute('data-chip');
      if (mine === idx) { all[k].classList.add('hot'); } else { all[k].classList.remove('hot'); }
    }
  });
  document.addEventListener('mousemove', function (e) {
    if (tip && tip.classList.contains('on')) {
      tip.style.left = e.clientX + 'px';
      tip.style.top = e.clientY + 'px';
    }
    var svg = e.target && e.target.closest ? e.target.closest('[data-dual-svg]') : null;
    var wrap = document.getElementById('dual-svg-wrap');
    if (svg && wrap && wrap._dual) {
      var rect = svg.getBoundingClientRect();
      var x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 1000;
      var i = Math.round((x - 40) / Math.max(1, wrap._dual.step));
      hudIdx = Math.max(0, Math.min(wrap._dual.trend.length - 1, i));
      updateHud(wrap._dual, hudIdx);
    }
  });
  document.addEventListener('mouseout', function (e) {
    var svg = e.target && e.target.closest ? e.target.closest('[data-dual-svg]') : null;
    var wrap = document.getElementById('dual-svg-wrap');
    if (svg && wrap && wrap._dual && !svg.contains(e.relatedTarget)) {
      hudIdx = null;
      updateHud(wrap._dual, null);
    }
  });
  document.addEventListener('click', function (e) {
    var m = e.target && e.target.closest ? e.target.closest('[data-dual-metric]') : null;
    var r = e.target && e.target.closest ? e.target.closest('[data-dual-range]') : null;
    if (m) {
      metricIdx = Number(m.getAttribute('data-dual-metric')) || 0;
      var pills = document.querySelectorAll('[data-dual-metric]');
      for (var k = 0; k < pills.length; k++) pills[k].classList.toggle('on', Number(pills[k].getAttribute('data-dual-metric')) === metricIdx);
      renderDual();
    }
    if (r) {
      rangeIdx = Number(r.getAttribute('data-dual-range')) || 0;
      var pills2 = document.querySelectorAll('[data-dual-range]');
      for (var k2 = 0; k2 < pills2.length; k2++) pills2[k2].classList.toggle('on', Number(pills2[k2].getAttribute('data-dual-range')) === rangeIdx);
      renderDual();
    }
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reveal);
  } else {
    reveal();
  }
  renderDual();
})();
`;

// ---------------------------------------------------------------------------
// سازندهٔ اصلی: اسنپ‌شات → رشتهٔ HTMLِ کامل و مستقل.
// ---------------------------------------------------------------------------
export function generateStandaloneStatsHtmlReport(snapshot) {
  try {
    const norm = normalizeSnapshot(snapshot);
    const dial = deriveDial(norm);
    const blob = deriveBlob(norm);
    const waffle = deriveWaffle(norm);
    const clock = deriveClock(norm);
    const terrace = deriveTerrace(norm);
    const dual = deriveDual(norm, 0, 1);

    const payload = {
      format: STATS_HTML_FORMAT,
      exportedAt: norm.exportedAt,
      statView: norm.statView,
      snapshotData: {
        days: norm.days,
        notesByDay: norm.notesByDay,
        books: norm.books,
        aptitude: norm.aptitude,
        summary: norm.summary,
        goal: norm.goal,
      },
    };
    const payloadJson = JSON.stringify(payload)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    const todayKey = localDateKey(new Date());
    const todayEntry = norm.days[todayKey] || {};
    const todayPages = norm.summary.todayPages > 0 ? norm.summary.todayPages : toNonNegInt(todayEntry.pages);
    const goalPagesRaw = norm.goal && norm.goal.pages != null ? norm.goal.pages : (norm.statView.goalPages != null ? norm.statView.goalPages : norm.summary.todayGoalPages);
    const dailyGoal = goalPagesRaw > 0 ? goalPagesRaw : 50;
    const goalPct = Math.min(100, Math.round((todayPages / Math.max(1, dailyGoal)) * 100));
    let exportedLabel = '';
    try {
      exportedLabel = new Date(norm.exportedAt).toLocaleString('fa-IR');
    } catch (_) {
      exportedLabel = new Date(norm.exportedAt).toISOString();
    }
    const s = norm.summary;
    const summaryRow = '<div class="sumRow">'
      + '<div class="sumCell"><span>مجموع ساعت مطالعه</span><b class="num">' + dashFormatNum(s.hours) + '</b></div>'
      + '<div class="sumCell"><span>مجموع صفحات</span><b class="num" data-cu="' + Math.round(s.pages) + '">' + Math.round(s.pages) + '</b></div>'
      + '<div class="sumCell"><span>سرعت (صفحه در ساعت)</span><b class="num">' + dashFormatNum(s.speed) + '</b></div>'
      + '<div class="sumCell"><span>پیشرفت کتاب‌ها</span><b class="num">' + Math.round(s.progress) + '٪</b></div>'
      + '<div class="sumCell"><span>رکورد فعلی</span><b class="num" data-cu="' + s.currentStreak + '">' + s.currentStreak + ' روز</b></div>'
      + '<div class="sumCell"><span>بهترین رکورد</span><b class="num" data-cu="' + s.bestStreak + '">' + s.bestStreak + ' روز</b></div>'
      + '<div class="sumCell"><span>بوک‌مارک‌ها</span><b class="num" data-cu="' + s.bookmarks + '">' + s.bookmarks + '</b></div>'
      + '<div class="sumCell"><span>یادداشت‌ها</span><b class="num" data-cu="' + s.highlights + '">' + s.highlights + '</b></div>'
      + '<div class="sumCell"><span>کتاب‌ها</span><b class="num" data-cu="' + s.totalBooks + '">' + s.totalBooks + '</b></div>'
      + '<div class="sumCell"><span>تمام‌شده</span><b class="num" data-cu="' + s.finishedBooks + '">' + s.finishedBooks + '</b></div>'
      + '</div>';

    const html = '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<title>' + escHtml(norm.statView.name) + ' — گزارش آمار مطالعه</title>'
      + '<style>' + STANDALONE_CSS + '</style>'
      + '<noscript><style>.dash44 .reveal{opacity:1!important;transform:none!important}.dash44 .darc,.dash44 .darcGlow,.dash44 .ctic,.dash44 .terL,.dash44 .terGlow{stroke-dashoffset:0!important}.dash44 #bpoly,.dash44 .bv,.dash44 .bvHalo,.dash44 .wtile,.dash44 .terDot,.dash44 .terHalo{transform:scale(1)!important}.dash44 .blab,.dash44 .terLv,.dash44 .terF,.dash44 .arA,.dash44 .arB,.dash44 .eA,.dash44 .eB,.dash44 .eAGlow,.dash44 .eBGlow{opacity:1!important}.dash44 .chip{opacity:1!important;transform:none!important}.dash44 .cbar i{width:var(--w)!important}.dash44 .fill{width:var(--w)!important}.dash44 #clipMain rect{transform:scaleX(1)!important}</style></noscript>'
      + '</head><body><div class="page"><div class="dash44">'
      + '<div class="reveal"><p class="eyebrow"><i></i> داشبوردِ تحلیلیِ چندنموداره و خودشناسی مطالعه</p>'
      + '<div class="dashTitle">آماربندیِ «' + escHtml(norm.statView.name) + '»</div>'
      + '<div class="goal"><span class="badge num">' + goalPct + '٪</span><div class="track"><i class="fill" style="--w:' + goalPct + '%"></i></div></div>'
      + '<p class="mut">هدف امروز: <em class="num" data-cu="' + todayPages + '">' + todayPages + '</em> از <span class="num">' + dailyGoal + '</span> صفحه</p>'
      + '<p class="mut">خروجی گرفته‌شده در ' + escHtml(exportedLabel) + ' — این فایل به‌صورتِ کاملاً آفلاین باز می‌شود و برایِ وارداتِ دوباره، پی‌لودِ آماربندی در خودِ فایل جاسازی شده است.</p>'
      + summaryRow
      + '</div>'
      + renderDialSection(dial)
      + renderBlobSection(blob)
      + '<div class="two">' + renderWaffleSection(waffle) + renderClockSection(clock, s.currentStreak) + '</div>'
      + renderTerraceSection(terrace)
      + renderDualSection(dual)
      + '<p class="dashFoot">گزارشِ مستقلِ آمار مطالعه — تمام نمودارها SVG دست‌ساز، بدون کتابخانهٔ خارجی</p>'
      + '</div></div>'
      + '<div id="cr-tip" class="dash44Tip"></div>'
      + '<script id="' + PAYLOAD_SCRIPT_ID + '" type="application/json">' + payloadJson + '</script>'
      + '<script>' + STANDALONE_SCRIPT + '</script>'
      + '</body></html>';
    return html;
  } catch (err) {
    // دفاعِ نهایی: حتی ورودیِ کاملاً بدریخت هم یک صفحهٔ معتبر برمی‌گرداند،
    // نه استثنا؛ علت، در کنسولِ صفحه قابلِ مشاهده است.
    return '<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><title>گزارش آمار مطالعه</title></head><body><p>داده‌ای نیست — گزارشِ آمار ساخته نشد.</p></body></html>';
  }
}

// ---------------------------------------------------------------------------
// پارسِ پی‌لودِ جاسازی‌شده (پیاده‌سازیِ مرجعِ مشترک با ProfileView).
// ورودی، یا متنِ کاملِ HTMLِ خروجی است یا خودِ JSONِ پی‌لود؛ خروجی
// همیشه { ok: true, payload } یا { ok: false, error } است و هرگز
// استثنا پرتاب نمی‌کند.
// ---------------------------------------------------------------------------
function validateStatsPayload(parsed) {
  if (!isPlainObject(parsed)) return 'ساختارِ پی‌لود معتبر نیست.';
  if (parsed.format !== STATS_HTML_FORMAT) return 'قالبِ فایل با نسخهٔ گزارشِ آمار سازگار نیست.';
  const view = parsed.statView;
  if (!isPlainObject(view)) return 'آماربندی در پی‌لود پیدا نشد.';
  if (typeof view.id !== 'string' || view.id.length === 0) return 'شناسهٔ آماربندی معتبر نیست.';
  if (typeof view.name !== 'string' || view.name.length === 0) return 'نامِ آماربندی معتبر نیست.';
  if (typeof view.color !== 'string') return 'رنگِ آماربندی معتبر نیست.';
  if (!Array.isArray(view.bookKeys) || !view.bookKeys.every((k) => typeof k === 'string')) return 'فهرستِ کتاب‌هایِ آماربندی معتبر نیست.';
  if (!Array.isArray(view.metrics)) return 'معیارهایِ آماربندی معتبر نیست.';
  const goalOk = (v) => v === undefined || v === null || (typeof v === 'number' && Number.isFinite(v));
  if (!goalOk(view.goalHours)) return 'هدفِ ساعتیِ آماربندی معتبر نیست.';
  if (!goalOk(view.goalPages)) return 'هدفِ صفحه‌ایِ آماربندی معتبر نیست.';
  return null;
}

export function parseExportedStatsHtml(text) {
  try {
    if (typeof text !== 'string' || text.length === 0) return { ok: false, error: 'ورودیِ خالی است.' };
    const trimmed = text.trim();
    let parsed = null;
    if (trimmed.startsWith('{')) {
      parsed = JSON.parse(trimmed);
    } else {
      const match = text.match(/<script[^>]*id=["']cr-exported-stat-view-payload["'][^>]*>([\s\S]*?)<\/script\s*>/i);
      if (!match) return { ok: false, error: 'پی‌لودِ گزارش در فایل پیدا نشد.' };
      parsed = JSON.parse(match[1]);
    }
    const error = validateStatsPayload(parsed);
    if (error) return { ok: false, error };
    return { ok: true, payload: parsed };
  } catch (err) {
    return { ok: false, error: 'فایلِ گزارش خوانا نیست: ' + String((err && err.message) || err) };
  }
}
