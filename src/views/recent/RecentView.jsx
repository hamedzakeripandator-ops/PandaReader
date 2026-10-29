import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import ComicCard from '../library/ComicCard';
import { coreApi } from '../../services/coreApi';
import thumbnailService, { resolveCoverUrl } from '../../services/thumbnailService';
import Icons from '../../components/common/Icons';

// تبدیل تاریخ ISO به زمان نسبی فارسی
function formatRelativeTime(dateString) {
  if (!dateString) return 'اخیراً';
  try {
    const diff = (Date.now() - new Date(dateString).getTime()) / 1000;
    if (diff < 60) return 'چند لحظه پیش';
    if (diff < 3600) return `${Math.floor(diff / 60)} دقیقه پیش`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ساعت پیش`;
    if (diff < 604800) return `${Math.floor(diff / 86400)} روز پیش`;
    return new Date(dateString).toLocaleDateString('fa-IR');
  } catch (_) {
    return 'اخیراً';
  }
}

// ردیف اختصاصی نمایش فهرستی مجهز به خودترمیمی کاور و حذف تداخل استایل React
const RecentListRow = React.memo(function RecentListRow({ item, onOpenComic, onShowInFolder, onRemoveItem }) {
  const filePath = item?.path || item?.filePath || '';
  const title = item?.name || item?.fileName || filePath.split(/[\\/]/).pop() || 'Untitled';

  const [coverUrl, setCoverUrl] = useState(() => {
    return resolveCoverUrl(item?.cover) || thumbnailService.peekCover(filePath);
  });
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    let isMounted = true;
    if (!filePath) return;

    const existing = resolveCoverUrl(item?.cover) || thumbnailService.peekCover(filePath);
    if (existing) {
      setCoverUrl(existing);
      return;
    }

    thumbnailService.getThumbnail(filePath).then((res) => {
      if (isMounted && res) {
        setCoverUrl(res);
      }
    });

    return () => {
      isMounted = false;
      // مرحله ۹: اگر کاور هنوز به دست نیامده، درخواستِ در صف را
      // لغو کن تا صفِ کاورها با کارت‌هایِ خارج از دید، پر نشود.
      if (!existing) thumbnailService.cancelThumbnailRequest(filePath);
    };
  }, [filePath, item?.cover]);

  // بازیابی خودکار در صورت لود ناموفق تصویر (مثلاً فایل‌های پاک‌شده پوشه موقت)
  const handleImageError = useCallback(() => {
    setCoverUrl(null);
    if (filePath) {
      thumbnailService.getThumbnail(filePath).then((freshCover) => {
        if (freshCover) {
          setCoverUrl(freshCover);
        }
      });
    }
  }, [filePath]);

  // مرحله ۹: برچسبِ زمان، فقط وقتی مهرِ زمانی عوض شود محاسبه می‌شود.
  const timeLabel = useMemo(
    () => formatRelativeTime(item?.lastReadAt || item?.updatedAt),
    [item?.lastReadAt, item?.updatedAt]
  );

  const lastPage = item?.lastPage || item?.currentPage || 1;
  const totalPages = item?.totalPages || 1;
  const progress =
    typeof item?.percentage === 'number'
      ? item.percentage
      : typeof item?.progress === 'number'
      ? item.progress
      : Math.min(100, Math.round((lastPage / Math.max(1, totalPages)) * 100));

  return (
    <div
      onClick={() => onOpenComic && onOpenComic(item)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...styles.listItem,
        borderColor: isHovered ? 'var(--accent)' : 'var(--border)',
        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {/* کاور کوچک بندانگشتی با نسبت 3:4 */}
      <div style={styles.thumbBox}>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            style={styles.thumbImg}
            onError={handleImageError}
          />
        ) : (
          <span style={{ color: 'var(--accent)', display: 'flex' }}>
            <Icons.BookOpen size={20} />
          </span>
        )}
      </div>

      {/* عنوان لاتین Manrope 700 و مسیر فایل Mono 400 */}
      <div style={styles.itemInfo}>
        <div style={styles.itemTitle} title={title}>
          {title}
        </div>
        <div style={styles.itemPath} title={filePath}>
          {filePath}
        </div>
      </div>

      {/* پیشرفت مطالعه و زمان نسبی */}
      <div style={styles.progressCol}>
        <div style={styles.progressText}>
          <span style={styles.pageLabel}>
            صفحه {lastPage}
            {item?.totalPages ? ` از ${totalPages}` : ''}
          </span>
          <strong style={styles.percentBadge}>{progress}%</strong>
        </div>
        <div style={styles.progressTrack}>
          <div style={{ ...styles.progressFill, width: `${Math.max(4, progress)}%` }} />
        </div>
        <span style={styles.timeTag}>
          {timeLabel}
        </span>
      </div>

      {/* دکمه‌های اکشن سطر با آیکون‌های وکتور */}
      <div style={styles.itemActions}>
        <button
          type="button"
          onClick={(e) => onShowInFolder(e, filePath)}
          style={styles.iconActionBtn}
          title="نمایش در پوشه ویندوز"
        >
          <Icons.Folder size={14} />
        </button>
        <button
          type="button"
          onClick={(e) => onRemoveItem(e, filePath, title)}
          style={{ ...styles.iconActionBtn, color: 'var(--danger)' }}
          title="حذف از تاریخچه"
        >
          <Icons.X size={14} />
        </button>
      </div>
    </div>
  );
});

// مرحله ۹: اسلاتِ تنبل — دقیقاً الگویِ LazyLibraryCardِ مرحلهٔ ۴
// (IntersectionObserver با rootMargin 400px + قفلِ ارتفاعِ
// اندازه‌گیری‌شده) تا در تاریخچه‌هایِ شلوغ، فقط آیتم‌هایِ داخلِ
// دید مانت شوند و درخواستِ کاور بدهند؛ وقتی آیتمی از دید خارج
// شد، آنمانت می‌شود و پاک‌سازیِ ردیف، درخواستِ کاورِ در صف را
// لغو می‌کند.
function LazyRecentSlot({ children, skeletonStyle }) {
  const slotRef = useRef(null);
  const measuredHeightRef = useRef(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = slotRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setIsVisible(entry.isIntersecting);
      },
      { root: null, rootMargin: '400px 0px', threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const el = slotRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.offsetHeight || 0;
      if (h > 0) measuredHeightRef.current = h;
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [isVisible]);

  const lockedHeight = measuredHeightRef.current;

  return (
    <div ref={slotRef}>
      {isVisible ? (
        children
      ) : (
        <div
          style={
            lockedHeight > 0
              ? { ...skeletonStyle, height: lockedHeight, boxSizing: 'border-box', overflow: 'hidden' }
              : skeletonStyle
          }
        />
      )}
    </div>
  );
}

export default function RecentView({ onOpenComic }) {
  const { recentItems, removeFromRecent, clearRecents } = useLibraryStore();
  const { searchQuery, showToast } = useAppStore();

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'
  const [confirmClear, setConfirmClear] = useState(false);

  const filteredRecents = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return recentItems || [];
    return (recentItems || []).filter((item) => {
      const name = (item.name || item.fileName || '').toLowerCase();
      const path = (item.path || item.filePath || '').toLowerCase();
      return name.includes(q) || path.includes(q);
    });
  }, [recentItems, searchQuery]);

  // مرحله ۹: دسته‌بندیِ زمانی — در خودِ فایل، هیچ گروه‌بندی‌ای
  // وجود نداشت؛ گروه‌ها (امروز / دیروز / هفتهٔ گذشته /
  // قدیمی‌تر) اینجا و در useMemo ساخته می‌شوند تا با هر رندر،
  // دوباره محاسبه نشوند. مبنا، شروعِ روزِ محلی است.
  const groupedRecents = useMemo(() => {
    const startOfDay = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };
    const todayStart = startOfDay(new Date());
    const yesterdayStart = todayStart - 86400000;
    const weekStart = todayStart - 6 * 86400000;
    const groups = [
      { id: 'today', title: 'امروز', items: [] },
      { id: 'yesterday', title: 'دیروز', items: [] },
      { id: 'week', title: 'هفتهٔ گذشته', items: [] },
      { id: 'older', title: 'قدیمی‌تر', items: [] },
    ];
    for (const item of filteredRecents) {
      const t = new Date(item?.lastReadAt || item?.updatedAt || 0).getTime();
      const dayStart = Number.isFinite(t) && t > 0 ? startOfDay(new Date(t)) : 0;
      if (dayStart >= todayStart) groups[0].items.push(item);
      else if (dayStart >= yesterdayStart) groups[1].items.push(item);
      else if (dayStart >= weekStart) groups[2].items.push(item);
      else groups[3].items.push(item);
    }
    return groups.filter((group) => group.items.length > 0);
  }, [filteredRecents]);

  const handleClearAll = () => {
    clearRecents();
    setConfirmClear(false);
    showToast('تاریخچه مطالعه به طور کامل پاک شد', { type: 'info' });
  };

  // مرحله ۹: کال‌بک‌هایِ پایدار — اگر این هندلرها در هر رندر،
  // تابعِ تازه بسازند، React.memoِ ردیف‌ها بی‌اثر می‌شود.
  const handleRemoveItem = useCallback(
    (e, filePath, title) => {
      e.stopPropagation();
      removeFromRecent(filePath);
      showToast(`«${title}» از تاریخچه حذف شد`, { type: 'info' });
    },
    [removeFromRecent, showToast]
  );

  const handleShowInFolder = useCallback((e, filePath) => {
    e.stopPropagation();
    if (filePath) coreApi.showItemInFolder(filePath);
  }, []);

  return (
    <div style={styles.container}>
      {/* هدر بالای تاریخچه */}
      <div style={styles.header}>
        <div style={styles.titleWrap}>
          <div style={styles.headerIcon}>
            <Icons.Clock size={22} />
          </div>
          <div>
            <h2 style={styles.title}>تاریخچه مطالعه (Recent)</h2>
            <span style={styles.subtitle}>
              {filteredRecents.length} عنوان ثبت‌شده در تایم‌لاین مطالعه شما
            </span>
          </div>
        </div>

        <div style={styles.actionsWrap}>
          {/* دکمه‌های تغییر چیدمان (لیست / گرید) */}
          <div style={styles.toggleGroup}>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              style={{
                ...styles.toggleBtn,
                ...(viewMode === 'list' ? styles.toggleBtnActive : {}),
              }}
              title="نمایش فهرستی"
            >
              <Icons.Layers size={14} />
              <span>لیست</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              style={{
                ...styles.toggleBtn,
                ...(viewMode === 'grid' ? styles.toggleBtnActive : {}),
              }}
              title="نمایش کارتی و گرید"
            >
              <Icons.Library size={14} />
              <span>کارت‌ها</span>
            </button>
          </div>

          {/* دکمه پاک کردن کل تاریخچه */}
          {(recentItems || []).length > 0 &&
            (confirmClear ? (
              <div style={styles.confirmBox}>
                <button type="button" onClick={handleClearAll} style={styles.confirmBtn}>
                  تأیید حذف همه
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  style={styles.cancelBtn}
                >
                  انصراف
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                style={styles.clearAllBtn}
              >
                <Icons.Trash size={14} />
                <span>پاک کردن تاریخچه</span>
              </button>
            ))}
        </div>
      </div>

      {/* وضعیت خالی بودن تاریخچه */}
      {filteredRecents.length === 0 ? (
        <div style={styles.emptyBox}>
          <div style={styles.emptyIconCircle}>
            <Icons.Clock size={36} />
          </div>
          <p style={styles.emptyTitle}>
            {searchQuery
              ? `هیچ موردی با عبارت «${searchQuery}» در تاریخچه پیدا نشد.`
              : 'هنوز هیچ کمیکی مطالعه نشده است.'}
          </p>
          <span style={styles.emptySub}>
            با باز کردن هر کمیک یا مانهوا، پیشرفت و آخرین صفحه مطالعه شما به صورت خودکار در اینجا ذخیره می‌شود.
          </span>
        </div>
      ) : (
        groupedRecents.map((group) => (
          <div key={group.id}>
            <div style={styles.sectionHeader}>{group.title}</div>
            {viewMode === 'grid' ? (
              <div style={styles.grid}>
                {group.items.map((item, idx) => (
                  <LazyRecentSlot
                    key={item.path || item.filePath || `recent-grid-${idx}`}
                    skeletonStyle={styles.cardSkeleton}
                  >
                    <ComicCard
                      item={item}
                      onOpenComic={onOpenComic}
                      onRemove={(path) => removeFromRecent(path)}
                      showRemoveBtn={true}
                    />
                  </LazyRecentSlot>
                ))}
              </div>
            ) : (
              <div style={styles.list}>
                {group.items.map((item, index) => (
                  <LazyRecentSlot
                    key={item.path || item.filePath || `recent-list-${index}`}
                    skeletonStyle={styles.rowSkeleton}
                  >
                    <RecentListRow
                      item={item}
                      onOpenComic={onOpenComic}
                      onShowInFolder={handleShowInFolder}
                      onRemoveItem={handleRemoveItem}
                    />
                  </LazyRecentSlot>
                ))}
              </div>
            )}
          </div>
        ))
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
    gap: '18px',
    overflowY: 'auto',
    direction: 'rtl',
    userSelect: 'none',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '14px',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--border)',
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
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.3)',
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
    fontWeight: 500,
    color: 'var(--muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  actionsWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  toggleGroup: {
    display: 'flex',
    backgroundColor: 'var(--panel)',
    padding: '4px',
    borderRadius: '11px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    gap: '4px',
  },
  toggleBtn: {
    padding: '6px 12px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--muted)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.15s ease',
  },
  toggleBtnActive: {
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    fontWeight: 700,
  },
  clearAllBtn: {
    padding: '7px 14px',
    borderRadius: '10px',
    backgroundColor: 'rgba(248, 81, 73, 0.1)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(248, 81, 73, 0.35)',
    color: 'var(--danger)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  confirmBox: {
    display: 'flex',
    gap: '6px',
  },
  confirmBtn: {
    padding: '7px 12px',
    borderRadius: '9px',
    backgroundColor: 'var(--danger)',
    border: 'none',
    color: '#fff',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  cancelBtn: {
    padding: '7px 12px',
    borderRadius: '9px',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: '16px',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  // مرحله ۹: سربرگِ بخشِ زمانی + اسکلت‌هایِ اسلاتِ تنبل. هیچ
  // backdrop-filterای در این فایل نیست و هیچ‌کدام هم اضافه
  // نشده است؛ پس‌زمینه‌ها همان پنلِ نیمه‌شفافِ سبکِ قبلی‌اند.
  sectionHeader: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 800,
    color: 'var(--muted)',
    margin: '6px 2px 10px',
  },
  rowSkeleton: {
    backgroundColor: 'var(--panel)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    minHeight: '84px',
  },
  cardSkeleton: {
    backgroundColor: 'var(--panel)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    minHeight: '230px',
  },
  listItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '10px 14px',
    backgroundColor: 'var(--panel)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    cursor: 'pointer',
    // مرحله ۹: فقط transform و border-color انیمیشن دارند ('all'،
    // هر تغییرِ استایل را به کامپوزیتور می‌کشاند) + ایزولاسیونِ
    // چیدمان/رنگ برای اسکرولِ ۶۰ فریم.
    transition: 'transform 0.18s ease, border-color 0.18s ease',
    contain: 'layout paint',
  },
  thumbBox: {
    width: '48px',
    height: '64px',
    borderRadius: '9px',
    backgroundColor: 'var(--bg)',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
  },
  thumbImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  itemInfo: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    overflow: 'hidden',
  },
  itemTitle: {
    fontFamily: 'var(--font-latin)',
    fontSize: '14px',
    fontWeight: 700,
    color: 'var(--text)',
    direction: 'ltr',
    textAlign: 'right',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  itemPath: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 400,
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    direction: 'ltr',
    textAlign: 'right',
  },
  progressCol: {
    width: '175px',
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
    flexShrink: 0,
  },
  progressText: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pageLabel: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 500,
    color: 'var(--muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  percentBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--accent)',
    direction: 'ltr',
  },
  progressTrack: {
    width: '100%',
    height: '5px',
    backgroundColor: 'var(--panel2)',
    borderRadius: '4px',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--accent)',
  },
  timeTag: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    color: 'var(--muted)',
    textAlign: 'left',
    fontVariantNumeric: 'tabular-nums',
  },
  itemActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  iconActionBtn: {
    width: '32px',
    height: '32px',
    borderRadius: '9px',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  emptyBox: {
    flex: 1,
    padding: '54px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: '10px',
  },
  emptyIconCircle: {
    width: '68px',
    height: '68px',
    borderRadius: '20px',
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '6px',
  },
  emptyTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text)',
    margin: 0,
  },
  emptySub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
    maxWidth: '420px',
    lineHeight: 1.6,
  },
};
