import { getStroke } from 'perfect-freehand';

// موتور ریاضی و هندسی استودیو ویرایش و حاشیه‌نویسی (Normalized 1000x1000 Coordinate Space)

export const VIEWBOX_SIZE = 1000;

export const PRESET_ANNOTATION_COLORS = [
  { hex: '#facc15', label: 'زرد هایلایت' },
  { hex: '#06b6d4', label: 'فیروزه‌ای نئون' },
  { hex: '#10b981', label: 'سبز زمردی' },
  { hex: '#f43f5e', label: 'قرمز مرجانی' },
  { hex: '#a855f7', label: 'بنفش استودیویی' },
  { hex: '#f97316', label: 'نارنجی گرم' },
];

// ۱. تبدیل مختصات ماوس به فضای برداری یکنواخت [0..1000] × [0..1000*aspect]
// aspect = نسبت ارتفاع به عرض صفحه؛ باعث می‌شود ۱ واحد در هر دو محور
// دقیقاً معادل پیکسل باشد و هیچ اعوجاجی در ابر/پیکان/متن/ضخامت رخ ندهد
export function clientToSvgPoint(clientX, clientY, boundsRect, aspect = 1) {
  if (!boundsRect || boundsRect.width <= 0 || boundsRect.height <= 0) {
    return { x: 0, y: 0 };
  }
  const a = Number(aspect) > 0 ? Number(aspect) : 1;
  const viewH = VIEWBOX_SIZE * a;
  const rawX = ((clientX - boundsRect.left) / boundsRect.width) * VIEWBOX_SIZE;
  const rawY = ((clientY - boundsRect.top) / boundsRect.height) * viewH;
  return {
    x: Number(Math.max(0, Math.min(VIEWBOX_SIZE, rawX)).toFixed(1)),
    y: Number(Math.max(0, Math.min(viewH, rawY)).toFixed(1)),
  };
}

