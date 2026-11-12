import React, { useState, useEffect, useRef } from 'react';
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
  // مرحلهٔ ۵۷ §۳ (m3) + مرحلهٔ ۵۸ §۲ (m2): این صفحه، دو کارتِ
  // جداست — کارتِ «اطلاعاتِ نسخه و سلامتِ سیستم»، فقط آفلاین است
  // (اطلاعاتِ همین نصب از get-app-info؛ هیچ تماسی با اینترنت) و
  // کارتِ جداگانهٔ «مرکز بروزرسانی خودکار (GitHub Auto-Update)» است
  // که آخرین انتشار را زنده از REST عمومیِ گیت‌هابِ
  // hamedzakeripandator-ops/PandaReader می‌خواند (بدونِ توکن)؛
  // دکمهٔ «به‌روزرسانی اطلاعاتِ سیستم»، فقط اطلاعاتِ محلی را تازه
  // می‌کند و بررسیِ نسخهٔ جدید، فقط با دکمهٔ مستقلِ کارتِ
  // بروزرسانی انجام می‌شود.
  const [appInfo, setAppInfo] = useState(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [infoError, setInfoError] = useState('');

  // مرحلهٔ ۵۷ §۳ (m3): وضعیتِ زندهٔ آخرین انتشارِ گیت‌هاب.
  const [latestRelease, setLatestRelease] = useState({ status: 'idle', latestVersion: '', publishedAt: '', releaseNotes: '', downloadUrl: '', htmlUrl: '', message: '' });

  // مرحلهٔ ۵۸ §۲ (m2): وضعیتِ کارتِ جداگانهٔ بروزرسانی — سوییچِ
  // بررسیِ خودکار (همان کلیدِ مودال و کارتِ تنظیمات) + وضعیتِ
  // دانلود/نصبِ نسخهٔ جدید؛ mountedRef، نگهبانِ آن‌مانت‌شدگی برایِ
  // هندلرهایِ ناهمگامِ دانلود است.
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(() => {
    try {
      if (coreApi && typeof coreApi.readAutoCheckUpdatesEnabled === 'function') return coreApi.readAutoCheckUpdatesEnabled();
    } catch (_) {}
    return true;
  });
  const [downloadState, setDownloadState] = useState({ status: 'idle', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, directFilePath: '', message: '' });
  const mountedRef = useRef(true);
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

  // مرحلهٔ ۵۷ §۳ (m3) + مرحلهٔ ۵۸ §۲ (m2): بررسیِ آخرین انتشارِ
  // گیت‌هاب (REST عمومی، بدونِ توکن) با fallback سه‌لایه
  // (IPCِ net.fetchِ پروکسی‌شناس، بعد https، بعد fetch رندرر)؛
  // هر کلیک، دوباره و بدونِ کش می‌خواند. manual یعنی کاربر خودش
  // دکمه را زده است و مودالِ یادآوری، حتی برایِ نسخهٔ
  // نادیده‌گرفته‌شده هم باز می‌شود؛ در بررسیِ خودکارِ باز شدنِ
  // صفحه، manual برابر false است.
  const checkLatestRelease = async (manual) => {
    if (!coreApi || typeof coreApi.checkForUpdates !== 'function') {
      setLatestRelease((prev) => ({ ...prev, status: 'error', message: 'سرویسِ بروزرسانی در این نسخه در دسترس نیست.' }));
      return;
    }
    setReleaseChecking(true);
    setLatestRelease((prev) => ({ ...prev, status: 'checking', message: '' }));
    try {
      // مرحلهٔ ۵۸ §۲ (m2): اگر IPC خطا داد، fetch رندرر جایِ آن را
      // می‌گیرد؛ اگر coreApiِ قدیمی wrapper را نداشت، همان IPC.
      const checkFn = (typeof coreApi.checkForUpdatesWithFallback === 'function')
        ? coreApi.checkForUpdatesWithFallback
        : coreApi.checkForUpdates;
      const result = await checkFn();
      let norm = null;
      try {
        if (typeof coreApi.normalizeCheckForUpdatesResult === 'function') {
          norm = coreApi.normalizeCheckForUpdatesResult(result, (appInfo && appInfo.version) || '');
        }
      } catch (_) { norm = null; }
      if (!norm) {
        setLatestRelease((prev) => ({ ...prev, status: 'error', message: 'بررسی بروزرسانی انجام نشد.' }));
        return;
      }
      if (norm.status === 'no-releases') {
        // مرحلهٔ ۵۸ §۲ (m2): گیت‌هاب ۴۰۴ داد — هنوز هیچ انتشارِ
        // عمومی نیست. خطایِ شبکه نیست؛ مؤدبانه و خنثی نشان داده
        // می‌شود و مودال هم باز نمی‌شود.
        setLatestRelease({ status: 'no-releases', latestVersion: '', publishedAt: '', releaseNotes: '', downloadUrl: '', htmlUrl: '', message: norm.message || 'هنوز نسخهٔ عمومی در بخش Releases گیت‌هاب منتشر نشده است.' });
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
        // مرحلهٔ ۵۸ §۲ (m2): نصب‌شده، برابر یا تازه‌تر از گیت‌هاب
        // است — سبزِ «به‌روز»، با هر دو نسخه، نه خطا.
        const currentShown = norm.currentVersion || (appInfo && appInfo.version) || '';
        const upToDateMsg = (currentShown && norm.latestVersion)
          ? `برنامهٔ شما به‌روز است (نسخهٔ فعلی: v${currentShown} — آخرین نسخهٔ گیت‌هاب: v${norm.latestVersion})`
          : '';
        setLatestRelease({ status: 'up-to-date', latestVersion: norm.latestVersion, publishedAt: norm.publishedAt, releaseNotes: norm.releaseNotes, downloadUrl: norm.downloadUrl, htmlUrl: norm.htmlUrl, message: upToDateMsg });
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

  // مرحلهٔ ۵۸ §۲ (m2): دکمهٔ آبیِ «به‌روزرسانی اطلاعاتِ سیستم» —
  // فقط آفلاین: اطلاعاتِ محلیِ همین نصب را تازه می‌کند و هیچ تماسی
  // با گیت‌هاب نمی‌گیرد. بررسیِ نسخهٔ جدید، فقط با دکمهٔ مستقلِ
  // «بررسی نسخهٔ جدید در گیت‌هاب» در کارتِ بروزرسانی انجام می‌شود.
  const handleRefreshSystem = async () => {
    await loadAppInfo();
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
    return () => { cancelled = true; mountedRef.current = false; };
  }, []);

  // مرحلهٔ ۵۸ §۲ (m2): هم‌گام‌ماندنِ سوییچِ بررسیِ خودکار با مودالِ
  // یادآوری و کارتِ تنظیمات؛ نگهبانِ برابری، setStateِ تکراری را
  // نمی‌گذارد.
  useEffect(() => {
    let off = null;
    try {
      if (coreApi && typeof coreApi.onAutoCheckUpdatesChanged === 'function') {
        off = coreApi.onAutoCheckUpdatesChanged((enabled) => {
          if (!mountedRef.current) return;
          setAutoCheckEnabled((prev) => (prev === enabled ? prev : enabled));
        });
      }
    } catch (_) { off = null; }
    return () => {
      try { if (typeof off === 'function') off(); } catch (_) {}
    };
  }, []);

  // مرحلهٔ ۵۸ §۲ (m2): پیشرفتِ زندهٔ دانلود با رویدادِ
  // 'app-update-status'؛ فقط وضعیتِ دانلودِ همین کارت را عوض
  // می‌کند و مرحلهٔ 'installing' را برنمی‌گرداند.
  useEffect(() => {
    let off = null;
    try {
      if (coreApi && typeof coreApi.onUpdateStatus === 'function') {
        off = coreApi.onUpdateStatus((rawEvent) => {
          if (!mountedRef.current) return;
          let norm = null;
          try {
            if (typeof coreApi.normalizeUpdateProgressEvent === 'function') norm = coreApi.normalizeUpdateProgressEvent(rawEvent);
          } catch (_) { norm = null; }
          if (!norm) return;
          if (norm.kind === 'downloading') {
            setDownloadState((prev) => ({ ...prev, status: 'downloading', progress: Math.max(0, Math.min(100, norm.percent || 0)), transferred: norm.transferred || 0, total: norm.total || 0, bytesPerSecond: norm.bytesPerSecond || 0, message: '' }));
          } else if (norm.kind === 'downloaded') {
            setDownloadState((prev) => ({ ...prev, status: 'downloaded', progress: 100, transferred: norm.transferred || prev.transferred || 0, total: norm.total || prev.total || 0, bytesPerSecond: 0, message: '' }));
          } else if (norm.kind === 'error') {
            setDownloadState((prev) => ({ ...prev, status: 'error', message: norm.message || 'دانلودِ بروزرسانی انجام نشد.' }));
          }
        });
      }
    } catch (_) { off = null; }
    return () => {
      try { if (typeof off === 'function') off(); } catch (_) {}
    };
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

  // مرحلهٔ ۵۸ §۲ (m2): سوییچِ «بررسی و یادآوریِ خودکار هنگامِ
  // ورود به برنامه» — همان کلیدِ مودالِ یادآوری و کارتِ تنظیمات؛
  // نوشتن در coreApi، رویدادِ هم‌گام‌سازی می‌فرستد تا همه‌جا همان
  // لحظه عوض شود.
  const handleAutoCheckToggle = (next) => {
    const value = next === true;
    setAutoCheckEnabled(value);
    try {
      if (coreApi && typeof coreApi.writeAutoCheckUpdatesEnabled === 'function') {
        coreApi.writeAutoCheckUpdatesEnabled(value);
      }
    } catch (_) {}
  };

  // مرحلهٔ ۵۸ §۲ (m2): برچسبِ پیشرفتِ دانلود با درصد، حجم و سرعت.
  const formatDownloadProgressLabel = (state) => {
    const pct = Math.max(0, Math.min(100, Math.round(state.progress || 0)));
    let label = `در حال دانلود… ${pct}٪`;
    try {
      if (coreApi && typeof coreApi.formatBytes === 'function' && state.total > 0) {
        label += ` • ${coreApi.formatBytes(state.transferred || 0)} از ${coreApi.formatBytes(state.total)}`;
      }
      if (coreApi && typeof coreApi.formatDownloadSpeed === 'function' && state.bytesPerSecond > 0) {
        label += ` • ${coreApi.formatDownloadSpeed(state.bytesPerSecond)}`;
      }
    } catch (_) {}
    return label;
  };

  // مرحلهٔ ۵۸ §۲ (m2): رندرِ یادداشتِ انتشارِ آخرین نسخه — بلوک‌هایِ
  // splitReleaseNotes (سرفصل/گلوله/متن)؛ اگر coreApiِ قدیمی آن را
  // نداشت، متنِ خام نشان داده می‌شود.
  const renderReleaseNotes = () => {
    if (!latestRelease.releaseNotes) return null;
    let blocks = [];
    try {
      if (coreApi && typeof coreApi.splitReleaseNotes === 'function') blocks = coreApi.splitReleaseNotes(latestRelease.releaseNotes);
    } catch (_) { blocks = []; }
    if (!blocks || blocks.length === 0) {
      return (
        <div style={styles.notesBox}>
          <p style={styles.notesText}>{latestRelease.releaseNotes}</p>
        </div>
      );
    }
    return (
      <div style={styles.notesBox}>
        <div style={styles.notesTitle}>یادداشتِ انتشارِ نسخهٔ جدید</div>
        {blocks.map((block, idx) => (
          block.kind === 'heading' ? (
            <div key={idx} style={styles.notesHeading}>{block.text}</div>
          ) : block.kind === 'bullet' ? (
            <div key={idx} style={styles.notesBulletRow}>
              <span style={styles.bullet} />
              <span style={styles.notesText}>{block.text}</span>
            </div>
          ) : (
            <div key={idx} style={styles.notesText}>{block.text}</div>
          )
        ))}
      </div>
    );
  };

  // مرحلهٔ ۵۸ §۲ (m2): دانلودِ نسخهٔ جدید از کارتِ بروزرسانی.
  // در نسخهٔ نصبی، موتورِ electron-updater؛ در حالتِ
  // Portable/توسعه، دانلودِ مستقیمِ فایلِ .exe از گیت‌هاب.
  // تکمیلِ دانلود با رویدادِ 'update-downloaded' یا با نتیجهٔ
  // مستقیمِ invoke می‌رسد و دکمهٔ نصب را روشن می‌کند.
  const handleDownloadLatest = async () => {
    if (!latestRelease.latestVersion || !coreApi) return;
    const packaged = Boolean(appInfo && appInfo.isPackaged);
    setDownloadState((prev) => ({ ...prev, status: 'downloading', progress: 0, transferred: 0, total: 0, bytesPerSecond: 0, message: '' }));
    try {
      if (packaged) {
        if (typeof coreApi.downloadUpdate !== 'function') {
          setDownloadState((prev) => ({ ...prev, status: 'error', message: 'سرویسِ دانلودِ بروزرسانی در این نسخه در دسترس نیست.' }));
          return;
        }
        await coreApi.downloadUpdate();
        return;
      }
      if (typeof coreApi.downloadUpdateDirect !== 'function') {
        setDownloadState((prev) => ({ ...prev, status: 'error', message: 'سرویسِ دانلودِ مستقیم در این نسخه در دسترس نیست.' }));
        return;
      }
      if (!latestRelease.downloadUrl) {
        setDownloadState((prev) => ({ ...prev, status: 'error', message: 'لینکِ دانلودِ نسخهٔ جدید پیدا نشد.' }));
        return;
      }
      const result = await coreApi.downloadUpdateDirect({ downloadUrl: latestRelease.downloadUrl, version: latestRelease.latestVersion });
      if (!mountedRef.current) return;
      if (result && result.success) {
        setDownloadState((prev) => ({ ...prev, status: 'downloaded', progress: 100, directFilePath: result.filePath || '', message: '' }));
      } else {
        setDownloadState((prev) => ({ ...prev, status: 'error', message: (result && result.message) || 'دانلودِ نسخهٔ جدید انجام نشد.' }));
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setDownloadState((prev) => ({ ...prev, status: 'error', message: 'دانلودِ بروزرسانی انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص') }));
    }
  };

  // مرحلهٔ ۵۸ §۲ (m2): نصبِ نسخهٔ دانلودشده و راه‌اندازیِ مجدد.
  // اگر فایلِ .exe مستقیم دانلود شده باشد، نصب‌کنندهٔ همان فایل
  // اجرا می‌شود (فلاشِ دیتابیس، داخلِ هندلر و پیش از اجراست)؛
  // وگرنه مسیرِ electron-updater (quitAndInstall) می‌رود.
  const handleInstallLatest = async () => {
    if (!coreApi) return;
    if (downloadState.directFilePath) {
      if (typeof coreApi.installDownloadedUpdate !== 'function') {
        showToast('سرویسِ نصبِ نسخهٔ دانلودشده در این نسخه در دسترس نیست.', { type: 'error' });
        return;
      }
      try {
        await coreApi.installDownloadedUpdate({ filePath: downloadState.directFilePath });
      } catch (err) {
        showToast('نصب و راه‌اندازیِ مجدد انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص'), { type: 'error' });
      }
      return;
    }
    if (typeof coreApi.quitAndInstallUpdate !== 'function') {
      showToast('سرویسِ نصبِ بروزرسانی در این نسخه در دسترس نیست.', { type: 'error' });
      return;
    }
    try {
      await coreApi.quitAndInstallUpdate();
    } catch (err) {
      showToast('نصب و راه‌اندازیِ مجدد انجام نشد: ' + (err && err.message ? err.message : 'خطای نامشخص'), { type: 'error' });
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
              نسخهٔ نصب‌شده، محیطِ اجرا و وضعیتِ دیتای همین نصب{' '}
              <span style={{ fontFamily: 'var(--font-latin)', fontWeight: 700 }}>ComicReader</span>
              {' '}— بدونِ هیچ تماسی با اینترنت؛ بررسیِ نسخهٔ جدید، در کارتِ جداگانهٔ «مرکز بروزرسانی خودکار» انجام می‌شود.
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
            onClick={handleRefreshSystem}
            disabled={infoLoading}
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
                <span>به‌روزرسانی اطلاعاتِ سیستم</span>
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
            {!infoLoading && !infoError && appInfo && appInfo.version &&
              `نسخهٔ نصب‌شده: v${appInfo.version}`}
            {!infoLoading && !infoError && (!appInfo || !appInfo.version) &&
              'اطلاعاتِ زیر، وضعیتِ واقعیِ همین نصب است.'}
          </h3>
          <p style={styles.statusDesc}>
            اطلاعاتِ این کارت، فقط از همین نصب خوانده می‌شود و هیچ تماسی با اینترنت نمی‌گیرد؛ جزئیاتِ کاملِ محیط، در بخشِ «محیطِ اجرا و سلامتِ سیستم» است و دیتا و تنظیمات، در پوشهٔ دیتا باقی می‌مانند.
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

      {/* مرحلهٔ ۵۸ §۲ (m2): کارتِ جداگانهٔ «مرکز بروزرسانی خودکار
          (GitHub Auto-Update)» — تنها جایی در این صفحه که با گیت‌هاب
          تماس می‌گیرد: نسخهٔ فعلی در برابرِ آخرین نسخهٔ گیت‌هاب،
          دکمهٔ مستقلِ بررسی (هر کلیک، دوباره و بدونِ کش می‌خواند)،
          سوییچِ بررسیِ خودکارِ ورود، یادداشتِ انتشار، و دانلود/نصب. */}
      <div style={styles.updateCard}>
        <div style={styles.updateHeaderRow}>
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.Download size={18} />
          </span>
          <div>
            <h3 style={styles.changelogHeader}>مرکز بروزرسانی خودکار (GitHub Auto-Update)</h3>
            <p style={styles.statusDesc}>
              نسخهٔ جدید، مستقیم از گیت‌هابِ PandaReader بررسی می‌شود؛ دانلود و نصب، از همین‌جا یا پنجرهٔ یادآوری انجام می‌شود و دیتا و تنظیمات، در پوشهٔ دیتا باقی می‌مانند.
            </p>
          </div>
        </div>

        <div style={styles.updateVersionsRow}>
          <span style={styles.updateVersionText}>
            {appInfo && appInfo.version ? `نسخهٔ فعلی: v${appInfo.version}` : 'نسخهٔ فعلی: نامشخص'}
          </span>
          <span style={styles.updateVersionText}>
            {latestRelease.latestVersion ? `آخرین نسخهٔ گیت‌هاب: v${latestRelease.latestVersion}` : 'آخرین نسخهٔ گیت‌هاب: هنوز بررسی نشده است'}
          </span>
          {latestRelease.publishedAt ? (
            <span style={styles.updateVersionSub}>منتشرشده در {formatReleaseDate(latestRelease.publishedAt)}</span>
          ) : null}
        </div>

        <div style={{ ...styles.updateStatusLine, color: latestRelease.status === 'up-to-date' ? '#10b981' : (latestRelease.status === 'error' ? 'var(--danger)' : 'var(--muted)') }}>
          {latestRelease.status === 'checking' && 'در حال بررسیِ آخرین نسخه در گیت‌هاب…'}
          {latestRelease.status === 'available' && latestRelease.latestVersion &&
            `نسخهٔ جدید v${latestRelease.latestVersion} در گیت‌هاب منتشر شده است.`}
          {latestRelease.status === 'up-to-date' && (latestRelease.message || 'شما به آخرین نسخه بروز هستید.')}
          {latestRelease.status === 'no-releases' && (latestRelease.message || 'هنوز نسخهٔ عمومی در بخش Releases گیت‌هاب منتشر نشده است.')}
          {latestRelease.status === 'error' && (latestRelease.message || 'بررسیِ آخرین نسخه در گیت‌هاب انجام نشد.')}
          {latestRelease.status === 'idle' && 'برای بررسی نسخهٔ جدید، روی «بررسی نسخهٔ جدید در گیت‌هاب» بزنید.'}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void checkLatestRelease(true)}
            disabled={releaseChecking || downloadState.status === 'downloading'}
            style={{ ...styles.checkBtn, ...((releaseChecking || downloadState.status === 'downloading') ? styles.checkBtnDisabled : {}) }}
          >
            {releaseChecking ? (
              <>
                <Icons.Loader size={15} />
                <span>در حال بررسی…</span>
              </>
            ) : (
              <>
                <Icons.RefreshCw size={15} />
                <span>بررسی نسخهٔ جدید در گیت‌هاب</span>
              </>
            )}
          </button>
          {latestRelease.status === 'available' && (
            <button
              type="button"
              onClick={handleDownloadLatest}
              disabled={downloadState.status === 'downloading'}
              style={styles.checkBtn}
            >
              <Icons.Download size={15} />
              <span>{appInfo && appInfo.isPackaged ? 'دانلود بروزرسانی' : 'دانلود فایل نصب (.exe)'}</span>
            </button>
          )}
          {downloadState.status === 'downloaded' && (
            <button
              type="button"
              onClick={handleInstallLatest}
              style={{ ...styles.checkBtn, ...styles.installBtn }}
            >
              <Icons.RefreshCw size={15} />
              <span>نصب و راه‌اندازی مجدد (Install & Restart)</span>
            </button>
          )}
        </div>

        <div style={styles.optionsRow}>
          <div style={styles.optionLabelWrap}>
            <span style={styles.optionLabel}>بررسی و یادآوریِ خودکار هنگامِ ورود به برنامه</span>
            <span style={styles.optionSub}>۵ ثانیه پس از باز شدنِ برنامه، آخرین نسخه در گیت‌هاب بررسی می‌شود.</span>
          </div>
          <input
            type="checkbox"
            checked={autoCheckEnabled}
            onChange={(e) => handleAutoCheckToggle(e.target.checked)}
            aria-label="بررسی و یادآوری خودکار هنگام ورود به برنامه"
            style={{ width: '18px', height: '18px', accentColor: 'var(--accent)', cursor: 'pointer' }}
          />
        </div>

        {downloadState.status === 'downloading' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={styles.progressBarTrack}>
              <div style={{ ...styles.progressBarFill, width: `${Math.max(0, Math.min(100, downloadState.progress || 0))}%` }} />
            </div>
            <span style={styles.percentText}>{formatDownloadProgressLabel(downloadState)}</span>
          </div>
        )}
        {downloadState.status === 'downloaded' && (
          <p style={styles.statusDesc}>دانلود کامل شد؛ با «نصب و راه‌اندازی مجدد»، نسخهٔ جدید نصب می‌شود.</p>
        )}
        {downloadState.status === 'error' && downloadState.message ? (
          <p style={styles.statusDesc}>{downloadState.message}</p>
        ) : null}

        {latestRelease.releaseNotes ? renderReleaseNotes() : null}
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
  // مرحلهٔ ۵۸ §۲ (m2): استایل‌هایِ کارتِ جداگانهٔ بروزرسانی.
  updateCard: {
    backgroundColor: 'var(--panel)',
    borderRadius: '18px',
    border: '1px solid var(--border)',
    padding: '20px 24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.4)',
  },
  updateHeaderRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
  },
  updateVersionsRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px 16px',
    flexWrap: 'wrap',
  },
  updateVersionText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 700,
    color: 'var(--text)',
  },
  updateVersionSub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    color: 'var(--muted)',
  },
  updateStatusLine: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 700,
  },
  checkBtnDisabled: {
    opacity: 0.55,
    cursor: 'not-allowed',
    boxShadow: 'none',
  },
  installBtn: {
    backgroundColor: '#22c55e',
    boxShadow: '0 4px 14px rgba(34, 197, 94, 0.3)',
  },
  notesBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '12px 14px',
  },
  notesTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 800,
    color: 'var(--text)',
  },
  notesHeading: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 800,
    color: 'var(--accent)',
    marginTop: '4px',
  },
  notesBulletRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  notesText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
    lineHeight: '1.7',
    margin: 0,
  },
};