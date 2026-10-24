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
  const bulb = getCloudBulb(strokeW);

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
  const bulb = getCloudBulb(strokeW);

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
  const sw = Number(strokeW) || 4;
  return Math.min(38, Math.max(16, 14 + sw * 2.5));
}

/**
 * هندسه نوک پیکان بال‌دار مقعر (Swept-back Barbed Chevron Arrowhead).
 * @param {number} tipX - مختصات X رأس نوک (نقطه پایان فلش)
 * @param {number} tipY - مختصات Y رأس نوک
 * @param {number} angle - زاویه مماس (θ) در انتها، بر حسب رادیان
 * @param {number} strokeWidth - ضخامت خط (تأثیر در اندازه نوک)
 * @returns {{headSize: number, tip: {x:number,y:number}, left: {x:number,y:number}, notch: {x:number,y:number}, right: {x:number,y:number}, points: Array<{x:number,y:number}>, headPoints: string}}
 * چندضلعی به ترتیب [tip, leftWing, notch, rightWing] است؛ نقطه فرورفته
 * (notch) روی محور فلش و ۰٫۷۲ × headSize عقب‌تر از نوک قرار دارد، پس
 * چندضلعی مقعر است، نه یک مثلث محدب ساده.
 */
export function getArrowHeadGeometry(tipX, tipY, angle, strokeWidth = 4) {
  const headSize = getArrowHeadSize(strokeWidth);
  const alpha = Math.PI / 6.4; // ≈ ۲۸٫۱ درجه پخش هر بال
  const tip = { x: tipX, y: tipY };
  const left = {
    x: tipX - Math.cos(angle - alpha) * headSize,
    y: tipY - Math.sin(angle - alpha) * headSize,
  };
  const right = {
    x: tipX - Math.cos(angle + alpha) * headSize,
    y: tipY - Math.sin(angle + alpha) * headSize,
  };
  const notch = {
    x: tipX - Math.cos(angle) * (headSize * 0.72),
    y: tipY - Math.sin(angle) * (headSize * 0.72),
  };
  const points = [tip, left, notch, right];
  return {
    headSize,
    tip,
    left,
    notch,
    right,
    points,
    headPoints: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
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
      // فاز ۳-مرحله ۳ (سناریو ۲): مماسِ منحنی تباه‌شده یا نویزی
      // → برگشت به راستای مستقیم (وترِ شروع تا پایان)، با همان
      // ساختار خروجی. آستانهٔ قبلی (1e-6) بردارهای بسیار کوچک ولی
      // غیرصفر را هم مماسِ معتبر می‌دانست و زاویهٔ نوک را خراب می‌کرد.
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
  const head = getArrowHeadGeometry(ex, ey, angle, sw);
  const cutback = head.headSize * 0.62;
  const cutX = ex - Math.cos(angle) * cutback;
  const cutY = ey - Math.sin(angle) * cutback;
  // فاز ۳-مرحله ۳ (سناریو ۱): پرتاب معکوسِ برش
  const chordLength = Math.hypot(ex - sx, ey - sy);
  const shaftVisible = chordLength > cutback;
  return { isCurved, angle, head, cutX, cutY, cutback, chordLength, shaftVisible, sx, sy, ex, ey, sw };
}

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
export function drawArrowCanvas(ctx, item) {
  const g = resolveArrowGeometry(item);
  if (!g || !ctx) return;
  const color = item.color || '#22d3ee';
  const sw = g.sw;

  ctx.save();
  // گذر اول: بدنه — فقط وقتی طولِ فلش از برش بیشتر است.
  // فاز ۳-مرحله ۳ (سناریو ۱): اگر L ≤ ۰٫۶۲ × headSize، بدنه اصلاً
  // رسم نمی‌شود و فقط نوک پیکان کشیده می‌شود؛ در غیر این صورت
  // نقطهٔ برش از نقطه شروع عقب‌تر می‌افتاد و خطی معکوس و زشت
  // در خلاف جهت پرتاب فلش رسم می‌شد (مثلاً فلشِ ۱۵ پیکسلی با
  // ضخامت ۱۱، قبل از اصلاح، بدنه‌اش تا x=۹۱٫۴۴ برمی‌گشت در حالی
  // که شروعش x=۱۰۰ بود).
  if (g.shaftVisible) {
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = sw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (g.isCurved) {
      ctx.moveTo(g.sx, g.sy);
      ctx.quadraticCurveTo(Number(item.cx), Number(item.cy), g.cutX, g.cutY);
    } else {
      ctx.moveTo(g.sx, g.sy);
      ctx.lineTo(g.cutX, g.cutY);
    }
    ctx.stroke();
  }

  // گذر دوم: نوک پیکان مقعر
  const { tip, left, notch, right } = g.head;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(notch.x, notch.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  // stroke ملایم هم‌رنگ برای لبه‌های نرم و گرد (بدون تغییر رنگ ظاهری)
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, sw * 0.5);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/** آیا نقطه داخل چندضلعی است؟ (روش پرتوافکنی) */
function pointInPolygon(px, py, points) {
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
export function eraserHitsArrow(eraserPts, arrowItem, radius = 14) {
  if (!eraserPts || eraserPts.length === 0 || !arrowItem) return false;
  const g = resolveArrowGeometry(arrowItem);
  if (!g) return false;
  const sx = g.sx, sy = g.sy, ex = g.ex, ey = g.ey;
  const isCurved = g.isCurved;
  const cx = Number(arrowItem.cx);
  const cy = Number(arrowItem.cy);
  const margin = radius + g.head.headSize;
  const minX = Math.min(sx, ex, isCurved ? cx : Infinity) - margin;
  const maxX = Math.max(sx, ex, isCurved ? cx : -Infinity) + margin;
  const minY = Math.min(sy, ey, isCurved ? cy : Infinity) - margin;
  const maxY = Math.max(sy, ey, isCurved ? cy : -Infinity) + margin;
  const headPts = g.head.points;
  const headEdges = [
    [headPts[0], headPts[1]],
    [headPts[1], headPts[2]],
    [headPts[2], headPts[3]],
    [headPts[3], headPts[0]],
  ];

  for (const pt of eraserPts) {
    const px = pt.x, py = pt.y;
    if (px < minX || px > maxX || py < minY || py > maxY) continue;
    // فاصله تا بدنه
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
    // داخل چندضلعی نوک؟
    if (pointInPolygon(px, py, headPts)) return true;
    // فاصله تا اضلاع چندضلعی نوک
    for (const [a, b] of headEdges) {
      if (distToSegment(px, py, a.x, a.y, b.x, b.y) <= radius) return true;
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
    ctx.direction = 'rtl';
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
export function eraserHitsSticky(eraserPts, stickyItem, radius = 14) {
  if (!eraserPts || eraserPts.length === 0 || !stickyItem) return false;
  const bx = Number(stickyItem.x ?? stickyItem.startX ?? 0);
  const by = Number(stickyItem.y ?? stickyItem.startY ?? 0);
  const bw = Number(stickyItem.width) || 210;
  const bh = Number(stickyItem.height) || 170;
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
// ============================================================================

/**
 * کرانهٔ سراسری یک آیتم در فضای یکنواخت.
 * @param {Object} item
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function getItemBounds(item) {
  if (!item) return { x: 0, y: 0, width: 0, height: 0 };

  // قلم و هایلایتر: تفویض مستقیم به getStrokeBounds.
  if (item.tool === 'pen' || item.tool === 'highlighter') {
    const b = getStrokeBounds(item);
    return b || { x: 0, y: 0, width: 0, height: 0 };
  }

  // متن: تفویض مستقیم به getTextBounds (لنگرِ بالا-چپِ فاز ۴).
  if (item.tool === 'text') {
    return getTextBounds(item);
  }

  // استیکی: مستطیلِ مستقیم.
  if (item.tool === 'sticky') {
    return {
      x: item.x ?? 0,
      y: item.y ?? 0,
      width: item.width || 210,
      height: item.height || 170,
    };
  }

  // باکس: x/y/width/heightی فعلی (نه startX/endXی قدیمی).
  if (item.tool === 'box') {
    const bx = item.x ?? 0;
    const by = item.y ?? 0;
    const bw = item.width || 0;
    const bh = item.height || 0;
    if (item.boxStyle === 'cloud') {
      const bulb = getCloudBulb(item.strokeWidth || 4);
      return {
        x: bx - bulb,
        y: by - bulb,
        width: bw + bulb * 2,
        height: bh + bulb * 2,
      };
    }
    return { x: bx, y: by, width: bw, height: bh };
  }

  // فلش: دربرگیرندهٔ شروع، پایان و (در صورتِ منحنی بودن) نقطهٔ
  // کنترل، به‌علاوهٔ حاشیهٔ امنِ pad. نوکِ فلش در جهتِ جلو، از
  // نقطهٔ پایان جلوتر نمی‌رود و پهنای جانبیِ آن (headSize ×
  // sin(28.1°) ≈ حداکثر ۱۸) از pad (حداقل ۱۴ در ضخامتِ ۴، و ۲۷٫۵
  // در ضخامتِ ۱۱) بزرگ‌تر نیست، پس همین pad برای نوک هم کافی است.
  if (item.tool === 'arrow') {
    const sx = Number(item.startX);
    const sy = Number(item.startY);
    const ex = Number(item.endX);
    const ey = Number(item.endY);
    if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
        !Number.isFinite(ex) || !Number.isFinite(ey)) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }
    let minX = Math.min(sx, ex);
    let minY = Math.min(sy, ey);
    let maxX = Math.max(sx, ex);
    let maxY = Math.max(sy, ey);
    if (item.arrowStyle === 'curved' &&
        Number.isFinite(item.cx) && Number.isFinite(item.cy)) {
      minX = Math.min(minX, item.cx);
      minY = Math.min(minY, item.cy);
      maxX = Math.max(maxX, item.cx);
      maxY = Math.max(maxY, item.cy);
    }
    const pad = Math.max(14, (item.strokeWidth || 4) * 2.5);
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
export function getUnionBounds(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const it of items) {
    const b = getItemBounds(it);
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
export function hitTestAnnotationItem(item, pt, tolerance = 14) {
  if (!item || !pt) return false;
  const b = getItemBounds(item);
  // ردِ سریعِ اولیه با کرانه + تلرانس.
  if (pt.x < b.x - tolerance || pt.x > b.x + b.width + tolerance ||
      pt.y < b.y - tolerance || pt.y > b.y + b.height + tolerance) {
    return false;
  }

  // استروک: فاصله تا نزدیک‌ترین سگمنت (hitTestStroke خودش ردِ
  // سریعِ کرانه و تلرانسِ ضخامت را هم دارد).
  if (item.tool === 'pen' || item.tool === 'highlighter') {
    return hitTestStroke(item, pt, tolerance);
  }

  // فلش: فاصله تا بدنه (پاره‌خط یا بزیه) + چندضلعیِ نوک.
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
    const tol = Math.max(tolerance, sw * 2.5);
    const isCurved = item.arrowStyle === 'curved' &&
      Number.isFinite(item.cx) && Number.isFinite(item.cy);
    let d;
    if (isCurved) {
      d = distanceToQuadraticBezier(pt, { x: sx, y: sy }, { x: item.cx, y: item.cy }, { x: ex, y: ey });
    } else {
      d = distToSegment(pt.x, pt.y, sx, sy, ex, ey);
    }
    if (d <= tol) return true;
    // چندضلعیِ نوک: زاویه با همان منطقِ resolveArrowGeometry
    // (برگشت به وتر وقتی مماسِ منحنی تباه‌شده است: مربعِ فاصله < ۰٫۰۱).
    let angle;
    if (isCurved) {
      const txc = ex - Number(item.cx);
      const tyc = ey - Number(item.cy);
      if (txc * txc + tyc * tyc < 0.01) {
        angle = Math.atan2(ey - sy, ex - sx);
      } else {
        angle = Math.atan2(tyc, txc);
      }
    } else {
      angle = Math.atan2(ey - sy, ex - sx);
    }
    const head = getArrowHeadGeometry(ex, ey, angle, sw);
    const poly = head.points;
    // تابعِ pointInPolygon(px, py, points) از قبل در همین انجین
    // وجود داشت (برای پاک‌کنِ فلش) و دوباره تعریف نشد تا خطای
    // اعلانِ تکراری ندهد؛ همان تابع با همان امضا استفاده می‌شود.
    if (pointInPolygon(pt.x, pt.y, poly)) return true;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const c = poly[(i + 1) % poly.length];
      if (distToSegment(pt.x, pt.y, a.x, a.y, c.x, c.y) <= tolerance) return true;
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

/** بالاترین آیتم در نقطهٔ کلیک (پیمایشِ معکوس = آخرینِ رندرشده اول). */
export function findTopAnnotationAtPoint(items, pt, tolerance = 14) {
  if (!Array.isArray(items) || items.length === 0) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitTestAnnotationItem(items[i], pt, tolerance)) {
      return items[i];
    }
  }
  return null;
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

  // استروک: نگاشتِ نقاط (با گردکردنِ ۱ رقمِ اعشار، مثلِ قدیمی،
  // تا خطای اعشارِ ممیزِ شناور انباشته نشود).
  if (Array.isArray(item.points) && item.points.length > 0) {
    return {
      ...item,
      points: item.points.map((p) => ({
        x: Number((p.x + ddx).toFixed(1)),
        y: Number((p.y + ddy).toFixed(1)),
      })),
    };
  }

  // متن: جابه‌جاییِ همزمانِ هر دو جفتِ مختصات (اصلاحِ دوگانهٔ
  // فاز ۵ — اگر فقط یکی جابه‌جا شود، رندر (x ?? startX) و کرانه
  // در کامیتِ بعدی از هم جدا می‌شوند).
  if (item.tool === 'text') {
    return {
      ...item,
      x: (item.x ?? 0) + ddx,
      y: (item.y ?? 0) + ddy,
      startX: (item.startX ?? item.x ?? 0) + ddx,
      startY: (item.startY ?? item.y ?? 0) + ddy,
    };
  }

  // فلش: شروع، پایان و (در صورتِ وجود) نقطهٔ کنترل.
  if (item.tool === 'arrow') {
    const next = {
      ...item,
      startX: (item.startX ?? 0) + ddx,
      startY: (item.startY ?? 0) + ddy,
      endX: (item.endX ?? 0) + ddx,
      endY: (item.endY ?? 0) + ddy,
    };
    if (Number.isFinite(item.cx)) next.cx = item.cx + ddx;
    if (Number.isFinite(item.cy)) next.cy = item.cy + ddy;
    return next;
  }

  // باکس و استیکی (و بقیهٔ آیتم‌های دارای x/y): جابه‌جاییِ x و y.
  return {
    ...item,
    x: (item.x ?? 0) + ddx,
    y: (item.y ?? 0) + ddy,
  };
}

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
