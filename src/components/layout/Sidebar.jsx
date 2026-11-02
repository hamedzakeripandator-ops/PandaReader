import React, { useState, useCallback, useEffect } from 'react';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useReaderStore from '../../store/useReaderStore';
import useSettingsStore from '../../store/useSettingsStore';
import useBookmarkStore from '../../store/useBookmarkStore';
import { coreApi } from '../../services/coreApi';
import { getAppSessionSeconds } from '../../services/readingActivity';
import { formatReadingHours } from '../../utils/readingStats';
import Icons from '../common/Icons';

// مرحله ۱۴: ویجتِ زندهٔ «زمانِ حضور در برنامه» — بالایِ کارتِ
// پروفایل. تیکِ ۱ ثانیه‌ای، فقط همین کامپوننت را بازرندر
// می‌کند، نه کلِ سایدبار؛ مجموعِ کل، هر ۶۰ ثانیه از دیتابیس
// تازه می‌شود و نشستِ فعلی، از موتورِ readingActivity می‌آید.
function AppTimeWidget() {
  const [total, setTotal] = useState(0);
  const [session, setSession] = useState(0);

  useEffect(() => {
    let mounted = true;
    const loadTotal = async () => {
      try {
        if (coreApi.isAvailable()) {
          const res = await coreApi.getReadingStats();
          if (mounted && res) setTotal(Number(res.totalAppSeconds) || 0);
        }
      } catch (_) {}
    };
    loadTotal();
    const refreshTimer = setInterval(loadTotal, 60000);
    const tickTimer = setInterval(() => {
      try {
        setSession(getAppSessionSeconds());
      } catch (_) {}
    }, 1000);
    return () => {
      mounted = false;
      clearInterval(refreshTimer);
      clearInterval(tickTimer);
    };
  }, []);

  // مرحلهٔ ۳۱ — چیدمانِ عمودیِ ضدِ برش: سطرِ اول، آیکون +
  // عنوانِ کوتاه؛ سطرهایِ مقدار، کامل و بدونِ ellipsis. پیش‌تر،
  // مقدارها در یک ردیفِ تنگ با nowrap/ellipsis بریده می‌شدند و
  // ساعتِ مطالعه با «...» ناتمام می‌ماند.
  return (
    <div style={styles.appTimeWidget} title="زمانِ حضور در برنامه">
      <div style={styles.appTimeHeaderRow}>
        <span style={styles.appTimeIcon}>
          <Icons.Clock size={15} />
        </span>
        <span style={styles.appTimeTitle}>زمانِ حضور در برنامه</span>
      </div>
      <span style={styles.appTimeLine}>مجموعِ حضور در اپ: {formatReadingHours(total)}</span>
      <span style={styles.appTimeLine}>نشستِ فعلی: {formatReadingHours(session)}</span>
    </div>
  );
}

