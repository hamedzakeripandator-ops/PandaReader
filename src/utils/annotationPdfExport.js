// ============================================================================
// annotationPdfExport.js — آماده‌سازیِ خروجیِ PDFِ حاشیه‌نویسی‌شده در رندرر
//
// چرا این منطق اینجاست (نه در main)؟ فقط رندرر، سه چیز را با هم دارد:
//  ۱) آیتم‌های ذخیره‌شده (فضای 1000×1000، مبدأ بالا-چپ)،
//  ۲) viewportی pdf.js (ابعاد + ماتریسِ تبدیل + ‎/Rotate صفحه)،
//  ۳) چرخشِ انتخابیِ کاربر (CSS) و موتورِ شکل‌دهیِ متنِ مرورگر.
// پس همهٔ هندسه (تبدیل به نقاطِ PDF + رندرِ PNGِ متن/استیکی/ابری)
// اینجا محاسبه می‌شود و main فقط جایگذاری می‌کند.
//
// قراردادِ مختصات:
//  • ورودی: فضای ذخیره‌سازی — x و همهٔ فیلدهای Y معمولاً در بازهٔ
//    0..1000، ولی آیتمِ بیرونِ صفحه هم مجاز است (افق [-۲۰۰، ۱۲۰۰] و
//    عمود [-۸۰، ۱۰۸۰] در مرحلهٔ ۵۰)؛ مبدأ بالا-چپِ «قابِ دیده‌شده»
//    (بعد از چرخشِ CSS). کسرهای بیرونِ [0,1] هم حفظ می‌شوند.
//  • کسرها (fx,fy در 0..1) مستقل از aspectاند؛ پس تبدیلِ aspect در
//    محاسبهٔ کسر حذف می‌شود (همان دلیلی که toPdfPoint نسخهٔ اول هم
//    مستقیم y/1000 را در ارتفاع ضرب می‌کرد).
//  • خروجیِ برداری: نقاطِ PDF در فضای خامِ صفحه (مبدأ پایین-چپ،
//    بدونِ چرخش) + ضخامت‌ها به پوینت.
//  • خروجیِ تصویری: PNGِ شفافِ کلِ صفحه در «جهتِ خام» (تا main آن را
//    بدونِ هیچ چرخشی با drawImage بنشاند).
// ============================================================================

import {
  resolvePillFill,
  detectTextDirection,
  getColorLuminance,
  drawCloudPathCanvas,
  normalizeOpacityValue,
  forceOpaqueRgba,
  toPureRgbCss,
  getChevronGeometry,
  getOriginDotRadius,
  quadraticPoint,
  resolveArrowGeometry,
} from './annotationEngine';
import { normalizeMixedBidiLine } from './bidiTextEngine';

// --- چرخش در مربعِ واحد (مختصاتِ y-down) ---------------------------------
// rotateUnitSquare نقطه را به اندازهٔ degrees، ساعتگرد می‌چرخاند.
// فقط مضرب‌های ۹۰ پشتیبانی می‌شوند (چرخشِ صفحه همین‌هاست) تا هیچ
// خطای سینوس/کسینوسی وارد نشود.
export function rotateUnitSquare(fx, fy, degrees) {
  const d = ((Math.round(Number(degrees) || 0) % 360) + 360) % 360;
  if (d === 0) return [fx, fy];
  if (d === 90) return [1 - fy, fx];
  if (d === 180) return [1 - fx, 1 - fy];
  return [fy, 1 - fx]; // 270
}

export function normalizeRotation(degrees) {
  const d = ((Math.round(Number(degrees) || 0) % 360) + 360) % 360;
  if (d === 90 || d === 180 || d === 270) return d;
  return 0;
}

// --- ماتریسِ آفاینِ viewport ----------------------------------------------
// viewport.transform در pdf.js، نقاطِ PDF را به پیکسل‌های viewport
// (مبدأ بالا-چپ) می‌برد: [a b c d e f] یعنی
//   x' = a*x + c*y + e
//   y' = b*x + d*y + f
export function invertAffine(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!Number.isFinite(det) || det === 0) return null;
  return [
    d / det,
    -b / det,
    -c / det,
    a / det,
    (c * f - d * e) / det,
    (b * e - a * f) / det,
  ];
}

