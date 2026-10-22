import React, { useState, useRef, useEffect, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';
import Icons from '../common/Icons';

export default function AreaZoomOverlay() {
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
      const scrollContainer =
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
        Math.max(0.6, Number((currentZoom * scaleMultiplier).toFixed(2)))
      );

      const boxCenterX = box.x + box.width / 2;
      const boxCenterY = box.y + box.height / 2;

      let normCenterX = 0.5;
      let normCenterY = 0.5;
      let pageNumber = null;
      let pageRelativeY = 0.5;

      // تشخیص صفحه دقیق زیر مرکز باکس برای قفل بدون خطای اسکرول
      const elementsAtCenter = document.elementsFromPoint(boxCenterX, boxCenterY);
      const pageEl = elementsAtCenter.find((el) =>
        el.classList?.contains('comic-page-item')
      );

      if (pageEl) {
        const pRect = pageEl.getBoundingClientRect();
        const rawPage = pageEl.getAttribute('data-page');
        const rawIdx = pageEl.getAttribute('data-index');
        pageNumber = rawPage
          ? parseInt(rawPage, 10)
          : rawIdx !== null
          ? parseInt(rawIdx, 10) + 1
          : null;

        if (pRect.width > 0 && pRect.height > 0) {
          normCenterX = Math.max(0, Math.min(1, (boxCenterX - pRect.left) / pRect.width));
          pageRelativeY = Math.max(0, Math.min(1, (boxCenterY - pRect.top) / pRect.height));
        }
      }

      if (scrollContainer) {
        const cRect = scrollContainer.getBoundingClientRect();
        const contentX = scrollContainer.scrollLeft + (boxCenterX - cRect.left);
        const contentY = scrollContainer.scrollTop + (boxCenterY - cRect.top);

        normCenterX =
          scrollContainer.scrollWidth > 0
            ? contentX / scrollContainer.scrollWidth
            : normCenterX;
        normCenterY =
          scrollContainer.scrollHeight > 0
            ? contentY / scrollContainer.scrollHeight
            : 0.5;
      }

      applyAreaZoom({
        targetZoom: computedZoom,
        normCenterX,
        normCenterY,
        rect: {
          ...box,
          pageNumber,
          pageRelativeY,
        },
      });

      setIsAreaZoomActive(false);
      showToast(`بزرگ‌نمایی ناحیه‌ای روی ${Math.round(computedZoom * 100)}% قفل شد`, {
        type: 'success',
      });
    },
    [dragBox, applyAreaZoom, setIsAreaZoomActive, showToast]
  );

  if (!comicData) return null;

  // محاسبه زوم تخمینی زنده هنگام کشیدن کادر
  let previewZoomPercent = Math.round(zoomLevel * 100);
  if (dragBox && dragBox.width >= 28 && dragBox.height >= 28) {
    const mult =
      Math.min(window.innerWidth / dragBox.width, window.innerHeight / dragBox.height) *
      0.88;
    previewZoomPercent = Math.round(Math.min(3.5, Math.max(0.6, zoomLevel * mult)) * 100);
  }

  return (
    <>
      {/* ۱. کپسول شناور بازگشت سریع به زوم قبلی (زمانی که زوم باکسی اعمال شده باشد) */}
      {!isAreaZoomActive && preAreaZoomLevel !== null && (
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
          {/* بنر راهنمای بالای صفحه */}
          <div style={styles.topInstructionBanner}>
            <Icons.ScanSearch size={16} />
            <span>کادر مورد نظر برای بزرگ‌نمایی را با ماوس بکشید</span>
            <span style={styles.escBadge}>Esc = لغو</span>
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
    gap: '10px',
    padding: '8px 18px',
    borderRadius: '24px',
    backgroundColor: 'rgba(13, 18, 24, 0.94)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(167, 139, 250, 0.45)',
    color: '#e6edf3',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 700,
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.7)',
    pointerEvents: 'none',
    direction: 'rtl',
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