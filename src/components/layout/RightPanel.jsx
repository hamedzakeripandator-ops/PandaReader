import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';
import useLibraryStore from '../../store/useLibraryStore';
import { coreApi } from '../../services/coreApi';
import thumbnailService, { resolveCoverUrl } from '../../services/thumbnailService';
import Icons from '../common/Icons';
import MarqueeText from '../common/MarqueeText';
import { flattenOutline, findActiveOutlineEntry, firstJumpablePage } from '../../utils/pdfOutline';

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

        {isActive && <div style={styles.activeIndicator} />}
      </div>
    </>
  );
});

export default function RightPanel({ onLoadComic, onOpenFolder, onMouseEnter, onMouseLeave }) {
  const isRightSidebarOpen = useAppStore((state) => state.isRightSidebarOpen);
  const showToast = useAppStore((state) => state.showToast);

  const comicData = useReaderStore((state) => state.comicData);
  const currentPage = useReaderStore((state) => (isRightSidebarOpen ? state.currentPage : 1));
  const jumpToPage = useReaderStore((state) => state.jumpToPage);
  const pdfOutline = useReaderStore((state) => state.pdfOutline);
  const pdfOutlineFile = useReaderStore((state) => state.pdfOutlineFile);
  const pdfOutlineStatus = useReaderStore((state) => state.pdfOutlineStatus);
  const setComicData = useReaderStore((state) => state.setComicData);

  // استیت‌های تنظیم فاصله صفحات (Page Offset / Gap)
  const comicPageGap = useReaderStore((state) => state.comicPageGap ?? 0);
  const pdfPageGap = useReaderStore((state) => state.pdfPageGap ?? 12);
  const setComicPageGap = useReaderStore((state) => state.setComicPageGap);
  const setPdfPageGap = useReaderStore((state) => state.setPdfPageGap);

  const filePath = comicData?.filePath || comicData?.path || '';
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
  const [coverUrl, setCoverUrl] = useState(null);
  const [coverHover, setCoverHover] = useState(false);

  const activePageRef = useRef(null);
  const sortMenuRef = useRef(null);
  const chapterMenuRef = useRef(null);
  const scrollContainerRef = useRef(null);

  const currentSort = comicData?.dirInfo?.sortBy || 'name_asc';
  const totalPages = comicData?.items?.length || comicData?.savedTotalPages || 0;
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

  // اسکرول خودکار درون باکس لیست صفحات
  useEffect(() => {
    if (!isRightSidebarOpen) return;
    const rafId = requestAnimationFrame(() => {
      if (activePageRef.current && scrollContainerRef.current) {
        const container = scrollContainerRef.current;
        const el = activePageRef.current;

        const elTop = el.offsetTop;
        const elBottom = elTop + el.offsetHeight;
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;

        if (elTop < containerTop + 30) {
          container.scrollTo({ top: Math.max(0, elTop - 35), behavior: 'auto' });
        } else if (elBottom > containerBottom - 30) {
          container.scrollTo({
            top: elBottom - container.clientHeight + 35,
            behavior: 'auto',
          });
        }
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [currentPage, isRightSidebarOpen]);

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
                  onJumpToPage={jumpToPage}
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
        </div>

        {/* ===================================================================
            ۴. کارت پایین (با اسکرول): تنظیم فاصله و آفست عمودی بین صفحات
        =================================================================== */}
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
};