export function applyAffine(m, x, y) {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

// --- ابزارهای کوچک ---------------------------------------------------------

function finiteNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** hex یا rgb()/rgba() → رشتهٔ rgba با آلفای تازه. */
function colorWithAlpha(color, alpha) {
  if (typeof color !== 'string') return null;
  const c = color.trim().toLowerCase();
  let r;
  let g;
  let b;
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
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

// تمِ استیکی — کپیِ منطقِ CommittedSticky در AnnotationLayer.jsx (همان
// آستانهٔ ۰٫۵ و همان رنگ‌ها) تا کارتِ خروجی، دقیقاً همان کارتِ روی
// صفحه باشد. اگر تمِ استیکی در لایه عوض شد، اینجا هم باید عوض شود.
function getStickyTheme(color) {
  const c = color || '#22d3ee';
  const lum = getColorLuminance(c);
  const isLight = lum !== null && lum >= 0.5;
  const border = toPureRgbCss(colorWithAlpha(c, 0.55)) || (isLight ? 'rgb(15, 23, 42)' : 'rgb(248, 250, 252)');
  if (isLight) {
    return {
      isLight: true,
      bodyBase: 'rgb(248, 250, 252)',
      tint: toPureRgbCss(colorWithAlpha(c, 0.16)) || 'rgb(34, 211, 238)',
      text: '#0f172a',
      border,
      headerFill: toPureRgbCss(c) || c,
    };
  }
  return {
    isLight: false,
    bodyBase: 'rgb(13, 18, 24)',
    tint: toPureRgbCss(colorWithAlpha(c, 0.16)) || 'rgb(34, 211, 238)',
    text: '#f8fafc',
    border,
    headerFill: toPureRgbCss(c) || c,
  };
}

// مسیرِ SVG آیکونِ Pin لوسید (همان ثابتِ AnnotationLayer.jsx).
const LUCIDE_PIN_PATH =
  'M12 17v5 M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4a1 1 0 0 1 1 1z';

// --- تبدیلِ کسر → نقطهٔ PDF -------------------------------------------------

/**
 * کسرهای قابِ دیده‌شده → کسرهای viewport (خنثی‌سازیِ چرخشِ CSS) →
 * پیکسلِ viewport → نقطهٔ خامِ PDF.
 */
function fractionsToPdfPoint(fx, fy, viewport, inverseTransform) {
  // مرحلهٔ ۵۰ §۲: بدونِ clamp به [0,1] — آیتمِ بیرونِ [0,1000] (مثلاً
  // x=-۱۵۰ یا x=۱۱۵۰) باید با همان مختصاتِ بیرون صادر شود، نه اینکه
  // سرِ لبهٔ صفحه بچسبد؛ نقطهٔ PDF بیرونِ کادر هم معتبر است و main
  // آن را همان‌جا می‌نشاند (روی بومِ overlay، بوم خودش برش می‌دهد).
  const px = fx * viewport.width;
  const py = fy * viewport.height;
  return applyAffine(inverseTransform, px, py);
}

/**
 * آماده‌سازیِ هندسهٔ یک صفحه: viewport + چرخش‌ها + ماتریسِ معکوس +
 * مقیاس‌ها. همهٔ تبدیل‌های این صفحه از همین آبجکت می‌آیند.
 */
export function buildPageGeometry(viewport, cssRotation) {
  const transform = Array.isArray(viewport.transform) && viewport.transform.length === 6
    ? viewport.transform
    : [1, 0, 0, -1, 0, viewport.height];
  const inverseTransform = invertAffine(transform);
  const pdfScale = Math.hypot(transform[0], transform[1]) || 1;
  const css = normalizeRotation(cssRotation);
  const docRotate = normalizeRotation(viewport.rotate);
  // ابعادِ خامِ صفحه از ‎/MediaBox یا ‎/CropBox (page.view)؛ اگر در
  // دسترس نبود، ابعادِ viewport با فرضِ ‎/Rotate=0.
  let rawWidth = viewport.width;
  let rawHeight = viewport.height;
  if (Array.isArray(viewport.view) && viewport.view.length === 4) {
    const w = Math.abs(viewport.view[2] - viewport.view[0]);
    const h = Math.abs(viewport.view[3] - viewport.view[1]);
    if (w > 0 && h > 0) {
      rawWidth = w;
      rawHeight = h;
    }
  }
  return {
    viewport,
    inverseTransform,
    pdfScale,
    // نسبتِ قابِ دیده‌شده (ارتفاع/عرضِ viewport): فضای یکنواختِ لایه،
    // Y را در همین ضریب ضرب می‌کند؛ برای رسمِ وفادارِ قلم/فلش روی
    // بوم، هندسهٔ انجین باید در همین فضای یکنواخت حل شود.
    aspect: viewport.width > 0 ? viewport.height / viewport.width : 1,
    // چرخشِ کل از قابِ دیده‌شده تا قابِ خام: اول CSS، بعد ‎/Rotate.
    totalUnrotate: (720 - css - docRotate) % 360,
    cssUnrotate: (360 - css) % 360,
    rawWidth,
    rawHeight,
  };
}

/** کسرهای قابِ دیده‌شده → کسرهای قابِ خام (برای بومِ overlay). */
function displayedFractionsToRaw(fx, fy, geometry) {
  return rotateUnitSquare(fx, fy, geometry.totalUnrotate);
}

/** کسرهای قابِ دیده‌شده → نقطهٔ خامِ PDF. */
function displayedFractionsToPdf(fx, fy, geometry) {
  const [vx, vy] = rotateUnitSquare(fx, fy, geometry.cssUnrotate);
  return fractionsToPdfPoint(vx, vy, geometry.viewport, geometry.inverseTransform);
}

// --- رسمِ وفادارِ روی بوم (مرحله ۵ ـ بخش ب) ---------------------------------
//
// چرا این رسم، خودِ رسمِ روی صفحه است، نه outlineی perfect-freehand؟
// ممیزیِ سه‌لایهٔ بخش ب نشان داد قلمِ ثبت‌شده روی صفحه، اصلاً با
// pointsToPath/getStrokeOptionsی انجین رسم نمی‌شود (آن توابع در
// رندرر هیچ فراخواننده‌ای ندارند): CommittedStroke در AnnotationLayer
// با drawSmoothStroke (چندضلعیِ هموارِ midpoint-quadratic، خطِ گرد)
// و با پهنای لایه‌ایِ `sw*2.4` برای قلم و `sw*5.5` برای هایلایتر
// رسم می‌شود (نه `sw*2.2`ی انجین). پس پختِ ۱۰۰٪ باید همان الگوریتمِ
// لایه را در فضای بوم تکرار کند؛ outlineی perfect-freehand، شکلی
// متفاوت (کانتورِ پرشده) می‌ساخت. هایلایتر، در گذرِ جداگانه‌ای
// (highlightPng) با همان شفافیتِ اسلایدر (پیش‌فرض ۰٫۴۵) و source-over
// رسم می‌شود و main، آن گذر را زیرِ بقیه می‌نشاند — بدونِ هیچ
// BlendModeای (ترکیبِ Multiplyِ مرحلهٔ ۷ ـ بخش ب مدت‌هاست حذف شده؛
 // main با opacityی ۱٫۰ می‌نشیند).

/** نقطهٔ فضای یکنواخت (ux, uy) → پیکسلِ بومِ جهتِ خام. */
function uniformToCanvasPoint(ux, uy, geometry, canvasW, canvasH) {
  const fx = ux / 1000;
  const fy = uy / (1000 * geometry.aspect);
  const [rx, ry] = displayedFractionsToRaw(fx, fy, geometry);
  return [rx * canvasW, ry * canvasH];
}

/** نقطهٔ ذخیره‌سازی (x, y در 0..1000) → پیکسلِ بومِ جهتِ خام. */
function storagePointToCanvasPoint(x, y, geometry, canvasW, canvasH) {
  const [rx, ry] = displayedFractionsToRaw(x / 1000, y / 1000, geometry);
  return [rx * canvasW, ry * canvasH];
}

function midpointPt(a, b) {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

/** همان drawSmoothStrokeی لایه، ولی در فضای پیکسلِ بوم. */
function drawSmoothStrokeCanvas(ctx, canvasPoints, color, widthPx, opacity) {
  if (!canvasPoints || canvasPoints.length === 0) return;
  // مرحلهٔ ۳۷ §۴(ج): رنگِ خالصِ مات؛ شفافیت فقط از globalAlpha می‌آید.
  const pureColor = toPureRgbCss(color) || color;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'source-over';
  if (canvasPoints.length === 1) {
    ctx.beginPath();
    ctx.fillStyle = pureColor;
    ctx.arc(canvasPoints[0][0], canvasPoints[0][1], widthPx / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.strokeStyle = pureColor;
  ctx.lineWidth = widthPx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const n = canvasPoints.length;
  if (n === 2) {
    ctx.moveTo(canvasPoints[0][0], canvasPoints[0][1]);
    ctx.lineTo(canvasPoints[1][0], canvasPoints[1][1]);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.moveTo(canvasPoints[0][0], canvasPoints[0][1]);
  const m1 = midpointPt(canvasPoints[0], canvasPoints[1]);
  ctx.lineTo(m1[0], m1[1]);
  for (let i = 1; i < n - 1; i++) {
    const mNext = midpointPt(canvasPoints[i], canvasPoints[i + 1]);
    ctx.quadraticCurveTo(canvasPoints[i][0], canvasPoints[i][1], mNext[0], mNext[1]);
  }
  ctx.lineTo(canvasPoints[n - 1][0], canvasPoints[n - 1][1]);
  ctx.stroke();
  ctx.restore();
}

function drawPenItemCanvas(ctx, item, geometry, canvasW, canvasH, unitScale) {
  const points = Array.isArray(item.points) ? item.points : [];
  if (points.length === 0) return;
  const aspect = geometry.aspect || 1;
  const canvasPoints = points
    .map((pt) => uniformToCanvasPoint(finiteNumber(pt.x), finiteNumber(pt.y) * aspect, geometry, canvasW, canvasH))
    .filter((pt) => pt.every(Number.isFinite));
  if (canvasPoints.length === 0) return;
  const sw = Math.max(1, finiteNumber(item.strokeWidth, 4));
  // پهنای لایه (نه انجین): قلم sw*2.4، هایلایتر sw*5.5.
  const widthPx = (item.tool === 'highlighter' ? sw * 5.5 : sw * 2.4) * unitScale;
  const opacity = item.tool === 'highlighter' ? normalizeOpacityValue(item.opacity, 0.45) : normalizeOpacityValue(item.opacity, 0.95);
  drawSmoothStrokeCanvas(ctx, canvasPoints, item.color || '#22d3ee', widthPx, opacity);
}

function drawBoxItemCanvas(ctx, item, geometry, canvasW, canvasH, unitScale) {
  const x1 = finiteNumber(item.x);
  const y1 = finiteNumber(item.y);
  const x2 = x1 + finiteNumber(item.width);
  const y2 = y1 + finiteNumber(item.height);
  const [cx1, cy1] = storagePointToCanvasPoint(x1, y1, geometry, canvasW, canvasH);
  const [cx2, cy2] = storagePointToCanvasPoint(x2, y2, geometry, canvasW, canvasH);
  const px = Math.min(cx1, cx2);
  const py = Math.min(cy1, cy2);
  const pw = Math.abs(cx2 - cx1);
  const ph = Math.abs(cy2 - cy1);
  if (pw <= 0 || ph <= 0) return;
  const sw = Math.max(1, finiteNumber(item.strokeWidth, 4));
  const swPx = sw * unitScale;
  const opacity = normalizeOpacityValue(item.opacity, 0.9);
  const color = toPureRgbCss(item.color || '#22d3ee') || item.color || '#22d3ee';
  const hasFill = item.hasFill ?? true;
  const style = item.boxStyle || 'rect';
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  if (style === 'cloud') {
    drawCloudPathCanvas(ctx, px, py, px + pw, py + ph, swPx);
    if (hasFill) {
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalAlpha = opacity;
    ctx.strokeStyle = color;
    ctx.lineWidth = swPx;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    return;
  }
  const radius = style === 'round' ? 12 * unitScale : 0;
  ctx.beginPath();
  if (radius > 0 && typeof ctx.roundRect === 'function') {
    ctx.roundRect(px, py, pw, ph, radius);
  } else {
    ctx.rect(px, py, pw, ph);
  }
  if (hasFill) {
    ctx.globalAlpha = opacity;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = opacity;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = swPx;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawArrowItemCanvas(ctx, item, geometry, canvasW, canvasH, unitScale) {
  const aspect = geometry.aspect || 1;
  const sw = Math.max(1, finiteNumber(item.strokeWidth, 4));
  const opacity = normalizeOpacityValue(item.opacity, 0.9);
  const color = toPureRgbCss(item.color || '#22d3ee') || item.color || '#22d3ee';
  // هندسه در فضای یکنواخت حل می‌شود (همان resolveArrowGeometryی
  // انجین که drawArrowCanvas هم از آن استفاده می‌کند)، بعد نقاطِ
  // هندسه، یکی‌یکی به فضای بوم نگاشت می‌شوند.
  const uniformItem = {
    ...item,
    startX: finiteNumber(item.startX),
    startY: finiteNumber(item.startY) * aspect,
    endX: finiteNumber(item.endX),
    endY: finiteNumber(item.endY) * aspect,
    cx: Number.isFinite(item.cx) ? finiteNumber(item.cx) : item.cx,
    cy: Number.isFinite(item.cy) ? finiteNumber(item.cy) * aspect : item.cy,
  };
  const g = resolveArrowGeometry(uniformItem);
  if (!g) return;
  const toCanvas = (ux, uy) => uniformToCanvasPoint(ux, uy, geometry, canvasW, canvasH);
  const [sx, sy] = toCanvas(g.sx, g.sy);
  const [ex, ey] = toCanvas(g.ex, g.ey);
  const [shaftX, shaftY] = toCanvas(g.shaftStartX, g.shaftStartY);
  const [cutX, cutY] = toCanvas(g.cutX, g.cutY);
  const tip = g.chevron ? toCanvas(g.chevron.tip.x, g.chevron.tip.y) : [ex, ey];
  const left = g.chevron ? toCanvas(g.chevron.left.x, g.chevron.left.y) : null;
  const right = g.chevron ? toCanvas(g.chevron.right.x, g.chevron.right.y) : null;
  const ctrl = uniformItem.arrowStyle === 'curved' && Number.isFinite(uniformItem.cx) && Number.isFinite(uniformItem.cy)
    ? toCanvas(uniformItem.cx, uniformItem.cy)
    : null;
  const swPx = sw * unitScale;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = opacity;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = swPx;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (g.hasStartDot) {
    ctx.beginPath();
    ctx.arc(sx, sy, g.dotRadius * unitScale, 0, Math.PI * 2);
    ctx.fill();
  }
  if (g.shaftVisible) {
    ctx.beginPath();
    ctx.moveTo(shaftX, shaftY);
    if (g.isCurved && ctrl) {
      ctx.quadraticCurveTo(ctrl[0], ctrl[1], cutX, cutY);
    } else {
      ctx.lineTo(cutX, cutY);
    }
    ctx.stroke();
  }
  if (g.hasEndArrow && g.chevron && left && right) {
    ctx.beginPath();
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(left[0], left[1]);
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(right[0], right[1]);
    ctx.stroke();
  }
  ctx.restore();
}

// --- تبدیلِ آیتم‌ها به بردار ------------------------------------------------

function strokeLineWidthPoints(tool, strokeWidth, geometry) {
  // مرحله ۷ ـ بخش ب: پهنای لایه (نه انجین) — قلم sw*2.4 (انجین
  // ۲٫۲ می‌داد و بردارِ fallback، ۸٪ باریک‌تر از روی صفحه بود)؛
  // هایلایتر sw*5.5 (مثلِ لایه).
  const factor = tool === 'highlighter' ? 5.5 : 2.4;
  const size = Math.max(1, finiteNumber(strokeWidth, 4)) * factor;
  return (size / 1000) * geometry.viewport.width / geometry.pdfScale;
}

function strokeOpacity(tool, item) {
  // مرحلهٔ ۳۷ §۴(الف): دقیقاً منطقِ getStrokeOpacity در لایه — هایلایتر
  // هم به اسلایدر وصل است (پیش‌فرض ۰٫۴۵)؛ ۰٫۳۵ی ثابت حذف شد.
  if (tool === 'highlighter') return normalizeOpacityValue(item.opacity, 0.45);
  return normalizeOpacityValue(item.opacity, 0.95);
}

function convertPenItem(item, geometry) {
  const points = Array.isArray(item.points) ? item.points : [];
  if (points.length === 0) return null;
  const mapped = points
    .map((p) => {
      const fx = finiteNumber(p.x) / 1000;
      const fy = finiteNumber(p.y) / 1000;
      return displayedFractionsToPdf(fx, fy, geometry);
    })
    .filter((pt) => pt.every(Number.isFinite));
  if (mapped.length === 0) return null;
  return {
    kind: 'ink',
    strokes: [mapped],
    color: item.color || '#22d3ee',
    lineWidth: strokeLineWidthPoints(item.tool, item.strokeWidth, geometry),
    opacity: strokeOpacity(item.tool, item),
  };
}

function convertBoxItem(item, geometry) {
  const corners = [
    [finiteNumber(item.x) / 1000, finiteNumber(item.y) / 1000],
    [(finiteNumber(item.x) + finiteNumber(item.width)) / 1000, finiteNumber(item.y) / 1000],
    [finiteNumber(item.x) / 1000, (finiteNumber(item.y) + finiteNumber(item.height)) / 1000],
    [(finiteNumber(item.x) + finiteNumber(item.width)) / 1000, (finiteNumber(item.y) + finiteNumber(item.height)) / 1000],
  ].map(([fx, fy]) => displayedFractionsToPdf(fx, fy, geometry));
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const hasFill = item.hasFill ?? true;
  return {
    kind: 'square',
    rect: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
    strokeColor: item.color || '#22d3ee',
    fillColor: hasFill ? item.color || '#22d3ee' : null,
    // مرحلهٔ ۳۸ §۲: ضریبِ ۰٫۱۵ حذف شد — آلفایِ fill دقیقاً
    // opacityی آیتم است (سیور هم دیگر آن را در ۰٫۱۵ ضرب نمی‌کند).
    fillOpacity: 1.0,
    lineWidth: (Math.max(1, finiteNumber(item.strokeWidth, 4)) / 1000) * geometry.viewport.width / geometry.pdfScale,
    opacity: normalizeOpacityValue(item.opacity, 0.9),
  };
}

function convertArrowItem(item, geometry) {
  const out = [];
  const sw = Math.max(1, finiteNumber(item.strokeWidth, 4));
  const lineWidth = (sw / 1000) * geometry.viewport.width / geometry.pdfScale;
  const opacity = normalizeOpacityValue(item.opacity, 0.9);
  const color = toPureRgbCss(item.color || '#22d3ee') || item.color || '#22d3ee';
  const isCurved =
    item.arrowStyle === 'curved' && Number.isFinite(item.cx) && Number.isFinite(item.cy);
  const sx = finiteNumber(item.startX) / 1000;
  const sy = finiteNumber(item.startY) / 1000;
  const ex = finiteNumber(item.endX) / 1000;
  const ey = finiteNumber(item.endY) / 1000;

  let endTangentAngle;
  let endPdf;
  let startPdf;
  if (isCurved) {
    const cx = finiteNumber(item.cx) / 1000;
    const cy = finiteNumber(item.cy) / 1000;
    const samples = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const pt = quadraticPoint({ x: sx, y: sy }, { x: cx, y: cy }, { x: ex, y: ey }, t);
      samples.push([pt.x, pt.y]);
    }
    const mapped = samples.map(([fx, fy]) => displayedFractionsToPdf(fx, fy, geometry));
    out.push({ kind: 'ink', strokes: [mapped], color, lineWidth, opacity });
    // مماسِ انتهایی در فضای PDF: از دو نمونهٔ آخرِ منحنیِ تبدیل‌شده.
    const p0 = mapped[mapped.length - 2];
    const p1 = mapped[mapped.length - 1];
    endTangentAngle = Math.atan2(p1[1] - p0[1], p1[0] - p0[0]);
    endPdf = p1;
    startPdf = mapped[0];
  } else {
    startPdf = displayedFractionsToPdf(sx, sy, geometry);
    endPdf = displayedFractionsToPdf(ex, ey, geometry);
    out.push({ kind: 'line', x1: startPdf[0], y1: startPdf[1], x2: endPdf[0], y2: endPdf[1], color, lineWidth, opacity });
    endTangentAngle = Math.atan2(endPdf[1] - startPdf[1], endPdf[0] - startPdf[0]);
  }

  // تیکِ بازِ انتهایی (همان هندسهٔ ماژولارِ انجین، ولی در فضای PDF).
  if (item.hasEndArrow !== false && Number.isFinite(endTangentAngle)) {
    const chev = getChevronGeometry(endPdf[0], endPdf[1], endTangentAngle, lineWidth);
    out.push({
      kind: 'ink',
      strokes: [
        [[chev.tip.x, chev.tip.y], [chev.left.x, chev.left.y]],
        [[chev.tip.x, chev.tip.y], [chev.right.x, chev.right.y]],
      ],
      color,
      lineWidth,
      opacity,
    });
  }
  // نقطهٔ مبدأ.
  if (item.hasStartDot === true) {
    const r = (getOriginDotRadius(sw) / 1000) * geometry.viewport.width / geometry.pdfScale;
    out.push({
      kind: 'circle',
      rect: [startPdf[0] - r, startPdf[1] - r, startPdf[0] + r, startPdf[1] + r],
      fillColor: color,
      opacity,
    });
  }
  return out;
}

/** آیتم‌های یک صفحه → لیستِ برداری برای main (فقط fallbackِ نبودِ overlay). */
export function convertPageItemsToVector(items, geometry) {
  const vector = [];
  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;
    if (item.tool === 'pen' || item.tool === 'highlighter') {
      const v = convertPenItem(item, geometry);
      if (v) vector.push(v);
    } else if (item.tool === 'box') {
      // باکسِ ابری، تصویری است (مسیرِ کمانی‌اش در overlay رسم می‌شود).
      if (item.boxStyle === 'cloud') continue;
      vector.push(convertBoxItem(item, geometry));
    } else if (item.tool === 'arrow') {
      vector.push(...convertArrowItem(item, geometry));
    }
    // text و sticky و cloud: فقط در overlay (رندرِ Canvas 2D).
  }
  return vector;
}

// --- پاک‌سازیِ آلفا و بازیابیِ رنگِ خالص (مرحلهٔ ۵۶، مأموریت ۳) -----------
//
// هالهٔ سیاهِ دورِ لبه‌های قلم و هایلایتر، دو علت داشت که در این فایل
// جدا جدا رفع می‌شوند:
//  ۱) سایهٔ سیاهِ استیکی در drawStickyItem (حذف شد؛ بالاتر ببینید).
//  ۲) آلفای پیش‌ضرب‌شده (premultiplied alpha) روی شفافِ سیاه:
//     بومِ Canvas 2D رنگ‌ها را در حافظهٔ داخلی به‌صورتِ پیش‌ضرب‌شده
//     نگه می‌دارد؛ یعنی رنگِ خالصِ C با آلفای a به‌صورتِ C*a ذخیره
//     می‌شود و لبهٔ آنتی‌الیاس‌شدهٔ یک ضربهٔ نیمه‌شفاف، با
//     C*a کوچک، به‌سمتِ سیاه تیره می‌شود.
//
// نکتهٔ مهمِ پیاده‌سازی (خواندنِ دقیقِ همین قرارداد، پیش از هر
// تغییری): مرورگر هنگامِ getImageData و toDataURL خودش
// unpremultiply می‌کند؛ یعنی داده‌ای که از بوم خوانده می‌شود،
// آلفای مستقیم (straight alpha) دارد و رنگش از قبل خالص است. پس
// تقسیمِ دوبارهٔ همان داده بر آلفا، رنگ را خراب می‌کند؛ مثلاً
// پیکسلِ لبهٔ فیروزه‌ای (34,211,238) با آلفای 121، بعد از تقسیمِ
// دوباره (72,255,255) می‌شود، یعنی یک هالهٔ روشنِ غلط. به همین
// دلیل، تقسیمِ unpremultiply فقط روی داده‌ای اعمال می‌شود که
// قراردادش واقعاً پیش‌ضرب‌شده باشد (تابعِ unpremultiplyImageData
// در پایین)، و گذرِ روی بومِ خروجی (cleanExportCanvasAlpha) فقط
// ناوردایِ سالمِ آلفا را اعمال می‌کند: پیکسلِ کاملاً شفاف (a=0)
// هیچ رنگی حمل نمی‌کند (سیاهِ شفافِ کانونی)، تا هیچ RGBِ سرگردانی
// در جاهایی که رمزگشای PNG ماسکِ آلفا را نادیده می‌گیرد، به‌صورتِ
// لکهٔ تیره دیده نشود. putImageData فقط وقتی صدا زده می‌شود که
// چیزی واقعاً عوض شده باشد؛ چون رفت‌وبرگشتِ putImageData خودش از
// حافظهٔ پیش‌ضرب‌شده می‌گذرد و لبه‌های کم‌آلفا را دوباره
// کمّی‌سازی (quantize) می‌کند.
//
// همهٔ این محاسبات در sRGB انجام می‌شوند (فضای رنگیِ خودِ بوم، که
// با colorSpace: 'srgb' ساخته شده) و هیچ تبدیلِ گامایی ندارند.

/**
 * بازیابیِ رنگِ خالص از دادهٔ پیش‌ضرب‌شده (قراردادِ ورودی: هر پیکسل
 * به‌صورتِ (R*a, G*a, B*a, a) روی شفافِ سیاه ذخیره شده است).
 * برای هر پیکسل با آلفای بزرگ‌تر از صفر، R و G و B با تقسیم بر آلفا
 * به رنگِ خالص برمی‌گردند؛ آلفای صفر دست نمی‌خورد (شفافِ سیاه) و
 * آلفای ۲۵۵ هم دست نمی‌خورد (مات). تابعِ خالص است (بدونِ DOM) تا
 * در تستِ Node هم مستقیم قابلِ اجرا باشد.
 */
export function unpremultiplyImageData(imageData) {
  if (!imageData || !imageData.data || !imageData.width || !imageData.height) {
    return { pixels: 0, recovered: 0 };
  }
  const data = imageData.data;
  let recovered = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 0 || a === 255) continue;
    const inv = 255 / a;
    const r = Math.round(data[i] * inv);
    const g = Math.round(data[i + 1] * inv);
    const b = Math.round(data[i + 2] * inv);
    const nr = r > 255 ? 255 : r;
    const ng = g > 255 ? 255 : g;
    const nb = b > 255 ? 255 : b;
    if (nr !== data[i] || ng !== data[i + 1] || nb !== data[i + 2]) {
      data[i] = nr;
      data[i + 1] = ng;
      data[i + 2] = nb;
      recovered += 1;
    }
  }
  return { pixels: imageData.width * imageData.height, recovered };
}

/**
 * پاک‌سازیِ امنِ آلفا روی ImageDataای که از بوم خوانده شده
 * (آلفای مستقیم؛ مرورگر از قبل unpremultiply کرده است). فقط
 * پیکسل‌های کاملاً شفاف را به سیاهِ شفافِ کانونی (0,0,0,0)
 * برمی‌گرداند تا هیچ رنگِ سرگردانی در ناحیهٔ شفاف نماند. رنگِ
 * پیکسل‌های نیمه‌شفاف، عمداً دست نمی‌خورد (دلیلش در سربرگِ همین
 * بخش آمده است). شمارِ پیکسل‌های اصلاح‌شده را برمی‌گرداند.
 */
export function cleanExportAlphaImageData(imageData) {
  if (!imageData || !imageData.data) return 0;
  const data = imageData.data;
  let fixed = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] !== 0) continue;
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      fixed += 1;
    }
  }
  return fixed;
}

/**
 * گذرِ پاک‌سازیِ آلفا روی بومِ خروجی، دقیقاً پیش از toDataURL.
 * ImageData را می‌خواند، پاک‌سازیِ امن را اعمال می‌کند و فقط در
 * صورتِ اصلاحِ واقعی، putImageData می‌زند تا بومِ سالم، هیچ
 * رفت‌وبرگشتی از حافظهٔ پیش‌ضرب‌شده نخورد.
 */
export function cleanExportCanvasAlpha(ctx, width, height) {
  const w = Math.floor(Number(width) || 0);
  const h = Math.floor(Number(height) || 0);
  if (!ctx || w <= 0 || h <= 0 || typeof ctx.getImageData !== 'function') {
    return { pixels: 0, fixed: 0, skipped: true };
  }
  let imageData = null;
  try {
    imageData = ctx.getImageData(0, 0, w, h);
  } catch (_) {
    return { pixels: 0, fixed: 0, skipped: true };
  }
  if (!imageData) return { pixels: 0, fixed: 0, skipped: true };
  const fixed = cleanExportAlphaImageData(imageData);
  if (fixed > 0 && typeof ctx.putImageData === 'function') {
    try {
      ctx.putImageData(imageData, 0, 0);
    } catch (_) {
      return { pixels: w * h, fixed, skipped: true };
    }
  }
  return { pixels: w * h, fixed, skipped: fixed === 0 };
}

// --- رندرِ overlay با Canvas 2D ----------------------------------------------

async function ensureExportFonts(items) {
  try {
    if (typeof document === 'undefined' || !document.fonts) return;
    const loads = [];
    const seen = new Set();
    for (const item of items) {
      const family = item.fontFamily || "'Estedad', sans-serif";
      const size = Math.max(10, Math.min(90, Number(item.fontSize) || (item.tool === 'sticky' ? 13 : 22)));
      const key = `${family}|${size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const weight = item.tool === 'sticky' ? '' : 'bold ';
      if (typeof document.fonts.load === 'function') {
        loads.push(document.fonts.load(`${weight}${size}px ${family}`).catch(() => {}));
      }
    }
    if (loads.length > 0) {
      await Promise.race([
        Promise.all(loads),
        new Promise((resolve) => setTimeout(resolve, 1500)),
      ]);
    }
    if (document.fonts.ready) {
      await Promise.race([
        document.fonts.ready,
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    }
  } catch (_) {
    // فونتِ آماده نبود هم خروجی ساخته می‌شود (با فونتِ جایگزین).
  }
}

function wrapTextLines(ctx, text, maxWidth) {
  const lines = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      const candidate = `${current} ${words[i]}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
      }
    }
    lines.push(current);
  }
  return lines;
}

