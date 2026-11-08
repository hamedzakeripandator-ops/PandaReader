// ============================================================================
// annotationEngine.js — بازسازی تمیز فاز ۳ + ارتقای فاز ۱
// فقط: قلم دیجیتال + هایلایت (perfect-freehand واقعی)
// فاز ۱: تبدیل مختصات برای تمام ابزارها (باکس، فلش، متن، استیکی) ایمن شد
// مرحلهٔ ۵۰ §۳: کرانهٔ دیداریِ واقعی + مقیاسِ استیکی + کلمپِ حاشیه
// ============================================================================

import { getStroke } from 'perfect-freehand';

// --- مختصات: فضای ذخیره‌سازی 1000×1000، فضای یکنواخت 1000×(1000*aspect) ---
export const VIEWBOX_SIZE = 1000;

/**
 * تبدیل مختصات کلاینت (موس) به نقطه SVG در فضای یکنواخت.
 * مرحلهٔ ۵۰ §۳: کلمپِ حاشیه — x در [-200, 1200] و y در
 * [-80, viewH + 80] تا آیتم‌های حاشیه (بیرونِ [0,1000]، §۲)
 * ساخته و جابه‌جا شوند و در ذخیره بریده نشوند؛ کرانِ بالای y،
 * viewH + 80 است (در aspectی ۱ می‌شود ۱۰۸۰) تا صفحه‌های قدبلند
 * هم حاشیهٔ پایین را داشته باشند. داخلِ صفحه هیچ فرقی نمی‌کند.
 */
export function clientToSvgPoint(clientX, clientY, rect, aspect = 1) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const a = Number(aspect) > 0 ? Number(aspect) : 1;
  const viewH = VIEWBOX_SIZE * a;
  const rawX = ((clientX - rect.left) / rect.width) * VIEWBOX_SIZE;
  const rawY = ((clientY - rect.top) / rect.height) * viewH;
  return {
    x: Number(Math.max(-200, Math.min(1200, rawX)).toFixed(1)),
    y: Number(Math.max(-80, Math.min(viewH + 80, rawY)).toFixed(1)),
  };
}

/**
 * آیتم ذخیره‌سازی → فضای یکنواخت
 * ضریب: a = aspect (فقط Y در aspect ضرب می‌شود)
 *
 * فاز ۱: علاوه بر آرایه points (قلم/هایلایتر)، فیلدهای Y سایر ابزارها هم تبدیل می‌شوند:
 *  - y, height          → box, sticky, text, image
 *  - startY, endY       → arrow صاف
 *  - cy                 → نقطه کنترل arrow منحنی
 */
export function storageToUniform(item, aspect) {
  if (!item) return item;
  const a = Number(aspect) > 0 ? Number(aspect) : 1;
  if (a === 1) return item;
  const out = { ...item };
  if (Array.isArray(out.points)) {
    out.points = out.points.map((p) => ({ ...p, y: p.y * a }));
  }
  // فاز ۱: پوشش فیلدهای Y ابزارهای دیگر
  if (typeof out.y === 'number') out.y = out.y * a;
  if (typeof out.height === 'number') out.height = out.height * a;
  if (typeof out.startY === 'number') out.startY = out.startY * a;
  if (typeof out.endY === 'number') out.endY = out.endY * a;
  if (typeof out.cy === 'number') out.cy = out.cy * a;
  return out;
}

/**
 * آیتم یکنواخت → فضای ذخیره‌سازی
 * ضریب: a = 1 / aspect
 */
export function uniformToStorage(item, aspect) {
  if (!item) return item;
  const asp = Number(aspect) > 0 ? Number(aspect) : 1;
  if (asp === 1) return item;
  const a = 1 / asp;
  const out = { ...item };
  if (Array.isArray(out.points)) {
    out.points = out.points.map((p) => ({ ...p, y: p.y * a }));
  }
  // فاز ۱: پوشش فیلدهای Y ابزارهای دیگر
  if (typeof out.y === 'number') out.y = out.y * a;
  if (typeof out.height === 'number') out.height = out.height * a;
  if (typeof out.startY === 'number') out.startY = out.startY * a;
  if (typeof out.endY === 'number') out.endY = out.endY * a;
  if (typeof out.cy === 'number') out.cy = out.cy * a;
  return out;
}

// ============================================================================
// perfect-freehand — قلب تپنده قلم و هایلایت
// ============================================================================

/**
 * تنظیمات قلم دیجیتال (مثل Apple Pencil):
 * - thinning: 0 → هیچ تیپری، پهنای کاملاً یکنواخت
 * - simulatePressure: false → پهنا با سرعت تغییر نمی‌کند (قابل پیش‌بینی)
 * - smoothing/streamline بالا → نهایت نرمی
 */
export function getPenOptions(strokeWidth = 4) {
  const sw = Math.max(1, Number(strokeWidth) || 4);
  return {
    size: sw * 2.2,
    thinning: 0,
    smoothing: 0.95,
    streamline: 0.85,
    simulatePressure: false,
    last: true,
  };
}

/**
 * تنظیمات هایلایت (ماژیک واقعی):
 * - پهن، بدون تیپر، کمی نرم‌تر از قلم
 */
export function getHighlighterOptions(strokeWidth = 4) {
  const sw = Math.max(1, Number(strokeWidth) || 4);
  return {
    size: sw * 5.5,
    thinning: 0,
    smoothing: 0.85,
    streamline: 0.75,
    simulatePressure: false,
    last: true,
  };
}

export function getStrokeOptions(tool, strokeWidth) {
  return tool === 'highlighter'
    ? getHighlighterOptions(strokeWidth)
    : getPenOptions(strokeWidth);
}

