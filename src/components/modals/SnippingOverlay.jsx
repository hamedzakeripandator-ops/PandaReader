import React, { useState, useRef, useEffect, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';

export default function SnippingOverlay() {
  const { isSnippingActive, setIsSnippingActive } = useAppStore();

  const [isDrawing, setIsDrawing] = useState(false);
  const [startPos, setStartPos] = useState({ x: 0, y: 0 });
  const [currentPos, setCurrentPos] = useState({ x: 0, y: 0 });
  const [cropRect, setCropRect] = useState(null);

  // بستن ابزار با کلید Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsSnippingActive(false);
      }
    };
    if (isSnippingActive) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSnippingActive, setIsSnippingActive]);

  // ثبت عمومی حرکات و رها شدن کلیک در کل پنجره (جلوگیری از گیر کردن ماوس بیرون پنجره)
  useEffect(() => {
    if (!isDrawing) return;

    const handleWindowMouseMove = (e) => {
      setCurrentPos({ x: e.clientX, y: e.clientY });
    };

    const handleWindowMouseUp = (e) => {
      setIsDrawing(false);

      const x = Math.min(startPos.x, e.clientX);
      const y = Math.min(startPos.y, e.clientY);
      const width = Math.abs(e.clientX - startPos.x);
      const height = Math.abs(e.clientY - startPos.y);

      if (width > 12 && height > 12) {
        setCropRect({ x, y, width, height });
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isDrawing, startPos]);

  if (!isSnippingActive) return null;

  const handleMouseDown = (e) => {
    if (e.button !== 0) return; // تنها کلیک چپ
    e.preventDefault();
    setIsDrawing(true);
    setStartPos({ x: e.clientX, y: e.clientY });
    setCurrentPos({ x: e.clientX, y: e.clientY });
    setCropRect(null);
  };

  // استخراج با کیفیت کریستالی (Natural Resolution)
  const captureSelectedArea = async (actionType = 'save') => {
    if (!cropRect) return;

    try {
      const images = Array.from(document.querySelectorAll('.comic-page-item img'));
      
      // محاسبه ضریب کیفیت جهت جلوگیری از مات شدن تصویر
      let qualityScale = 1;
      images.forEach((img) => {
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && img.naturalWidth > 0) {
          qualityScale = Math.max(qualityScale, img.naturalWidth / rect.width);
        }
      });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(cropRect.width * qualityScale);
      canvas.height = Math.round(cropRect.height * qualityScale);

      if (canvas.width <= 0 || canvas.height <= 0) return;

      const ctx = canvas.getContext('2d');

      images.forEach((img) => {
        const rect = img.getBoundingClientRect();

        // بررسی دقیق تداخل هندسی با حاشیه امن
        const hasOverlap = !(
          rect.right <= cropRect.x ||
          rect.left >= cropRect.x + cropRect.width ||
          rect.bottom <= cropRect.y ||
          rect.top >= cropRect.y + cropRect.height
        );

        if (hasOverlap && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const scaleX = img.naturalWidth / rect.width;
          const scaleY = img.naturalHeight / rect.height;

          const intersectLeft = Math.max(cropRect.x, rect.left);
          const intersectTop = Math.max(cropRect.y, rect.top);
          const intersectRight = Math.min(cropRect.x + cropRect.width, rect.right);
          const intersectBottom = Math.min(cropRect.y + cropRect.height, rect.bottom);

          const intersectW = intersectRight - intersectLeft;
          const intersectH = intersectBottom - intersectTop;

          // جلوگیری قطعی از خطای IndexSizeError در رسم ابعاد صفر یا منفی
          if (intersectW > 0 && intersectH > 0) {
            const sx = (intersectLeft - rect.left) * scaleX;
            const sy = (intersectTop - rect.top) * scaleY;
            const sWidth = intersectW * scaleX;
            const sHeight = intersectH * scaleY;

            const dx = (intersectLeft - cropRect.x) * qualityScale;
            const dy = (intersectTop - cropRect.y) * qualityScale;
            const dWidth = intersectW * qualityScale;
            const dHeight = intersectH * qualityScale;

            try {
              ctx.drawImage(img, sx, sy, sWidth, sHeight, dx, dy, dWidth, dHeight);
            } catch (err) {
              console.error('Canvas slice drawing error:', err);
            }
          }
        }
      });

      const dataUrl = canvas.toDataURL('image/png', 1.0);

      if (actionType === 'clipboard') {
        await window.api?.copyImageToClipboard({ dataUrl });
      } else {
        await window.api?.saveScreenshot({ 
          dataUrl, 
          defaultName: `crop_${Date.now()}.png` 
        });
      }
    } catch (err) {
      console.error('Snipping capture failed:', err);
    } finally {
      setIsSnippingActive(false);
    }
  };

  const curX = Math.min(startPos.x, currentPos.x);
  const curY = Math.min(startPos.y, currentPos.y);
  const curW = Math.abs(currentPos.x - startPos.x);
  const curH = Math.abs(currentPos.y - startPos.y);

  const rect = cropRect || (isDrawing ? { x: curX, y: curY, width: curW, height: curH } : null);

  // محاسبه موقعیت شناور نوار ابزار تا هرگز از مانیتور خارج نشود
  const getToolbarCoords = () => {
    if (!rect) return { left: 0, top: 0 };
    const tbWidth = 180;
    const tbHeight = 40;

    let left = rect.x + rect.width - tbWidth;
    left = Math.max(12, Math.min(left, window.innerWidth - tbWidth - 12));

    let top = rect.y + rect.height + 8;
    if (top + tbHeight > window.innerHeight - 12) {
      top = rect.y - tbHeight - 8;
      if (top < 12) top = 12;
    }

    return { left, top };
  };

  const toolbarPos = getToolbarCoords();

  return (
    <div
      onMouseDown={handleMouseDown}
      style={styles.overlay}
    >
      {/* راهنمای بالای صفحه */}
      {!cropRect && !isDrawing && (
        <div style={styles.hintBadge}>
          مستطیل دلخواه را با درگ ماوس مشخص کنید (کلید ESC برای لغو)
        </div>
      )}

      {/* مستطیل برش */}
      {rect && (
        <div
          style={{
            ...styles.cropBox,
            left: `${rect.x}px`,
            top: `${rect.y}px`,
            width: `${rect.width}px`,
            height: `${rect.height}px`,
          }}
        >
          {/* نشانگر اندازه فریم */}
          <div style={styles.dimBadge}>
            {Math.round(rect.width)} × {Math.round(rect.height)} px
          </div>
        </div>
      )}

      {/* نوار اکشن‌ها با مختصات مستقل از لبه‌ها */}
      {cropRect && (
        <div 
          style={{
            ...styles.actionToolbar,
            left: `${toolbarPos.left}px`,
            top: `${toolbarPos.top}px`,
          }} 
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button 
            onClick={() => captureSelectedArea('clipboard')} 
            style={styles.toolBtn}
            title="کپی مستقیم در کلیپ‌بورد"
          >
            📋 کپی
          </button>
          <button 
            onClick={() => captureSelectedArea('save')} 
            style={{ ...styles.toolBtn, ...styles.primaryBtn }}
            title="ذخیره روی دیسک"
          >
            💾 ذخیره
          </button>
          <button 
            onClick={() => setIsSnippingActive(false)} 
            style={styles.toolBtn}
            title="انصراف"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    cursor: 'crosshair',
    zIndex: 99999,
    userSelect: 'none',
  },
  hintBadge: {
    position: 'absolute',
    top: '26px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(21, 26, 33, 0.94)',
    backdropFilter: 'blur(14px)',
    color: '#e6edf3',
    padding: '8px 20px',
    borderRadius: '24px',
    fontSize: '12px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
    pointerEvents: 'none',
  },
  cropBox: {
    position: 'absolute',
    border: '2px solid #00BCD4',
    backgroundColor: 'rgba(0, 188, 212, 0.08)',
    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.55)',
    pointerEvents: 'none',
  },
  dimBadge: {
    position: 'absolute',
    top: '-24px',
    left: 0,
    backgroundColor: '#00BCD4',
    color: '#000',
    fontSize: '10px',
    fontWeight: 'bold',
    padding: '2px 6px',
    borderRadius: '3px',
    fontFamily: 'monospace',
  },
  actionToolbar: {
    position: 'fixed',
    display: 'flex',
    gap: '6px',
    backgroundColor: 'rgba(21, 26, 33, 0.95)',
    backdropFilter: 'blur(14px)',
    padding: '4px 6px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.7)',
    zIndex: 100000,
    direction: 'rtl',
  },
  toolBtn: {
    background: 'rgba(255, 255, 255, 0.05)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    color: '#e6edf3',
    padding: '5px 10px',
    borderRadius: '6px',
    fontSize: '11px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    transition: 'background 0.15s ease',
  },
  primaryBtn: {
    backgroundColor: '#00BCD4',
    borderColor: '#00BCD4',
    color: '#000',
    fontWeight: 'bold',
  },
};