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
import { Stage, Layer, Shape, Group, Line } from 'react-konva';
import useAppStore from '../../store/useAppStore';
import { AnnotationToolbar } from './AnnotationToolbar';
import {
  storageToUniform,
  uniformToStorage,
  uid,
  generateCloudPath,
  drawCloudPathCanvas,
  eraserHitsBox,
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
      // هیت‌تست تقریبی: مستطیل با حاشیه
      ctx.beginPath();
      ctx.rect(item.x - 10, item.y - 10, item.width + 20, item.height + 20);
      ctx.fillStrokeShape(shape);
    },
    [item.x, item.y, item.width, item.height]
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

  const containerRef = useRef(null);
  const stageRef = useRef(null);

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
  const lastEventTimeRef = useRef(0);     // فیکس #۱: جلوگیری از اجرای مضاعف

  const toolRef = useRef(annotationTool);
  const colorRef = useRef(annotationColor);
  const widthRef = useRef(annotationStrokeWidth);
  const opacityRef = useRef(annotationOpacity);
  const boxStyleRef = useRef(annotationBoxStyle);
  const hasFillRef = useRef(annotationHasFill);
  toolRef.current = annotationTool;
  colorRef.current = annotationColor;
  widthRef.current = annotationStrokeWidth;
  opacityRef.current = annotationOpacity;
  boxStyleRef.current = annotationBoxStyle;
  hasFillRef.current = annotationHasFill;

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
    const native = getNative(e);
    if (!shouldProcessEvent(native)) return; // فیکس #۱
    capturePointer(native);

    const pts = extractPoints(native);
    if (pts.length === 0) return;

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
  }, [isAnnotationActive, getNative, shouldProcessEvent, capturePointer, extractPoints, pushFilteredPoints, redrawDraft]);

  const handleMove = useCallback((e) => {
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
        isDrawingRef.current = false;
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
        const remaining = current.filter((it) => {
          // فاز ۲: باکس‌ها با تابع اختصاصی بررسی می‌شوند
          if (it.tool === 'box') {
            return !eraserHitsBox(epts, it, 14);
          }
          return !eraserHitsStroke(epts, it.points, it._bbox, 14);
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
  }, [commit, getNative, releasePointer, uniformItems]);

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

  if (!isAnnotationActive && uniformItems.length === 0) return null;
  if (size.w === 0 || size.h === 0) {
    return <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />;
  }

  const isEraser = annotationTool === 'eraser';

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
          cursor: !isAnnotationActive ? 'default' : isEraser ? 'cell' : 'crosshair',
        }}
      >
        <Layer>
          <Group scaleX={scaleX} scaleY={scaleY}>
            {uniformItems.map((item) => {
              // فاز ۲: باکس‌ها با کامپوننت اختصاصی رندر می‌شوند
              if (item.tool === 'box') {
                return (
                  <CommittedBox
                    key={item.id}
                    item={item}
                    onErase={handleEraseClick}
                  />
                );
              }
              return (
                <CommittedStroke
                  key={item.id}
                  item={item}
                  onErase={handleEraseClick}
                />
              );
            })}

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
