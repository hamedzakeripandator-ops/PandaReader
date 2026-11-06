import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';
import useLibraryStore from '../../store/useLibraryStore';
import useSettingsStore from '../../store/useSettingsStore';
import { coreApi } from '../../services/coreApi';
import thumbnailService, { resolveCoverUrl } from '../../services/thumbnailService';
import Icons from '../common/Icons';
import MarqueeText from '../common/MarqueeText';
import { flattenOutline, findActiveOutlineEntry, firstJumpablePage } from '../../utils/pdfOutline';
import useBookmarkStore, { resolveActiveBookKey, normalizeBookKey } from '../../store/useBookmarkStore';
import { BOOKMARK_TEMPLATE_MAP, computeViewportCenterYRatio, resolveBookmarkImage } from '../reader/bookmarkTemplates';

const EMPTY_BOOKMARKS = Object.freeze([]);

// مرحلهٔ ۴۱ §۵: نشانگرِ دایره‌ایِ آکاردئون‌ها — یک فلشِ برداریِ
// ChevronDown که با باز/بسته شدن می‌چرخد (بدونِ کاراکترِ متنی).
// نکته: ماژولِ Icons (SvgBase) مقدارِ strokeWidth را سخت‌کد «2»
// گذاشته و propی strokeWidth را جلو نمی‌برد؛ پس «2.4» نوشته
// می‌شود تا با اصلاحِ بعدیِ Icons اعمال شود، ولی فعلاً ضخامتِ
// دیداری همان 2 است. چرخش از راهِ style اعمال می‌شود.
const accordionCircleStyle = (isOpen) => ({
  width: '26px',
  height: '26px',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: isOpen ? 'rgba(34, 211, 238, 0.16)' : 'rgba(255, 255, 255, 0.06)',
  border: isOpen ? '1px solid rgba(34, 211, 238, 0.45)' : '1px solid rgba(255, 255, 255, 0.14)',
  color: isOpen ? '#22d3ee' : '#cbd5e1',
  transition: 'all 0.25s cubic-bezier(0.22, 1, 0.36, 1)',
  boxShadow: isOpen ? '0 0 10px rgba(34, 211, 238, 0.2)' : 'none',
  flexShrink: 0,
});
const accordionChevronStyle = (isOpen) => ({
  transform: isOpen ? 'rotate(0deg)' : 'rotate(90deg)',
  transition: 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)',
});

const PageListRow = React.memo(function PageListRow({
  pageNum,
  cleanFileName,
  fullTitle,
  isFirstOfChapter,
  chapterName,
  isCurrentChap,
  isActive,
  activePageRef,
  onJumpToPage,
  hasBookmark,
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <>
      {isFirstOfChapter && (
        <div
          onClick={() => onJumpToPage(pageNum)}
          style={{
            ...styles.chapterStickyDivider,
            borderColor: isCurrentChap ? 'var(--accent)' : 'var(--border)',
          }}
          title={`شروع فصل: ${chapterName}`}
        >
          <Icons.Bookmark size={13} />
          <span style={styles.chapterBannerText}>{chapterName}</span>
        </div>
      )}

      <div
        data-panel-page={pageNum}
        ref={isActive ? activePageRef : null}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={() => onJumpToPage(pageNum)}
        style={{
          ...styles.pageRow,
          backgroundColor: isActive
            ? 'rgba(34, 211, 238, 0.12)'
            : isHovered
            ? 'rgba(255, 255, 255, 0.03)'
            : 'transparent',
          borderColor: isActive
            ? 'rgba(34, 211, 238, 0.35)'
            : isHovered
            ? 'var(--border)'
            : 'transparent',
        }}
      >
        <div
          style={{
            ...styles.pageNumberBadge,
            backgroundColor: isActive ? 'var(--accent)' : 'var(--panel)',
            color: isActive ? '#0a0f13' : 'var(--text)',
            borderColor: isActive ? 'var(--accent)' : 'var(--border)',
            fontWeight: isActive ? 700 : 600,
          }}
        >
          {pageNum}
        </div>

        <span
          style={{
            ...styles.pageItemText,
            color: isActive ? 'var(--accent)' : 'var(--text)',
            fontWeight: isActive ? 600 : 400,
          }}
          title={fullTitle}
        >
          {cleanFileName}
        </span>

        {hasBookmark ? (
          <span
            title="این صفحه بوک‌مارک دارد"
            style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#c9a227', flexShrink: 0 }}
          />
        ) : null}
        {isActive && <div style={styles.activeIndicator} />}
      </div>
    </>
  );
});

