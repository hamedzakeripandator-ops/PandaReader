import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import ComicCard from '../library/ComicCard';
import { coreApi } from '../../services/coreApi';
import thumbnailService, { resolveCoverUrl, downscaleThumbnailWithPica, dataUrlByteSize } from '../../services/thumbnailService';
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

// مرحلهٔ ۳۶ §۳: ابزارهایِ انتخابِ کتاب برایِ آماربندی (همان قاعدهٔ
// نرمال‌سازیِ ورکرِ دیتابیس: trim + اسلش‌ها به بک‌اسلش + lowercase).
function normalizeRecentBookKey(p) {
  if (!p || typeof p !== 'string') return '';
  return p.trim().replace(/\//g, '\\').toLowerCase();
}
function recentItemPath(item) {
  return (item && (item.path || item.filePath)) || '';
}
function recentItemType(item) {
  const raw = item && item.type;
  if (raw === 'pdf' || raw === 'epub') return raw;
  const p = String(recentItemPath(item)).toLowerCase();
  if (p.endsWith('.pdf')) return 'pdf';
  if (p.endsWith('.epub')) return 'epub';
  return 'comic';
}
const STAT_VIEW_COLORS = ['#22d3ee', '#a855f7', '#f59e0b', '#10b981', '#ec4899', '#f97316'];
const STAT_VIEW_METRICS = [
  { id: 'hours', label: 'مجموعِ ساعتِ مطالعه' },
  { id: 'pages', label: 'تعدادِ صفحاتِ خوانده‌شده' },
  { id: 'progress', label: 'درصدِ پیشرفتِ کلِ دسته' },
  { id: 'bookmarks', label: 'تعدادِ بوک‌مارک‌ها' },
  { id: 'highlights', label: 'تعدادِ هایلایت‌ها و یادداشت‌ها' },
  { id: 'speed', label: 'میانگینِ سرعتِ مطالعه' },
  { id: 'goal', label: 'هدفِ ساعتی/صفحه‌ای با نوارِ پیشرفت' },
];

// مرحلهٔ ۳۶ §۳: چک‌باکسِ برداری — تیکِ استاندارد با دنبالهٔ کوتاه در
// چپ و دنبالهٔ بلند در راست/بالا (polyline لوسید: 20 6 9 17 4 12).
function StatsCheckBox({ checked, onToggle, label }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={Boolean(checked)}
      aria-label={label || 'انتخاب کتاب'}
      onClick={(e) => { e.stopPropagation(); if (onToggle) onToggle(); }}
      style={{
        width: 24, height: 24, borderRadius: 7, flexShrink: 0, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
        background: checked ? '#22d3ee' : 'transparent',
        border: checked ? '2px solid #22d3ee' : '2px solid var(--border)',
        color: '#ffffff',
      }}
    >
      {checked && (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </button>
  );
}

// ردیف اختصاصی نمایش فهرستی مجهز به خودترمیمی کاور و حذف تداخل استایل React
function RecentListRow({ item, onOpenComic, onShowInFolder, onRemoveItem, selectionMode, isSelected, onToggleSelect }) {
  const filePath = item?.path || item?.filePath || '';
  const title = item?.name || item?.fileName || filePath.split(/[\\/]/).pop() || 'Untitled';

  const [coverUrl, setCoverUrl] = useState(() => {
    return resolveCoverUrl(item?.cover) || thumbnailService.peekCover(filePath);
  });
  const [isHovered, setIsHovered] = useState(false);
  const recompressedForRef = useRef(null);

  // مرحلهٔ ۳۹ §۲: اگر تامبنیلِ ذخیره‌شده بزرگ است (بالایِ ۴۸KB)، یک
  // بار در پس‌زمینه با pica کوچکش کن و نسخهٔ کوچک را در کش بنویس تا
  // بارِ بعد از اول کوچک لود شود. غیرمسدودکننده و فقط یک بار به‌ازای
  // هر فایل.
  useEffect(() => {
    if (!filePath || !coverUrl || typeof coverUrl !== 'string') return;
    if (!coverUrl.startsWith('data:image/')) return;
    if (recompressedForRef.current === filePath) return;
    if (dataUrlByteSize(coverUrl) <= 48 * 1024) return;
    recompressedForRef.current = filePath;
    const run = () => {
      downscaleThumbnailWithPica(coverUrl)
        .then((small) => {
          if (!small || dataUrlByteSize(small) >= dataUrlByteSize(coverUrl)) return;
          setCoverUrl(small);
          try {
            useLibraryStore.getState().cacheCover?.(filePath, small);
          } catch (_) {}
        })
        .catch(() => {});
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 0);
  }, [coverUrl, filePath]);

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
      onClick={() => { if (selectionMode) { if (onToggleSelect) onToggleSelect(filePath); } else if (onOpenComic) onOpenComic(item); }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        ...styles.listItem,
        borderColor: isSelected ? '#22d3ee' : (isHovered ? 'var(--accent)' : 'var(--border)'),
        backgroundColor: isSelected ? 'rgba(34,211,238,0.08)' : undefined,
        transform: isHovered ? 'translateY(-2px)' : 'translateY(0)',
      }}
    >
      {selectionMode && (
        <StatsCheckBox checked={Boolean(isSelected)} onToggle={() => onToggleSelect && onToggleSelect(filePath)} label={title} />
      )}
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
  const { searchQuery, showToast, isStatsBookSelectionMode, statsSelectedBookPaths, editingStatCategoryId, statsSelectionOrigin, enterStatsSelectionFromRecent, setStatsSelectedBookPaths, toggleStatsSelectedBookPath, cancelStatsSelection, finishStatsSelectionToProfile, finishWithSavedStatView } = useAppStore();
  const [statModal, setStatModal] = useState(null);

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

  // مرحلهٔ ۳۶ §۳: ابزارهایِ انتخاب — «انتخاب همه» رویِ همهٔ مواردِ
  // فیلترشده (نه فقط برشِ نمایشی) اعمال می‌شود.
  const allFilteredPaths = useMemo(() => (filteredRecents || []).map((it) => recentItemPath(it)).filter(Boolean), [filteredRecents]);
  const selectedCount = (statsSelectedBookPaths || []).length;
  const handleSelectAllFiltered = () => setStatsSelectedBookPaths(allFilteredPaths);
  const handleClearSelection = () => setStatsSelectedBookPaths([]);
  const handleInvertSelection = () => {
    const cur = new Set(statsSelectedBookPaths || []);
    const inverted = allFilteredPaths.filter((p) => !cur.has(p));
    const outside = (statsSelectedBookPaths || []).filter((p) => !allFilteredPaths.includes(p));
    setStatsSelectedBookPaths([...inverted, ...outside]);
  };
  const handleSelectType = (kind) => {
    setStatsSelectedBookPaths((filteredRecents || []).filter((it) => recentItemType(it) === kind).map((it) => recentItemPath(it)).filter(Boolean));
  };
  const openStatModalFromSelection = () => {
    const paths = statsSelectedBookPaths || [];
    if (paths.length === 0) {
      showToast('برایِ ساختِ آماربندی، دست‌کم یک کتاب انتخاب کن', { type: 'warning' });
      return;
    }
    const bookKeys = paths.map((p) => normalizeRecentBookKey(p)).filter(Boolean);
    let existing = null;
    if (editingStatCategoryId) {
      try {
        const raw = localStorage.getItem('comicReader.customStatViews.v1');
        const list = raw ? JSON.parse(raw) : [];
        if (Array.isArray(list)) existing = list.find((v) => v.id === editingStatCategoryId) || null;
      } catch (_) {}
    }
    setStatModal({
      id: existing ? existing.id : null,
      name: existing ? existing.name : '',
      color: existing ? existing.color : '#22d3ee',
      bookKeys,
      metrics: existing && Array.isArray(existing.metrics) && existing.metrics.length ? [...existing.metrics] : ['hours', 'pages'],
      goalHours: existing ? (Number(existing.goalHours) || 0) : 0,
      goalPages: existing ? (Number(existing.goalPages) || 0) : 0,
    });
  };
  const handleSaveStatModal = () => {
    if (!statModal) return;
    const name = (statModal.name || '').trim();
    if (!name) {
      showToast('نامِ آماربندی نمی‌تواند خالی باشد', { type: 'warning' });
      return;
    }
    const view = {
      id: statModal.id || `cv-${Date.now()}`,
      name,
      color: statModal.color || '#22d3ee',
      bookKeys: statModal.bookKeys || [],
      metrics: (statModal.metrics || []).length ? statModal.metrics : ['hours', 'pages'],
      goalHours: Number(statModal.goalHours) || 0,
      goalPages: Number(statModal.goalPages) || 0,
    };
    let list = [];
    try {
      const raw = localStorage.getItem('comicReader.customStatViews.v1');
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) list = parsed;
    } catch (_) {}
    const next = view.id && list.some((v) => v.id === view.id)
      ? list.map((v) => (v.id === view.id ? view : v))
      : [...list, view];
    try { localStorage.setItem('comicReader.customStatViews.v1', JSON.stringify(next)); } catch (_) {}
    if (coreApi.dbAction) coreApi.dbAction({ action: 'SAVE_CUSTOM_STAT_VIEWS', payload: { views: next } }).catch(() => {});
    setStatModal(null);
    showToast('آماربندیِ سفارشی ذخیره شد', { type: 'success' });
    if (typeof finishWithSavedStatView === 'function') finishWithSavedStatView(view.id);
  };
  const handlePrimaryCreate = () => {
    if (selectedCount === 0) {
      showToast('برایِ ساختِ آماربندی، دست‌کم یک کتاب انتخاب کن', { type: 'warning' });
      return;
    }
    // مبدا پروفایل: نهایی‌سازی (نام/رنگ/شاخص) در Profile باز می‌شود؛
    // مبدا خودِ Recent: همان مودال، همین‌جا باز می‌شود.
    if (statsSelectionOrigin === 'profile') {
      if (typeof finishStatsSelectionToProfile === 'function') finishStatsSelectionToProfile(statsSelectedBookPaths);
    } else {
      openStatModalFromSelection();
    }
  };

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

          <button
            type="button"
            onClick={() => { if (isStatsBookSelectionMode) { if (typeof cancelStatsSelection === 'function') cancelStatsSelection(); } else if (typeof enterStatsSelectionFromRecent === 'function') enterStatsSelectionFromRecent(); }}
            style={isStatsBookSelectionMode ? { ...styles.statsModeBtn, backgroundColor: 'rgba(34,211,238,0.15)', borderColor: '#22d3ee' } : styles.statsModeBtn}
            title="انتخاب کتاب‌ها از همین لیست برایِ ساختِ آماربندی"
          >
            <Icons.Check size={14} />
            <span>{isStatsBookSelectionMode ? 'خروج از حالتِ انتخاب' : 'ساخت آماربندی و انتخاب کتاب‌ها'}</span>
          </button>

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

      {isStatsBookSelectionMode && (
        <div style={styles.statsBar}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" onClick={handleSelectAllFiltered} style={styles.statsBarBtn}>انتخاب همه</button>
            <button type="button" onClick={handleClearSelection} style={styles.statsBarBtn}>لغو انتخاب همه</button>
            <button type="button" onClick={handleInvertSelection} style={styles.statsBarBtn}>معکوس کردن انتخاب</button>
            <button type="button" onClick={() => handleSelectType('pdf')} style={styles.statsBarBtn}>انتخاب همهٔ PDFها</button>
            <button type="button" onClick={() => handleSelectType('epub')} style={styles.statsBarBtn}>انتخاب همهٔ EPUBها</button>
            <button type="button" onClick={() => handleSelectType('comic')} style={styles.statsBarBtn}>انتخاب کمیک‌ها</button>
            <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 700 }}>{selectedCount} کتاب انتخاب شده</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <button type="button" onClick={handlePrimaryCreate} style={styles.statsPrimaryBtn}>
              {editingStatCategoryId ? `ثبتِ انتخاب برایِ آماربندی (${selectedCount})` : `ساخت آماربندی جدید با کتاب‌های انتخاب‌شده (${selectedCount})`}
            </button>
            <button type="button" onClick={() => { if (typeof cancelStatsSelection === 'function') cancelStatsSelection(); }} style={styles.statsBarBtn}>انصراف</button>
          </div>
        </div>
      )}

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
          {displayedRecents.map((item, idx) => {
            const gp = recentItemPath(item);
            const gSelected = isStatsBookSelectionMode && (statsSelectedBookPaths || []).includes(gp);
            return (
              <div key={item.path || item.filePath || `recent-grid-${idx}`} style={{ position: 'relative' }}>
                {isStatsBookSelectionMode && (
                  <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 5 }}>
                    <StatsCheckBox checked={gSelected} onToggle={() => toggleStatsSelectedBookPath(gp)} label={item.name || item.fileName || gp} />
                  </div>
                )}
                <ComicCard
                  item={item}
                  onOpenComic={(it) => { if (isStatsBookSelectionMode) toggleStatsSelectedBookPath(recentItemPath(it)); else if (onOpenComic) onOpenComic(it); }}
                  onRemove={(path) => removeFromRecent(path)}
                  showRemoveBtn={true}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div style={styles.list}>
          {displayedRecents.map((item, index) => {
            const lp = recentItemPath(item);
            return (
              <RecentListRow
                key={item.path || item.filePath || `recent-list-${index}`}
                item={item}
                onOpenComic={onOpenComic}
                onShowInFolder={handleShowInFolder}
                onRemoveItem={handleRemoveItem}
                selectionMode={isStatsBookSelectionMode}
                isSelected={(statsSelectedBookPaths || []).includes(lp)}
                onToggleSelect={(p) => toggleStatsSelectedBookPath(p)}
              />
            );
          })}
        </div>
      )}
      {statModal && (
        <div style={styles.statsModalOverlay} onClick={() => setStatModal(null)}>
          <div style={styles.statsModalCard} onClick={(e) => e.stopPropagation()}>
            <h4 style={{ margin: '0 0 12px', fontSize: 15 }}>{statModal.id ? 'ویرایشِ آماربندی' : 'ساختِ آماربندی جدید'}</h4>
            <input
              type="text"
              value={statModal.name}
              onChange={(e) => setStatModal({ ...statModal, name: e.target.value })}
              placeholder="نامِ آماربندی (مثلاً مطالعهٔ آناتومی)"
              style={styles.statsField}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>رنگ:</span>
              {STAT_VIEW_COLORS.map((c) => (
                <button key={c} type="button" onClick={() => setStatModal({ ...statModal, color: c })} title={c} style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: statModal.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 8px' }}>{statModal.bookKeys.length} کتاب در این آماربندی عضو می‌شوند.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              {STAT_VIEW_METRICS.map((m) => (
                <label key={m.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, cursor: 'pointer', padding: '5px 9px', borderRadius: 99, background: statModal.metrics.includes(m.id) ? 'rgba(34,211,238,0.15)' : 'rgba(255,255,255,0.05)' }}>
                  <input type="checkbox" checked={statModal.metrics.includes(m.id)} onChange={() => setStatModal({ ...statModal, metrics: statModal.metrics.includes(m.id) ? statModal.metrics.filter((x) => x !== m.id) : [...statModal.metrics, m.id] })} style={{ accentColor: '#22d3ee', cursor: 'pointer' }} />
                  {m.label}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                هدفِ ساعتی:
                <input type="number" min={0} value={statModal.goalHours} onChange={(e) => setStatModal({ ...statModal, goalHours: Number(e.target.value) || 0 })} style={{ ...styles.statsField, width: 90 }} />
              </label>
              <label style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                هدفِ صفحه‌ای:
                <input type="number" min={0} value={statModal.goalPages} onChange={(e) => setStatModal({ ...statModal, goalPages: Number(e.target.value) || 0 })} style={{ ...styles.statsField, width: 90 }} />
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={handleSaveStatModal} style={styles.statsPrimaryBtn}>ذخیرهٔ آماربندی</button>
              <button type="button" onClick={() => setStatModal(null)} style={styles.statsBarBtn}>انصراف</button>
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
  statsModeBtn: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 11,
    backgroundColor: 'var(--panel)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)',
    color: 'var(--text)', fontSize: 12, cursor: 'pointer', flexShrink: 0,
  },
  statsBar: {
    backgroundColor: 'var(--panel)', borderWidth: '1px', borderStyle: 'solid', borderColor: 'rgba(34,211,238,0.35)',
    borderRadius: 14, padding: '12px 14px',
  },
  statsBarBtn: {
    padding: '7px 12px', borderRadius: 10, backgroundColor: 'var(--panel2)', borderWidth: '1px', borderStyle: 'solid',
    borderColor: 'var(--border)', color: 'var(--text)', fontSize: 12, cursor: 'pointer',
  },
  statsPrimaryBtn: {
    padding: '9px 16px', borderRadius: 10, backgroundColor: '#22d3ee', border: 'none', color: '#0d131a',
    fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  statsModalOverlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16,
  },
  statsModalCard: {
    width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto', backgroundColor: 'var(--panel)',
    borderWidth: '1px', borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 16, padding: 18, color: 'var(--text)',
  },
  statsField: {
    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text)', padding: '7px 10px', fontFamily: 'inherit', fontSize: 13,
  },
};