export default function Sidebar({ onMouseEnter, onMouseLeave }) {
  // سلکتورهای اتمی برای جلوگیری از بازرندر ناخواسته
  const currentView = useAppStore((state) => state.currentView);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const returnToReader = useAppStore((state) => state.returnToReader);
  const isLeftSidebarOpen = useAppStore((state) => state.isLeftSidebarOpen);
  const setIsLeftSidebarOpen = useAppStore((state) => state.setIsLeftSidebarOpen);

  // اشتراک فقط به طول آرایه‌ها جهت صفر کردن بازرندر در حین اسکرول
  const libraryCount = useLibraryStore((state) => state.library?.length || 0);
  const recentCount = useLibraryStore((state) => state.recentItems?.length || 0);
  // مرحله ۱۴: بجِ شمارندهٔ کلِ بوک‌مارک‌ها (همهٔ کتاب‌ها).
  const totalBookmarkCount = useBookmarkStore((state) => state.totalBookmarkCount);
  const loadAllBookmarks = useBookmarkStore((state) => state.loadAllBookmarks);
  useEffect(() => {
    loadAllBookmarks();
  }, [loadAllBookmarks]);
  const favCount = useLibraryStore((state) => state.favorites?.length || 0);
  const downloadsCount = useLibraryStore((state) => state.downloads?.length || 0);

  const activeFileName = useReaderStore((state) => state.comicData?.fileName || null);
  const currentPage = useReaderStore((state) =>
    currentView !== 'reader' && isLeftSidebarOpen ? state.currentPage : 1
  );

  const profile = useSettingsStore((state) => state.profile);
  const showCounts = useSettingsStore(
    (state) => state.preferences?.showSidebarCounts !== false
  );

  const [hoveredId, setHoveredId] = useState(null);

  const navItems = [
    { id: 'home', Icon: Icons.Home, label: 'Home', persianHint: 'خانه', count: 0 },
    {
      id: 'library',
      Icon: Icons.Library,
      label: 'Library',
      persianHint: 'کتابخانه',
      count: libraryCount,
    },
    {
      id: 'recent',
      Icon: Icons.Clock,
      label: 'Recent',
      persianHint: 'اخیراً خوانده‌شده',
      count: recentCount,
    },
    {
      id: 'bookmarks',
      Icon: Icons.Bookmark,
      label: 'Bookmarks',
      persianHint: 'بوک‌مارک‌ها',
      count: totalBookmarkCount,
    },
    {
      id: 'favorites',
      Icon: Icons.Heart,
      label: 'Favorites',
      persianHint: 'علاقه‌مندی‌ها',
      count: favCount,
    },
    {
      id: 'downloads',
      Icon: Icons.Rocket,
      label: 'Updates',
      persianHint: 'مرکز آپدیت',
      count: downloadsCount,
    },
    { id: 'settings', Icon: Icons.Settings, label: 'Settings', persianHint: 'تنظیمات', count: 0 },
  ];

  const handleSelectNav = useCallback(
    (viewId) => {
      setCurrentView(viewId);
      setIsLeftSidebarOpen(false);
    },
    [setCurrentView, setIsLeftSidebarOpen]
  );

  const handleResumeReader = useCallback(() => {
    returnToReader();
    setIsLeftSidebarOpen(false);
  }, [returnToReader, setIsLeftSidebarOpen]);

  const isProfileActive = currentView === 'profile';
  const userAvatarImage = profile?.avatar || profile?.customAvatar || null;

  return (
    <aside
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        ...styles.sidebar,
        opacity: isLeftSidebarOpen ? 1 : 0,
        pointerEvents: isLeftSidebarOpen ? 'auto' : 'none',
        transform: isLeftSidebarOpen
          ? 'translate3d(0, 0, 0)'
          : 'translate3d(-104%, 0, 0)',
        boxShadow: isLeftSidebarOpen ? '12px 0 34px rgba(0, 0, 0, 0.72)' : 'none',
      }}
    >
      {/* پل نامرئی کنار لبه راست سایدبار برای جلوگیری از قطع شدن هاور هنگام حرکت دست به سمت دستگیره */}
      {isLeftSidebarOpen && <div style={styles.hoverSafetyBridge} />}

      <div style={styles.topSection}>
        {activeFileName && currentView !== 'reader' && (
          <button
            type="button"
            onClick={handleResumeReader}
            style={styles.resumeBanner}
            title={`بازگشت به کمیک: ${activeFileName}`}
          >
            <span style={styles.resumeIcon}>
              <Icons.BookOpen size={18} />
            </span>
            <div style={styles.resumeTextWrap}>
              <span style={styles.resumeTitle}>ادامه مطالعه</span>
              <span style={styles.resumeSub}>
                {activeFileName} (ص {currentPage})
              </span>
            </div>
          </button>
        )}

        <nav style={styles.navMenu}>
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            const isHovered = hoveredId === item.id;
            const ItemIcon = item.Icon;

            return (
              <div
                key={item.id}
                onClick={() => handleSelectNav(item.id)}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                title={item.persianHint}
                style={{
                  ...styles.navItem,
                  ...(isActive ? styles.navActive : {}),
                  ...(!isActive && isHovered ? styles.navHover : {}),
                }}
              >
                <span
                  style={{
                    ...styles.iconBox,
                    color: isActive ? 'var(--accent)' : 'inherit',
                  }}
                >
                  <ItemIcon size={17} />
                </span>
                <span style={styles.label}>{item.label}</span>

                {showCounts && item.count > 0 && (
                  <span
                    style={{
                      ...styles.badge,
                      backgroundColor: isActive
                        ? 'rgba(34, 211, 238, 0.18)'
                        : 'rgba(255, 255, 255, 0.05)',
                      color: isActive ? 'var(--accent)' : 'var(--muted)',
                    }}
                  >
                    {item.count}
                  </span>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      <AppTimeWidget />

      <div
        onClick={() => handleSelectNav('profile')}
        onMouseEnter={() => setHoveredId('profile')}
        onMouseLeave={() => setHoveredId(null)}
        title="مشاهده پروفایل و آمار مطالعه"
        style={{
          ...styles.profileCard,
          ...(isProfileActive ? styles.profileActive : {}),
          ...(!isProfileActive && hoveredId === 'profile' ? styles.profileHover : {}),
        }}
      >
        <div
          style={{
            ...styles.avatar,
            backgroundImage: userAvatarImage
              ? `url("${userAvatarImage}")`
              : profile?.avatarGradient ||
                'linear-gradient(135deg, #22d3ee 0%, #0f171c 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!userAvatarImage && (
            <span style={{ fontFamily: 'var(--font-latin)', fontWeight: 800 }}>
              {(profile?.username || 'H').charAt(0).toUpperCase()}
            </span>
          )}
        </div>

        <div style={styles.profileInfo}>
          <span style={styles.profileName}>{profile?.username || 'Haamed'}</span>
          <span style={styles.profileSubtitle}>
            {profile?.subtitle || 'پروفایل و آمار'}
          </span>
        </div>
        <span style={styles.chevron}>
          <Icons.ChevronRight size={15} />
        </span>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    width: '230px',
    minWidth: '230px',
    padding: '10px 8px',
    height: '100%',
    boxSizing: 'border-box',
    backgroundColor: 'rgba(13, 20, 26, 0.96)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: 'var(--radius-lg)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    transition:
      'transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, box-shadow 0.28s ease',
    willChange: 'transform, opacity',
    userSelect: 'none',
    position: 'relative',
  },
  hoverSafetyBridge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: '-16px',
    width: '16px',
    backgroundColor: 'transparent',
  },
  topSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
  },
  resumeBanner: {
    display: 'flex',
    // مرحله ۴ — جهتِ صریحِ ردیف: آیکون چپ‌ترین، بعد اسم (چیدمانِ ردیف‌ها
    // نباید از dir سند به‌ارث برسد؛ مرحله ۳ با rtl شدنِ سند، ردیف‌های
    // بدونِ جهتِ صریح را برعکس کرده بود).
    direction: 'ltr',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: '12px',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.4)',
    color: 'var(--text)',
    cursor: 'pointer',
    textAlign: 'right',
    // مرحلهٔ ۳۲ — کلیدِ تکراریِ `direction: 'rtl'` که اینجا بود، حذف شد
    // (هشدارِ کلیدِ تکراریِ Vite را می‌ساخت)؛ جهتِ مؤثر حالا همان `ltr`ِ
    // بالایِ همین شیء است که با نیتِ توضیحِ مرحلهٔ ۴ می‌خواند (اول آیکون
    // در سمتِ چپ، بعد نام).
    transition: 'all 0.2s ease',
    outline: 'none',
  },
  resumeIcon: {
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
  },
  resumeTextWrap: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flex: 1,
    gap: '2px',
  },
  resumeTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--accent)',
  },
  resumeSub: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    direction: 'ltr',
    textAlign: 'right',
  },
  navMenu: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    width: '100%',
  },
  navItem: {
    // مرحله ۴ — جهتِ صریحِ ردیف: آیکون چپ‌ترین، بعد اسم، بعد کادرِ عدد.
    direction: 'ltr',
    padding: '10px 14px',
    borderRadius: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    color: 'var(--muted)',
    cursor: 'pointer',
    fontFamily: 'var(--font-latin)',
    fontSize: '13.5px',
    fontWeight: 700,
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    transition: 'background-color 0.16s ease, color 0.16s ease, border-color 0.16s ease',
    position: 'relative',
  },
  navHover: {
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
  },
  navActive: {
    backgroundColor: 'var(--panel2)',
    borderColor: 'var(--border)',
    color: 'var(--text)',
  },
  iconBox: {
    width: '22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    whiteSpace: 'nowrap',
    direction: 'ltr',
  },
  badge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '10px',
    fontVariantNumeric: 'tabular-nums',
    direction: 'ltr',
  },
  appTimeWidget: {
    direction: 'rtl',
    backgroundColor: 'var(--panel2)',
    borderRadius: '16px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    width: '100%',
    boxSizing: 'border-box',
  },
  appTimeHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  appTimeIcon: {
    color: '#f59e0b',
    display: 'flex',
    paddingTop: '2px',
    flexShrink: 0,
  },
  appTimeTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 800,
    color: 'var(--text)',
  },
  appTimeLine: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    lineHeight: 1.4,
    color: 'var(--muted)',
    whiteSpace: 'normal',
    wordBreak: 'keep-all',
  },
  profileCard: {
    // مرحله ۴ — جهتِ صریحِ ردیف: آواتار چپ‌ترین، بعد اسم، بعد فلش.
    direction: 'ltr',
    backgroundColor: 'var(--panel2)',
    borderRadius: '16px',
    padding: '10px 14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    cursor: 'pointer',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    width: '100%',
    boxSizing: 'border-box',
    transition: 'border-color 0.18s ease, background-color 0.18s ease, transform 0.18s ease',
  },
  profileHover: {
    borderColor: 'var(--accent)',
    transform: 'translateY(-2px)',
  },
  profileActive: {
    backgroundColor: 'rgba(34, 211, 238, 0.14)',
    borderColor: 'var(--accent)',
  },
  avatar: {
    width: '36px',
    height: '36px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#fff',
    fontSize: '14px',
    flexShrink: 0,
    boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.35)',
    overflow: 'hidden',
  },
  profileInfo: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
    gap: '2px',
    // مرحله ۴ — با ltr شدنِ ردیف، زیرنویسِ فارسی باید راست‌چین بماند
    // (نامِ لاتین، direction صریحِ خودش را دارد و چپ‌چین می‌ماند).
    direction: 'rtl',
  },
  profileName: {
    fontFamily: 'var(--font-latin)',
    fontSize: '13.5px',
    fontWeight: 800,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    direction: 'ltr',
  },
  profileSubtitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    fontWeight: 500,
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  chevron: {
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
  },
};