function drawTextItem(ctx, item, px, py, unitScale) {
  const fontSize = (Number(item.fontSize) || 22) * unitScale;
  const fontFamily = item.fontFamily || "'Estedad', sans-serif";
  const opacity = normalizeOpacityValue(item.opacity, 0.9);
  const text = String(item.text || '');
  if (!text) return;
  // کپسول (pill) — اندازه‌گیریِ محلی با همان فرمول‌های
  // getTextPillBounds در انجین (padX/padY + ارتفاعِ ۱٫۳×فونت)، ولی در
  // فضای پیکسلِ بوم؛ چون getTextPillBounds فونت را به ۷۶ محدود می‌کند
  // و برای مقیاسِ خروجی (فونتِ بزرگ‌تر از ۷۶ پیکسل) کپسول را کوچک
  // برمی‌گرداند.
  const pillBackground = item.pillBackground;
  if (typeof pillBackground === 'string' && pillBackground && text) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.direction = detectTextDirection(text) === 'rtl' ? 'rtl' : 'ltr';
    // مرحله ۱۴: خط‌ها نرمال‌شده اندازه‌گیری می‌شوند تا عرضِ
    // کپسول، با همان متنی که کشیده می‌شود، یکی باشد.
    const lines = text.split(/\r?\n/).map(normalizeMixedBidiLine);
    let maxW = 0;
    for (const ln of lines) {
      const w = ctx.measureText(ln || ' ').width;
      if (w > maxW) maxW = w;
    }
    const padX = Math.max(8, Math.round(fontSize * 0.45));
    const padY = Math.max(6, Math.round(fontSize * 0.3));
    const pillHeight = lines.length * fontSize * 1.3 + padY * 2;
    const pill = {
      x: px - padX,
      y: py - padY,
      width: maxW + padX * 2,
      height: pillHeight,
      cornerRadius: Math.round(pillHeight / 2),
    };
    const fill = resolvePillFill(item);
    ctx.globalAlpha = opacity;
    ctx.beginPath();
    ctx.roundRect(pill.x, pill.y, pill.width, pill.height, pill.cornerRadius);
    const pillFill = fill ? fill.background : pillBackground;
    ctx.fillStyle = toPureRgbCss(pillFill) || pillFill;
    ctx.fill();
    if (fill && fill.border) {
      ctx.strokeStyle = toPureRgbCss(fill.border) || fill.border;
      ctx.lineWidth = Math.max(1, unitScale);
      ctx.stroke();
    }
    ctx.restore();
  }
  const dir = detectTextDirection(text);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = opacity;
  ctx.font = `bold ${fontSize}px ${fontFamily}`;
  ctx.direction = dir === 'rtl' ? 'rtl' : 'ltr';
  // textAlign همیشه 'left' است و ترازِ خطوط، دستی با lx انجام می‌شود:
  // با direction درست، شکل‌دهیِ متن صحیح می‌ماند و لبهٔ چپِ هر خط،
  // دقیقاً همان‌جایی می‌نشیند که Konva می‌نشاند (بلوک، لنگرِ بالا-چپ).
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const textColor = item.color || '#22d3ee';
  ctx.fillStyle = toPureRgbCss(textColor) || textColor;
  // مرحله ۱۴: خط‌هایِ ترکیبی، نرمال‌شده کشیده می‌شوند؛
  // ctx.direction و ترازِ دستیِ lx دست نمی‌خورند تا هندسهٔ
  // بلوک، دقیقاً مثلِ قبل بماند.
  const lines = text.split(/\r?\n/).map(normalizeMixedBidiLine);
  const lineHeight = fontSize * 1.3;
  // برای متنِ راست‌چین، خطوطِ کوتاه‌تر به راست چسبیده‌اند (مثلِ
  // align='right در Konva) و لبهٔ راستِ بلوک روی px + blockWidth است؛
  // برای چپ‌چین، همهٔ خطوط از px شروع می‌شوند.
  const widths = lines.map((ln) => ctx.measureText(ln || ' ').width);
  const blockWidth = Math.max(0, ...widths);
  lines.forEach((ln, i) => {
    const lx = dir === 'rtl' ? px + (blockWidth - widths[i]) : px;
    ctx.fillText(ln, lx, py + i * lineHeight);
  });
  ctx.restore();
}

