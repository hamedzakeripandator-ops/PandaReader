import React, { useState } from 'react';
import useSettingsStore from '../../store/useSettingsStore';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import KeybindRecorder from './KeybindRecorder';
import Icons from '../../components/common/Icons';
import StorageSection from '../../components/common/StorageSection';
import SliderControls from '../../components/library/SliderControls';
import { coreApi } from '../../services/coreApi';
import annotationLocalBackup from '../../services/annotationLocalBackup';

// مرحله ۷ ـ بخش الف: دیگر هیچ نگاشتِ موازیِ عنوان/دسته در این
// فایل نیست. ردیف‌های میانبر، مستقیماً از ورودی‌های استور
// (shortcuts) رندر می‌شوند؛ پس هر ورودیِ جدیدِ استور (مثلِ
// undoAnnotation یا toggleLeftSidebar) خودبه‌خود این‌جا هم دیده
// می‌شود و عنوان/دسته، فقط در یک جا تعریف شده است.

export default function SettingsView() {
  const {
    shortcuts,
    preferences,
    updateShortcut,
    resetShortcutsToDefault,
    updatePreference,
    setHeroSliderVariant,
  } = useSettingsStore();

  const { setZoomLevel } = useReaderStore();
  const showToast = useAppStore((state) => state.showToast);

  const [activeTab, setActiveTab] = useState('shortcuts'); // 'shortcuts' | 'reader' | 'storage'

  // مرحله ۵ ـ بخش الف: پشتیبان‌گیری و بازیابیِ یک‌کلیکی.
  const [backupBusy, setBackupBusy] = useState(null); // null | 'export' | 'import'
  const [backupStatus, setBackupStatus] = useState('');
  const [lastBackup, setLastBackup] = useState(() => {
    try {
      const raw = window.localStorage.getItem('comicReader.lastBackup');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && parsed.at) return parsed;
    } catch (_) {}
    return null;
  });

  const handleExportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy('export');
    setBackupStatus('در حال ساختِ فایل پشتیبان…');
    try {
      const result = await coreApi.exportBackup();
      if (result && result.canceled) {
        setBackupStatus('ذخیرهٔ فایل پشتیبان لغو شد.');
        return;
      }
      if (result && result.success) {
        const info = { at: new Date().toISOString(), name: (result.filePath || '').split(/[\\/]/).pop() || '', coverCount: result.coverCount || 0 };
        setLastBackup(info);
        try { window.localStorage.setItem('comicReader.lastBackup', JSON.stringify(info)); } catch (_) {}
        setBackupStatus(`فایل پشتیبان ذخیره شد (${result.coverCount || 0} کاور).`);
        showToast('فایل پشتیبان با موفقیت ذخیره شد.', { type: 'success' });
      } else {
        setBackupStatus((result && result.error) || 'ساختِ فایل پشتیبان انجام نشد.');
        showToast((result && result.error) || 'ساختِ فایل پشتیبان انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      const msg = 'خطا در ساختِ فایل پشتیبان: ' + (err && err.message ? err.message : String(err));
      setBackupStatus(msg);
      showToast(msg, { type: 'error' });
    } finally {
      setBackupBusy(null);
    }
  };

  const handleImportBackup = async () => {
    if (backupBusy) return;
    setBackupBusy('import');
    setBackupStatus('در حال بررسی و بازیابیِ فایل پشتیبان…');
    try {
      const result = await coreApi.importBackup();
      if (result && result.canceled) {
        setBackupStatus('بازیابی لغو شد؛ هیچ تغییری انجام نشد.');
        return;
      }
      if (result && result.success) {
        // مرحله ۵ ـ بخش ب: پیش از reload، آینهٔ localStorageِ
        // حاشیه‌نویسی‌ها پاک می‌شود تا کلیدهای قدیمیِ قبل از Restore،
        // دوباره واردِ دیتابیسِ بازیابی‌شده نشوند (دیتابیس، مرجعِ
        // مطلق است). فقط کلیدهای `comicReader.annotations.v1:` پاک
        // می‌شوند؛ `comicReader.lastBackup` و بقیه دست نمی‌خورند.
        try { annotationLocalBackup.clearAllAnnotationBackups(); } catch (_) {}
        setBackupStatus(`بازیابی انجام شد (${result.coverCount || 0} کاور) — برنامه دوباره بارگذاری می‌شود…`);
        showToast('بازیابی انجام شد؛ برنامه دوباره بارگذاری می‌شود.', { type: 'success' });
        setTimeout(() => { window.location.reload(); }, 1200);
      } else {
        setBackupStatus((result && result.error) || 'بازیابیِ فایل پشتیبان انجام نشد؛ اطلاعات فعلی دست‌نخورده باقی ماند.');
        showToast((result && result.error) || 'بازیابی انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      const msg = 'خطا در بازیابیِ فایل پشتیبان: ' + (err && err.message ? err.message : String(err));
      setBackupStatus(msg);
      showToast(msg, { type: 'error' });
    } finally {
      // در حالتِ موفق، reload پس از ۱۲۰۰ میلی‌ثانیه می‌آید؛ finally
      // زودتر اجرا می‌شود و دکمه را آزاد می‌کند تا کاربر، وضعیتِ
      // موفقیت را ببیند.
      setBackupBusy(null);
    }
  };

  // مرحله ۷ ـ بخش الف: نتیجهٔ updateShortcut، حکمِ نهایی است.
  // پیش از این، این تابع، برگشتیِ استور را نادیده می‌گرفت و حتی
  // وقتی استور، میانبر را به‌خاطرِ تداخل رد می‌کرد، پیامِ موفقیت
  // نشان می‌داد و کاربر فکر می‌کرد تغییر، اعمال شده است؛ در
  // حالی که کلیدِ قبلی، همچنان زنده بود. حالا رد شدن، با پیامِ
  // خطا و بدونِ پیامِ موفقیت گزارش می‌شود.
  const handleSaveShortcut = (actionId, newBind) => {
    const result = updateShortcut(actionId, newBind);
    if (result && result.success === false) {
      if (result.conflict) {
        showToast(`این میانبر، قبلاً به «${result.conflictWith || 'اقدامی دیگر'}» اختصاص دارد؛ تغییر انجام نشد.`, { type: 'error' });
      } else {
        showToast('ذخیرهٔ میانبر انجام نشد.', { type: 'error' });
      }
      return;
    }
    showToast(`میانبر جدید (${newBind.label}) در دیتابیس ذخیره شد`, { type: 'success' });
  };

  const handleResetAllShortcuts = () => {
    resetShortcutsToDefault();
    showToast('تمام کلیدهای میانبر به حالت پیش‌فرض بازنشانی شدند', { type: 'info' });
  };

  const handleDefaultZoomChange = (val) => {
    const num = parseFloat(val);
    updatePreference('defaultZoom', num);
    setZoomLevel(num);
  };

  return (
    <div style={styles.container}>
      <div style={styles.containerInner}>
      {/* هدر بالای تنظیمات */}
      <div style={styles.header}>
        <div style={styles.titleWrap}>
          <div style={styles.headerIcon}>
            <Icons.Settings size={22} />
          </div>
          <div>
            <h2 style={styles.title}>تنظیمات و شخصی‌سازی برنامه</h2>
            <span style={styles.subtitle}>
              مدیریت کلیدهای میانبر کیبورد، بزرگ‌نمایی پیش‌فرض و ترجیحات محیط مطالعه
            </span>
          </div>
        </div>

        {/* تب‌های تنظیمات */}
        <div style={styles.tabsRow}>
          <button
            type="button"
            onClick={() => setActiveTab('shortcuts')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'shortcuts' ? styles.tabBtnActive : {}),
            }}
          >
            <Icons.Keyboard size={15} />
            <span>میانبرهای کیبورد</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reader')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'reader' ? styles.tabBtnActive : {}),
            }}
          >
            <Icons.BookOpen size={15} />
            <span>تنظیمات ریدر و ظاهر</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('storage')}
            style={{
              ...styles.tabBtn,
              ...(activeTab === 'storage' ? styles.tabBtnActive : {}),
            }}
          >
            <Icons.FolderOpen size={15} />
            <span>مدیریت حافظه و پاک‌سازی</span>
          </button>

        </div>
      </div>

      {/* تب اول: مدیریت شورت‌کات‌های کیبورد */}
      {activeTab === 'shortcuts' && (
        <div style={styles.sectionCard}>
          <div style={styles.cardTopRow}>
            <div>
              <h3 style={styles.cardTitle}>ضبط زنده کلیدهای میانبر (تکی و ترکیبی)</h3>
              <p style={styles.cardDesc}>
                روی هر دکمه کلیک کرده و ترکیب دلخواه (مانند Ctrl + Shift + S یا کلید تکی) را فشار دهید.
              </p>
            </div>

            <button
              type="button"
              onClick={handleResetAllShortcuts}
              style={styles.resetBtn}
            >
              <Icons.RefreshCw size={14} />
              <span>بازنشانی به پیش‌فرض</span>
            </button>
          </div>

          <div style={styles.shortcutsList}>
            {Object.values(shortcuts || {}).map((entry) => {
              const actionId = entry.id;
              const currentBinding = entry;

              return (
                <div key={actionId} style={styles.shortcutRow}>
                  <div style={styles.shortcutInfo}>
                    <span style={styles.shortcutTitle}>{entry.title}</span>
                    <span style={styles.shortcutCategory}>{entry.category}</span>
                  </div>

                  <KeybindRecorder
                    actionId={actionId}
                    currentBinding={currentBinding}
                    onSave={handleSaveShortcut}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* تب دوم: تنظیمات ریدر و ظاهر */}
      {activeTab === 'reader' && (
        <>
        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>تنظیمات بزرگ‌نمایی و محیط مطالعه</h3>

          <div style={styles.prefGrid}>
            {/* بزرگ‌نمایی پیش‌فرض */}
            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>بزرگ‌نمایی پیش‌فرض صفحات (Default Zoom)</span>
                <span style={styles.monoValue}>
                  {Math.round((preferences?.defaultZoom || 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.4"
                max="2.0"
                step="0.05"
                value={preferences?.defaultZoom || 1}
                onChange={(e) => handleDefaultZoomChange(e.target.value)}
                style={styles.slider}
              />
            </div>

            {/* گام تغییر زوم */}
            <div style={styles.prefItem}>
              <div style={styles.prefLabelRow}>
                <span style={styles.prefTitle}>گام تغییر بزرگ‌نمایی با کلیدها (Zoom Step)</span>
                <span style={styles.monoValue}>
                  {Math.round((preferences?.zoomStep || 0.1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.3"
                step="0.05"
                value={preferences?.zoomStep || 0.1}
                onChange={(e) => updatePreference('zoomStep', parseFloat(e.target.value))}
                style={styles.slider}
              />
            </div>

            {/* حالت تمرکز خودکار */}
            <div style={styles.prefSwitchRow}>
              <div>
                <div style={styles.prefTitle}>پنهان‌سازی خودکار نوارها در حین مطالعه (Zen Mode)</div>
                <div style={styles.prefSub}>
                  نوارهای بالا و پایین چند ثانیه پس از باز شدن کمیک مخفی می‌شوند تا فضا کاملاً باز شود.
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences?.autoZenOnOpen !== false}
                onChange={(e) => updatePreference('autoZenOnOpen', e.target.checked)}
                style={styles.checkbox}
              />
            </div>

            {/* نمایش شمارنده آیتم‌ها در سایدبار */}
            <div style={styles.prefSwitchRow}>
              <div>
                <div style={styles.prefTitle}>نمایش شمارنده تعداد کمیک‌ها در سایدبار</div>
                <div style={styles.prefSub}>
                  نمایش تعداد آیتم‌های کتابخانه، علاقه‌مندی‌ها و تاریخچه در کنار منو.
                </div>
              </div>
              <input
                type="checkbox"
                checked={preferences?.showSidebarCounts !== false}
                onChange={(e) => updatePreference('showSidebarCounts', e.target.checked)}
                style={styles.checkbox}
              />
            </div>
          </div>
        </div>

        {/* مرحلهٔ ۳۵ §۶: انتخابِ سبکِ کنترلِ اسلایدرِ کتابخانه (موج صوتی) */}
        <div style={styles.sectionCard}>
          <h3 style={styles.cardTitle}>سبک کنترل اسلایدر کتابخانه (موج صوتی)</h3>
          <p style={styles.cardDesc}>
            شکلِ دکمه‌هایِ اسلایدرِ هیرو در صفحهٔ کتابخانه را از بینِ ۵ تمپلیتِ موجِ صوتی انتخاب کن؛ تغییر، در لحظه اعمال می‌شود. پیش‌نمایشِ هر کارت، همان انیمیشنِ زندهٔ اسلایدر است.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', width: '100%' }}>
            {[
              { id: 'led', name: 'ال‌ای‌دی متر', desc: 'ستون‌هایی از نقطه‌هایِ ریز' },
              { id: 'mirror', name: 'آینه', desc: 'میله‌هایِ گردِ متقارن (پیش‌فرض)' },
              { id: 'matrix', name: 'ماتریس پیکسلی', desc: 'مربع‌هایِ سوسوزنِ پیکسلی' },
              { id: 'pendulum', name: 'آونگ‌ها', desc: 'وزنه‌هایِ آویزانِ نوسانی' },
              { id: 'firefly', name: 'کرم شب‌تاب', desc: 'ذره‌هایِ شناورِ نورانی' },
            ].map((v) => {
              const isActive = (preferences?.heroSliderVariant || 'mirror') === v.id;
              return (
                <div
                  key={v.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setHeroSliderVariant && setHeroSliderVariant(v.id)}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && setHeroSliderVariant) {
                      e.preventDefault();
                      setHeroSliderVariant(v.id);
                    }
                  }}
                  style={{
                    border: isActive ? '2px solid #22d3ee' : '1px solid var(--border)',
                    background: isActive ? 'rgba(34,211,238,0.08)' : 'rgba(255,255,255,0.03)',
                    borderRadius: 14,
                    padding: '16px 20px',
                    cursor: 'pointer',
                    width: '100%',
                    boxSizing: 'border-box',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 16,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: '1 1 200px', minWidth: 200 }}>
                    {isActive ? (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="9" />
                        <polyline points="20 6 9 17 4 12" strokeWidth="2.5" />
                      </svg>
                    ) : (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
                        <circle cx="12" cy="12" r="9" />
                      </svg>
                    )}
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <strong style={{ fontSize: 13, color: isActive ? '#67e8f9' : 'var(--text)' }}>{v.name}</strong>
                        {isActive && (<span style={{ fontSize: 11, color: '#67e8f9' }}>فعال</span>)}
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>{v.desc}</p>
                    </div>
                  </div>
                  <div style={{ flexShrink: 0, maxWidth: '100%', overflow: 'hidden', borderRadius: 10, padding: '4px 2px' }}>
                    <SliderControls
                      currentIndex={2}
                      total={7}
                      onPrev={() => {}}
                      onNext={() => {}}
                      onSelect={() => {}}
                      variant={v.id}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </>
      )}

      {/* مرحله ۱۰: تبِ «حافظه» — آمارِ دقیقِ حجم، پاک‌سازیِ کشِ کاورها و فایل‌هایِ حذف‌شده و انتخابِ درایوِ محلِ ذخیره. */}
      {activeTab === 'storage' && (
        <StorageSection />
      )}

      {/* مرحله ۵ ـ بخش الف: کارتِ پشتیبان‌گیری و بازیابی — همیشه زیرِ
          تب‌ها دیده می‌شود (مستقل از تبِ فعال)، چون به هیچ تبِ خاصی
          تعلق ندارد. */}
      <div style={styles.sectionCard}>
        <div style={styles.cardTopRow}>
          <div>
            <h3 style={styles.cardTitle}>پشتیبان‌گیری و بازیابی اطلاعات</h3>
            <p style={styles.cardDesc}>
              یک فایلِ واحد شاملِ دیتابیس (کتابخانه، تاریخچه، علاقه‌مندی‌ها، پوشه‌ها، تنظیمات و همهٔ حاشیه‌نویسی‌ها) به همراهِ همهٔ فایل‌های کاور. بازیابی، پیش از جایگزینی، سلامتِ فایل را بررسی می‌کند و نسخهٔ فعلی را در db.json.pre-restore.bak نگه می‌دارد.
            </p>
          </div>
          <div style={styles.headerIcon}>
            <Icons.FileArchive size={22} />
          </div>
        </div>

        <div style={styles.backupBtnRow}>
          <button
            type="button"
            onClick={handleExportBackup}
            disabled={Boolean(backupBusy)}
            style={{ ...styles.backupBtn, ...(backupBusy ? styles.backupBtnDisabled : {}) }}
          >
            <Icons.Download size={15} />
            <span>{backupBusy === 'export' ? 'در حال ساخت…' : 'دریافت فایل پشتیبان (Export)'}</span>
          </button>

          <button
            type="button"
            onClick={handleImportBackup}
            disabled={Boolean(backupBusy)}
            style={{ ...styles.backupBtn, ...styles.backupBtnGhost, ...(backupBusy ? styles.backupBtnDisabled : {}) }}
          >
            <Icons.FolderOpen size={15} />
            <span>{backupBusy === 'import' ? 'در حال بازیابی…' : 'بازیابی از فایل پشتیبان (Import)'}</span>
          </button>
        </div>

        {(backupStatus || lastBackup) && (
          <div style={styles.backupStatusRow}>
            {backupStatus && <span style={styles.backupStatus}>{backupStatus}</span>}
            {lastBackup && (
              <span style={styles.backupMeta}>
                آخرین پشتیبان: {lastBackup.name || '—'}
                {' — '}
                {new Date(lastBackup.at).toLocaleString('fa-IR')}
              </span>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    padding: '18px 22px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    overflowY: 'auto',
    direction: 'ltr',
    userSelect: 'none',
  },  // مرحله ۱۲: محتوای درونیِ اسکرول‌خور — جهتِ راست‌به‌چپِ
  // فارسی، دقیقاً با همان فاصله‌ها (gap) حفظ می‌شود؛ فقط
  // خودِ کانتینرِ اسکرول‌خور، چپ‌به‌راست است تا کرومیوم،
  // نوارِ اسکرول را در لبهٔ سمتِ راست رندر کند.
  containerInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    direction: 'rtl',
    flex: 1,
    minWidth: 0,
  },

  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '14px',
    paddingBottom: '14px',
    borderBottom: '1px solid var(--border)',
  },
  titleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerIcon: {
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    padding: '10px',
    borderRadius: '12px',
    border: '1px solid rgba(34, 211, 238, 0.3)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'var(--font-fa)',
    fontSize: '20px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 400,
    color: 'var(--muted)',
  },
  tabsRow: {
    display: 'flex',
    gap: '8px',
    backgroundColor: 'var(--panel)',
    padding: '5px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
  },
  tabBtn: {
    padding: '7px 14px',
    borderRadius: '9px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--muted)',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    transition: 'all 0.18s ease',
  },
  tabBtnActive: {
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    fontWeight: 700,
  },
  sectionCard: {
    backgroundColor: 'var(--panel)',
    borderRadius: '18px',
    border: '1px solid var(--border)',
    padding: '20px 22px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  cardTopRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px',
    paddingBottom: '12px',
    borderBottom: '1px solid var(--border)',
  },
  cardTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '16px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  cardDesc: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
    margin: '4px 0 0 0',
  },
  resetBtn: {
    padding: '8px 14px',
    borderRadius: '10px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  shortcutsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  shortcutRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
  },
  shortcutInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
  },
  shortcutTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 600,
    color: 'var(--text)',
  },
  shortcutCategory: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    color: 'var(--muted)',
  },
  prefGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  prefItem: {
    padding: '14px 16px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  prefLabelRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  prefTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 700,
    color: 'var(--text)',
  },
  prefSub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    color: 'var(--muted)',
    marginTop: '3px',
  },
  monoValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--accent)',
    direction: 'ltr',
  },
  slider: {
    accentColor: 'var(--accent)',
    cursor: 'pointer',
    width: '100%',
  },
  prefSwitchRow: {
    padding: '14px 16px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  // مرحله ۵ ـ بخش الف: استایل‌های کارتِ پشتیبان‌گیری (همان توکن‌های
  // بقیهٔ کارت‌ها: panel/panel2/border/text/muted/accent).
  backupBtnRow: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  backupBtn: {
    padding: '10px 16px',
    borderRadius: '11px',
    backgroundColor: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: '#0a0f13',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    transition: 'all 0.18s ease',
  },
  backupBtnGhost: {
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  },
  backupBtnDisabled: {
    opacity: 0.55,
    cursor: 'default',
  },
  backupStatusRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  backupStatus: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--text)',
  },
  backupMeta: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--muted)',
  },
};