/** تبدیل نقاط خام به مسیر SVG آماده رندر (کانتور پرشده) */
export function pointsToPath(points, tool, strokeWidth) {
  if (!points || points.length === 0) return '';
  // تک‌نقطه (کلیک بدون درگ): دایره کوچک
  if (points.length === 1) {
    const opts = getStrokeOptions(tool, strokeWidth);
    const r = opts.size / 2;
    const { x, y } = points[0];
    return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  const opts = getStrokeOptions(tool, strokeWidth);
  // perfect-freehand انتظار آرایه [x, y] دارد
  const input = points.map((p) => [p.x, p.y]);
  const stroke = getStroke(input, opts);
  if (!stroke || stroke.length === 0) return '';
  return getSvgPathFromStroke(stroke);
}

/** تبدیل کانتور stroke به مسیر SVG هموار */
function getSvgPathFromStroke(stroke) {
  const len = stroke.length;
  if (len < 2) return '';
  let d = `M ${stroke[0][0].toFixed(1)} ${stroke[0][1].toFixed(1)}`;
  // منحنی درجه ۲ از میانگین نقاط برای نرمی
  for (let i = 1; i < len - 1; i++) {
    const xc = ((stroke[i][0] + stroke[i + 1][0]) / 2).toFixed(1);
    const yc = ((stroke[i][1] + stroke[i + 1][1]) / 2).toFixed(1);
    d += ` Q ${stroke[i][0].toFixed(1)} ${stroke[i][1].toFixed(1)} ${xc} ${yc}`;
  }
  const last = stroke[len - 1];
  d += ` L ${last[0].toFixed(1)} ${last[1].toFixed(1)} Z`;
  return d;
}

// ============================================================================
// کرانه و هیت‌تست (برای پاک‌کن)
// ============================================================================

/** کرانه مستطیلی یک استروک (با پد برای ضخامت) */
export function getStrokeBounds(item) {
  if (!item || !Array.isArray(item.points) || item.points.length === 0) {
    return null;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of item.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const opts = getStrokeOptions(item.tool, item.strokeWidth);
  const pad = opts.size / 2 + 4;
  return {
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };
}

/** فاصله نقطه تا پاره‌خط */
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * آیا نقطه به استروک برخورد می‌کند؟ (برای پاک‌کن)
 * tolerance: شعاع پاک‌کن
 */
export function hitTestStroke(item, pt, tolerance = 18) {
  if (!item || !pt || !Array.isArray(item.points) || item.points.length === 0) {
    return false;
  }
  // رد سریع با کرانه
  const b = getStrokeBounds(item);
  if (b) {
    if (pt.x < b.x - tolerance || pt.x > b.x + b.width + tolerance ||
        pt.y < b.y - tolerance || pt.y > b.y + b.height + tolerance) {
      return false;
    }
  }
  // تک‌نقطه
  if (item.points.length === 1) {
    const p = item.points[0];
    return Math.hypot(pt.x - p.x, pt.y - p.y) <= tolerance + 8;
  }
  // فاصله تا نزدیک‌ترین سگمنت
  const opts = getStrokeOptions(item.tool, item.strokeWidth);
  const hitDist = tolerance + opts.size / 2;
  for (let i = 0; i < item.points.length - 1; i++) {
    const a = item.points[i], c = item.points[i + 1];
    if (distToSegment(pt.x, pt.y, a.x, a.y, c.x, c.y) <= hitDist) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// فاز ۲: موتور باکس و کادر ابری
// ============================================================================

/**
 * تولید مسیر SVG کادر ابری با کمان‌های بزیه به‌هم‌پیوسته
 * سبک Bluebeam / GoodNotes — دندانه‌های یکنواخت در هر ۴ ضلع
 *
 * @param {number} x1 - مختصات X نقطه اول
 * @param {number} y1 - مختصات Y نقطه اول
 * @param {number} x2 - مختصات X نقطه دوم
 * @param {number} y2 - مختصات Y نقطه دوم
 * @param {number} strokeW - ضخامت خط (تأثیر در اندازه کمان‌ها)
 * @returns {string} مسیر SVG آماده برای <Path> یا رسم با Canvas 2D
 */
/**
 * فاز ۲-مرحله ۳: بیرون‌زدگی کمان ابری (فاصله نقطه کنترل تا ضلع)
 * تک‌منبع برای همه محاسبات: generateCloudPath، drawCloudPathCanvas،
 * eraserHitsBox و hitFunc لایه. تغییر این فرمول، همه‌جا همگام می‌ماند.
 * توجه: قله واقعی منحنی بزیه درجه ۲ حدود bulb/2 بیرون از ضلع است؛
 * bulb خودش فاصله نقطه کنترل است، نه قله منحنی.
 */
export function getCloudBulb(strokeW = 4) {
  const arcRadius = Math.min(26, Math.max(13, Number(strokeW) * 3.5 || 4));
  return arcRadius * 0.76;
}

// مرحلهٔ ۳۵ §۳: نرمال‌سازِ واحدِ شفافیت (۰٫۰۵ تا ۱٫۰).
// مقادیرِ درصدیِ ذخیره‌شده (مثلِ ۱۰۰) یا خارج از بازه، پیش از هر مصرف،
// به مقیاسِ ۰ تا ۱ تبدیل می‌شوند تا ctx.globalAlpha (که مقدارِ خارج
// از بازه را نادیده می‌گیرد و آلفای قبلی را نگه می‌دارد) و فیلدِ
// opacityی pdf-lib، هرگز مقدارِ نامعتبر نبینند.
// مرحلهٔ ۳۸ §۲: رنگِ خالص با آلفایِ دقیق — در Konva، گره‌هایِ Path و
// Rect پراپِ جداگانهٔ fillOpacity ندارند (Konva آن را نادیده می‌گیرد و
// fill را با opacityی کلیِ گره مات می‌کند)؛ پس تنها راهِ داشتنِ آلفایِ
// دقیق برایِ fill و stroke، دادنِ رشتهٔ `rgba(r, g, b, alpha)` است.
// آلفا دقیقاً همان مقدارِ داده‌شده است (بدونِ کفِ ۰٫۰۵)؛ NaN: null.
export function toRgbaWithAlpha(colorStr, alpha) {
  const pure = toPureRgbCss(colorStr);
  if (!pure) return null;
  const m = /^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/.exec(pure);
  if (!m) return null;
  const a = Number(alpha);
  if (!Number.isFinite(a)) return null;
  const clamped = Math.min(1, Math.max(0, a));
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${clamped})`;
}

// مرحلهٔ ۳۷ §۴(ج): تجزیه‌گرِ دقیقِ رنگ — هر رنگی (#rgb ،#rrggbb
// ،#rrggbbaa ،rgb(...) ،rgba(...)) را به رشتهٔ ۱۰۰٪ ماتِ
// `rgb(r, g, b)` بدونِ آلفا تبدیل می‌کند تا شفافیت فقط یک بار
// (از opacityی آیتم) اعمال شود، نه دو بار (globalAlpha × آلفایِ رنگ).
export function toPureRgbCss(colorStr) {
  if (typeof colorStr !== 'string') return null;
  const c = colorStr.trim();
  let m;
  if ((m = /^#([0-9a-fA-F]{3})$/.exec(c))) {
    return `rgb(${parseInt(m[1][0] + m[1][0], 16)}, ${parseInt(m[1][1] + m[1][1], 16)}, ${parseInt(m[1][2] + m[1][2], 16)})`;
  }
  if ((m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(c))) {
    return `rgb(${parseInt(m[1].slice(0, 2), 16)}, ${parseInt(m[1].slice(2, 4), 16)}, ${parseInt(m[1].slice(4, 6), 16)})`;
  }
  if ((m = /^rgba?\(\s*([0-9.]+)(%?)\s*,\s*([0-9.]+)(%?)\s*,\s*([0-9.]+)(%?)/.exec(c))) {
    const conv = (v, pct) => (pct ? (Number(v) * 255) / 100 : Number(v));
    const r = Math.round(conv(m[1], m[2]));
    const g = Math.round(conv(m[3], m[4]));
    const b = Math.round(conv(m[5], m[6]));
    if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return null;
    return `rgb(${r}, ${g}, ${b})`;
  }
  return null;
}

export function normalizeOpacityValue(raw, fallback = 1.0) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  // اگر عدد بزرگ‌تر از 1 بود (مثلاً 100 برای 100%)، بر 100 تقسیم شود:
  const normalized = num > 1 ? num / 100 : num;
  return Math.min(1.0, Math.max(0.05, normalized));
}

// مرحلهٔ ۳۵ §۳: وقتی شفافیتِ آیتم دقیقاً ۱٫۰ است، کانالِ آلفای رنگ‌های
// rgba را به ۱٫۰ برمی‌گرداند تا در PDFخوان‌های دیگر، هیچ شفافیتِ
// پنهانی روی متن یا کپسولِ آن نماند. رنگ‌های غیرِ rgba دست نمی‌خورند.
export function forceOpaqueRgba(color) {
  if (typeof color !== 'string') return color;
  const m = color.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)$/);
  if (!m) return color;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, 1)`;
}

// مرحلهٔ ۳۵ §۴: هندسهٔ تطبیقیِ ابر — گامِ کمان، هرگز از یک‌سومِ ضلعِ
// کوچک‌ترِ مستطیل بیشتر نمی‌شود و هر ضلع، دقیقاً به تعدادِ صحیحی
// کمان تقسیم می‌شود تا در باکس‌های کوچک، ابرها در هم نروند.
export function computeAdaptiveCloudGeometry(absWIn, absHIn, baseStep) {
  const absW = Math.max(4, Math.abs(absWIn));
  const absH = Math.max(4, Math.abs(absHIn));
  const minSide = Math.min(absW, absH);
  const rawStep = Math.min(baseStep || 18, minSide / 3.0);
  const adaptiveStep = Math.max(4, rawStep);
  const countX = Math.max(2, Math.round(absW / adaptiveStep));
  const countY = Math.max(2, Math.round(absH / adaptiveStep));
  const stepX = absW / countX;
  const stepY = absH / countY;
  const bulgeX = Math.min(stepX * 0.48, minSide * 0.22);
  const bulgeY = Math.min(stepY * 0.48, minSide * 0.22);
  return {
    absW, absH, minSide, adaptiveStep,
    countX, countY, stepX, stepY, bulgeX, bulgeY,
    w: absW, h: absH,
  };
}

// مرحلهٔ ۳۵ §۴: رسمِ مسیرِ باکسِ ابریِ تطبیقی روی Canvas 2D —
// نامِ دقیقِ پرامپت. ساعت‌گرد: بالا، راست، پایین، چپ.
export function drawAdaptiveCloudBoxPath(ctx, x, y, w, h, baseStep) {
  const g = computeAdaptiveCloudGeometry(w, h, baseStep);
  const ox = w < 0 ? x + w : x;
  const oy = h < 0 ? y + h : y;
  const { absW, absH, countX, countY, stepX, stepY, bulgeX, bulgeY } = g;
  ctx.beginPath();
  ctx.moveTo(ox, oy);
  for (let i = 0; i < countX; i++) {
    const sx = ox + i * stepX;
    const ex = ox + (i + 1) * stepX;
    ctx.quadraticCurveTo((sx + ex) / 2, oy - bulgeY, ex, oy);
  }
  for (let i = 0; i < countY; i++) {
    const sy = oy + i * stepY;
    const ey = oy + (i + 1) * stepY;
    ctx.quadraticCurveTo(ox + absW + bulgeX, (sy + ey) / 2, ox + absW, ey);
  }
  for (let i = 0; i < countX; i++) {
    const sx = ox + absW - i * stepX;
    const ex = ox + absW - (i + 1) * stepX;
    ctx.quadraticCurveTo((sx + ex) / 2, oy + absH + bulgeY, ex, oy + absH);
  }
  for (let i = 0; i < countY; i++) {
    const sy = oy + absH - i * stepY;
    const ey = oy + absH - (i + 1) * stepY;
    ctx.quadraticCurveTo(ox - bulgeX, (sy + ey) / 2, ox, ey);
  }
  ctx.closePath();
}

export function generateCloudPath(x1, y1, x2, y2, strokeW = 4) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  // مرحلهٔ ۳۵ §۴: همان هندسهٔ تطبیقیِ drawAdaptiveCloudBoxPath، با
  // گامِ پایهٔ وابسته به ضخامت (حفظِ ظاهرِ قبلی برای باکس‌های معمولی).
  const arcRadius = Math.min(26, Math.max(13, strokeW * 3.5));
  const g = computeAdaptiveCloudGeometry(Math.abs(x2 - x1), Math.abs(y2 - y1), arcRadius * 1.55);
  const { w, h, countX: nx, countY: ny, stepX, stepY, bulgeX, bulgeY } = g;

  let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;

  // ضلع بالا (چپ به راست)
  for (let i = 0; i < nx; i++) {
    const sx = x + i * stepX;
    const ex = x + (i + 1) * stepX;
    const mx = (sx + ex) / 2;
    const my = y - bulgeY;
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${y.toFixed(1)}`;
  }

  // ضلع راست (بالا به پایین)
  for (let i = 0; i < ny; i++) {
    const sy = y + i * stepY;
    const ey = y + (i + 1) * stepY;
    const mx = x + w + bulgeX;
    const my = (sy + ey) / 2;
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${(x + w).toFixed(1)} ${ey.toFixed(1)}`;
  }

  // ضلع پایین (راست به چپ)
  for (let i = 0; i < nx; i++) {
    const sx = x + w - i * stepX;
    const ex = x + w - (i + 1) * stepX;
    const mx = (sx + ex) / 2;
    const my = y + h + bulgeY;
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${(y + h).toFixed(1)}`;
  }

  // ضلع چپ (پایین به بالا)
  for (let i = 0; i < ny; i++) {
    const sy = y + h - i * stepY;
    const ey = y + h - (i + 1) * stepY;
    const mx = x - bulgeX;
    const my = (sy + ey) / 2;
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${ey.toFixed(1)}`;
  }

  d += ' Z';
  return d;
}

/**
 * رسم مسیر کادر ابری مستقیماً روی Canvas 2D (برای Konva Shape sceneFunc)
 * همان الگوریتم generateCloudPath ولی با دستورات Canvas به‌جای رشته SVG
 */
export function drawCloudPathCanvas(ctx, x1, y1, x2, y2, strokeW = 4) {
  // مرحلهٔ ۳۵ §۴: همان هندسهٔ تطبیقیِ drawAdaptiveCloudBoxPath — هر دو
  // مصرف‌کننده (لایه و خروجیِ PDF) از همین تابع می‌خوانند، پس هندسه،
  // ذاتاً در هر دو یکی است و از هم منحرف نمی‌شود.
  const arcRadius = Math.min(26, Math.max(13, strokeW * 3.5));
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  drawAdaptiveCloudBoxPath(ctx, x, y, Math.abs(x2 - x1), Math.abs(y2 - y1), arcRadius * 1.55);
}

/**
 * آیا پاک‌کن با باکس برخورد می‌کند؟
 * بررسی برخورد با ۴ ضلع + داخل باکس
 *
 * @param {Array} eraserPts - آرایه نقاط پاک‌کن [{x, y}, ...]
 * @param {Object} boxItem - آیتم باکس {x, y, width, height}
 * @param {number} radius - شعاع پاک‌کن
 * @returns {boolean}
 */
export function eraserHitsBox(eraserPts, boxItem, radius = 14) {
  if (!eraserPts || eraserPts.length === 0 || !boxItem) return false;
  const bx = Number(boxItem.x) || 0;
  const by = Number(boxItem.y) || 0;
  const bw = Number(boxItem.width) || 0;
  const bh = Number(boxItem.height) || 0;
  if (bw <= 0 || bh <= 0) return false;

  // فاز ۲-مرحله ۳ (سناریو ۲): کادر ابری تا bulb بیرون از مستطیل باد می‌کند.
  // قبلاً رد سریع فقط با radius انجام می‌شد، پس نقطه روی لبه بیرونی
  // استروک ابریِ ضخیم (قله ≈ bulb/2 + strokeWidth/2، تا ≈۱۵٫۴ پیکسل
  // بیرون از ضلع در strokeWidth=11) می‌توانست رد شود. حالا حاشیه
  // دقیقاً طبق مشخصات مرحله ۳ است: margin = bulb + radius، فقط برای
  // cloud؛ برای rect/round همان radius قبلی حفظ می‌شود تا ناحیه پاک‌کن
  // بی‌دلیل بزرگ نشود. این تقریب عمدی است: کمان یکنواخت نیست و در
  // گوشه‌ها کمی سخاوتمندانه‌تر برخورد می‌کند، که برای پاک‌کن قابل قبول است.
  const bulb = boxItem.boxStyle === 'cloud' ? getCloudBulb(boxItem.strokeWidth) : 0;
  const margin = radius + bulb;

  const r2 = radius * radius;

  // تابع کمکی: فاصله نقطه تا پاره‌خط
  const distToSeg = (px, py, ax, ay, cx, cy) => {
    const dx = cx - ax, dy = cy - ay;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  // ۴ ضلع باکس
  const edges = [
    [bx, by, bx + bw, by],           // بالا
    [bx + bw, by, bx + bw, by + bh], // راست
    [bx, by + bh, bx + bw, by + bh], // پایین
    [bx, by, bx, by + bh],           // چپ
  ];

  for (const pt of eraserPts) {
    const px = pt.x, py = pt.y;
    // بررسی داخل باکس (با حاشیه margin، نه فقط radius)
    if (px >= bx - margin && px <= bx + bw + margin &&
        py >= by - margin && py <= by + bh + margin) {
      // داخل یا نزدیک باکس — بررسی دقیق‌تر با اضلاع
      // برای ابری، فاصله تا ضلع تا margin مجاز است تا کمان برآمده
      // هم پاک شود؛ برای غیرابری margin همان radius است.
      for (const [ax, ay, cx, cy] of edges) {
        if (distToSeg(px, py, ax, ay, cx, cy) <= margin) return true;
      }
      // اگر نقطه داخل باکس است (نه فقط نزدیک لبه)، هم برخورد محسوب می‌شود
      if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) return true;
    }
  }
  return false;
}

// ============================================================================
// فاز ۳: موتور فلش حرفه‌ای — مستقیم و منحنی
// مرجع هندسه: انجین قدیمی (generateArrowGeometry / generateCurvedArrowGeometry)
// با دو اصلاح نسبت به قدیمی: (۱) خروجی هندسه یکدست است و حالت تباه‌شده
// شکل خروجی را عوض نمی‌کند؛ (۲) نقطه کنترل پیش‌فرض دقیقاً با فرمول
// مشخص‌شده در TASK برمی‌گردد ({cx, cy}، نه {x, y}).
// ============================================================================

/**
 * نقطه کنترل پیش‌فرض منحنی بر اساس عمودمنصف و فاصله دو نقطه.
 * فرمول دقیق TASK: نقطه میانی + بردار واحد عمود (-dy/len, dx/len)
 * ضرب در طول × نسبت خمیدگی (پیش‌فرض ۰٫۱۸).
 */
export function defaultCurveControl(x1, y1, x2, y2, bendRatio = 0.18) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  // بردار واحد عمود بر خط: (-dy/len, dx/len)
  return {
    cx: Math.round((mx - (dy / len) * len * bendRatio) * 100) / 100,
    cy: Math.round((my + (dx / len) * len * bendRatio) * 100) / 100,
  };
}

/** نقطه روی منحنی بزیه درجه ۲ در پارامتر t */
export function quadraticPoint(p0, pc, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * pc.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * pc.y + t * t * p2.y,
  };
}

/**
 * بردار مماس منحنی بزیه درجه ۲ در پارامتر t.
 * B'(t) = 2(1-t)(Pc - P0) + 2t(P2 - Pc)
 * در انتها: B'(1) = 2(P2 - Pc) — یعنی جهت مماس انتهایی فقط به
 * بردار «کنترل → پایان» بستگی دارد، نه به نقطه شروع. همین بردار،
 * زاویهٔ چرخش نوک پیکان را در فلش منحنی تعیین می‌کند (تراز C1).
 */
export function quadraticTangent(p0, pc, p2, t) {
  return {
    x: 2 * (1 - t) * (pc.x - p0.x) + 2 * t * (p2.x - pc.x),
    y: 2 * (1 - t) * (pc.y - p0.y) + 2 * t * (p2.y - pc.y),
  };
}

/** فاصله نقطه تا منحنی بزیه درجه ۲ (نمونه‌برداری از پاره‌خط‌ها) */
export function distanceToQuadraticBezier(pt, p0, pc, p2, samples = 16) {
  let best = Infinity;
  let prev = p0;
  for (let i = 1; i <= samples; i++) {
    const cur = quadraticPoint(p0, pc, p2, i / samples);
    const d = distToSegment(pt.x, pt.y, prev.x, prev.y, cur.x, cur.y);
    if (d < best) best = d;
    prev = cur;
  }
  return best;
}

/** اندازه نوک پیکان بر پایه ضخامت خط: clamp(14 + strokeW × 2.5, 16, 38) */
function getArrowHeadSize(strokeW = 4) {
  return Math.max(16, Math.min(38, 14 + (Number(strokeW) || 4) * 2.5));
}

/**
 * شعاعِ دایرهٔ مبدأ در سبکِ ماژولار (Refinement Step 2).
 * طبقِ TASK: r = max(4, strokeWidth × 1.5).
 */
export function getOriginDotRadius(strokeWidth = 4) {
  const sw = Number(strokeWidth) || 4;
  return Math.max(4, sw * 1.5);
}

