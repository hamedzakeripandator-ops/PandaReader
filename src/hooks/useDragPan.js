import { useCallback, useEffect, useRef, useState } from 'react';

// مرحله ۱۵: درگِ چهارجهتهٔ صفحات با ماوس (Mouse Drag-to-Scroll /
// Panning) برای هر دو ویوور. منطق، عمداً در یک هوکِ مشترک است تا
// رفتارِ PdfViewer و VerticalViewer یکسان بماند و باگ، فقط در یک
// جا تعمیر شود.
//
// گیت‌هایِ فعال‌شدن (دقیقاً مطابقِ پرامپت):
// - دکمهٔ وسط (button === 1): در هر حالتی (حتی حینِ حاشیه‌نویسی)،
//   به‌جز وقتی زومِ ناحیه‌ای فعال است.
// - دکمهٔ چپ (button === 0): فقط در حالتِ مطالعهٔ عادی
//   (isAnnotationActive === false) و وقتی زومِ ناحیه‌ای فعال نیست.
//   وقتی استودیو فعال است، رویدادها مالِ بومِ Konva هستند و هوک،
//   عمداً وارد نمی‌شود تا ابزارهایِ طراحی نشکنند؛ همان‌طور که
//   پرامپت هم برای ابزارِ select، «کلیک نشده رویِ شکلِ موجود» را
//   شرط کرده بود، و تشخیصِ «شکلِ موجود» از سطحِ کانتینر ممکن نیست.
//   پس در حالتِ استودیو، فقط دکمهٔ وسط، پنینگ می‌کند.
// - هرگز رویِ دکمه‌ها، نشانگرهایِ بوک‌مارک (.bm-marker) و لینک‌ها
//   شروع نمی‌شود؛ کلیکِ رویِ آن‌ها، کارِ خودش را می‌کند.
// - هرگز رویِ نوارِ اسکرول‌بارِ سمتِ راستِ کانتینر شروع نمی‌شود؛
//   کلیکِ آن‌جا مالِ خودِ مرورگر است و درگِ شستی، با پنینگ
//   تداخل می‌کند و شستی عقب می‌ماند (مرحله ۴۵).
// - آستانهٔ ۴ پیکسل: تا پیش از رد شدن از ۴ پیکسل، هیچ اسکرولی
//   انجام نمی‌شود تا کلیک‌هایِ عادی، سالم بمانند.
// - حرکت، با rAF ادغام می‌شود (۶۰ فریم) و پس از رها کردن، یک
//   مومنتومِ کوتاهِ میرا (ضریبِ ۰٫۹۲ در هر فریم) ادامه می‌یابد.
// - اگر درگی انجام شده باشد، کلیکِ بعدیِ همان ژست، با یک شنوندهٔ
//   capture یک‌بارمصرف، خنثی می‌شود تا کلیکِ ناخواسته رویِ صفحه
//   (مثلاً باز شدنِ چیزی) رخ ندهد. کلیک‌هایِ زیرِ آستانه، هرگز
//   خنثی نمی‌شوند.
//
// مصرف:
//   const { handlePanMouseDown, isPanning } = useDragPan({
//     containerRef,
//     isAnnotationActive,
//     isAreaZoomActive,
//   });
//   <div ref={containerRef} onMouseDown={handlePanMouseDown}
//        style={{ cursor: isPanning ? 'grabbing' : undefined,
//                 userSelect: isPanning ? 'none' : undefined, ... }} />

const PAN_THRESHOLD_PX = 4;
const MOMENTUM_DECAY = 0.92;
const MOMENTUM_MIN_PX_PER_FRAME = 0.3;
const MOMENTUM_MAX_MS = 400;

