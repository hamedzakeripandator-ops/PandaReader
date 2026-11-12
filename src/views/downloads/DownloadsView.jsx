import React, { useState, useEffect } from 'react';
import useAppStore from '../../store/useAppStore';
import Icons from '../../components/common/Icons';
import { coreApi } from '../../services/coreApi';

// مرحله ۷ ـ بخش الف: این صفحه، دیگر هیچ «نسخهٔ» هاردکدشده‌ای
// ندارد؛ نسخه، از app.getVersion() (همان versionی package.json)
// خوانده می‌شود و اگر در دسترس نبود، «نامشخص» نشان داده می‌شود.
function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '۰ بایت';
  if (n < 1024) return n + ' بایت';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' کیلوبایت';
  return (n / (1024 * 1024)).toFixed(1) + ' مگابایت';
}

const CHANGELOG_HISTORY = [
  {
    version: 'v5.0.0-pro',
    label: 'نسخه فعلی',
    date: 'مهر ۱۴۰۵ - اکتبر ۲۰۲۶',
    badge: 'فعال',
    features: [
      'موتور استخراجِ تک‌تصویرِ کاور در رم (coverOnly) بدونِ خواندنِ کلِ آرشیو',
      'پشتیبانی کامل از فایل‌های زیپ چندپوشه‌ای و پوشه‌های مستقیم عکس با سورت سلسله‌مراتبی چپترها',
      'سیستم پاک‌سازی خودکار کش هارد دیسک پس از اتمام مطالعه به همراه دکمه لغو فوری بارگذاری (Cancel)',
      'تایپوگرافی سه‌گانه لوکال (Estedad، Manrope، JetBrains Mono) و آیکون‌های وکتور استاندارد Lucide',
      'منوی کلیک‌راست نئونی مجهز به نشانگر لغزنده فنری و افکت انفجار ذرات نوری',
    ],
  },
  {
    version: 'v4.2.0',
    label: 'نسخه قبلی',
    date: 'شهریور ۱۴۰۵',
    badge: 'پایدار',
    features: [
      'اسلایدر درگ‌پذیر با موس در بالای کتابخانه به همراه ذخیرهٔ کاورها به‌صورتِ فایل روی دیسک',
      'موتور هوشمند شورت‌کات‌های ترکیبی در فاز Capture با پشتیبانی از کلیدهای Ctrl و Alt',
      'ابزار برش آزاد با موس (Snipping Tool) با رزولوشن طبیعی تصاویر',
    ],
  },
  {
    version: 'v4.0.0',
    label: 'نسخه پایه',
    date: 'مرداد ۱۴۰۵',
    badge: 'قدیمی',
    features: [
      'یکپارچه‌سازی کتابخانه لوکال بر پایه پایگاه‌داده اتمیک الکترون',
      'حالت غوطه‌ور زن‌مود (Zen Mode) و اسکرول مجازی بدون مصرف رم',
    ],
  },
];