/**
 * طولِ بازوی تیکِ باز در سبکِ ماژولار (Refinement Step 2).
 * طبقِ TASK: headLen = max(12, strokeWidth × 2.2)، و برشِ بدنه
 * cutback = headLen × 0.62 است.
 */
export function getChevronHeadLength(strokeWidth = 4) {
  const sw = Number(strokeWidth) || 4;
  return Math.max(12, sw * 2.2);
}

/**
 * هندسهٔ تیکِ دوخطیِ باز (Open Two-Line Chevron).
 * برمی‌گرداند: tip (نوک)، left/right (انتهای دو بازو)،
 * armLength (= headLen)، cutback (= headLen × 0.62) و alpha.
 * زاویهٔ angle باید همان مماسِ انتهاییِ C¹ باشد: برای فلشِ صاف،
 * زاویهٔ وتر؛ برای منحنی، زاویهٔ B'(1) = 2(P2 − Pc).
 */
export function getChevronGeometry(tipX, tipY, angle, strokeWidth = 4) {
  const headLen = getChevronHeadLength(strokeWidth);
  const cutback = headLen * 0.62;
  const alpha = Math.PI / 6.4; // ≈ ۲۸٫۱ درجه، مثلِ پخشِ بالِ قدیمی
  const tip = { x: tipX, y: tipY };
  const left = {
    x: tipX - Math.cos(angle - alpha) * headLen,
    y: tipY - Math.sin(angle - alpha) * headLen,
  };
  const right = {
    x: tipX - Math.cos(angle + alpha) * headLen,
    y: tipY - Math.sin(angle + alpha) * headLen,
  };
  return { headLen, cutback, armLength: headLen, alpha, tip, left, right };
}

export function getArrowHeadGeometry(tipX, tipY, angle, strokeWidth = 4) {
  // سازگاریِ رو به عقب (Refinement Step 2): قبلاً این تابع چندضلعیِ
  // توپرِ [tip, left, notch, right] برمی‌گرداند. حالا تیکِ باز است و
  // points فقط سه نقطهٔ [tip, left, right] دارد — یعنی چندضلعیِ بسته
  // نیست و نباید با fill() رسم شود. notch برای سازگاری نگه داشته
  // شده و برابرِ نقطهٔ پایانِ برش‌خوردهٔ بدنه است.
  const chev = getChevronGeometry(tipX, tipY, angle, strokeWidth);
  const headSize = getArrowHeadSize(strokeWidth);
  const notch = {
    x: tipX - Math.cos(angle) * chev.cutback,
    y: tipY - Math.sin(angle) * chev.cutback,
  };
  const points = [chev.tip, chev.left, chev.right];
  return {
    headSize,
    tip: chev.tip,
    left: chev.left,
    notch,
    right: chev.right,
    points,
    headPoints: points.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' '),
    chevron: chev,
  };
}

/**
 * حل هندسه کامل یک آیتم فلش (داخلی، مشترک بین رسم و پاک‌کن).
 * برمی‌گرداند: isCurved، angle (زاویه مماس انتهایی)، head (هندسه نوک)
 * و نقطه پایانِ برش‌خوردهٔ بدنه (cutX, cutY)، به‌علاوهٔ cutback و
 * shaftVisible.
 * اگر فلش تباه‌شده باشد (شروع = پایان، یا مماسِ منحنی ≈ صفر و وتر هم
 * صفر)، null برمی‌گردد تا هیچ چیزِ ناقصی رسم نشود؛ شکل خروجی در حالت
 * تباه‌شده عوض نمی‌شود (برخلاف تابع منحنیِ قدیمی).
 *
 * اصلاح مرحله ۳-فاز ۳ (سناریو ۱ و ۲):
 * (۱) shaftVisible: اگر طول وتر (فاصله شروع تا پایان) کمتر یا مساوی
 * برش بدنه (۰٫۶۲ × headSize) باشد، بدنه اصلاً رسم نمی‌شود تا نقطهٔ
 * برش از نقطه شروع عقب‌تر نیفتد و خط معکوس ساخته نشود؛ فقط نوک
 * رسم می‌شود. این حالت در عمل هم رخ می‌دهد، چون نگهبانِ لایه فقط
 * طولِ کمتر از ۸ را رد می‌کند، ولی برش برای ضخامت ۱۱ تا ۲۳٫۵۶
 * است — پس فلش‌های ۸ تا ۲۳ پیکسلیِ ضخیم، قبل از این اصلاح،
 * پرتاب معکوس داشتند.
 * (۲) مماس تباه‌شده: آستانهٔ برگشت به وتر، از 1e-6 به مربعِ فاصلهٔ
 * کمتر از ۰٫۰۱ (یعنی فاصلهٔ کمتر از ۰٫۱) بالا رفت. بردارِ مماسِ
 * بسیار کوچک، جهتِ نویزی دارد و atan2(0, 0) هم ۰ می‌دهد (افقِ راست)؛
 * در این حالت نادر، زاویه از بردارِ کلیِ شروع تا پایان گرفته
 * می‌شود تا نوک ناگهان به افق نچرخد.
 */
/**
 * حل هندسه کامل یک آیتم فلشِ ماژولار (داخلی، مشترک بین رسم،
 * هیت‌تست و پاک‌کن) — Refinement Step 2.
 * فیلدهای ماژولارِ آیتم:
 *   hasStartDot: boolean — دایرهٔ توپر در مبدأ (پیش‌فرض برای آیتمِ
 *     قدیمیِ بدونِ فیلد: false، تا آیتم‌های قدیمی ناگهان نقطه نگیرند).
 *   hasEndArrow: boolean — تیکِ باز در انتها (پیش‌فرض برای آیتمِ
 *     قدیمیِ بدونِ فیلد: true، تا فلش‌های قدیمی سرشان را از دست
 *     ندهند؛ فقط سبکِ سر از توپر به باز عوض می‌شود).
 * برمی‌گرداند: isCurved، angle (مماسِ انتهاییِ C¹)، head (هندسهٔ
 * تیکِ باز)، chevron، dotRadius، headLen، cutback (برشِ انتها؛ اگر
 * نوک نباشد صفر است)، shaftStartX/Y (شروعِ برش‌خوردهٔ بدنه)،
 * cutX/cutY (پایانِ برش‌خوردهٔ بدنه)، shaftVisible و مماس‌های واحد.
 * اگر فلش تباه‌شده باشد (شروع = پایان)، null برمی‌گردد — به‌جز
 * حالتِ دایرهٔ تنها که drawArrowCanvas جداگانه با آن کنار می‌آید.
 * اصلاح‌های مرحلهٔ ۳-فاز ۳ حفظ شده‌اند: آستانهٔ مماسِ تباه‌شده
 * (مربعِ فاصله < ۰٫۰۱ → برگشت به وتر) و shaftVisible برای جلوگیری
 * از خطِ معکوس.
 */
function resolveArrowGeometry(item) {
  if (!item) return null;
  const sx = Number(item.startX);
  const sy = Number(item.startY);
  const ex = Number(item.endX);
  const ey = Number(item.endY);
  if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
      !Number.isFinite(ex) || !Number.isFinite(ey)) {
    return null;
  }
  const sw = Number(item.strokeWidth) || 4;
  let isCurved = item.arrowStyle === 'curved' &&
    Number.isFinite(item.cx) && Number.isFinite(item.cy);
  let tx, ty;
  if (isCurved) {
    tx = ex - Number(item.cx);
    ty = ey - Number(item.cy);
    if (tx * tx + ty * ty < 0.01) {
      // مماسِ منحنی تباه‌شده یا نویزی → برگشت به وتر.
      isCurved = false;
      tx = ex - sx;
      ty = ey - sy;
    }
  } else {
    tx = ex - sx;
    ty = ey - sy;
  }
  if (Math.hypot(tx, ty) < 1e-6) return null;
  const angle = Math.atan2(ty, tx);
  // مماسِ واحد در شروع: برای منحنی، B'(0) = 2(Pc − P0)؛ برای صاف، وتر.
  let stx, sty;
  if (isCurved) {
    stx = Number(item.cx) - sx;
    sty = Number(item.cy) - sy;
    if (stx * stx + sty * sty < 0.01) {
      stx = ex - sx;
      sty = ey - sy;
    }
  } else {
    stx = ex - sx;
    sty = ey - sy;
  }
  const slen = Math.hypot(stx, sty) || 1;
  stx /= slen;
  sty /= slen;
  const etx = Math.cos(angle);
  const ety = Math.sin(angle);

  const hasStartDot = item.hasStartDot === true;
  const hasEndArrow = item.hasEndArrow !== false;
  const dotRadius = getOriginDotRadius(sw);
  const headLen = getChevronHeadLength(sw);
  const cutback = hasEndArrow ? headLen * 0.62 : 0;
  const shaftStartX = sx + stx * (hasStartDot ? dotRadius : 0);
  const shaftStartY = sy + sty * (hasStartDot ? dotRadius : 0);
  const cutX = ex - etx * cutback;
  const cutY = ey - ety * cutback;
  const chordLength = Math.hypot(ex - sx, ey - sy);
  // برشِ دوطرفه: بدنه فقط وقتی رسم می‌شود که طولِ وتر از مجموعِ
  // دو برش بیشتر باشد، وگرنه نقطهٔ شروعِ برش‌خورده از پایانِ
  // برش‌خورده جلوتر می‌افتد و خطِ معکوس ساخته می‌شود.
  const shaftVisible = chordLength > (hasStartDot ? dotRadius : 0) + cutback;
  const chevron = hasEndArrow ? getChevronGeometry(ex, ey, angle, sw) : null;
  const head = chevron
    ? {
        headSize: headLen,
        tip: chevron.tip,
        left: chevron.left,
        notch: { x: cutX, y: cutY },
        right: chevron.right,
        points: [chevron.tip, chevron.left, chevron.right],
        headPoints: [chevron.tip, chevron.left, chevron.right]
          .map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' '),
        chevron,
      }
    : {
        headSize: headLen,
        tip: { x: ex, y: ey },
        left: { x: ex, y: ey },
        notch: { x: ex, y: ey },
        right: { x: ex, y: ey },
        points: [{ x: ex, y: ey }],
        headPoints: '',
        chevron: null,
      };
  return {
    isCurved, angle, head, chevron, cutX, cutY, cutback, chordLength,
    shaftVisible, sx, sy, ex, ey, sw,
    hasStartDot, hasEndArrow, dotRadius, headLen,
    shaftStartX, shaftStartY,
    startTangent: { x: stx, y: sty },
    endTangent: { x: etx, y: ety },
  };
}

export { resolveArrowGeometry };

/**
 * رسم یکپارچه فلش در Canvas نیتیو (برای Konva Shape sceneFunc).
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} item - آیتم فلش {startX, startY, endX, endY, cx?, cy?,
 *   arrowStyle: 'straight'|'curved', color, strokeWidth}
 * گذر اول (بدنه): خط با lineCap/lineJoin گرد، تا نقطهٔ برش‌خورده
 * (۰٫۶۲ × headSize عقب‌تر از نوک در راستای مماس).
 * گذر دوم (نوک مقعر): چندضلعی [tip, left, notch, right] با fill،
 * به‌علاوهٔ یک stroke هم‌رنگ و ملایم برای گرد شدن لبه‌ها.
 * شفافیت (opacity) در این تابع دست نمی‌خورد؛ فراخواننده (Shape در
 * Konva یا پیش‌نمایش زنده با globalAlpha) آن را اعمال می‌کند تا
 * شفافیت دو بار ضرب نشود.
 */
/**
 * رسم یکپارچه فلشِ ماژولار در Canvas نیتیو (برای Konva Shape sceneFunc).
 * سه گذر، به ترتیب:
 *  ۱) دایرهٔ مبدأ (فقط اگر hasStartDot): دایرهٔ توپر با fill، شعاعِ
 *     r = max(4, strokeWidth × 1.5) در (startX, startY).
 *  ۲) بدنهٔ برش‌خورده (فقط اگر shaftVisible): از shaftStart تا cut،
 *     با lineCap/lineJoin گرد. برای منحنی، بزیه با همان نقطهٔ کنترل
 *     ولی با نقاطِ انتهاییِ برش‌خورده رسم می‌شود (تقریبِ نزدیک به
 *     برشِ دقیقِ بزیه؛ برای فلشِ صاف، دقیق است).
 *  ۳) تیکِ دوخطیِ باز (فقط اگر hasEndArrow): دو پاره‌خطِ tip→left و
 *     tip→right با همان strokeWidthی بدنه و lineCap گرد، و هیچ
 *     دستورِ fill()ای برای تیک اجرا نمی‌شود.
 * شفافیت (opacity) در این تابع دست نمی‌خورد؛ فراخواننده (Shape در
 * Konva یا پیش‌نمایش زنده با globalAlpha) آن را اعمال می‌کند تا
 * شفافیت دو بار ضرب نشود.
 */