// ۲. تولید مسیر برداری کادر ابری با قفل گوشه‌ها و هلال‌های متقارن رو به بیرون
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
    const cx = (sx + ex) / 2;
    const cy = y - bulb;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)}, ${ex.toFixed(1)} ${y.toFixed(1)}`;
  }

  // ضلع راست (بالا به پایین)
  for (let i = 0; i < ny; i++) {
    const sy = y + i * stepY;
    const ey = y + (i + 1) * stepY;
    const cx = x + w + bulb;
    const cy = (sy + ey) / 2;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)}, ${(x + w).toFixed(1)} ${ey.toFixed(1)}`;
  }

  // ضلع پایین (راست به چپ)
  for (let i = 0; i < nx; i++) {
    const sx = x + w - i * stepX;
    const ex = x + w - (i + 1) * stepX;
    const cx = (sx + ex) / 2;
    const cy = y + h + bulb;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)}, ${ex.toFixed(1)} ${(y + h).toFixed(1)}`;
  }

  // ضلع چپ (پایین به بالا)
  for (let i = 0; i < ny; i++) {
    const sy = y + h - i * stepY;
    const ey = y + h - (i + 1) * stepY;
    const cx = x - bulb;
    const cy = (sy + ey) / 2;
    d += ` Q ${cx.toFixed(1)} ${cy.toFixed(1)}, ${x.toFixed(1)} ${ey.toFixed(1)}`;
  }

  d += ' Z';
  return d;
}

// ۳. تولید هندسی فلش با کوتاه‌سازی خودکار شفت برای جلوگیری از بیرون‌زدگی نوک پیکان
export function generateArrowGeometry(x1, y1, x2, y2, strokeW = 4) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 6) {
    return { shaft: null, headPoints: '' };
  }

  const ux = dx / len;
  const uy = dy / len;
  const headSize = Math.max(16, Math.min(38, 14 + strokeW * 2.5));

  const shaftEndX = x2 - ux * (headSize * 0.62);
  const shaftEndY = y2 - uy * (headSize * 0.62);

  const angle = Math.atan2(dy, dx);
  const spread = Math.PI / 6.4;

  const leftX = x2 - headSize * Math.cos(angle - spread);
  const leftY = y2 - headSize * Math.sin(angle - spread);
  const rightX = x2 - headSize * Math.cos(angle + spread);
  const rightY = y2 - headSize * Math.sin(angle + spread);
  const notchX = x2 - ux * (headSize * 0.72);
  const notchY = y2 - uy * (headSize * 0.72);

  const headPoints = `${x2.toFixed(1)},${y2.toFixed(1)} ${leftX.toFixed(1)},${leftY.toFixed(1)} ${notchX.toFixed(1)},${notchY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)}`;

  return {
    shaft: {
      x1: Number(x1.toFixed(1)),
      y1: Number(y1.toFixed(1)),
      x2: Number(shaftEndX.toFixed(1)),
      y2: Number(shaftEndY.toFixed(1)),
    },
    headPoints,
  };
}

// ۴. تبدیل نقاط دست‌آزاد به منحنی نرم بزیه (Quadratic Spline)
export function pointsToSmoothSvgPath(points) {
  if (!Array.isArray(points) || points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.5} ${p.y + 0.5}`;
  }

  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mx = (points[i].x + points[i + 1].x) / 2;
    const my = (points[i].y + points[i + 1].y) / 2;
    d += ` Q ${points[i].x.toFixed(1)} ${points[i].y.toFixed(1)}, ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = points[points.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

// ۵. محاسبه دقیق کادر محاطی (Bounding Box) برای تطبیق ۱۰۰٪ گیزمو با تمام اشکال
// کانوس singleton برای اندازه‌گیری دقیق متن
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

export function getItemBounds(item) {
  if (!item) return { x: 0, y: 0, width: 0, height: 0 };
  const strokeW = Number(item.strokeWidth) || 4;

  // الف: استیکی‌نوت — دقیقاً مطابق HTML
  if (item.tool === 'sticky') {
    const x = Number(item.x ?? item.startX ?? 100);
    const y = Number(item.y ?? item.startY ?? 100);
    const w = Number(item.width) || 210;
    const h = Number(item.height) || 170;
    return { x, y, width: w, height: h };
  }

  // ب: متن برداری — با پشتیبانی صحیح RTL
  if (item.tool === 'text') {
    const fontSize = Math.max(14, Number(item.fontSize) || 22);
    const rawText = String(item.text || 'متن');
    const lines = rawText.split('\n');
    const fontFamily = item.fontFamily || "'Estedad', 'Vazirmatn', sans-serif";
    let maxW = 0;
    try {
      const cv = getTextMeasureCanvas();
      const ctx = cv.getContext('2d');
      ctx.font = `800 ${fontSize}px ${fontFamily}`;
      for (const ln of lines) {
        const w = ctx.measureText(ln || ' ').width;
        if (w > maxW) maxW = w;
      }
    } catch (_) {
      const maxChars = Math.max(2, ...lines.map((l) => l.length));
      maxW = maxChars * fontSize * 0.58;
    }
    const sx = Number(item.startX ?? item.x ?? 100);
    const sy = Number(item.startY ?? item.y ?? 100);
    // RTL: متن از لبه راست (sx) به سمت چپ گسترش می‌یابد
    // y نقطه baseline است؛ متن بالا و پایین آن قرار می‌گیرد
    // بدون پد — هندل‌ها روی لبه واقعی قرار می‌گیرند
    const textW = Math.max(40, maxW + 16);
    const lineH = fontSize * 1.3;
    const textH = Math.max(fontSize + 8, lines.length * lineH);
    return {
      x: sx - textW,
      y: sy - fontSize * 0.85,
      width: textW,
      height: textH,
    };
  }

  // ج: قلم نرم و ماژیک هایلایت — کرانه از همان کانتور رندر (تضمین تطابق)
  if (Array.isArray(item.points) && item.points.length > 0) {
    if (item.tool === 'pen' || item.tool === 'highlighter') {
      const ob = getBrushBounds(item);
      if (ob) return ob;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    item.points.forEach((p) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    });

    const pad =
      item.tool === 'highlighter'
        ? strokeW * 2.4 + 6
        : strokeW * 0.8 + 6;

    return {
      x: minX - pad,
      y: minY - pad,
      width: Math.max(20, maxX - minX + pad * 2),
      height: Math.max(20, maxY - minY + pad * 2),
    };
  }

  // د: کادرها (ابری، مستطیل، گوشه‌گرد)، عکس و فلش
  const sx = Number(item.startX ?? 0);
  const sy = Number(item.startY ?? 0);
  const ex = Number(item.endX ?? sx + 50);
  const ey = Number(item.endY ?? sy + 50);

  const minX = Math.min(sx, ex);
  const minY = Math.min(sy, ey);
  const w = Math.max(2, Math.abs(ex - sx));
  const h = Math.max(2, Math.abs(ey - sy));

  if (item.tool === 'arrow') {
    const pad = Math.max(14, strokeW * 2.5);
    let ax1 = minX, ay1 = minY, ax2 = minX + w, ay2 = minY + h;
    // نقطه کنترل فلش منحنی هم داخل کادر محاطی می‌آید
    if (item.arrowStyle === 'curved' && Number.isFinite(item.cx) && Number.isFinite(item.cy)) {
      ax1 = Math.min(ax1, item.cx); ay1 = Math.min(ay1, item.cy);
      ax2 = Math.max(ax2, item.cx); ay2 = Math.max(ay2, item.cy);
    }
    return {
      x: ax1 - pad,
      y: ay1 - pad,
      width: Math.max(20, ax2 - ax1 + pad * 2),
      height: Math.max(20, ay2 - ay1 + pad * 2),
    };
  }

  // بیضی و خط ساده (مثل Edge/Xodo)
  if (item.tool === 'ellipse' || item.tool === 'line') {
    const pad = Math.max(12, strokeW * 2);
    return {
      x: minX - pad,
      y: minY - pad,
      width: Math.max(24, w + pad * 2),
      height: Math.max(24, h + pad * 2),
    };
  }

  if (item.tool === 'box' && item.boxStyle === 'cloud') {
    const arcRadius = Math.min(26, Math.max(13, strokeW * 3.5));
    const bulbAllowance = arcRadius * 0.76 + strokeW * 0.6 + 5;
    return {
      x: minX - bulbAllowance,
      y: minY - bulbAllowance,
      width: w + bulbAllowance * 2,
      height: h + bulbAllowance * 2,
    };
  }

  const pad = strokeW * 0.6 + 4;
  return {
    x: minX - pad,
    y: minY - pad,
    width: w + pad * 2,
    height: h + pad * 2,
  };
}

// ۶. فاصله اقلیدسی نقطه تا پاره‌خط جهت Hit-Testing دقیق
export function distanceToSegment(pt, v, w) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return Math.hypot(pt.x - v.x, pt.y - v.y);
  let t = ((pt.x - v.x) * (w.x - v.x) + (pt.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(
    pt.x - (v.x + t * (w.x - v.x)),
    pt.y - (v.y + t * (w.y - v.y))
  );
}

// ۷. تشخیص برخورد نقطه با هر نوع شکل (پشتیبانی از کادرهای توخالی، ابری، خطوط و متون)
export function hitTestAnnotationItem(item, pt, extraTolerance = 14) {
  if (!item || !pt) return false;
  const strokeW = Number(item.strokeWidth) || 4;
  const b = getItemBounds(item);

  // تست اولیه سریع خارج از محدوده
  if (
    pt.x < b.x - extraTolerance ||
    pt.x > b.x + b.width + extraTolerance ||
    pt.y < b.y - extraTolerance ||
    pt.y > b.y + b.height + extraTolerance
  ) {
    return false;
  }

  // در کادرها، تصاویر، متون و استیکی‌نوت‌ها، کل مساحت محاطی انتخاب‌پذیر است
  if (
    item.tool === 'box' ||
    item.tool === 'rect' ||
    item.tool === 'ellipse' ||
    item.tool === 'image' ||
    item.tool === 'text' ||
    item.tool === 'sticky'
  ) {
    return (
      pt.x >= b.x - 4 &&
      pt.x <= b.x + b.width + 4 &&
      pt.y >= b.y - 4 &&
      pt.y <= b.y + b.height + 4
    );
  }

  // فلش اشاره‌گر (صاف یا منحنی)
  if (item.tool === 'arrow') {
    const tol = Math.max(extraTolerance, strokeW * 2.5);
    let d;
    if (item.arrowStyle === 'curved' && Number.isFinite(item.cx) && Number.isFinite(item.cy)) {
      d = distanceToQuadraticBezier(
        pt,
        { x: item.startX, y: item.startY },
        { x: item.cx, y: item.cy },
        { x: item.endX, y: item.endY }
      );
    } else {
      d = distanceToSegment(
        pt,
        { x: item.startX, y: item.startY },
        { x: item.endX, y: item.endY }
      );
    }
    return d <= tol;
  }

  // قلم نرم و ماژیک هایلایت
  if (Array.isArray(item.points) && item.points.length > 0) {
    if (item.points.length === 1) {
      return Math.hypot(pt.x - item.points[0].x, pt.y - item.points[0].y) <= extraTolerance + strokeW * 2;
    }
    const tol =
      item.tool === 'highlighter'
        ? Math.max(extraTolerance, strokeW * 2.6)
        : Math.max(extraTolerance, strokeW * 1.6);

    for (let i = 0; i < item.points.length - 1; i++) {
      if (distanceToSegment(pt, item.points[i], item.points[i + 1]) <= tol) {
        return true;
      }
    }
  }

  return false;
}

// یافتن بالاترین شکل در نقطه کلیک‌شده
export function findTopAnnotationAtPoint(items, pt, tolerance = 14) {
  if (!Array.isArray(items) || items.length === 0) return null;
  for (let i = items.length - 1; i >= 0; i--) {
    if (hitTestAnnotationItem(items[i], pt, tolerance)) {
      return items[i];
    }
  }
  return null;
}

// ۸. جابه‌جایی شکل با حفظ ساختار برداری
export function moveAnnotationByDelta(item, original, dx, dy) {
  const next = { ...item };

  if (original.tool === 'sticky') {
    next.x = Math.round((original.x ?? original.startX ?? 100) + dx);
    next.y = Math.round((original.y ?? original.startY ?? 100) + dy);
    return next;
  }

  if (original.tool === 'text') {
    next.startX = Math.round((original.startX ?? original.x ?? 100) + dx);
    next.startY = Math.round((original.startY ?? original.y ?? 100) + dy);
    return next;
  }

  if (Array.isArray(original.points) && original.points.length > 0) {
    next.points = original.points.map((p) => ({
      x: Number((p.x + dx).toFixed(1)),
      y: Number((p.y + dy).toFixed(1)),
    }));
    return next;
  }

  next.startX = Number((original.startX + dx).toFixed(1));
  next.startY = Number((original.startY + dy).toFixed(1));
  next.endX = Number((original.endX + dx).toFixed(1));
  next.endY = Number((original.endY + dy).toFixed(1));
  if (Number.isFinite(original.cx)) next.cx = Number((original.cx + dx).toFixed(1));
  if (Number.isFinite(original.cy)) next.cy = Number((original.cy + dy).toFixed(1));
  return next;
}

// ۹. تغییر اندازه شکل با ۸ هندل کادر یا ۲ هندل سر و ته فلش
export function resizeAnnotationWithHandle(item, handle, currentPt, orig) {
  const next = { ...item };

  // هندل‌های فلش: سر و ته آزاد + هندل خمیدگی منحنی
  if (orig.tool === 'arrow') {
    if (handle === 'curve') {
      next.cx = Number(currentPt.x.toFixed(1));
      next.cy = Number(currentPt.y.toFixed(1));
      next.arrowStyle = 'curved';
      return next;
    }
    if (handle === 'tail') {
      next.startX = currentPt.x;
      next.startY = currentPt.y;
    } else if (handle === 'head') {
      next.endX = currentPt.x;
      next.endY = currentPt.y;
    }
    return next;
  }

  // تغییر سایز فونت متن برداری با کشیدن هندل‌ها
  if (orig.tool === 'text') {
    const b = getItemBounds(orig);
    const deltaW =
      handle.includes('w') ? b.x + b.width - currentPt.x : currentPt.x - b.x;
    const ratio = Math.max(0.5, Math.min(3.2, deltaW / Math.max(40, b.width)));
    const baseFont = Number(orig.fontSize) || (orig.strokeWidth || 4) * 5 || 22;
    next.fontSize = Math.max(14, Math.min(76, Math.round(baseFont * ratio)));
    return next;
  }

  // تغییر سایز استیکی‌نوت
  if (orig.tool === 'sticky') {
    const ox = orig.x ?? orig.startX ?? 100;
    const oy = orig.y ?? orig.startY ?? 100;
    const ow = orig.width || 210;
    const oh = orig.height || 175;

    if (handle.includes('e')) next.width = Math.max(130, currentPt.x - ox);
    if (handle.includes('s')) next.height = Math.max(110, currentPt.y - oy);
    if (handle.includes('w')) {
      const right = ox + ow;
      next.x = Math.min(right - 130, currentPt.x);
      next.width = right - next.x;
    }
    if (handle.includes('n')) {
      const bottom = oy + oh;
      next.y = Math.min(bottom - 110, currentPt.y);
      next.height = bottom - next.y;
    }
    return next;
  }

  // مقیاس‌بندی نقاط قلم و هایلایت
  if (Array.isArray(orig.points) && orig.points.length > 0) {
    const b = getItemBounds(orig);
    let newLeft = b.x;
    let newTop = b.y;
    let newWidth = b.width;
    let newHeight = b.height;

    if (handle.includes('e')) newWidth = Math.max(24, currentPt.x - b.x);
    if (handle.includes('s')) newHeight = Math.max(24, currentPt.y - b.y);
    if (handle.includes('w')) {
      const right = b.x + b.width;
      newLeft = Math.min(right - 24, currentPt.x);
      newWidth = right - newLeft;
    }
    if (handle.includes('n')) {
      const bottom = b.y + b.height;
      newTop = Math.min(bottom - 24, currentPt.y);
      newHeight = bottom - newTop;
    }

    const scaleX = newWidth / Math.max(1, b.width);
    const scaleY = newHeight / Math.max(1, b.height);

    next.points = orig.points.map((p) => ({
      x: Number((newLeft + (p.x - b.x) * scaleX).toFixed(1)),
      y: Number((newTop + (p.y - b.y) * scaleY).toFixed(1)),
    }));
    return next;
  }

  // کادر ابری، مستطیل، گوشه‌گرد و تصویر
  let minX = Math.min(orig.startX, orig.endX);
  let maxX = Math.max(orig.startX, orig.endX);
  let minY = Math.min(orig.startY, orig.endY);
  let maxY = Math.max(orig.startY, orig.endY);

  if (handle.includes('w')) minX = Math.min(maxX - 20, currentPt.x);
  if (handle.includes('e')) maxX = Math.max(minX + 20, currentPt.x);
  if (handle.includes('n')) minY = Math.min(maxY - 20, currentPt.y);
  if (handle.includes('s')) maxY = Math.max(minY + 20, currentPt.y);

  next.startX = minX;
  next.startY = minY;
  next.endX = maxX;
  next.endY = maxY;
  return next;
}

// ============================================================================
// فاز ۳ — فلش منحنی ۳ نقطه‌ای و قلم perfect-freehand
// ============================================================================

// نقطه روی منحنی بزیه درجه ۲ در پارامتر t
export function quadraticPoint(p0, pc, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * pc.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * pc.y + t * t * p2.y,
  };
}

// بردار مماس منحنی در t (برای جهت‌دهی نوک پیکان)
export function quadraticTangent(p0, pc, p2, t) {
  return {
    x: 2 * (1 - t) * (pc.x - p0.x) + 2 * t * (p2.x - pc.x),
    y: 2 * (1 - t) * (pc.y - p0.y) + 2 * t * (p2.y - pc.y),
  };
}

// فاصله نقطه تا منحنی بزیه (نمونه‌برداری از پاره‌خط‌ها)
export function distanceToQuadraticBezier(pt, p0, pc, p2, samples = 16) {
  let best = Infinity;
  let prev = p0;
  for (let i = 1; i <= samples; i++) {
    const cur = quadraticPoint(p0, pc, p2, i / samples);
    const d = distanceToSegment(pt, prev, cur);
    if (d < best) best = d;
    prev = cur;
  }
  return best;
}

// مسیر shaft منحنی؛ headCutback انتها را برای جا دادن نوک پیکان کوتاه می‌کند
export function curvedShaftPath(x1, y1, cx, cy, x2, y2, headCutback = 0) {
  let ex = x2, ey = y2;
  if (headCutback > 0) {
    const tan = quadraticTangent({ x: x1, y: y1 }, { x: cx, y: cy }, { x: x2, y: y2 }, 1);
    const len = Math.hypot(tan.x, tan.y) || 1;
    ex = x2 - (tan.x / len) * headCutback;
    ey = y2 - (tan.y / len) * headCutback;
  }
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
}

// هندسه کامل فلش منحنی: shaft خمیده + نوک پیکان در جهت مماس انتهایی
export function generateCurvedArrowGeometry(x1, y1, cx, cy, x2, y2, strokeW = 4) {
  const tan = quadraticTangent({ x: x1, y: y1 }, { x: cx, y: cy }, { x: x2, y: y2 }, 1);
  if (Math.hypot(tan.x, tan.y) < 1e-6) {
    return generateArrowGeometry(x1, y1, x2, y2, strokeW); // fallback به فلش صاف
  }
  const headSize = Math.max(16, Math.min(38, 14 + strokeW * 2.5));
  const angle = Math.atan2(tan.y, tan.x);
  const spread = Math.PI / 6.4;
  const leftX = x2 - headSize * Math.cos(angle - spread);
  const leftY = y2 - headSize * Math.sin(angle - spread);
  const rightX = x2 - headSize * Math.cos(angle + spread);
  const rightY = y2 - headSize * Math.sin(angle + spread);
  const notchX = x2 - Math.cos(angle) * (headSize * 0.72);
  const notchY = y2 - Math.sin(angle) * (headSize * 0.72);
  return {
    shaftPath: curvedShaftPath(x1, y1, cx, cy, x2, y2, headSize * 0.62),
    headPoints: `${x2.toFixed(1)},${y2.toFixed(1)} ${leftX.toFixed(1)},${leftY.toFixed(1)} ${notchX.toFixed(1)},${notchY.toFixed(1)} ${rightX.toFixed(1)},${rightY.toFixed(1)}`,
  };
}

// نقطه کنترل پیش‌فرض برای فلش منحنی تازه‌رسم‌شده (انحنای ۱۸٪ طول)
export function defaultCurveControl(x1, y1, x2, y2, bendRatio = 0.18) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: Number(((x1 + x2) / 2 + (-dy / len) * len * bendRatio).toFixed(1)),
    y: Number(((y1 + y2) / 2 + (dx / len) * len * bendRatio).toFixed(1)),
  };
}

// تبدیل نقاط قلم به چندضلعی پهنای متغیر perfect-freehand (خروجی: path آماده SVG)
// با opts می‌توان برای هایلایت (thinning: 0) ظاهر طبیعی ماژیک را ساخت
export function penPointsToOutlinePath(points, strokeWidth = 4, opts = {}) {
  try {
    if (!Array.isArray(points) || points.length < 2) return null;
    const outline = getStroke(
      points.map((p) => [p.x, p.y]),
      {
        size: Math.max(4, strokeWidth * 2.2),
        thinning: 0.55,
        smoothing: 0.6,
        streamline: 0.55,
        simulatePressure: true,
        last: true,
        ...opts,
      }
    );
    if (!outline || outline.length < 3) return null;
    const d = outline.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt[0].toFixed(1)} ${pt[1].toFixed(1)}`).join(' ');
    return { path: d + ' Z', outline };
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[annotation] perfect-freehand fallback:', err?.message);
    return null;
  }
}