export default function RightPanel({ onLoadComic, onOpenFolder, onMouseEnter, onMouseLeave }) {
  const isRightSidebarOpen = useAppStore((state) => state.isRightSidebarOpen);
  const showToast = useAppStore((state) => state.showToast);

  const comicData = useReaderStore((state) => state.comicData);
  const currentPage = useReaderStore((state) => state.currentPage);
  const jumpToPage = useReaderStore((state) => state.jumpToPage);
  const pdfOutline = useReaderStore((state) => state.pdfOutline);
  const pdfOutlineFile = useReaderStore((state) => state.pdfOutlineFile);
  const pdfOutlineStatus = useReaderStore((state) => state.pdfOutlineStatus);
  const epubChapters = useReaderStore((state) => state.epubChapters || []);
  // مرحلهٔ ۴۲: زومِ زنده، حالتِ نمایشِ زنده و شمارِ کلِ صفحه‌ها از
  // استورِ ریدر — کارت‌هایِ CBZ/EPUB مقدارِ فعلی را نشان می‌دهند،
  // نه پیش‌فرضِ تنظیمات.
  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const comicViewMode = useReaderStore((state) => state.comicViewMode || 'vertical');
  const epubViewMode = useReaderStore((state) => state.epubViewMode || 'vertical');
  const storeTotalPages = useReaderStore((state) => state.totalPages || 0);
  // مرحلهٔ ۴۱ §۳: نوشتنِ تنظیماتِ پیش‌فرضِ CBZ/EPUB در استورِ
  // تنظیمات — اگر اکشنی هنوز نباشد، صدا زدنِ آن با ?. بی‌اثر
  // می‌ماند (بدونِ کرش).
  const setCbzDefaultZoom = useSettingsStore((state) => state.setCbzDefaultZoom);
  const setCbzDefaultViewMode = useSettingsStore((state) => state.setCbzDefaultViewMode);
  const setEpubDefaultZoom = useSettingsStore((state) => state.setEpubDefaultZoom);
  const setEpubDefaultViewMode = useSettingsStore((state) => state.setEpubDefaultViewMode);
  const setComicViewMode = useReaderStore((state) => state.setComicViewMode);
  const setEpubViewMode = useReaderStore((state) => state.setEpubViewMode);
  const setZoomLevel = useReaderStore((state) => state.setZoomLevel);
  // مرحلهٔ ۴۱ §۳: قانونِ طلایی — نوعِ فایلِ بازشده.
  const isCbzFile = Boolean(comicData?.filePath && comicData.filePath.toLowerCase().endsWith('.cbz'));
  const isEpubFile = Boolean(comicData?.type === 'epub' || (comicData?.filePath && comicData.filePath.toLowerCase().endsWith('.epub')));
  // مرحلهٔ ۴۲: زومِ زندهٔ کارت‌ها (درصد) — همیشه در بازهٔ مجاز نگه داشته می‌شود.
  const liveCbzZoomPct = Math.max(50, Math.min(300, Math.round((Number(zoomLevel) || 1) * 100)));
  const liveEpubZoomPct = Math.max(50, Math.min(250, Math.round((Number(zoomLevel) || 1) * 100)));
  // پیش‌نویسِ ورودیِ عددیِ زوم تا تایپِ آزاد (مثلاً پاک کردنِ عدد
  // و تایپِ عددِ تازه) با مقدارِ کنترل‌شدهٔ استور تداخل نکند.
  const [cbzZoomDraft, setCbzZoomDraft] = useState(null);
  const [epubZoomDraft, setEpubZoomDraft] = useState(null);
  const setComicData = useReaderStore((state) => state.setComicData);

  // استیت‌های تنظیم فاصله صفحات (Page Offset / Gap)
  const comicPageGap = useReaderStore((state) => state.comicPageGap ?? 0);
  const pdfPageGap = useReaderStore((state) => state.pdfPageGap ?? 12);
  const setComicPageGap = useReaderStore((state) => state.setComicPageGap);
  const setPdfPageGap = useReaderStore((state) => state.setPdfPageGap);

  const filePath = resolveActiveBookKey(comicData, null);

  // مرحله ۱۳: بوک‌مارک‌هایِ دیجیتالِ فایلِ جاری.
  const bookmarkList = useBookmarkStore((state) => state.bookmarksByFile?.[normalizeBookKey(filePath)] || EMPTY_BOOKMARKS);
  const bookmarkPreferences = useBookmarkStore((state) => state.preferences || {});
  const savedPresets = useBookmarkStore((state) => state.preferences?.savedPresets || []);
  const addBookmark = useBookmarkStore((state) => state.addBookmark);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const loadBookmarksForFile = useBookmarkStore((state) => state.loadBookmarksForFile);
  const deleteBookmark = useBookmarkStore((state) => state.deleteBookmark);
  const updateBookmark = useBookmarkStore((state) => state.updateBookmark);

  // مرحله ۱۶، بخش ب: ویرایشِ درجایِ نام از پنلِ راست (مدادِ کنارِ هر
  // بوک‌مارک) — همان الگویِ مارکر: Enter/blur ثبت می‌کند، Escape
  // لغو می‌کند و پرچمِ skip از ثبتِ دوبارهٔ blur پس از Escape جلوگیری
  // می‌کند؛ نامِ خالی به '' می‌رسد تا نمایش به برچسبِ تمپلیت برگردد.
  const panelSkipBlurRef = useRef(false);
  const [editingBookmarkId, setEditingBookmarkId] = useState(null);
  const [editingBookmarkName, setEditingBookmarkName] = useState('');
  // مرحلهٔ ۳۰ — آکاردئونِ بوک‌مارک‌ها + تاگلِ مستقلِ تمپلیت‌ها
  // (وضعیت در localStorage می‌ماند؛ پیش‌فرض، باز).
  const [isBookmarksSectionOpen, setIsBookmarksSectionOpen] = useState(() => {
    try { return localStorage.getItem('comicReader.rightPanelBookmarksOpen') !== '0'; } catch (_) { return true; }
  });
  const [isBookmarkTemplatesOpen, setIsBookmarkTemplatesOpen] = useState(() => {
    try { return localStorage.getItem('comicReader.rightPanelBookmarkTemplatesOpen') !== '0'; } catch (_) { return true; }
  });
  const toggleBookmarksSection = useCallback(() => {
    setIsBookmarksSectionOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem('comicReader.rightPanelBookmarksOpen', next ? '1' : '0'); } catch (_) {}
      return next;
    });
  }, []);
  const toggleBookmarkTemplates = useCallback(() => {
    setIsBookmarkTemplatesOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem('comicReader.rightPanelBookmarkTemplatesOpen', next ? '1' : '0'); } catch (_) {}
      return next;
    });
  }, []);
  const commitPanelRename = useCallback(async (fp, id) => {
    if (editingBookmarkId !== id) return;
    const finalName = (editingBookmarkName || '').trim().slice(0, 30);
    setEditingBookmarkId(null);
    await updateBookmark(fp, id, { name: finalName });
  }, [editingBookmarkId, editingBookmarkName, updateBookmark]);
  const openBookmarkStudio = useBookmarkStore((state) => state.openStudio);
  const requestBookmarkJump = useBookmarkStore((state) => state.requestJump);

  const sortedBookmarks = useMemo(() => {
    return [...(bookmarkList || [])].sort((a, b) => (a.page - b.page) || (a.yRatio - b.yRatio));
  }, [bookmarkList]);

  const bookmarkedPages = useMemo(() => {
    const set = new Set();
    (bookmarkList || []).forEach((bm) => set.add(bm.page));
    return set;
  }, [bookmarkList]);

  useEffect(() => {
    if (filePath) loadBookmarksForFile(filePath);
  }, [filePath, loadBookmarksForFile]);

  // مرحله ۱۵ — جریانِ سایدبار-اول در پنلِ راست: کلیک رویِ کارتِ
  // پریست، همان بوک‌مارک را در صفحهٔ جاری و نقطهٔ مرکزِ دید، رویِ
  // حاشیهٔ ۱۳ پیکسلیِ کاغذ می‌نشاند.
  const handleAddPresetBookmark = async (preset) => {
    if (!preset || !filePath) return;
    const created = await addBookmark({
      filePath,
      page: currentPage,
      yRatio: computeViewportCenterYRatio(currentPage),
      template: preset.template,
      image: preset.image || null,
      focalPoint: preset.focalPoint || 'center',
      side: preset.side || bookmarkPreferences.defaultSide || 'right',
      name: preset.name || '',
    });
    if (created) showToast('بوک‌مارک ساخته شد.', { type: 'success' });
  };
  const goToBookmarkBuilder = () => setCurrentView('bookmarks');
  const isPdfMode = comicData?.type === 'pdf';
  const activeGapValue = isPdfMode ? pdfPageGap : comicPageGap;

  const normPath = useMemo(() => {
    return filePath ? filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase() : '';
  }, [filePath]);

  const isInLibrary = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return false;
        return (state.library || []).some(
          (item) =>
            (item.path || item.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
            normPath
        );
      },
      [normPath]
    )
  );

  const isPinnedInLib = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return false;
        return (state.library || []).some(
          (item) =>
            (item.path || item.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
              normPath && Boolean(item.isPinned)
        );
      },
      [normPath]
    )
  );

  const isFav = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return false;
        return (state.favorites || []).some(
          (f) =>
            (f.path || f.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
            normPath
        );
      },
      [normPath]
    )
  );

  const customCoverFromStore = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return null;
        return state.cachedCovers?.[normPath] || null;
      },
      [normPath]
    )
  );

  const addToLibrary = useLibraryStore((state) => state.addToLibrary);
  const removeFromLibrary = useLibraryStore((state) => state.removeFromLibrary);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const togglePin = useLibraryStore((state) => state.togglePin);
  const selectAndSetCustomCover = useLibraryStore((state) => state.selectAndSetCustomCover);

  const [showSortMenu, setShowSortMenu] = useState(false);
  const [showChapterMenu, setShowChapterMenu] = useState(false);
  const [isHeartPulsing, setIsHeartPulsing] = useState(false);
  // مرحلهٔ ۴۰ §۵: جمع/باز شدنِ فهرستِ «فایل‌هایِ این پوشه».
  const [folderListCollapsed, setFolderListCollapsed] = useState(false);
  const [coverUrl, setCoverUrl] = useState(null);
  const [coverHover, setCoverHover] = useState(false);

  const activePageRef = useRef(null);
  const sortMenuRef = useRef(null);
  const chapterMenuRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const currentSort = comicData?.dirInfo?.sortBy || 'name_asc';
  const totalPages = isEpubFile ? (storeTotalPages || epubChapters.length) : (comicData?.items?.length || comicData?.savedTotalPages || 0);
  const nextComic = comicData?.nextComic;
  const prevComic = comicData?.prevComic;
  const dirInfo = comicData?.dirInfo;

  // پیش‌پردازش یک‌باره لیست صفحات و فصول
  const { processedPages, chapterGroups } = useMemo(() => {
    if (!comicData?.items || comicData.items.length === 0) {
      return { processedPages: [], chapterGroups: [] };
    }

    const groups = [];
    const pages = new Array(comicData.items.length);
    let currentChapterTitle = null;

    for (let index = 0; index < comicData.items.length; index++) {
      const item = comicData.items[index];
      const chapterName =
        item.chapter ||
        (item.name && item.name.includes(' / ') ? item.name.split(' / ')[0] : null);

      const isFirstOfChapter = Boolean(chapterName && chapterName !== currentChapterTitle);
      if (isFirstOfChapter) {
        currentChapterTitle = chapterName;
        groups.push({
          title: chapterName,
          startIndex: index,
          startPage: index + 1,
        });
      }

      const cleanFileName =
        item.fileName ||
        (item.name && item.name.includes(' / ')
          ? item.name.split(' / ').slice(1).join(' / ')
          : item.name);

      pages[index] = {
        key: item.path || `page-item-${index}`,
        pageNum: index + 1,
        cleanFileName,
        fullTitle: item.name,
        chapterName,
        isFirstOfChapter,
      };
    }

    return { processedPages: pages, chapterGroups: groups };
  }, [comicData?.items]);

  const activeChapterTitle = useMemo(() => {
    if (chapterGroups.length === 0) return null;
    let activeTitle = chapterGroups[0].title;
    for (let i = 0; i < chapterGroups.length; i++) {
      if (currentPage >= chapterGroups[i].startPage) {
        activeTitle = chapterGroups[i].title;
      } else {
        break;
      }
    }
    return activeTitle;
  }, [chapterGroups, currentPage]);

  // مرحله ۶ ـ بخش الف: فهرستِ PDF (Outline) — فقط وقتی فهرست،
  // متعلق به همین فایلِ جاری است. برای فایل‌های کمیک، فصل‌ها از
  // قبل از روی نامِ فایل‌ها/پوشه‌ها در همین پنل بودند و دست نخورده‌اند.
  const outlineForCurrentFile = isPdfMode && pdfOutlineFile === filePath && Array.isArray(pdfOutline) ? pdfOutline : [];
  const flatOutline = useMemo(
    () => flattenOutline(outlineForCurrentFile),
    [outlineForCurrentFile]
  );
  const activeOutlineEntry = useMemo(
    () => findActiveOutlineEntry(flatOutline, currentPage),
    [flatOutline, currentPage]
  );

  // مرحله ۶ ـ بخش ب: نگه‌داشتنِ سرفصلِ فعال در معرضِ دید — با هر
  // تغییرِ صفحهٔ جاری، ردیفِ فعال با block:'nearest' به داخلِ
  // ناحیهٔ قابل‌مشاهدهٔ لیست اسکرول می‌شود (اگر از قبل دیده شود،
  // هیچ اسکرولی رخ نمی‌دهد و اسکرولِ دستیِ کاربر دزدیده نمی‌شود).
  // بخشِ فهرست، حالتِ بسته‌شونده ندارد (همیشه باز است)، پس همین
  // یک مکانیزم برای «در معرضِ دید نگه داشتن» کافی است.
  const outlineRowRefs = useRef(new Map());
  const activeOutlineIndex = activeOutlineEntry ? flatOutline.indexOf(activeOutlineEntry) : -1;
  useEffect(() => {
    if (activeOutlineIndex < 0) return;
    const rowEl = outlineRowRefs.current.get(activeOutlineIndex);
    if (rowEl && typeof rowEl.scrollIntoView === 'function') {
      try { rowEl.scrollIntoView({ block: 'nearest', behavior: 'auto' }); } catch (_) {}
    }
  }, [activeOutlineIndex]);

  // مرحلهٔ ۴۱ §۲: فصلِ فعالِ EPUB — در EpubViewer، currentPage
  // برابرِ شمارهٔ فصل است (chapterIndex + 1)؛ پس فصلِ فعال از
  // currentPage به‌دست می‌آید. کارتِ فصلِ فعال، خودکار وسط‌چین
  // می‌شود؛ اگر از قبل کامل دیده شود، اسکرولی رخ نمی‌دهد تا
  // اسکرولِ دستیِ کاربر دزدیده نشود.
  const activeEpubChapterIndex = useMemo(() => {
    if (!epubChapters || epubChapters.length === 0) return -1;
    return Math.min(Math.max((currentPage || 1) - 1, 0), epubChapters.length - 1);
  }, [epubChapters, currentPage]);
  const epubChapterListRef = useRef(null);
  const epubChapterRefs = useRef(new Map());
  useEffect(() => {
    if (activeEpubChapterIndex < 0) return;
    const rowEl = epubChapterRefs.current.get(activeEpubChapterIndex);
    const listEl = epubChapterListRef.current;
    if (!rowEl || !listEl || typeof rowEl.scrollIntoView !== 'function') return;
    try {
      const listRect = listEl.getBoundingClientRect();
      const rowRect = rowEl.getBoundingClientRect();
      if (rowRect.top < listRect.top || rowRect.bottom > listRect.bottom) {
        rowEl.scrollIntoView({ block: 'center', behavior: 'auto' });
      }
    } catch (_) {}
  }, [activeEpubChapterIndex]);
  // مرحلهٔ ۴۲: پرش به فصلِ EPUB — اول currentPage با jumpToPage
  // همگام می‌شود، بعد رویدادِ سراسری برایِ EpubViewer فرستاده می‌شود.
  const jumpToEpubChapter = useCallback((idx) => {
    if (!epubChapters || idx < 0 || idx >= epubChapters.length) return;
    jumpToPage(idx + 1);
    window.dispatchEvent(new CustomEvent('app:epub-jump', { detail: { chapterIndex: idx } }));
  }, [epubChapters, jumpToPage]);

  // مرحلهٔ ۴۲: پرش از فهرستِ صفحه‌هایِ پنل — در EPUB، رویدادِ
  // سراسریِ فصل هم فرستاده می‌شود تا EpubViewer همگام بماند.
  const handlePanelPageJump = useCallback((page) => {
    jumpToPage(page);
    if (isEpubFile) window.dispatchEvent(new CustomEvent('app:epub-jump', { detail: { chapterIndex: (Number(page) || 1) - 1 } }));
  }, [jumpToPage, isEpubFile]);

  // دریافت و همگام‌سازی تصویر کاور
  useEffect(() => {
    let isMounted = true;
    if (!filePath) {
      setCoverUrl(null);
      return;
    }

    const resolvedStoreCover = resolveCoverUrl(customCoverFromStore);
    if (resolvedStoreCover) {
      setCoverUrl(resolvedStoreCover);
      return;
    }

    const initialCover =
      resolveCoverUrl(comicData?.cover) || thumbnailService.peekCover(filePath);
    if (initialCover) {
      setCoverUrl(initialCover);
      return;
    }

    thumbnailService.getThumbnail(filePath).then((thumb) => {
      if (isMounted && thumb) {
        setCoverUrl(thumb);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [filePath, comicData?.cover, customCoverFromStore]);

  // مرحلهٔ ۳۰/۳۱ — صفحهٔ فعلی، همیشه در وسطِ عمودیِ کادرِ
  // لیستِ صفحات قرار می‌گیرد (فرمولِ پرامپت). مرحلهٔ ۳۱: با
  // Debounceِ ۲۵۰ میلی‌ثانیه پس از توقفِ تغییرِ currentPage،
  // تا در حینِ اسکرولِ سریعِ PDF، انیمیشن‌هایِ smoothِ
  // پی‌درپی، کامپوزیتورِ مرورگر را لگ‌دار نکنند. activeTab در
  // این فایل وجود ندارد؛ وابستگی‌ها، currentPage و باز بودنِ
  // پنل و شمارِ صفحه‌هایِ پردازش‌شده‌اند تا پس از ساخته شدنِ
  // لیست هم اجرا شود.
  useEffect(() => {
    if (!isRightSidebarOpen) return undefined;
    const timerId = setTimeout(() => {
      const listEl = scrollContainerRef.current;
      if (!listEl) return;
      const activeItemEl = listEl.querySelector(`[data-panel-page="${currentPage}"]`) || activePageRef.current;
      if (listEl && activeItemEl) {
        const listRect = listEl.getBoundingClientRect();
        const itemRect = activeItemEl.getBoundingClientRect();
        const itemCenterInScroll = listEl.scrollTop + (itemRect.top - listRect.top) + itemRect.height * 0.5;
        const targetScrollTop = Math.max(0, itemCenterInScroll - listEl.clientHeight * 0.5);
        listEl.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
      }
    }, 250);
    return () => clearTimeout(timerId);
  }, [currentPage, isRightSidebarOpen, processedPages.length]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target)) {
        setShowSortMenu(false);
      }
      if (chapterMenuRef.current && !chapterMenuRef.current.contains(e.target)) {
        setShowChapterMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, { passive: true });
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const sortOptions = [
    { id: 'name_asc', label: 'نام (الف تا ی)' },
    { id: 'name_desc', label: 'نام (ی تا الف)' },
    { id: 'date_desc', label: 'جدیدترین‌ها (دانلود)' },
    { id: 'date_asc', label: 'قدیمی‌ترین‌ها' },
    { id: 'size_desc', label: 'حجیم‌ترین فایل‌ها' },
    { id: 'size_asc', label: 'کم‌حجم‌ترین‌ها' },
  ];

  const handleSortChange = async (sortId) => {
    setShowSortMenu(false);
    if (!comicData?.filePath) return;

    try {
      const updatedDir = await coreApi.sortDirectory(comicData.filePath, sortId);
      if (updatedDir) {
        setComicData({
          ...comicData,
          dirInfo: {
            name: updatedDir.dirName,
            current: updatedDir.currentIndex,
            total: updatedDir.totalInDir,
            sortBy: updatedDir.sortBy,
          },
          nextComic: updatedDir.nextComic,
          prevComic: updatedDir.prevComic,
        });
        showToast('ترتیب فایل‌های پوشه بروزرسانی شد', { type: 'info' });
      }
    } catch (err) {
      console.error('Sort Error in RightPanel:', err);
    }
  };

  const handleToggleFavorite = (e) => {
    e.stopPropagation();
    if (!filePath) return;

    setIsHeartPulsing(true);
    setTimeout(() => setIsHeartPulsing(false), 300);

    const livePage = useReaderStore.getState().currentPage || 1;
    const payload = {
      path: filePath,
      name: comicData.fileName || comicData.name || filePath.split(/[\\/]/).pop(),
      cover: coverUrl || comicData.cover || null,
      totalPages: totalPages || 1,
      lastPage: livePage,
      fileSize: comicData.fileSize || '',
    };

    const added = toggleFavorite(payload);
    showToast(
      added ? 'به لیست علاقه‌مندی‌ها اضافه شد' : 'از لیست علاقه‌مندی‌ها حذف شد',
      { type: added ? 'success' : 'info' }
    );
  };

  const handleToggleLibrary = (e) => {
    e.stopPropagation();
    if (!filePath) return;

    if (isInLibrary) {
      removeFromLibrary(filePath);
      showToast('از کتابخانه حذف شد', { type: 'info' });
    } else {
      const livePage = useReaderStore.getState().currentPage || 1;
      addToLibrary({
        name: comicData.fileName || filePath.split(/[\\/]/).pop(),
        path: filePath,
        cover: coverUrl || comicData.cover || null,
        fileSize: comicData.fileSize || '',
        totalPages: totalPages || 1,
        lastPage: livePage,
      });
      showToast('به کتابخانه شما اضافه شد', { type: 'success' });
    }
  };

  const handleTogglePinClick = async (e) => {
    e.stopPropagation();
    if (!filePath) return;
    const livePage = useReaderStore.getState().currentPage || 1;
    const pinned = await togglePin({
      path: filePath,
      name: comicData.fileName || filePath.split(/[\\/]/).pop(),
      cover: coverUrl || comicData.cover || null,
      fileSize: comicData.fileSize || '',
      totalPages: totalPages || 1,
      lastPage: livePage,
    });
    showToast(
      pinned ? 'در صدر کتابخانه پین شد' : 'از حالت پین خارج شد',
      { type: pinned ? 'success' : 'info' }
    );
  };

  const handleChangeCustomCover = async (e) => {
    e.stopPropagation();
    if (!filePath || !selectAndSetCustomCover) return;
    const res = await selectAndSetCustomCover(filePath);
    if (res?.success && res?.cover) {
      setCoverUrl(res.cover);
      thumbnailService.seedCover?.(filePath, res.cover);
      showToast('تصویر کاور سفارشی با موفقیت تنظیم شد', { type: 'success' });
    }
  };

  const handleGapChange = (nextVal) => {
    const num = Math.max(0, Math.min(48, Number(nextVal) || 0));
    if (isPdfMode) {
      setPdfPageGap?.(num);
    } else {
      setComicPageGap?.(num);
    }
  };

  // مرحلهٔ ۴۱ §۳: تغییرِ «زومِ نرمال» و حالتِ نمایش — هم تنظیمِ
  // پیش‌فرض در استورِ تنظیمات ذخیره می‌شود و هم فوراً با اکشنِ
  // ریدر استور رویِ نمایِ فعلی اعمال می‌شود (زوم از راهِ
  // setZoomLevel که VerticalViewer و EpubViewer هر دو می‌خوانند؛
  // حالتِ CBZ از راهِ setComicViewMode و حالتِ EPUB از راهِ
  // setEpubViewMode که اگر هنوز در استور نباشد، با ?. رد می‌شود).
  const applyCbzZoom = useCallback((pct) => {
    const num = Math.max(50, Math.min(300, Math.round(Number(pct) || 165)));
    setCbzDefaultZoom?.(num);
    setZoomLevel?.(num / 100, { force: true });
  }, [setCbzDefaultZoom, setZoomLevel]);
  const applyCbzViewMode = useCallback((mode) => {
    const next = mode === 'vertical' ? 'vertical' : 'horizontal-paged';
    setCbzDefaultViewMode?.(next);
    setComicViewMode?.(next);
  }, [setCbzDefaultViewMode, setComicViewMode]);
  const applyEpubZoom = useCallback((pct) => {
    const num = Math.max(50, Math.min(250, Math.round(Number(pct) || 100)));
    setEpubDefaultZoom?.(num);
    setZoomLevel?.(num / 100, { force: true });
  }, [setEpubDefaultZoom, setZoomLevel]);
  const applyEpubViewMode = useCallback((mode) => {
    const next = mode === 'horizontal-paged' ? 'horizontal-paged' : 'vertical';
    setEpubDefaultViewMode?.(next);
    setEpubViewMode?.(next);
  }, [setEpubDefaultViewMode, setEpubViewMode]);
  // ثبتِ پیش‌نویسِ ورودیِ عددیِ زوم با Enter/blur (عددِ بیرونِ
  // بازه، به نزدیک‌ترین سرِ بازه چسبانده می‌شود).
  const commitCbzZoomDraft = useCallback(() => {
    if (cbzZoomDraft === null) return;
    const num = Math.round(Number(cbzZoomDraft));
    setCbzZoomDraft(null);
    if (Number.isFinite(num)) applyCbzZoom(num);
  }, [cbzZoomDraft, applyCbzZoom]);
  const commitEpubZoomDraft = useCallback(() => {
    if (epubZoomDraft === null) return;
    const num = Math.round(Number(epubZoomDraft));
    setEpubZoomDraft(null);
    if (Number.isFinite(num)) applyEpubZoom(num);
  }, [epubZoomDraft, applyEpubZoom]);

  const currentComicName =
    comicData?.fileName || (filePath ? filePath.split(/[\\/]/).pop() : 'فایلی باز نشده است');

  const gapPresets = isPdfMode ? [0, 8, 12, 20, 32] : [0, 4, 10, 18, 28];

  return (
    <aside
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={(e) => e.stopPropagation()}
      style={{
        ...styles.container,
        opacity: isRightSidebarOpen ? 1 : 0,
        pointerEvents: isRightSidebarOpen ? 'auto' : 'none',
        transform: isRightSidebarOpen
          ? 'translate3d(0, 0, 0)'
          : 'translate3d(104%, 0, 0)',
        boxShadow: isRightSidebarOpen ? '-12px 0 34px rgba(0, 0, 0, 0.72)' : 'none',
      }}
    >
      {/* پل ایمن هاور در لبه چپ پنل راست برای جلوگیری از بسته شدن ناگهانی */}
      {isRightSidebarOpen && <div style={styles.hoverSafetyBridge} />}

      {/* کانتینر اسکرول‌پذیر سراسری پنل راست */}
      <div style={styles.scrollableBody}>
        {/* ===================================================================
            ۱. کارت بالا: کاور (با قابلیت تغییر کاور) + عنوان + اکشن‌های کتابخانه و پین
        =================================================================== */}
        <div style={styles.topCard}>
          <div style={styles.infoRow}>
            <div
              style={styles.coverThumbBox}
              onMouseEnter={() => setCoverHover(true)}
              onMouseLeave={() => setCoverHover(false)}
              onClick={handleChangeCustomCover}
              title="کلیک برای تغییر تصویر کاور"
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt="Cover"
                  style={styles.coverImg}
                  onError={() => setCoverUrl(null)}
                />
              ) : (
                <span style={{ color: 'var(--accent)', display: 'flex' }}>
                  {isPdfMode ? <Icons.FileText size={24} /> : <Icons.BookOpen size={24} />}
                </span>
              )}

              {coverHover && (
                <div style={styles.coverEditOverlay}>
                  {Icons.Camera ? <Icons.Camera size={16} /> : <Icons.Plus size={16} />}
                  <span style={styles.coverEditText}>کاور</span>
                </div>
              )}
            </div>

            <div style={styles.metaInfoBox}>
              <MarqueeText
                text={currentComicName}
                title={currentComicName}
                direction="ltr"
                style={styles.fileNameMarquee}
              />

              <div style={styles.badgeRow}>
                <span style={styles.sizePill}>{comicData?.fileSize || '0 MB'}</span>
                <span style={styles.pagePill}>
                  {isPdfMode ? `PDF (${totalPages} ص)` : `${totalPages} صفحه`}
                </span>
                {chapterGroups.length > 0 && (
                  <span style={styles.chapterPill}>{chapterGroups.length} چپتر</span>
                )}
              </div>
            </div>
          </div>

          <div style={styles.quickActionsBar}>
            <button
              type="button"
              onClick={handleToggleLibrary}
              style={{
                ...styles.libActionBtn,
                backgroundColor: isInLibrary
                  ? 'rgba(16, 185, 129, 0.14)'
                  : 'rgba(34, 211, 238, 0.08)',
                borderColor: isInLibrary ? '#10b981' : 'var(--accent)',
                color: isInLibrary ? '#10b981' : 'var(--accent)',
              }}
              title={isInLibrary ? 'حذف از کتابخانه' : 'افزودن به کتابخانه'}
            >
              <span style={styles.btnIconBox}>
                {isInLibrary ? <Icons.Check size={15} /> : <Icons.Plus size={15} />}
              </span>
              <span>{isInLibrary ? 'در کتابخانه' : 'افزودن به کتابخانه'}</span>
            </button>

            <button
              type="button"
              onClick={handleTogglePinClick}
              style={{
                ...styles.favActionBtn,
                backgroundColor: isPinnedInLib ? 'rgba(34, 211, 238, 0.16)' : 'var(--panel)',
                borderColor: isPinnedInLib ? 'var(--accent)' : 'var(--border)',
                color: isPinnedInLib ? 'var(--accent)' : 'var(--muted)',
              }}
              title={isPinnedInLib ? 'برداشتن پین از صدر کتابخانه' : 'پین کردن در صدر کتابخانه'}
            >
              <Icons.Bookmark size={16} filled={isPinnedInLib} />
            </button>

            <button
              type="button"
              onClick={handleToggleFavorite}
              style={{
                ...styles.favActionBtn,
                backgroundColor: isFav ? 'rgba(248, 81, 73, 0.16)' : 'var(--panel)',
                borderColor: isFav ? 'var(--danger)' : 'var(--border)',
                color: isFav ? 'var(--danger)' : 'var(--muted)',
                transform: isHeartPulsing ? 'scale(1.18)' : 'scale(1)',
              }}
              title={isFav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
            >
              <Icons.Heart size={17} filled={isFav} />
            </button>
          </div>
        </div>

        {/* مرحله ۱۳: بوک‌مارک‌هایِ دیجیتالِ کتابِ جاری — کلیک رویِ هر
            بوک‌مارک، به همان صفحه و همان مختصاتِ عمودی می‌پرد. */}
        {filePath ? (
          <div style={styles.bookmarkPanel}>
            <div style={styles.panelTitleRow}>
              <button
                type="button"
                onClick={toggleBookmarksSection}
                aria-expanded={isBookmarksSectionOpen}
                style={styles.bookmarkSectionToggle}
                title={isBookmarksSectionOpen ? 'بستنِ بخشِ بوک‌مارک‌ها' : 'باز کردنِ بخشِ بوک‌مارک‌ها'}
              >
                <span style={{ color: 'var(--accent)', display: 'flex' }}>
                  <Icons.Bookmark size={15} />
                </span>
                <span style={styles.panelHeaderTitle}>بوک‌مارک‌ها ({sortedBookmarks.length.toLocaleString('fa-IR')})</span>
                <span style={accordionCircleStyle(isBookmarksSectionOpen)}>
                  <Icons.ChevronDown size={15} strokeWidth="2.4" style={accordionChevronStyle(isBookmarksSectionOpen)} />
                </span>
              </button>
              <button
                type="button"
                onClick={() => openBookmarkStudio({ filePath, page: currentPage, yRatio: computeViewportCenterYRatio(currentPage) })}
                style={styles.bookmarkAddBtn}
                title="افزودن بوک‌مارک در صفحهٔ جاری"
              >
                <Icons.Plus size={14} />
                <span>افزودن</span>
              </button>
            </div>
            {isBookmarksSectionOpen && (
            <div style={styles.bookmarkSectionBody}>
            {sortedBookmarks.length === 0 ? (
              <div style={styles.emptyNotice}>هنوز بوک‌مارکی برای این کتاب نساخته‌اید.</div>
            ) : (
              <div style={styles.bookmarkList}>
                {sortedBookmarks.map((bm) => {
                  const imageUrl = resolveBookmarkImage(bm, bookmarkPreferences);
                  const label = bm.name || BOOKMARK_TEMPLATE_MAP[bm.template]?.faLabel || bm.template;
                  return (
                    <div
                      key={bm.id}
                      onClick={() => requestBookmarkJump(filePath, bm.page, bm.yRatio)}
                      style={styles.bookmarkRow}
                      title={`پرش به صفحه ${bm.page} • ${Math.round(bm.yRatio * 100)}٪`}
                    >
                      {imageUrl ? (
                        <img src={imageUrl} alt="" draggable={false} style={styles.bookmarkThumb} />
                      ) : (
                        <div style={{ ...styles.bookmarkThumb, background: 'repeating-linear-gradient(45deg,#e5e7eb 0 6px,#f3f4f6 6px 12px)' }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {editingBookmarkId === bm.id ? (
                          <input
                            type="text"
                            value={editingBookmarkName}
                            maxLength={30}
                            dir="auto"
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            onChange={(e) => setEditingBookmarkName(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') commitPanelRename(filePath, bm.id);
                              else if (e.key === 'Escape') { panelSkipBlurRef.current = true; setEditingBookmarkId(null); }
                            }}
                            onKeyUp={(e) => e.stopPropagation()}
                            onBlur={() => {
                              if (panelSkipBlurRef.current) { panelSkipBlurRef.current = false; return; }
                              commitPanelRename(filePath, bm.id);
                            }}
                            style={styles.bookmarkNameInput}
                          />
                        ) : (
                          <div style={styles.bookmarkName}>{label}</div>
                        )}
                        <div style={styles.bookmarkMeta}>صفحه {bm.page.toLocaleString('fa-IR')} • {Math.round(bm.yRatio * 100).toLocaleString('fa-IR')}٪ • {bm.side === 'left' ? 'حاشیهٔ چپ' : 'حاشیهٔ راست'}</div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setEditingBookmarkId(bm.id); setEditingBookmarkName(bm.name || ''); }}
                        style={styles.bookmarkEditBtn}
                        title="ویرایش نام بوک‌مارک"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteBookmark(filePath, bm.id); }}
                        style={styles.bookmarkDelBtn}
                        title="حذف بوک‌مارک"
                      >
                        <Icons.X size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {/* مرحله ۱۵ — تمپلیت‌هایِ من (ساخته‌شده در صفحهٔ
                بوک‌مارک‌هایِ سایدبار): خالی = کارتِ هدایتگر،
                غیرخالی = لیستِ کارتی + دکمهٔ ساختِ تازه. */}
            <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
              <div style={{ ...styles.panelTitleRow, marginBottom: '8px' }}>
              <button
                type="button"
                onClick={toggleBookmarkTemplates}
                aria-expanded={isBookmarkTemplatesOpen}
                style={styles.bookmarkSectionToggle}
                title={isBookmarkTemplatesOpen ? 'بستنِ تمپلیت‌هایِ من' : 'باز کردنِ تمپلیت‌هایِ من'}
              >
                  <span style={{ color: 'var(--accent)', display: 'flex' }}>
                    <Icons.Bookmark size={14} />
                  </span>
                  <span style={styles.panelHeaderTitle}>تمپلیت‌هایِ من</span>
                <span style={accordionCircleStyle(isBookmarkTemplatesOpen)}>
                  <Icons.ChevronDown size={15} strokeWidth="2.4" style={accordionChevronStyle(isBookmarkTemplatesOpen)} />
                </span>
              </button>
              </div>
              <div style={{ display: isBookmarkTemplatesOpen ? undefined : 'none' }}>
              {savedPresets.length === 0 ? (
                <button
                  type="button"
                  onClick={goToBookmarkBuilder}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px dashed var(--border)',
                    backgroundColor: 'var(--panel2)',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-fa)',
                    fontSize: '12.5px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textAlign: 'right',
                    lineHeight: 1.8,
                  }}
                >
                  <Icons.Bookmark size={15} />
                  <span>هنوز تمپلیت بوک‌مارکی نساخته‌اید — رفتن به بخش ساخت بوک‌مارک</span>
                </button>
              ) : (
                <>
                  <div style={styles.bookmarkList}>
                    {savedPresets.map((preset) => {
                      const imageUrl = resolveBookmarkImage(preset, bookmarkPreferences);
                      const animationLabel = BOOKMARK_TEMPLATE_MAP[preset.template]?.faLabel || preset.template;
                      return (
                        <div
                          key={preset.id}
                          onClick={() => handleAddPresetBookmark(preset)}
                          style={styles.bookmarkRow}
                          title="نشاندنِ این بوک‌مارک در صفحهٔ جاری"
                        >
                          {imageUrl ? (
                            <img src={imageUrl} alt="" draggable={false} style={styles.bookmarkThumb} />
                          ) : (
                            <div style={{ ...styles.bookmarkThumb, background: 'repeating-linear-gradient(45deg,#e5e7eb 0 6px,#f3f4f6 6px 12px)' }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={styles.bookmarkName}>{preset.name || `ساختِ ${animationLabel}`}</div>
                            <div style={styles.bookmarkMeta}>انیمیشنِ {animationLabel} • {preset.side === 'left' ? 'حاشیهٔ چپ' : 'حاشیهٔ راست'}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={goToBookmarkBuilder}
                    style={{ ...styles.bookmarkAddBtn, marginTop: '10px', width: '100%', justifyContent: 'center' }}
                  >
                    <Icons.Plus size={14} />
                    <span>+ ساخت تمپلیت جدید در بخش بوک‌مارک‌ها</span>
                  </button>
                </>
              )}
              </div>
            </div>
            </div>
            )}
          </div>
        ) : null}

        {/* ===================================================================
            مرحله ۶ ـ بخش الف: فهرستِ کتاب (PDF Outline) — فقط برای PDFها
            و فقط وقتی سند، فهرستِ داخلی دارد. استخراج، غیرمسدودکننده
            در PdfViewer انجام می‌شود؛ کلیک روی هر سرفصل، به صفحه‌اش
            می‌پرد. برای کمیک‌ها، فصل‌ها از قبل در کارتِ زیر بودند.
        =================================================================== */}
        {isPdfMode && pdfOutlineStatus === 'loading' && (
          <div style={styles.outlinePanel}>
            <div style={styles.panelTitleRow}>
              <div style={styles.titleWithIcon}>
                <span style={{ color: 'var(--accent)', display: 'flex' }}>
                  <Icons.Layers size={15} />
                </span>
                <span style={styles.panelHeaderTitle}>فهرست کتاب</span>
              </div>
            </div>
            <div style={styles.outlineEmptyText}>در حال استخراجِ فهرست…</div>
          </div>
        )}
        {isPdfMode && pdfOutlineStatus === 'done' && flatOutline.length > 0 && (
          <div style={styles.outlinePanel}>
            <div style={styles.panelTitleRow}>
              <div style={styles.titleWithIcon}>
                <span style={{ color: 'var(--accent)', display: 'flex' }}>
                  <Icons.Layers size={15} />
                </span>
                <span style={styles.panelHeaderTitle}>فهرست کتاب</span>
              </div>
              <span style={styles.pageCountTag}>{flatOutline.length} سرفصل</span>
            </div>
            <div style={styles.outlineScrollList}>
              {flatOutline.map((entry, idx) => {
                const jumpPage = firstJumpablePage(entry);
                const isActive = entry === activeOutlineEntry;
                return (
                  <div
                    key={`${idx}-${entry.title}`}
                    ref={(el) => {
                      if (el) outlineRowRefs.current.set(idx, el);
                      else outlineRowRefs.current.delete(idx);
                    }}
                    onClick={() => {
                      if (jumpPage) jumpToPage(jumpPage);
                    }}
                    title={jumpPage ? `پرش به صفحه ${jumpPage}` : entry.title}
                    style={{
                      ...styles.outlineRow,
                      paddingRight: `${10 + entry.depth * 14}px`,
                      borderColor: isActive ? 'var(--accent)' : 'transparent',
                      backgroundColor: isActive ? 'rgba(34, 211, 238, 0.12)' : 'transparent',
                      cursor: jumpPage ? 'pointer' : 'default',
                      opacity: jumpPage ? 1 : 0.65,
                    }}
                  >
                    <span
                      style={{
                        ...styles.outlineRowTitle,
                        color: isActive ? 'var(--accent)' : 'var(--text)',
                        fontWeight: entry.depth === 0 ? 600 : 400,
                      }}
                    >
                      {entry.title}
                    </span>
                    {jumpPage && bookmarkedPages.has(jumpPage) ? (
                      <span
                        title="این صفحه بوک‌مارک دارد"
                        style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#c9a227', flexShrink: 0 }}
                      />
                    ) : null}
                    {jumpPage ? (
                      <span style={styles.outlineRowPage}>ص. {jumpPage}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ===================================================================
            ۲. کارت فهرست صفحات: ناوبری فصول + لیست اسکرول صفحات
        =================================================================== */}
        {comicData?.type === 'epub' && epubChapters.length > 0 && (
          <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.BookOpen size={15} />
              </span>
              <span style={{ fontSize: 14, fontWeight: 700 }}>فصل‌های کتاب</span>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{epubChapters.length} فصل</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <button
                type="button"
                disabled={activeEpubChapterIndex <= 0}
                onClick={() => jumpToEpubChapter(activeEpubChapterIndex - 1)}
                style={{ ...styles.epubNavBtn, opacity: activeEpubChapterIndex <= 0 ? 0.4 : 1 }}
                title="رفتن به فصل قبلی"
              >
                <Icons.ChevronRight size={14} />
                <span>فصل قبلی</span>
              </button>
              <span style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>
                {`فصل ${(activeEpubChapterIndex + 1).toLocaleString('fa-IR')} از ${epubChapters.length.toLocaleString('fa-IR')}`}
              </span>
              <button
                type="button"
                disabled={activeEpubChapterIndex < 0 || activeEpubChapterIndex >= epubChapters.length - 1}
                onClick={() => jumpToEpubChapter(activeEpubChapterIndex + 1)}
                style={{ ...styles.epubNavBtn, opacity: activeEpubChapterIndex >= epubChapters.length - 1 ? 0.4 : 1 }}
                title="رفتن به فصل بعدی"
              >
                <span>فصل بعدی</span>
                <Icons.ChevronLeft size={14} />
              </button>
            </div>
            <div ref={epubChapterListRef} style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
              {epubChapters.map((ch, idx) => {
                const isActive = idx === activeEpubChapterIndex;
                return (
                  <button
                    key={ch.id || idx}
                    type="button"
                    ref={(el) => {
                      if (el) epubChapterRefs.current.set(idx, el);
                      else epubChapterRefs.current.delete(idx);
                    }}
                    onClick={() => jumpToEpubChapter(idx)}
                    style={{
                      display: 'flex', gap: 8, alignItems: 'center', textAlign: 'right',
                      background: isActive ? 'rgba(34,211,238,0.12)' : 'var(--panel2)',
                      border: isActive ? '1px solid var(--accent)' : '1px solid transparent',
                      borderRadius: 8, padding: '7px 10px', cursor: 'pointer', color: isActive ? 'var(--accent)' : 'var(--text)',
                      fontFamily: 'inherit', fontSize: 13,
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--muted)', minWidth: 22 }}>{idx + 1}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ch.title || `فصل ${idx + 1}`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div style={styles.pagesPanel}>
          <div style={styles.panelTitleRow}>
            <div style={styles.titleWithIcon}>
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.Layers size={15} />
              </span>
              <span style={styles.panelHeaderTitle}>فهرست صفحات</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {chapterGroups.length > 1 && (
                <div style={{ position: 'relative' }} ref={chapterMenuRef}>
                  <button
                    type="button"
                    onClick={() => setShowChapterMenu(!showChapterMenu)}
                    style={styles.chapterJumpBtn}
                    title="پرش مستقیم به فصل"
                  >
                    <Icons.Bookmark size={12} />
                    <span>فصل‌ها</span>
                    <Icons.ChevronDown size={12} />
                  </button>

                  {showChapterMenu && (
                    <div style={styles.chapterDropdown}>
                      {chapterGroups.map((group, gIdx) => {
                        const isCurrentChap = group.title === activeChapterTitle;
                        return (
                          <div
                            key={gIdx}
                            onClick={() => {
                              setShowChapterMenu(false);
                              jumpToPage(group.startPage);
                            }}
                            style={{
                              ...styles.chapterDropdownItem,
                              borderColor: isCurrentChap ? 'var(--accent)' : 'transparent',
                              backgroundColor: isCurrentChap
                                ? 'rgba(34, 211, 238, 0.12)'
                                : 'var(--panel2)',
                            }}
                          >
                            <span
                              style={{
                                ...styles.chapItemTitle,
                                color: isCurrentChap ? 'var(--accent)' : 'var(--text)',
                              }}
                            >
                              {group.title}
                            </span>
                            <span style={styles.chapItemPage}>P.{group.startPage}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              <span style={styles.pageCountTag}>
                {totalPages > 0 ? `${currentPage} / ${totalPages}` : 'PDF'}
              </span>
            </div>
          </div>

          <div style={styles.pageScrollList} ref={scrollContainerRef}>
            {isRightSidebarOpen && processedPages.length > 0 ? (
              processedPages.map((p) => (
                <PageListRow
                  key={p.key}
                  pageNum={p.pageNum}
                  cleanFileName={p.cleanFileName}
                  fullTitle={p.fullTitle}
                  isFirstOfChapter={p.isFirstOfChapter}
                  chapterName={p.chapterName}
                  isCurrentChap={p.chapterName === activeChapterTitle}
                  isActive={p.pageNum === currentPage}
                  activePageRef={activePageRef}
                  onJumpToPage={handlePanelPageJump}
                  hasBookmark={bookmarkedPages.has(p.pageNum)}
                />
              ))
            ) : (
              <div style={styles.emptyNotice}>
                {isPdfMode ? 'در حال بارگذاری فهرست صفحات PDF...' : 'فایلی باز نشده است'}
              </div>
            )}
          </div>
        </div>

        {/* ===================================================================
            ۳. کارت صف پوشه: عنوان پوشه + فایل بعدی با Marquee + ناوبری
        =================================================================== */}
        <div style={styles.dirControlCard}>
          <div style={styles.dirHeaderRow}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                overflow: 'hidden',
                flex: 1,
              }}
            >
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.Folder size={16} />
              </span>
              <MarqueeText
                text={dirInfo?.name || 'پوشه‌ای انتخاب نشده'}
                title={dirInfo?.name || 'پوشه‌ای انتخاب نشده'}
                direction="ltr"
                style={styles.dirNameMarquee}
              />
            </div>

            <button onClick={onOpenFolder} style={styles.openFolderBtn} title="انتخاب پوشه دیگر">
              <Icons.Plus size={12} />
              <span>پوشه</span>
            </button>
          </div>

          <div style={styles.sortBar} ref={sortMenuRef}>
            <span style={styles.folderCountText}>
              {dirInfo?.total ? `${dirInfo.current} از ${dirInfo.total} فایل` : 'مرتب‌سازی فصول:'}
            </span>

            <div style={{ position: 'relative' }}>
              <button
                type="button"
                onClick={() => setShowSortMenu(!showSortMenu)}
                style={styles.sortToggleBtn}
              >
                <Icons.ArrowUpDown size={12} />
                <span>ترتیب</span>
                <Icons.ChevronDown size={11} />
              </button>

              {showSortMenu && (
                <div style={styles.dropdownMenu}>
                  {sortOptions.map((option) => (
                    <div
                      key={option.id}
                      onClick={() => handleSortChange(option.id)}
                      style={{
                        ...styles.dropdownItem,
                        backgroundColor:
                          currentSort === option.id
                            ? 'rgba(34, 211, 238, 0.14)'
                            : 'transparent',
                        color: currentSort === option.id ? 'var(--accent)' : 'var(--text)',
                        fontWeight: currentSort === option.id ? 700 : 400,
                      }}
                    >
                      {option.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={styles.nextQueueWrap}>
            <span style={styles.nextLabel}>فایل بعدی در صف:</span>
            <div
              style={{
                ...styles.nextCardPreview,
                cursor: nextComic ? 'pointer' : 'default',
                borderColor: nextComic ? 'var(--border)' : 'rgba(29, 42, 49, 0.5)',
              }}
              onClick={() => nextComic && onLoadComic(nextComic.path)}
              title={nextComic ? `کلیک برای باز کردن: ${nextComic.name}` : ''}
            >
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.Play size={13} />
              </span>
              <div style={styles.nextFileMarqueeWrap}>
                <MarqueeText
                  text={nextComic ? nextComic.name : 'پایان فهرست پوشه'}
                  title={nextComic ? nextComic.name : ''}
                  direction="ltr"
                  style={styles.nextFileName}
                />
              </div>
              {nextComic && <span style={styles.nextSizeBadge}>{nextComic.size}</span>}
            </div>
          </div>

          <div style={styles.navRow}>
            <button
              type="button"
              disabled={!prevComic}
              onClick={() => prevComic && onLoadComic(prevComic.path)}
              style={{ ...styles.navBtn, opacity: prevComic ? 1 : 0.4 }}
              title={prevComic?.name || ''}
            >
              <Icons.ChevronRight size={14} />
              <span>قبلی</span>
            </button>

            <button
              type="button"
              disabled={!nextComic}
              onClick={() => nextComic && onLoadComic(nextComic.path)}
              style={{ ...styles.navBtn, opacity: nextComic ? 1 : 0.4 }}
              title={nextComic?.name || ''}
            >
              <span>بعدی</span>
              <Icons.ChevronLeft size={14} />
            </button>
          </div>

          {/* مرحلهٔ ۳۹ §۱: فهرستِ فایل‌هایِ پوشهٔ بازشده (به ترتیبِ پنلِ
              راست) — کلیک روی هر فایل، همان فایل را باز می‌کند. */}
          {Array.isArray(comicData?.folderFiles) && comicData.folderFiles.length > 0 && (
            <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <button
                type="button"
                onClick={() => setFolderListCollapsed((v) => !v)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'transparent', border: 'none', padding: 0, marginBottom: 8, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700, color: 'var(--text)' }}
              >
                <span>{`فایل‌هایِ این پوشه (${comicData.folderFiles.length})`}</span>
                <span style={accordionCircleStyle(!folderListCollapsed)}>
                  <Icons.ChevronDown size={15} strokeWidth="2.4" style={accordionChevronStyle(!folderListCollapsed)} />
                </span>
              </button>
              {!folderListCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                {comicData.folderFiles.map((f) => {
                  const isImageKind = f.kind === 'image';
                  const isCurrent = isImageKind ? f.pageIndex === currentPage : normalizeBookKey(f.path || '') === normalizeBookKey(comicData?.filePath || '');
                  return (
                    <button
                      key={f.path}
                      type="button"
                      onClick={() => { if (isImageKind && f.pageIndex) jumpToPage(f.pageIndex); else onLoadComic(f.path); }}
                      title={f.name}
                      style={{
                        display: 'flex', gap: 8, alignItems: 'center', textAlign: 'right',
                        background: isCurrent ? 'rgba(34, 211, 238, 0.12)' : 'transparent',
                        border: isCurrent ? '1px solid var(--accent)' : '1px solid transparent',
                        borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
                        color: isCurrent ? 'var(--accent)' : 'var(--text)',
                        fontFamily: 'inherit', fontSize: 12,
                      }}
                    >
                      <span style={{ color: 'var(--accent)', display: 'flex', flexShrink: 0 }}>
                        {f.kind === 'pdf' ? <Icons.FileText size={13} /> : f.kind === 'epub' ? <Icons.BookOpen size={13} /> : f.kind === 'folder' ? <Icons.Folder size={13} /> : f.kind === 'image' ? <Icons.Image size={13} /> : <Icons.FileArchive size={13} />}
                      </span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    </button>
                  );
                })}
              </div>
              )}
            </div>
          )}
        </div>

        <div style={styles.gapControlCard}>
          <div style={styles.gapHeaderRow}>
            <div style={styles.titleWithIcon}>
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.Sliders size={14} />
              </span>
              <span style={styles.gapCardTitle}>
                فاصله بین صفحات ({isPdfMode ? 'سند PDF' : 'کمیک / ZIP'})
              </span>
            </div>
            <span style={styles.gapValueBadge}>
              {activeGapValue === 0 ? '۰px (چسبیده)' : `${activeGapValue}px`}
            </span>
          </div>

          <input
            type="range"
            min="0"
            max="40"
            step="1"
            value={activeGapValue}
            onChange={(e) => handleGapChange(e.target.value)}
            style={styles.gapSlider}
            title={`تنظیم فاصله عمودی بین صفحات: ${activeGapValue} پیکسل`}
          />

          <div style={styles.gapPresetRow}>
            {gapPresets.map((preset) => {
              const isSelected = activeGapValue === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleGapChange(preset)}
                  style={{
                    ...styles.gapPresetBtn,
                    backgroundColor: isSelected ? 'var(--accent)' : 'var(--panel)',
                    borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                    color: isSelected ? '#0a0f13' : 'var(--text)',
                    fontWeight: isSelected ? 700 : 600,
                  }}
                >
                  {preset === 0 ? 'بدون مرز (0)' : `${preset}px`}
                </button>
              );
            })}
          </div>
        </div>

        {/* مرحلهٔ ۴۱ §۳: کارت‌هایِ تنظیماتِ وابسته به فرمت — فقط
            برایِ فایلِ CBZ یا EPUB؛ برایِ PDF/ZIP/RAR و پوشهٔ
            عادی، هیچ‌کدام نمایش داده نمی‌شود. */}
        {isCbzFile && (
          <div style={styles.formatCard}>
            <div style={styles.titleWithIcon}>
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.FileArchive size={14} />
              </span>
              <span style={styles.gapCardTitle}>تنظیمات نمایش CBZ</span>
            </div>
            <div style={styles.formatRow}>
              <span style={styles.formatLabel}>زوم نرمال CBZ</span>
              <span style={styles.gapValueBadge}>{liveCbzZoomPct.toLocaleString('fa-IR')}٪</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min="50"
                max="300"
                step="5"
                value={cbzZoomDraft ?? liveCbzZoomPct}
                onChange={(e) => applyCbzZoom(e.target.value)}
                style={styles.gapSlider}
                title={`زوم نرمال CBZ: ${liveCbzZoomPct} درصد`}
              />
              <input
                type="number"
                min="50"
                max="300"
                value={cbzZoomDraft ?? liveCbzZoomPct}
                onChange={(e) => setCbzZoomDraft(e.target.value)}
                onBlur={commitCbzZoomDraft}
                onKeyDown={(e) => { if (e.key === 'Enter') commitCbzZoomDraft(); }}
                style={styles.formatNumberInput}
                title="زوم نرمال CBZ (۵۰ تا ۳۰۰ درصد)"
              />
            </div>
            <div style={styles.formatRow}>
              <span style={styles.formatLabel}>حالت نمایش</span>
              <div style={styles.formatSegWrap}>
                <button
                  type="button"
                  onClick={() => applyCbzViewMode('horizontal-paged')}
                  style={{
                    ...styles.formatSegBtn,
                    ...(comicViewMode === 'horizontal-paged'
                      ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: '#0a0f13', fontWeight: 700 }
                      : {}),
                  }}
                >
                  افقی
                </button>
                <button
                  type="button"
                  onClick={() => applyCbzViewMode('vertical')}
                  style={{
                    ...styles.formatSegBtn,
                    ...(comicViewMode === 'vertical'
                      ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: '#0a0f13', fontWeight: 700 }
                      : {}),
                  }}
                >
                  عمودی
                </button>
              </div>
            </div>
          </div>
        )}
        {isEpubFile && (
          <div style={styles.formatCard}>
            <div style={styles.titleWithIcon}>
              <span style={{ color: 'var(--accent)', display: 'flex' }}>
                <Icons.BookOpen size={14} />
              </span>
              <span style={styles.gapCardTitle}>تنظیمات نمایش EPUB</span>
            </div>
            <div style={styles.formatRow}>
              <span style={styles.formatLabel}>زوم نرمال EPUB</span>
              <span style={styles.gapValueBadge}>{liveEpubZoomPct.toLocaleString('fa-IR')}٪</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="range"
                min="50"
                max="250"
                step="5"
                value={epubZoomDraft ?? liveEpubZoomPct}
                onChange={(e) => applyEpubZoom(e.target.value)}
                style={styles.gapSlider}
                title={`زوم نرمال EPUB: ${liveEpubZoomPct} درصد`}
              />
              <input
                type="number"
                min="50"
                max="250"
                value={epubZoomDraft ?? liveEpubZoomPct}
                onChange={(e) => setEpubZoomDraft(e.target.value)}
                onBlur={commitEpubZoomDraft}
                onKeyDown={(e) => { if (e.key === 'Enter') commitEpubZoomDraft(); }}
                style={styles.formatNumberInput}
                title="زوم نرمال EPUB (۵۰ تا ۲۵۰ درصد)"
              />
            </div>
            <div style={styles.formatRow}>
              <span style={styles.formatLabel}>حالت نمایش</span>
              <div style={styles.formatSegWrap}>
                <button
                  type="button"
                  onClick={() => applyEpubViewMode('vertical')}
                  style={{
                    ...styles.formatSegBtn,
                    ...(epubViewMode === 'vertical'
                      ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: '#0a0f13', fontWeight: 700 }
                      : {}),
                  }}
                >
                  عمودی
                </button>
                <button
                  type="button"
                  onClick={() => applyEpubViewMode('horizontal-paged')}
                  style={{
                    ...styles.formatSegBtn,
                    ...(epubViewMode === 'horizontal-paged'
                      ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: '#0a0f13', fontWeight: 700 }
                      : {}),
                  }}
                >
                  افقی
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '320px',
    minWidth: '320px',
    height: '100%',
    padding: '10px',
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
    direction: 'rtl',
    userSelect: 'none',
    boxSizing: 'border-box',
    position: 'relative',
  },
  hoverSafetyBridge: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '-16px',
    width: '16px',
    backgroundColor: 'transparent',
  },
  scrollableBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
    height: '100%',
    overflowY: 'auto',
    overflowX: 'hidden',
    paddingLeft: '2px',
  },
  topCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    padding: '12px',
    backgroundColor: 'var(--panel2)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    width: '100%',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  infoRow: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  coverThumbBox: {
    width: '56px',
    height: '74px',
    backgroundColor: 'var(--bg)',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    position: 'relative',
    cursor: 'pointer',
  },
  coverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  coverEditOverlay: {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'rgba(10, 15, 19, 0.78)',
    color: 'var(--accent)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '2px',
  },
  coverEditText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '9.5px',
    fontWeight: 700,
  },
  metaInfoBox: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  fileNameMarquee: {
    fontFamily: 'var(--font-latin)',
    fontSize: '15px',
    fontWeight: 800,
    color: 'var(--text)',
    height: '22px',
  },
  badgeRow: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  sizePill: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 700,
    fontSize: '10.5px',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    color: 'var(--accent)',
    padding: '2px 8px',
    borderRadius: '8px',
    direction: 'ltr',
  },
  pagePill: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 600,
    fontSize: '10.5px',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    color: 'var(--muted)',
    padding: '2px 8px',
    borderRadius: '8px',
  },
  chapterPill: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 600,
    fontSize: '10.5px',
    backgroundColor: 'rgba(188, 140, 255, 0.14)',
    color: 'var(--purple)',
    padding: '2px 8px',
    borderRadius: '8px',
  },
  quickActionsBar: {
    display: 'flex',
    gap: '6px',
    alignItems: 'center',
  },
  libActionBtn: {
    flex: 1,
    padding: '8px 10px',
    borderRadius: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    transition: 'all 0.18s ease',
    outline: 'none',
  },
  btnIconBox: {
    display: 'flex',
    alignItems: 'center',
  },
  favActionBtn: {
    width: '36px',
    height: '36px',
    borderRadius: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    outline: 'none',
    flexShrink: 0,
  },
  pagesPanel: {
    display: 'flex',
    flexDirection: 'column',
    minHeight: '280px',
    maxHeight: '390px',
    overflow: 'hidden',
    padding: '12px',
    backgroundColor: 'var(--panel2)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    width: '100%',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  outlinePanel: {
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '12px',
    padding: '12px',
    marginBottom: '12px',
    boxSizing: 'border-box',
  },
  outlineScrollList: {
    maxHeight: '300px',
    overflowY: 'auto',
    overflowX: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginTop: '8px',
    paddingLeft: '2px',
  },
  outlineRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    paddingTop: '6px',
    paddingBottom: '6px',
    paddingLeft: '8px',
    borderRight: '2px solid transparent',
    borderRadius: '6px',
    boxSizing: 'border-box',
  },
  outlineRowTitle: {
    fontSize: '12.5px',
    lineHeight: '1.6',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    flex: 1,
    minWidth: 0,
  },
  outlineRowPage: {
    fontSize: '11px',
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  outlineEmptyText: {
    fontSize: '12px',
    color: 'var(--muted)',
    marginTop: '8px',
  },
  panelTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '10px',
  },
  titleWithIcon: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
  },
  panelHeaderTitle: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 800,
    fontSize: '14.5px',
    color: 'var(--text)',
  },
  chapterJumpBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.35)',
    color: 'var(--accent)',
    fontFamily: 'var(--font-fa)',
    fontWeight: 600,
    fontSize: '12px',
    padding: '3px 8px',
    borderRadius: '8px',
    cursor: 'pointer',
    outline: 'none',
  },
  chapterDropdown: {
    position: 'absolute',
    top: '30px',
    left: 0,
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
    borderRadius: '10px',
    padding: '6px',
    zIndex: 140,
    width: '195px',
    maxHeight: '220px',
    overflowY: 'auto',
    boxShadow: '0 10px 28px rgba(0,0,0,0.85)',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  chapterDropdownItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '6px 8px',
    borderRadius: '7px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  chapItemTitle: {
    fontFamily: 'var(--font-latin)',
    fontWeight: 700,
    fontSize: '12px',
    direction: 'ltr',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '125px',
  },
  chapItemPage: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    color: 'var(--accent)',
    fontSize: '10.5px',
    direction: 'ltr',
  },
  pageCountTag: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    fontSize: '11px',
    color: 'var(--accent)',
    direction: 'ltr',
  },
  pageScrollList: {
    flex: 1,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  chapterStickyDivider: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 10px',
    margin: '6px 0 2px',
    borderRadius: '8px',
    backgroundColor: 'rgba(15, 23, 28, 0.94)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
    position: 'sticky',
    top: 0,
    zIndex: 5,
    cursor: 'pointer',
    backdropFilter: 'blur(10px)',
  },
  chapterBannerText: {
    fontFamily: 'var(--font-latin)',
    fontWeight: 700,
    fontSize: '12.5px',
    color: 'var(--accent)',
    direction: 'ltr',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  pageRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 8px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'transparent',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  pageNumberBadge: {
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    flexShrink: 0,
    direction: 'ltr',
  },
  pageItemText: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    direction: 'ltr',
    textAlign: 'left',
  },
  activeIndicator: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--accent)',
    boxShadow: '0 0 8px var(--accent)',
    flexShrink: 0,
  },
  emptyNotice: {
    textAlign: 'center',
    color: 'var(--muted)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    marginTop: '24px',
  },
  dirControlCard: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    backgroundColor: 'var(--panel2)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    position: 'relative',
    width: '100%',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  dirHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  dirNameMarquee: {
    fontFamily: 'var(--font-latin)',
    fontSize: '14px',
    fontWeight: 700,
    color: 'var(--text)',
    height: '20px',
    flex: 1,
  },
  openFolderBtn: {
    backgroundColor: 'transparent',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    padding: '4px 9px',
    borderRadius: '8px',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    transition: 'all 0.15s ease',
    outline: 'none',
    flexShrink: 0,
  },
  sortBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  folderCountText: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 500,
    fontSize: '12px',
    color: 'var(--muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  sortToggleBtn: {
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    padding: '4px 8px',
    borderRadius: '8px',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    outline: 'none',
  },
  dropdownMenu: {
    position: 'absolute',
    bottom: '30px',
    left: 0,
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
    borderRadius: '10px',
    padding: '5px',
    zIndex: 130,
    width: '165px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.85)',
  },
  dropdownItem: {
    padding: '6px 8px',
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background 0.15s ease',
  },
  nextQueueWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  nextLabel: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 500,
    fontSize: '11px',
    color: 'var(--muted)',
  },
  nextCardPreview: {
    backgroundColor: 'var(--panel)',
    borderRadius: '9px',
    padding: '7px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    transition: 'all 0.15s ease',
  },
  nextFileMarqueeWrap: {
    flex: 1,
    overflow: 'hidden',
  },
  nextFileName: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 400,
    color: 'var(--text)',
    height: '18px',
  },
  nextSizeBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    padding: '2px 6px',
    borderRadius: '6px',
    direction: 'ltr',
    flexShrink: 0,
  },
  navRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '2px',
  },
  navBtn: {
    flex: 1,
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    padding: '8px 0',
    borderRadius: '9px',
    cursor: 'pointer',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '5px',
    transition: 'all 0.18s ease',
    outline: 'none',
  },
  // مرحلهٔ ۴۱ §۲/§۳: دکمهٔ ناوبریِ فصلِ EPUB + کارتِ تنظیماتِ
  // وابسته به فرمت (CBZ/EPUB).
  epubNavBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    padding: '6px 10px',
    borderRadius: '9px',
    cursor: 'pointer',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    outline: 'none',
    flexShrink: 0,
  },
  formatCard: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    backgroundColor: 'var(--panel2)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    width: '100%',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  formatRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '8px',
  },
  formatLabel: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 600,
    fontSize: '12px',
    color: 'var(--text)',
  },
  formatNumberInput: {
    width: '64px',
    flexShrink: 0,
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    fontWeight: 700,
    color: 'var(--text)',
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    padding: '4px 6px',
    outline: 'none',
    textAlign: 'center',
    direction: 'ltr',
  },
  formatSegWrap: {
    display: 'flex',
    gap: '5px',
  },
  formatSegBtn: {
    padding: '5px 12px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'var(--panel)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    outline: 'none',
    transition: 'all 0.15s ease',
  },
  gapControlCard: {
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    backgroundColor: 'var(--panel2)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    width: '100%',
    boxSizing: 'border-box',
    flexShrink: 0,
  },
  gapHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gapCardTitle: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '12.5px',
    color: 'var(--text)',
  },
  gapValueBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 700,
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    padding: '2px 8px',
    borderRadius: '8px',
    direction: 'ltr',
  },
  gapSlider: {
    width: '100%',
    accentColor: 'var(--accent)',
    cursor: 'pointer',
  },
  gapPresetRow: {
    display: 'flex',
    gap: '5px',
    flexWrap: 'wrap',
  },
  gapPresetBtn: {
    flex: 1,
    minWidth: '46px',
    padding: '5px 6px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    outline: 'none',
    textAlign: 'center',
  },
  // مرحله ۱۳: کارتِ بوک‌مارک‌ها
  bookmarkSectionToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
  },
  // مرحلهٔ ۳۰ — بدنهٔ بازشوندهٔ بوک‌مارک‌ها: سقفِ ۳۸vh + اسکرولِ
  // داخلی تا با ۱۰۰ بوک‌مارک هم کلِ پنل را اشغال نکند.
  bookmarkSectionBody: {
    maxHeight: '38vh',
    overflowY: 'auto',
  },
  bookmarkPanel: {
    border: '1px solid var(--border)',
    borderRadius: '12px',
    backgroundColor: 'var(--panel)',
    padding: '12px',
    marginBottom: '12px',
  },
  bookmarkAddBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 10px',
    borderRadius: '8px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  bookmarkList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginTop: '10px',
  },
  bookmarkRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    backgroundColor: 'var(--panel2)',
    cursor: 'pointer',
  },
  bookmarkThumb: {
    width: '40px',
    height: '56px',
    objectFit: 'cover',
    borderRadius: '6px',
    flexShrink: 0,
    display: 'block',
  },
  bookmarkName: {
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  bookmarkMeta: {
    fontSize: '11.5px',
    color: 'var(--muted)',
    marginTop: '2px',
  },
  bookmarkEditBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    border: '1px solid var(--border)',
    backgroundColor: 'transparent',
    color: 'var(--muted)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  bookmarkNameInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    color: 'var(--text)',
    backgroundColor: '#fffbe6',
    border: '1px solid #d4af37',
    borderRadius: '6px',
    padding: '2px 6px',
    outline: 'none',
  },
  bookmarkDelBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    border: '1px solid var(--border)',
    backgroundColor: 'transparent',
    color: 'var(--muted)',
    cursor: 'pointer',
    flexShrink: 0,
  },
};