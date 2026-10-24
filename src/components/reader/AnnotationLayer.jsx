// ============================================================================
// KonvaAnnotationLayer.jsx — فاز ۱ (v7.1 + حذف History داخلی)
//
// فیکس‌ها:
//   ۱. حذف رویدادهای مضاعف: فقط Pointer Events (بدون mouse/touch موازی)
//   ۲. setPointerCapture روی (nativeEvent.target || stage.content)
//   ۳. رفع چشمک‌زدن: پیش‌نویس تا سینک شدن props والد مخفی نمی‌شه
//   ۴. دقت نقطه پایانی: آخرین مختصات خام بدون فیلتر اضافه می‌شه
//   ۵. حذف حلقه RAF: batchDraw مستقیم در هندلر (تأخیر کمتر)
//   ۶. پاک‌کن بهینه: پیش‌فیلتر bounding box
// فاز ۱:
//   ۷. حذف کامل کلاس History داخلی — Undo/Redo صددرصد در والد
//   ۸. اکسپورت نام‌دار AnnotationLayer اضافه شد
// ============================================================================

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { Stage, Layer, Shape, Group, Line, Rect, Text, Transformer } from 'react-konva';
import useAppStore from '../../store/useAppStore';
import { AnnotationToolbar } from './AnnotationToolbar';
import {
  storageToUniform,
  uniformToStorage,
  uid,
  generateCloudPath,
  drawCloudPathCanvas,
  eraserHitsBox,
  getCloudBulb,
  defaultCurveControl,
  drawArrowCanvas,
  eraserHitsArrow,
  getArrowHeadGeometry,
  eraserHitsText,
  eraserHitsSticky,
  // فاز ۵: توابعِ انتخاب، مارکی و جابه‌جایی
  getItemBounds,
  findTopAnnotationAtPoint,
  rectsIntersect,
  marqueeRect,
  getUnionBounds,
  moveAnnotationByDelta,
} from '../../utils/annotationEngine';

export { AnnotationToolbar };

// ============================================================================
// بخش ۱: ریاضیات
// ============================================================================

const MIN_POINT_DIST = 1.5;
const STREAMLINE_FACTOR = 0.25;

function dist2(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function streamline(prev, curr, factor = STREAMLINE_FACTOR) {
  const t = 1 - factor;
  return {
    x: prev.x + (curr.x - prev.x) * t,
    y: prev.y + (curr.y - prev.y) * t,
  };
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) return Math.sqrt(dist2(px, py, ax, ay));
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt(dist2(px, py, ax + t * dx, ay + t * dy));
}