export function drawArrowCanvas(ctx, item) {
  const g = resolveArrowGeometry(item);
  if (!g || !ctx) return;
  const color = item.color || '#22d3ee';
  const sw = g.sw;

  ctx.save();
  // گذر اول: دایرهٔ مبدأ (توپر — fill فقط برای دایره است، نه تیک).
  if (g.hasStartDot) {
    ctx.beginPath();
    ctx.arc(g.sx, g.sy, g.dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // گذر دوم: بدنهٔ برش‌خوردهٔ دوطرفه.
  if (g.shaftVisible) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (g.isCurved) {
      ctx.moveTo(g.shaftStartX, g.shaftStartY);
      ctx.quadraticCurveTo(Number(item.cx), Number(item.cy), g.cutX, g.cutY);
    } else {
      ctx.moveTo(g.shaftStartX, g.shaftStartY);
      ctx.lineTo(g.cutX, g.cutY);
    }
    ctx.stroke();
  }

  // گذر سوم: تیکِ باز — دو خط، بدونِ fill.
  if (g.hasEndArrow && g.chevron) {
    const { tip, left, right } = g.chevron;
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(left.x, left.y);
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(right.x, right.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** آیا نقطه روی پاره‌خط است؟ (با تلرانسِ کوچک برای خطای اعشار) */
function isPointOnSegment(px, py, ax, ay, bx, by, eps = 1e-9) {
  const cross = (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  if (Math.abs(cross) > eps) return false;
  const dot = (px - ax) * (px - bx) + (py - ay) * (py - by);
  return dot <= eps;
}

/** جهتِ چرخشِ سه نقطه: 0 = هم‌خط، 1 = ساعت‌گرد، 2 = پادساعت‌گرد. */
function orientation(ax, ay, bx, by, cx, cy) {
  const val = (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
  if (Math.abs(val) < 1e-12) return 0;
  return val > 0 ? 1 : 2;
}

/** آیا نقطه داخل چندضلعی است؟ (روش پرتوافکنی)
 * توجه (Refinement Step 2): برای سرِ فلش دیگر استفاده نمی‌شود
 * (تیکِ باز چندضلعی نیست)؛ برای سازگاری نگه داشته شده است. */
export function pointInPolygon(px, py, points) {
  if (!points || points.length < 3) return false;
  // نقطهٔ روی یال، داخل حساب می‌شود (Ray-Castingِ تنها، روی یال
  // رفتارِ نامشخص دارد و تستِ «روی یال» باید قطعی باشد).
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    if (isPointOnSegment(px, py, points[i].x, points[i].y, points[j].x, points[j].y)) return true;
  }
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    if ((yi > py) !== (yj > py) &&
        px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** آیا دو پاره‌خط همدیگر را قطع می‌کنند؟ (شاملِ تماسِ سر‌به‌سر و هم‌پوشانیِ هم‌خط). */
export function segmentsIntersect(p1, p2, p3, p4) {
  if (!p1 || !p2 || !p3 || !p4) return false;
  const o1 = orientation(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
  const o2 = orientation(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
  const o3 = orientation(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
  const o4 = orientation(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && isPointOnSegment(p3.x, p3.y, p1.x, p1.y, p2.x, p2.y)) return true;
  if (o2 === 0 && isPointOnSegment(p4.x, p4.y, p1.x, p1.y, p2.x, p2.y)) return true;
  if (o3 === 0 && isPointOnSegment(p1.x, p1.y, p3.x, p3.y, p4.x, p4.y)) return true;
  if (o4 === 0 && isPointOnSegment(p2.x, p2.y, p3.x, p3.y, p4.x, p4.y)) return true;
  return false;
}

/** نقاطِ نمونهٔ یک آیتم برای تستِ کمند: مرکز، رئوس و نقاطِ مسیر.
 * قلم/هایلایتر: همهٔ نقاطِ مسیر؛ فلش: شروع/پایان/کنترل + نمونه‌های
 * بزیه؛ باکس/استیکی/متن: چهار گوشهٔ کرانه + مرکز. خروجی در همان
 * دستگاهِ مختصاتی است که آیتم در آن داده شده است. */
export function getItemSamplePoints(item, opts) {
  if (!item) return [];
  const pts = [];
  const push = (x, y) => {
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) pts.push({ x: nx, y: ny });
  };
  if (Array.isArray(item.points) && item.points.length > 0) {
    for (const pt of item.points) push(pt.x, pt.y);
  }
  if (item.tool === 'arrow') {
    push(item.startX, item.startY);
    push(item.endX, item.endY);
    if (item.arrowStyle === 'curved' && Number.isFinite(item.cx) && Number.isFinite(item.cy)) {
      push(item.cx, item.cy);
      const p0 = { x: Number(item.startX), y: Number(item.startY) };
      const pc = { x: Number(item.cx), y: Number(item.cy) };
      const p2 = { x: Number(item.endX), y: Number(item.endY) };
      for (const t of [0.25, 0.5, 0.75]) {
        const q = quadraticPoint(p0, pc, p2, t);
        push(q.x, q.y);
      }
    }
  }
  const b = getItemBounds(item, opts);
  if (b) {
    push(b.x, b.y);
    push(b.x + b.width, b.y);
    push(b.x, b.y + b.height);
    push(b.x + b.width, b.y + b.height);
    push(b.x + b.width / 2, b.y + b.height / 2);
  }
  return pts;
}

/** یال‌های یک آیتم برای تستِ تقاطع با یال‌های کمند: استروک/فلش،
 * پاره‌خط‌های متوالیِ مسیر؛ بقیه، چهار یالِ کرانه. */
export function getItemSegments(item, opts) {
  if (!item) return [];
  const segs = [];
  if (item.tool === 'arrow') {
    const line = [{ x: Number(item.startX), y: Number(item.startY) }];
    if (item.arrowStyle === 'curved' && Number.isFinite(item.cx) && Number.isFinite(item.cy)) {
      const p0 = { x: Number(item.startX), y: Number(item.startY) };
      const pc = { x: Number(item.cx), y: Number(item.cy) };
      const p2 = { x: Number(item.endX), y: Number(item.endY) };
      for (const t of [0.25, 0.5, 0.75]) line.push(quadraticPoint(p0, pc, p2, t));
    }
    line.push({ x: Number(item.endX), y: Number(item.endY) });
    const clean = line.filter((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y));
    for (let i = 0; i + 1 < clean.length; i++) segs.push([clean[i], clean[i + 1]]);
    return segs;
  }
  if (Array.isArray(item.points) && item.points.length > 1) {
    const clean = item.points.filter((pt) => pt && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y)));
    for (let i = 0; i + 1 < clean.length; i++) segs.push([clean[i], clean[i + 1]]);
    return segs;
  }
  const b = getItemBounds(item, opts);
  if (!b) return segs;
  const tl = { x: b.x, y: b.y };
  const tr = { x: b.x + b.width, y: b.y };
  const br = { x: b.x + b.width, y: b.y + b.height };
  const bl = { x: b.x, y: b.y + b.height };
  segs.push([tl, tr], [tr, br], [br, bl], [bl, tl]);
  return segs;
}

/** آیا آیتم داخلِ کمند است؟ مرکز/رئوس/نقاطِ مسیر داخلِ چندضلعی، یا
 * تقاطعِ یالِ چندضلعی با یالِ آیتم (برای شکلِ بزرگ‌تر از کمند). */
export function isItemInLasso(item, polygon, opts) {
  if (!item || !Array.isArray(polygon) || polygon.length < 3) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of polygon) {
    if (!pt || !Number.isFinite(Number(pt.x)) || !Number.isFinite(Number(pt.y))) continue;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  if (!Number.isFinite(minX)) return false;
  const bounds = getItemBounds(item, opts);
  if (!bounds) return false;
  // پیش‌فیلترِ کرانه با 1 واحد حاشیه تا تماسِ دقیقِ لبه، به‌اشتباه رد نشود.
  if (!rectsIntersect(bounds, { x: minX - 1, y: minY - 1, width: maxX - minX + 2, height: maxY - minY + 2 })) return false;
  const samples = getItemSamplePoints(item, opts);
  for (const pt of samples) {
    if (pointInPolygon(pt.x, pt.y, polygon)) return true;
  }
  const itemSegs = getItemSegments(item, opts);
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j];
    const b = polygon[i];
    for (const seg of itemSegs) {
      if (segmentsIntersect(a, b, seg[0], seg[1])) return true;
    }
  }
  return false;
}

/** انتخابِ باکسی: همهٔ آیتم‌هایی که boundingBoxشان با کادر تقاطع دارد. */
export function selectItemsInBox(items, box, opts) {
  if (!Array.isArray(items) || !box) return [];
  const out = [];
  for (const it of items) {
    if (!it || it.id == null) continue;
    if (rectsIntersect(getItemBounds(it, opts), box)) out.push(it.id);
  }
  return out;
}

/** انتخابِ کمندی: همهٔ آیتم‌هایی که داخلِ چندضلعی‌اند (مرکز/رئوس/مسیر یا تقاطعِ یال). */
export function selectItemsInLasso(items, polygon, opts) {
  if (!Array.isArray(items) || !Array.isArray(polygon) || polygon.length < 3) return [];
  const out = [];
  for (const it of items) {
    if (!it || it.id == null) continue;
    if (isItemInLasso(it, polygon, opts)) out.push(it.id);
  }
  return out;
}

/** کمندِ ریز (کلیکِ اشتباهی)؟ کمتر از 3 نقطه، یا قطرِ کرانه کمتر از minDiameter. */
export function isTinyLasso(points, minDiameter = 5) {
  if (!Array.isArray(points) || points.length < 3) return true;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of points) {
    if (!pt || !Number.isFinite(Number(pt.x)) || !Number.isFinite(Number(pt.y))) continue;
    if (pt.x < minX) minX = pt.x;
    if (pt.y < minY) minY = pt.y;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.y > maxY) maxY = pt.y;
  }
  if (!Number.isFinite(minX)) return true;
  return Math.hypot(maxX - minX, maxY - minY) < (Number(minDiameter) || 5);
}

/**
 * آیا پاک‌کن با فلش برخورد می‌کند؟
 * @param {Array} eraserPts - آرایه نقاط پاک‌کن [{x, y}, ...]
 * @param {Object} arrowItem - آیتم فلش (فضای یکنواخت، مثل لایه)
 * @param {number} radius - شعاع پاک‌کن (پیش‌فرض ۱۴)
 * @returns {boolean}
 * پیش‌فیلتر با Bounding Box شامل شروع، پایان، نقطه کنترل (برای منحنی)
 * و حاشیه نوک پیکان (radius + headSize) تا بال‌های نوک هم پوشش داده
 * شوند. سپس برای هر نقطه پاک‌کن: فاصله تا بدنه (پاره‌خط مستقیم یا
 * نمونه‌برداری ۱۶ گامه از بزیه) + فاصله تا اضلاع چندضلعی نوک + داخل
 * بودن در چندضلعی نوک.
 */
/**
 * آیا پاک‌کن با فلشِ ماژولار برخورد می‌کند؟
 * @param {Array} eraserPts - آرایه نقاط پاک‌کن [{x, y}, ...]
 * @param {Object} arrowItem - آیتم فلش (فضای یکنواخت، مثل لایه)
 * @param {number} radius - شعاع پاک‌کن (پیش‌فرض ۱۴)
 * @returns {boolean}
 * پیش‌فیلتر با Bounding Box شامل شروع، پایان، نقطه کنترل (برای منحنی)
 * و حاشیهٔ max(headLen, dotRadius) + radius. سپس برای هر نقطه پاک‌کن:
 * فاصله تا بدنه (پاره‌خط مستقیم یا نمونه‌برداری ۱۶ گامه از بزیه، با
 * مسیرِ کامل — بخشنده‌تر از بدنهٔ برش‌خورده)، فاصله تا دایرهٔ مبدأ
 * (فاصله تا مرکز ≤ dotRadius + radius)، و فاصله تا دو بازوی تیکِ باز.
 * دیگر هیچ بررسیِ «داخلِ چندضلعی»ای نیست، چون تیکِ باز توپر نیست.
 */
export function eraserHitsArrow(eraserPts, arrowItem, radius = 14) {
  if (!eraserPts || eraserPts.length === 0 || !arrowItem) return false;
  const g = resolveArrowGeometry(arrowItem);
  if (!g) {
    // فلشِ تباه‌شده (شروع = پایان): فقط دایرهٔ مبدأ — اگر داشت — پاک می‌شود.
    if (arrowItem.hasStartDot === true) {
      const r = getOriginDotRadius(Number(arrowItem.strokeWidth) || 4);
      const sx = Number(arrowItem.startX);
      const sy = Number(arrowItem.startY);
      if (Number.isFinite(sx) && Number.isFinite(sy)) {
        for (const pt of eraserPts) {
          if (Math.hypot(pt.x - sx, pt.y - sy) <= r + radius) return true;
        }
      }
    }
    return false;
  }
  const sx = g.sx, sy = g.sy, ex = g.ex, ey = g.ey;
  const isCurved = g.isCurved;
  const cx = Number(arrowItem.cx);
  const cy = Number(arrowItem.cy);
  const margin = radius + Math.max(g.headLen, g.hasStartDot ? g.dotRadius : 0);
  const minX = Math.min(sx, ex, isCurved ? cx : Infinity) - margin;
  const maxX = Math.max(sx, ex, isCurved ? cx : -Infinity) + margin;
  const minY = Math.min(sy, ey, isCurved ? cy : Infinity) - margin;
  const maxY = Math.max(sy, ey, isCurved ? cy : -Infinity) + margin;

  for (const pt of eraserPts) {
    const px = pt.x, py = pt.y;
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    // فاصله تا بدنه (مسیرِ کامل، بخشنده)
    let d;
    if (isCurved) {
      d = distanceToQuadraticBezier(
        pt,
        { x: sx, y: sy },
        { x: cx, y: cy },
        { x: ex, y: ey },
        16
      );
    } else {
      d = distToSegment(px, py, sx, sy, ex, ey);
    }
    if (d <= radius) return true;
    // دایرهٔ مبدأ
    if (g.hasStartDot && Math.hypot(px - sx, py - sy) <= g.dotRadius + radius) {
      return true;
    }
    // دو بازوی تیکِ باز
    if (g.hasEndArrow && g.chevron) {
      const { tip, left, right } = g.chevron;
      if (distToSegment(px, py, tip.x, tip.y, left.x, left.y) <= radius) return true;
      if (distToSegment(px, py, tip.x, tip.y, right.x, right.y) <= radius) return true;
    }
  }
  return false;
}

// ============================================================================
// فاز ۴: موتور متن و یادداشت چسبان
// اندازه‌گیری با همان کانواسِ کمکیِ انجینِ قدیمی، ولی با دو تفاوتِ
// مشخص‌شده در TASK مرحلهٔ ۲: (۱) وزنِ فونت در اندازه‌گیری `bold` است
// (مثل رندرِ Konva در این فاز، با fontStyle="bold")، نه ۸۰۰ِ قدیمی؛
// (۲) لنگرِ متن در این فاز، گوشهٔ بالا-چپ است (x/y در CommittedText
// مستقیم به <Text> می‌رسد)، نه نقطهٔ baselineِ قدیمی که متن را به
// سمتِ چپ گسترش می‌داد. پس getTextBounds کرانهٔ تنگِ بالا-چپ را
// برمی‌گرداند تا با رندرِ جدید یکی باشد؛ متن‌های قدیمیِ دیتابیس که
// فقط startX/startY دارند، با همین لنگرِ جدید رندر می‌شوند (نکتهٔ
// سازگاری در گزارشِ پیاده‌سازی آمده است).
// ============================================================================

/** کانواسِ کمکیِ تک‌نمونه (Singleton) برای اندازه‌گیریِ متن */
let _textMeasureCanvas = null;
export function getTextMeasureCanvas() {
  if (!_textMeasureCanvas) {
    if (typeof document !== 'undefined') {
      _textMeasureCanvas = document.createElement('canvas');
    } else {
      throw new Error('no document');
    }
  }
  return _textMeasureCanvas;
}

/**
 * کرانهٔ متن در فضای یکنواخت.
 * @param {Object} item - آیتمِ متن {text, fontSize, fontFamily, x?, y?, startX?, startY?}
 * @returns {{x: number, y: number, width: number, height: number}}
 * خواندنِ دوگانهٔ مختصات: x ?? startX ?? 0 و y ?? startY ?? 0.
 * فونتِ اندازه‌گیری دقیقاً مثل رندر است: `bold ${fontSize}px ${fontFamily}`
 * با جهتِ rtl. عرض = بیشینهٔ عرضِ خطوط (خطوط با \n جدا می‌شوند؛ خطِ
 * خالی با ' ' اندازه‌گیری می‌شود تا عرضِ صفر ندهد). ارتفاع = تعدادِ
 * خطوط × lineHeight با lineHeight = fontSize × 1.3 (همان lineHeightِ
 * رندرِ Konva در این فاز). اگر اندازه‌گیری در دسترس نبود (مثلاً
 * محیطِ بدونِ document)، از تقریبِ قدیمیِ ۰٫۵۸ × fontSize به ازای
 * هر کاراکتر استفاده می‌شود تا تابع هیچ‌وقت خطا ندهد.
 */
/**
 * Refinement Phase 1 Step 2: تشخیصِ خودکارِ جهتِ متن.
 * اولین کاراکترِ «قوی» (strong) تعیین‌کننده است؛ کاراکترهای خنثی
 * (فاصله، عدد، نقطه‌گذاری) رد می‌شوند تا «۱۲: DNA» لاتین و «۱۲:
 * پروتئین» فارسی، درست تشخیص داده شوند.
 * - بازه‌های خطِ عربی (فارسی/عربی): U+0600–U+06FF، U+0750–U+077F،
 *   U+08A0–U+08FF، U+FB50–U+FDFF، U+FE70–U+FEFF → 'rtl'
 * - حروفِ لاتین A–Z/a–Z (و حروفِ لاتینِ توسعه‌یافتهٔ U+00C0–U+024F) → 'ltr'
 * - اگر هیچ کاراکترِ قوی‌ای نبود (متنِ خالی یا فقط عدد/نشانه):
 *   'rtl' برمی‌گردد تا رفتارِ قبلی (که همیشه rtl بود) برای کاربرِ
 *   فارسی حفظ شود.
 * عرضِ اندازه‌گیری به جهت وابسته نیست، ولی ترازِ رندر (align) و
 * جهتِ بومِ اندازه‌گیری به آن وابسته‌اند؛ پس این تابع، ورودیِ هر
 * دوی آن‌هاست.
 */
export function detectTextDirection(text) {
  const str = String(text || '');
  for (const ch of str) {
    const code = ch.codePointAt(0);
    if (
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0x08a0 && code <= 0x08ff) ||
      (code >= 0xfb50 && code <= 0xfdff) ||
      (code >= 0xfe70 && code <= 0xfeff)
    ) {
      return 'rtl';
    }
    if (
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a) ||
      (code >= 0x00c0 && code <= 0x024f)
    ) {
      return 'ltr';
    }
  }
  return 'rtl';
}

/**
 * Refinement Phase 1 Step 2: کادرِ کپسولیِ (Pill) متن.
 * از getTextBoundsی خالص ساخته می‌شود، به‌علاوهٔ padding در هر چهار
 * سمت؛ گوشه‌ها کاملاً گردند (cornerRadius = نصفِ ارتفاعِ کپسول) تا
 * شکل، کپسولِ واقعی باشد، نه مستطیلِ گوشه‌گردِ معمولی.
 * - padX = max(8, round(fontSize × 0.45)) — برای fontSize=22 می‌شود 10
 * - padY = max(6, round(fontSize × 0.30)) — برای fontSize=22 می‌شود 7
 * fontSize با همان clampِ getTextBounds (۱۴ تا ۷۶) محاسبه می‌شود تا
 * Pill و متن، همیشه از یک اندازه حرف بزنند.
 * توجهِ طراحی (مهم): getTextBounds خودش، padding را شامل نمی‌شود
 * و نمی‌شود — چون کرانهٔ متن در هیت‌تست، پاک‌کن، مارکی و ترنسفورم
 * استفاده می‌شود و اگر padding داخلش بود، همهٔ آن‌ها باد می‌کردند.
 * پس Pill یک تابعِ جداگانه است که از getTextBounds مشتق می‌شود.
 */
export function getTextPillBounds(item) {
  const b = getTextBounds(item);
  const fontSize = Math.max(14, Math.min(76, Number(item && item.fontSize) || 22));
  const padX = Math.max(8, Math.round(fontSize * 0.45));
  const padY = Math.max(6, Math.round(fontSize * 0.3));
  const height = b.height + padY * 2;
  return {
    x: b.x - padX,
    y: b.y - padY,
    width: b.width + padX * 2,
    height,
    cornerRadius: Math.round(height / 2),
    padX,
    padY,
  };
}

// ============================================================================
// Forensic Step 4 — کنتراستِ پویای کپسولِ متن (Dynamic Callout Pill Contrast)
// مسئله: متنِ تیره (مشکی/سرمه‌ای) روی کپسولِ تیرهٔ پیش‌فرض، عملاً
// نامرئی می‌شد — یکی از توضیح‌های محتملِ «متن ساخته می‌شود ولی
// دیده نمی‌شود». راه‌حل: رنگِ کپسول در لحظهٔ رندر، از روشناییِ
// رنگِ قلم مشتق می‌شود، نه از مقدارِ ذخیره‌شدهٔ قدیمی:
//  • قلمِ تیره (luminance < 0.5) → کپسولِ روشن
//    'rgba(248, 250, 252, 0.9)' با حاشیهٔ ظریفِ تیره.
//  • قلمِ روشن/فسفری (luminance ≥ 0.5) یا رنگِ ناشناخته → کپسولِ
//    تیرهٔ 'rgba(15, 23, 42, 0.85)'.
// چرا resolvePillFill به‌جای خواندنِ مستقیمِ pillBackground؟ چون
// آیتم‌های قدیمی، مقدارِ تیرهٔ 'rgba(13, 18, 24, 0.75)' را ذخیره
// کرده‌اند و اگر رندر همان را مصرف می‌کرد، متنِ تیرهٔ قدیمی
// همچنان نامرئی می‌ماند. پس:
//  • pillBackground === null/false/'' → بدونِ کپسول (خاموشِ صریح).
//  • رشتهٔ سفارشی (غیر از 'auto' و مقادیرِ تیرهٔ قدیمی) → همان
//    رنگ، بدونِ تغییر (انتخابِ صریحِ کاربر از update-selected،
//    محترم می‌ماند).
//  • 'auto' یا مقادیرِ تیرهٔ قدیمی (۰٫۷۲/۰٫۷۵) → مشتقِ پویا از
//    رنگِ قلم. متن‌های جدید با 'auto' ذخیره می‌شوند، پس مقدارِ
//    ذخیره‌شده، دیگر «رنگ» نیست، بلکه «روشن بودنِ کپسول» است.
// آستانهٔ ۰٫۵، نقطهٔ میانیِ روشناییِ نسبی (Rec. 709) است؛ محاسبه
// با خطی‌سازیِ sRGB انجام می‌شود، نه میانگینِ خامِ RGB، تا
// رنگ‌هایی مثلِ زرد (روشنِ واقعی) و سرمه‌ای (تیرهٔ واقعی) درست
// طبقه‌بندی شوند.
// ============================================================================
const LEGACY_DARK_PILL_FILLS = [
  'rgba(13, 18, 24, 0.75)',
  'rgba(13,18,24,0.75)',
  'rgba(13, 18, 24, 0.72)',
  'rgba(13,18,24,0.72)',
];

export function getColorLuminance(color) {
  if (typeof color !== 'string') return null;
  const c = color.trim().toLowerCase();
  let r = null;
  let g = null;
  let b = null;
  let m = /^#([0-9a-f]{3})$/.exec(c);
  if (m) {
    r = parseInt(m[1][0] + m[1][0], 16);
    g = parseInt(m[1][1] + m[1][1], 16);
    b = parseInt(m[1][2] + m[1][2], 16);
  } else if ((m = /^#([0-9a-f]{6})$/.exec(c))) {
    r = parseInt(m[1].slice(0, 2), 16);
    g = parseInt(m[1].slice(2, 4), 16);
    b = parseInt(m[1].slice(4, 6), 16);
  } else if ((m = /^rgba?\(\s*([0-9.]+)(%?)\s*,\s*([0-9.]+)(%?)\s*,\s*([0-9.]+)(%?)/.exec(c))) {
    const conv = (v, pct) => (pct ? (Number(v) * 255) / 100 : Number(v));
    r = conv(m[1], m[2]);
    g = conv(m[3], m[4]);
    b = conv(m[5], m[6]);
  } else {
    return null;
  }
  if (![r, g, b].every((v) => Number.isFinite(v) && v >= 0 && v <= 255)) return null;
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function getPillStyleForColor(textColor) {
  const lum = getColorLuminance(textColor || '#22d3ee');
  // مرحلهٔ ۳۷ §۴(ج): کپسول همیشه ماتِ خالص است؛ شفافیت فقط یک بار از
  // opacityی آیتم می‌آید (در لایه و در خروجی یکسان).
  if (lum !== null && lum < 0.5) {
    return { background: 'rgb(248, 250, 252)', border: 'rgb(15, 23, 42)' };
  }
  return { background: 'rgb(15, 23, 42)', border: null };
}

export function resolvePillFill(item) {
  if (!item) return null;
  const pb = item.pillBackground;
  if (pb === null || pb === false || pb === '') return null;
  if (typeof pb === 'string' && pb.trim() !== '' && pb.trim() !== 'auto'
    && !LEGACY_DARK_PILL_FILLS.includes(pb.trim())) {
    return { background: toPureRgbCss(pb) || pb, border: null };
  }
  return getPillStyleForColor(item.color);
}

export function getTextBounds(item) {
  if (!item) return { x: 0, y: 0, width: 0, height: 0 };
  const fontSize = Math.max(14, Math.min(76, Number(item.fontSize) || 22));
  const fontFamily = item.fontFamily || "'Estedad', sans-serif";
  const rawText = String(item.text || '');
  const lines = rawText.split(/\r?\n/);
  let maxW = 0;
  try {
    const cv = getTextMeasureCanvas();
    const ctx = cv.getContext('2d');
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    // Refinement Phase 1 Step 2: جهتِ بومِ اندازه‌گیری از تشخیصِ
    // خودکار می‌آید، نه از 'rtl'ی ثابت. عرضِ اندازه‌گیری عملاً به
    // جهت وابسته نیست، ولی برای متنِ لاتین، شکل‌دهیِ صحیح با جهتِ
    // درست انجام می‌شود.
    ctx.direction = detectTextDirection(rawText);
    ctx.textBaseline = 'alphabetic';
    for (const ln of lines) {
      const m = ctx.measureText(ln || ' ');
      if (m.width > maxW) maxW = m.width;
    }
  } catch (_) {
    const maxChars = Math.max(1, ...lines.map((l) => l.length));
    maxW = maxChars * fontSize * 0.58;
  }
  const lineHeight = fontSize * 1.3;
  const x = Number(item.x ?? item.startX ?? 0);
  const y = Number(item.y ?? item.startY ?? 0);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: maxW,
    height: lines.length * lineHeight,
  };
}

/**
 * آیا پاک‌کن با متن برخورد می‌کند؟
 * @param {Array} eraserPts - آرایه نقاط پاک‌کن [{x, y}, ...]
 * @param {Object} textItem - آیتمِ متن (فضای یکنواخت، مثل لایه)
 * @param {number} radius - شعاع پاک‌کن (پیش‌فرض ۱۴)
 * @returns {boolean}
 * هر نقطهٔ پاک‌کن که داخلِ کرانهٔ متنِ گسترش‌یافته با `radius` باشد،
 * برخورد محسوب می‌شود (همان قراردادِ eraserHitsBox/eraserHitsArrow).
 */
export function eraserHitsText(eraserPts, textItem, radius = 14) {
  if (!eraserPts || eraserPts.length === 0 || !textItem) return false;
  const b = getTextBounds(textItem);
  const minX = b.x - radius;
  const maxX = b.x + b.width + radius;
  const minY = b.y - radius;
  const maxY = b.y + b.height + radius;
  for (const pt of eraserPts) {
    if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
      return true;
    }
  }
  return false;
}

/**
 * آیا پاک‌کن با کارتِ استیکی برخورد می‌کند؟
 * @param {Array} eraserPts - آرایه نقاط پاک‌کن [{x, y}, ...]
 * @param {Object} stickyItem - آیتمِ استیکی (فضای یکنواخت، مثل لایه)
 * @param {number} radius - شعاع پاک‌کن (پیش‌فرض ۱۴)
 * @returns {boolean}
 * کرانهٔ استیکی: مستطیلِ (x, y, width, height) با ابعادِ پیش‌فرضِ
 * عرض ۲۱۰ و ارتفاع ۱۷۰. برخورد = داخلِ کارت، یا فاصله تا هر یک از
 * ۴ ضلع تا `radius` (مثل eraserHitsBox).
 */
export function eraserHitsSticky(eraserPts, stickyItem, radius = 14, opts) {
  if (!eraserPts || eraserPts.length === 0 || !stickyItem) return false;
  const bx = Number(stickyItem.x ?? stickyItem.startX ?? 0);
  const by = Number(stickyItem.y ?? stickyItem.startY ?? 0);
  // مرحلهٔ ۵۰ §۳: پاک‌کن هم روی کارتِ مقیاس‌یافته می‌نشیند،
  // نه روی مستطیلِ خام — وگرنه فضای خالیِ کنارِ استیکیِ
  // کوچک‌شده هم پاک می‌شد. بدونِ opts، مقیاس ۱ است.
  const sScale = resolveStickyScale(stickyItem, opts);
  const bw = (Number(stickyItem.width) || 210) * sScale;
  const bh = (Number(stickyItem.height) || 170) * sScale;
  if (!Number.isFinite(bx) || !Number.isFinite(by)) return false;
  const edges = [
    [bx, by, bx + bw, by],
    [bx + bw, by, bx + bw, by + bh],
    [bx + bw, by + bh, bx, by + bh],
    [bx, by + bh, bx, by],
  ];
  for (const pt of eraserPts) {
    const px = pt.x, py = pt.y;
    // داخلِ کارت
    if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) return true;
    // نزدیکِ یکی از ۴ ضلع (با حاشیهٔ radius)
    for (const [ax, ay, cx, cy] of edges) {
      if (distToSegment(px, py, ax, ay, cx, cy) <= radius) return true;
    }
  }
  return false;
}

// ============================================================================
// ابزارهای کمکی
// ============================================================================

/** فشرده‌سازی نقاط نزدیک به‌هم (کاهش نویز، افزایش سرعت) */
// ============================================================================
// فاز ۵: موتور انتخاب، مارکی و جابه‌جایی
// نکتهٔ معماری: getItemBounds به‌جای بازنویسیِ فرمول‌ها، به توابعِ
// موجودِ همین انجین تفویض می‌کند (استروک → getStrokeBounds، متن →
// getTextBoundsی فاز ۴ با لنگرِ بالا-چپ و فونتِ bold) تا کرانهٔ
// انتخاب با رندرِ واقعی یکی بماند. فرمولِ قدیمیِ متن (baseline +
// pad + وزنِ ۸۰۰) و فرمولِ قدیمیِ باکس (startX/endX) عمداً
// برگردانده نشدند، چون با دادهٔ فعلی نمی‌خوانند (به گزارشِ اسکنِ
// فاز ۵، §۳ مراجعه کنید).
// مرحلهٔ ۵۰ §۳: کرانهٔ دیداریِ واقعی در getVisualRenderedBBox است
// (استیکیِ مقیاس‌یافته، ابرِ مماس، کپسولِ متن) و getItemBounds فقط
// به آن تفویض می‌کند؛ opts مقیاسِ استیکی را می‌رساند.
// ============================================================================

// ============================================================================
// مرحلهٔ ۵۰ §۳: مقیاسِ استیکی و کرانهٔ دیداریِ واقعی
// تصمیمِ معماری (گزینهٔ ب): فرمولِ مقیاسِ استیکی (تطبیقِ زوم ×
// customScale) از لایه به انجین منتقل شد تا تک‌منبع باشد؛ لایه فقط
// یک پوششِ نازک دارد: stickyScaleFor = (it) =>
// computeStickyScale(it, { zoomLevel, zoomAdaptiveAnnotations }).
// انجین خالص می‌ماند (بدونِ React) و همهٔ مصرف‌کننده‌ها (کادرِ
// انتخاب، هیت‌تست، مارکی، کمند، پاک‌کنِ استیکی) از یک فرمول
// می‌خوانند. ورودیِ zoomLevel/zoomAdaptiveAnnotations از لایه
// می‌آید؛ opts.stickyScaleFor هم برای فراخوان‌های داخلِ لایه که
// تابعِ آماده دارند، پشتیبانی می‌شود.
// ============================================================================

/** مقیاسِ رندرِ استیکی: تطبیقِ زوم × مقیاسِ دستی (دقیقاً فرمولِ لایه). */
export function computeStickyScale(item, opts = {}) {
  const manual = Number(item?.customScale) || 1;
  const z = Number(opts?.zoomLevel) || 1;
  const adaptive = opts?.zoomAdaptiveAnnotations === true;
  const adaptiveZoomScale = (!adaptive || z <= 1) ? 1 : Math.max(0.28, 1 / Math.pow(z, 0.82));
  return adaptiveZoomScale * manual;
}

/**
 * مقیاسِ استیکی برای یک آیتم از روی opts؛ بدونِ opts یا بدونِ
 * مقیاسِ معتبر، ۱ برمی‌گردد تا فراخوان‌های قدیمی بی‌تغییر بمانند.
 */
export function resolveStickyScale(item, opts) {
  if (!opts) return 1;
  if (typeof opts.stickyScaleFor === 'function') {
    const s = Number(opts.stickyScaleFor(item));
    return Number.isFinite(s) && s > 0 ? s : 1;
  }
  if (Number.isFinite(Number(opts.stickyScale)) && Number(opts.stickyScale) > 0) {
    return Number(opts.stickyScale);
  }
  if (opts.zoomLevel !== undefined || opts.zoomAdaptiveAnnotations !== undefined) {
    return computeStickyScale(item, opts);
  }
  return 1;
}

/**
 * برآمدگیِ دیداریِ باکسِ ابری در هر سمت (مرحلهٔ ۵۰ §۳).
 * قلهٔ واقعیِ بزیهٔ درجهٔ ۲، نصفِ فاصلهٔ نقطهٔ کنترل (bulge/2)
 * بیرون از ضلع است، به‌علاوهٔ نیمِ ضخامتِ استروک که روی مسیر
 * وسط‌چین است. هندسه دقیقاً همانِ generateCloudPath و
 * drawCloudPathCanvas است (computeAdaptiveCloudGeometry با همان
 * گامِ پایهٔ arcRadius × 1.55).
 */
export function getCloudVisualExpansion(item) {
  const sw = Number(item?.strokeWidth) || 4;
  const arcRadius = Math.min(26, Math.max(13, sw * 3.5));
  const g = computeAdaptiveCloudGeometry(
    Math.abs(Number(item?.width) || 0),
    Math.abs(Number(item?.height) || 0),
    arcRadius * 1.55
  );
  return { x: g.bulgeX / 2 + sw / 2, y: g.bulgeY / 2 + sw / 2 };
}

/**
 * کرانهٔ دیداریِ واقعیِ یک آیتم در فضای یکنواخت (مرحلهٔ ۵۰ §۳).
 * همان قراردادِ getItemBoundsی مرحلهٔ ۴۹، با سه اصلاحِ دیداری:
 *  - استیکی: عرض/ارتفاعِ خام × مقیاسِ رندر (stickyScaleForی لایه)؛
 *  - باکسِ ابری: برآمدگیِ دقیقِ کمان‌ها (قلهٔ بزیه + نیمِ استروک)؛
 *  - متنِ کپسولی: کادرِ Pill به‌علاوهٔ نیمِ ضخامتِ حاشیه (وقتی دارد).
 * مقیاسِ استیکی از opts می‌آید ({ stickyScaleFor | stickyScale |
 * zoomLevel, zoomAdaptiveAnnotations })؛ بدونِ opts، مقیاس ۱ است و
 * رفتار دقیقاً مثلِ مرحلهٔ ۴۹ می‌ماند. مقیاسِ پایهٔ Stage
 * (scaleX/scaleYی لایه) اینجا ضرب نمی‌شود، چون کادرهای انتخاب
 * داخلِ Groupِ مقیاس‌دارِ لایه رندر می‌شوند و Konva همان مقیاس را
 * یک بار اعمال می‌کند؛ ضربِ دوباره، کادر را دو برابر می‌کرد.
 * @param {Object} item
 * @param {Object} [opts]
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function getVisualRenderedBBox(item, opts) {
  if (!item) return { x: 0, y: 0, width: 0, height: 0 };

  // قلم و هایلایتر: تفویض مستقیم به getStrokeBounds.
  if (item.tool === 'pen' || item.tool === 'highlighter') {
    const b = getStrokeBounds(item);
    return b || { x: 0, y: 0, width: 0, height: 0 };
  }

  // متن: اگر Pill فعال باشد (pillBackground رشته‌ای و غیرِ خالی)،
  // کرانه، کادرِ کپسول است تا کادرِ فوکوس و مارکی، خودِ Pill را هم
  // بگیرند، نه فقط حروف را؛ در غیرِ این صورت، کرانهٔ خالصِ متن
  // (لنگرِ بالا-چپِ فاز ۴). توجه: getTextPillBounds، فیلدهای اضافه
  // (cornerRadius/padX/padY) هم دارد که اینجا دور ریخته می‌شوند تا
  // شکلِ خروجیِ getItemBounds مثلِ قبل، فقط x/y/width/height باشد.
  // Refinement Phase 1 Step 2.
  if (item.tool === 'text') {
    if (typeof item.pillBackground === 'string' && item.pillBackground) {
      const pb = getTextPillBounds(item);
      // مرحلهٔ ۵۰ §۳: لبهٔ بیرونیِ واقعیِ کپسول — وقتی کپسول
      // حاشیه دارد (strokeWidthی ۱ در رندرِ CommittedText)، نیمِ
      // ضخامتِ حاشیه بیرون از کادرِ Pill است؛ بدونِ حاشیه، همان
      // کادرِ Pill. resolvePillFill همان منطقِ رندر است.
      const pillFill = resolvePillFill(item);
      const edge = pillFill && pillFill.border ? 0.5 : 0;
      return {
        x: pb.x - edge,
        y: pb.y - edge,
        width: pb.width + edge * 2,
        height: pb.height + edge * 2,
      };
    }
    return getTextBounds(item);
  }

  // استیکی: مستطیلِ مستقیم، در مقیاسِ رندرشده (مرحلهٔ ۵۰ §۳).
  // CommittedSticky کلِ کارت را با contentScale = stickyScaleFor
  // (تطبیقِ زوم × customScale) مقیاس می‌کند، پس کرانهٔ دیداری،
  // عرض/ارتفاعِ خام × همان مقیاس است؛ لنگر (x/y) با مقیاس جابه‌جا
  // نمی‌شود، چون Groupِ استیکی روی (x, y) نشسته است. خواندنِ
  // x ?? startX مثلِ رندر است (نسخهٔ قبلی فقط x را می‌خواند).
  if (item.tool === 'sticky') {
    const s = resolveStickyScale(item, opts);
    return {
      x: item.x ?? item.startX ?? 0,
      y: item.y ?? item.startY ?? 0,
      width: (Number(item.width) || 210) * s,
      height: (Number(item.height) || 170) * s,
    };
  }

  // باکس: x/y/width/heightی فعلی (نه startX/endXی قدیمی).
  if (item.tool === 'box') {
    const bx = item.x ?? 0;
    const by = item.y ?? 0;
    const bw = item.width || 0;
    const bh = item.height || 0;
    if (item.boxStyle === 'cloud') {
      // مرحلهٔ ۵۰ §۳: برآمدگیِ دقیقِ کمان‌ها — قلهٔ واقعیِ بزیهٔ
      // درجهٔ ۲، نصفِ فاصلهٔ نقطهٔ کنترل (bulge/2) بیرون از ضلع
      // است، به‌علاوهٔ نیمِ ضخامتِ استروک؛ getCloudBulbِ کامل،
      // کادر را در هر سمت چند واحد بزرگ‌تر نشان می‌داد (برای
      // strokeWidth=4، حدودِ ۳٫۳ واحد). هندسه دقیقاً همانِ
      // generateCloudPath و drawCloudPathCanvas است.
      const ex = getCloudVisualExpansion(item);
      return {
        x: bx - ex.x,
        y: by - ex.y,
        width: bw + ex.x * 2,
        height: bh + ex.y * 2,
      };
    }
    return { x: bx, y: by, width: bw, height: bh };
  }

  // فلشِ ماژولار (Refinement Step 2): دربرگیرندهٔ شروع، پایان،
  // نقطهٔ کنترل (در صورتِ منحنی بودن)، گسترهٔ دایرهٔ مبدأ در سمتِ
  // شروع و انتهای دو بازوی تیک در سمتِ پایان، به‌علاوهٔ حاشیهٔ امنِ
  // pad. برای آیتمِ قدیمیِ بدونِ فیلد، hasStartDot=false و
  // hasEndArrow=true فرض می‌شود (مثلِ resolveArrowGeometry)، پس
  // کرانهٔ فلش‌های قدیمی فقط به اندازهٔ تیکِ باز گسترش می‌یابد.
  if (item.tool === 'arrow') {
    const sx = Number(item.startX);
    const sy = Number(item.startY);
    const ex = Number(item.endX);
    const ey = Number(item.endY);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
        !Number.isFinite(ex) || !Number.isFinite(ey)) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    const sw = Number(item.strokeWidth) || 4;
    const pad = Math.max(14, sw * 2.5);
    const g = resolveArrowGeometry(item);
    if (!g) {
      // تباه‌شده (شروع = پایان): فقط دایرهٔ مبدأ — اگر داشت — کرانه دارد.
      const r = item.hasStartDot === true ? getOriginDotRadius(sw) : 0;
      return {
        x: sx - r - pad,
        y: sy - r - pad,
        width: (r + pad) * 2,
        height: (r + pad) * 2,
      };
    }
    let minX = Math.min(sx, ex);
    let minY = Math.min(sy, ey);
    let maxX = Math.max(sx, ex);
    let maxY = Math.max(sy, ey);
    if (g.isCurved && Number.isFinite(item.cx) && Number.isFinite(item.cy)) {
      minX = Math.min(minX, item.cx);
      minY = Math.min(minY, item.cy);
      maxX = Math.max(maxX, item.cx);
      maxY = Math.max(maxY, item.cy);
    }
    if (g.hasStartDot) {
      minX = Math.min(minX, sx - g.dotRadius);
      minY = Math.min(minY, sy - g.dotRadius);
      maxX = Math.max(maxX, sx + g.dotRadius);
      maxY = Math.max(maxY, sy + g.dotRadius);
    }
    if (g.hasEndArrow && g.chevron) {
      const { left, right } = g.chevron;
      minX = Math.min(minX, left.x, right.x);
      minY = Math.min(minY, left.y, right.y);
      maxX = Math.max(maxX, left.x, right.x);
      maxY = Math.max(maxY, left.y, right.y);
    }
    return {
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    };
  }

  // ابزارِ ناشناخته: اگر points داشت، مثلِ استروک؛ وگرنه مثلِ باکس.
  if (Array.isArray(item.points) && item.points.length > 0) {
    const b = getStrokeBounds(item);
    return b || { x: 0, y: 0, width: 0, height: 0 };
  }
  return {
    x: item.x ?? 0,
    y: item.y ?? 0,
    width: item.width || 0,
    height: item.height || 0,
  };
}

/**
 * کرانهٔ سراسری یک آیتم در فضای یکنواخت (سازگاریِ رو به عقب).
 * مرحلهٔ ۵۰ §۳: دقیقاً همان getVisualRenderedBBox است — کرانهٔ
 * دیداریِ واقعیِ رندرشده. فراخوان‌های قدیمی بدونِ opts، همان
 * رفتارِ مرحلهٔ ۴۹ را می‌بینند (مقیاسِ استیکیِ پیش‌فرض ۱).
 * @param {Object} item
 * @param {Object} [opts] - { stickyScaleFor | stickyScale | zoomLevel, zoomAdaptiveAnnotations }
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function getItemBounds(item, opts) {
  return getVisualRenderedBBox(item, opts);
}

/** هم‌پوشانیِ دو مستطیل (لمسِ لبه، تقاطع حساب نمی‌شود). */
export function rectsIntersect(r1, r2) {
  if (!r1 || !r2) return false;
  return (
    r1.x < r2.x + r2.width &&
    r1.x + r1.width > r2.x &&
    r1.y < r2.y + r2.height &&
    r1.y + r1.height > r2.y
  );
}

/**
 * آیا نقطه داخلِ مستطیل است (با حاشیهٔ اختیاری) — برای بررسیِ
 * «کلیک داخلِ کادرِ اجتماعِ انتخاب» در لایه (مرحلهٔ ۴۹).
 */
export function isPointInRect(pt, rect, margin = 0) {
  if (!pt || !rect) return false;
  const m = Number(margin) || 0;
  return (
    pt.x >= rect.x - m &&
    pt.x <= rect.x + rect.width + m &&
    pt.y >= rect.y - m &&
    pt.y <= rect.y + rect.height + m
  );
}

/** مستطیلِ نرمالایز شدهٔ مارکی از دو نقطه (با پشتیبانی از درگِ معکوس). */
export function marqueeRect(p1, p2) {
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.abs(p2.x - p1.x),
    height: Math.abs(p2.y - p1.y),
  };
}

