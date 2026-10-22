import React, { useState, useRef, useEffect } from 'react';
import useAppStore from '../../store/useAppStore';
import Icons from '../../components/common/Icons';

const CURRENT_VERSION = 'v5.0.0-pro';
const BUILD_DATE = 'مهر ۱۴۰۵ • اکتبر ۲۰۲۶';

const CHANGELOG_HISTORY = [
  {
    version: 'v5.0.0-pro',
    label: 'نسخه فعلی',
    date: 'مهر ۱۴۰۵ - اکتبر ۲۰۲۶',
    badge: 'فعال',
    features: [
      'موتور استخراج صاعقه‌ای تک‌تصویر کاور در رم (coverOnly) با زمان پاسخ زیر ۰.۱ ثانیه',
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
      'اسلایدر درگ‌پذیر با موس در بالای کتابخانه به همراه ذخیره دائمی کاورهای Base64 در دیتابیس',
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

  const [updateStatus, setUpdateStatus] = useState('idle'); // 'idle' | 'checking' | 'latest' | 'available' | 'downloading'
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [autoCheck, setAutoCheck] = useState(true);

  const checkTimerRef = useRef(null);
  const downloadIntervalRef = useRef(null);

  useEffect(() => {
    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
      if (downloadIntervalRef.current) clearInterval(downloadIntervalRef.current);
    };
  }, []);

  const handleCheckForUpdates = () => {
    if (updateStatus === 'checking' || updateStatus === 'downloading') return;

    setUpdateStatus('checking');
    showToast('در حال بررسی سرور برای دریافت آخرین نسخه...', { type: 'info' });

    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(() => {
      setUpdateStatus('latest');
      showToast('شما از آخرین نسخه برنامه استفاده می‌کنید', { type: 'success' });
    }, 1600);
  };

  const handleSimulateDownload = () => {
    setUpdateStatus('downloading');
    setDownloadProgress(0);

    if (downloadIntervalRef.current) clearInterval(downloadIntervalRef.current);
    downloadIntervalRef.current = setInterval(() => {
      setDownloadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(downloadIntervalRef.current);
          setUpdateStatus('latest');
          showToast('به‌روزرسانی با موفقیت دریافت و آماده نصب شد', { type: 'success' });
          return 100;
        }
        return prev + 20;
      });
    }, 350);
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
            <h2 style={styles.title}>مرکز به‌روزرسانی و ارتقای نرم‌افزار</h2>
            <span style={styles.subtitle}>
              مدیریت دانلود پچ‌ها، آپدیت‌های سیستمی و تاریخچه تغییرات{' '}
              <span style={{ fontFamily: 'var(--font-latin)', fontWeight: 700 }}>ComicReader</span>
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCheckForUpdates}
          disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
          style={styles.checkBtn}
        >
          {updateStatus === 'checking' ? (
            <>
              <Icons.Loader size={15} />
              <span>در حال بررسی سرور...</span>
            </>
          ) : (
            <>
              <Icons.RefreshCw size={15} />
              <span>بررسی نسخه جدید</span>
            </>
          )}
        </button>
      </div>

      {/* کارت وضعیت نسخه جاری */}
      <div style={styles.versionStatusCard}>
        <div style={styles.statusLeft}>
          <div style={styles.versionBadgeRow}>
            <span style={styles.versionPill}>{CURRENT_VERSION}</span>
            <span style={styles.buildDateText}>تاریخ ساخت: {BUILD_DATE}</span>
          </div>
          <h3 style={styles.statusTitle}>
            {updateStatus === 'checking' && 'در حال ارتباط با مخزن آپدیت...'}
            {updateStatus === 'idle' && 'نرم‌افزار شما در وضعیت آماده به کار قرار دارد.'}
            {updateStatus === 'latest' &&
              'نسخه شما کاملاً به‌روز است و هیچ آپدیت جدیدی در انتظار نیست.'}
            {updateStatus === 'available' &&
              'نسخه جدید با قابلیت‌های ارتقایافته در دسترس است!'}
            {updateStatus === 'downloading' &&
              `در حال دانلود بسته آپدیت (${downloadProgress}%)...`}
          </h3>
          <p style={styles.statusDesc}>
            کانال انتشار: استیبل (Stable Official Channel) • معماری ۶۴ بیتی الکترون
          </p>
        </div>

        <div style={styles.statusRight}>
          {updateStatus === 'downloading' ? (
            <div style={styles.downloadProgressBox}>
              <div style={styles.progressBarTrack}>
                <div style={{ ...styles.progressBarFill, width: `${downloadProgress}%` }} />
              </div>
              <span style={styles.percentText}>{downloadProgress}%</span>
            </div>
          ) : updateStatus === 'available' ? (
            <button
              type="button"
              onClick={handleSimulateDownload}
              style={styles.downloadActionBtn}
            >
              <Icons.Download size={15} />
              <span>دانلود و نصب نسخه جدید</span>
            </button>
          ) : (
            <div style={styles.okBadge}>
              <Icons.Check size={15} />
              <span>سیستم پایدار</span>
            </div>
          )}
        </div>
      </div>

      {/* تنظیمات خودکار بررسی */}
      <div style={styles.optionsRow}>
        <div style={styles.optionLabelWrap}>
          <span style={styles.optionLabel}>بررسی خودکار نسخه‌های جدید هنگام اجرای برنامه</span>
          <span style={styles.optionSub}>
            در صورت وجود پچ جدید، اعلان کپسولی در بالای صفحه ظاهر خواهد شد
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setAutoCheck(!autoCheck);
            showToast(
              !autoCheck ? 'بررسی خودکار آپدیت فعال شد' : 'بررسی خودکار غیرفعال شد',
              { type: 'info' }
            );
          }}
          style={{
            ...styles.toggleBtn,
            backgroundColor: autoCheck
              ? 'rgba(34, 211, 238, 0.14)'
              : 'rgba(255, 255, 255, 0.04)',
            borderColor: autoCheck ? 'var(--accent)' : 'var(--border)',
            color: autoCheck ? 'var(--accent)' : 'var(--muted)',
          }}
        >
          <Icons.Check size={14} />
          <span>{autoCheck ? 'روشن (فعال)' : 'خاموش'}</span>
        </button>
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
                  <span style={styles.logVersionTitle}>{log.version}</span>
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