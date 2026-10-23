// ============================================================================
// annotationEngine.js — بازسازی تمیز فاز ۳ + ارتقای فاز ۱
// فقط: قلم دیجیتال + هایلایت (perfect-freehand واقعی)
// فاز ۱: تبدیل مختصات برای تمام ابزارها (باکس، فلش، متن، استیکی) ایمن شد
// ============================================================================

import { getStroke } from 'perfect-freehand';

// --- مختصات: فضای ذخیره‌سازی 1000×1000، فضای یکنواخت 1000×(1000*aspect) ---
export const VIEWBOX_SIZE = 1000;

/** تبدیل مختصات کلاینت (موس) به نقطه SVG در فضای یکنواخت */
export function clientToSvgPoint(clientX, clientY, rect, aspect = 1) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  const a = Number(aspect) > 0 ? Number(aspect) : 1;
  const viewH = VIEWBOX_SIZE * a;
  const rawX = ((clientX - rect.left) / rect.width) * VIEWBOX_SIZE;
  const rawY = ((clientY - rect.top) / rect.height) * viewH;
  return {
    x: Number(Math.max(0, Math.min(VIEWBOX_SIZE, rawX)).toFixed(1)),
    y: Number(Math.max(0, Math.min(viewH, rawY)).toFixed(1)),
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
export function generateCloudPath(x1, y1, x2, y2, strokeW = 4) {
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(24, Math.abs(x2 - x1));
  const h = Math.max(24, Math.abs(y2 - y1));

  const arcRadius = Math.min(26, Math.max(13, strokeW * 3.5));
  const nx = Math.max(2, Math.round(w / (arcRadius * 1.55)));
  const ny = Math.max(2, Math.round(h / (arcRadius * 1.55)));
  const stepX = w / nx;
  const stepY = h / ny;
  const bulb = arcRadius * 0.76;

  let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`;

  // ضلع بالا (چپ به راست)
  for (let i = 0; i < nx; i++) {
    const sx = x + i * stepX;
    const ex = x + (i + 1) * stepX;
    const mx = (sx + ex) / 2;
    const my = y - bulb;
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${y.toFixed(1)}`;
  }

  // ضلع راست (بالا به پایین)
  for (let i = 0; i < ny; i++) {
    const sy = y + i * stepY;
    const ey = y + (i + 1) * stepY;
    const mx = x + w + bulb;
    const my = (sy + ey) / 2;
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${(x + w).toFixed(1)} ${ey.toFixed(1)}`;
  }

  // ضلع پایین (راست به چپ)
  for (let i = 0; i < nx; i++) {
    const sx = x + w - i * stepX;
    const ex = x + w - (i + 1) * stepX;
    const mx = (sx + ex) / 2;
    const my = y + h + bulb;
    d += ` Q ${mx.toFixed(1)} ${my.toFixed(1)} ${ex.toFixed(1)} ${(y + h).toFixed(1)}`;
  }

  // ضلع چپ (پایین به بالا)
  for (let i = 0; i < ny; i++) {
    const sy = y + h - i * stepY;
    const ey = y + h - (i + 1) * stepY;
    const mx = x - bulb;
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
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.max(24, Math.abs(x2 - x1));
  const h = Math.max(24, Math.abs(y2 - y1));

  const arcRadius = Math.min(26, Math.max(13, strokeW * 3.5));
  const nx = Math.max(2, Math.round(w / (arcRadius * 1.55)));
  const ny = Math.max(2, Math.round(h / (arcRadius * 1.55)));
  const stepX = w / nx;
  const stepY = h / ny;
  const bulb = arcRadius * 0.76;

  ctx.beginPath();
  ctx.moveTo(x, y);

  for (let i = 0; i < nx; i++) {
    const sx = x + i * stepX;
    const ex = x + (i + 1) * stepX;
    ctx.quadraticCurveTo((sx + ex) / 2, y - bulb, ex, y);
  }
  for (let i = 0; i < ny; i++) {
    const sy = y + i * stepY;
    const ey = y + (i + 1) * stepY;
    ctx.quadraticCurveTo(x + w + bulb, (sy + ey) / 2, x + w, ey);
  }
  for (let i = 0; i < nx; i++) {
    const sx = x + w - i * stepX;
    const ex = x + w - (i + 1) * stepX;
    ctx.quadraticCurveTo((sx + ex) / 2, y + h + bulb, ex, y + h);
  }
  for (let i = 0; i < ny; i++) {
    const sy = y + h - i * stepY;
    const ey = y + h - (i + 1) * stepY;
    ctx.quadraticCurveTo(x - bulb, (sy + ey) / 2, x, ey);
  }
  ctx.closePath();
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
    // بررسی داخل باکس (با حاشیه شعاع)
    if (px >= bx - radius && px <= bx + bw + radius &&
        py >= by - radius && py <= by + bh + radius) {
      // داخل یا نزدیک باکس — بررسی دقیق‌تر با اضلاع
      for (const [ax, ay, cx, cy] of edges) {
        if (distToSeg(px, py, ax, ay, cx, cy) <= radius) return true;
      }
      // اگر نقطه داخل باکس است (نه فقط نزدیک لبه)، هم برخورد محسوب می‌شود
      if (px >= bx && px <= bx + bw && py >= by && py <= by + bh) return true;
    }
  }
  return false;
}

// ============================================================================
// ابزارهای کمکی
// ============================================================================

/** فشرده‌سازی نقاط نزدیک به‌هم (کاهش نویز، افزایش سرعت) */
export function simplifyPoints(points, minDist = 1.2) {
  if (!points || points.length < 3) return points || [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) >= minDist) {
      out.push(cur);
    }
  }
  // آخرین نقطه همیشه حفظ شود
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

/** شناسه یکتا */
export function uid(prefix = 'stroke') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}