function drawStickyItem(ctx, item, px, py, unitScale) {
  const w = (Number(item.width) || 210) * unitScale;
  const h = (Number(item.height) || 170) * unitScale;
  const headerH = 24 * unitScale;
  const pad = 12 * unitScale;
  const radius = 14 * unitScale;
  const theme = getStickyTheme(item.color);
  const opacity = normalizeOpacityValue(item.opacity, 0.95);
  const text = String(item.text || '');
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = opacity;
  // زیره، بدونِ سایه. مرحلهٔ ۵۶ (مأموریت ۳): سایهٔ سیاهِ استیکی
  // (rgba(0,0,0,0.22) با blur ۴ و offset ۶) حذف شد، چون در PDFِ
  // خروجی دورِ کارت یک هالهٔ سیاه می‌ساخت؛ همان سایه در لایهٔ Konva
  // هم حذف شده تا کارتِ روی صفحه دقیقاً همان کارتِ خروجی باشد.
  ctx.beginPath();
  ctx.roundRect(px, py, w, h, radius);
  ctx.fillStyle = theme.bodyBase;
  ctx.fill();
  // شست‌وشوی رنگی.
  ctx.beginPath();
  ctx.roundRect(px, py, w, h, radius);
  ctx.fillStyle = theme.tint;
  ctx.fill();
  // هدر.
  ctx.beginPath();
  ctx.roundRect(px, py, w, headerH, [radius, radius, 0, 0]);
  ctx.fillStyle = theme.headerFill;
  ctx.fill();
  // حاشیه.
  ctx.beginPath();
  ctx.roundRect(px, py, w, h, radius);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = Math.max(1, unitScale);
  ctx.stroke();
  // پینِ لوسید در مرکزِ هدر.
  try {
    const pin = new Path2D(LUCIDE_PIN_PATH);
    ctx.save();
    ctx.translate(px + w / 2 - 8 * unitScale, py + 4 * unitScale);
    ctx.scale((2 / 3) * unitScale, (2 / 3) * unitScale);
    ctx.strokeStyle = theme.text;
    // در فضایِ مقیاس‌شدهٔ Path، ضخامتِ ۲ (همانِ لوسید) کافی است؛
    // transform خودش آن را به پیکسلِ بوم می‌رساند.
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(pin);
    ctx.restore();
  } catch (_) {}
  // متن با wrap و ellipsis.
  const fontSize = (Number(item.fontSize) || 13) * unitScale;
  const fontFamily = item.fontFamily || "'Estedad', sans-serif";
  const dir = detectTextDirection(text);
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.direction = dir === 'rtl' ? 'rtl' : 'ltr';
  // مثلِ متن: تراز دستی؛ لبهٔ راستِ بلوکِ راست‌چین روی
  // (px + w - pad) قفل است.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.text;
  const maxTextWidth = Math.max(10, w - pad * 2);
  const maxTextHeight = Math.max(20 * unitScale, h - headerH - 20 * unitScale);
  const lineHeight = fontSize * 1.5;
  const maxLines = Math.max(1, Math.floor(maxTextHeight / lineHeight));
  let lines = wrapTextLines(ctx, text || 'برای نوشتن یادداشت دوبار کلیک کنید...', maxTextWidth);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[lines.length - 1];
    let trimmed = last;
    while (trimmed.length > 0 && ctx.measureText(`${trimmed}...`).width > maxTextWidth) {
      trimmed = trimmed.slice(0, -1);
    }
    lines[lines.length - 1] = `${trimmed}...`;
  }
  // مرحله ۱۴: خط‌هایِ wrapشده، نرمال‌شده اندازه‌گیری و کشیده
  // می‌شوند (trim با «...» رویِ متنِ خام انجام شده و بعد،
  // نرمال‌سازی می‌آید تا کاراکترهایِ کنترلی، trim را خراب نکنند).
  lines = lines.map(normalizeMixedBidiLine);
  const rightEdge = px + w - pad;
  lines.forEach((ln, i) => {
    const lineWidth = ctx.measureText(ln || ' ').width;
    const lx = dir === 'rtl' ? rightEdge - lineWidth : px + pad;
    ctx.fillText(ln, lx, py + headerH + 10 * unitScale + i * lineHeight);
  });
  ctx.restore();
}

