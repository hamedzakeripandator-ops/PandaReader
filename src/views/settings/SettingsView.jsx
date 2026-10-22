import React, { useState } from 'react';
import useSettingsStore from '../../store/useSettingsStore';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import KeybindRecorder from './KeybindRecorder';
import Icons from '../../components/common/Icons';

const SHORTCUT_DESCRIPTIONS = {
  nextChapter: { title: 'فصل / کمیک بعدی در پوشه', category: 'ناوبری کمیک' },
  prevChapter: { title: 'فصل / کمیک قبلی در پوشه', category: 'ناوبری کمیک' },
  zoomIn: { title: 'بزرگ‌نمایی صفحه (Zoom In)', category: 'بزرگ‌نمایی و تصویر' },
  zoomOut: { title: 'کوچک‌نمایی صفحه (Zoom Out)', category: 'بزرگ‌نمایی و تصویر' },
  resetZoom: { title: 'بازنشانی زوم به حالت پیش‌فرض', category: 'بزرگ‌نمایی و تصویر' },
  rotatePage: { title: 'چرخش ۹۰ درجه‌ای صفحات', category: 'بزرگ‌نمایی و تصویر' },
  toggleLeftSidebar: { title: 'باز و بسته کردن منوی سمت چپ', category: 'پنل‌ها و پنجره' },
  toggleRightSidebar: { title: 'باز و بسته کردن فهرست صفحات راست', category: 'پنل‌ها و پنجره' },
  fullscreen: { title: 'حالت تمام‌صفحه (Fullscreen)', category: 'پنل‌ها و پنجره' },
  quickSnip: { title: 'برش سریع بخشی از تصویر (Snipping)', category: 'ابزارهای کاربردی' },
  copyPage: { title: 'کپی مستقیم صفحه جاری در کلیپ‌بورد', category: 'ابزارهای کاربردی' },
  openFile: { title: 'انتخاب و باز کردن فایل جدید', category: 'ابزارهای کاربردی' },
  openFolder: { title: 'انتخاب و باز کردن پوشه کمیک', category: 'ابزارهای کاربردی' },
  focusSearch: { title: 'فوکوس سریع روی نوار جستجو', category: 'ابزارهای کاربردی' },
  openSettings: { title: 'باز کردن صفحه تنظیمات برنامه', category: 'پنل‌ها و پنجره' },
};

export default function SettingsView() {
  const {
    shortcuts,
    preferences,
    updateShortcut,
    resetShortcutsToDefault,
    updatePreference,
  } = useSettingsStore();

  const { setZoomLevel } = useReaderStore();
  const showToast = useAppStore((state) => state.showToast);

  const [activeTab, setActiveTab] = useState('shortcuts'); // 'shortcuts' | 'reader'

  const handleSaveShortcut = (actionId, newBind) => {
    const conflictKey = Object.keys(shortcuts || {}).find((key) => {
      if (key === actionId) return false;
      const s = shortcuts[key];
      return (
        s?.label?.toLowerCase() === newBind.label.toLowerCase()
      );
    });

    updateShortcut(actionId, newBind);

    if (conflictKey) {
      const conflictTitle = SHORTCUT_DESCRIPTIONS[conflictKey]?.title || conflictKey;
      showToast(`میانبر ثبت شد (توجه: مشابه با «${conflictTitle}»)`, { type: 'warning' });
    } else {
      showToast(`میانبر جدید (${newBind.label}) در دیتابیس ذخیره شد`, { type: 'success' });
    }
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
            {Object.keys(SHORTCUT_DESCRIPTIONS).map((actionId) => {
              const meta = SHORTCUT_DESCRIPTIONS[actionId];
              const currentBinding = shortcuts?.[actionId] || { label: '—' };

              return (
                <div key={actionId} style={styles.shortcutRow}>
                  <div style={styles.shortcutInfo}>
                    <span style={styles.shortcutTitle}>{meta.title}</span>
                    <span style={styles.shortcutCategory}>{meta.category}</span>
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
      )}
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
    direction: 'rtl',
    userSelect: 'none',
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
};