/** مستطیلِ احاطه‌کنندهٔ مجموعهٔ آیتم‌ها با استفاده از getItemBounds. */
export function getUnionBounds(items, opts) {
  if (!Array.isArray(items) || items.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const b = getItemBounds(it, opts);
    if (!b) continue;
    if (b.x < minX) minX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.x + b.width > maxX) maxX = b.x + b.width;
    if (b.y + b.height > maxY) maxY = b.y + b.height;
  }
  if (!Number.isFinite(minX)) return null;
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  };
}

/**
 * هیت‌تستِ نقطه‌ای برای یک آیتم (برای انتخاب با کلیک).
 * @param {Object} item
 * @param {{x: number, y: number}} pt - نقطه در فضای یکنواخت
 * @param {number} tolerance - تلرانسِ پیش‌فرض ۱۴
 */
export function hitTestAnnotationItem(item, pt, tolerance = 14, opts) {
  if (!item || !pt) return false;
  // مرحلهٔ ۴۹ — تلرانسِ تنگِ فلش: کفِ ۳۰ پیکسلیِ قبلی خیلی چاق بود و
  // کلیکِ روی فضای خالیِ کنارِ فلش (تا ۳۰ واحد دورتر) هم فلش را
  // انتخاب می‌کرد؛ وقتی دو آیتم نزدیکِ هم بودند، آیتمِ اشتباه
  // انتخاب می‌شد. قانونِ تازه (arrowHitTolerance):
  // Math.max(8, strokeWidth * 0.65) — برای فلشِ ۴ واحدی، ۸ واحد؛
  // برای فلشِ ضخیم‌تر، متناسب با ضخامت. اگر toleranceی ورودی از این
  // مقدار کوچک‌تر بود، همان مقدارِ کوچک‌تر برنده است. این تلرانسِ
  // تنگ، هم در ردِ سریعِ کرانه و هم در بدنه و بازوها اعمال می‌شود.
  // (بدنهٔ منحنی از قبل با distanceToQuadraticBezier — نمونه‌برداریِ
  // ۱۶ نقطه‌ای از بزیهٔ درجهٔ دو — محاسبه می‌شد.)
  const arrowTol = item.tool === 'arrow'
    ? arrowHitTolerance(item, tolerance)
    : tolerance;
  const b = getItemBounds(item, opts);
  // ردِ سریعِ اولیه با کرانه + تلرانس.
  if (pt.x < b.x - arrowTol || pt.x > b.x + b.width + arrowTol ||
      pt.y < b.y - arrowTol || pt.y > b.y + b.height + arrowTol) {
    return false;
  }

  // استروک: فاصله تا نزدیک‌ترین سگمنت (hitTestStroke خودش ردِ
  // سریعِ کرانه و تلرانسِ ضخامت را هم دارد).
  if (item.tool === 'pen' || item.tool === 'highlighter') {
    return hitTestStroke(item, pt, tolerance);
  }

  // فلشِ ماژولار: فاصله تا بدنه (مسیرِ کامل، بخشنده) + دایرهٔ
  // مبدأ + دو بازوی تیکِ باز. دیگر چندضلعیِ توپر بررسی نمی‌شود.
  if (item.tool === 'arrow') {
    const sx = Number(item.startX);
    const sy = Number(item.startY);
    const ex = Number(item.endX);
    const ey = Number(item.endY);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
        !Number.isFinite(ex) || !Number.isFinite(ey)) {
      return false;
    }
    const sw = Number(item.strokeWidth) || 4;
    // مرحلهٔ ۴۹: تلرانسِ بدنه دقیقاً همان arrowTolی تنگ است — دیگر
    // با sw * 2.5 باد نمی‌کند (برای فلشِ ۴ واحدی، همان ۸ واحد).
    const tol = arrowTol;
    const g = resolveArrowGeometry(item);
    if (!g) {
      // تباه‌شده: فقط دایرهٔ مبدأ — اگر داشت — قابلِ انتخاب است.
      if (item.hasStartDot === true) {
        const r = getOriginDotRadius(sw);
        return Math.hypot(pt.x - sx, pt.y - sy) <= r + tol;
      }
      return false;
    }
    const isCurved = g.isCurved;
    let d;
    if (isCurved) {
      d = distanceToQuadraticBezier(pt, { x: sx, y: sy }, { x: item.cx, y: item.cy }, { x: ex, y: ey });
    } else {
      d = distToSegment(pt.x, pt.y, sx, sy, ex, ey);
    }
    if (d <= tol) return true;
    if (g.hasStartDot && Math.hypot(pt.x - sx, pt.y - sy) <= g.dotRadius + tol) {
      return true;
    }
    if (g.hasEndArrow && g.chevron) {
      const { tip, left, right } = g.chevron;
      if (distToSegment(pt.x, pt.y, tip.x, tip.y, left.x, left.y) <= arrowTol) return true;
      if (distToSegment(pt.x, pt.y, tip.x, tip.y, right.x, right.y) <= arrowTol) return true;
    }
    return false;
  }

  // باکس، متن و استیکی (و ابزارهای ناشناخته): قرارگیریِ نقطه
  // درونِ کرانه با تلرانس. توجه: برای باکس، داخلِ کادر هم انتخاب
  // حساب می‌شود (نه فقط لبه) — طبقِ مشخصاتِ TASK و الگوی قدیمی
  // که برای باکس/متن/استیکی، کلِ مساحتِ محاطی انتخاب‌پذیر بود.
  return (
    pt.x >= b.x - tolerance &&
    pt.x <= b.x + b.width + tolerance &&
    pt.y >= b.y - tolerance &&
    pt.y <= b.y + b.height + tolerance
  );
}

