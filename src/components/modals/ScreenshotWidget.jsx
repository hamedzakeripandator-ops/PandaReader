import React, { useState, useEffect, useRef, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';
import { coreApi } from '../../services/coreApi';

export default function ScreenshotWidget() {
  const { 
    isScreenshotModalOpen, 
    closeScreenshotModal, 
    setIsSnippingActive,
    activeCaptureTarget 
  } = useAppStore();

  const { comicData, currentPage } = useReaderStore();

  const [selectedFormat, setSelectedFormat] = useState('png');
  const [toastMessage, setToastMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const isMountedRef = useRef(true);
  const feedbackTimerRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // بستن نرم ویجت با فشردن کلید Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isScreenshotModalOpen) {
        e.preventDefault();
        closeScreenshotModal();
      }
    };

    if (isScreenshotModalOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isScreenshotModalOpen, closeScreenshotModal]);

  // نمایش بازخورد بصری کپسولی درون ویجت
  const showFeedback = useCallback((text, shouldClose = true) => {
    if (!isMountedRef.current) return;
    setToastMessage(text);

    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setToastMessage('');
        if (shouldClose) {
          closeScreenshotModal();
        }
      }
    }, 750);
  }, [closeScreenshotModal]);

  if (!isScreenshotModalOpen || !comicData) return null;

  // محاسبه ایمن و دقیق شماره صفحه و آدرس تصویر
  const totalPages = comicData.items?.length || 1;
  const rawIndex = activeCaptureTarget?.pageIndex ?? (currentPage - 1);
  const safeIndex = Math.max(0, Math.min(rawIndex, totalPages - 1));
  const targetItem = comicData.items?.[safeIndex];
  const pageNumber = safeIndex + 1;

  // ۱. شروع حالت برش کادر دلخواه با ماوس (Snipping Mode)
  const handleStartSnipping = () => {
    closeScreenshotModal();
    setIsSnippingActive(true);
  };

  // ۲. کپی مستقیم صفحه در کلیپ‌بورد با بای‌پاس سریع کانواس
  const handleCopyPage = async () => {
    if (!targetItem?.path || isProcessing) return;
    setIsProcessing(true);

    try {
      // تلاش مستقیم با بافر فایل دیسک بدون درگیر کردن حافظه و بوم
      const res = await coreApi.copyImageToClipboard({ filePath: targetItem.path });
      if (res?.success) {
        showFeedback('کپی شد! ✅');
      } else {
        // فال‌بک از طریق کانواس در صورت بروز محدودیت سیستمی
        copyViaCanvas();
        return;
      }
    } catch (err) {
      copyViaCanvas();
      return;
    } finally {
      if (isMountedRef.current) setIsProcessing(false);
    }
  };

  const copyViaCanvas = () => {
    const img = new Image();
    img.src = `comic://media?path=${encodeURIComponent(targetItem.path)}`;
    img.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const dataUrl = canvas.toDataURL('image/png', 1.0);
        const res = await coreApi.copyImageToClipboard({ dataUrl });
        if (res?.success) {
          showFeedback('کپی شد! ✅');
        } else {
          showFeedback('خطا در کپی ❌', false);
        }
      } catch (e) {
        showFeedback('خطا در کپی ❌', false);
      } finally {
        if (isMountedRef.current) setIsProcessing(false);
      }
    };
    img.onerror = () => {
      showFeedback('خطا در لود تصویر ❌', false);
      if (isMountedRef.current) setIsProcessing(false);
    };
  };

  // ۳. ذخیره تصویر صفحه با کیفیت کریستالی و پشتیبانی از فرمت‌های PNG / JPG
  const handleSavePage = async () => {
    if (!targetItem?.path || isProcessing) return;
    setIsProcessing(true);

    try {
      const img = new Image();
      img.src = `comic://media?path=${encodeURIComponent(targetItem.path)}`;

      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');

          // در صورت تبدیل به JPG، پس‌زمینه سفید برای جلوگیری از تیرگی ترنسپرنسی اضافه می‌شود
          if (selectedFormat === 'jpg') {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }

          ctx.drawImage(img, 0, 0);

          const mimeType = selectedFormat === 'png' ? 'image/png' : 'image/jpeg';
          const quality = selectedFormat === 'png' ? 1.0 : 0.94;
          const dataUrl = canvas.toDataURL(mimeType, quality);
          const defaultName = `${comicData.fileName}_P${pageNumber}.${selectedFormat}`;

          const saveRes = await coreApi.saveScreenshot({ dataUrl, defaultName });

          if (saveRes?.success) {
            showFeedback('ذخیره شد! 💾');
          } else if (!saveRes?.canceled) {
            showFeedback('خطا در ذخیره ❌', false);
          }
        } catch (innerErr) {
          showFeedback('خطا در پردازش ❌', false);
        } finally {
          if (isMountedRef.current) setIsProcessing(false);
        }
      };

      img.onerror = () => {
        showFeedback('خطا در بازخوانی فایل ❌', false);
        if (isMountedRef.current) setIsProcessing(false);
      };
    } catch (err) {
      showFeedback('خطا در عملیات ❌', false);
      if (isMountedRef.current) setIsProcessing(false);
    }
  };

  return (
    <>
      {/* لایه نامرئی بیرونی جهت بستن خودکار با کلیک در هر نقطه از صفحه */}
      <div 
        style={styles.backdropDismiss} 
        onClick={closeScreenshotModal} 
        aria-hidden="true" 
      />

      {/* داک ابزار کپسولی شیشه‌ای شناور */}
      <aside 
        style={styles.dockContainer}
        onClick={(e) => e.stopPropagation()}
        aria-label="داک ابزار اسکرین‌شات"
      >
        {/* مشخصات صفحه فعال */}
        <div style={styles.badgeInfo}>
          <span style={styles.badgeIcon}>✂️</span>
          <span style={styles.badgeText}>ص {pageNumber}</span>
        </div>

        <div style={styles.verticalDivider} />

        {/* دکمه‌های اکشن سریع */}
        <div style={styles.actionsRow}>
          <button 
            onClick={handleStartSnipping}
            style={styles.actionBtn}
            title="برش دستی کادر با ماوس (Snipping)"
            disabled={isProcessing}
          >
            <span style={styles.btnIcon}>📐</span>
            <span>کادر انتخابی</span>
          </button>

          <button 
            onClick={handleCopyPage}
            disabled={isProcessing}
            style={styles.actionBtn}
            title="کپی کل صفحه در کلیپ‌بورد سیستم"
          >
            <span style={styles.btnIcon}>📋</span>
            <span>کپی صفحه</span>
          </button>

          <button 
            onClick={handleSavePage}
            disabled={isProcessing}
            style={styles.actionBtn}
            title="ذخیره کامل صفحه روی دیسک"
          >
            <span style={styles.btnIcon}>💾</span>
            <span>ذخیره فایل</span>
          </button>
        </div>

        <div style={styles.verticalDivider} />

        {/* سوییچ سریع فرمت */}
        <button 
          onClick={() => setSelectedFormat((f) => (f === 'png' ? 'jpg' : 'png'))}
          style={styles.formatToggleBtn}
          title="تغییر فرمت ذخیره‌سازی (PNG / JPG)"
          disabled={isProcessing}
        >
          {selectedFormat.toUpperCase()}
        </button>

        {/* دکمه بستن */}
        <button 
          onClick={closeScreenshotModal} 
          style={styles.closeBtn}
          title="بستن داک (Escape)"
        >
          ✕
        </button>

        {/* پاپ‌آپ بازخورد درون داک */}
        {toastMessage && (
          <div style={styles.dockToast}>
            {toastMessage}
          </div>
        )}
      </aside>
    </>
  );
}

