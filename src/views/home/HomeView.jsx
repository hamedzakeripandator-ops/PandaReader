import React, { useState, useEffect } from 'react';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import useSettingsStore from '../../store/useSettingsStore';

// مرحله ۱۱: عددهایِ پیش‌فرضِ «تعدادِ نمایشِ مواردِ اخیر» در
// صفحهٔ خانه؛ عددهایِ سفارشیِ کاربر، از تنظیمات (db.json) به
// همین فهرست اضافه می‌شوند.
const DEFAULT_RECENT_LIMITS = [6, 12, 18, 24, 36, 50];
import QuickActionCards from './QuickActionCards';
import ComicCard from '../library/ComicCard';
import StorageSection from '../../components/common/StorageSection';
import { coreApi } from '../../services/coreApi';
import { formatReadingHours } from '../../utils/readingStats';
import thumbnailService, { resolveCoverUrl } from '../../services/thumbnailService';
import Icons from '../../components/common/Icons';

export default function HomeView({ onSelectFile, onSelectFolder, onOpenComic }) {
  const { recentItems, library, libraryItems, favorites } = useLibraryStore();
  // مرحله ۱۴: مجموعِ زمانِ حضور در برنامه (از دیتابیس).
  const [appTotalSeconds, setAppTotalSeconds] = useState(0);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await coreApi.getReadingStats();
        if (mounted && res) setAppTotalSeconds(Number(res.totalAppSeconds) || 0);
      } catch (_) {}
    })();
    return () => { mounted = false; };
  }, []);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const showToast = useAppStore((state) => state.showToast);

  const effectiveLibrary = library || libraryItems || [];
  const lastReadComic = recentItems?.[0] || null;
  // مرحله ۱۱: حدِ نمایشِ مواردِ اخیر، از تنظیماتِ ماندگار
  // (db.json) خوانده می‌شود؛ ۱ تا ۲۰۰ و پیش‌فرضِ ۱۲.
  const homeRecentLimit = useSettingsStore((state) => state.preferences?.homeRecentLimit);
  const homeRecentCustomPresets = useSettingsStore((state) => state.preferences?.homeRecentCustomPresets);
  const updatePreferences = useSettingsStore((state) => state.updatePreferences);
  const recentLimit = Math.max(1, Math.min(200, Number(homeRecentLimit) || 12));
  const customPresets = Array.isArray(homeRecentCustomPresets)
    ? homeRecentCustomPresets.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 200)
    : [];
  const recentLimitOptions = Array.from(new Set([...DEFAULT_RECENT_LIMITS, ...customPresets])).sort((a, b) => a - b);
  const recentPreview = (recentItems || []).filter(Boolean).slice(0, recentLimit);
  const [limitMenuOpen, setLimitMenuOpen] = useState(false);
  const [customLimitInput, setCustomLimitInput] = useState('');

  const handleSelectRecentLimit = (n) => {
    if (typeof updatePreferences === 'function') updatePreferences({ homeRecentLimit: n });
    setLimitMenuOpen(false);
  };
  const handleAddCustomRecentLimit = () => {
    const n = Number.parseInt(String(customLimitInput).trim(), 10);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      showToast('عددِ دلخواه باید بینِ ۱ تا ۲۰۰ باشد.', { type: 'warning' });
      return;
    }
    if (typeof updatePreferences === 'function') {
      updatePreferences({
        homeRecentCustomPresets: Array.from(new Set([...customPresets, n])),
        homeRecentLimit: n,
      });
    }
    setCustomLimitInput('');
    setLimitMenuOpen(false);
  };

  const lastReadPath = lastReadComic?.path || lastReadComic?.filePath || '';
  const lastReadTitle = lastReadComic?.name || lastReadComic?.fileName || lastReadPath.split(/[\\/]/).pop() || '';

  // دریافت امن و بلادرنگ کاور آخرین کمیک خوانده‌شده
  const [lastReadCover, setLastReadCover] = useState(() => {
    return resolveCoverUrl(lastReadComic?.cover) || thumbnailService.peekCover(lastReadPath);
  });

  useEffect(() => {
    let isMounted = true;
    if (!lastReadPath) {
      setLastReadCover(null);
      return;
    }

    const cached = resolveCoverUrl(lastReadComic?.cover) || thumbnailService.peekCover(lastReadPath);
    if (cached) {
      setLastReadCover(cached);
      return;
    }

    thumbnailService.getThumbnail(lastReadPath).then((fresh) => {
      if (isMounted && fresh) {
        setLastReadCover(fresh);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [lastReadPath, lastReadComic?.cover]);
  // مرحله ۱۰: پاک‌سازیِ خودکارِ فایل‌هایِ حذف‌شده از سیستم — یک بار
  // در هر جلسه (sessionStorage)، بی‌صدا مگر اینکه موردی پاک شود.
  useEffect(() => {
    let cancelled = false;
    try {
      if (sessionStorage.getItem('comicReader.autoPruneDone.v1')) return;
      sessionStorage.setItem('comicReader.autoPruneDone.v1', '1');
    } catch (_) {
      return;
    }
    (async () => {
      try {
        const res = await coreApi.pruneMissingFiles();
        if (cancelled || !res || !res.success) return;
        const removed = Array.isArray(res.removed) ? res.removed : [];
        if (removed.length > 0) {
          await useLibraryStore.getState().applyPruneResult(removed.map((r) => r.path).filter(Boolean));
          showToast(`${removed.length} فایلِ حذف‌شده از سیستم، از برنامه هم پاک شد.`, { type: 'info' });
        }
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [showToast]);


  const lastReadPercent = lastReadComic
    ? typeof lastReadComic.percentage === 'number'
      ? Math.min(100, Math.max(0, lastReadComic.percentage))
      : typeof lastReadComic.progress === 'number'
      ? Math.min(100, Math.max(0, lastReadComic.progress))
      : lastReadComic.lastPage && lastReadComic.totalPages
      ? Math.min(100, Math.round((lastReadComic.lastPage / Math.max(1, lastReadComic.totalPages)) * 100))
      : 0
    : 0;

  const handleOpenFolderFallback = async () => {
    if (onSelectFolder) {
      onSelectFolder();
      return;
    }
    const res = await coreApi.openFolder();
    if (res?.success && res.filePath && onOpenComic) {
      onOpenComic(res.filePath);
    }
  };

  const handleOpenLastRead = () => {
    if (onOpenComic && lastReadComic) {
      onOpenComic(lastReadPath || lastReadComic);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.containerInner}>

      {/* بنر هیرو (Landing Hero) طبق جدول استاندارد تایپوگرافی */}
      <div style={styles.heroBanner}>
        <div style={styles.heroTextSide}>
          {/* پیل برند لاتین: Manrope 700 فیروزه‌ای outline */}
          <div style={styles.brandPill}>
            <Icons.Sparkles size={13} />
            <span>Webtoon & Manga Pro Reader</span>
          </div>

          {/* تیتر بزرگ: Estedad 800 32px + کلمه برند لاتین Manrope 800 */}
          <h1 style={styles.mainTitle}>
            به <span style={styles.brandInline}>PandaReader</span> خوش آمدید
          </h1>

          {/* پاراگراف: Estedad 400 14px + فرمت‌های فایل داخل code با Mono 500 */}
          <p style={styles.subText}>
            فایل‌های <code style={styles.codeTag}>CBZ</code>،{' '}
            <code style={styles.codeTag}>ZIP</code>، <code style={styles.codeTag}>CBR</code>،{' '}
            <code style={styles.codeTag}>RAR</code> یا <code style={styles.codeTag}>PDF</code> و
            حتی پوشه‌های مستقیم عکس را به هر جای پنجره بکشید و رها کنید یا از ابزارهای سریع زیر
            استفاده کنید.
          </p>

          {/* پیل‌های آمار: Estedad 600 12.5px + عدد 700 tabular */}
          <div style={styles.statsRow}>
            <div style={styles.statChip} onClick={() => setCurrentView('library')}>
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.Library size={15} />
              </span>
              <span>کتابخانه:</span>
              <strong style={styles.statNumber}>{effectiveLibrary.length}</strong>
            </div>

            <div style={styles.statChip} onClick={() => setCurrentView('favorites')}>
              <span style={{ color: 'var(--danger)', display: 'flex' }}>
                <Icons.Heart size={15} filled />
              </span>
              <span>علاقه‌مندی:</span>
              <strong style={styles.statNumber}>{favorites?.length || 0}</strong>
            </div>

            <div style={styles.statChip} onClick={() => setCurrentView('recent')}>
              <span style={{ color: 'var(--purple)', display: 'flex' }}>
                <Icons.Clock size={15} />
              </span>
              <span>مطالعه اخیر:</span>
              <strong style={styles.statNumber}>{recentItems?.length || 0}</strong>
            </div>

            <div style={styles.statChip} onClick={() => setCurrentView('profile')} title="مجموعِ زمانِ حضور در برنامه">
              <span style={{ color: '#f59e0b', display: 'flex' }}>
                <Icons.Clock size={15} />
              </span>
              <span>حضور در اپ:</span>
              <strong style={styles.statNumber}>{formatReadingHours(appTotalSeconds)}</strong>
            </div>
          </div>
        </div>

        {/* پنل کناری هیرو: کارت ادامه مطالعه مجهز به پیش‌نمایش کاور و استایل تفکیک‌شده */}
        {lastReadComic ? (
          <div
            onClick={handleOpenLastRead}
            style={styles.lastReadBox}
            title="کلیک برای ادامه مطالعه از آخرین صفحه"
          >
            <div style={styles.lastReadInner}>
              {/* پیش‌نمایش بندانگشتی مانهوا */}
              <div style={styles.lastReadThumbWrap}>
                {lastReadCover ? (
                  <img
                    src={lastReadCover}
                    alt={lastReadTitle}
                    loading="lazy"
                    decoding="async"
                    style={styles.lastReadThumbImg}
                    onError={() => setLastReadCover(null)}
                  />
                ) : (
                  <div style={styles.lastReadThumbPlaceholder}>
                    <Icons.BookOpen size={22} />
                  </div>
                )}
              </div>

              {/* مشخصات و پیشرفت مطالعه */}
              <div style={styles.lastReadDetails}>
                <div style={styles.lastReadHeader}>
                  <span style={styles.lastReadLabel}>
                    <Icons.BookOpen size={13} />
                    <span>آخرین کمیک در حال مطالعه</span>
                  </span>
                  <span style={styles.progressPill}>{lastReadPercent}%</span>
                </div>

                <div style={styles.lastReadName} title={lastReadTitle}>
                  {lastReadTitle}
                </div>

                <div style={styles.lastReadPage}>
                  صفحه {lastReadComic.lastPage || lastReadComic.currentPage || 1}
                  {lastReadComic.totalPages ? ` از ${lastReadComic.totalPages}` : ''}
                </div>

                <button type="button" style={styles.continueBtn}>
                  <span>ادامه مطالعه</span>
                  <Icons.ChevronLeft size={14} />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div onClick={onSelectFile} style={styles.dropZoneBox}>
            <div style={styles.dropIconCircle}>
              <Icons.FolderOpen size={26} />
            </div>
            <span style={styles.dropTitle}>انتخاب یا رها کردن فایل کمیک</span>
            <span style={styles.dropSub}>کلیک کنید تا پنجره انتخاب باز شود</span>
          </div>
        )}
      </div>

      {/* گرید ۴ کارت ویژگی */}
      <QuickActionCards
        onSelectFile={onSelectFile}
        onSelectFolder={handleOpenFolderFallback}
      />
      {/* ردیف «اخیراً مطالعه شده»: تیتر Estedad 800 19px + لینک فیروزه‌ای Estedad 600 12.5px */}
      {recentPreview.length > 0 && (
        <div style={styles.recentSection}>
          <div style={styles.sectionHeader}>
            <div style={styles.sectionTitleWrap}>
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.Clock size={19} />
              </span>
              <h3 style={styles.sectionTitle}>اخیراً مطالعه شده</h3>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }}>
              <button
                type="button"
                onClick={() => setLimitMenuOpen((open) => !open)}
                aria-haspopup="true"
                aria-expanded={limitMenuOpen}
                style={styles.limitBtn}
              >
                <span>تعدادِ نمایش: {recentLimit}</span>
                <Icons.ChevronDown size={14} />
              </button>
              {limitMenuOpen && (
                <>
                  <div
                    style={{ position: 'fixed', inset: 0, zIndex: 49, background: 'transparent' }}
                    onMouseDown={() => setLimitMenuOpen(false)}
                  />
                  <div style={styles.limitMenu} role="menu">
                    {recentLimitOptions.map((n) => (
                      <button
                        type="button"
                        key={n}
                        onClick={() => handleSelectRecentLimit(n)}
                        style={{ ...styles.limitMenuItem, ...(n === recentLimit ? styles.limitMenuItemActive : {}) }}
                      >
                        <span>{n} مورد</span>
                        {n === recentLimit ? <Icons.Check size={14} /> : null}
                      </button>
                    ))}
                    <div style={styles.limitMenuDivider} />
                    <div style={styles.limitMenuCustomRow}>
                      <input
                        type="number"
                        min={1}
                        max={200}
                        value={customLimitInput}
                        onChange={(e) => setCustomLimitInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomRecentLimit(); }}
                        dir="ltr"
                        placeholder="عددِ دلخواه…"
                        style={styles.limitMenuInput}
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomRecentLimit}
                        style={styles.limitMenuAddBtn}
                      >
                        <Icons.Plus size={14} />
                        <span>افزودن</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={() => setCurrentView('library')}
                style={styles.seeAllBtn}
              >
                <span>مشاهده ویترین کتابخانه</span>
                <Icons.ChevronLeft size={14} />
              </button>
            </div>
          </div>

          <div style={styles.recentGrid}>
            {recentPreview.map((item, idx) => (
              <ComicCard
                key={item.path || item.filePath || `recent-${idx}`}
                item={item}
                onOpenComic={onOpenComic}
                showRemoveBtn={false}
              />
            ))}
          </div>
        </div>
      )}

      {/* مرحله ۱۱: کارتِ اطلاعاتِ دیتابیس/حافظه، پس از «مواردِ
          اخیر» قرار گرفت تا ابتدا اقدام‌هایِ سریع و مواردِ اخیر
          دیده شوند. */}
      <div style={{ marginTop: '2px' }}>
        <StorageSection compact />
      </div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    height: '100%',
    padding: '16px 20px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '22px',
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
    gap: '22px',
    direction: 'rtl',
    flex: 1,
    minWidth: 0,
  },

  heroBanner: {
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: '20px',
    padding: '28px 30px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '24px',
    flexWrap: 'wrap',
    boxShadow: '0 16px 36px rgba(0, 0, 0, 0.4)',
  },
  heroTextSide: {
    flex: 1,
    minWidth: '280px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: '12px',
  },
  brandPill: {
    fontFamily: 'var(--font-latin)',
    fontWeight: 700,
    fontSize: '11.5px',
    direction: 'ltr',
    backgroundColor: 'rgba(34, 211, 238, 0.08)',
    color: 'var(--accent)',
    padding: '5px 13px',
    borderRadius: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.38)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
  },
  mainTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '32px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
    lineHeight: 1.3,
  },
  brandInline: {
    fontFamily: 'var(--font-latin)',
    fontWeight: 800,
    color: 'var(--accent)',
    direction: 'ltr',
    display: 'inline-block',
  },
  subText: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 400,
    fontSize: '14px',
    color: 'var(--muted)',
    lineHeight: '1.8',
    maxWidth: '560px',
    margin: 0,
  },
  codeTag: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 500,
    fontSize: '12px',
    color: 'var(--accent)',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    padding: '1px 6px',
    borderRadius: '6px',
    direction: 'ltr',
    display: 'inline-block',
  },
  statsRow: {
    display: 'flex',
    gap: '10px',
    marginTop: '6px',
    flexWrap: 'wrap',
  },
  statChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    padding: '7px 14px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    fontFamily: 'var(--font-fa)',
    fontWeight: 600,
    fontSize: '12.5px',
    color: 'var(--text)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  statNumber: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    color: 'var(--accent)',
    fontVariantNumeric: 'tabular-nums',
  },
  lastReadBox: {
    width: '320px',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
    borderRadius: '18px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    cursor: 'pointer',
    boxShadow: '0 10px 28px rgba(0, 0, 0, 0.35), 0 0 20px rgba(34, 211, 238, 0.08)',
    transition: 'transform 0.2s ease',
  },
  lastReadInner: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  lastReadThumbWrap: {
    width: '64px',
    height: '88px',
    borderRadius: '10px',
    overflow: 'hidden',
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastReadThumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  lastReadThumbPlaceholder: {
    color: 'var(--accent)',
    opacity: 0.7,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastReadDetails: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    overflow: 'hidden',
  },
  lastReadHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '6px',
  },
  lastReadLabel: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 600,
    fontSize: '10.5px',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    whiteSpace: 'nowrap',
  },
  progressPill: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 700,
    fontSize: '10.5px',
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    padding: '1px 6px',
    borderRadius: '6px',
    direction: 'ltr',
    fontVariantNumeric: 'tabular-nums',
  },
  lastReadName: {
    fontFamily: 'var(--font-latin)',
    fontSize: '13.5px',
    fontWeight: 800,
    color: 'var(--text)',
    direction: 'ltr',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  lastReadPage: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 500,
    fontSize: '11px',
    color: 'var(--muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  continueBtn: {
    marginTop: '2px',
    padding: '7px 12px',
    borderRadius: '9px',
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    border: 'none',
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
  },
  dropZoneBox: {
    width: '280px',
    height: '165px',
    borderRadius: '18px',
    borderWidth: '2px',
    borderStyle: 'dashed',
    borderColor: 'rgba(34, 211, 238, 0.4)',
    backgroundColor: 'var(--panel2)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  dropIconCircle: {
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 700,
    color: 'var(--text)',
  },
  dropSub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 400,
    color: 'var(--muted)',
  },
  recentSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  sectionTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '19px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  seeAllBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--accent)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  limitBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 12px',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  limitMenu: {
    position: 'absolute',
    top: 'calc(100% + 6px)',
    left: 0,
    zIndex: 50,
    minWidth: '190px',
    padding: '6px',
    borderRadius: '12px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel)',
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.4)',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  limitMenuItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 10px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
    textAlign: 'right',
    width: '100%',
  },
  limitMenuItemActive: {
    backgroundColor: 'var(--panel2)',
    color: 'var(--accent)',
  },
  limitMenuDivider: {
    height: '1px',
    backgroundColor: 'var(--border)',
    margin: '6px 4px',
  },
  limitMenuCustomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '2px 4px 4px',
  },
  limitMenuInput: {
    flex: 1,
    minWidth: 0,
    padding: '7px 10px',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    fontSize: '12.5px',
    textAlign: 'left',
    outline: 'none',
  },
  limitMenuAddBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '7px 10px',
    borderRadius: '8px',
    border: '1px solid var(--accent)',
    backgroundColor: 'var(--accent)',
    color: '#fff',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  recentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
    gap: '16px',
  },
};