export default function useDragPan({
  containerRef,
  isAnnotationActive = false,
  isAreaZoomActive = false,
} = {}) {
  const [isPanning, setIsPanning] = useState(false);
  const dragRef = useRef(null);
  const rafRef = useRef(0);
  const momentumRef = useRef(null);

  const stopMomentum = useCallback(() => {
    if (momentumRef.current) {
      cancelAnimationFrame(momentumRef.current.raf);
      momentumRef.current = null;
    }
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  // خنثی‌سازیِ کلیکِ پس از درگ: شنونده، مستقیم در handleUp نصب
  // می‌شود و پس از یک کلیک یا ۵۰۰ میلی‌ثانیه، خودش پاک می‌شود تا
  // هیچ کلیکِ مشروعِ بعدی خورده نشود.
  useEffect(() => () => {
    stopRaf();
    stopMomentum();
  }, [stopRaf, stopMomentum]);

  const handlePanMouseDown = useCallback(
    (e) => {
      const container = containerRef && containerRef.current;
      if (!container) return;
      // گاردِ لبهٔ اسکرول‌بار: کلیک رویِ نوارِ اسکرول‌بارِ سمتِ راستِ
      // کانتینر، مالِ خودِ مرورگر است، نه درگ؛ اگر هوک فعال شود،
      // درگِ شستی با پنینگ تداخل می‌کند و شستی عقب می‌ماند.
      // شرطِ اول (clientX) مستقل از هدفِ رویداد است و هر کلیکی را
      // در ۱۶ پیکسلِ لبهٔ راست می‌گیرد. شرطِ دوم (offsetX) فقط
      // وقتی اعمال می‌شود که هدف، خودِ کانتینر باشد؛ چون offsetX
      // نسبت به هدف سنجیده می‌شود و رویِ فرزندِ پهنِ زوم‌شده،
      // بی‌جهت پنینگ را می‌بست.
      const containerRect = container.getBoundingClientRect();
      if (e.clientX >= containerRect.right - 16) return;
      if (e.target === container && e.offsetX > container.clientWidth) return;
      if (isAreaZoomActive) return;
      const isMiddle = e.button === 1;
      const isLeft = e.button === 0;
      if (!isMiddle && !isLeft) return;
      // دکمهٔ چپ، فقط در حالتِ مطالعهٔ عادی.
      if (isLeft && isAnnotationActive) return;
      const target = e.target;
      if (target && typeof target.closest === 'function') {
        if (target.closest('button, a, .bm-marker, input, textarea, select')) return;
      }
      if (isMiddle) e.preventDefault();
      stopMomentum();
      stopRaf();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startScrollLeft: container.scrollLeft,
        startScrollTop: container.scrollTop,
        lastX: e.clientX,
        lastY: e.clientY,
        lastTime: performance.now(),
        velocityX: 0,
        velocityY: 0,
        moved: false,
      };
      const handleMove = (ev) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (typeof ev.buttons === 'number' && ev.buttons === 0) {
          // مرحله ۱۸ — رها شدنِ دکمه بیرون از پنجره (mouseupِ
          // ازدست‌رفته): حرکتِ بدونِ دکمهٔ فشرده، یعنی درگ تمام شده؛
          // وگرنه isPanning برایِ همیشه true می‌ماند و کانتینر، حسِ
          // «قفل» می‌گیرد تا کلیکِ بعدی.
          handleUp();
          return;
        }
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (!drag.moved) {
          if (Math.abs(dx) < PAN_THRESHOLD_PX && Math.abs(dy) < PAN_THRESHOLD_PX) return;
          drag.moved = true;
          setIsPanning(true);
        }
        const now = performance.now();
        const dt = Math.max(1, now - drag.lastTime);
        drag.velocityX = (ev.clientX - drag.lastX) / dt;
        drag.velocityY = (ev.clientY - drag.lastY) / dt;
        drag.lastX = ev.clientX;
        drag.lastY = ev.clientY;
        drag.lastTime = now;
        const targetLeft = drag.startScrollLeft - dx;
        const targetTop = drag.startScrollTop - dy;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          container.scrollLeft = targetLeft;
          container.scrollTop = targetTop;
          rafRef.current = 0;
        });
      };
      const handleUp = () => {
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        stopRaf();
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag || !drag.moved) {
          setIsPanning(false);
          return;
        }
        // مومنتومِ کوتاهِ میرا از سرعتِ لحظهٔ رها کردن.
        const clickHandler = (ev) => {
          ev.stopPropagation();
          ev.preventDefault();
          window.removeEventListener('click', clickHandler, true);
        };
        window.addEventListener('click', clickHandler, true);
        setTimeout(() => window.removeEventListener('click', clickHandler, true), 500);
        setIsPanning(false);
        const vx = (drag.velocityX || 0) * 16;
        const vy = (drag.velocityY || 0) * 16;
        if (Math.abs(vx) < MOMENTUM_MIN_PX_PER_FRAME && Math.abs(vy) < MOMENTUM_MIN_PX_PER_FRAME) {
          return;
        }
        const startedAt = performance.now();
        let curVx = vx;
        let curVy = vy;
        const step = () => {
          if (performance.now() - startedAt > MOMENTUM_MAX_MS) {
            momentumRef.current = null;
            return;
          }
          container.scrollLeft -= curVx;
          container.scrollTop -= curVy;
          curVx *= MOMENTUM_DECAY;
          curVy *= MOMENTUM_DECAY;
          if (Math.abs(curVx) < MOMENTUM_MIN_PX_PER_FRAME && Math.abs(curVy) < MOMENTUM_MIN_PX_PER_FRAME) {
            momentumRef.current = null;
            return;
          }
          momentumRef.current = { raf: requestAnimationFrame(step) };
        };
        momentumRef.current = { raf: requestAnimationFrame(step) };
      };
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleUp);
    },
    [containerRef, isAnnotationActive, isAreaZoomActive, stopMomentum, stopRaf]
  );

  return { handlePanMouseDown, isPanning };
}
