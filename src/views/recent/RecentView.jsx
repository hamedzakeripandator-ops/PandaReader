import React, { useState, useMemo, useEffect, useCallback } from 'react';
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
function RecentListRow({ item, onOpenComic, onShowInFolder, onRemoveItem }) {
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
          {formatRelativeTime(item?.lastReadAt || item?.updatedAt)}
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
}

export default function RecentView({ onOpenComic }) {
  const { recentItems, removeFromRecent, clearRecents, recentLimit, setRecentLimit } = useLibraryStore();
  const { searchQuery, showToast } = useAppStore();

  const [viewMode, setViewMode] = useState('list'); // 'list' | 'grid'
  const [confirmClear, setConfirmClear] = useState(false);
  // مرحلهٔ ۳۰ — ورودیِ عددِ دلخواهِ حدِ نمایش (۱ تا ۵۰۰).
  const [customLimitInput, setCustomLimitInput] = useState('');
  // مرحلهٔ ۳۰ — حدِ نمایشِ مؤثر: 'all' یعنی همهٔ مواردِ نگه‌داشته‌شده.
  const effectiveLimit = recentLimit === 'all' ? Number.POSITIVE_INFINITY : (Number(recentLimit) || 100);

  const filteredRecents = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return recentItems || [];
    return (recentItems || []).filter((item) => {
      const name = (item.name || item.fileName || '').toLowerCase();
      const path = (item.path || item.filePath || '').toLowerCase();
      return name.includes(q) || path.includes(q);
    });
  }, [recentItems, searchQuery]);

  // مرحلهٔ ۳۰ — برشِ نمایشی بر اساسِ حدِ انتخاب‌شده (پس از فیلترِ
  // جستجو)؛ شمارِ کل، برایِ خطِ شمارشِ بالایِ لیست نگه داشته می‌شود.
  const displayedRecents = useMemo(() => filteredRecents.slice(0, effectiveLimit), [filteredRecents, effectiveLimit]);

  const handleSelectRecentLimit = (value) => {
    if (typeof setRecentLimit === 'function') setRecentLimit(value);
  };
  const handleAddCustomRecentLimit = () => {
    const n = Number.parseInt(String(customLimitInput).trim(), 10);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      showToast('عددِ دلخواه باید بینِ ۱ تا ۵۰۰ باشد.', { type: 'warning' });
      return;
    }
    handleSelectRecentLimit(n);
    setCustomLimitInput('');
  };

  const handleClearAll = () => {
    clearRecents();
    setConfirmClear(false);
    showToast('تاریخچه مطالعه به طور کامل پاک شد', { type: 'info' });
  };

  const handleRemoveItem = (e, filePath, title) => {
    e.stopPropagation();
    removeFromRecent(filePath);
    showToast(`«${title}» از تاریخچه حذف شد`, { type: 'info' });
  };

  const handleShowInFolder = (e, filePath) => {
    e.stopPropagation();
    if (filePath) coreApi.showItemInFolder(filePath);
  };

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
              نمایشِ {displayedRecents.length} از {filteredRecents.length} عنوان (مجموعِ نگه‌داشته‌شده: {(recentItems || []).length})
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

          {/* مرحلهٔ ۳۰ — انتخابگرِ تعدادِ نمایشِ مواردِ اخیر */}
          <div style={styles.limitWrap}>
            <span style={styles.limitLabel}>تعداد نمایش:</span>
            <div style={styles.toggleGroup}>
              {[20, 50, 100, 200, 500, 'all'].map((n) => (
                <button
                  key={String(n)}
                  type="button"
                  onClick={() => handleSelectRecentLimit(n)}
                  style={{
                    ...styles.toggleBtn,
                    ...(recentLimit === n ? styles.toggleBtnActive : {}),
                  }}
                  title={n === 'all' ? 'نمایش همه' : `نمایش ${n} مورد`}
                >
                  {n === 'all' ? 'همه' : n}
                </button>
              ))}
            </div>
            <div style={styles.limitCustomRow}>
              <input
                type="number"
                min={1}
                max={500}
                value={customLimitInput}
                onChange={(e) => setCustomLimitInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustomRecentLimit(); }}
                placeholder="عدد دلخواه (۱ تا ۵۰۰)"
                style={styles.limitCustomInput}
              />
              <button type="button" onClick={handleAddCustomRecentLimit} style={styles.limitCustomBtn}>
                اعمال
              </button>
            </div>
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
      ) : viewMode === 'grid' ? (
        <div style={styles.grid}>
          {displayedRecents.map((item, idx) => (
            <ComicCard
              key={item.path || item.filePath || `recent-grid-${idx}`}
              item={item}
              onOpenComic={onOpenComic}
              onRemove={(path) => removeFromRecent(path)}
              showRemoveBtn={true}
            />
          ))}
        </div>
      ) : (
        <div style={styles.list}>
          {displayedRecents.map((item, index) => (
            <RecentListRow
              key={item.path || item.filePath || `recent-list-${index}`}
              item={item}
              onOpenComic={onOpenComic}
              onShowInFolder={handleShowInFolder}
              onRemoveItem={handleRemoveItem}
            />
          ))}
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
  limitWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  limitLabel: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
  },
  limitCustomRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  limitCustomInput: {
    width: '130px',
    padding: '6px 10px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'var(--panel)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    outline: 'none',
  },
  limitCustomBtn: {
    padding: '6px 12px',
    borderRadius: '8px',
    border: 'none',
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
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
    transition: 'all 0.18s ease',
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