/**
 * رندرِ overlayِ یک صفحه (همهٔ آیتم‌ها: قلم، هایلایتر، باکس، فلش،
 * متن، استیکی) روی بومِ Canvas 2D در جهتِ خامِ صفحه — پختِ کاملِ
 * لایهٔ شفاف. برمی‌گرداند: { overlayPng, highlightPng } یا null
 * (اگر آیتمی نیست). overlayPng، همهٔ آیتم‌ها به‌جز هایلایترهاست
 * و highlightPng فقط هایلایترهاست تا main، گذرِ هایلایتر را زیرِ
 * بقیه بنشاند (source-over، بدونِ BlendMode). وقتی overlay ساخته
 * شد، main دیگر /Annotِ تکراری نمی‌سازد.
 */
export async function renderPageOverlay(items, geometry) {
  const overlayItems = items || [];
  if (overlayItems.length === 0) return null;
  if (typeof document === 'undefined') return null;
  // مرحله ۵ ـ بخش ب: پیش از رسمِ متن و استیکی، فونتِ فارسی باید
  // کامل بارگذاری شده باشد (Estedadِ محلی).
  if (document?.fonts?.ready) await document.fonts.ready;
  await ensureExportFonts(overlayItems);

  // مرحلهٔ ۳۰ — مقیاسِ overlay، دقیقاً ۳٫۰ (پرامپت) با سقفِ
  // ۶۰۰۰ پیکسل برایِ ضلعِ بوم: برایِ صفحه‌هایِ معمولی، دقیقاً
  // ۳٫۰ است (قبلاً هم برایِ آن‌ها ۳٫۰ بود)؛ فقط صفحه‌هایِ غول‌پیکر
  // (ضلعِ بالایِ ۲۰۰۰ واحد) که قبلاً تا ۱٫۵ افت می‌کردند، حالا
  // تا سقفِ ۶۰۰۰ پیکسل بالا می‌آیند، نه بیشتر (جلوگیری از بومِ
  // چندصد مگابایتی).
  const maxDim = Math.max(geometry.rawWidth, geometry.rawHeight);
  let scale = 3.0;
  if (Math.max(geometry.rawWidth, geometry.rawHeight) * scale > 6000) {
    scale = 6000 / Math.max(geometry.rawWidth, geometry.rawHeight);
  }
  const canvasW = Math.max(1, Math.round(geometry.rawWidth * scale));
  const canvasH = Math.max(1, Math.round(geometry.rawHeight * scale));
  const makeCanvas = () => {
    const c = document.createElement('canvas');
    c.width = canvasW;
    c.height = canvasH;
    const c2d = c.getContext('2d', { colorSpace: 'srgb' });
    if (c2d) c2d.clearRect(0, 0, canvasW, canvasH);
    return [c, c2d];
  };
  const [canvas, ctx] = makeCanvas();
  const [hlCanvas, hlCtx] = makeCanvas();
  if (!ctx || !hlCtx) {
    // مرحلهٔ ۳۲ — بوم‌هایِ موقت حتی در این خروجِ زودهنگام هم آزاد می‌شوند.
    try { canvas.width = 0; canvas.height = 0; } catch (_) {}
    try { hlCanvas.width = 0; hlCanvas.height = 0; } catch (_) {}
    return null;
  }

  // مقیاسِ واحدِ یکنواخت → پیکسلِ بوم: بر اساسِ عرضِ دیده‌شده (viewport).
  const unitScale = (scale * geometry.viewport.width) / 1000;

  const hasHighlight = overlayItems.some(
    (it) => it && it.tool === 'highlighter' && Array.isArray(it.points) && it.points.length > 0
  );
  const hasMain = overlayItems.some((it) => it && it.tool !== 'highlighter');

  for (const item of overlayItems) {
    const fx = finiteNumber(item.x ?? item.startX) / 1000;
    const fy = finiteNumber(item.y ?? item.startY) / 1000;
    const [rx, ry] = displayedFractionsToRaw(fx, fy, geometry);
    let px = rx * canvasW;
    let py = ry * canvasH;
    // مرحلهٔ ۳۵ §۵: استیکیِ بیرون از کاغذ، در نزدیک‌ترین لبهٔ داخلِ
    // کاغذ پخته می‌شود تا در فایلِ خروجی نیفتد.
    if (item.tool === 'sticky') {
      const wPx = (Number(item.width) || 210) * unitScale;
      const hPx = (Number(item.height) || 170) * unitScale;
      px = Math.max(0, Math.min(px, Math.max(0, canvasW - wPx)));
      py = Math.max(0, Math.min(py, Math.max(0, canvasH - hPx)));
    }
    // هایلایترها روی بومِ جداگانه (تا در PDF زیرِ بقیه بنشینند)؛ بقیه روی بومِ اصلی. هر دو source-over با فضایِ رنگیِ srgb.
    const targetCtx = item.tool === 'highlighter' ? hlCtx : ctx;
    if (item.tool === 'text') {
      drawTextItem(targetCtx, item, px, py, unitScale);
    } else if (item.tool === 'sticky') {
      drawStickyItem(targetCtx, item, px, py, unitScale);
    } else if (item.tool === 'pen' || item.tool === 'highlighter') {
      drawPenItemCanvas(targetCtx, item, geometry, canvasW, canvasH, unitScale);
    } else if (item.tool === 'box') {
      drawBoxItemCanvas(targetCtx, item, geometry, canvasW, canvasH, unitScale);
    } else if (item.tool === 'arrow') {
      drawArrowItemCanvas(targetCtx, item, geometry, canvasW, canvasH, unitScale);
    }
  }
  // مرحلهٔ ۵۶ (مأموریت ۳): پاک‌سازیِ آلفا دقیقاً پیش از کدگذاریِ PNG،
  // روی هر دو بوم — روی پیکسل‌های واقعیِ خروجی، در فضای sRGB.
  if (hasMain) cleanExportCanvasAlpha(ctx, canvasW, canvasH);
  if (hasHighlight) cleanExportCanvasAlpha(hlCtx, canvasW, canvasH);
  const overlayPng = hasMain ? canvas.toDataURL('image/png') : null;
  const highlightPng = hasHighlight ? hlCanvas.toDataURL('image/png') : null;
  // مرحلهٔ ۳۲ — آزادسازیِ فوریِ بوم‌هایِ موقت بلافاصله پس از گرفتنِ
  // خروجی، تا حافظهٔ گرافیکیِ بوم‌هایِ تا ۶۰۰۰ پیکسلی در کتاب‌هایِ
  // پرحاشیه در رم انباشته نشود (صفر کردنِ ابعاد، بکینگ‌استور را آزاد می‌کند).
  try { canvas.width = 0; canvas.height = 0; } catch (_) {}
  try { hlCanvas.width = 0; hlCanvas.height = 0; } catch (_) {}
  return { overlayPng, highlightPng };
}

