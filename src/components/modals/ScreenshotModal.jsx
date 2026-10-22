import React, { useState, useEffect, useRef } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';

export default function ScreenshotModal() {
  const { 
    isScreenshotModalOpen, 
    closeScreenshotModal, 
    setIsSnippingActive,
    activeCaptureTarget 
  } = useAppStore();

  const { comicData, currentPage } = useReaderStore();

  const [selectedFormat, setSelectedFormat] = useState('png');
  const [includeWatermark, setIncludeWatermark] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // بستن مودال با کلید Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isScreenshotModalOpen) {
        closeScreenshotModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isScreenshotModalOpen, closeScreenshotModal]);

  if (!isScreenshotModalOpen || !comicData) return null;

  // محاسبه ایمن اندیس صفحه جهت جلوگیری از خطای دسترسی به آرایه
  const rawIndex = activeCaptureTarget?.pageIndex ?? (currentPage - 1);
  const totalItems = comicData.items?.length || 1;
  const safeIndex = Math.max(0, Math.min(rawIndex, totalItems - 1));
  const targetItem = comicData.items?.[safeIndex];
  const pageNumber = safeIndex + 1;

  const showToast = (msg, autoClose = true) => {
    if (!isMountedRef.current) return;
    setStatusMessage(msg);
    if (autoClose) {
      setTimeout(() => {
        if (isMountedRef.current) {
          setStatusMessage('');
          closeScreenshotModal();
        }
      }, 1200);
    }
  };

  // ۱. شروع حالت کراپ با ماوس
  const handleStartSnipping = () => {
    closeScreenshotModal();
    setIsSnippingActive(true);
  };

  // ۲. استخراج و ذخیره صفحه با کیفیت اصلی
  const handleCaptureSourcePage = async (destination = 'save') => {
    if (!targetItem?.path || isProcessing) return;
    setIsProcessing(true);

    try {
      // حالت کپی سریع بدون تغییرات اضافه
      if (destination === 'clipboard' && !includeWatermark && selectedFormat === 'png') {
        const res = await window.api?.copyImageToClipboard({ filePath: targetItem.path });
        if (res?.success) {
          showToast('تصویر با کیفیت اصلی در کلیپ‌بورد کپی شد!');
          setIsProcessing(false);
          return;
        }
      }

      const img = new Image();
      img.src = `comic://media?path=${encodeURIComponent(targetItem.path)}`;

      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          // درج واترمارک متناسب با رزولوشن اصلی تصویر
          if (includeWatermark) {
            const bannerHeight = Math.max(40, Math.round(canvas.height * 0.035));
            const fontSize = Math.max(14, Math.round(bannerHeight * 0.42));
            
            ctx.fillStyle = 'rgba(10, 14, 20, 0.78)';
            ctx.fillRect(0, canvas.height - bannerHeight, canvas.width, bannerHeight);
            
            ctx.fillStyle = '#00BCD4';
            ctx.font = `600 ${fontSize}px sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.fillText(
              `${comicData.fileName}  •  صفحه ${pageNumber}`,
              24,
              canvas.height - (bannerHeight / 2)
            );
          }

          const mimeType = selectedFormat === 'png' ? 'image/png' : 'image/jpeg';
          const quality = selectedFormat === 'png' ? 1.0 : 0.94;
          const dataUrl = canvas.toDataURL(mimeType, quality);

          if (destination === 'clipboard') {
            const copyRes = await window.api?.copyImageToClipboard({ dataUrl });
            if (copyRes?.success) {
              showToast('تصویر به کلیپ‌بورد منتقل شد!');
            } else {
              showToast('خطا در کپی به کلیپ‌بورد', false);
            }
          } else {
            const defaultName = `${comicData.fileName}_P${pageNumber}.${selectedFormat}`;
            const saveRes = await window.api?.saveScreenshot({ dataUrl, defaultName });
            if (saveRes?.success) {
              showToast('فایل با موفقیت روی دیسک ذخیره شد!');
            } else if (!saveRes?.canceled) {
              showToast('خطا در ذخیره‌سازی فایل', false);
            }
          }
        } catch (innerErr) {
          showToast('خطا در پردازش داده تصویر', false);
        } finally {
          if (isMountedRef.current) setIsProcessing(false);
        }
      };

      img.onerror = () => {
        showToast('خطا در بارگذاری فایل تصویر', false);
        if (isMountedRef.current) setIsProcessing(false);
      };
    } catch (err) {
      showToast('خطا در اجرای عملیات', false);
      if (isMountedRef.current) setIsProcessing(false);
    }
  };

  return (
    <div style={styles.backdrop} onClick={closeScreenshotModal}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        
        {/* هدر پنل */}
        <div style={styles.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '18px' }}>✂️</span>
            <h3 style={styles.title}>پنل اسکرین‌شات و برداشت تصویر</h3>
          </div>
          <button onClick={closeScreenshotModal} style={styles.closeBtn} title="بستن (ESC)">✕</button>
        </div>

        {/* مشخصات فایل هدف */}
        <div style={styles.targetInfo}>
          <span style={styles.fileNameText} title={comicData.fileName}>
            کمیک: <b>{comicData.fileName}</b>
          </span>
          <span style={styles.formatBadge}>صفحه {pageNumber}</span>
        </div>

        {/* کارت‌های اکشن */}
        <div style={styles.optionsGrid}>
          
          <div 
            style={{ ...styles.card, opacity: isProcessing ? 0.6 : 1 }} 
            onClick={isProcessing ? undefined : handleStartSnipping}
          >
            <div style={styles.cardIcon}>📐</div>
            <div style={styles.cardContent}>
              <div style={styles.cardTitle}>برش دستی با ماوس (Area Snipping)</div>
              <div style={styles.cardDesc}>کشیدن کادر آزاد روی فریم‌ها و دیالوگ‌ها</div>
            </div>
            <span style={styles.arrowIcon}>‹</span>
          </div>

          <div 
            style={{ ...styles.card, opacity: isProcessing ? 0.6 : 1 }} 
            onClick={isProcessing ? undefined : () => handleCaptureSourcePage('save')}
          >
            <div style={styles.cardIcon}>💾</div>
            <div style={styles.cardContent}>
              <div style={styles.cardTitle}>ذخیره کامل صفحه (کیفیت اصلی ۱۰۰٪)</div>
              <div style={styles.cardDesc}>استخراج مستقیم تصویر صفحه جاری روی دیسک</div>
            </div>
            <span style={styles.arrowIcon}>‹</span>
          </div>

          <div 
            style={{ ...styles.card, opacity: isProcessing ? 0.6 : 1 }} 
            onClick={isProcessing ? undefined : () => handleCaptureSourcePage('clipboard')}
          >
            <div style={styles.cardIcon}>📋</div>
            <div style={styles.cardContent}>
              <div style={styles.cardTitle}>کپی کامل صفحه به کلیپ‌بورد</div>
              <div style={styles.cardDesc}>ارسال مستقیم به تلگرام، دیسکورد یا فتوشاپ</div>
            </div>
            <span style={styles.arrowIcon}>‹</span>
          </div>

        </div>

        {/* تنظیمات فرمت و برچسب */}
        <div style={styles.settingsRow}>
          <div style={styles.toggleGroup}>
            <span style={styles.settingLabel}>فرمت:</span>
            <button 
              onClick={() => setSelectedFormat('png')} 
              style={{ ...styles.formatBtn, ...(selectedFormat === 'png' ? styles.formatBtnActive : {}) }}
            >
              PNG
            </button>
            <button 
              onClick={() => setSelectedFormat('jpg')} 
              style={{ ...styles.formatBtn, ...(selectedFormat === 'jpg' ? styles.formatBtnActive : {}) }}
            >
              JPG
            </button>
          </div>

          <label style={styles.checkboxLabel}>
            <input 
              type="checkbox" 
              checked={includeWatermark} 
              onChange={(e) => setIncludeWatermark(e.target.checked)}
              style={styles.checkbox}
            />
            درج عنوان کمیک و شماره صفحه
          </label>
        </div>

        {/* پیام بازخورد کاربری */}
        {statusMessage && (
          <div style={styles.toastMessage}>
            {statusMessage}
          </div>
        )}

      </div>
    </div>
  );
}

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 8, 12, 0.72)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9998,
    animation: 'contextMenuFadeIn 0.14s ease',
  },
  modal: {
    width: '440px',
    backgroundColor: 'rgba(21, 26, 33, 0.95)',
    borderRadius: '16px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 1px rgba(255, 255, 255, 0.2)',
    padding: '22px',
    direction: 'rtl',
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '14px',
  },
  title: {
    margin: 0,
    fontSize: '15px',
    fontWeight: '600',
    color: '#fff',
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary, #8b949e)',
    cursor: 'pointer',
    fontSize: '15px',
    padding: '4px 8px',
    borderRadius: '6px',
  },
  targetInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: '8px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    color: 'var(--text-secondary, #8b949e)',
    marginBottom: '16px',
  },
  fileNameText: {
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '300px',
  },
  formatBadge: {
    backgroundColor: 'rgba(0, 188, 212, 0.15)',
    color: '#00BCD4',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  optionsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    marginBottom: '18px',
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: '10px',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  cardIcon: {
    fontSize: '20px',
    width: '38px',
    height: '38px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: '8px',
    flexShrink: 0,
  },
  cardContent: {
    flex: 1,
  },
  cardTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#e6edf3',
    marginBottom: '3px',
  },
  cardDesc: {
    fontSize: '11px',
    color: 'var(--text-secondary, #8b949e)',
  },
  arrowIcon: {
    fontSize: '18px',
    color: 'var(--text-secondary, #8b949e)',
  },
  settingsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    paddingTop: '14px',
    fontSize: '12px',
    color: 'var(--text-secondary, #8b949e)',
  },
  toggleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  settingLabel: {
    fontSize: '11px',
  },
  formatBtn: {
    background: 'none',
    border: '1px solid rgba(255, 255, 255, 0.1)',
    color: 'var(--text-secondary, #8b949e)',
    padding: '3px 8px',
    borderRadius: '5px',
    cursor: 'pointer',
    fontSize: '11px',
  },
  formatBtnActive: {
    backgroundColor: '#00BCD4',
    borderColor: '#00BCD4',
    color: '#000',
    fontWeight: 'bold',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
    fontSize: '11px',
  },
  checkbox: {
    accentColor: '#00BCD4',
    cursor: 'pointer',
  },
  toastMessage: {
    marginTop: '14px',
    textAlign: 'center',
    color: '#00BCD4',
    fontSize: '12px',
    fontWeight: '600',
    animation: 'contextMenuFadeIn 0.15s ease',
  },
};