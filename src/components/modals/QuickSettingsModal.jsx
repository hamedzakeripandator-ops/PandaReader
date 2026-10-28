import React, { useState, useEffect, useRef, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';
import useSettingsStore from '../../store/useSettingsStore';
import Icons from '../common/Icons';

export default function QuickSettingsModal() {
  const isQuickSettingsOpen = useAppStore((state) => state.isQuickSettingsOpen);
  const closeQuickSettings = useAppStore((state) => state.closeQuickSettings);
  const currentView = useAppStore((state) => state.currentView);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const showToast = useAppStore((state) => state.showToast);

  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const setZoomLevel = useReaderStore((state) => state.setZoomLevel);
  const comicPageGap = useReaderStore((state) => state.comicPageGap ?? 0);
  const pdfPageGap = useReaderStore((state) => state.pdfPageGap ?? 12);
  const setComicPageGap = useReaderStore((state) => state.setComicPageGap);
  const setPdfPageGap = useReaderStore((state) => state.setPdfPageGap);

  const preferences = useSettingsStore((state) => state.preferences);
  const updatePreferences = useSettingsStore((state) => state.updatePreferences);
  const previewPreferences = useSettingsStore((state) => state.previewPreferences);
  const resetPreferences = useSettingsStore((state) => state.resetPreferences);

  const [localPrefs, setLocalPrefs] = useState({
    ...preferences,
    comicPageGap: 0,
    pdfPageGap: 12,
  });
  const [isSaving, setIsSaving] = useState(false);
  const isMountedRef = useRef(true);
  // مرحله ۶ ـ بخش ب: تصویرِ مقادیرِ تمِ مطالعه در لحظهٔ باز شدنِ
  // مودال (برای Rollback هنگامِ انصراف) + پرچمِ «پیش‌نمایشی اعمال
  // شده» + نگهبانِ گذارِ بسته→باز (تا همگام‌سازیِ فرم، فقط هنگامِ
  // باز شدن انجام شود و پیش‌نمایشِ زنده، ویرایش‌های محلیِ
  // ذخیره‌نشده را پاک نکند).
  const readingSnapshotRef = useRef(null);
  const previewAppliedRef = useRef(false);
  const wasOpenRef = useRef(false);

  const isOpen = Boolean(isQuickSettingsOpen || currentView === 'quick-settings');

  const handleClose = useCallback(() => {
    // مرحله ۶ ـ بخش ب: بستن بدونِ ذخیره (انصراف، دکمهٔ X، Escape،
    // کلیکِ بیرون) = Rollback: مقادیرِ تمِ مطالعه به حالتِ لحظهٔ باز
    // شدنِ مودال برمی‌گردند. پس از Save، پرچم پاک شده است و این
    // شاخه اجرا نمی‌شود.
    if (previewAppliedRef.current && readingSnapshotRef.current && previewPreferences) {
      previewPreferences({ ...readingSnapshotRef.current });
    }
    previewAppliedRef.current = false;
    if (closeQuickSettings) {
      closeQuickSettings();
    }
    if (currentView === 'quick-settings') {
      setCurrentView('reader');
    }
  }, [closeQuickSettings, currentView, setCurrentView, previewPreferences]);

  // ۱. همگام‌سازی وضعیت فرم با مقادیر واقعی استور هنگام باز شدن پنجره
  // مرحله ۶ ـ بخش ب: فقط در گذارِ بسته→باز (نه با هر تغییرِ
  // preferences)؛ وگرنه پیش‌نمایشِ زنده که preferences را عوض
  // می‌کند، همین افکت را دوباره می‌چرخاند و ویرایش‌های محلیِ
  // ذخیره‌نشدهٔ فرم را پاک می‌کرد. در همین گذار، تصویرِ مقادیرِ
  // تمِ مطالعه هم برای Rollback گرفته می‌شود.
  useEffect(() => {
    isMountedRef.current = true;
    if (isOpen && !wasOpenRef.current) {
      wasOpenRef.current = true;
      readingSnapshotRef.current = {
        readingTheme: preferences?.readingTheme ?? 'default',
        readingBrightness: preferences?.readingBrightness ?? 1,
        readingWarmth: preferences?.readingWarmth ?? 0,
      };
      previewAppliedRef.current = false;
      setLocalPrefs({
        ...preferences,
        defaultZoom: zoomLevel || preferences?.defaultZoom || 1.0,
        comicPageGap: comicPageGap ?? 0,
        pdfPageGap: pdfPageGap ?? 12,
      });
    } else if (!isOpen) {
      wasOpenRef.current = false;
    }
    return () => {
      isMountedRef.current = false;
    };
  }, [isOpen, preferences, zoomLevel, comicPageGap, pdfPageGap]);

  // ۲. مدیریت بستن ایمن پنجره با کلید Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.key === 'Escape' || e.code === 'Escape') && isOpen) {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown, true);
    }
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  // اعمال زنده فاصله صفحات کمیک
  const handleComicGapChange = (val) => {
    const num = Math.max(0, Math.min(48, Number(val) || 0));
    setLocalPrefs((s) => ({ ...s, comicPageGap: num }));
    setComicPageGap?.(num);
  };

  // اعمال زنده فاصله صفحات PDF
  const handlePdfGapChange = (val) => {
    const num = Math.max(0, Math.min(48, Number(val) || 0));
    setLocalPrefs((s) => ({ ...s, pdfPageGap: num }));
    setPdfPageGap?.(num);
  };

  // مرحله ۶ ـ بخش ب: پیش‌نمایشِ زندهٔ تمِ مطالعه — مقدارِ جدید، هم
  // در فرمِ محلی و هم بی‌درنگ در استورِ سراسری (بدونِ ماندگاری)
  // اعمال می‌شود تا صفحهٔ زیرِ مودال همان لحظه واکنش نشان دهد؛
  // ماندگاری، فقط با دکمهٔ Save و Rollback، فقط با بستنِ بدونِ
  // ذخیره انجام می‌شود.
  const applyReadingPreview = (patch) => {
    setLocalPrefs((s) => ({ ...s, ...patch }));
    if (previewPreferences) previewPreferences(patch);
    previewAppliedRef.current = true;
  };

  // ذخیره‌سازی همگام در استور سراسری، دیتابیس لوکال و ریدر
  const handleSave = async () => {
    if (isSaving) return;
    setIsSaving(true);

    try {
      updatePreferences(localPrefs);

      // مرحله ۶ ـ بخش ب: مقادیر، ماندگار شدند؛ پس بستنِ پس از
      // ذخیره، هرگز Rollback نمی‌کند و تصویرِ لحظهٔ باز شدنِ مودال
      // هم به مقادیرِ ذخیره‌شده به‌روز می‌شود.
      previewAppliedRef.current = false;
      readingSnapshotRef.current = {
        readingTheme: localPrefs.readingTheme ?? 'default',
        readingBrightness: localPrefs.readingBrightness ?? 1,
        readingWarmth: localPrefs.readingWarmth ?? 0,
      };

      if (typeof localPrefs.defaultZoom === 'number') {
        setZoomLevel(localPrefs.defaultZoom);
      }
      if (typeof localPrefs.comicPageGap === 'number') {
        setComicPageGap?.(localPrefs.comicPageGap);
      }
      if (typeof localPrefs.pdfPageGap === 'number') {
        setPdfPageGap?.(localPrefs.pdfPageGap);
      }

      showToast('تنظیمات مطالعه و فاصله صفحات با موفقیت اعمال شد', { type: 'success' });
      handleClose();
    } catch (err) {
      console.error('Error saving settings in QuickSettingsModal:', err);
      showToast('خطا در ذخیره تنظیمات', { type: 'error' });
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  // بازنشانی مقادیر به پیش‌فرض‌های استاندارد
  const handleReset = () => {
    resetPreferences();
    const defaultState = useSettingsStore.getState().preferences;
    setLocalPrefs({
      ...defaultState,
      comicPageGap: 0,
      pdfPageGap: 12,
    });
    // مرحله ۶ ـ بخش ب: بازنشانی، خودش ماندگار است؛ پس تصویرِ لحظهٔ
    // باز شدن هم به پیش‌فرض‌ها به‌روز می‌شود تا انصرافِ بعدی،
    // بازنشانیِ انجام‌شده را برنگرداند.
    previewAppliedRef.current = false;
    readingSnapshotRef.current = {
      readingTheme: defaultState?.readingTheme ?? 'default',
      readingBrightness: defaultState?.readingBrightness ?? 1,
      readingWarmth: defaultState?.readingWarmth ?? 0,
    };
    setZoomLevel(defaultState?.defaultZoom || 1.0);
    setComicPageGap?.(0);
    setPdfPageGap?.(12);
    showToast('تنظیمات مطالعه به حالت پیش‌فرض بازگشت', { type: 'info' });
  };

  return (
    <div style={styles.backdrop} onClick={handleClose}>
      <div
        style={styles.modalCard}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="تنظیمات سریع مطالعه"
      >
        {/* هدر پنجره */}
        <div style={styles.header}>
          <div style={styles.headerTitleWrap}>
            <span style={styles.headerIcon}>
              <Icons.Zap size={16} />
            </span>
            <h3 style={styles.headerTitle}>تنظیمات سریع مطالعه</h3>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={styles.closeBtn}
            title="بستن (Escape)"
          >
            <Icons.X size={15} />
          </button>
        </div>

        {/* محتوای تنظیمات */}
        <div style={styles.body}>
          {/* بخش جدید: تنظیم فاصله و آفست عمودی بین صفحات */}
          <section style={styles.section}>
            <div style={styles.sectionTitle}>
              <Icons.Layers size={14} />
              <span>فاصله عمودی بین صفحات (Page Offset / Gap)</span>
            </div>

            <div style={styles.row}>
              <div style={styles.labelWithVal}>
                <label style={styles.label}>
                  فاصله صفحات در کمیک و مانهوا (ZIP/CBZ):
                </label>
                <span style={styles.valBadge}>
                  {localPrefs.comicPageGap === 0
                    ? '0px (چسبیده و بدون مرز سیاه)'
                    : `${localPrefs.comicPageGap}px`}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="40"
                step="1"
                value={localPrefs.comicPageGap ?? 0}
                onChange={(e) => handleComicGapChange(e.target.value)}
                style={styles.slider}
              />
              <div style={styles.pillGroup}>
                {[0, 4, 8, 16, 24].map((g) => (
                  <button
                    key={g}
                    type="button"
                    style={getPillStyle((localPrefs.comicPageGap ?? 0) === g)}
                    onClick={() => handleComicGapChange(g)}
                  >
                    {g === 0 ? '۰ (یکپارچه)' : `${g}px`}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ ...styles.row, marginTop: '6px' }}>
              <div style={styles.labelWithVal}>
                <label style={styles.label}>
                  فاصله صفحات در کتاب‌ها و جزوات (PDF):
                </label>
                <span style={styles.valBadge}>{localPrefs.pdfPageGap ?? 12}px</span>
              </div>
              <input
                type="range"
                min="0"
                max="40"
                step="1"
                value={localPrefs.pdfPageGap ?? 12}
                onChange={(e) => handlePdfGapChange(e.target.value)}
                style={styles.slider}
              />
              <div style={styles.pillGroup}>
                {[0, 8, 12, 20, 32].map((g) => (
                  <button
                    key={g}
                    type="button"
                    style={getPillStyle((localPrefs.pdfPageGap ?? 12) === g)}
                    onClick={() => handlePdfGapChange(g)}
                  >
                    {g === 12 ? '12px (استاندارد)' : `${g}px`}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* بخش ۱: ابزار اسکرین‌شات و کیفیت برش */}
          <section style={styles.section}>
            <div style={styles.sectionTitle}>
              <Icons.Scissors size={14} />
              <span>ابزار اسکرین‌شات و کیفیت ذخیره تصویر</span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>فرمت پیش‌فرض فایل خروجی:</label>
              <div style={styles.pillGroup}>
                <button
                  type="button"
                  style={getPillStyle(localPrefs.screenshotFormat === 'png')}
                  onClick={() => setLocalPrefs((s) => ({ ...s, screenshotFormat: 'png' }))}
                >
                  PNG (کیفیت کریستالی بدون افت)
                </button>
                <button
                  type="button"
                  style={getPillStyle(localPrefs.screenshotFormat === 'jpg')}
                  onClick={() => setLocalPrefs((s) => ({ ...s, screenshotFormat: 'jpg' }))}
                >
                  JPG (کم‌حجم و فشرده)
                </button>
              </div>
            </div>

            {localPrefs.screenshotFormat === 'jpg' && (
              <div style={styles.row}>
                <label style={styles.label}>
                  کیفیت خروجی تصویر JPG: ({Math.round((localPrefs.jpgQuality || 0.92) * 100)}%)
                </label>
                <input
                  type="range"
                  min="0.7"
                  max="1.0"
                  step="0.02"
                  value={localPrefs.jpgQuality || 0.92}
                  onChange={(e) =>
                    setLocalPrefs((s) => ({ ...s, jpgQuality: parseFloat(e.target.value) }))
                  }
                  style={styles.slider}
                />
              </div>
            )}
          </section>

          {/* مرحله ۶ ـ بخش الف: تمِ مطالعه و نورِ صفحه — فقط روی
              تصویرِ صفحه اعمال می‌شود (فیلترِ CSS روی عنصرِ img) و
              رنگِ تولبار و مختصاتِ حاشیه‌نویسی را لمس نمی‌کند.
              تغییرها بی‌درنگ روی صفحهٔ زیرِ مودال دیده می‌شوند (پیش‌نمایشِ زنده)؛ با «ذخیره» ماندگار و با «انصراف»/Escape/کلیکِ بیرون، به حالتِ پیش از باز شدن برمی‌گردند. */}
          <section style={styles.section}>
            <div style={styles.sectionTitle}>
              <Icons.Eye size={14} />
              <span>تم مطالعه و نور صفحه (راحتی چشم)</span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>تم نمایش صفحه:</label>
              <div style={styles.pillGroup}>
                <button
                  type="button"
                  style={getPillStyle((localPrefs.readingTheme || 'default') === 'default')}
                  onClick={() => applyReadingPreview({ readingTheme: 'default' })}
                >
                  پیش‌فرض
                </button>
                <button
                  type="button"
                  style={getPillStyle(localPrefs.readingTheme === 'sepia')}
                  onClick={() => applyReadingPreview({ readingTheme: 'sepia' })}
                >
                  کاغذی گرم (سپیا)
                </button>
                <button
                  type="button"
                  style={getPillStyle(localPrefs.readingTheme === 'night')}
                  onClick={() => applyReadingPreview({ readingTheme: 'night' })}
                >
                  کنتراست نرم شب
                </button>
              </div>
            </div>

            <div style={styles.row}>
              <div style={styles.labelWithVal}>
                <label style={styles.label}>روشنایی صفحه:</label>
                <span style={styles.valBadge}>{Math.round((localPrefs.readingBrightness ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.6"
                max="1.1"
                step="0.05"
                value={localPrefs.readingBrightness ?? 1}
                onChange={(e) =>
                  applyReadingPreview({ readingBrightness: parseFloat(e.target.value) })
                }
                style={styles.slider}
              />
            </div>

            <div style={styles.row}>
              <div style={styles.labelWithVal}>
                <label style={styles.label}>گرمای صفحه (ته‌مایهٔ کهربایی):</label>
                <span style={styles.valBadge}>{Math.round((localPrefs.readingWarmth ?? 0) * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="0.4"
                step="0.05"
                value={localPrefs.readingWarmth ?? 0}
                onChange={(e) =>
                  applyReadingPreview({ readingWarmth: parseFloat(e.target.value) })
                }
                style={styles.slider}
              />
            </div>
          </section>

          {/* بخش ۲: زوم و مقیاس نمایش صفحات کمیک */}
          <section style={styles.section}>
            <div style={styles.sectionTitle}>
              <Icons.Maximize size={14} />
              <span>بزرگ‌نمایی پیش‌فرض و گام‌های زوم</span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>بزرگ‌نمایی اولیه هنگام باز شدن کمیک:</label>
              <div style={styles.pillGroup}>
                {[0.8, 1.0, 1.25, 1.5].map((z) => (
                  <button
                    key={z}
                    type="button"
                    style={getPillStyle(localPrefs.defaultZoom === z)}
                    onClick={() => setLocalPrefs((s) => ({ ...s, defaultZoom: z }))}
                  >
                    {Math.round(z * 100)}%
                  </button>
                ))}
              </div>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>گام افزایش/کاهش زوم (کلیدهای + و -):</label>
              <div style={styles.pillGroup}>
                {[0.05, 0.1, 0.15, 0.2].map((step) => (
                  <button
                    key={step}
                    type="button"
                    style={getPillStyle(localPrefs.zoomStep === step)}
                    onClick={() => setLocalPrefs((s) => ({ ...s, zoomStep: step }))}
                  >
                    {Math.round(step * 100)}%
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* بخش ۳: حالت تمرکز و رفتار زن‌مود */}
          <section style={styles.section}>
            <div style={styles.sectionTitle}>
              <Icons.Rocket size={14} />
              <span>رفتار خودکار حالت تمرکز (Zen Mode)</span>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>مخفی‌سازی خودکار منوها هنگام باز کردن کمیک:</label>
              <div style={styles.pillGroup}>
                <button
                  type="button"
                  style={getPillStyle(localPrefs.autoZenOnOpen !== false)}
                  onClick={() => setLocalPrefs((s) => ({ ...s, autoZenOnOpen: true }))}
                >
                  فعال (محیط مطالعه خلوت)
                </button>
                <button
                  type="button"
                  style={getPillStyle(localPrefs.autoZenOnOpen === false)}
                  onClick={() => setLocalPrefs((s) => ({ ...s, autoZenOnOpen: false }))}
                >
                  غیرفعال (منوها باز بمانند)
                </button>
              </div>
            </div>

            <div style={styles.row}>
              <label style={styles.label}>مدت‌زمان نمایش اعلان‌ها (HUD Toast):</label>
              <div style={styles.pillGroup}>
                {[
                  { label: 'سریع (۱.۵ ثانیه)', val: 1500 },
                  { label: 'استاندارد (۲.۲ ثانیه)', val: 2200 },
                  { label: 'آهسته (۳.۵ ثانیه)', val: 3500 },
                ].map((item) => (
                  <button
                    key={item.val}
                    type="button"
                    style={getPillStyle(localPrefs.hudDuration === item.val)}
                    onClick={() => setLocalPrefs((s) => ({ ...s, hudDuration: item.val }))}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        {/* فوتر و دکمه‌های اکشن */}
        <div style={styles.footer}>
          <button
            type="button"
            onClick={handleReset}
            style={styles.resetBtn}
            disabled={isSaving}
          >
            بازنشانی پیش‌فرض
          </button>

          <div style={styles.actionButtonGroup}>
            <button
              type="button"
              onClick={handleClose}
              style={styles.cancelBtn}
              disabled={isSaving}
            >
              انصراف
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={styles.saveBtn}
              disabled={isSaving}
            >
              {isSaving ? 'در حال ذخیره...' : 'ذخیره و اعمال'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const getPillStyle = (isActive) => ({
  ...styles.pillBtn,
  backgroundColor: isActive ? 'var(--accent)' : 'rgba(255, 255, 255, 0.04)',
  borderColor: isActive ? 'var(--accent)' : 'var(--border)',
  color: isActive ? '#0a0f13' : 'var(--text)',
  fontWeight: isActive ? 700 : 500,
});

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100010,
    direction: 'rtl',
    userSelect: 'none',
  },
  modalCard: {
    width: '480px',
    maxWidth: '92vw',
    backgroundColor: 'var(--panel)',
    borderRadius: '18px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85), 0 0 24px rgba(34, 211, 238, 0.15)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '14px 18px',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  headerIcon: {
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
  },
  headerTitle: {
    margin: 0,
    fontFamily: 'var(--font-fa)',
    fontSize: '14.5px',
    fontWeight: 800,
    color: 'var(--text)',
  },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--muted)',
    cursor: 'pointer',
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease',
    outline: 'none',
  },
  body: {
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    maxHeight: '72vh',
    overflowY: 'auto',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    backgroundColor: 'var(--panel2)',
    padding: '12px 14px',
    borderRadius: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
  },
  sectionTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 700,
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    marginBottom: '2px',
  },
  row: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  labelWithVal: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--muted)',
    fontWeight: 500,
  },
  valBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--accent)',
    direction: 'ltr',
  },
  pillGroup: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  pillBtn: {
    padding: '5px 12px',
    borderRadius: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    cursor: 'pointer',
    transition: 'all 0.14s ease',
    outline: 'none',
  },
  slider: {
    width: '100%',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  footer: {
    padding: '12px 18px',
    borderTopWidth: '1px',
    borderTopStyle: 'solid',
    borderTopColor: 'var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(10, 15, 19, 0.65)',
  },
  resetBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--danger)',
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    padding: '6px 8px',
    outline: 'none',
  },
  actionButtonGroup: {
    display: 'flex',
    gap: '8px',
  },
  cancelBtn: {
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    padding: '7px 14px',
    borderRadius: '10px',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    transition: 'all 0.15s ease',
  },
  saveBtn: {
    backgroundColor: 'var(--accent)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
    color: '#0a0f13',
    fontWeight: 700,
    fontFamily: 'var(--font-fa)',
    padding: '7px 16px',
    borderRadius: '10px',
    fontSize: '12px',
    cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(34, 211, 238, 0.35)',
    outline: 'none',
    transition: 'all 0.15s ease',
  },
};