// --- ارکستراسیونِ کلِ خروجی -------------------------------------------------

/**
 * آماده‌سازیِ همهٔ صفحه‌های حاشیه‌نویسی‌شده برای ارسال به main.
 * @param {Object} args
 * @param {Object} args.annotationsByPage - { [pageNumber]: items[] } در فضای ذخیره‌سازی.
 * @param {Function} args.getPageViewport - async (pageNumber) => { width, height, transform, rotate, view } در scale=1.
 * @param {number} args.cssRotation - چرخشِ انتخابیِ کاربر (درجه).
 * @param {Function} [args.onProgress] - (done, total) => void برای ییلدِ UI.
 * @param {AbortSignal} [args.signal] - مرحلهٔ ۳۰: سیگنالِ لغوِ دستی.
 * @returns {Promise<{pages: Object, totalItems: number, annotatedPages: number}>}
 */
export async function prepareAnnotatedPdfExport({ annotationsByPage, getPageViewport, cssRotation, onProgress, signal }) {
  const pageNumbers = Object.keys(annotationsByPage || {})
    .map(Number)
    .filter((n) => Number.isFinite(n) && Array.isArray(annotationsByPage[n]) && annotationsByPage[n].length > 0)
    .sort((a, b) => a - b);
  const pages = {};
  let totalItems = 0;
  for (let i = 0; i < pageNumbers.length; i++) {
    // مرحلهٔ ۳۰ — لغوِ دستی: بینِ صفحه‌ها بررسی می‌شود؛ لغو،
    // فایلی نمی‌سازد و چیزی روی دیسک نمی‌نویسد.
    if (signal && signal.aborted) {
      const abortErr = new Error('عملیاتِ آماده‌سازیِ خروجی لغو شد.');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
    // مرحلهٔ ۳۲ — ییلدِ پیش از رندرِ هر صفحهٔ دارایِ حاشیه‌نویسی
    // (پیش از این، ییلد در انتهایِ حلقه بود و صفحهٔ اول بدونِ ییلد
    // رندر می‌شد): تردِ اصلی آزاد می‌شود تا نوارِ پیشرفت و دکمهٔ
    // لغو، در تمامِ مدت با نرخِ ۶۰ فریم واکنش‌گرا بمانند.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const pageNum = pageNumbers[i];
    const items = annotationsByPage[pageNum];
    totalItems += items.length;
    const viewport = await getPageViewport(pageNum);
    const geometry = buildPageGeometry(viewport, cssRotation);
    const rendered = await renderPageOverlay(items, geometry);
    const overlayPng = rendered ? rendered.overlayPng : null;
    const highlightPng = rendered ? rendered.highlightPng : null;
    // شبحِ دوتایی ممنوع: اگر overlayِ کامل هست، بردارِ تکراری نفرست
    // (saver هم، دفاعِ دوم، در حضورِ overlay بردار را نادیده می‌گیرد).
    // بردار فقط fallbackِ وقتی است که هیچ تصویری ساخته نشده باشد.
    const vector = overlayPng || highlightPng ? [] : convertPageItemsToVector(items, geometry);
    if (vector.length > 0 || overlayPng || highlightPng) {
      pages[pageNum] = {
        vector,
        overlayPng,
        highlightPng,
        pageWidth: geometry.rawWidth,
        pageHeight: geometry.rawHeight,
      };
    }
    if (typeof onProgress === 'function') onProgress(i + 1, pageNumbers.length);
  }
  return { pages, totalItems, annotatedPages: Object.keys(pages).length };
}