/**
 * تلرانسِ هیت‌تستِ فلش (مرحلهٔ ۴۹): قانونِ تنگِ
 * Math.max(8, strokeWidth * 0.65) که با toleranceی ورودی هم
 * سقف می‌خورد — یعنی هرگز از tolerance بزرگ‌تر نمی‌شود.
 */
export function arrowHitTolerance(item, tolerance = 14) {
  const sw = Number(item && item.strokeWidth) || 4;
  const tight = Math.max(8, sw * 0.65);
  const t = Number(tolerance);
  return Number.isFinite(t) ? Math.min(t, tight) : tight;
}

/**
 * فاصلهٔ هندسیِ نقطه تا آیتم (مرحلهٔ ۴۹ — برای انتخابِ دقیقِ
 * نزدیک‌ترین آیتم وقتی چند آیتم هم‌پوشانی دارند).
 * قلم/هایلایتر: فاصله تا نزدیک‌ترین سگمنتِ خطِ مرکزی؛ فلش: کمترینِ
 * فاصله تا بدنه (خط/بزیه)، دایرهٔ مبدأ و دو بازوی تیک؛ باکس/متن/
 * استیکی: فاصله تا لبهٔ کرانه (داخلِ کرانه = ۰). اگر آیتم هندسهٔ
 * قابلِ سنجش نداشت، Infinity برمی‌گردد.
 */
