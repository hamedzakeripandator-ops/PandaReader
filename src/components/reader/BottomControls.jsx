import React, { useState, useRef, useEffect, useCallback } from 'react';
import useReaderStore from '../../store/useReaderStore';
import useLibraryStore from '../../store/useLibraryStore';
import useSettingsStore from '../../store/useSettingsStore';
import useAppStore from '../../store/useAppStore';
import Icons from '../common/Icons';

export default function BottomControls({ onMouseEnter, onMouseLeave }) {
  const comicData = useReaderStore((state) => state.comicData);
  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const preAreaZoomLevel = useReaderStore((state) => state.preAreaZoomLevel);
  const setZoomLevel = useReaderStore((state) => state.setZoomLevel);
  const resetZoom = useReaderStore((state) => state.resetZoom);
  const restorePreAreaZoom = useReaderStore((state) => state.restorePreAreaZoom);

  const isAreaZoomActive = useAppStore((state) => Boolean(state.isAreaZoomActive));
  const toggleAreaZoom = useAppStore((state) => state.toggleAreaZoom);
  const showToast = useAppStore((state) => state.showToast);

  const filePath = comicData?.filePath || comicData?.path || '';
  const normPath = filePath ? filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase() : '';

  const isFav = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return false;
        return (state.favorites || []).some(
          (f) => (f.path || f.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() === normPath
        );
      },
      [normPath]
    )
  );
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);

  const zoomStep = useSettingsStore((state) => state.preferences?.zoomStep || 0.1);
  const defaultZoom = useSettingsStore((state) => state.preferences?.defaultZoom || 1.0);

  const [isPulsing, setIsPulsing] = useState(false);
  const [isLocalHovered, setIsLocalHovered] = useState(false);
  const [isNearBottomEdge, setIsNearBottomEdge] = useState(false);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [initialBriefShow, setInitialBriefShow] = useState(false);

  // مرحله ۴۹ §۲: سرکوبِ موقتِ اتوهاید وسطِ ژستِ حاشیه‌نویسی.
  // پرچمِ window.__isAnnotationGestureActive را کارگرِ A در
  // AnnotationLayer.jsx می‌گذارد؛ اینجا فقط خوانده می‌شود و هرگز
  // گذاشته نمی‌شود. تا وقتی ژست فعال است، داک باز نمی‌شود.
  const [isGestureSuppressed, setIsGestureSuppressed] = useState(false);
  const isGestureSuppressedRef = useRef(false);
  const lastPointerPosRef = useRef({ x: -1, y: -1 });
  const gestureSyncTimerRef = useRef(null);
  const gesturePollTimerRef = useRef(null);
  const prevGestureSuppressedRef = useRef(false);

  const syncGestureFlag = useCallback(() => {
    const active = typeof window !== 'undefined' && window.__isAnnotationGestureActive === true;
    if (active !== isGestureSuppressedRef.current) {
      isGestureSuppressedRef.current = active;
      setIsGestureSuppressed(active);
    }
  }, []);

  const dockRef = useRef(null);
  const pulseTimerRef = useRef(null);
  const hideDelayTimerRef = useRef(null);
  const pointerDownRef = useRef({ x: 0, y: 0, time: 0 });

  // ۱. نمایش کوتاه ۱.۱ ثانیه‌ای فقط در لحظه باز شدن کمیک و سپس مخفی شدن سریع
  useEffect(() => {
    if (!filePath) return;
    setInitialBriefShow(true);
    const timer = setTimeout(() => {
      setInitialBriefShow(false);
    }, 1100);
    return () => clearTimeout(timer);
  }, [filePath]);

  // ۲. سنسور مجاورت لبه پایین صفحه + مخفی شدن آنی با کلیک در وسط صفحه (فیلتر لرزش ماوس <= 6px)
  useEffect(() => {
    const handleWindowMouseMove = (e) => {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
      // مرحله ۴۹ §۲: وسطِ ژستِ حاشیه‌نویسی، سنسورِ لبهٔ پایین
      // چیزی را باز نمی‌کند.
      if (isGestureSuppressedRef.current) return;
      const distFromBottom = window.innerHeight - e.clientY;
      const centerDist = Math.abs(e.clientX - window.innerWidth / 2);
      const nearZone = distFromBottom <= 64 && centerDist <= 260;

      if (nearZone) {
        if (hideDelayTimerRef.current) {
          clearTimeout(hideDelayTimerRef.current);
          hideDelayTimerRef.current = null;
        }
        setIsNearBottomEdge(true);
      } else if (isNearBottomEdge && !isLocalHovered && !isDraggingSlider) {
        if (!hideDelayTimerRef.current) {
          hideDelayTimerRef.current = setTimeout(() => {
            setIsNearBottomEdge(false);
            hideDelayTimerRef.current = null;
          }, 350);
        }
      }
    };

    const handlePointerDown = (e) => {
      pointerDownRef.current = {
        x: e.clientX,
        y: e.clientY,
        time: Date.now(),
      };
    };

    const handlePointerUp = (e) => {
      setIsDraggingSlider(false);

      const { x, y, time } = pointerDownRef.current;
      const dist = Math.hypot(e.clientX - x, e.clientY - y);
      const elapsed = Date.now() - time;

      // تفکیک کلیک از لرزش ماوس (<= 6px) و بستن فوری در صورت کلیک خارج از محدوده‌های کناری
      if (dist <= 6 && elapsed < 380) {
        const clickedInsideDock = dockRef.current?.contains(e.target);
        const inEdgeZones =
          e.clientY <= 62 ||
          e.clientY >= window.innerHeight - 72 ||
          e.clientX <= 60 ||
          e.clientX >= window.innerWidth - 60;

        if (!clickedInsideDock && !inEdgeZones) {
          if (hideDelayTimerRef.current) {
            clearTimeout(hideDelayTimerRef.current);
            hideDelayTimerRef.current = null;
          }
          setInitialBriefShow(false);
          setIsNearBottomEdge(false);
          setIsLocalHovered(false);
        }
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [isNearBottomEdge, isLocalHovered, isDraggingSlider]);

  // مرحله ۴۹ §۲: همگام‌سازیِ پرچم با تأخیرِ صفر — هندلرِ کارگرِ A
  // اول پرچم را می‌گذارد/پاک می‌کند، بعد این خوانش انجام می‌شود.
  useEffect(() => {
    const scheduleSync = () => {
      if (gestureSyncTimerRef.current) clearTimeout(gestureSyncTimerRef.current);
      gestureSyncTimerRef.current = setTimeout(syncGestureFlag, 0);
    };
    window.addEventListener('pointerdown', scheduleSync, { passive: true });
    window.addEventListener('pointerup', scheduleSync, { passive: true });
    window.addEventListener('pointercancel', scheduleSync, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', scheduleSync);
      window.removeEventListener('pointerup', scheduleSync);
      window.removeEventListener('pointercancel', scheduleSync);
      if (gestureSyncTimerRef.current) {
        clearTimeout(gestureSyncTimerRef.current);
        gestureSyncTimerRef.current = null;
      }
    };
  }, [syncGestureFlag]);

  // مرحله ۴۹ §۲: تا وقتی سرکوب فعال است، هر ۱۵۰ میلی‌ثانیه پرچم
  // دوباره خوانده می‌شود تا اگر رویدادِ pointerup از دست رفت،
  // pointerEvents برایِ همیشه رویِ none نماند.
  useEffect(() => {
    if (!isGestureSuppressed) return undefined;
    gesturePollTimerRef.current = setInterval(syncGestureFlag, 150);
    return () => {
      if (gesturePollTimerRef.current) {
        clearInterval(gesturePollTimerRef.current);
        gesturePollTimerRef.current = null;
      }
    };
  }, [isGestureSuppressed, syncGestureFlag]);

  // مرحله ۴۹ §۲: اگر پرچم وقتی پاک شد که نشانگر از قبل در ناحیهٔ
  // لبهٔ پایین بود، داک باید بتواند دوباره باز شود؛ سنسورِ
  // mousemove تا حرکتِ بعدیِ ماوس چیزی نمی‌گوید، پس ناحیه را با
  // آخرین موقعیتِ ذخیره‌شده دوباره می‌سنجیم.
  useEffect(() => {
    const wasSuppressed = prevGestureSuppressedRef.current;
    prevGestureSuppressedRef.current = isGestureSuppressed;
    if (!wasSuppressed || isGestureSuppressed) return;
    const pos = lastPointerPosRef.current;
    if (pos.x < 0 || typeof window === 'undefined') return;
    const distFromBottom = window.innerHeight - pos.y;
    const centerDist = Math.abs(pos.x - window.innerWidth / 2);
    if (distFromBottom <= 64 && centerDist <= 260) {
      if (hideDelayTimerRef.current) {
        clearTimeout(hideDelayTimerRef.current);
        hideDelayTimerRef.current = null;
      }
      setIsNearBottomEdge(true);
    }
  }, [isGestureSuppressed]);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      if (hideDelayTimerRef.current) clearTimeout(hideDelayTimerRef.current);
      if (gesturePollTimerRef.current) clearInterval(gesturePollTimerRef.current);
      if (gestureSyncTimerRef.current) clearTimeout(gestureSyncTimerRef.current);
    };
  }, []);

  const handleToggleFavorite = useCallback(
    (e) => {
      e.stopPropagation();
      if (!filePath || !comicData) return;

      setIsPulsing(true);
      if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current);
      pulseTimerRef.current = setTimeout(() => setIsPulsing(false), 320);

      const comicPayload = {
        path: filePath,
        name: comicData.fileName || comicData.name || filePath.split(/[\\/]/).pop(),
        cover: comicData.cover || comicData.items?.[0]?.path || null,
        totalPages: comicData.items?.length || comicData.savedTotalPages || 1,
        lastPage: useReaderStore.getState().currentPage || 1,
        fileSize: comicData.fileSize || '',
      };

      const added = toggleFavorite(comicPayload);
      showToast(
        added ? 'به علاقه‌مندی‌ها اضافه شد' : 'از علاقه‌مندی‌ها حذف شد',
        { type: added ? 'success' : 'info' }
      );
    },
    [filePath, comicData, toggleFavorite, showToast]
  );

  if (!comicData) return null;

  // Minimum zoom lowered from 40% to 10% (0.1) per user requirement
  const minZoom = 0.1;
  const maxZoom = 3.5;
  const displayZoom = Math.round(zoomLevel * 100);
  const fillPercentage = Math.min(
    100,
    Math.max(0, ((zoomLevel - minZoom) / (maxZoom - minZoom)) * 100)
  );

  // مرحله ۴۹ §۲: وسطِ ژستِ حاشیه‌نویسی، داک هرگز باز نمی‌شود؛ با
  // false شدنِ effectiveShow، pointerEvents در استایلِ داک هم
  // خودبه‌خود none می‌شود.
  const effectiveShow =
    !isGestureSuppressed &&
    (isLocalHovered || isNearBottomEdge || isDraggingSlider || initialBriefShow);

  const handleZoomChange = (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      setZoomLevel(val);
    }
  };

  const handleStepZoom = (delta) => {
    const nextZoom = Math.min(maxZoom, Math.max(minZoom, zoomLevel + delta));
    setZoomLevel(parseFloat(nextZoom.toFixed(2)));
  };

  const handleResetZoomClick = (e) => {
    e.stopPropagation();
    if (preAreaZoomLevel !== null) {
      restorePreAreaZoom();
      showToast('بازگشت به بزرگ‌نمایی قبلی انجام شد', { type: 'info' });
      return;
    }
    if (resetZoom) {
      resetZoom();
    } else {
      setZoomLevel(defaultZoom);
    }
    showToast(`بزرگ‌نمایی روی ${Math.round(defaultZoom * 100)}% تنظیم شد`, { type: 'info' });
  };

  const handleAreaZoomClick = (e) => {
    e.stopPropagation();
    const active = toggleAreaZoom?.();
    if (active) {
      showToast('کادر مورد نظر را با ماوس بکشید تا بزرگ‌نمایی شود', { type: 'info' });
    }
  };

  return (
    <div
      ref={dockRef}
      onMouseEnter={(e) => {
        // مرحله ۴۹ §۲: نگهبانِ دومِ داک — اگر هاور از قبل شروع شده
        // بود، وسطِ ژست چیزی باز نمی‌شود.
        if (isGestureSuppressedRef.current) return;
        if (hideDelayTimerRef.current) {
          clearTimeout(hideDelayTimerRef.current);
          hideDelayTimerRef.current = null;
        }
        setIsLocalHovered(true);
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        setIsLocalHovered(false);
        onMouseLeave?.(e);
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        ...styles.dockContainer,
        transformOrigin: 'bottom center',
        transform: effectiveShow
          ? 'translate3d(-50%, 0, 0) scaleX(1) scaleY(1)'
          : 'translate3d(-50%, 34px, 0) scaleX(1.18) scaleY(0.32)',
        opacity: effectiveShow ? 1 : 0,
        filter: effectiveShow ? 'blur(0px)' : 'blur(5px)',
        pointerEvents: effectiveShow ? 'auto' : 'none',
      }}
    >
      <button
        type="button"
        onClick={handleToggleFavorite}
        style={{
          ...styles.iconBtn,
          color: isFav ? 'var(--danger)' : 'var(--muted)',
          transform: isPulsing ? 'scale(1.3)' : 'scale(1)',
          filter: isFav ? 'drop-shadow(0 0 8px rgba(248, 81, 73, 0.65))' : 'none',
        }}
        title={isFav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
      >
        <Icons.Heart size={17} filled={isFav} />
      </button>

      <div style={styles.divider} />

      <div style={styles.zoomSection}>
        <button
          type="button"
          onClick={() => handleStepZoom(-zoomStep)}
          onMouseUp={(e) => { e.currentTarget.blur(); }}
          onPointerUp={(e) => { e.currentTarget.blur(); }}
          style={styles.stepBtn}
          title={`کوچک‌نمایی (-${Math.round(zoomStep * 100)}%)`}
        >
          <Icons.Minus size={13} />
        </button>

        <div style={styles.sliderTrackWrapper}>
          <input
            type="range"
            min={minZoom}
            max={maxZoom}
            step="0.05"
            value={zoomLevel}
            onPointerDown={() => setIsDraggingSlider(true)}
            onPointerUp={(e) => { setIsDraggingSlider(false); e.currentTarget.blur(); }}
            onMouseUp={(e) => { e.currentTarget.blur(); }}
            onKeyDown={(e) => {
              // مرحله ۲۲ — اسلایدرِ زوم، هرگز با کلیدهایِ جهت‌نما
              // زوم نمی‌کند: رفتارِ پیش‌فرضِ مرورگر خلع و فوکوس
              // برداشته می‌شود تا شورت‌کاتِ کاربر (مثلِ ArrowRight
              // برایِ فایلِ بعدی) اجرا شود.
              if (['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onChange={(e) => { handleZoomChange(e); e.currentTarget.blur(); }}
            style={{
              ...styles.zoomSlider,
              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${fillPercentage}%, rgba(255, 255, 255, 0.14) ${fillPercentage}%, rgba(255, 255, 255, 0.14) 100%)`,
            }}
            title={`سطح زوم: ${displayZoom}%`}
          />
        </div>

        <button
          type="button"
          onClick={() => handleStepZoom(zoomStep)}
          onMouseUp={(e) => { e.currentTarget.blur(); }}
          onPointerUp={(e) => { e.currentTarget.blur(); }}
          style={styles.stepBtn}
          title={`بزرگ‌نمایی (+${Math.round(zoomStep * 100)}%)`}
        >
          <Icons.Plus size={13} />
        </button>

        <span style={styles.zoomBadge}>{displayZoom}%</span>
      </div>

      <div style={styles.divider} />

      <button
        type="button"
        onClick={handleAreaZoomClick}
        style={{
          ...styles.iconBtn,
          color: isAreaZoomActive ? 'var(--accent)' : 'var(--text)',
          backgroundColor: isAreaZoomActive ? 'rgba(34, 211, 238, 0.18)' : 'transparent',
        }}
        title="زوم ناحیه‌ای با کشیدن باکس (Alt + Z)"
      >
        {Icons.ScanSearch ? <Icons.ScanSearch size={16} /> : <Icons.ZoomIn size={16} />}
      </button>

      <button
        type="button"
        onClick={handleResetZoomClick}
        style={{
          ...styles.iconBtn,
          color: preAreaZoomLevel !== null ? 'var(--accent)' : 'var(--text)',
        }}
        title={
          preAreaZoomLevel !== null
            ? 'بازگشت از زوم باکسی به نمای قبلی'
            : `بازنشانی زوم به ${Math.round(defaultZoom * 100)}%`
        }
      >
        <Icons.Maximize size={15} />
      </button>
    </div>
  );
}

const styles = {
  dockContainer: {
    // مرحله ۴ ـ بخش ب: چیدمانِ داک همیشه چپ‌به‌راست است (قلب چپ،
    // زوم و دکمه‌ها به ترتیبِ قبل از dir="rtl")؛ جهتِ سند، ترتیبِ
    // فلکس و جهتِ اسلایدرِ range (و گرادیانِ پرشدگی‌اش) را برعکس
    // کرده بود.
    direction: 'ltr',
    position: 'absolute',
    bottom: '18px',
    left: '50%',
    height: '46px',
    padding: '0 14px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: 'rgba(10, 15, 19, 0.92)',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
    borderRadius: '30px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.22)',
    boxShadow: '0 12px 36px rgba(0, 0, 0, 0.72), 0 0 14px rgba(34, 211, 238, 0.08)',
    zIndex: 48,
    transition:
      'transform 0.34s cubic-bezier(0.22, 1.15, 0.36, 1), opacity 0.22s ease, filter 0.24s ease',
    willChange: 'transform, opacity, filter',
    userSelect: 'none',
  },
  divider: {
    width: '1px',
    height: '18px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  iconBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    transition: 'transform 0.2s ease, color 0.18s ease, background-color 0.18s ease',
    outline: 'none',
    padding: 0,
  },
  zoomSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  stepBtn: {
    background: 'rgba(255, 255, 255, 0.05)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(255, 255, 255, 0.1)',
    color: 'var(--text)',
    cursor: 'pointer',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.18s ease',
    outline: 'none',
    padding: 0,
  },
  sliderTrackWrapper: {
    width: '130px',
    display: 'flex',
    alignItems: 'center',
  },
  zoomSlider: {
    width: '100%',
    height: '5px',
    borderRadius: '3px',
    appearance: 'none',
    WebkitAppearance: 'none',
    outline: 'none',
    cursor: 'pointer',
  },
  zoomBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: '700',
    color: 'var(--accent)',
    minWidth: '42px',
    textAlign: 'center',
    fontVariantNumeric: 'tabular-nums',
    direction: 'ltr',
  },
};