/** محاسبه bounding box یک استروک (برای پیش‌فیلتر پاک‌کن) */
function getStrokeBBox(points, padding = 15) {
  if (!points || points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

function bboxesIntersect(a, b) {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

// ============================================================================
// بخش ۲: رندر مستقیم — Midpoint Quadratic Bézier
// ============================================================================

function drawSmoothStroke(ctx, points, opts) {
  const { color, width, opacity, compositeOp } = opts;
  if (!points || points.length === 0) return;

  ctx.save();
  ctx.globalAlpha = opacity;
  if (compositeOp) ctx.globalCompositeOperation = compositeOp;

  if (points.length === 1) {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(points[0].x, points[0].y, width / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const n = points.length;
  if (n === 2) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);
  const m1 = midpoint(points[0], points[1]);
  ctx.lineTo(m1.x, m1.y);
  for (let i = 1; i < n - 1; i++) {
    const mNext = midpoint(points[i], points[i + 1]);
    ctx.quadraticCurveTo(points[i].x, points[i].y, mNext.x, mNext.y);
  }
  const last = points[n - 1];
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
  ctx.restore();
}

function getStrokeWidth(tool, baseWidth) {
  if (tool === 'highlighter') return baseWidth * 5.5;
  return baseWidth * 2.4;
}

function getStrokeOpacity(tool, baseOpacity) {
  if (tool === 'highlighter') return 0.35;
  return baseOpacity;
}

function getCompositeOp(tool) {
  return tool === 'highlighter' ? 'multiply' : 'source-over';
}

// ============================================================================
// بخش ۳: تاریخچه — فاز ۱: حذف شد
// مدیریت کامل Undo/Redo در والد (PdfViewer.jsx) انجام می‌شود.
// هیچ آرایه تاریخچه موازی در لایه نگه داشته نمی‌شود.
// ============================================================================

// ============================================================================
// بخش ۴: پاک‌کن بهینه — پیش‌فیلتر BBox (فیکس #۶)
// ============================================================================

function eraserHitsStroke(eraserPts, strokePts, strokeBBox, radius = 14) {
  if (eraserPts.length === 0 || strokePts.length < 1) return false;

  // فیکس #۶: اول BBox چک می‌شه — اکثر استروک‌ها اینجا رد می‌شن
  if (strokeBBox) {
    const eBBox = getStrokeBBox(eraserPts, radius);
    if (eBBox && !bboxesIntersect(eBBox, strokeBBox)) {
      return false; // بدون برخورد — بدون محاسبه پرهزینه
    }
  }

  if (strokePts.length === 1) {
    const sp = strokePts[0];
    const r2 = radius * radius;
    // فاز ۱-مرحله ۳: همه نقاط پاک‌کن بررسی شوند (نه یکی‌درمیان)
    for (let i = 0; i < eraserPts.length; i++) {
      const ep = eraserPts[i];
      const dx = ep.x - sp.x;
      const dy = ep.y - sp.y;
      if (dx * dx + dy * dy < r2) return true;
    }
    return false;
  }

  const eStep = Math.max(1, Math.floor(eraserPts.length / 10));
  const sStep = Math.max(1, Math.floor(strokePts.length / 30));

  for (let ei = 0; ei < eraserPts.length; ei += eStep) {
    const ep = eraserPts[ei];
    for (let si = 0; si < strokePts.length - 1; si += sStep) {
      const a = strokePts[si];
      const b = strokePts[si + 1];
      // رد سریع BBox سگمنت
      const minX = Math.min(a.x, b.x) - radius;
      const maxX = Math.max(a.x, b.x) + radius;
      const minY = Math.min(a.y, b.y) - radius;
      const maxY = Math.max(a.y, b.y) + radius;
      if (ep.x < minX || ep.x > maxX || ep.y < minY || ep.y > maxY) continue;
      if (pointToSegmentDist(ep.x, ep.y, a.x, a.y, b.x, b.y) < radius) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================================
// بخش ۵: استروک ذخیره‌شده
// ============================================================================

const CommittedStroke = React.memo(function CommittedStroke({ item, onErase }) {
  // BBox کش‌شده برای پاک‌کن بهینه
  const bbox = useMemo(() => getStrokeBBox(item.points, 15), [item.points]);

  const sceneFunc = useCallback((ctx) => {
    drawSmoothStroke(ctx, item.points, {
      color: item.color || '#22d3ee',
      width: getStrokeWidth(item.tool, item.strokeWidth),
      opacity: getStrokeOpacity(item.tool, item.opacity ?? 0.95),
      compositeOp: getCompositeOp(item.tool),
    });
  }, [item.points, item.color, item.tool, item.strokeWidth, item.opacity]);

  const hitFunc = useCallback((ctx) => {
    const pts = item.points;
    if (!pts || pts.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = Math.max(20, getStrokeWidth(item.tool, item.strokeWidth));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }, [item.points, item.tool, item.strokeWidth]);

  const handleClick = useCallback(() => {
    onErase?.(item.id, bbox);
  }, [onErase, item.id, bbox]);

  // bbox رو برای پاک‌کن در دیتای item نگه می‌داریم
  const itemWithBBox = useMemo(() => ({ ...item, _bbox: bbox }), [item, bbox]);

  return (
    <Shape
      sceneFunc={sceneFunc}
      hitFunc={hitFunc}
      onClick={handleClick}
      onTap={handleClick}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
      _bbox={bbox}
    />
  );
});



// ============================================================================
// فاز ۲: پیش‌نمایش زنده باکس حین رسم
// sceneFunc مستقیماً از draftBoxRef می‌خواند — با هر batchDraw به‌روز می‌شود
// ============================================================================
const BoxLiveDraft = React.forwardRef(function BoxLiveDraft(
  { boxRef, boxStyleRef, hasFillRef, colorRef, widthRef, opacityRef },
  ref
) {
  const sceneFunc = useCallback(
    (ctx, shape) => {
      const db = boxRef?.current;
      if (!db) return;

      const x = Math.min(db.startX, db.currentX);
      const y = Math.min(db.startY, db.currentY);
      const w = Math.abs(db.currentX - db.startX);
      const h = Math.abs(db.currentY - db.startY);
      if (w < 2 || h < 2) return; // خیلی کوچک — رندر نکن

      const style = boxStyleRef?.current || 'cloud';
      const color = colorRef?.current || '#22d3ee';
      const sw = Number(widthRef?.current) || 4;
      const opacity = Number(opacityRef?.current ?? 0.9);
      const hasFill = hasFillRef?.current ?? true;

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.strokeStyle = color;
      ctx.lineWidth = sw;

      if (style === 'cloud') {
        // کادر ابری
        drawCloudPathCanvas(ctx, x, y, x + w, y + h, sw);
        if (hasFill) {
          ctx.globalAlpha = opacity * 0.15;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = opacity;
        }
        ctx.stroke();
      } else {
        // مستطیل ساده یا گوشه‌گرد
        const r = style === 'round' ? 12 : 0;
        ctx.beginPath();
        if (r > 0 && ctx.roundRect) {
          ctx.roundRect(x, y, w, h, r);
        } else {
          ctx.rect(x, y, w, h);
        }
        if (hasFill) {
          ctx.globalAlpha = opacity * 0.15;
          ctx.fillStyle = color;
          ctx.fill();
          ctx.globalAlpha = opacity;
        }
        ctx.stroke();
      }
      ctx.restore();
    },
    [boxRef, boxStyleRef, hasFillRef, colorRef, widthRef, opacityRef]
  );

  return (
    <Shape
      ref={ref}
      sceneFunc={sceneFunc}
      visible={false}
      listening={false}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
    />
  );
});

// ============================================================================
// فاز ۳: پیش‌نمایش زنده فلش حین رسم
// sceneFunc مستقیماً از draftArrowRef می‌خواند — با هر batchDraw به‌روز می‌شود.
// پیش‌نویس به شکل آیتمِ ذخیره‌شده تبدیل می‌شود (currentX/currentY →
// endX/endY) و بعد با همان drawArrowCanvas رسم می‌شود تا پیش‌نمایش و
// نسخه نهایی دقیقاً یک هندسه داشته باشند.
// ============================================================================
const ArrowLiveDraft = React.forwardRef(function ArrowLiveDraft(
  { arrowRef, arrowStyleRef, colorRef, widthRef, opacityRef },
  ref
) {
  const sceneFunc = useCallback(
    (ctx, shape) => {
      const db = arrowRef?.current;
      if (!db) return;
      const dx = db.currentX - db.startX;
      const dy = db.currentY - db.startY;
      if (Math.hypot(dx, dy) < 2) return; // خیلی کوچک — رندر نکن

      const style = arrowStyleRef?.current || 'straight';
      const color = colorRef?.current || '#22d3ee';
      const sw = Number(widthRef?.current) || 4;
      const opacity = Number(opacityRef?.current ?? 0.9);

      ctx.save();
      ctx.globalAlpha = opacity;
      drawArrowCanvas(ctx, {
        startX: db.startX,
        startY: db.startY,
        endX: db.currentX,
        endY: db.currentY,
        cx: db.cx,
        cy: db.cy,
        arrowStyle: style,
        color,
        strokeWidth: sw,
        opacity,
      });
      ctx.restore();
    },
    [arrowRef, arrowStyleRef, colorRef, widthRef, opacityRef]
  );

  return (
    <Shape
      ref={ref}
      sceneFunc={sceneFunc}
      visible={false}
      listening={false}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
    />
  );
});

// ============================================================================
// فاز ۲: کامپوننت رندر باکس ذخیره‌شده
// ============================================================================
const CommittedBox = React.memo(function CommittedBox({ item, onErase }) {
  const boxStyle = item.boxStyle || 'rect';
  const hasFill = item.hasFill ?? true;
  const color = item.color || '#22d3ee';
  const sw = Number(item.strokeWidth) || 4;
  const opacity = Number(item.opacity ?? 0.9);

  const fillProps = hasFill
    ? { fill: color, fillOpacity: 0.15 }
    : { fillEnabled: false };

  const handleClick = useCallback(() => {
    onErase?.(item.id);
  }, [onErase, item.id]);

  const commonProps = {
    stroke: color,
    strokeWidth: sw,
    opacity: opacity,
    onClick: handleClick,
    onTap: handleClick,
    perfectDrawEnabled: false,
    shadowForStrokeEnabled: false,
    ...fillProps,
  };

  // مستطیل ساده
  if (boxStyle === 'rect') {
    return (
      <Rect
        x={item.x}
        y={item.y}
        width={item.width}
        height={item.height}
        {...commonProps}
      />
    );
  }

  // مستطیل گوشه‌گرد
  if (boxStyle === 'round') {
    return (
      <Rect
        x={item.x}
        y={item.y}
        width={item.width}
        height={item.height}
        cornerRadius={12}
        {...commonProps}
      />
    );
  }

  // کادر ابری — رسم با Canvas 2D نیتیو
  const cloudSceneFunc = useCallback(
    (ctx, shape) => {
      drawCloudPathCanvas(
        ctx,
        item.x,
        item.y,
        item.x + item.width,
        item.y + item.height,
        sw
      );
      // اعمال استایل‌ها بعد از ساخت مسیر
      ctx.fillStrokeShape(shape);
    },
    [item.x, item.y, item.width, item.height, sw]
  );

  const cloudHitFunc = useCallback(
    (ctx, shape) => {
      // فاز ۲-مرحله ۳ (سناریو ۲): حاشیه قبلی ±۱۰ پیکسل، لبه بیرونی
      // استروک ابریِ ضخیم را پوشش نمی‌داد (قله ≈ bulb/2 + strokeWidth/2،
      // تا ≈۱۵٫۴ پیکسل در strokeWidth=11). حاشیه جدید همان لبه بیرونی
      // واقعی + ۲ پیکسل پد است؛ تقریبی و عمداً کمی سخاوتمندانه، چون
      // کمان در گوشه‌ها یکنواخت نیست، ولی برای کلیکِ پاک‌کن مناسب است.
      const bulb = getCloudBulb(sw);
      const pad = Math.ceil(bulb / 2 + sw / 2 + 2);
      ctx.beginPath();
      ctx.rect(item.x - pad, item.y - pad, item.width + pad * 2, item.height + pad * 2);
      ctx.fillStrokeShape(shape);
    },
    [item.x, item.y, item.width, item.height, sw]
  );

  return (
    <Shape
      sceneFunc={cloudSceneFunc}
      hitFunc={cloudHitFunc}
      stroke={color}
      strokeWidth={sw}
      opacity={opacity}
      fill={hasFill ? color : undefined}
      fillOpacity={hasFill ? 0.15 : 0}
      onClick={handleClick}
      onTap={handleClick}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
    />
  );
});

// ============================================================================
// فاز ۳: کامپوننت رندر فلش ذخیره‌شده
// رندر یکپارچه با <Shape> و sceneFunc: همان drawArrowCanvas که پیش‌نمایش
// هم از آن استفاده می‌کند، پس نسخه نهایی و پیش‌نمایش یک هندسه دارند.
// hitFunc: بدنه با ضخامت پهن (برای کلیکِ تمیز) + چندضلعی نوک، تا
// کلیکِ پاک‌کن روی بدنه و روی نوک، هر دو کار کند.
// ============================================================================
const CommittedArrow = React.memo(function CommittedArrow({ item, onErase }) {
  const sw = Number(item.strokeWidth) || 4;
  const opacity = Number(item.opacity ?? 0.9);

  const sceneFunc = useCallback(
    (ctx, shape) => {
      drawArrowCanvas(ctx, item);
    },
    [item]
  );

  const hitFunc = useCallback(
    (ctx, shape) => {
      const sx = Number(item.startX);
      const sy = Number(item.startY);
      const ex = Number(item.endX);
      const ey = Number(item.endY);
      if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
          !Number.isFinite(ex) || !Number.isFinite(ey)) {
        return;
      }
      const isCurved = item.arrowStyle === 'curved' &&
        Number.isFinite(item.cx) && Number.isFinite(item.cy);
      const hitStrokeWidth = Math.max(24, sw * 3);
      // بدنه با ضخامت پهن
      ctx.beginPath();
      ctx.lineWidth = hitStrokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (isCurved) {
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(Number(item.cx), Number(item.cy), ex, ey);
      } else {
        ctx.moveTo(sx, sy);
        ctx.lineTo(ex, ey);
      }
      ctx.stroke();
      // چندضلعی نوک برای پوشش کلیک روی نوک
      // فاز ۳-مرحله ۳ (سناریو ۲): همان برگشتِ انجین — اگر نقطه کنترل
      // به پایان بسیار نزدیک باشد (مربعِ فاصله < ۰٫۰۱)، مماسِ منحنی
      // نویزی است و atan2 ممکن است نوکِ hit را به افق بچرخاند؛ پس
      // زاویه از وترِ شروع تا پایان گرفته می‌شود تا چندضلعیِ hit
      // دقیقاً همان جهتی را پوشش دهد که drawArrowCanvas رسم کرده است.
      // قبل از این اصلاح، hitFunc اصلاً برگشتی نداشت و در همین حالت
      // نادر، نوکِ رسم‌شده و نوکِ hit از هم جدا می‌شدند.
      let angle;
      if (isCurved) {
        const dxc = ex - Number(item.cx);
        const dyc = ey - Number(item.cy);
        if (dxc * dxc + dyc * dyc < 0.01) {
          angle = Math.atan2(ey - sy, ex - sx);
        } else {
          angle = Math.atan2(dyc, dxc);
        }
      } else {
        angle = Math.atan2(ey - sy, ex - sx);
      }
      if (Number.isFinite(angle)) {
        const head = getArrowHeadGeometry(ex, ey, angle, sw);
        const pts = head.points;
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        ctx.lineTo(pts[1].x, pts[1].y);
        ctx.lineTo(pts[2].x, pts[2].y);
        ctx.lineTo(pts[3].x, pts[3].y);
        ctx.closePath();
        ctx.fill();
      }
    },
    [item, sw]
  );

  const handleClick = useCallback(() => {
    onErase?.(item.id);
  }, [onErase, item.id]);

  return (
    <Shape
      sceneFunc={sceneFunc}
      hitFunc={hitFunc}
      opacity={opacity}
      onClick={handleClick}
      onTap={handleClick}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
    />
  );
});

// ============================================================================
// فاز ۴: کامپوننت رندر متن ذخیره‌شده
// رندر با <Text> از react-konva. لنگر، گوشهٔ بالا-چپ است (مثل
// getTextBounds در انجین) و خواندنِ دوگانهٔ مختصات دارد: x ?? startX
// و y ?? startY تا آیتم‌های قدیمیِ startX/startY هم رندر شوند.
// lineHeight={1.3} عمداً اضافه شده است تا ارتفاعِ رندر با ارتفاعِ
// getTextBounds (خطوط × fontSize × 1.3) یکی باشد؛ در مشخصاتِ TASK،
// این prop ذکر نشده بود ولی بدونِ آن، متنِ چندخطی در رندر فشرده‌تر
// از کرانهٔ پاک‌کن می‌شد.
// onDblClick → ویرایشِ مجدد؛ onClick/onTap → پاک‌کنِ کلیکی.
// ============================================================================
const CommittedText = React.memo(function CommittedText({ item, onErase, onEdit }) {
  const x = Number(item.x ?? item.startX ?? 0);
  const y = Number(item.y ?? item.startY ?? 0);
  const fontSize = Number(item.fontSize) || 22;

  const handleClick = useCallback(() => {
    onErase?.(item.id);
  }, [onErase, item.id]);

  const handleDblClick = useCallback(() => {
    onEdit?.(item);
  }, [onEdit, item]);

  return (
    <Text
      x={Number.isFinite(x) ? x : 0}
      y={Number.isFinite(y) ? y : 0}
      text={item.text || ''}
      fontSize={fontSize}
      fontFamily={item.fontFamily || "'Estedad', sans-serif"}
      fill={item.color || '#22d3ee'}
      opacity={item.opacity ?? 0.9}
      fontStyle="bold"
      lineHeight={1.3}
      // فاز ۴-مرحلهٔ ۳ (سناریو ۴): ترازِ راست‌به‌چپ برای فارسی.
      // بدونِ align="right"، خطوطِ کوتاه‌ترِ متنِ چندخطی به لبهٔ
      // چپِ کادر می‌چسبیدند و شروعِ پاراگراف‌ها ناهماهنگ بود.
      // توجه: چون عرضِ <Text> در اینجا تنظیم نشده است، Konva عرض
      // را از بلندترین خط می‌گیرد و align="right" خطوطِ کوتاه‌تر را
      // داخلِ همان کادر به راست می‌چسباند؛ کادرِ کلی (x/y/width/
      // height) عوض نمی‌شود، پس کرانهٔ پاک‌کن در getTextBounds با
      // رندر همچنان می‌خواند (به سناریو ۶ مراجعه کنید).
      align="right"
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={handleDblClick}
      perfectDrawEnabled={false}
      shadowForStrokeEnabled={false}
    />
  );
});

// ============================================================================
// فاز ۴: کامپوننت رندر یادداشت چسبان ذخیره‌شده
// رندر با <Group> در Konva (طبق مشخصاتِ TASK)، نه کارتِ HTMLِ قدیمی:
// کارتِ پس‌زمینه + نوارِ هدر + متنِ چندخطی با wrap. رنگ‌های کارت
// دقیقاً طبق مشخصاتِ TASK ثابت‌اند (#fef9c3 و #fef08a)؛ یعنی میدانِ
// colorِ آیتم در رندرِ کارت استفاده نمی‌شود، ولی ذخیره می‌شود (برای
// سازگاری با ساختارِ قدیمی و استفاده‌های آینده). opacityِ آیتم روی
// کلِ Group اعمال می‌شود تا شفافیتِ ذخیره‌شده بی‌اثر نماند.
// onDblClick → باز شدنِ ویرایشگرِ استیکی؛ onClick/onTap → پاک‌کن.
// فاز ۴-مرحلهٔ ۳: بیرون‌زدگیِ متنِ بلند از کارت با height و ellipsis
// رفع شد (به کامنتِ روی <Text> مراجعه کنید)؛ محدودیتِ شناخته‌شدهٔ
// قبلی دیگر برقرار نیست.
// ============================================================================
const CommittedSticky = React.memo(function CommittedSticky({ item, onErase, onEdit }) {
  const x = Number(item.x ?? item.startX ?? 0);
  const y = Number(item.y ?? item.startY ?? 0);
  const w = Number(item.width) || 210;
  const h = Number(item.height) || 170;

  const handleClick = useCallback(() => {
    onErase?.(item.id);
  }, [onErase, item.id]);

  const handleDblClick = useCallback(() => {
    onEdit?.(item.id);
  }, [onEdit, item.id]);

  return (
    <Group
      x={Number.isFinite(x) ? x : 0}
      y={Number.isFinite(y) ? y : 0}
      opacity={item.opacity ?? 0.95}
      onClick={handleClick}
      onTap={handleClick}
      onDblClick={handleDblClick}
    >
      <Rect
        width={w}
        height={h}
        fill="#fef9c3"
        stroke="#facc15"
        strokeWidth={1}
        cornerRadius={8}
        shadowBlur={8}
        shadowOpacity={0.15}
        shadowColor="black"
      />
      <Rect
        width={w}
        height={26}
        fill="#fef08a"
        cornerRadius={[8, 8, 0, 0]}
      />
      <Text
        x={12}
        y={36}
        width={w - 24}
        // فاز ۴-مرحلهٔ ۳ (سناریو ۳): جلوگیری از بیرون‌زدگیِ متن از کارت.
        // قبلاً هیچ heightای تنظیم نشده بود و متنِ ۶ خط یا بیشتر از
        // لبهٔ پایینِ کارت بیرون می‌زد. حالا ارتفاعِ متن به ارتفاعِ
        // کارت منهای ۴۸ محدود می‌شود (۳۶ پیکسلِ هدر و بالای متن +
        // ۱۲ پیکسلِ حاشیهٔ پایین) و با ellipsis={true}، متنِ اضافه
        // با «...» بریده می‌شود تا ظاهرِ کارت همیشه آراسته بماند.
        // محافظِ Math.max(20, ...) برای این است که اگر ارتفاعِ کارت
        // در دادهٔ قدیمی کمتر از ۴۸ بود، height منفی به Konva نرسد.
        // فاز ۴-مرحلهٔ ۳ (سناریو ۴): ترازِ راست‌به‌چپ برای فارسی.
        height={Math.max(20, h - 48)}
        ellipsis={true}
        align="right"
        text={item.text || 'برای نوشتن یادداشت دوبار کلیک کنید...'}
        fontSize={13}
        fontFamily="'Vazirmatn', sans-serif"
        fill="#713f12"
        wrap="word"
        lineHeight={1.4}
      />
    </Group>
  );
});


// ============================================================================
// فاز ۴: ویرایشگرِ موقتِ متن (HTML) — TextEditorOverlay
// خواهرِ Stage داخلِ همان کانتینر، دقیقاً روی مختصاتِ پیکسلیِ کلیک:
// left = x × scaleX و top = y × scaleY (با clamp فقط وقتی به لبهٔ
// راست/پایین نزدیک است تا ویرایشگر کاملاً از صفحه بیرون نزند).
// محافظتِ کیبورد: onKeyDown همهٔ کلیدها را stopPropagation +
// stopImmediatePropagationِ نیتیو می‌کند تا هیچ میانبری (به‌ویژه
// Ctrl+Z) به شنوندهٔ window در PdfViewer نرسد؛ Enter بدونِ Shift =
// ثبت، Shift+Enter = خطِ جدید (رفتارِ پیش‌فرضِ textarea)، Escape =
// لغو، Blur = ثبتِ متنِ غیرخالی (با trim) یا بستنِ بدونِ کامیت برای
// متنِ خالیِ جدید — و حذفِ آیتم برای متنِ ویرایش‌شدهٔ خالی‌شده
// (به commitText در مرحلهٔ ۳ مراجعه کنید).
// دکمه‌ها onMouseDown با preventDefault دارند تا کلیک روی «لغو» اول
// Blur ندهد و متن را ثبت نکند (بدونِ آن، «لغو» عملاً به «ثبت»
// تبدیل می‌شد).
// ============================================================================
function TextEditorOverlay({ editor, scaleX, scaleY, size, onChangeValue, onCommit, onCancel }) {
  if (!editor) return null;
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: Math.max(0, Math.min(editor.x * scaleX, Math.max(0, size.w - 280))),
        top: Math.max(0, Math.min(editor.y * scaleY, Math.max(0, size.h - 130))),
        zIndex: 25,
        width: 280,
        backgroundColor: 'rgba(13, 18, 24, 0.96)',
        border: '1px solid rgba(34,211,238,0.4)',
        borderRadius: 10,
        padding: 8,
        boxShadow: '0 14px 36px rgba(0, 0, 0, 0.8)',
        direction: 'rtl',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <textarea
        autoFocus
        value={editor.value}
        onChange={(e) => onChangeValue(e.target.value)}
        onKeyDown={(e) => {
          // فاز ۴-مرحلهٔ ۳ (سناریو ۵): مسدودسازیِ کاملِ کیبورد.
          // فقط stopPropagationِ React کافی نبود، چون شنوندهٔ
          // window در PdfViewer در فازِ حباب روی همان رویداد نشسته
          // است و stopPropagationِ مصنوعیِ React در بعضی مسیرها
          // (مثلاً شنونده‌های روی همان هدف) جلوی همه را نمی‌گیرد.
          // stopImmediatePropagationِ نیتیو، هم انتشار به window را
          // قطع می‌کند و هم بقیهٔ شنونده‌های همان هدف را، پس
          // Ctrl+Z داخلِ ویرایشگر دیگر نمی‌تواند Undoیِ صفحه را
          // شکار کند. guard برای این است که در تستِ Node یا
          // محیطِ بدونِ nativeEvent، خطا ندهد.
          e.stopPropagation();
          if (e.nativeEvent && typeof e.nativeEvent.stopImmediatePropagation === 'function') {
            e.nativeEvent.stopImmediatePropagation();
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onCommit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={() => onCommit()}
        onPointerDown={(e) => e.stopPropagation()}
        placeholder="متن را تایپ کنید (Enter = ثبت، Shift+Enter = خط جدید)..."
        style={{
          width: '100%',
          minHeight: 72,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          fontFamily: editor.fontFamily,
          fontSize: Math.max(12, editor.fontSize * scaleY),
          lineHeight: 1.3,
          color: editor.color,
          direction: 'rtl',
        }}
      />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-start' }}>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCommit()}
          style={{
            border: 'none',
            cursor: 'pointer',
            borderRadius: 7,
            padding: '6px 12px',
            fontSize: 12,
            fontFamily: 'inherit',
            background: 'rgba(34,211,238,0.25)',
            color: '#67e8f9',
          }}
        >
          ثبت متن
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onCancel()}
          style={{
            border: 'none',
            cursor: 'pointer',
            borderRadius: 7,
            padding: '6px 12px',
            fontSize: 12,
            fontFamily: 'inherit',
            background: 'transparent',
            color: 'rgba(255,255,255,0.6)',
          }}
        >
          لغو
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// فاز ۴: ویرایشگرِ موقتِ استیکی (HTML) — StickyEditorOverlay
// روی همان کارتِ Konva، با همان ابعادِ پیکسلیِ کارت. textarea به‌صورتِ
// کنترل‌نشده (defaultValue) است تا تایپ، رندرِ لایه را درگیر نکند؛
// ثبت فقط با Blur انجام می‌شود (طبق «debounce یا Blur» در TASK،
// گزینهٔ Blur انتخاب شد تا بدونِ تایمر، دقیقاً یک ورودیِ Undo ثبت
// شود). Escape، بدونِ ثبت لغو می‌کند. Enter در استیکی، خطِ جدید
// است و ثبت نمی‌کند (برخلافِ متن).
// ============================================================================
function StickyEditorOverlay({ item, scaleX, scaleY, size, onBlurCommit, onCancel }) {
  if (!item) return null;
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: Math.max(0, Math.min((Number(item.x ?? item.startX ?? 0)) * scaleX, Math.max(0, size.w - 100))),
        top: Math.max(0, Math.min((Number(item.y ?? item.startY ?? 0)) * scaleY, Math.max(0, size.h - 60))),
        zIndex: 25,
        width: Math.max(100, (Number(item.width) || 210) * scaleX),
        height: Math.max(60, (Number(item.height) || 170) * scaleY),
        backgroundColor: '#fef9c3',
        border: '1px solid #facc15',
        borderRadius: 8,
        boxShadow: '0 10px 28px rgba(0, 0, 0, 0.45)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        direction: 'rtl',
      }}
    >
      <div
        style={{
          height: 26,
          flexShrink: 0,
          backgroundColor: '#fef08a',
          borderBottom: '1px dashed rgba(0, 0, 0, 0.18)',
        }}
      />
      <textarea
        autoFocus
        defaultValue={item.text || ''}
        onKeyDown={(e) => {
          // فاز ۴-مرحلهٔ ۳ (سناریو ۵): همان مسدودسازیِ کاملِ
          // TextEditorOverlay — stopPropagation +
          // stopImmediatePropagationِ نیتیو — تا Ctrl+Z داخلِ
          // ویرایشگرِ استیکی هم به شنوندهٔ window در PdfViewer
          // نرسد.
          e.stopPropagation();
          if (e.nativeEvent && typeof e.nativeEvent.stopImmediatePropagation === 'function') {
            e.nativeEvent.stopImmediatePropagation();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={(e) => onBlurCommit(item.id, e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        placeholder="نکته را بنویسید..."
        style={{
          flex: 1,
          width: '100%',
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: '8px 12px',
          fontFamily: "'Vazirmatn', sans-serif",
          fontSize: Math.max(11, 13 * scaleY),
          lineHeight: 1.4,
          color: '#713f12',
          direction: 'rtl',
        }}
      />
    </div>
  );
}

// ============================================================================
// فاز ۵: ترجمهٔ ابزاریِ ترنسفورمِ نود به میدان‌های آیتم
// فرمولِ کلی (تبدیلِ آفینِ نود): هر نقطهٔ محلیِ p در مختصاتِ والد،
// به p' = (nodeX + scaleX * p.x, nodeY + scaleY * p.y) می‌رود.
// این فرمول، هم جابه‌جاییِ ناشی از کشیدنِ گوشه (که Konva برای
// ثابت نگه داشتنِ نقطهٔ لنگر، موقعیتِ نود را عوض می‌کند) و هم
// مقیاس را یکجا پوشش می‌دهد، و برای تک‌انتخاب و چندانتخاب یکسان
// کار می‌کند، چون هر نود، x/y/scaleی خودش را دارد.
// نکتهٔ مهم: این تابع، مقیاسِ نود را به میدانِ ابزاری تبدیل
// می‌کند، نه اینکه مقیاس را روی نود نگه دارد — بعد از خواندنِ
// x/y/scale، نود حتماً به position (0,0) و scale (1,1) برمی‌گردد
// (به handleTransformEnd مراجعه کنید)، وگرنه رندرِ بعدی هم
// مختصاتِ جدید را می‌کشد و هم مقیاسِ قدیمیِ نود را (جابه‌جاییِ
// مضاعف، از همان جنسِ باگِ فاز ۳ نسخهٔ ۳٫۱۳).
// - متن: موقعیت با فرمولِ نقطه‌ای + fontSize با clamp(fontSize *
//   scaleY, 14, 76) طبقِ TASK (با گردکردن به عددِ صحیح، چون
//   fontSize در استور عددِ صحیح است و اسلایدر گامِ ۱ دارد).
// - باکس/استیکی: موقعیت با فرمولِ نقطه‌ای + width * scaleX و
//   height * scaleY (با حداقلِ ۱۰، چون boundBoxFunc هم حداقلِ
//   ۱۰ را تضمین می‌کند).
// - فلش: شروع، پایان و (در صورتِ وجود) نقطهٔ کنترل، هر سه با
//   فرمولِ نقطه‌ای — تبدیلِ آفینِ بزیهٔ درجهٔ دو، هنوز بزیهٔ درجهٔ
//   دو است، پس شکلِ منحنی حفظ می‌شود.
// - استروک: همهٔ نقاط با فرمولِ نقطه‌ای؛ strokeWidth عوض نمی‌شود
//   (ضخامتِ خط نباید با مقیاس کش بیاید).
// ============================================================================
function transformItemByNode(item, nodeX, nodeY, scaleX, scaleY) {
  const px = (x) => nodeX + scaleX * x;
  const py = (y) => nodeY + scaleY * y;

  if (item.tool === 'text') {
    const baseFont = Number(item.fontSize) || 22;
    return {
      ...item,
      x: px(item.x ?? item.startX ?? 0),
      y: py(item.y ?? item.startY ?? 0),
      startX: px(item.startX ?? item.x ?? 0),
      startY: py(item.startY ?? item.y ?? 0),
      fontSize: Math.max(14, Math.min(76, Math.round(baseFont * scaleY))),
    };
  }

  if (item.tool === 'box' || item.tool === 'sticky') {
    return {
      ...item,
      x: px(item.x ?? 0),
      y: py(item.y ?? 0),
      width: Math.max(10, (Number(item.width) || 0) * scaleX),
      height: Math.max(10, (Number(item.height) || 0) * scaleY),
    };
  }

  if (item.tool === 'arrow') {
    const next = {
      ...item,
      startX: px(item.startX ?? 0),
      startY: py(item.startY ?? 0),
      endX: px(item.endX ?? 0),
      endY: py(item.endY ?? 0),
    };
    if (Number.isFinite(item.cx)) next.cx = px(item.cx);
    if (Number.isFinite(item.cy)) next.cy = py(item.cy);
    return next;
  }

  if (Array.isArray(item.points) && item.points.length > 0) {
    return {
      ...item,
      points: item.points.map((p) => ({ x: px(p.x), y: py(p.y) })),
    };
  }

  return {
    ...item,
    x: px(item.x ?? 0),
    y: py(item.y ?? 0),
  };
}

// ============================================================================
// بخش ۶: کامپوننت اصلی
// ============================================================================

const KonvaAnnotationLayer = React.memo(function KonvaAnnotationLayer({
  pageNumber,
  items = [],
  onCommitPageItems,
}) {
  const isAnnotationActive = useAppStore((s) => Boolean(s.isAnnotationActive));
  const annotationTool = useAppStore((s) => s.annotationTool || 'pen');
  const annotationColor = useAppStore((s) => s.annotationColor || '#22d3ee');
  const annotationStrokeWidth = useAppStore((s) => s.annotationStrokeWidth || 4);
  const annotationOpacity = useAppStore((s) => s.annotationOpacity ?? 0.9);
  // فاز ۲: استیت‌های باکس
  const annotationBoxStyle = useAppStore((s) => s.annotationBoxStyle || 'cloud');
  const annotationHasFill = useAppStore((s) => Boolean(s.annotationHasFill));
  // فاز ۳: استیت فلش
  const annotationArrowStyle = useAppStore((s) => s.annotationArrowStyle || 'straight');
  // فاز ۴: استیت‌های متن
  const annotationFontFamily = useAppStore((s) => s.annotationFontFamily || "'Estedad', sans-serif");
  const annotationFontSize = useAppStore((s) => s.annotationFontSize || 22);
  // فاز ۵: استیت‌های انتخاب (برای رندرِ Transformer و draggable؛
  // خواندنِ تازه در هندلرها از طریقِ getState انجام می‌شود تا
  // closure قدیمی نماند — مثلِ شنوندهٔ update-selected).
  const selectedAnnotationId = useAppStore((s) => s.selectedAnnotationId);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds || []);
  const selectedAnnotationPage = useAppStore((s) => s.selectedAnnotationPage);

  const containerRef = useRef(null);
  const stageRef = useRef(null);
  // فاز ۲-مرحله ۳: layerRef در ۴ جا استفاده می‌شد ولی هرگز تعریف نشده
  // بود (ReferenceError و عدم batchDraw) — حالا تعریف و به <Layer> وصل است.
  const layerRef = useRef(null);

  // --- بافرها (صفر setState حین رسم) ---
  const draftShapeRef = useRef(null);
  const draftPointsRef = useRef([]);
  const draftStyleRef = useRef(null);
  const lastRawPointRef = useRef(null);   // فیکس #۴: آخرین نقطه خام بدون فیلتر
  const eraserPtsRef = useRef([]);
  const eraserLineRef = useRef(null);
  const isDrawingRef = useRef(false);
  const pendingCommitRef = useRef(null);  // فیکس #۳: ID استروک در انتظار سینک
  const pendingTimeoutRef = useRef(null); // فاز ۱-مرحله ۳: تایمر ایمنی ضدفریز
  // فاز ۲: پیش‌نویس زنده باکس
  const draftBoxRef = useRef(null); // { startX, startY, currentX, currentY }
  const draftBoxShapeRef = useRef(null);
  // فاز ۳: پیش‌نویس زنده فلش
  const draftArrowRef = useRef(null); // { startX, startY, currentX, currentY, cx, cy }
  const draftArrowShapeRef = useRef(null);
  // فاز ۴: ویرایشگر متن و ویرایشگر استیکی
  // textEditor: { x, y, value, editId, fontSize, fontFamily, color, opacity }
  const [textEditor, setTextEditor] = useState(null);
  const [activeStickyEditorId, setActiveStickyEditorId] = useState(null);
  // رفرنس‌های همگام با استیت‌ها، برای اینکه هندلرهای Konva (که با
  // useCallback ساخته می‌شوند) و commitText، مقدارِ تازه را ببینند و
  // کامیتِ دوباره (مثلاً هم با Enter و هم با Blur) آیتمِ تکراری نسازد.
  const textEditorRef = useRef(null);
  const activeStickyEditorRef = useRef(null);
  // فاز ۵: Transformer، مارکی و نودهای انتخاب‌شده
  const transformerRef = useRef(null);
  const [marqueeBox, setMarqueeBox] = useState(null); // { x, y, width, height } در فضای یکنواخت
  // selectedNodes: آینهٔ stateیِ نودهای متصل به Transformer (طبقِ
  // TASK)؛ اتصالِ واقعی با transformerRef.current.nodes(...) انجام
  // می‌شود، نه با prop — این state فقط برای اینکه effectِ اتصال،
  // نودهای فعلی را هم نگه دارد و در صورتِ نیاز در دسترس باشند.
  const [selectedNodes, setSelectedNodes] = useState([]);
  // نگاشتِ id آیتم → نودِ Konvaیِ Groupِ پوششیِ آن (به § رندر
  // مراجعه کنید: هر آیتم در یک <Group ref> قرار می‌گیرد، نه اینکه
  // Committed*ها به forwardRef تبدیل شوند — هر دو گزینه در TASK
  // مجاز بود و گزینهٔ Group، کم‌ریسک‌تر است چون hitFuncهای داخلیِ
  // Committed*ها دست نخورده می‌مانند).
  const itemNodeRefs = useRef(new Map());
  // مارکی و جابه‌جاییِ دستیِ گروهی (کلیک روی فضای خالیِ داخلِ
  // کادرِ اجتماع): با ref نگه داشته می‌شوند تا handleMove/Up،
  // بدونِ setState در هر حرکت، به آن‌ها دسترسی داشته باشند.
  const isMarqueeRef = useRef(null); // { startPt } یا null
  const manualMoveRef = useRef(null); // { startPt, lastPt, originals: Map<id, item> } یا null
  // محافظِ کامیتِ مضاعفِ ترنسفورم: چون onTransformEnd هم روی
  // Transformer و هم روی Groupهای پوششی می‌تواند آتش شود، اولین
  // هندلری که اجرا می‌شود، همهٔ نودها را پردازش و کامیت می‌کند و
  // زمانش را ثبت می‌کند؛ هندلرهای بعدی در همان ژست (کمتر از
  // ۱۰۰ میلی‌ثانیه بعد) نادیده گرفته می‌شوند. دو ژستِ متوالی
  // نمی‌توانند در ۱۰۰ میلی‌ثانیه رخ دهند، پس این پنجره امن است.
  const transformCommittedAtRef = useRef(0);
  const lastEventTimeRef = useRef(0);     // فیکس #۱: جلوگیری از اجرای مضاعف

  const toolRef = useRef(annotationTool);
  const colorRef = useRef(annotationColor);
  const widthRef = useRef(annotationStrokeWidth);
  const opacityRef = useRef(annotationOpacity);
  const boxStyleRef = useRef(annotationBoxStyle);
  const hasFillRef = useRef(annotationHasFill);
  const arrowStyleRef = useRef(annotationArrowStyle);
  const fontFamilyRef = useRef(annotationFontFamily);
  const fontSizeRef = useRef(annotationFontSize);
  toolRef.current = annotationTool;
  colorRef.current = annotationColor;
  widthRef.current = annotationStrokeWidth;
  opacityRef.current = annotationOpacity;
  boxStyleRef.current = annotationBoxStyle;
  hasFillRef.current = annotationHasFill;
  arrowStyleRef.current = annotationArrowStyle;
  fontFamilyRef.current = annotationFontFamily;
  fontSizeRef.current = annotationFontSize;
  textEditorRef.current = textEditor;
  activeStickyEditorRef.current = activeStickyEditorId;

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(1);
  const [eraserVisible, setEraserVisible] = useState(false);

  const itemsRef = useRef(items);
  const aspectRef = useRef(aspect);
  const pageRef = useRef(pageNumber);
  const commitFnRef = useRef(onCommitPageItems);
  itemsRef.current = items;
  aspectRef.current = aspect;
  pageRef.current = pageNumber;
  commitFnRef.current = onCommitPageItems;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        setSize({ w: r.width, h: r.height });
        const a = r.height / r.width;
        setAspect((prev) => (Math.abs(prev - a) < 0.01 ? prev : a));
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scaleX = size.w > 0 ? size.w / 1000 : 1;
  const scaleY = size.h > 0 ? size.h / (1000 * aspect) : 1;
  const scaleRef = useRef({ scaleX: 1, scaleY: 1 });
  scaleRef.current = { scaleX, scaleY };

  const uniformItems = useMemo(() => {
    return (items || []).filter(Boolean).map((it) => {
      const u = storageToUniform(it, aspect);
      // BBox کش برای پاک‌کن بهینه
      return { ...u, _bbox: getStrokeBBox(u.points, 15) };
    });
  }, [items, aspect]);

  const commit = useCallback((uniformList) => {
    const storageList = uniformList.map((it) => {
      const { _bbox, ...clean } = it; // BBox ذخیره نمی‌شه
      return uniformToStorage(clean, aspectRef.current);
    });
    commitFnRef.current?.(pageRef.current, storageList);
  }, []);

  // فاز ۴: ثبتِ متنِ ویرایشگر (جدید یا ویرایشِ موجود).
  // فاز ۴-مرحلهٔ ۳ (سناریو ۲): محافظِ دوباره‌کامیت با دو لایه:
  // (۱) textEditorRef که در فراخوانیِ اول فوراً null می‌شود، و
  // (۲) فلگِ صریحِ isSubmittingRef که دقیقاً طبقِ TASK اضافه شد.
  // دلیلِ لایهٔ دوم: وقتی Enter زده می‌شود، commitText اجرا و
  // setTextEditor(null) باعثِ Unmountِ textarea می‌شود و مرورگر در
  // لحظهٔ تخریب، onBlurِ نیتیو را شلیک می‌کند؛ بدونِ فلگ، اگر
  // closureِ onBlur نسخهٔ قدیمیِ commitText را داشت، کامیتِ دوم
  // می‌توانست آیتمِ تکراری بسازد یا (در حالتِ ویرایشِ خالی‌شده)
  // ورودیِ Undoیِ اضافه ثبت کند. فلگ در فراخوانیِ اول true می‌شود
  // و تا باز شدنِ ویرایشگرِ بعدی true می‌ماند، پس Blurِ پس از
  // Enter قطعاً مسدود می‌شود؛ با باز شدنِ هر ویرایشگرِ جدید، فلگ
  // با useEffectِ زیر reset می‌شود (به § پایین مراجعه کنید).
  // فاز ۴-مرحلهٔ ۳ (سناریو ۱): اگر متنِ ویرایش‌شده کاملاً خالی شد
  // (cleanText === '' و editId هست)، آیتم نباید با متنِ خالی در
  // دیتابیس بماند؛ بلکه با filter کاملاً حذف و کامیت می‌شود تا
  // استروکِ نامرئی و اشغال‌کننده در حافظه باقی نماند (و با یک
  // Ctrl+Z قابلِ بازگشت است، چون حذف از همان مسیرِ commit می‌گذرد).
  // برای متنِ جدیدِ خالی، مثلِ قبل هیچ کامیتی ثبت نمی‌شود.
  const isSubmittingRef = useRef(false);
  const commitText = useCallback(() => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    const ed = textEditorRef.current;
    if (!ed) return;
    textEditorRef.current = null;
    setTextEditor(null);
    const cleanText = String(ed.value || '').trim();
    if (!cleanText) {
      if (ed.editId) {
        commit(uniformItems.filter((it) => it.id !== ed.editId));
      }
      return;
    }
    const roundedX = Math.round(ed.x * 100) / 100;
    const roundedY = Math.round(ed.y * 100) / 100;
    if (ed.editId) {
      commit(uniformItems.map((it) => {
        if (it.id !== ed.editId) return it;
        return {
          ...it,
          x: roundedX,
          y: roundedY,
          startX: roundedX,
          startY: roundedY,
          text: cleanText,
          fontSize: ed.fontSize,
          fontFamily: ed.fontFamily,
          color: ed.color,
          opacity: ed.opacity,
        };
      }));
    } else {
      const newText = {
        id: uid('text'),
        tool: 'text',
        x: roundedX,
        y: roundedY,
        startX: roundedX,
        startY: roundedY,
        text: cleanText,
        fontSize: ed.fontSize,
        fontFamily: ed.fontFamily,
        color: ed.color,
        opacity: ed.opacity,
      };
      commit([...uniformItems, newText]);
    }
  }, [commit, uniformItems]);

  // فاز ۴: لغوِ ویرایشگرِ متن بدونِ ثبت (Escape یا دکمهٔ لغو).
  const cancelTextEditor = useCallback(() => {
    textEditorRef.current = null;
    isSubmittingRef.current = false;
    setTextEditor(null);
  }, []);

  // فاز ۴-مرحلهٔ ۳ (سناریو ۲): با باز شدنِ هر ویرایشگرِ متنِ جدید،
  // فلگِ isSubmittingRef reset می‌شود تا کامیتِ ویرایشگرِ قبلی،
  // کامیتِ ویرایشگرِ بعدی را مسدود نکند. این effect بعد از رندرِ
  // باز شدنِ ویرایشگر اجرا می‌شود، پس Blurِ پس از Enterِ ویرایشگرِ
  // قبلی (که قبل از این رندر رخ می‌دهد) همچنان با فلگِ true
  // مسدود می‌ماند.
  useEffect(() => {
    if (textEditor) {
      isSubmittingRef.current = false;
    }
  }, [textEditor]);

  // فاز ۴: ثبتِ متنِ استیکی از روی Blurِ ویرایشگرِ استیکی.
  // برخلافِ متن، متنِ استیکی trim نمی‌شود (مثلِ قدیمی، دقیقاً همان
  // چیزی که تایپ شده ذخیره می‌شود) و اگر نسبت به مقدارِ ذخیره‌شده
  // عوض نشده باشد، اصلاً کامیت نمی‌شود تا ورودیِ Undoیِ خالی ثبت
  // نشود. محافظِ دوباره‌کامیت هم مثلِ commitText با ref است.
  const commitStickyText = useCallback((id, value) => {
    if (activeStickyEditorRef.current !== id) return;
    activeStickyEditorRef.current = null;
    setActiveStickyEditorId(null);
    const item = uniformItems.find((it) => it.id === id);
    if (!item) return;
    const nextText = String(value ?? '');
    if (nextText === (item.text || '')) return;
    commit(uniformItems.map((it) => (it.id === id ? { ...it, text: nextText } : it)));
  }, [commit, uniformItems]);

  // فاز ۵: همگام‌سازیِ dragِ گروهی در حینِ حرکت.
  // وقتی کاربر یکی از نودهای انتخاب‌شده را می‌کشد، Konva فقط
  // همان نود را حرکت می‌دهد؛ برای اینکه کلِ گروه با هم حرکت کند
  // (نه اینکه فقط یکی جلو بیفتد)، موقعیتِ بقیهٔ نودهای انتخاب‌شده
  // هم به همان dx,dy تنظیم می‌شود. تنظیمِ موقعیتِ نودها به‌صورتِ
  // برنامه‌ای، onDragMoveی آن‌ها را آتش نمی‌زند، پس حلقهٔ بازخورد
  // رخ نمی‌دهد. کامیت، فقط در onDragEnd انجام می‌شود، نه اینجا.
  const handleItemDragMove = useCallback((e) => {
    const node = e.target;
    if (!node) return;
    const dx = node.x();
    const dy = node.y();
    const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
    const ids = state.selectedAnnotationIds || [];
    // فاز ۵-مرحله ۳ (سناریو ۴): اگر نودِ کشیده‌شده در انتخابِ
    // فعلی نیست (مثلاً با Shift+کلیک از انتخاب بیرون رفته است)،
    // بقیهٔ نودها را با آن همگام نمی‌کنیم — وگرنه گروه، دنبالِ
    // نودی می‌رود که دیگر انتخاب‌شده نیست.
    if (!ids.includes(node.id())) return;
    if (ids.length <= 1) return;
    for (const id of ids) {
      const other = itemNodeRefs.current.get(id);
      if (other && other !== node) {
        other.position({ x: dx, y: dy });
      }
    }
    layerRef.current?.batchDraw();
  }, []);

  // فاز ۵: پایانِ جابه‌جاییِ یک نود (تکی یا گروهی).
  // - دلتا از موقعیتِ نود خوانده می‌شود: dx = node.x()، dy = node.y()
  //   (چون Groupِ پوششی در ابتدا در (0,0) است و مختصاتِ والدِ آن،
  //   همان فضای یکنواخت است، این دلتا دقیقاً در فضای یکنواخت است).
  // - فوری reset می‌شود: node.position({ x: 0, y: 0 }) — و برای
  //   گروه، همهٔ نودهای انتخاب‌شده reset می‌شوند — تا رندرِ بعدی
  //   (که آیتم‌ها را با مختصاتِ جدید می‌کشد) با آفستِ قدیمیِ نود
  //   جمع نشود (جابه‌جاییِ مضاعف).
  // - آیتم(ها) با moveAnnotationByDelta به‌روز و دقیقاً یک بار با
  //   commit() کامیت می‌شوند (یک ورودیِ Undo در والد).
  // - اگر دلتا صفر بود، هیچ کامیتی ثبت نمی‌شود (کلیک بدونِ drag،
  //   ورودیِ Undoیِ خالی نمی‌سازد).
  const handleItemDragEnd = useCallback((e, item) => {
    const node = e.target;
    if (!node) return;
    const dx = node.x();
    const dy = node.y();
    const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
    const ids = state.selectedAnnotationIds || [];
    // فاز ۵-مرحله ۳ (سناریو ۴): اگر نودِ کشیده‌شده در پایانِ
    // drag در انتخاب نیست (مثلاً با Shift+کلیک از انتخاب بیرون
    // رفته است)، drag لغو می‌شود: نود به جای اولش برمی‌گردد و
    // هیچ کامیتی ثبت نمی‌شود — نه حرکتِ تکی، نه حرکتِ گروهی.
    if (ids.length > 0 && !ids.includes(item.id)) {
      node.position({ x: 0, y: 0 });
      layerRef.current?.batchDraw();
      return;
    }
    const idsToMove = ids.includes(item.id) && ids.length > 0 ? ids : [item.id];
    // resetِ همهٔ نودهای درگیر، قبل از کامیت.
    for (const id of idsToMove) {
      const n = itemNodeRefs.current.get(id);
      if (n) n.position({ x: 0, y: 0 });
    }
    if (dx === 0 && dy === 0) {
      layerRef.current?.batchDraw();
      return;
    }
    const nextItems = uniformItems.map((it) =>
      idsToMove.includes(it.id) ? moveAnnotationByDelta(it, dx, dy) : it
    );
    commit(nextItems);
    layerRef.current?.batchDraw();
  }, [commit, uniformItems]);

  // فاز ۵: پایانِ تغییرِ اندازه با Transformer (تکی یا چندتایی).
  // این تابع هم از onTransformEndی Transformer و هم از
  // onTransformEndی Groupهای پوششی صدا زده می‌شود؛ محافظِ زمانیِ
  // ۱۰۰ میلی‌ثانیه جلوی کامیتِ مضاعف در همان ژست را می‌گیرد
  // (به کامنتِ transformCommittedAtRef مراجعه کنید).
  // برای هر نودِ متصل به Transformer: x/y/scale خوانده می‌شود،
  // آیتم با transformItemByNode به میدان‌های ابزاری ترجمه می‌شود،
  // و نود به position (0,0) و scale (1,1) برمی‌گردد — بعد از
  // خواندن، قبل از کامیت — تا رندرِ بعدی مقیاسِ مضاعف نگیرد.
  const handleTransformEnd = useCallback(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const now = Date.now();
    if (now - transformCommittedAtRef.current < 100) return;
    const nodes = tr.nodes();
    if (!nodes || nodes.length === 0) return;
    transformCommittedAtRef.current = now;
    const nodeSet = new Set(nodes);
    let changed = false;
    const nextItems = uniformItems.map((it) => {
      const node = itemNodeRefs.current.get(it.id);
      if (!node || !nodeSet.has(node)) return it;
      const nx = node.x();
      const ny = node.y();
      const sx = node.scaleX();
      const sy = node.scaleY();
      if (nx === 0 && ny === 0 && sx === 1 && sy === 1) return it;
      changed = true;
      return transformItemByNode(it, nx, ny, sx, sy);
    });
    // resetِ همهٔ نودهای ترنسفورم‌شده، قبل از کامیت.
    for (const node of nodes) {
      node.position({ x: 0, y: 0 });
      node.scale({ x: 1, y: 1 });
    }
    if (changed) commit(nextItems);
    layerRef.current?.batchDraw();
  }, [commit, uniformItems]);

  // فاز ۵: اتصالِ هوشمندِ نودها به Transformer.
  // وقتی انتخاب، آیتم‌ها، ابزار یا صفحه عوض می‌شود، نودهای متناظر
  // از itemNodeRefs پیدا و به transformer.nodes(...) وصل می‌شوند.
  // اگر ابزار select نیست، حاشیه‌نویسی غیرفعال است، یا انتخاب مالِ
  // صفحهٔ دیگری است، Transformer خالی می‌شود تا در صفحهٔ اشتباه
  // یا با ابزارِ رسم، دیده نشود.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;
    const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
    const pageOk = state.selectedAnnotationPage == null ||
      Number(state.selectedAnnotationPage) === Number(pageNumber);
    if (!isAnnotationActive || annotationTool !== 'select' || !pageOk) {
      tr.nodes([]);
      setSelectedNodes([]);
    } else {
      const ids = state.selectedAnnotationIds || [];
      const nodes = ids
        .map((id) => itemNodeRefs.current.get(id))
        .filter(Boolean);
      tr.nodes(nodes);
      setSelectedNodes(nodes);
    }
    layerRef.current?.batchDraw();
  }, [selectedAnnotationId, selectedAnnotationIds, uniformItems, annotationTool, isAnnotationActive, selectedAnnotationPage, pageNumber]);

  // فاز ۵: حذف با Delete / Backspace.
  // محافظ‌ها: (۱) اگر هدف، TEXTAREA یا INPUT بود، بازگشتِ فوری
  // تا Delete حینِ تایپ در ویرایشگرِ متن/استیکی، آیتم‌ها را پاک
  // نکند (ویرایشگرهای فاز ۴ خودشان stopPropagation دارند؛ این
  // محافظ، لایهٔ دومِ دفاع است)؛ (۲) فقط وقتی حاشیه‌نویسی فعال
  // است و ابزار select است و انتخاب مالِ همین صفحه است؛
  // (۳) حذف از مسیرِ commit() + clearSelection() بعد از حذف، تا
  // selectedAnnotationId به آیتمِ حذف‌شده اشاره نکند و دقیقاً یک
  // ورودیِ Undo ثبت شود.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = e.target?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
      if (!state.isAnnotationActive) return;
      if (state.annotationTool !== 'select') return;
      const ids = state.selectedAnnotationIds || [];
      if (ids.length === 0) return;
      if (state.selectedAnnotationPage != null &&
          Number(state.selectedAnnotationPage) !== Number(pageNumber)) {
        return;
      }
      e.preventDefault();
      const remaining = uniformItems.filter((it) => !ids.includes(it.id));
      if (remaining.length === uniformItems.length) return;
      // فاز ۵-مرحله ۳ (سناریو ۳): تخلیهٔ فوریِ Transformer، قبل از
      // کامیت. اگر فقط به clearSelection() و effectِ اتصال اکتفا
      // شود، بینِ حذفِ آیتم‌ها (unmountِ Groupها) و اجرای effect،
      // Transformer هنوز به نودهای جدا شده اشاره می‌کند و کادرِ
      // آبی‌اش روی فضای خالیِ بوم فریز می‌شود. با nodes([])ی
      // فوری + batchDraw، دستگیره‌ها همان لحظه محو می‌شوند.
      // توجه دربارهٔ Ctrl+Z: این اکشن دقیقاً یک ورودیِ Undo در
      // والد ثبت می‌کند (از مسیرِ commit) و با Ctrl+Z، شکل‌ها
      // برمی‌گردند؛ انتخابِ پاک‌شده به‌صورتِ خودکار برنمی‌گردد
      // (clearSelection عمداً بعد از حذف صدا زده می‌شود — رفتارِ
      // استانداردِ ویرایشگرها: حذف، انتخاب را پاک می‌کند و Undo،
      // محتوا را برمی‌گرداند، نه انتخاب را). کاربر با یک کلیک یا
      // مارکی، دوباره انتخاب می‌کند و Transformer از طریقِ effect
      // دوباره وصل می‌شود. بازگرداندنِ خودکارِ انتخاب با Undo،
      // نیاز به تغییرِ پشتهٔ Undoی والد دارد و خارج از سه فایلِ
      // این فاز است.
      if (transformerRef.current) {
        transformerRef.current.nodes([]);
        setSelectedNodes([]);
      }
      commit(remaining);
      if (typeof state.clearSelection === 'function') state.clearSelection();
      layerRef.current?.batchDraw();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commit, uniformItems, pageNumber]);

  // فاز ۴: باز کردنِ ویرایشگرِ متن برای آیتمِ موجود (دوبارکلیک).
  // فونت/رنگ/شفافیت از خودِ آیتم می‌آید، نه از استورِ فعلی، تا
  // ویرایش، ویژگی‌های قبلیِ متن را حفظ کند.
  const openTextEditorForItem = useCallback((item) => {
    if (!isAnnotationActive || toolRef.current === 'eraser') return;
    setTextEditor({
      x: Number(item.x ?? item.startX ?? 0),
      y: Number(item.y ?? item.startY ?? 0),
      value: item.text || '',
      editId: item.id,
      fontSize: Number(item.fontSize) || 22,
      fontFamily: item.fontFamily || "'Estedad', sans-serif",
      color: item.color || '#22d3ee',
      opacity: item.opacity ?? 0.9,
    });
  }, [isAnnotationActive]);

  // فاز ۴: باز کردنِ ویرایشگرِ استیکی (دوبارکلیک روی کارت).
  const openStickyEditor = useCallback((id) => {
    if (!isAnnotationActive || toolRef.current === 'eraser') return;
    setActiveStickyEditorId(id);
  }, [isAnnotationActive]);

  // فاز ۴: اگر حالتِ حاشیه‌نویسی خاموش شد، ویرایشگرهای باز بسته
  // شوند تا textarea روی صفحهٔ بدونِ حاشیه‌نویسی نماند.
  useEffect(() => {
    if (!isAnnotationActive) {
      textEditorRef.current = null;
      activeStickyEditorRef.current = null;
      setTextEditor(null);
      setActiveStickyEditorId(null);
    }
  }, [isAnnotationActive]);

  // فاز ۱-مرحله ۳: پاک‌سازی متمرکز پیش‌نویس (هم برای سینک موفق، هم تایمر ایمنی)
  const forceClearDraft = useCallback(() => {
    pendingCommitRef.current = null;
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    draftPointsRef.current = [];
    draftStyleRef.current = null;
    lastRawPointRef.current = null;
    // فاز ۲: پاک‌سازی پیش‌نویس باکس
    draftBoxRef.current = null;
    if (draftBoxShapeRef.current) {
      draftBoxShapeRef.current.visible(false);
    }
    // فاز ۳: پاک‌سازی پیش‌نویس فلش
    draftArrowRef.current = null;
    if (draftArrowShapeRef.current) {
      draftArrowShapeRef.current.visible(false);
    }
    if (draftShapeRef.current) {
      draftShapeRef.current.visible(false);
      draftShapeRef.current.getLayer()?.batchDraw();
    } else {
      layerRef.current?.batchDraw();
    }
  }, []);

  // --- فیکس #۳: مخفی کردن پیش‌نویس فقط بعد از سینک props ---
  useEffect(() => {
    const pendingId = pendingCommitRef.current;
    if (!pendingId) return;

    const found = uniformItems.some((item) => item.id === pendingId);
    if (found) {
      // والد استروک رو رندر کرده — حالا امنـه که پیش‌نویس پاک بشه
      forceClearDraft();
    }
  }, [uniformItems, forceClearDraft]);

  // فاز ۱-مرحله ۳: پاک‌سازی تایمر در unmount
  useEffect(() => {
    return () => {
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }
    };
  }, []);

  const draftSceneFunc = useCallback((ctx) => {
    const pts = draftPointsRef.current;
    const style = draftStyleRef.current;
    if (!pts || pts.length === 0 || !style) return;
    drawSmoothStroke(ctx, pts, style);
  }, []);

  const extractPoints = useCallback((nativeEvent) => {
    const stage = stageRef.current;
    if (!stage || !nativeEvent) return [];
    const { scaleX: sx, scaleY: sy } = scaleRef.current;

    const coalesced = (nativeEvent.getCoalescedEvents && typeof nativeEvent.getCoalescedEvents === 'function')
      ? nativeEvent.getCoalescedEvents()
      : [];
    const events = coalesced.length > 0 ? coalesced : [nativeEvent];

    const out = [];
    const content = stage.content;
    const rect = content ? content.getBoundingClientRect() : null;

    for (const ce of events) {
      if (!ce) continue;
      let px, py;
      if (rect && ce.clientX !== undefined) {
        px = ce.clientX - rect.left;
        py = ce.clientY - rect.top;
      } else {
        const pos = stage.getPointerPosition();
        if (!pos) continue;
        px = pos.x;
        py = pos.y;
      }
      out.push({
        x: px / sx,
        y: py / sy,
        time: ce.timeStamp || performance.now(),
      });
    }
    return out;
  }, []);

  const getNative = useCallback((e) => e?.evt || e?.nativeEvent || e, []);

  // --- فیکس #۲: capture روی المان فعال ---
  const capturePointer = useCallback((nativeEvent) => {
    try {
      const target = nativeEvent?.target || stageRef.current?.content;
      if (target?.setPointerCapture && nativeEvent?.pointerId !== undefined) {
        target.setPointerCapture(nativeEvent.pointerId);
      }
    } catch {
      // امن: ادامه بدون capture
    }
  }, []);

  const releasePointer = useCallback((nativeEvent) => {
    try {
      const target = nativeEvent?.target || stageRef.current?.content;
      if (
        target?.releasePointerCapture &&
        target?.hasPointerCapture?.(nativeEvent?.pointerId)
      ) {
        target.releasePointerCapture(nativeEvent.pointerId);
      }
    } catch {
      // نادیده بگیر
    }
  }, []);

  // --- فیکس #۱: محافظ اجرای مضاعف در یک فریم ---
  const shouldProcessEvent = useCallback((nativeEvent) => {
    const t = nativeEvent?.timeStamp || 0;
    // اگه همین ایونت (یا هم‌زمان) قبلاً پردازش شده، رد کن
    if (t !== 0 && t === lastEventTimeRef.current) return false;
    lastEventTimeRef.current = t;
    return true;
  }, []);

  const pushFilteredPoints = useCallback((pts) => {
    let added = false;
    const buf = draftPointsRef.current;
    const minDistSq = MIN_POINT_DIST * MIN_POINT_DIST;

    for (const pt of pts) {
      // فیکس #۴: همیشه آخرین نقطه خام رو نگه دار (برای دقت نقطه پایانی)
      lastRawPointRef.current = { x: pt.x, y: pt.y };

      const prev = buf[buf.length - 1];
      if (prev) {
        if (dist2(pt.x, pt.y, prev.x, prev.y) < minDistSq) continue;
        const smoothed = streamline(prev, pt);
        buf.push({ x: smoothed.x, y: smoothed.y, time: pt.time });
      } else {
        buf.push({ x: pt.x, y: pt.y, time: pt.time });
      }
      added = true;
      if (buf.length > 2000) buf.shift();
    }
    return added;
  }, []);

  // --- رسم مستقیم پیش‌نویس (فیکس #۵: بدون RAF، مستقیم batchDraw) ---
  const redrawDraft = useCallback(() => {
    const node = draftShapeRef.current;
    if (node) {
      // sceneFunc از draftPointsRef می‌خونه — فقط redraw
      node.getLayer()?.batchDraw();
    }
  }, []);

  const handleDown = useCallback((e) => {
    if (!isAnnotationActive) return;
    // فاز ۴: وقتی ویرایشگری باز است، کلیک روی استیج نادیده گرفته
    // می‌شود تا نه استروکِ قلم ساخته شود، نه ویرایشگرِ جدید؛ ثبتِ
    // متنِ باز، با Blurِ textarea (که قبل از این هندلر رخ می‌دهد)
    // یا با Enter/دکمهٔ ثبت انجام می‌شود، نه با این کلیک.
    if (textEditorRef.current || activeStickyEditorRef.current) return;
    const native = getNative(e);
    if (!shouldProcessEvent(native)) return; // فیکس #۱
    // فاز ۵: capture فقط برای ابزارهای غیرِ select انجام می‌شود،
    // چون capture روی stage.content می‌تواند dragِ نودهای Konva
    // را مختل کند؛ برای select، drag با نودها و مارکی/جابه‌جاییِ
    // دستی با pointermove/upی خودِ Stage مدیریت می‌شود.
    if (toolRef.current !== 'select') capturePointer(native);

    const pts = extractPoints(native);
    if (pts.length === 0) return;

    // فاز ۵: ابزارِ انتخاب — مهم‌ترین شاخهٔ جدید.
    // این شاخه قبل از باکس/فلش/قلم می‌آید، چون بدونِ آن، کلیک با
    // ابزارِ select به شاخهٔ else (قلم) می‌افتاد و استروک می‌کشید.
    // توجه: برای ابزارِ select، capturePointer صدا زده نشده است
    // (به محافظِ capture در بالای همین تابع مراجعه کنید).
    // در این شاخه، isDrawingRef تنظیم نمی‌شود تا handleUp، منطقِ
    // رسم را اجرا نکند؛ مارکی و جابه‌جاییِ دستی، با refهای خودشان
    // در handleMove/Up مدیریت می‌شوند، و dragِ نودهای Konva با
    // onDragMove/onDragEndی Groupهای پوششی.
    if (toolRef.current === 'select') {
      const pt = pts[0];
      const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
      const setSelectedAnnotation = state.setSelectedAnnotation;
      const setSelectedAnnotations = state.setSelectedAnnotations;
      const toggleSelectedAnnotation = state.toggleSelectedAnnotation;
      const clearSelection = state.clearSelection;
      const syncToolbar = state.syncToolbarWithSelectedItem;
      const currentIds = state.selectedAnnotationIds || [];
      const hit = findTopAnnotationAtPoint(uniformItems, pt);
      const isShift = Boolean(native.shiftKey);

      if (hit) {
        if (isShift) {
          // Shift+کلیک: تاگل، بدونِ sync (مثلِ الگوی قدیمی).
          if (typeof toggleSelectedAnnotation === 'function') {
            toggleSelectedAnnotation(hit.id, pageNumber, hit.tool);
          }
        } else if (!currentIds.includes(hit.id)) {
          // کلیکِ تکی روی آیتمِ جدید: انتخابِ تکی + همگام‌سازیِ
          // فوریِ تولبار با ویژگی‌های آیتم.
          if (typeof setSelectedAnnotation === 'function') {
            setSelectedAnnotation(hit.id, pageNumber, hit.tool);
          }
          if (typeof syncToolbar === 'function') syncToolbar(hit);
        }
        // اگر آیتم از قبل انتخاب‌شده بود (بدونِ Shift)، انتخاب
        // دست نخورده می‌ماند تا dragِ گروهی با Konva (روی همان
        // نود) یا با جابه‌جاییِ دستی، گروه را حرکت دهد؛ sync هم
        // دوباره انجام نمی‌شود تا تولبارِ چندانتخابی به‌هم نریزد.
        return;
      }

      // کلیک روی فضای خالی:
      if (isShift) {
        // Shift+کلیک روی خالی: نگه داشتنِ انتخابِ فعلی (الگوی قدیمی).
        return;
      }
      // اگر کلیک داخلِ کادرِ اجتماعِ انتخابِ فعلی بود، مارکی
      // شروع نمی‌شود؛ در عوض، جابه‌جاییِ دستیِ گروهی آماده
      // می‌شود تا کاربر بتواند گروه را از فضای خالیِ داخلِ کادر
      // هم بکشد (الگوی tldraw در لایهٔ قدیمی).
      const selectedItems = uniformItems.filter((it) => currentIds.includes(it.id));
      if (selectedItems.length > 0) {
        const ub = getUnionBounds(selectedItems);
        if (ub && pt.x >= ub.x - 10 && pt.x <= ub.x + ub.width + 10 &&
            pt.y >= ub.y - 10 && pt.y <= ub.y + ub.height + 10) {
          const originals = new Map(selectedItems.map((it) => [it.id, it]));
          manualMoveRef.current = { startPt: pt, lastPt: pt, originals };
          return;
        }
      }
      // در غیر این صورت: شروعِ مارکیِ موقت.
      isMarqueeRef.current = { startPt: pt };
      setMarqueeBox({ x: pt.x, y: pt.y, width: 0, height: 0 });
      return;
    }

    // فاز ۴: کلیک با ابزار متن — باز شدنِ ویرایشگر، بدونِ رسمِ قلم.
    // مختصاتِ یکنواختِ کلیک (pt.x, pt.y) مستقیم به ویرایشگر می‌رسد
    // و فونت/رنگ/شفافیت از رفرنس‌های استور در لحظهٔ کلیک خوانده
    // می‌شوند تا تغییرِ تولبار در حینِ باز بودنِ ویرایشگر، متنِ
    // در حالِ تایپ را عوض نکند.
    if (toolRef.current === 'text') {
      const p0 = pts[0];
      setTextEditor({
        x: p0.x,
        y: p0.y,
        value: '',
        editId: null,
        fontSize: fontSizeRef.current,
        fontFamily: fontFamilyRef.current,
        color: colorRef.current,
        opacity: opacityRef.current,
      });
      return;
    }

    // فاز ۴: کلیک با ابزار استیکی — ساختِ فوریِ آیتم و باز شدنِ
    // ویرایشگرِ آن برای تایپِ فوری. ابعادِ پیش‌فرض دقیقاً طبق
    // مشخصاتِ TASK: ۲۱۰ در ۱۷۰، با گوشهٔ بالا-چپ روی نقطهٔ کلیک
    // (بدونِ آفستِ قدیمیِ -90/-40 و بدونِ clampِ قدیمیِ 20 تا 760).
    if (toolRef.current === 'sticky') {
      const p0 = pts[0];
      const newSticky = {
        id: uid('sticky'),
        tool: 'sticky',
        x: Math.round(p0.x),
        y: Math.round(p0.y),
        width: 210,
        height: 170,
        text: '',
        color: colorRef.current,
        opacity: opacityRef.current,
      };
      commit([...uniformItems, newSticky]);
      setActiveStickyEditorId(newSticky.id);
      return;
    }

    // فاز ۲: شروع رسم باکس — ثبت نقطه شروع
    if (toolRef.current === 'box') {
      const p0 = pts[0];
      draftBoxRef.current = {
        startX: p0.x,
        startY: p0.y,
        currentX: p0.x,
        currentY: p0.y,
      };
      isDrawingRef.current = true;
      // ریست pending قبلی
      pendingCommitRef.current = null;
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }
      // نمایش پیش‌نویس
      if (draftBoxShapeRef.current) {
        draftBoxShapeRef.current.visible(true);
      }
      layerRef.current?.batchDraw();
      return;
    }

    // فاز ۳: شروع رسم فلش — ثبت نقطه شروع (دقیقاً طبق مشخصات TASK:
    // cx/cy اولیه همان نقطه شروع است؛ کنترلِ منحنی در handleMove
    // به‌صورت پویا محاسبه می‌شود، نه اینجا).
    if (toolRef.current === 'arrow') {
      const p0 = pts[0];
      draftArrowRef.current = {
        startX: p0.x,
        startY: p0.y,
        currentX: p0.x,
        currentY: p0.y,
        cx: p0.x,
        cy: p0.y,
      };
      isDrawingRef.current = true;
      // ریست pending قبلی (مثل باکس)
      pendingCommitRef.current = null;
      if (pendingTimeoutRef.current) {
        clearTimeout(pendingTimeoutRef.current);
        pendingTimeoutRef.current = null;
      }
      // نمایش پیش‌نویس
      if (draftArrowShapeRef.current) {
        draftArrowShapeRef.current.visible(true);
      }
      layerRef.current?.batchDraw();
      return;
    }

    if (toolRef.current === 'eraser') {
      eraserPtsRef.current = pts;
      isDrawingRef.current = true;
      setEraserVisible(true);
      return;
    }

    draftPointsRef.current = [];
    lastRawPointRef.current = null;
    // فاز ۱-مرحله ۳: ریست کامل حالت pending — استروک قبلی دیگر در حال انتظار نیست
    // (اگر والد هنوز سینک نکرده بود، تایمر ایمنی آن را مدیریت می‌کند)
    pendingCommitRef.current = null;
    if (pendingTimeoutRef.current) {
      clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = null;
    }
    pushFilteredPoints(pts);

    const tool = toolRef.current === 'highlighter' ? 'highlighter' : 'pen';
    draftStyleRef.current = {
      color: colorRef.current,
      width: getStrokeWidth(tool, widthRef.current),
      opacity: getStrokeOpacity(tool, opacityRef.current),
      compositeOp: getCompositeOp(tool),
    };

    isDrawingRef.current = true;

    const node = draftShapeRef.current;
    if (node) {
      node.visible(true);
      redrawDraft(); // فیکس #۵: مستقیم، بدون RAF
    }
  // فاز ۴: commit و uniformItems به وابستگی‌ها اضافه شدند، چون شاخهٔ
  // استیکی در handleDown مستقیم کامیت می‌کند؛ بدونِ آن‌ها، closure
  // قدیمی می‌ماند و ساختِ استیکیِ دوم، آیتم‌های قبلی را از دست می‌داد.
  // شاخه‌های باکس/فلش در handleDown کامیت نمی‌کنند، پس این اضافه
  // روی رفتارِ آن‌ها اثری ندارد.
  }, [isAnnotationActive, getNative, shouldProcessEvent, capturePointer, extractPoints, pushFilteredPoints, redrawDraft, commit, uniformItems, pageNumber]);

  const handleMove = useCallback((e) => {
    // فاز ۵: مارکی و جابه‌جاییِ دستیِ گروهی، قبل از محافظِ
    // isDrawingRef بررسی می‌شوند، چون handleDownی select،
    // isDrawingRef را تنظیم نمی‌کند (عمداً) — اگر این شاخه‌ها بعد
    // از محافظِ isDrawing می‌آمدند، هیچ‌وقت اجرا نمی‌شدند.
    if (isAnnotationActive) {
      const nativeForSelect = getNative(e);
      const ptsForSelect = nativeForSelect ? extractPoints(nativeForSelect) : [];
      if (ptsForSelect.length > 0) {
        const cur = ptsForSelect[ptsForSelect.length - 1];
        if (isMarqueeRef.current) {
          setMarqueeBox(marqueeRect(isMarqueeRef.current.startPt, cur));
          return;
        }
        if (manualMoveRef.current) {
          const mm = manualMoveRef.current;
          mm.lastPt = cur;
          const dx = cur.x - mm.startPt.x;
          const dy = cur.y - mm.startPt.y;
          // پیش‌نمایشِ زنده با موقعیتِ نودها (نه با تغییرِ آیتم‌ها):
          // آیتم‌ها فقط در handleUp کامیت می‌شوند، پس در حینِ
          // حرکت، هیچ ورودیِ Undo ساخته نمی‌شود.
          for (const id of mm.originals.keys()) {
            const node = itemNodeRefs.current.get(id);
            if (node) node.position({ x: dx, y: dy });
          }
          layerRef.current?.batchDraw();
          return;
        }
      }
    }
    if (!isDrawingRef.current || !isAnnotationActive) return;
    const native = getNative(e);
    // برای move، محافظ زمانی رو شل‌تر می‌گیریم (ایونت‌های پشت سر هم طبیعیه)
    // فقط اگه دقیقاً همون timeStamp بود رد می‌کنیم
    const t = native?.timeStamp || 0;
    if (t !== 0 && t === lastEventTimeRef.current) return;

    const pts = extractPoints(native);
    if (pts.length === 0) return;

    // فاز ۲: به‌روزرسانی پیش‌نویس باکس
    if (toolRef.current === 'box' && draftBoxRef.current) {
      const last = pts[pts.length - 1];
      draftBoxRef.current.currentX = last.x;
      draftBoxRef.current.currentY = last.y;
      // رندر فوری پیش‌نویس
      if (draftBoxShapeRef.current) {
        draftBoxShapeRef.current.visible(true);
      }
      layerRef.current?.batchDraw();
      return;
    }

    // فاز ۳: به‌روزرسانی پیش‌نویس فلش — نقطه جاری + کنترل پویا
    if (toolRef.current === 'arrow' && draftArrowRef.current) {
      const last = pts[pts.length - 1];
      const db = draftArrowRef.current;
      db.currentX = last.x;
      db.currentY = last.y;
      // اگر استایل منحنی است، نقطه کنترل به‌صورت پویا از روی
      // شروع و انتهای فعلی محاسبه می‌شود (نه قفل‌شده در handleDown)
      if (arrowStyleRef.current === 'curved') {
        const ctrl = defaultCurveControl(db.startX, db.startY, db.currentX, db.currentY);
        db.cx = ctrl.cx;
        db.cy = ctrl.cy;
      }
      // رندر فوری پیش‌نویس
      if (draftArrowShapeRef.current) {
        draftArrowShapeRef.current.visible(true);
      }
      layerRef.current?.batchDraw();
      return;
    }

    if (toolRef.current === 'eraser') {
      for (const pt of pts) {
        const prev = eraserPtsRef.current[eraserPtsRef.current.length - 1];
        if (prev && dist2(pt.x, pt.y, prev.x, prev.y) < 4) continue;
        eraserPtsRef.current.push(pt);
      }
      if (eraserLineRef.current) {
        const epts = eraserPtsRef.current;
        if (epts.length > 1) {
          eraserLineRef.current.setAttr('points', epts.flatMap((p) => [p.x, p.y]));
          eraserLineRef.current.getLayer()?.batchDraw();
        }
      }
      return;
    }

    if (pushFilteredPoints(pts)) {
      redrawDraft(); // فیکس #۵: مستقیم batchDraw، تأخیر صفر
    }
  }, [isAnnotationActive, getNative, extractPoints, pushFilteredPoints, redrawDraft]);

  const handleUp = useCallback((e) => {
    // فاز ۵: مارکی و جابه‌جاییِ دستی، قبل از محافظِ isDrawingRef
    // بررسی می‌شوند (دلیلش در handleMove نوشته شده است).
    if (isMarqueeRef.current || manualMoveRef.current) {
      const nativeSel = getNative(e);
      const ptsSel = nativeSel ? extractPoints(nativeSel) : [];
      const curPt = ptsSel.length > 0 ? ptsSel[ptsSel.length - 1] : null;

      if (isMarqueeRef.current) {
        const startPt = isMarqueeRef.current.startPt;
        isMarqueeRef.current = null;
        const box = curPt ? marqueeRect(startPt, curPt) : marqueeBox;
        setMarqueeBox(null);
        // آستانهٔ میکروکلیک (الگوی قدیمی): مارکیِ کوچک‌تر از
        // ۶×۶، انتخاب را پاک می‌کند (نه اینکه آیتمی را انتخاب کند).
        if (!box || box.width < 6 || box.height < 6) {
          const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
          if (typeof state.clearSelection === 'function') state.clearSelection();
        } else {
          const matching = uniformItems.filter((it) =>
            rectsIntersect(getItemBounds(it), box)
          );
          const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
          if (matching.length > 0) {
            if (typeof state.setSelectedAnnotations === 'function') {
              state.setSelectedAnnotations(matching.map((it) => it.id), pageNumber);
            }
            // همگام‌سازیِ تولبار با آخرین آیتمِ برخوردی (الگوی
            // قدیمی)، تا تغییرِ رنگ/ضخامت/فونت بعد از مارکی، روی
            // همان آیتم اعمال شود.
            if (typeof state.syncToolbarWithSelectedItem === 'function') {
              state.syncToolbarWithSelectedItem(matching[matching.length - 1]);
            }
          } else if (typeof state.clearSelection === 'function') {
            state.clearSelection();
          }
        }
        layerRef.current?.batchDraw();
        return;
      }

      if (manualMoveRef.current) {
        const mm = manualMoveRef.current;
        manualMoveRef.current = null;
        const endPt = curPt || mm.lastPt || mm.startPt;
        const dx = endPt.x - mm.startPt.x;
        const dy = endPt.y - mm.startPt.y;
        // resetِ نودها، قبل از کامیت (دلیلش در handleItemDragEnd).
        for (const id of mm.originals.keys()) {
          const node = itemNodeRefs.current.get(id);
          if (node) node.position({ x: 0, y: 0 });
        }
        if (dx !== 0 || dy !== 0) {
          const nextItems = uniformItems.map((it) => {
            const orig = mm.originals.get(it.id);
            return orig ? moveAnnotationByDelta(orig, dx, dy) : it;
          });
          commit(nextItems);
        }
        layerRef.current?.batchDraw();
        return;
      }
    }

    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;

    const native = getNative(e);
    releasePointer(native);

    // فاز ۲: نهایی‌سازی باکس
    if (toolRef.current === 'box' && draftBoxRef.current) {
      const db = draftBoxRef.current;
      draftBoxRef.current = null;
      if (draftBoxShapeRef.current) {
        draftBoxShapeRef.current.visible(false);
      }

      // محاسبه مستطیل نرمالایز شده
      const x = Math.min(db.startX, db.currentX);
      const y = Math.min(db.startY, db.currentY);
      const width = Math.abs(db.currentX - db.startX);
      const height = Math.abs(db.currentY - db.startY);

      // محافظ کلیک تصادفی: باکس خیلی کوچک ساخته نمی‌شود
      if (width < 5 || height < 5) {
        // فاز ۲-مرحله ۳ (سناریو ۳): draftBoxRef بالا null شد و نود مخفی
        // شد، ولی بدون batchDraw، فریم آخر پیش‌نمایش روی بوم می‌ماند
        // (شبح). قبلاً این batchDraw با layerRef تعریف‌نشده اصلاً اجرا
        // نمی‌شد. حالا هم از خود نود پیش‌نویس و هم از لایه redraw
        // می‌گیریم تا پاک‌سازی به یک رفرنس وابسته نباشد؛ هیچ کامیت و
        // هیچ ورودی Undo هم ثبت نمی‌شود.
        isDrawingRef.current = false;
        draftBoxShapeRef.current?.getLayer()?.batchDraw();
        layerRef.current?.batchDraw();
        return;
      }

      const newId = uid('box');
      const newBox = {
        id: newId,
        tool: 'box',
        boxStyle: boxStyleRef.current || 'cloud',
        hasFill: hasFillRef.current ?? true,
        color: colorRef.current,
        strokeWidth: widthRef.current,
        opacity: opacityRef.current,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2)),
      };

      // ضدچشمک: همان الگوی فاز ۱
      pendingCommitRef.current = newId;
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = setTimeout(() => {
        if (pendingCommitRef.current) {
          forceClearDraft();
        }
        pendingTimeoutRef.current = null;
      }, 200);

      const current = uniformItems;
      // تبدیل به Storage قبل از کامیت
      const storageBox = uniformToStorage(newBox, aspectRef.current);
      const storageList = [...(Array.isArray(items) ? items : []), storageBox];
      // توجه: uniformItems از items مشتق شده، پس باید مستقیم از items استفاده کنیم
      commitFnRef.current?.(pageRef.current, storageList);

      isDrawingRef.current = false;
      return;
    }

    // فاز ۳: نهایی‌سازی فلش
    if (toolRef.current === 'arrow' && draftArrowRef.current) {
      const db = draftArrowRef.current;
      draftArrowRef.current = null;
      if (draftArrowShapeRef.current) {
        draftArrowShapeRef.current.visible(false);
      }

      const startX = db.startX;
      const startY = db.startY;
      const currentX = db.currentX;
      const currentY = db.currentY;

      // محافظ حداقل طول: فلش کوتاه‌تر از ۸ پیکسل ساخته نمی‌شود
      if (Math.hypot(currentX - startX, currentY - startY) < 8) {
        isDrawingRef.current = false;
        draftArrowShapeRef.current?.getLayer()?.batchDraw();
        layerRef.current?.batchDraw();
        return;
      }

      // استایل از استور در لحظه نهایی‌شدن (طبق مشخصات TASK)؛
      // arrowStyleRef هم همان مقدار را دارد و به‌عنوان fallback استفاده
      // می‌شود تا اگر getState در دسترس نبود، رفتار عوض نشود.
      const storeArrowStyle = typeof useAppStore.getState === 'function'
        ? useAppStore.getState().annotationArrowStyle
        : arrowStyleRef.current;
      const isCurved = (storeArrowStyle || arrowStyleRef.current || 'straight') === 'curved';
      const ctrl = isCurved
        ? defaultCurveControl(startX, startY, currentX, currentY)
        : null;
      const newId = uid('arrow');
      const newArrow = {
        id: newId,
        tool: 'arrow',
        arrowStyle: isCurved ? 'curved' : 'straight',
        startX: Math.round(startX * 100) / 100,
        startY: Math.round(startY * 100) / 100,
        endX: Math.round(currentX * 100) / 100,
        endY: Math.round(currentY * 100) / 100,
        ...(isCurved && ctrl ? { cx: ctrl.cx, cy: ctrl.cy } : {}),
        color: colorRef.current,
        strokeWidth: widthRef.current,
        opacity: opacityRef.current,
      };

      // ضدچشمک: همان الگوی فاز ۱/۲ (باکس و قلم)
      pendingCommitRef.current = newId;
      if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
      pendingTimeoutRef.current = setTimeout(() => {
        if (pendingCommitRef.current) {
          forceClearDraft();
        }
        pendingTimeoutRef.current = null;
      }, 200);

      // تبدیل به Storage قبل از کامیت (مثل باکس: مستقیم از items)
      const storageArrow = uniformToStorage(newArrow, aspectRef.current);
      const storageList = [...(Array.isArray(items) ? items : []), storageArrow];
      commitFnRef.current?.(pageRef.current, storageList);

      isDrawingRef.current = false;
      return;
    }

    if (toolRef.current === 'eraser') {
      const epts = eraserPtsRef.current;
      eraserPtsRef.current = [];
      setEraserVisible(false);
      if (eraserLineRef.current) {
        eraserLineRef.current.setAttr('points', []);
        eraserLineRef.current.getLayer()?.batchDraw();
      }
      if (epts.length > 0) {
        const current = uniformItems;
        // فاز ۳: رفع بلوکر بحرانی پاک‌کن — تفکیک بر اساس tool.
        // قبلاً هر آیتمِ غیرباکس (از جمله فلش) به eraserHitsStroke
        // با it.points فرستاده می‌شد و چون فلش points ندارد، روی
        // undefined.length خطا می‌داد و کل عملیات پاک‌کن می‌شکست.
        // حالا: باکس → eraserHitsBox، فلش → eraserHitsArrow،
        // استروک → eraserHitsStroke با همان امضای ۴ آرگومانیِ قبلی
        // (تا بهینه‌سازی BBox حفظ شود؛ نسخهٔ ۳ آرگومانیِ خلاصه‌شده
        // در صورت TASK، BBox را به‌عنوان radius می‌خواند و اشتباه است).
        // آیتم‌های بدون points (متن/استیکیِ آینده) نگه داشته می‌شوند.
        const remaining = current.filter((it) => {
          if (it.tool === 'box') {
            return !eraserHitsBox(epts, it, 14);
          }
          if (it.tool === 'arrow') {
            return !eraserHitsArrow(epts, it, 14);
          }
          // فاز ۴: متن و استیکی — قبلاً در این فیلتر نگه داشته
          // می‌شدند (return true) و پاک‌کنِ درگی آن‌ها را پاک نمی‌کرد.
          if (it.tool === 'text') {
            return !eraserHitsText(epts, it, 14);
          }
          if (it.tool === 'sticky') {
            return !eraserHitsSticky(epts, it, 14);
          }
          if (Array.isArray(it.points)) {
            return !eraserHitsStroke(epts, it.points, it._bbox, 14);
          }
          return true;
        });
        if (remaining.length !== current.length) commit(remaining);
      }
      return;
    }

    // فیکس #۴: آخرین نقطه خام (بدون استریم‌لاین) رو اضافه کن
    // تا خط دقیقاً جایی تموم بشه که کاربر دستش رو برداشته
    const buf = draftPointsRef.current;
    const lastRaw = lastRawPointRef.current;
    if (lastRaw && buf.length > 0) {
      const lastFiltered = buf[buf.length - 1];
      const d2 = dist2(lastRaw.x, lastRaw.y, lastFiltered.x, lastFiltered.y);
      if (d2 > 0.01) { // اگه فرق داره، اضافه کن
        buf.push({ x: lastRaw.x, y: lastRaw.y, time: performance.now() });
      }
    }

    const pts = [...buf]; // کپی برای کامیت

    if (pts.length === 0) return;

    const tool = toolRef.current === 'highlighter' ? 'highlighter' : 'pen';
    const newId = uid(tool === 'highlighter' ? 'hl' : 'pen');
    const newItem = {
      id: newId,
      tool,
      color: colorRef.current,
      strokeWidth: widthRef.current,
      opacity: tool === 'highlighter' ? 0.35 : opacityRef.current,
      points: pts.map((p) => ({ x: p.x, y: p.y })),
    };

    // فیکس #۳: پیش‌نویس رو مخفی نکن! تا سینک شدن props صبر کن
    pendingCommitRef.current = newId;
    // فاز ۱-مرحله ۳: تایمر ایمنی ۲۰۰ms — اگر والد پاسخ نداد، پیش‌نویس فریز نماند
    if (pendingTimeoutRef.current) clearTimeout(pendingTimeoutRef.current);
    pendingTimeoutRef.current = setTimeout(() => {
      if (pendingCommitRef.current) {
        forceClearDraft();
      }
      pendingTimeoutRef.current = null;
    }, 200);

    const current = uniformItems;
    commit([...current, newItem]);
    // توجه: پاک‌سازی draftPoints در useEffect بعد از سینک انجام می‌شه
  }, [commit, getNative, releasePointer, uniformItems, marqueeBox]);

  const handleEraseClick = useCallback((id) => {
    if (toolRef.current !== 'eraser') return;
    const remaining = uniformItems.filter((it) => it.id !== id);
    if (remaining.length !== uniformItems.length) commit(remaining);
  }, [commit, uniformItems]);

  // فاز ۱: شنونده‌های fallback — فقط اگر والد onUndo/onRedo نداده باشد
  // هیچ آرایه تاریخچه موازی نگه داشته نمی‌شود؛ Undo/Redo اصلی در والد است.
  // این شنونده‌ها فقط برای سازگاری با تولبار قدیمی (حالت fallback) هستند.
  useEffect(() => {
    const onUndoFallback = () => {
      // بدون تاریخچه داخلی، لایه نمی‌تواند Undo را خودش انجام دهد.
      // والد (PdfViewer) مالک تاریخچه است و از طریق props آن را مدیریت می‌کند.
      // این رویداد فقط زمانی به اینجا می‌رسد که تولبار در حالت fallback باشد.
      if (process.env.NODE_ENV === 'development') {
        console.warn('[AnnotationLayer] annotation:undo دریافت شد ولی تاریخچه در والد است.');
      }
    };
    const onRedoFallback = () => {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[AnnotationLayer] annotation:redo دریافت شد ولی تاریخچه در والد است.');
      }
    };
    const onClearFallback = () => {
      // پاک‌سازی از طریق مسیر استاندارد کامیت — والد آن را در تاریخچه ثبت می‌کند
      if (itemsRef.current.filter(Boolean).length === 0) return;
      commit([]);
    };
    window.addEventListener('annotation:undo', onUndoFallback);
    window.addEventListener('annotation:redo', onRedoFallback);
    window.addEventListener('annotation:clear', onClearFallback);
    return () => {
      window.removeEventListener('annotation:undo', onUndoFallback);
      window.removeEventListener('annotation:redo', onRedoFallback);
      window.removeEventListener('annotation:clear', onClearFallback);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // فاز ۲-مرحله ۳ (سناریو ۵): اعمال زنده روی آیتم انتخاب‌شده.
  // فاز ۵-مرحله ۳ (سناریو ۱): شنوندهٔ update-selected، چندانتخابی شد.
  // مشکلِ قبلی: شنونده فقط یک هدف را به‌روز می‌کرد
  // (detail.id || selectedAnnotationId) و اگر patch حاویِ فیلدِ
  // مختصِ ابزارِ دیگری بود، کلِ patch را رد می‌کرد (return) — پس
  // با مارکیِ چندتایی، تغییرِ رنگ/ضخامت/فونت فقط روی آیتمِ اصلی
  // (selectedAnnotationId = آخرین آیتم) اعمال می‌شد، نه روی همه.
  // رفتارِ جدید:
  // - اگر detail.id داده شده و در انتخابِ فعلی نیست → تک‌هدفه
  //   (رفتارِ قدیمی، برای رویدادهای برنامه‌ای با idی صریح).
  // - اگر detail.id در انتخاب هست، یا id داده نشده → همهٔ
  //   selectedAnnotationIds هدف‌اند. idی تولبار در این حالت فقط
  //   نشانهٔ «انتخابی وجود دارد» است، نه محدودکنندهٔ تک‌هدفه.
  // - هر آیتم، فقط فیلدهای سازگار با ابزارِ خودش را می‌گیرد
  //   (boxStyle/hasFill فقط باکس، arrowStyle فقط فلش،
  //   fontFamily/fontSize فقط متن؛ color/strokeWidth/opacity
  //   برای همه). برای فلشِ منحنیِ بدونِ cx/cy، نقطهٔ کنترلِ
  //   پیش‌فرض برای هر آیتم جداگانه ساخته می‌شود (قبلاً فقط برای
  //   هدفِ تکی ساخته می‌شد).
  // - همهٔ تغییرات در قالبِ یک کامیتِ واحد ذخیره می‌شوند تا با یک
  //   بار Ctrl+Z، کلِ تغییرِ گروهی برگردد. اگر هیچ آیتمی واقعاً
  //   عوض نشد، هیچ ورودیِ Undo ثبت نمی‌شود.
  useEffect(() => {
    const onUpdateSelected = (e) => {
      const detail = e?.detail;
      if (!detail || typeof detail !== 'object') return;
      const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
      const selectedPage = state.selectedAnnotationPage;
      if (selectedPage != null && Number(selectedPage) !== Number(pageRef.current)) return;
      const selectedIds = state.selectedAnnotationIds || [];
      let targetIds;
      if (detail.id && !selectedIds.includes(detail.id)) {
        targetIds = [detail.id];
      } else if (selectedIds.length > 0) {
        targetIds = selectedIds;
      } else if (detail.id || state.selectedAnnotationId) {
        targetIds = [detail.id || state.selectedAnnotationId];
      } else {
        return;
      }

      const patch = {};
      if (detail.boxStyle && ['cloud', 'rect', 'round'].includes(detail.boxStyle)) {
        patch.boxStyle = detail.boxStyle;
      }
      // فاز ۳: استایل فلش — فقط مقادیر مجاز، با همان اعتبارسنجی استور
      if (detail.arrowStyle && ['straight', 'curved'].includes(detail.arrowStyle)) {
        patch.arrowStyle = detail.arrowStyle;
      }
      if (typeof detail.hasFill === 'boolean') patch.hasFill = detail.hasFill;
      // فاز ۴: فونت و اندازهٔ متن — فقط مقادیرِ معتبر، با همان
      // clamp استور برای اندازه (۱۴ تا ۷۶).
      if (typeof detail.fontFamily === 'string' && detail.fontFamily) {
        patch.fontFamily = detail.fontFamily;
      }
      if (typeof detail.fontSize === 'number' && detail.fontSize > 0) {
        patch.fontSize = Math.max(14, Math.min(76, detail.fontSize));
      }
      if (typeof detail.color === 'string' && detail.color) patch.color = detail.color;
      if (typeof detail.strokeWidth === 'number' && detail.strokeWidth > 0) {
        patch.strokeWidth = detail.strokeWidth;
      }
      if (typeof detail.opacity === 'number' && detail.opacity >= 0 && detail.opacity <= 1) {
        patch.opacity = detail.opacity;
      }
      if (Object.keys(patch).length === 0) return;

      // بازسازی لیست یکنواخت از itemsRef تا closure قدیمی استفاده نشود
      const uniformList = (itemsRef.current || []).filter(Boolean).map((it) => {
        const u = storageToUniform(it, aspectRef.current);
        return { ...u, _bbox: getStrokeBBox(u.points, 15) };
      });
      let changed = false;
      const nextList = uniformList.map((target) => {
        if (!targetIds.includes(target.id)) return target;
        // فیلترِ سازگاریِ ابزاری برای همین آیتم (نه ردِ کلِ patch).
        const itemPatch = {};
        if (target.tool === 'box') {
          if (patch.boxStyle !== undefined) itemPatch.boxStyle = patch.boxStyle;
          if (patch.hasFill !== undefined) itemPatch.hasFill = patch.hasFill;
        }
        if (target.tool === 'arrow' && patch.arrowStyle !== undefined) {
          itemPatch.arrowStyle = patch.arrowStyle;
          // فاز ۳: تبدیل مستقیم → منحنی بدون cx/cy، به‌ظاهر
          // بی‌اثر می‌شود (رندر منحنی، cx/cy متناهی می‌خواهد)؛
          // پس برای همین آیتم، نقطهٔ کنترلِ پیش‌فرض ساخته
          // می‌شود تا بلافاصله به شکل منحنی تبدیل شود. تبدیلِ
          // منحنی → مستقیم، cx/cy را نگه می‌دارد تا برگشت به
          // منحنی، خم قبلی را حفظ کند.
          if (patch.arrowStyle === 'curved' &&
              (!Number.isFinite(target.cx) || !Number.isFinite(target.cy))) {
            const ctrl = defaultCurveControl(target.startX, target.startY, target.endX, target.endY);
            itemPatch.cx = ctrl.cx;
            itemPatch.cy = ctrl.cy;
          }
        }
        if (target.tool === 'text') {
          if (patch.fontFamily !== undefined) itemPatch.fontFamily = patch.fontFamily;
          if (patch.fontSize !== undefined) itemPatch.fontSize = patch.fontSize;
        }
        if (patch.color !== undefined) itemPatch.color = patch.color;
        if (patch.strokeWidth !== undefined) itemPatch.strokeWidth = patch.strokeWidth;
        if (patch.opacity !== undefined) itemPatch.opacity = patch.opacity;
        if (Object.keys(itemPatch).length === 0) return target;
        if (!Object.keys(itemPatch).some((k) => target[k] !== itemPatch[k])) return target;
        changed = true;
        return { ...target, ...itemPatch };
      });
      if (!changed) return; // بدون تغییر واقعی، ورودی Undo خالی ثبت نمی‌شود
      commit(nextList);
    };
    window.addEventListener('annotation:update-selected', onUpdateSelected);
    return () => window.removeEventListener('annotation:update-selected', onUpdateSelected);
  }, [commit]);

  if (!isAnnotationActive && uniformItems.length === 0) return null;
  if (size.w === 0 || size.h === 0) {
    return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
  }

  const isEraser = annotationTool === 'eraser';
  // فاز ۵: ابزارِ انتخاب، کرسرِ default دارد، نه crosshair.
  const isSelect = annotationTool === 'select';

  // فاز ۴: آیتمِ استیکیِ در حالِ ویرایش (برای ویرایشگرِ HTML).
  const stickyEditorItem = activeStickyEditorId
    ? uniformItems.find((it) => it.id === activeStickyEditorId) || null
    : null;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 18,
        pointerEvents: isAnnotationActive ? 'auto' : 'none',
        touchAction: 'none',
      }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        // فیکس #۱: فقط Pointer Events — بدون mouse/touch موازی
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerLeave={handleUp}
        onPointerCancel={handleUp}
        style={{
          cursor: !isAnnotationActive
            ? 'default'
            : isEraser
              ? 'cell'
              : isSelect
                ? 'default'
                : 'crosshair',
        }}
      >
        <Layer ref={layerRef}>
          <Group scaleX={scaleX} scaleY={scaleY}>
            {uniformItems.map((item) => {
              // فاز ۵: هر آیتم در یک Groupِ پوششی قرار می‌گیرد تا
              // نودِ Konvaی آن در دسترس باشد (گزینهٔ Groupِ TASK،
              // به‌جای تبدیلِ Committed*ها به forwardRef — hitFuncها
              // و رندرِ داخلیِ آن‌ها دست نخورده می‌مانند).
              // - id={item.id}: برای اینکه handleTransformEnd، نود
              //   را از روی transformer.nodes() هم پیدا کند.
              // - ref: ثبت/حذف در itemNodeRefs (callback ref).
              // - draggable: وقتی حاشیه‌نویسی فعال است و ابزار
              //   select است — برای همهٔ آیتم‌ها، نه فقط
              //   انتخاب‌شده‌ها. دلیل (فاز ۵-مرحله ۳، سناریو ۴):
              //   Konva در لحظهٔ pointerdown بررسی می‌کند که نود
              //   draggable هست یا نه؛ اگر فقط آیتم‌های انتخاب‌شده
              //   draggable باشند، کلیک-درگ روی آیتمِ انتخاب‌نشده
              //   فقط انتخاب می‌کند و در همان ژست حرکت نمی‌کند
              //   (کاربر باید دوبار بکشد). با draggable برای همه،
              //   Stage handleDown اول انتخاب را تنظیم می‌کند و
              //   بعد Konva همان ژست را drag می‌کند. محافظِ
              //   Shift+کلیک در handleItemDragMove/End جلوی حرکتِ
              //   آیتمِ از انتخاب بیرون‌رفته را می‌گیرد، پس این
              //   تغییر، مارکی را به‌هم نمی‌زند: مارکی فقط روی
              //   کلیکِ فضای خالی شروع می‌شود، نه روی نود.
              // - onDragMove: همگام‌سازیِ گروهی در حینِ حرکت.
              // - onDragEnd: کامیتِ یک‌باره (یک Undo) + resetِ نود.
              // - onTransformEnd: همان handleTransformEndی
              //   Transformer (با محافظِ زمانیِ ضدِ کامیتِ مضاعف).
              // نکته: انتخاب با کلیک، روی Stage pointerdown انجام
              // می‌شود، نه با onClickی این Groupها — چون onClick
              // بعد از pointerup آتش می‌شود و برای شروعِ drag در
              // همان ژست، دیر است.
              const inner =
                item.tool === 'box' ? (
                  <CommittedBox
                    item={item}
                    onErase={handleEraseClick}
                  />
                ) : item.tool === 'arrow' ? (
                  <CommittedArrow
                    item={item}
                    onErase={handleEraseClick}
                  />
                ) : item.tool === 'text' ? (
                  <CommittedText
                    item={item}
                    onErase={handleEraseClick}
                    onEdit={openTextEditorForItem}
                  />
                ) : item.tool === 'sticky' ? (
                  <CommittedSticky
                    item={item}
                    onErase={handleEraseClick}
                    onEdit={openStickyEditor}
                  />
                ) : (
                  <CommittedStroke
                    item={item}
                    onErase={handleEraseClick}
                  />
                );
              return (
                <Group
                  key={item.id}
                  id={item.id}
                  ref={(node) => {
                    if (node) {
                      itemNodeRefs.current.set(item.id, node);
                    } else {
                      itemNodeRefs.current.delete(item.id);
                    }
                  }}
                  draggable={isAnnotationActive && annotationTool === 'select'}
                  onDragMove={handleItemDragMove}
                  onDragEnd={(e) => handleItemDragEnd(e, item)}
                  onTransformEnd={handleTransformEnd}
                >
                  {inner}
                </Group>
              );
            })}

            {/* فاز ۵: Transformer — داخلِ همان Groupِ مقیاس‌دار قرار
              می‌گیرد تا سیستمِ مختصاتش با نودها یکی باشد (نودها
              در فضای یکنواخت‌اند؛ اگر Transformer بیرونِ Groupِ
              مقیاس‌دار بود، کادرش در فضای پیکسل بود و با نودها
              نمی‌خواند). enabledAnchors فقط گوشه‌ها را نشان
              می‌دهد (طبقِ لیستِ TASK): تغییرِ اندازه فقط از گوشه،
              نه از وسطِ ضلع‌ها. rotateEnabled خاموش است، چون هیچ
              آیتمی میدانِ زاویه ندارد. */}
            <Transformer
              ref={transformerRef}
              rotateEnabled={false}
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              anchorSize={9}
              anchorFill="#ffffff"
              anchorStroke="#06b6d4"
              anchorCornerRadius={2}
              borderStroke="#06b6d4"
              borderDash={[4, 4]}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 10 || newBox.height < 10 ? oldBox : newBox
              }
              onTransformEnd={handleTransformEnd}
            />

            {/* فاز ۵: مستطیلِ مارکی (فقط وقتی بزرگ‌تر از ۴×۴ است).
              listening={false} تا کلیک‌ها را نگیرد و داخلِ Groupِ
              مقیاس‌دار است، پس مختصاتش همان فضای یکنواخت است. */}
            {marqueeBox && (marqueeBox.width > 4 || marqueeBox.height > 4) && (
              <Rect
                x={marqueeBox.x}
                y={marqueeBox.y}
                width={marqueeBox.width}
                height={marqueeBox.height}
                fill="rgba(34, 211, 238, 0.08)"
                stroke="#22d3ee"
                strokeWidth={1}
                dash={[6, 4]}
                listening={false}
              />
            )}

            <Shape
              ref={draftShapeRef}
              sceneFunc={draftSceneFunc}
              visible={false}
              listening={false}
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
            />

            {/* فاز ۲: پیش‌نمایش زنده باکس حین رسم */}
            <BoxLiveDraft
              ref={draftBoxShapeRef}
              boxRef={draftBoxRef}
              boxStyleRef={boxStyleRef}
              hasFillRef={hasFillRef}
              colorRef={colorRef}
              widthRef={widthRef}
              opacityRef={opacityRef}
            />

            {/* فاز ۳: پیش‌نمایش زنده فلش حین رسم */}
            <ArrowLiveDraft
              ref={draftArrowShapeRef}
              arrowRef={draftArrowRef}
              arrowStyleRef={arrowStyleRef}
              colorRef={colorRef}
              widthRef={widthRef}
              opacityRef={opacityRef}
            />

            {eraserVisible && (
              <Line
                ref={eraserLineRef}
                points={[]}
                stroke="#ef4444"
                strokeWidth={28}
                opacity={0.25}
                lineCap="round"
                lineJoin="round"
                listening={false}
                perfectDrawEnabled={false}
              />
            )}
          </Group>
        </Layer>
      </Stage>

      {/* فاز ۴: ویرایشگرهای موقتِ HTML — خواهرِ Stage داخلِ همان کانتینر */}
      <TextEditorOverlay
        editor={textEditor}
        scaleX={scaleX}
        scaleY={scaleY}
        size={size}
        onChangeValue={(val) => {
          setTextEditor((prev) => (prev ? { ...prev, value: val } : prev));
        }}
        onCommit={commitText}
        onCancel={cancelTextEditor}
      />
      <StickyEditorOverlay
        item={stickyEditorItem}
        scaleX={scaleX}
        scaleY={scaleY}
        size={size}
        onBlurCommit={commitStickyText}
        onCancel={() => {
          activeStickyEditorRef.current = null;
          setActiveStickyEditorId(null);
        }}
      />
    </div>
  );
});

export default KonvaAnnotationLayer;

// فاز ۱: اکسپورت نام‌دار برای سازگاری با ایمپورت‌های مختلف
export const AnnotationLayer = KonvaAnnotationLayer;
export { KonvaAnnotationLayer };

export {
  drawSmoothStroke,
  midpoint,
  streamline,
  pointToSegmentDist,
  getStrokeBBox,
  getStrokeWidth,
  eraserHitsStroke,
};