const styles = {
  backdropDismiss: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9998,
    backgroundColor: 'transparent',
  },
  dockContainer: {
    position: 'fixed',
    top: '32px',
    left: '50%',
    transform: 'translateX(-50%)',
    height: '46px',
    padding: '0 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'rgba(21, 26, 33, 0.92)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '26px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    boxShadow: '0 14px 40px rgba(0, 0, 0, 0.75), 0 0 1px rgba(255, 255, 255, 0.2)',
    zIndex: 9999,
    direction: 'rtl',
    userSelect: 'none',
    animation: 'contextMenuFadeIn 0.14s cubic-bezier(0.16, 1, 0.3, 1)',
  },
  badgeInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0 4px',
  },
  badgeIcon: {
    fontSize: '14px',
  },
  badgeText: {
    fontSize: '11px',
    fontWeight: '600',
    color: '#00BCD4',
    fontVariantNumeric: 'tabular-nums',
  },
  verticalDivider: {
    width: '1px',
    height: '20px',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    background: 'transparent',
    border: 'none',
    color: '#e6edf3',
    padding: '6px 10px',
    borderRadius: '16px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: '500',
    transition: 'background-color 0.12s ease, transform 0.08s ease',
  },
  btnIcon: {
    fontSize: '13px',
  },
  formatToggleBtn: {
    background: 'rgba(255, 255, 255, 0.06)',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: '#00BCD4',
    padding: '3px 8px',
    borderRadius: '12px',
    fontSize: '10px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'background-color 0.12s ease',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary, #8b949e)',
    fontSize: '13px',
    width: '26px',
    height: '26px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '50%',
    cursor: 'pointer',
    transition: 'color 0.12s ease',
  },
  dockToast: {
    position: 'absolute',
    top: '52px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(10, 14, 20, 0.95)',
    border: '1px solid #00BCD4',
    color: '#00BCD4',
    padding: '4px 14px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: '600',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.65)',
    whiteSpace: 'nowrap',
    animation: 'contextMenuFadeIn 0.12s ease',
  },
};