// کادر محاطی outline قلم (برای گیزمو ۱۰۰٪ منطبق)
export function getPenOutlineBounds(points, strokeWidth = 4) {
  const res = penPointsToOutlinePath(points, strokeWidth);
  if (!res) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of res.outline) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  const pad = 6;
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(20, maxX - minX + pad * 2),
    height: Math.max(20, maxY - minY + pad * 2),
  };
}

// ============================================================================
// مختصات تطبیقی یکنواخت — تبدیل در مرز لایه (فرمت دیتابیس بدون تغییر می‌ماند)
// ذخیره‌سازی: y در [0..1000] | رندر/تعامل: y در [0..1000*aspect]
// ============================================================================

// مقیاس Y یک آیتم با ضریب دلخواه (کپی جدید برمی‌گرداند، ورودی دست نمی‌خورد)
export function scaleItemYCoords(item, factor) {
  if (!item) return item;
  const f = Number(factor);
  const next = { ...item };
  if (!Number.isFinite(f) || f <= 0) return next;
  const sy = (v) => (Number.isFinite(v) ? Number((v * f).toFixed(2)) : v);
  if (Number.isFinite(next.y)) next.y = sy(next.y);
  if (Number.isFinite(next.height)) next.height = sy(next.height);
  if (Number.isFinite(next.startY)) next.startY = sy(next.startY);
  if (Number.isFinite(next.endY)) next.endY = sy(next.endY);
  if (Number.isFinite(next.cy)) next.cy = sy(next.cy);
  if (Array.isArray(next.points)) {
    next.points = next.points.map((pt) => ({ ...pt, y: sy(pt.y) }));
  }
  return next;
}