export default function DownloadsView() {
  const showToast = useAppStore((state) => state.showToast);

  // مرحله ۷ ـ بخش الف: این صفحه، حالا اطلاعاتِ واقعیِ همین نصب را
  // از پروسهٔ اصلی می‌خواند (کانالِ get-app-info). تایمرِ ساختگیِ
  // «بررسیِ سرور» (۱۶۰۰ میلی‌ثانیه، همیشه «به‌روز») و دانلودِ
  // ساختگیِ +۲۰٪ هر ۳۵۰ میلی‌ثانیه، کاملاً حذف شدند.
  // مرحلهٔ ۵۷ §۳ (m3): آخرین انتشار، زنده از REST عمومیِ گیت‌هابِ
  // hamedzakeripandator-ops/PandaReader خوانده می‌شود (بدونِ توکن)؛
  // دکمهٔ «به‌روزرسانیِ اطلاعات»، هم اطلاعاتِ محلی را تازه می‌کند
  // و هم همان لحظه، آخرین نسخه را چک می‌کند.
  const [appInfo, setAppInfo] = useState(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState('');

  // مرحلهٔ ۵۷ §۳ (m3): وضعیتِ زندهٔ آخرین انتشارِ گیت‌هاب.
  const [latestRelease, setLatestRelease] = useState({ status: 'idle', latestVersion: '', publishedAt: '', releaseNotes: '', downloadUrl: '', htmlUrl: '', message: '' });
  const [releaseChecking, setReleaseChecking] = useState(false);

  const loadAppInfo = async () => {
    setInfoLoading(true);
    setInfoError('');
    try {
      const result = await coreApi.getAppInfo();
      if (result && result.success) {
        setAppInfo(result);
      } else {
        setInfoError((result && result.error) || 'دریافتِ اطلاعاتِ برنامه انجام نشد.');
      }
    } catch (err) {
      setInfoError(err?.message || 'دریافتِ اطلاعاتِ برنامه انجام نشد.');
    } finally {
      setInfoLoading(false);
    }
  };

  // مرحلهٔ ۵۷ §۳ (m3): تاریخِ انتشارِ ISO به تاریخِ فارسی.
  const formatReleaseDate = (iso) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleDateString('fa-IR');
    } catch (_) { return ''; }
  };

  // مرحلهٔ ۵۷ §۳ (m3): بررسیِ آخرین انتشارِ گیت‌هاب (REST عمومی،
  // بدونِ توکن). manual یعنی کاربر خودش دکمه را زده است و مودالِ
  // یادآوری، حتی برایِ نسخهٔ نادیده‌گرفته‌شده هم باز می‌شود؛ در
  // بررسیِ خودکارِ باز شدنِ صفحه، manual برابر false است.
  const checkLatestRelease = async (manual) => {
    if (!coreApi || typeof coreApi.checkForUpdates !== 'function') {
      setLatestRelease((prev) => ({ ...prev, status: 'error', message: 'سرویسِ بروزرسانی در این نسخه در دسترس نیست.' }));
      return;
    }
    setReleaseChecking(true);
    setLatestRelease((prev) => ({ ...prev, status: 'checking', message: '' }));
    try {
      const result = await coreApi.checkForUpdates();
      let norm = null;
      try {
        if (typeof coreApi.normalizeCheckForUpdatesResult === 'function') {
          norm = coreApi.normalizeCheckForUpdatesResult(result, '');
        }
      } catch (_) { norm = null; }
      if (!norm) {
        setLatestRelease((prev) => ({ ...prev, status: 'error', message: 'بررسی بروزرسانی انجام نشد.' }));
        return;
      }
      if (norm.updateAvailable === true && norm.latestVersion) {
        setLatestRelease({ status: 'available', latestVersion: norm.latestVersion, publishedAt: norm.publishedAt, releaseNotes: norm.releaseNotes, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, message: '' });
        try {
          if (typeof coreApi.emitUpdateAvailable === 'function') {
            coreApi.emitUpdateAvailable({ updateAvailable: true, latestVersion: norm.latestVersion, releaseNotes: norm.releaseNotes, publishedAt: norm.publishedAt, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, currentVersion: norm.currentVersion || (appInfo && appInfo.version) || '', manual: manual === true });
          }
        } catch (_) {}
      } else if (norm.updateAvailable === false) {
        setLatestRelease({ status: 'up-to-date', latestVersion: norm.latestVersion, publishedAt: norm.publishedAt, releaseNotes: norm.releaseNotes, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, message: '' });
      } else if (norm.latestVersion) {
        setLatestRelease({ status: 'available', latestVersion: norm.latestVersion, publishedAt: norm.publishedAt, releaseNotes: norm.releaseNotes, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, message: '' });
        try {
          if (typeof coreApi.emitUpdateAvailable === 'function') {
            coreApi.emitUpdateAvailable({ updateAvailable: true, latestVersion: norm.latestVersion, releaseNotes: norm.releaseNotes, publishedAt: norm.publishedAt, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, currentVersion: norm.currentVersion || (appInfo && appInfo.version) || '', manual: manual === true });
          }
        } catch (_) {}
      } else {
        setLatestRelease((prev) => ({ ...prev, status: 'error', message: norm.message || 'بررسی بروزرسانی انجام نشد.' }));
      }
    } catch (err) {
      setLatestRelease((prev) => ({ ...prev, status: 'error', message: 'بررسی بروزرسانی انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص') }));
    } finally {
      setReleaseChecking(false);
    }
  };

  // مرحلهٔ ۵۷ §۳ (m3): دکمهٔ آبیِ «به‌روزرسانیِ اطلاعات» — هر کلیک،
  // هم اطلاعاتِ محلیِ سیستم را تازه می‌کند و هم آخرین انتشارِ
  // گیت‌هاب را چک می‌کند.
  const handleRefreshAll = async () => {
    await loadAppInfo();
    await checkLatestRelease(true);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await coreApi.getAppInfo();
      if (cancelled) return;
      if (result && result.success) {
        setAppInfo(result);
      } else {
        setInfoError((result && result.error) || 'دریافتِ اطلاعاتِ برنامه انجام نشد.');
      }
      setInfoLoading(false);
      if (!cancelled) void checkLatestRelease(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleOpenDataFolder = async () => {
    const dataDir = appInfo?.dataDir;
    if (!dataDir) {
      showToast('پوشهٔ دیتا مشخص نیست.', { type: 'error' });
      return;
    }
    // db.json داخلِ پوشهٔ دیتاست؛ نمایشِ آن در فایل‌اکسپلورر،
    // پوشهٔ دیتا را با فایلِ انتخاب‌شده باز می‌کند.
    const dbPath = dataDir.replace(/[\\/]+$/, '') + '/db.json';
    const result = await coreApi.showItemInFolder(dbPath);
    if (result && result.success === false) {
      showToast(result.error || 'باز کردنِ پوشهٔ دیتا انجام نشد.', { type: 'error' });
    }
  };

  return (
    <div style={styles.container}>
      {/* هدر بالای مرکز آپدیت */}
      <div style={styles.header}>
        <div style={styles.titleWrap}>
          <div style={styles.headerIcon}>
            <Icons.Rocket size={22} />
          </div>
          <div>
            <h2 style={styles.title}>اطلاعاتِ نسخه و سلامتِ سیستم</h2>
            <span style={styles.subtitle}>
              نسخه، محیطِ اجرا و وضعیتِ دیتای همین نصب{' '}
              <span style={{ fontFamily: 'var(--font-latin)', fontWeight: 700 }}>ComicReader</span>
              {' '}— نسخه‌های جدید، مستقیم از گیت‌هابِ PandaReader بررسی می‌شوند و آخرین نسخهٔ منتشرشده، همین‌جا دیده می‌شود.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleOpenDataFolder}
            disabled={!appInfo?.dataDir}
            style={styles.checkBtn}
          >
            <Icons.FolderOpen size={15} />
            <span>باز کردن پوشهٔ دیتا</span>
          </button>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={infoLoading || releaseChecking}
            style={styles.checkBtn}
          >
            {infoLoading ? (
              <>
                <Icons.Loader size={15} />
                <span>در حال خواندن...</span>
              </>
            ) : (
              <>
                <Icons.RefreshCw size={15} />
                <span>به‌روزرسانیِ اطلاعات</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* کارت وضعیت نسخه جاری */}
      <div style={styles.versionStatusCard}>
        <div style={styles.statusLeft}>
          <div style={styles.versionBadgeRow}>
            <span style={styles.versionPill}>
              {appInfo?.version ? 'v' + appInfo.version : 'نسخه نامشخص'}
            </span>
            <span style={styles.buildDateText}>
              {infoLoading
                ? 'در حال خواندنِ اطلاعات…'
                : appInfo
                  ? (appInfo.isPackaged ? 'نسخهٔ بسته‌بندی‌شده' : 'حالتِ توسعه') +
                    (appInfo.isPortableMode ? ' • حالتِ Portable' : '')
                  : 'اطلاعات در دسترس نیست'}
            </span>
          </div>
          <h3 style={styles.statusTitle}>
            {infoLoading && 'در حال خواندنِ اطلاعاتِ محیط…'}
            {!infoLoading && infoError && infoError}
            {!infoLoading && !infoError && latestRelease.status === 'available' && latestRelease.latestVersion &&
              `نسخهٔ جدید v${latestRelease.latestVersion} در گیت‌هاب منتشر شده است.`}
            {!infoLoading && !infoError && latestRelease.status === 'up-to-date' &&
              'شما به آخرین نسخه بروز هستید.'}
            {!infoLoading && !infoError && latestRelease.status === 'checking' &&
              'در حال بررسیِ آخرین نسخه در گیت‌هاب…'}
            {!infoLoading && !infoError && latestRelease.status === 'error' &&
              (latestRelease.message || 'بررسیِ آخرین نسخه در گیت‌هاب انجام نشد.')}
            {!infoLoading && !infoError && latestRelease.status === 'idle' &&
              'اطلاعاتِ زیر، وضعیتِ واقعیِ همین نصب است.'}
          </h3>
          <p style={styles.statusDesc}>
            {latestRelease.latestVersion
              ? `آخرین نسخه در گیت‌هاب: v${latestRelease.latestVersion}${latestRelease.publishedAt ? ` — منتشرشده در ${formatReleaseDate(latestRelease.publishedAt)}` : ''}؛ دانلود و نصب از پنجرهٔ یادآوری یا کارتِ بروزرسانی در تنظیمات انجام می‌شود و دیتا و تنظیمات، در پوشهٔ دیتا باقی می‌مانند.`
              : 'آخرین نسخه، مستقیم از گیت‌هابِ PandaReader بررسی می‌شود؛ دانلود و نصب از پنجرهٔ یادآوری یا کارتِ بروزرسانی در تنظیمات انجام می‌شود و دیتا و تنظیمات، در پوشهٔ دیتا باقی می‌مانند.'}
          </p>
        </div>

        <div style={styles.statusRight}>
          <div style={styles.okBadge}>
            <Icons.Check size={15} />
            <span>
              {appInfo?.isPackaged ? 'اجرا از روی فایلِ ساخته‌شده' : 'اجرا در حالتِ توسعه'}
            </span>
          </div>
        </div>
      </div>

      {/* مرحله ۷ ـ بخش الف: اطلاعاتِ واقعیِ محیط و سلامتِ سیستم */}
      <div style={styles.changelogSection}>
        <div style={styles.changelogHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Info size={18} />
          </span>
          <h3 style={styles.changelogHeader}>محیطِ اجرا و سلامتِ سیستم</h3>
        </div>
        {infoLoading ? (
          <p style={styles.statusDesc}>در حال خواندنِ اطلاعات…</p>
        ) : infoError ? (
          <p style={styles.statusDesc}>{infoError}</p>
        ) : appInfo ? (
          <div style={styles.infoGrid}>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>سیستم‌عامل و معماری</span>
              <span style={styles.infoValue}>{appInfo.platform} • {appInfo.arch}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>نسخهٔ Electron / Chrome / Node</span>
              <span style={{ ...styles.infoValue, direction: 'ltr' }}>
                {appInfo.electronVersion} / {appInfo.chromeVersion} / {appInfo.nodeVersion}
              </span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>حالتِ دیتا</span>
              <span style={styles.infoValue}>
                {appInfo.isPortableMode ? 'Portable (portable-data در کنارِ فایلِ اجرایی)' : 'عادی (پوشهٔ خانگیِ کاربر)'}
              </span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>پوشهٔ دیتا</span>
              <span style={{ ...styles.infoValue, direction: 'ltr', wordBreak: 'break-all' }}>{appInfo.dataDir || '—'}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>اندازهٔ دیتابیس (db.json)</span>
              <span style={styles.infoValue}>{formatSize(appInfo.dbSize)}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>تعدادِ کاورهای روی دیسک</span>
              <span style={styles.infoValue}>{appInfo.coverCount}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>فایلِ لاگ</span>
              <span style={styles.infoValue}>
                {appInfo.logExists ? ('وجود دارد • ' + formatSize(appInfo.logSize)) : 'هنوز ساخته نشده است'}
              </span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>مسیرِ فایلِ لاگ</span>
              <span style={{ ...styles.infoValue, direction: 'ltr', wordBreak: 'break-all' }}>{appInfo.logFile || '—'}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* لاگ تغییرات و تاریخچه آپدیت‌ها (Changelog) */}
      <div style={styles.changelogSection}>
        <div style={styles.changelogHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.FileText size={18} />
          </span>
          <h3 style={styles.changelogHeader}>تاریخچه آپدیت‌ها و لاگ تغییرات</h3>
        </div>

        <div style={styles.changelogList}>
          {CHANGELOG_HISTORY.map((log, idx) => (
            <div key={idx} style={styles.logCard}>
              <div style={styles.logHeadRow}>
                <div style={styles.logVersionWrap}>
                  <span style={styles.logVersionTitle}>
                    {idx === 0 && appInfo?.version ? 'v' + appInfo.version : log.version}
                  </span>
                  <span style={styles.logVersionSub}>{log.label}</span>
                  <span
                    style={{
                      ...styles.logBadge,
                      backgroundColor:
                        log.badge === 'فعال'
                          ? 'rgba(34, 211, 238, 0.14)'
                          : 'rgba(255, 255, 255, 0.05)',
                      color: log.badge === 'فعال' ? 'var(--accent)' : 'var(--muted)',
                    }}
                  >
                    {log.badge}
                  </span>
                </div>
                <span style={styles.logDate}>{log.date}</span>
              </div>

              <ul style={styles.featureUl}>
                {log.features.map((feat, fIdx) => (
                  <li key={fIdx} style={styles.featureLi}>
                    <span style={styles.bullet} />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
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
    direction: 'rtl',
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '14px',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
    gap: '12px',
  },
  titleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerIcon: {
    width: '42px',
    height: '42px',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    borderRadius: '12px',
    border: '1px solid rgba(34, 211, 238, 0.3)',
    color: 'var(--accent)',
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
    fontSize: '12px',
    color: 'var(--muted)',
  },
  infoGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '12px',
  },
  infoRow: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '8px 12px',
    borderRadius: '10px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border)',
    flexWrap: 'wrap',
  },
  infoLabel: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    color: 'var(--muted)',
  },
  infoValue: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    color: 'var(--text)',
    fontWeight: 600,
  },
  checkBtn: {
    padding: '9px 18px',
    borderRadius: '11px',
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    border: 'none',
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 4px 14px rgba(34, 211, 238, 0.3)',
    transition: 'all 0.15s ease',
  },
  versionStatusCard: {
    backgroundColor: 'var(--panel)',
    borderRadius: '18px',
    border: '1px solid var(--border)',
    padding: '20px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '20px',
    flexWrap: 'wrap',
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.4)',
  },
  statusLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    flex: 1,
    minWidth: '260px',
  },
  versionBadgeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  versionPill: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    border: '1px solid rgba(34, 211, 238, 0.3)',
    padding: '3px 10px',
    borderRadius: '8px',
    direction: 'ltr',
  },
  buildDateText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--muted)',
  },
  statusTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '15.5px',
    fontWeight: 700,
    color: 'var(--text)',
    margin: '4px 0 0',
  },
  statusDesc: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    color: 'var(--muted)',
    margin: 0,
  },
  statusRight: {
    display: 'flex',
    alignItems: 'center',
  },
  okBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    border: '1px solid rgba(16, 185, 129, 0.35)',
    color: '#10b981',
    padding: '8px 16px',
    borderRadius: '12px',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 700,
  },
  downloadActionBtn: {
    padding: '10px 18px',
    borderRadius: '11px',
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    border: 'none',
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxShadow: '0 4px 14px rgba(34, 211, 238, 0.35)',
  },
  downloadProgressBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '180px',
  },
  progressBarTrack: {
    flex: 1,
    height: '6px',
    backgroundColor: 'var(--panel2)',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: 'var(--accent)',
    transition: 'width 0.2s ease',
  },
  percentText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--accent)',
    direction: 'ltr',
  },
  optionsRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'var(--panel)',
    borderRadius: '14px',
    border: '1px solid var(--border)',
    padding: '14px 18px',
    gap: '14px',
  },
  optionLabelWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  optionLabel: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 700,
    color: 'var(--text)',
  },
  optionSub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--muted)',
  },
  toggleBtn: {
    padding: '7px 14px',
    borderRadius: '10px',
    border: '1px solid',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
  },
  changelogSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  changelogHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  changelogHeader: {
    fontFamily: 'var(--font-fa)',
    fontSize: '16px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  changelogList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  logCard: {
    backgroundColor: 'var(--panel)',
    borderRadius: '14px',
    border: '1px solid var(--border)',
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  logHeadRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--border)',
    paddingBottom: '10px',
  },
  logVersionWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  logVersionTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--accent)',
    direction: 'ltr',
  },
  logVersionSub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--text)',
  },
  logBadge: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '6px',
  },
  logDate: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--muted)',
  },
  featureUl: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '7px',
  },
  featureLi: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    lineHeight: '1.6',
  },
  bullet: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent)',
    flexShrink: 0,
  },
};