export function hitDistanceAnnotationItem(item, pt, opts) {
  if (!item || !pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return Infinity;
  if (item.tool === 'pen' || item.tool === 'highlighter') {
    if (!Array.isArray(item.points) || item.points.length === 0) return Infinity;
    if (item.points.length === 1) {
      return Math.hypot(pt.x - item.points[0].x, pt.y - item.points[0].y);
    }
    let best = Infinity;
    for (let i = 0; i < item.points.length - 1; i++) {
      const a = item.points[i];
      const c = item.points[i + 1];
      const d = distToSegment(pt.x, pt.y, a.x, a.y, c.x, c.y);
      if (d < best) best = d;
    }
    return best;
  }
  if (item.tool === 'arrow') {
    const sx = Number(item.startX);
    const sy = Number(item.startY);
    const ex = Number(item.endX);
    const ey = Number(item.endY);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
        !Number.isFinite(ex) || !Number.isFinite(ey)) return Infinity;
    const g = resolveArrowGeometry(item);
    if (!g) {
      if (item.hasStartDot === true) {
        const r = getOriginDotRadius(Number(item.strokeWidth) || 4);
        return Math.max(0, Math.hypot(pt.x - sx, pt.y - sy) - r);
      }
      return Infinity;
    }
    let best = Infinity;
    if (g.isCurved) {
      best = Math.min(best, distanceToQuadraticBezier(
        pt, { x: sx, y: sy }, { x: item.cx, y: item.cy }, { x: ex, y: ey }));
    } else {
      best = Math.min(best, distToSegment(pt.x, pt.y, sx, sy, ex, ey));
    }
    if (g.hasStartDot) {
      best = Math.min(best, Math.max(0, Math.hypot(pt.x - sx, pt.y - sy) - g.dotRadius));
    }
    if (g.hasEndArrow && g.chevron) {
      const { tip, left, right } = g.chevron;
      best = Math.min(best, distToSegment(pt.x, pt.y, tip.x, tip.y, left.x, left.y));
      best = Math.min(best, distToSegment(pt.x, pt.y, tip.x, tip.y, right.x, right.y));
    }
    return best;
  }
  if (Array.isArray(item.points) && item.points.length > 0) {
    return hitDistanceAnnotationItem({ ...item, tool: 'pen' }, pt);
  }
  const b = getItemBounds(item, opts);
  if (!b) return Infinity;
  const dx = Math.max(b.x - pt.x, 0, pt.x - (b.x + b.width));
  const dy = Math.max(b.y - pt.y, 0, pt.y - (b.y + b.height));
  return Math.hypot(dx, dy);
}