// دیتابیس → لایه (رندر و تعامل)
export function storageToUniformItem(item, aspect) {
  const a = Number(aspect) > 0 ? Number(aspect) : 1;
  return scaleItemYCoords(item, a);
}

// لایه → دیتابیس (کامیت)
export function uniformToStorageItem(item, aspect) {
  const a = Number(aspect) > 0 ? Number(aspect) : 1;
  return scaleItemYCoords(item, 1 / a);
}

// ============================================================================
// انتخاب چندتایی و مارکی (Marquee Selection)
// ============================================================================

// آیا دو مستطیل هم‌پوشانی دارند؟
export function rectsIntersect(a, b) {
  if (!a || !b) return false;
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

// کادر اجتماع چند آیتم (برای گیزمو مولتی‌سلکت)
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
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

// ساخت مستطیل مارکی نرمال‌شده از دو نقطه
export function marqueeRect(p1, p2) {
  const x = Math.min(p1.x, p2.x);
  const y = Math.min(p1.y, p2.y);
  return { x, y, width: Math.abs(p2.x - p1.x), height: Math.abs(p2.y - p1.y) };
}

// ============================================================================
// معماری جدید قلم (Brush Engine) — تک‌منبع حقیقت برای رندر و کرانه
// ============================================================================

// پارامترهای دقیق هر ابزار — همین در رندر و همین در محاسبه کرانه استفاده می‌شود
export function getBrushOptions(tool, strokeWidth = 4) {
  const sw = Number(strokeWidth) || 4;
  if (tool === 'highlighter') {
    return {
      size: Math.max(10, sw * 4.4),
      thinning: 0,
      smoothing: 0.7,
      streamline: 0.6,
      simulatePressure: false,
      softEdge: true,
    };
  }
  // pen — قلم دیجیتال خالص: هیچ تیپری، کاملاً نرم و روان
  // thinning=0 (پهنای یکنواخت)، simulatePressure=false (بدون تغییر با سرعت)
  // smoothing/streamline بالا برای نرمی حداکثری
  return {
    size: Math.max(3, sw * 2.2),
    thinning: 0,
    smoothing: 0.9,
    streamline: 0.8,
    simulatePressure: false,
    softEdge: false,
  };
}

// کانتور نهایی یک استروک — تنها تابعی که رندر و کرانه از آن استفاده می‌کنند
export function getBrushOutline(item) {
  if (!item || !Array.isArray(item.points) || item.points.length === 0) return null;
  const opts = getBrushOptions(item.tool, item.strokeWidth);
  return penPointsToOutlinePath(item.points, item.strokeWidth, opts);
}

// کرانه دقیق از روی همان کانتوری که رندر می‌شود (تضمین تطابق با گیزمو)
export function getBrushBounds(item) {
  const res = getBrushOutline(item);
  if (!res || !res.outline || res.outline.length === 0) {
    // فالبک: کرانه از نقاط خام
    const pts = item.points || [];
    if (pts.length === 0) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = 10;
    return { x: minX - pad, y: minY - pad, width: Math.max(20, maxX - minX + pad*2), height: Math.max(20, maxY - minY + pad*2) };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of res.outline) {
    if (pt[0] < minX) minX = pt[0];
    if (pt[0] > maxX) maxX = pt[0];
    if (pt[1] < minY) minY = pt[1];
    if (pt[1] > maxY) maxY = pt[1];
  }
  const pad = 6;
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(20, maxX - minX + pad * 2),
    height: Math.max(20, maxY - minY + pad * 2),
  };
}
