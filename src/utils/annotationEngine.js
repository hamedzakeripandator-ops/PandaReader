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

/** آیا نقطه داخل چندضلعی است؟ (روش پرتوافکنی)
 * توجه (Refinement Step 2): برای سرِ فلش دیگر استفاده نمی‌شود
 * (تیکِ باز چندضلعی نیست)؛ برای سازگاری نگه داشته شده است. */
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
  if (lum !== null && lum < 0.5) {
    return { background: 'rgba(248, 250, 252, 0.9)', border: 'rgba(15, 23, 42, 0.35)' };
  }
  return { background: 'rgba(15, 23, 42, 0.85)', border: null };
}

export function resolvePillFill(item) {
  if (!item) return null;
  const pb = item.pillBackground;
  if (pb === null || pb === false || pb === '') return null;
  if (typeof pb === 'string' && pb.trim() !== '' && pb.trim() !== 'auto'
    && !LEGACY_DARK_PILL_FILLS.includes(pb.trim())) {
    return { background: pb, border: null };
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
      return { x: pb.x, y: pb.y, width: pb.width, height: pb.height };
    }
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
    const tol = Math.max(tolerance, sw * 2.5);
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
      if (distToSegment(pt.x, pt.y, tip.x, tip.y, left.x, left.y) <= tolerance) return true;
      if (distToSegment(pt.x, pt.y, tip.x, tip.y, right.x, right.y) <= tolerance) return true;
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