/**
 * همهٔ آیتم‌های برخوردی در نقطهٔ کلیک، مرتب‌شده با نزدیک‌ترین
 * فاصلهٔ هندسی اول (مرحلهٔ ۴۹). در تساویِ فاصله، آیتمی که دیرتر
 * رندر شده (بالاتر) اول می‌آید. خروجی: [{ item, distance, index }].
 */
export function findHitsAtPointSorted(items, pt, tolerance = 14, opts) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it) continue;
    if (!hitTestAnnotationItem(it, pt, tolerance, opts)) continue;
    const d = hitDistanceAnnotationItem(it, pt, opts);
    if (!Number.isFinite(d)) continue;
    out.push({ item: it, distance: d, index: i });
  }
  out.sort((a, b) => (a.distance !== b.distance
    ? a.distance - b.distance
    : b.index - a.index));
  return out;
}

/**
 * دقیق‌ترین آیتم در نقطهٔ کلیک (مرحلهٔ ۴۹): از نظرِ هندسی
 * نزدیک‌ترین آیتم به اشاره‌گر برنده است، نه آیتمی که در آرایه
 * جلوتر/عقب‌تر است. در تساویِ فاصله، بالاترین آیتم برنده است.
 */
export function findBestHitAnnotationItem(items, pt, tolerance = 14, opts) {
  const hits = findHitsAtPointSorted(items, pt, tolerance, opts);
  return hits.length > 0 ? hits[0].item : null;
}

/**
 * چرخهٔ کلیک روی آیتم‌های هم‌پوشان (مرحلهٔ ۴۹): آیتمِ بعدیِ بعد از
 * currentId در ترتیبِ فاصله‌ای را برمی‌گرداند و در انتها به اول
 * برمی‌گردد. اگر currentId داده نشد یا در لیستِ برخورد نبود،
 * نزدیک‌ترین آیتم برمی‌گردد؛ اگر هیچ برخوردی نبود، null.
 */
export function cycleHitAtPoint(items, pt, currentId, tolerance = 14, opts) {
  const hits = findHitsAtPointSorted(items, pt, tolerance, opts);
  if (hits.length === 0) return null;
  if (currentId == null) return hits[0].item;
  const idx = hits.findIndex((h) => h.item && h.item.id === currentId);
  if (idx < 0) return hits[0].item;
  return hits[(idx + 1) % hits.length].item;
}

/**
 * بالاترین آیتم در نقطهٔ کلیک — مرحلهٔ ۴۹: دیگر پیمایشِ معکوسِ
 * صرف نیست؛ به findBestHitAnnotationItem تفویض می‌شود تا
 * نزدیک‌ترین آیتم (با تساوی‌شکنِ بالاترین) انتخاب شود.
 */
export function findTopAnnotationAtPoint(items, pt, tolerance = 14, opts) {
  return findBestHitAnnotationItem(items, pt, tolerance, opts);
}

/**
 * جابه‌جاییِ برداریِ یک آیتم با دلتا (در فضای یکنواخت).
 * امضا دقیقاً طبقِ TASKِ مرحلهٔ ۲ است: (item, dx, dy) — بدونِ
 * آرگومانِ جداگانهٔ original (برخلافِ نسخهٔ قدیمی که (item,
 * original, dx, dy) بود). آیتمِ ورودی تغییر نمی‌کند؛ یک کپیِ
 * جدید برمی‌گردد.
 */
export function moveAnnotationByDelta(item, dx, dy) {
  if (!item) return item;
  const ddx = Number(dx) || 0;
  const ddy = Number(dy) || 0;
  // مرحله ۴۸ §۵: یک عبورِ واحد روی همهٔ میدان‌های قابلِ جابه‌جایی —
  // نسخهٔ قبلی با returnِ زودهنگامِ شاخهٔ points، برای آیتمی که هم
  // points داشت و هم startX/endX (مثلاً فلشِ دارای points)، مختصاتِ
  // فلش را جا می‌انداخت و رندر (که startX/endX را می‌خواند) اصلاً
  // تکان نمی‌خورد؛ و برای آیتمِ دارای x/y هم‌زمان با points، فقط
  // points را می‌برد. حالا هر میدان دقیقاً یک بار جابه‌جا می‌شود و
  // میدانی که آیتم از اول نداشته، ساخته نمی‌شود (تا شکلِ دادهٔ
  // ذخیره‌شده عوض نشود).
  const next = { ...item };
  // استروک (قلم/هایلایتر): نگاشتِ نقاط (با گردکردنِ ۱ رقمِ اعشار،
  // مثلِ قبل، تا خطای ممیزِ شناور انباشته نشود).
  if (Array.isArray(next.points) && next.points.length > 0) {
    next.points = next.points.map((p) => ({
      x: Number((p.x + ddx).toFixed(1)),
      y: Number((p.y + ddy).toFixed(1)),
    }));
  }
  // فلش: شروع، پایان و (در صورتِ وجود) نقطهٔ کنترل.
  if (item.tool === 'arrow') {
    next.startX = (item.startX ?? 0) + ddx;
    next.startY = (item.startY ?? 0) + ddy;
    next.endX = (item.endX ?? 0) + ddx;
    next.endY = (item.endY ?? 0) + ddy;
    if (Number.isFinite(item.cx)) next.cx = item.cx + ddx;
    if (Number.isFinite(item.cy)) next.cy = item.cy + ddy;
    return next;
  }
  // متن: جابه‌جاییِ همزمانِ هر دو جفتِ مختصات (اصلاحِ دوگانهٔ
  // فاز ۵ — اگر فقط یکی جابه‌جا شود، رندر (x ?? startX) و کرانه
  // در کامیتِ بعدی از هم جدا می‌شوند).
  if (item.tool === 'text') {
    next.x = (item.x ?? 0) + ddx;
    next.y = (item.y ?? 0) + ddy;
    next.startX = (item.startX ?? item.x ?? 0) + ddx;
    next.startY = (item.startY ?? item.y ?? 0) + ddy;
    return next;
  }
  // باکس و استیکی (و بقیهٔ آیتم‌های دارای x/y): جابه‌جاییِ x و y —
  // فقط اگر از قبل عدد بودند (تا روی قلم، x/yِ تازه ساخته نشود)؛
  // و startX/startYی قدیمی، اگر بود، هم‌جهت با x/y می‌رود.
  if (typeof item.x === 'number') next.x = item.x + ddx;
  if (typeof item.y === 'number') next.y = item.y + ddy;
  if (Number.isFinite(item.startX)) next.startX = item.startX + ddx;
  if (Number.isFinite(item.startY)) next.startY = item.startY + ddy;
  return next;
}

// ============================================================================
// مرحله ۴۸ §۵ — helperهای خالصِ انتخاب (بدونِ وابستگی به React/Konva،
// تا در Node با انجینِ واقعی تست شوند؛ لایه از همین‌ها استفاده می‌کند).
// ============================================================================

/** حداقلِ فاصلهٔ نقطه‌های کمند در فضای یکنواخت (گاردریل ۶) — در زومِ
 * ۱۰۰٪ تقریباً ۳ پیکسل؛ در مرحله ۴۴، مقدارِ ۲ به‌صورتِ عددِ جادویی
 * در handleMove آمده بود. */
export const LASSO_MIN_POINT_DIST = 3;

/** فیلترِ نقطه‌های کمند: نقطهٔ اول همیشه می‌ماند؛ نقطه‌های بعدی
 * فقط اگر حداقل minDist واحد با آخرین نقطهٔ نگه‌داشته‌شده فاصله
 * داشته باشند اضافه می‌شوند (گاردریل ۶ — نقطه‌های نزدیک‌تر از ۳
 * واحد هرگز به چندضلعی نمی‌روند). آبجکتِ نقطه‌ها دست نخورده
 * برمی‌گردد (فقط فیلتر، بدونِ کپیِ میدان‌ها). */
export function filterLassoPoints(points, minDist = LASSO_MIN_POINT_DIST) {
  if (!Array.isArray(points) || points.length === 0) return [];
  const min = Number(minDist) > 0 ? Number(minDist) : 3;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const pt = points[i];
    const last = out[out.length - 1];
    if (!pt || !last) continue;
    if (Math.hypot(pt.x - last.x, pt.y - last.y) >= min) out.push(pt);
  }
  return out;
}

/** فیلترِ idهای انتخابِ کهنه: فقط idهایی که هنوز در آیتم‌های صفحهٔ
 * جاری هستند می‌مانند (گاردریل ۵ — روی تغییرِ صفحه یا حذفِ آیتم،
 * idهای جا مانده فوراً بیرون می‌روند). ترتیبِ ورودی حفظ می‌شود. */
export function filterStaleSelectedIds(ids, items) {
  if (!Array.isArray(ids) || ids.length === 0) return [];
  if (!Array.isArray(items)) return [];
  const alive = new Set(items.filter(Boolean).map((it) => it.id));
  return ids.filter((id) => alive.has(id));
}

/** جابه‌جاییِ گروهی: دقیقاً یک دلتا به‌ازای هر آیتمِ انتخاب‌شده
 * (گاردریل ۴) — هر دو مسیرِ جابه‌جاییِ گروهیِ لایه (پایانِ درگِ
 * نودی و جابه‌جاییِ دستی) از همین‌جا می‌گذرند یا معادلِ آن را
 * روی snapshotِ شروعِ ژست انجام می‌دهند. */
export function moveSelectedItems(items, ids, dx, dy) {
  if (!Array.isArray(items)) return items;
  if (!Array.isArray(ids) || ids.length === 0) return items;
  const wanted = new Set(ids);
  return items.map((it) => (it && wanted.has(it.id) ? moveAnnotationByDelta(it, dx, dy) : it));
}

/** تصمیمِ راست‌کلیک در حالتِ select (مرحله ۴۸ §۵، مکانیزمِ دوگانه):
 * - 'finish-draw': مارکی/کمند در جریان است → مسیر بسته و انتخاب
 *   ثبت می‌شود و قفلِ انتخاب فعال می‌شود (بدونِ deselect).
 * - 'finish-move-deselect': جابه‌جاییِ دستی در جریان است → ژست
 *   نهایی و انتخاب پاک می‌شود.
 * - 'finish-handle-deselect': درگِ هندلِ فلش در جریان است → هندل
 *   نهایی و انتخاب پاک می‌شود.
 * - 'deselect': ژستی در جریان نیست ولی انتخابی هست → فقط پاک شدنِ انتخاب.
 * - 'suppress-only': نه ژست، نه انتخاب → فقط جلوی منوی سراسری گرفته می‌شود. */
export function decideRightClickAction({ hasMarquee = false, hasLasso = false, hasManualMove = false, hasArrowHandleEdit = false, selectedCount = 0 } = {}) {
  if (hasMarquee || hasLasso) return 'finish-draw';
  if (hasManualMove) return 'finish-move-deselect';
  if (hasArrowHandleEdit) return 'finish-handle-deselect';
  if (Number(selectedCount) > 0) return 'deselect';
  return 'suppress-only';
}

/** هندسهٔ هادِ شناورِ اکشنِ انتخاب (مرحله ۴۸ §۵): کپسول، دقیقاً
 * بالای کادرِ اجتماعِ انتخاب (مرکزِ افقیِ کادر)، با چرخش به پایینِ
 * کادر اگر بالای آن جا نباشد؛ و clamp در لبه‌های صفحه. ورودیِ
 * bounds در فضای یکنواخت و stageSize شاملِ w/hی پیکسلی و
 * scaleX/scaleY است (همان تبدیلِ TextEditorOverlay). */
export function computeSelectionHudGeometry(bounds, stageSize) {
  if (!bounds || !stageSize) return null;
  const w = Number(stageSize.w) || 0;
  const h = Number(stageSize.h) || 0;
  const sx = Number(stageSize.scaleX) || 0;
  const sy = Number(stageSize.scaleY) || 0;
  if (!(w > 0 && h > 0 && sx > 0 && sy > 0)) return null;
  const HUD_W = 348;
  const HUD_H = 44;
  const GAP = 8;
  const leftPx = Number(bounds.x) * sx;
  const topPx = Number(bounds.y) * sy;
  const widthPx = Number(bounds.width) * sx;
  const heightPx = Number(bounds.height) * sy;
  if (![leftPx, topPx, widthPx, heightPx].every(Number.isFinite)) return null;
  const centerX = leftPx + widthPx / 2;
  const left = Math.max(8, Math.min(centerX - HUD_W / 2, Math.max(8, w - HUD_W - 8)));
  const aboveTop = topPx - GAP - HUD_H;
  const placeAbove = aboveTop >= 8;
  let top = placeAbove ? aboveTop : topPx + heightPx + GAP;
  top = Math.max(8, Math.min(top, Math.max(8, h - HUD_H - 8)));
  return { left: Math.round(left), top: Math.round(top), width: HUD_W, height: HUD_H, placeAbove, centerX: Math.round(centerX) };
}

/** شناسه یکتا */
export function uid(prefix = 'stroke') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
