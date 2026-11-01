import React, { useState, useRef, useEffect, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';
import Icons from '../common/Icons';

export default function AreaZoomOverlay() {
  // مرحله ۱۲: نمایِ فعلی — بنرِ زومِ ناحیه‌ای و کپسولِ بازگشت،
  // فقط در نمایِ ریدر مجاز به رندر شدن هستند.
  const currentView = useAppStore((state) => state.currentView);
  const isAreaZoomActive = useAppStore((state) => Boolean(state.isAreaZoomActive));
  const setIsAreaZoomActive = useAppStore((state) => state.setIsAreaZoomActive);
  const showToast = useAppStore((state) => state.showToast);

  const comicData = useReaderStore((state) => state.comicData);
  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const preAreaZoomLevel = useReaderStore((state) => state.preAreaZoomLevel);
  const applyAreaZoom = useReaderStore((state) => state.applyAreaZoom);
  const restorePreAreaZoom = useReaderStore((state) => state.restorePreAreaZoom);

  const [dragBox, setDragBox] = useState(null);
  const startPosRef = useRef(null);
  const isDrawingRef = useRef(false);

  // مرحله ۱۴: جمع‌شدنِ خودکارِ بنرِ راهنما پس از ۵ ثانیه به
  // دایرهٔ کوچکِ نیمه‌شفافِ اطلاعات. تایمر، فقط به فعال‌بودنِ
  // زومِ ناحیه‌ای و «نسلِ باز شدن» وابسته است — نه به زوم،
  // صفحه یا هیچ استیتِ در حالِ تغییری — پس تغییرِ پراپ‌ها،
  // تایمر را ریست نمی‌کند. باز شدنِ دوباره با کلیک رویِ
  // دایره، نسل را یکی جلو می‌برد و تایمرِ ۵ ثانیه‌ایِ تازه
  // می‌سازد. هاور، عمداً هیچ کاری نمی‌کند: فقط کلیک، باز و
  // بسته می‌کند (هاورِ ناخواسته، جلوی جمع شدن را نمی‌گیرد).
  const [bannerCollapsed, setBannerCollapsed] = useState(false);
  const [collapseNonce, setCollapseNonce] = useState(0);
  useEffect(() => {
    if (!isAreaZoomActive) {
      setBannerCollapsed(false);
      return;
    }
    if (bannerCollapsed) return;
    const timer = setTimeout(() => setBannerCollapsed(true), 5000);
    return () => clearTimeout(timer);
  }, [isAreaZoomActive, bannerCollapsed, collapseNonce]);

  // مرحله ۱۵: کپسولِ «زوم ناحیه‌ای: XX% | بازگشت به YY%» دقیقاً
  // ۴ ثانیه پس از نمایش، به یک دایرهٔ کوچکِ نیمه‌شفاف جمع می‌شود
  // تا مزاحمِ مطالعه نباشد؛ کلیک رویِ دایره، کپسول را دوباره باز
  // می‌کند و ۴ ثانیه بعد، دوباره جمع می‌شود. پیامِ دیگرِ زومِ
  // ناحیه‌ای (بنرِ راهنمایِ ۵ ثانیه‌ایِ بالا) دست نخورده مانده و
  // توستِ «قفل شد» هم خودِ ToastHUD آن را محو می‌کند.
  const [pillCollapsed, setPillCollapsed] = useState(false);
  const [pillNonce, setPillNonce] = useState(0);
  useEffect(() => {
    setPillCollapsed(false);
  }, [preAreaZoomLevel]);
  useEffect(() => {
    if (preAreaZoomLevel === null) {
      setPillCollapsed(false);
      return undefined;
    }
    if (pillCollapsed) return undefined;
    const timer = setTimeout(() => setPillCollapsed(true), 4000);
    return () => clearTimeout(timer);
  }, [preAreaZoomLevel, pillCollapsed, pillNonce]);

  // مرحله ۱۲: پاک‌سازیِ کمربند و شانه‌بند — اگر به هر راهی
  // (مثلاً شورت‌کاتِ Alt+Z روی نمایِ دیگر، که در مرحله ۱۲ در
  // useKeyboard هم گیت شد)، زومِ ناحیه‌ای بیرون از ریدر فعال
  // بماند، با عوض شدنِ نما، خودکار خاموش می‌شود. (setCurrentView
  // در استور هم همین کار را می‌کند؛ این effect، دفاعِ دوم است.)
  useEffect(() => {
    if (currentView !== 'reader' && isAreaZoomActive) {
      setIsAreaZoomActive(false);
    }
  }, [currentView, isAreaZoomActive, setIsAreaZoomActive]);

  // لغو حالت کشیدن باکس با کلید Escape یا کلیک راست
  useEffect(() => {
    if (!isAreaZoomActive) {
      setDragBox(null);
      isDrawingRef.current = false;
      return;
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsAreaZoomActive(false);
        setDragBox(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isAreaZoomActive, setIsAreaZoomActive]);

  const handlePointerDown = useCallback((e) => {
    if (e.button === 2) {
      e.preventDefault();
      setIsAreaZoomActive(false);
      setDragBox(null);
      return;
    }
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    isDrawingRef.current = true;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    setDragBox({
      x: e.clientX,
      y: e.clientY,
      width: 0,
      height: 0,
    });
  }, [setIsAreaZoomActive]);

  const handlePointerMove = useCallback((e) => {
    if (!isDrawingRef.current || !startPosRef.current) return;
    e.preventDefault();

    const startX = startPosRef.current.x;
    const startY = startPosRef.current.y;
    const curX = Math.max(0, Math.min(window.innerWidth, e.clientX));
    const curY = Math.max(0, Math.min(window.innerHeight, e.clientY));

    setDragBox({
      x: Math.min(startX, curX),
      y: Math.min(startY, curY),
      width: Math.abs(curX - startX),
      height: Math.abs(curY - startY),
    });
  }, []);

  const handlePointerUp = useCallback(
    (e) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      e.stopPropagation();

      isDrawingRef.current = false;
      const box = dragBox;
      setDragBox(null);
      startPosRef.current = null;

      if (!box || box.width < 28 || box.height < 28) {
        setIsAreaZoomActive(false);
        showToast('کادر انتخابی برای بزرگ‌نمایی بسیار کوچک بود', { type: 'info' });
        return;
      }

      // یافتن کانتینر اسکرول فعال ریدر (کمیک یا PDF)
      // (از مرحلهٔ ۲۵، let است تا تصحیحِ زیر بتواند آن را عوض کند.)
      let scrollContainer =
        document.querySelector('[data-reader-scroll-container="true"]') ||
        document.querySelector('.comic-page-item')?.parentElement?.parentElement;

      const viewportW = scrollContainer ? scrollContainer.clientWidth : window.innerWidth;
      const viewportH = scrollContainer ? scrollContainer.clientHeight : window.innerHeight;

      // محاسبه ضریب بزرگ‌نمایی متناسب با ابعاد کادر کشیده‌شده
      const ratioX = viewportW / Math.max(40, box.width);
      const ratioY = viewportH / Math.max(40, box.height);
      const scaleMultiplier = Math.min(ratioX, ratioY) * 0.88;

      const currentZoom = useReaderStore.getState().zoomLevel || 1.0;
      const computedZoom = Math.min(
        3.5,
        // Minimum zoom lowered from 40% to 10% (0.1) per user requirement
        Math.max(0.1, Number((currentZoom * scaleMultiplier).toFixed(2)))
      );

      const boxCenterX = box.x + box.width / 2;
      const boxCenterY = box.y + box.height / 2;

      // مرحله ۲۵ — تصحیحِ انتخابِ کانتینر: اگر چند کانتینرِ اسکرول
      // مانت باشند، آنی که مستطیلش مرکزِ باکس را در بر دارد،
      // کانتینرِ درست است (وگرنه همان انتخابِ اول می‌ماند).
      if (scrollContainer) {
        const allContainers = document.querySelectorAll('[data-reader-scroll-container="true"]');
        allContainers.forEach((candidate) => {
          const r = candidate.getBoundingClientRect();
          if (boxCenterX >= r.left && boxCenterX <= r.right && boxCenterY >= r.top && boxCenterY <= r.bottom) {
            scrollContainer = candidate;
          }
        });
      }

      // مرحله ۲۳ — هدف، دقیقاً از رویِ عنصرِ برگه خوانده می‌شود،
      // نه از رویِ نسبت‌هایِ scrollWidth/scrollHeight. علتِ پرشِ
      // رندومِ بارِ اول، دقیقاً همین‌جا بود: بلوکِ پایین، نسبت‌هایِ
      // درستِ برگه (که از elementsFromPoint حساب شده بودند) را با
      // نسبت‌هایِ کلِ محتوا بازنویسی می‌کرد؛ در بارِ اول، ارتفاعِ
      // صفحات هنوز با نسبتِ پیش‌فرض تخمین زده شده‌اند و اسپیسرهایِ
      // پنجرهٔ مجازی هم رویِ همان تخمین‌اند، پس نقطهٔ حاصل،
      // رندوم بود. حالا نسبت‌هایِ برگه، دست‌نخورده می‌مانند و در
      // rect هم حمل می‌شوند تا نمایشگر، با rectِ واقعیِ عنصر،
      // دقیق فرود بیاید.
      // مختصاتِ باکس، مختصاتِ client هستند (اورلی fixed است) و
      // با getBoundingClientRect (که آن هم client است) مستقیم
      // قابلِ مقایسه‌اند؛ هیچ تبدیلی لازم نیست.
      let pageNumber = null;
      let pageRatioX = 0.5;
      let pageRatioY = 0.5;

      // مرحله ۲۴ — پیدا کردنِ قطعیِ صفحهٔ هدف:
      // مسیرِ اول: اولین عنصرِ زیرِ مرکزِ باکس که خودش یا جدش،
      // ویژگیِ data-page-number دارد. (عنصرِ زیرِ مرکز، معمولاً
      // خودِ <img> یا لایهٔ داخلی است، نه کارتِ صفحه؛ پس closest
      // لازم است. اورلی و باکسِ انتخاب، جدِ برگه‌ای ندارند، پس
      // برایِ آن‌ها null برمی‌گردد و رد می‌شوند.)
      const elementsAtCenter = document.elementsFromPoint(boxCenterX, boxCenterY);
      let pageEl = null;
      for (const el of elementsAtCenter) {
        const found = el.closest?.('[data-page-number]');
        if (found) {
          pageEl = found;
          break;
        }
      }

      // مسیرِ دوم (اگر مرکزِ باکس رویِ فاصلهٔ بینِ صفحه‌ها،
      // حاشیه یا اسپیسر افتاده باشد): نزدیک‌ترین برگه از نظرِ
      // عمودی، از میانِ همهٔ برگه‌هایِ مانت‌شده در کلِ سند.
      // (فقط صفحه‌هایِ PDF این ویژگی را دارند، پس جستجو در کلِ
      // سند، امن است.)
      if (!pageEl) {
        const candidates = document.querySelectorAll('[data-page-number]');
        let best = null;
        let bestDistance = Infinity;
        candidates.forEach((candidate) => {
          const r = candidate.getBoundingClientRect();
          if (r.height <= 0) return;
          const distance =
            boxCenterY < r.top
              ? r.top - boxCenterY
              : boxCenterY > r.bottom
              ? boxCenterY - r.bottom
              : 0;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = candidate;
          }
        });
        pageEl = best;
      }

      if (pageEl) {
        const pRect = pageEl.getBoundingClientRect();
        pageNumber = Number(pageEl.getAttribute('data-page-number')) || 1;

        if (pRect.width > 0 && pRect.height > 0) {
          pageRatioX = Math.min(1, Math.max(0, (boxCenterX - pRect.left) / Math.max(1, pRect.width)));
          pageRatioY = Math.min(1, Math.max(0, (boxCenterY - pRect.top) / Math.max(1, pRect.height)));
        }
      }

      // مرحله ۲۵ — نرم‌هایِ دوگانه، بدونِ بازنویسیِ یکدیگر:
      // الف) نرم‌هایِ کانتینر (برایِ VerticalViewer که با
      // normCenter × scrollWidth/scrollHeight فرود می‌آید). توجه:
      // scrollLeft از لبهٔ محتوا (داخلِ پدینگ) سنجیده می‌شود، ولی
      // getBoundingClientRect جعبهٔ border است؛ پس پدینگِ چپ/بالا
      // کم می‌شود تا نقطه دقیق باشد (هر دو ویوور، پدینگِ افقیِ
      // ۸۰ پیکسل دارند؛ فرمولِ بدونِ این تصحیح، حدودِ ۸۰ پیکسل
      // خطا می‌داد).
      // ب) نسبت‌هایِ برگه (برایِ PdfViewer) که بالاتر حساب شدند.
      let normCenterX = 0.5;
      let normCenterY = 0.5;
      let imgRect = null;
      if (scrollContainer) {
        const cRect = scrollContainer.getBoundingClientRect();
        const style = typeof window !== 'undefined' && window.getComputedStyle
          ? window.getComputedStyle(scrollContainer)
          : null;
        const padLeft = style ? parseFloat(style.paddingLeft) || 0 : 0;
        const padTop = style ? parseFloat(style.paddingTop) || 0 : 0;
        const contentClickX = scrollContainer.scrollLeft + (boxCenterX - cRect.left - padLeft);
        const contentClickY = scrollContainer.scrollTop + (boxCenterY - cRect.top - padTop);
        normCenterX = Math.min(1, Math.max(0, contentClickX / Math.max(1, scrollContainer.scrollWidth)));
        normCenterY = Math.min(1, Math.max(0, contentClickY / Math.max(1, scrollContainer.scrollHeight)));
      }
      // مستطیلِ <img> زیرِ مرکزِ باکس (برایِ تک‌عکس‌هایِ .webp که
      // وسط‌چین‌اند): صرفاً اطلاعاتی، در rect حمل می‌شود؛ فرودِ
      // VerticalViewer با نرم‌هایِ کانتینر انجام می‌شود.
      for (const el of elementsAtCenter) {
        if (el.tagName === 'IMG') {
          const r = el.getBoundingClientRect();
          imgRect = { left: r.left, top: r.top, width: r.width, height: r.height };
          break;
        }
      }

      // توجه به ترتیبِ اعمال: applyAreaZoom در استور، zoomLevel و
      // areaZoomTarget را در یک set() اتمیک با هم ست می‌کند؛ پس
      // «اول هدف، بعد زوم» به قوی‌ترین شکلِ ممکن رعایت شده است و
      // اثرِ یکپارچهٔ مرحلهٔ ۲۴، هرگز با هدفِ خالی اجرا نمی‌شود.
      // (از مرحلهٔ ۲۴، استور فیلدهایِ درجه‌اولِ pageNumber و
      // pageRatioX/pageRatioY را هم می‌پذیرد؛ rect برایِ سازگاری
      // با مصرف‌کننده‌هایِ قدیمی، همچنان پر می‌شود.)
      applyAreaZoom({
        targetZoom: computedZoom,
        pageNumber,
        pageRatioX,
        pageRatioY,
        normCenterX,
        normCenterY,
        rect: {
          ...box,
          pageNumber,
          pageRelativeY: pageRatioY,
          pageRatioX,
          imgRect,
        },
      });

      setIsAreaZoomActive(false);
      showToast(`بزرگ‌نمایی ناحیه‌ای روی ${Math.round(computedZoom * 100)}% قفل شد`, {
        type: 'success',
      });
    },
    [dragBox, applyAreaZoom, setIsAreaZoomActive, showToast]
  );

  // مرحله ۱۲: بیرون از نمایِ ریدر، هیچ‌چیز از این اورلی رندر
  // نمی‌شود — نه بنرِ راهنما و نه کپسولِ بازگشت به زومِ قبلی.
  if (!comicData || currentView !== 'reader') return null;

  // محاسبه زوم تخمینی زنده هنگام کشیدن کادر
  let previewZoomPercent = Math.round(zoomLevel * 100);
  if (dragBox && dragBox.width >= 28 && dragBox.height >= 28) {
    const mult =
      Math.min(window.innerWidth / dragBox.width, window.innerHeight / dragBox.height) *
      0.88;
    // Minimum zoom lowered from 40% to 10% (0.1) per user requirement
    previewZoomPercent = Math.round(Math.min(3.5, Math.max(0.1, zoomLevel * mult)) * 100);
  }

  return (
    <>
      {/* ۱. کپسول شناور بازگشت سریع به زوم قبلی (زمانی که زوم باکسی اعمال شده باشد) */}
      {!isAreaZoomActive && preAreaZoomLevel !== null && (
        pillCollapsed ? (
          <div style={styles.restorePillWrap}>
            <button
              type="button"
              title="باز کردنِ کپسولِ بازگشت به زومِ قبلی"
              onClick={() => {
                setPillCollapsed(false);
                setPillNonce((n) => n + 1);
              }}
              style={styles.restorePillCollapsed}
            >
              <Icons.ScanSearch size={15} />
            </button>
          </div>
        ) : (
        <div style={styles.restorePillWrap}>
          <div style={styles.restorePill}>
            <span style={styles.restoreIcon}>
              <Icons.ScanSearch size={14} />
            </span>
            <span style={styles.restoreText}>
              زوم ناحیه‌ای: <strong style={styles.monoText}>{Math.round(zoomLevel * 100)}%</strong>
            </span>
            <button
              type="button"
              onClick={() => {
                restorePreAreaZoom();
                showToast('به بزرگ‌نمایی قبلی بازگشتید', { type: 'info' });
              }}
              style={styles.restoreBtn}
            >
              بازگشت به {Math.round(preAreaZoomLevel * 100)}%
            </button>
          </div>
        </div>
        )
      )}

      {/* ۲. لایه تمام‌صفحه کشیدن باکس زوم */}
      {isAreaZoomActive && (
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onContextMenu={(e) => {
            e.preventDefault();
            setIsAreaZoomActive(false);
          }}
          style={styles.overlayBackdrop}
        >
          {/* بنر راهنمای بالای صفحه — مرحله ۱۴: پس از ۵ ثانیه،
              با انیمیشنِ ۳۵۰ میلی‌ثانیه‌ای به دایرهٔ ۴۰×۴۰
              جمع می‌شود؛ کلیک رویِ دایره، بنر را دوباره باز
              می‌کند (و ۵ ثانیه بعد، دوباره جمع می‌شود) و دکمهٔ
              کوچک‌سازیِ کنارِ بنر، بی‌درنگ جمعش می‌کند. هاور،
              هیچ اثری ندارد. pointerDown روی بنر، جلوی شروعِ
              کشیدنِ باکس را می‌گیرد. */}
          <div
            style={bannerCollapsed ? styles.topInstructionCollapsed : styles.topInstructionBanner}
            onClick={() => {
              if (bannerCollapsed) {
                setBannerCollapsed(false);
                setCollapseNonce((n) => n + 1);
              }
            }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {bannerCollapsed ? (
              <span style={styles.collapsedGlow}>
                <Icons.Info size={17} />
              </span>
            ) : (
              <>
                <Icons.ScanSearch size={16} />
                <span>کادر مورد نظر برای بزرگ‌نمایی را با ماوس بکشید</span>
                <span style={styles.escBadge}>Esc = لغو</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setBannerCollapsed(true);
                  }}
                  style={styles.bannerMinBtn}
                  title="جمع شدن به دایرهٔ کوچک"
                >
                  <Icons.Minimize size={13} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAreaZoomActive(false);
                  }}
                  style={styles.bannerExitBtn}
                >
                  خروج از زوم ناحیه‌ای
                </button>
              </>
            )}
          </div>

          {/* مستطیل انتخابی زنده */}
          {dragBox && dragBox.width > 4 && dragBox.height > 4 && (
            <div
              style={{
                ...styles.marqueeBox,
                left: `${dragBox.x}px`,
                top: `${dragBox.y}px`,
                width: `${dragBox.width}px`,
                height: `${dragBox.height}px`,
              }}
            >
              <div style={styles.cornerNW} />
              <div style={styles.cornerNE} />
              <div style={styles.cornerSW} />
              <div style={styles.cornerSE} />

              <div style={styles.metricsBadge}>
                <span>
                  {Math.round(dragBox.width)} × {Math.round(dragBox.height)}
                </span>
                <span style={styles.metricsSeparator}>•</span>
                <span style={{ color: '#22d3ee' }}>زوم مقصد: {previewZoomPercent}%</span>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

const styles = {
  overlayBackdrop: {
    position: 'fixed',
    inset: 0,
    zIndex: 8800,
    cursor: 'crosshair',
    backgroundColor: 'rgba(6, 9, 14, 0.28)',
    userSelect: 'none',
    touchAction: 'none',
  },
  topInstructionBanner: {
    position: 'fixed',
    top: '66px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    width: 'min(560px, calc(100vw - 32px))',
    boxSizing: 'border-box',
    padding: '8px 18px',
    borderRadius: '24px',
    // مرحله ۱۴: نیمه‌شفاف‌تر (۰٫۵۸) تا محتوای کتاب در پشتِ بنر
    // کاملاً خوانا بماند؛ عرضِ صریح، انیمیشنِ width به دایره را
    // ممکن می‌کند (عرضِ auto انیمیت نمی‌شود)؛ easing و زمان،
    // دقیقاً همان چیزی است که TASK خواسته است.
    background: 'rgba(15, 23, 42, 0.58)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'width 350ms cubic-bezier(0.16, 1, 0.3, 1), padding 350ms cubic-bezier(0.16, 1, 0.3, 1), border-radius 350ms cubic-bezier(0.16, 1, 0.3, 1), transform 350ms cubic-bezier(0.16, 1, 0.3, 1), height 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(167, 139, 250, 0.45)',
    color: '#e6edf3',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 700,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.7)',
    pointerEvents: 'auto',
    direction: 'rtl',
  },
  // مرحله ۱۴: حالتِ جمع‌شدهٔ بنر — دایرهٔ ۴۰×۴۰ پیکسلیِ
  // نیمه‌شفاف با آیکونِ درخشانِ اطلاعات (i) که جلوی دیدِ صفحه
  // را نمی‌گیرد؛ فقط با کلیک باز می‌شود، نه با هاور.
  topInstructionCollapsed: {
    position: 'fixed',
    top: '66px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '40px',
    height: '40px',
    boxSizing: 'border-box',
    padding: 0,
    borderRadius: '50%',
    background: 'rgba(15, 23, 42, 0.58)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    transition: 'width 350ms cubic-bezier(0.16, 1, 0.3, 1), padding 350ms cubic-bezier(0.16, 1, 0.3, 1), border-radius 350ms cubic-bezier(0.16, 1, 0.3, 1), transform 350ms cubic-bezier(0.16, 1, 0.3, 1), height 350ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(167, 139, 250, 0.45)',
    color: '#e6edf3',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.7)',
    pointerEvents: 'auto',
    cursor: 'pointer',
  },
  collapsedGlow: {
    display: 'flex',
    filter: 'drop-shadow(0 0 6px rgba(167, 139, 250, 0.9))',
    color: '#c4b5fd',
  },
  bannerMinBtn: {
    backgroundColor: 'transparent',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(167, 139, 250, 0.45)',
    color: '#c4b5fd',
    borderRadius: '10px',
    padding: '4px 7px',
    cursor: 'pointer',
    outline: 'none',
    display: 'flex',
    alignItems: 'center',
  },
  bannerExitBtn: {
    backgroundColor: 'rgba(167, 139, 250, 0.2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#a78bfa',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '3px 10px',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 700,
    cursor: 'pointer',
    outline: 'none',
  },
  escBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    color: '#a78bfa',
    backgroundColor: 'rgba(167, 139, 250, 0.14)',
    padding: '2px 8px',
    borderRadius: '6px',
    direction: 'ltr',
  },
  marqueeBox: {
    position: 'fixed',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: '#a78bfa',
    backgroundColor: 'rgba(167, 139, 250, 0.14)',
    boxShadow: '0 0 0 9999px rgba(6, 9, 14, 0.42), 0 0 24px rgba(167, 139, 250, 0.45)',
    borderRadius: '6px',
    pointerEvents: 'none',
  },
  cornerNW: {
    position: 'absolute',
    top: '-4px',
    left: '-4px',
    width: '10px',
    height: '10px',
    borderTop: '3px solid #22d3ee',
    borderLeft: '3px solid #22d3ee',
  },
  cornerNE: {
    position: 'absolute',
    top: '-4px',
    right: '-4px',
    width: '10px',
    height: '10px',
    borderTop: '3px solid #22d3ee',
    borderRight: '3px solid #22d3ee',
  },
  cornerSW: {
    position: 'absolute',
    bottom: '-4px',
    left: '-4px',
    width: '10px',
    height: '10px',
    borderBottom: '3px solid #22d3ee',
    borderLeft: '3px solid #22d3ee',
  },
  cornerSE: {
    position: 'absolute',
    bottom: '-4px',
    right: '-4px',
    width: '10px',
    height: '10px',
    borderBottom: '3px solid #22d3ee',
    borderRight: '3px solid #22d3ee',
  },
  metricsBadge: {
    position: 'absolute',
    bottom: '-34px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(10, 15, 19, 0.95)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.35)',
    borderRadius: '8px',
    padding: '3px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 700,
    color: '#e6edf3',
    whiteSpace: 'nowrap',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    direction: 'ltr',
    boxShadow: '0 6px 16px rgba(0, 0, 0, 0.6)',
  },
  metricsSeparator: {
    color: 'var(--muted)',
  },
  restorePillWrap: {
    position: 'fixed',
    top: '64px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 75,
    pointerEvents: 'auto',
  },
  restorePill: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '6px 12px',
    borderRadius: '20px',
    backgroundColor: 'rgba(13, 18, 24, 0.92)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(167, 139, 250, 0.4)',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.65)',
    direction: 'rtl',
  },
  restorePillCollapsed: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(13, 18, 24, 0.55)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(167, 139, 250, 0.35)',
    color: '#a78bfa',
    opacity: 0.5,
    cursor: 'pointer',
    outline: 'none',
    padding: 0,
    transition: 'opacity 300ms ease, transform 300ms ease',
  },
  restoreIcon: {
    color: '#a78bfa',
    display: 'flex',
    alignItems: 'center',
  },
  restoreText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--text)',
  },
  monoText: {
    fontFamily: 'var(--font-mono)',
    color: '#22d3ee',
  },
  restoreBtn: {
    backgroundColor: 'rgba(167, 139, 250, 0.2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#a78bfa',
    color: '#ffffff',
    borderRadius: '12px',
    padding: '3px 10px',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 700,
    cursor: 'pointer',
    outline: 'none',
  },
};