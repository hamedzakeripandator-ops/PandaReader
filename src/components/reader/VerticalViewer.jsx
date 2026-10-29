import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useVirtualScroll from '../../hooks/useVirtualScroll';
import useContextMenu from '../../hooks/useContextMenu';
import { coreApi } from '../../services/coreApi';
import annotationLocalBackup from '../../services/annotationLocalBackup';
import Icons from '../common/Icons';
import AnnotationLayer from './AnnotationLayer';
import AnnotationToolbar from './AnnotationToolbar';
import useSettingsStore from '../../store/useSettingsStore';
import readingActivity from '../../services/readingActivity';
import { getReadingThemeFilter } from '../../utils/readingTheme';

// تولید آدرس استاندارد و مطلق برای پروتکل امن comic://
function buildComicImageUrl(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const trimmed = filePath.trim();
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('comic://')
  ) {
    return trimmed;
  }
  const sanitized = trimmed.replace(/^[\\/]+/, '');
  return `comic://media/?path=${encodeURIComponent(sanitized)}`;
}

// کامپوننت فریم ایزوله‌شده با حذف درز سیاه زیرپیکسلی، پاس دوم وضوح بالا (HiDPI) و لایه استودیو ویرایش
// مرحله ۱۲: آرایهٔ مشترکِ «صفحه بدونِ حاشیه‌نویسی» — مثلِ
// PdfViewer: `|| []`ی تازه در هر رندرِ والد، مقایسهٔ سطحیِ
// React.memo را برای ComicPageFrame و لایهٔ Konvaی درونِ آن،
// شکست می‌داد. این آرایه، فریز شده و در همهٔ صفحه‌ها مشترک است.
const EMPTY_PAGE_ANNOTATIONS = Object.freeze([]);

const ComicPageFrame = React.memo(function ComicPageFrame({
  item,
  index,
  isLastItem,
  knownHeight,
  frameWidth,
  pageGap,
  rotation,
  isHiDpiPassActive,
  isNearViewport,
  isSharpenFilterActive,
  pageAnnotations,
  onCommitPageAnnotations,
  onImageLoad,
  onContextMenu,
  pageFilter,
}) {
  const pageNum = index + 1;
  const rawPath = item?.path || item?.filePath || '';
  const [retryCount, setRetryCount] = useState(0);
  const [hasError, setHasError] = useState(false);

  const imgSrc = useMemo(() => {
    const base = buildComicImageUrl(rawPath);
    if (!base) return '';
    return retryCount > 0 ? `${base}&retry=${retryCount}` : base;
  }, [rawPath, retryCount]);

  const handleImgError = useCallback(() => {
    if (retryCount < 2) {
      setTimeout(() => {
        setRetryCount((prev) => prev + 1);
      }, 250 * (retryCount + 1));
    } else {
      setHasError(true);
    }
  }, [retryCount]);

  const handleLoad = useCallback(
    (e) => {
      const nw = e.target.naturalWidth;
      const nh = e.target.naturalHeight;
      if (nw > 0 && nh > 0) {
        onImageLoad(index, nw, nh);
      }
    },
    [index, onImageLoad]
  );

  const normalizedRotation = ((Number(rotation) || 0) % 360 + 360) % 360;
  const isSwappedRotation = normalizedRotation === 90 || normalizedRotation === 270;
  const useSwappedLayout = isSwappedRotation && frameWidth > 0;

  const isSeamlessMode = pageGap === 0 && !rotation;

  return (
    <div
      id={`comic-page-${pageNum}`}
      data-page={pageNum}
      data-index={index}
      className="comic-page-item"
      style={{
        ...styles.imageWrapper,
        height: knownHeight ? `${knownHeight}px` : 'auto',
        minHeight: knownHeight ? `${knownHeight}px` : '450px',
        marginBottom: isLastItem ? '0px' : `${pageGap}px`,
        contain: isSeamlessMode ? 'layout style' : 'layout paint',
        overflow: isSeamlessMode ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => onContextMenu(e, index, rawPath)}
    >
      {/* مانتِ دائمیِ لایهٔ حاشیه‌نویسی (یکسان‌سازی با PdfViewer، فاز ۱):
          قبلاً AnnotationLayer فقط وقتی imgSrc آماده و بدونِ خطا بود
          مانت می‌شد؛ پس صفحه‌های کمیکِ در حالِ بارگذاری یا خطادار،
          اصلاً لایه نداشتند و هیچ ورودی‌ای نمی‌گرفتند. حالا لایه همیشه
          مانت است و تا وقتی تصویر آماده نیست، روی placeholder می‌نشیند.
          وقتی استودیو غیرفعال است، pointerEventsِ لایه none است، پس
          دکمهٔ «تلاش مجدد» همچنان کلیک‌پذیر می‌ماند. لایه آخرین فرزندِ
          wrapperِ چرخان است تا روی تصویر رنگ شود و چرخش را به‌ارث ببرد.
          یکسان‌سازی با PdfViewer: از این فاز، rotation به لایه هم پاس
          داده می‌شود تا مختصاتِ معکوسِ چرخش در extractPoints، با
          چیدمانِ جابه‌جا شدهٔ بالا هم‌خوان باشد. */}
      <div
        style={{
          // یکسان‌سازی با PdfViewer (رفعِ بدهیِ فنی): برای چرخشِ
          // ۹۰/۲۷۰، چیدمانِ wrapper باید جابه‌جا شده باشد، وگرنه
          // wrapperِ ۱۰۰٪×۱۰۰٪ پس از چرخش، از دو طرف از کادر بیرون
          // می‌زند و contain/overflowِ کادر، هم تصویر و هم لایه را
          // می‌بُرد (همان خانوادهٔ باگِ ناحیه‌های مردهٔ PDF). عرضِ
          // واقعیِ کادر (frameWidth) از والد می‌آید؛ تا وقتی اندازه
          // نشده، چیدمانِ قدیمی حفظ می‌شود (فقط یک رندرِ گذرا).
          position: useSwappedLayout ? 'absolute' : 'relative',
          left: useSwappedLayout ? '50%' : undefined,
          top: useSwappedLayout ? '50%' : undefined,
          width: useSwappedLayout ? (knownHeight ? `${knownHeight}px` : '450px') : '100%',
          height: useSwappedLayout ? `${frameWidth}px` : '100%',
          // کانتینرِ درونی، هرگز فرو نمی‌ریزد: حتی وقتی تصویر هنوز
          // اندازه نشده یا خطا داده، minHeightِ کادر را دارد تا
          // لایه، همیشه جعبهٔ زنده داشته باشد.
          minHeight: knownHeight ? `${knownHeight}px` : '450px',
          transform: useSwappedLayout
            ? `translate(-50%, -50%) rotate(${rotation}deg)`
            : (rotation ? `rotate(${rotation}deg)` : 'none'),
        }}
      >
        {imgSrc && !hasError ? (
          <img
            src={imgSrc}
            alt={`Page ${pageNum}`}
            loading="eager"
            decoding="sync"
            draggable={false}
            style={{
              ...styles.image,
              height: knownHeight
                ? isSeamlessMode && !isLastItem
                  ? 'calc(100% + 1px)'
                  : '100%'
                : 'auto',
              objectFit: 'fill',
              // فاز ۳: فیلترِ شارپنسِ SVG (کانولوشنِ ۳×۳ روی کلِ تصویر)
              // فقط وقتی روشن است که پاسِ HiDPI فعال باشد و زوم ≤ ۱٫۵
              // و استودیو خاموش باشد؛ در زومِ بالا یا حینِ حاشیه‌نویسی،
              // مرورگر از این کانولوشنِ هر فریم راحت می‌شود.
              // مرحله ۶ ـ بخش الف: تمِ مطالعه با فیلترِ شارپنسِ HiDPI
              // ترکیب می‌شود (هر دو فقط روی همین img اثر می‌کنند؛
              // لایهٔ حاشیه‌نویسی، خواهرِ wrapper است و دست نمی‌خورد).
              filter: [pageFilter && pageFilter !== 'none' ? pageFilter : null, isSharpenFilterActive ? 'url(#comic-hidpi-sharpen)' : null].filter(Boolean).join(' ') || 'none',
              transform: isHiDpiPassActive ? 'translateZ(0)' : 'none',
            }}
            onLoad={handleLoad}
            onError={handleImgError}
          />
        ) : (
          <div style={styles.errorPlaceholder}>
            <span style={{ color: 'var(--danger)', display: 'flex' }}>
              <Icons.AlertTriangle size={24} />
            </span>
            <span style={styles.errorText}>خطا در بارگذاری صفحه {pageNum}</span>
            <button
              type="button"
              onClick={() => {
                setHasError(false);
                setRetryCount((c) => c + 1);
              }}
              style={styles.retryBtn}
            >
              تلاش مجدد
            </button>
          </div>
        )}

        {/* لایه تعاملی استودیو ویرایش روی صفحات کمیک — همیشه مانت است */}
        <AnnotationLayer
          pageNumber={pageNum}
          rotation={rotation}
          items={pageAnnotations}
          onCommitPageItems={onCommitPageAnnotations}
          isNearViewport={isNearViewport}
        />
      </div>
    </div>
  );
});

export default function VerticalViewer() {
  const comicData = useReaderStore((state) => state.comicData);
  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const setZoomLevel = useReaderStore((state) => state.setZoomLevel);
  const areaZoomTarget = useReaderStore((state) => state.areaZoomTarget);
  const clearAreaZoomTarget = useReaderStore((state) => state.clearAreaZoomTarget);
  const hiDpiRenderTick = useReaderStore((state) => state.hiDpiRenderTick);
  const triggerHiDpiRender = useReaderStore((state) => state.triggerHiDpiRender);
  const comicPageGap = useReaderStore((state) => state.comicPageGap ?? 0);
  const rotation = useReaderStore((state) => state.rotation);
  const readingTheme = useSettingsStore((state) => state.preferences?.readingTheme || 'default');
  const readingBrightness = useSettingsStore((state) => state.preferences?.readingBrightness ?? 1);
  const readingWarmth = useSettingsStore((state) => state.preferences?.readingWarmth ?? 0);
  const pageFilter = useMemo(
    () => getReadingThemeFilter(readingTheme, readingBrightness, readingWarmth),
    [readingTheme, readingBrightness, readingWarmth]
  );
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const targetPage = useReaderStore((state) => state.targetPage);
  const clearTargetPage = useReaderStore((state) => state.clearTargetPage);

  const isSnippingActive = useAppStore((state) => state.isSnippingActive);
  const isAreaZoomActive = useAppStore((state) => Boolean(state.isAreaZoomActive));
  const isAnnotationActive = useAppStore((state) => Boolean(state.isAnnotationActive));
  const showToast = useAppStore((state) => state.showToast);
  const updateReadingProgress = useLibraryStore((state) => state.updateReadingProgress);
  const { handleContextMenu } = useContextMenu();

  const [annotationsByPage, setAnnotationsByPage] = useState({});
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [isScrollIdle, setIsScrollIdle] = useState(true);

  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // یکسان‌سازی با PdfViewer: عرضِ کانتینر باید با تغییرِ اندازهٔ
  // پنجره هم به‌روز شود، وگرنه عرضِ کادرِ چرخیده (frameWidth) که از
  // آن حساب می‌شود، کهنه می‌ماند و لایهٔ چرخیده، دوباره از کادر
  // بیرون می‌زند. نگهبانِ ۲ پیکسلی، از رندرِ بیهوده جلوگیری می‌کند.
  useEffect(() => {
    const measure = () => {
      const c = containerRef.current;
      if (!c) return;
      const w = Math.round(c.clientWidth || 0);
      setContainerWidth((prev) => (Math.abs(w - prev) > 2 ? w : prev));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const hasResumedRef = useRef(false);
  const isResumingRef = useRef(false);
  const predecodedMapRef = useRef(new Map());
  const scrollIdleTimerRef = useRef(null);

  const items = comicData?.items || [];
  const itemsCount = items.length;
  const currentFilePath = comicData?.filePath;

  const safeZoom = Math.min(3.5, Math.max(0.4, Number(zoomLevel) || 1));
  // عرضِ واقعیِ هر کادر = عرضِ کانتینر × ضریبِ زوم (همان درصدی که
  // zoomWrapper با آن ساخته می‌شود؛ بدونِ کف، چون wrapper هم کفی
  // ندارد). تا قبل از اندازه‌گیری، صفر است و کادر، چیدمانِ قدیمی را
  // نگه می‌دارد.
  const frameWidth = containerWidth > 0
    ? Math.round(containerWidth * (Math.round(safeZoom * 100) / 100))
    : 0;
  const safePageGap = Math.max(0, Math.min(48, Math.round(Number(comicPageGap) || 0)));

  const {
    visibleIndices,
    paddingTop,
    paddingBottom,
    heights,
    offsets,
    recordImageDimensions,
    scrollToIndex,
    activePageIndex,
    isJumping,
  } = useVirtualScroll({
    items,
    itemsCount,
    containerRef,
    estimatedItemHeight: 1200,
    overscan: 3,
    zoomLevel: safeZoom,
    pageGap: safePageGap,
    filePath: currentFilePath,
  });

  // ۱. تشخیص توقف اسکرول برای فعال‌سازی پاس دوم وضوح تصویر (Dual-Pass Crispness)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScrollActivity = () => {
      setIsScrollIdle(false);
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = setTimeout(() => {
        setIsScrollIdle(true);
        triggerHiDpiRender?.();
      }, 180);
    };

    container.addEventListener('scroll', handleScrollActivity, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScrollActivity);
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    };
  }, [triggerHiDpiRender]);

  // ۲. قفل دقیق اسکرول افقی و عمودی روی مرکز کادر کشیده‌شده در «زوم باکسی» (AreaZoomOverlay)
  useEffect(() => {
    if (!areaZoomTarget || !containerRef.current) return;

    requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c) return;

      const { normCenterX = 0.5, normCenterY = 0.5, rect } = areaZoomTarget;

      let targetScrollTop = 0;
      if (
        rect?.pageNumber &&
        rect.pageNumber >= 1 &&
        rect.pageNumber <= itemsCount &&
        heights
      ) {
        const idx = rect.pageNumber - 1;
        let pageTop = 0;
        if (offsets && offsets[idx] !== undefined) {
          pageTop = offsets[idx];
        } else {
          for (let i = 0; i < idx; i++) {
            pageTop += (heights[i] || 1200) + safePageGap;
          }
        }
        const pageH = heights[idx] || 1200;
        const relY = typeof rect.pageRelativeY === 'number' ? rect.pageRelativeY : 0.5;
        targetScrollTop = pageTop + pageH * relY - c.clientHeight / 2;
      } else {
        targetScrollTop = normCenterY * c.scrollHeight - c.clientHeight / 2;
      }

      const targetScrollLeft = normCenterX * c.scrollWidth - c.clientWidth / 2;

      c.scrollTop = Math.max(0, targetScrollTop);
      c.scrollLeft = Math.max(0, targetScrollLeft);
      clearAreaZoomTarget();
    });
  }, [
    areaZoomTarget,
    itemsCount,
    heights,
    offsets,
    safePageGap,
    clearAreaZoomTarget,
  ]);

  // ۳. واکشی یک‌باره تمام یادداشت‌ها و هایلایت‌های ذخیره‌شده این کمیک از دیتابیس
  useEffect(() => {
    let isMounted = true;
    setAnnotationsByPage({});
    setUndoStack([]);
    setRedoStack([]);

    if (!currentFilePath) return;
    if (!coreApi.isAvailable()) {
      // فاز ۴، بخش ۳: بدونِ Electron، دیتابیس در دسترس نیست؛ فقط از
      // پشتیبانِ localStorage بخوان تا حاشیه‌نویسی‌ها با بستنِ برنامه
      // از بین نروند.
      setAnnotationsByPage(annotationLocalBackup.restoreBackupsAsPages(currentFilePath));
      return;
    }

    coreApi
      .dbAction({
        action: 'GET_ANNOTATIONS',
        payload: { filePath: currentFilePath },
      })
      .then((res) => {
        if (!isMounted) return;
        const dbPages = res?.annotations && typeof res.annotations === 'object' ? res.annotations : {};
        // فاز ۴، بخش ۳: آینهٔ localStorage فقط جاهای خالیِ دیتابیس را پر
        // می‌کند (دیتابیس، حتی با آرایهٔ خالی، برنده است).
        const merged = annotationLocalBackup.mergeBackupsIntoPages(currentFilePath, dbPages);
        setAnnotationsByPage(merged.pages);
        // ترمیم: صفحه‌هایی که فقط در پشتیبان بودند، به دیتابیس هم برگردند.
        if (coreApi.isAvailable()) {
          merged.healed.forEach((({ pageNum, items }) => {
            coreApi.savePageAnnotations(currentFilePath, pageNum, items).catch(() => {});
          }));
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [currentFilePath]);

  const handleCommitPageAnnotations = useCallback(
    (pageNum, nextPageItems) => {
      const pageKey = String(pageNum);
      setAnnotationsByPage((prev) => {
        const prevItems = prev[pageKey] || [];
        setUndoStack((u) => [
          ...u.slice(-29),
          { pageNum, prevItems, nextItems: nextPageItems },
        ]);
        setRedoStack([]);
        return {
          ...prev,
          [pageKey]: nextPageItems,
        };
      });

      if (currentFilePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(currentFilePath, pageNum, nextPageItems)
          .catch(() => {});
      }
      // فاز ۴، بخش ۳: آینهٔ localStorage — هرگز throw نمی‌کند و روی
      // مسیرِ دیتابیس اثر نمی‌گذارد.
      annotationLocalBackup.writePageBackup(currentFilePath, pageNum, nextPageItems);
    },
    [currentFilePath]
  );

  const handleUndoAnnotation = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const lastAction = prevUndo[prevUndo.length - 1];
      const pageKey = String(lastAction.pageNum);

      setAnnotationsByPage((prevMap) => ({
        ...prevMap,
        [pageKey]: lastAction.prevItems,
      }));
      setRedoStack((r) => [...r, lastAction]);

      if (currentFilePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(
            currentFilePath,
            lastAction.pageNum,
            lastAction.prevItems
          )
          .catch(() => {});
      }
      annotationLocalBackup.writePageBackup(currentFilePath, lastAction.pageNum, lastAction.prevItems);
      return prevUndo.slice(0, -1);
    });
  }, [currentFilePath]);

  const handleRedoAnnotation = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const nextAction = prevRedo[prevRedo.length - 1];
      const pageKey = String(nextAction.pageNum);

      setAnnotationsByPage((prevMap) => ({
        ...prevMap,
        [pageKey]: nextAction.nextItems,
      }));
      setUndoStack((u) => [...u, nextAction]);

      if (currentFilePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(
            currentFilePath,
            nextAction.pageNum,
            nextAction.nextItems
          )
          .catch(() => {});
      }
      annotationLocalBackup.writePageBackup(currentFilePath, nextAction.pageNum, nextAction.nextItems);
      return prevRedo.slice(0, -1);
    });
  }, [currentFilePath]);

  const handleClearCurrentPageAnnotations = useCallback(() => {
    const pageNum = activePageIndex + 1;
    handleCommitPageAnnotations(pageNum, []);
    showToast(`یادداشت‌های صفحه ${pageNum} پاک شد`, { type: 'info' });
  }, [activePageIndex, handleCommitPageAnnotations, showToast]);

  // مرحله ۳ ـ بخش الف (ممیزی §۲.۶): گیتِ وارونه اصلاح شد تا دقیقاً
  // هم‌تراز با PdfViewer باشد: وقتی استودیو روشن است، فقط تولبار
  // Undo/Redo را مدیریت می‌کند و این شنونده خاموش می‌ماند؛ وقتی
  // استودیو خاموش است، خودِ ویوور Undo/Redo حاشیه‌نویسی‌های صفحه
  // را انجام می‌دهد (قبلاً برعکس بود و Ctrl+Z در کمیکِ بدونِ
  // استودیو هیچ کاری نمی‌کرد).
  useEffect(() => {
    if (isAnnotationActive) return;
    const onKeyDown = (e) => {
      // مرحله ۱۲: در حالِ ضبطِ شورت‌کات در تنظیمات، هیچ‌کاری نکن.
      if (window.__isRecordingShortcut ||
        (typeof document !== 'undefined' &&
          document.body?.dataset?.recordingShortcut === 'true')) return;
      // مرحله ۷ ـ بخش ب: وقتی فوکوس داخلِ کادرِ متنی است (جستجوی
      // PDF، ویرایشگرِ متن/استیکی، سرچ‌بار)، Ctrl+Z/Y باید Undoی
      // متنیِ خودِ مرورگر باشد، نه Undoی حاشیه‌نویسی — وگرنه تایپِ
      // کاربر، بی‌صدا حاشیه‌نویسی را برمی‌گرداند. (شنوندهٔ تولبار و
      // useKeyboard، از پیش همین گیت را داشتند؛ این شنونده نداشت.)
      const t = e.target;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return;
      // مرحله ۷ ـ بخش الف: مالکیتِ این شنونده (فقط وقتی استودیو
      // خاموش است) دقیقاً مثلِ قبل می‌ماند؛ فقط گزاره، از
      // مرجعِ واحد (matchesShortcut) خوانده می‌شود تا تغییرِ
      // میانبرِ Undo/Redo در تنظیمات، کلیدِ قبلی را خلع کند.
      // Ctrl+Shift+Z، اسمِ مستعارِ redo است و در خودِ matcher
      // حل شده است.
      let settingsState = null;
      try {
        settingsState = typeof useSettingsStore.getState === 'function'
          ? useSettingsStore.getState()
          : null;
      } catch (_) { /* ignore */ }
      if (settingsState?.matchesShortcut?.('redoAnnotation', e)) {
        e.preventDefault();
        handleRedoAnnotation();
      } else if (settingsState?.matchesShortcut?.('undoAnnotation', e)) {
        e.preventDefault();
        handleUndoAnnotation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAnnotationActive, handleUndoAnnotation, handleRedoAnnotation]);

  // پیش‌دیکودر غیرمسدودکننده در زمان بیکاری ترد اصلی
  useEffect(() => {
    if (!items || itemsCount === 0) return;

    let isCancelled = false;
    const activeImages = [];

    const timerId = setTimeout(() => {
      if (isCancelled) return;

      const lastVisible =
        visibleIndices.length > 0
          ? visibleIndices[visibleIndices.length - 1]
          : activePageIndex;

      const targets = [lastVisible + 1, lastVisible + 2].filter(
        (idx) => idx >= 0 && idx < itemsCount
      );

      targets.forEach((idx) => {
        const item = items[idx];
        const rawPath = item?.path || item?.filePath;
        if (!rawPath) return;

        const url = buildComicImageUrl(rawPath);
        if (!url || predecodedMapRef.current.has(url)) return;

        predecodedMapRef.current.set(url, idx);

        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        activeImages.push(img);

        img.onload = () => {
          if (isCancelled) return;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            recordImageDimensions(idx, img.naturalWidth, img.naturalHeight);
          }
          if (typeof img.decode === 'function') {
            img.decode().catch(() => {});
          }
        };
      });
      // پاک‌سازیِ کشِ پیش‌دیکود در پیمایش‌های طولانی: Setِ قبلی،
      // هرگز خالی نمی‌شد و در کمیک‌های چندصد صفحه‌ای تا پایانِ فایل
      // رشد می‌کرد. حالا فقط URLهای نزدیکِ پنجرهٔ مرئی (±۴ صفحه)
      // نگه داشته می‌شوند و سقفِ سخت، ۴۸ ورودی است (دورترین‌ها اول
      // حذف می‌شوند). حذف از Map، فقط به‌معنای «دیکودِ دوباره در
      // بازگشت» است؛ خودِ تصویر در کشِ مرورگر می‌ماند و چیزی از
      // صفحه پاک نمی‌شود. شی‌های Imageی هر دور هم از قبل با
      // onload=null و src='' آزاد می‌شدند و همان‌طور مانده‌اند.
      const firstVisible = visibleIndices.length > 0 ? visibleIndices[0] : activePageIndex;
      for (const [cachedUrl, cachedIdx] of predecodedMapRef.current) {
        if (cachedIdx < firstVisible - 4 || cachedIdx > lastVisible + 4) {
          predecodedMapRef.current.delete(cachedUrl);
        }
      }
      if (predecodedMapRef.current.size > 48) {
        const windowCenter = (firstVisible + lastVisible) / 2;
        const sorted = [...predecodedMapRef.current.entries()].sort(
          (a, b) => Math.abs(a[1] - windowCenter) - Math.abs(b[1] - windowCenter)
        );
        for (const [cachedUrl] of sorted.slice(48)) predecodedMapRef.current.delete(cachedUrl);
      }
    }, 120);

    return () => {
      isCancelled = true;
      clearTimeout(timerId);
      activeImages.forEach((img) => {
        img.onload = null;
        img.src = '';
      });
    };
  }, [activePageIndex, visibleIndices, items, itemsCount, recordImageDimensions]);

  useEffect(() => {
    predecodedMapRef.current.clear();
  }, [currentFilePath]);

  // مرحله ۶ ـ بخش الف: نشستِ آمارِ مطالعه برای فایلِ جاری؛ با
  // عوض‌شدنِ فایل یا بسته‌شدنِ ریدر، نشست پایان می‌یابد و
  // باقی‌ماندهٔ گزارش‌ها فرستاده می‌شوند.
  useEffect(() => {
    if (!currentFilePath) return undefined;
    readingActivity.begin(currentFilePath);
    return () => {
      readingActivity.end();
    };
  }, [currentFilePath]);

  // ۴. مدیریت هوشمند زوم با چرخ ماوس (Ctrl + Wheel تا سقف 3.5x) — مرحله ۶:
  // نسخهٔ قبلی، شنوندهٔ wheel را فقط وقتی Ctrl نگه داشته شده بود
  // وصل می‌کرد؛ ژستِ Pinchِ ترک‌پد، keydownِ Control نمی‌فرستد و
  // چرخِ ماوس وقتی Ctrl از قبل نگه داشته شده بود هم شنونده را نداشت.
  // حالا شنونده همیشه وصل است و ctrlKey/metaKey داخلِ هندلر بررسی
  // می‌شود. زوم، ضربی و نرم است تا ژستِ پیوستهٔ دو انگشتی روان حس شود.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // مرحله ۶ ـ بخش ب: تجمیعِ رویدادهای wheel در یک فریم با
    // requestAnimationFrame — مانند PdfViewer: دلتاهای یک فریم جمع
    // و فقط یک setZoomLevel اعمال می‌شود تا سیلِ ۶۰ تا ۱۲۰ رویدادِ
    // ترک‌پد در ثانیه، استیت را در هر رویداد تکان ندهد.
    let pendingWheel = null;

    const handleWheelZoom = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();

      const deltaY = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (pendingWheel) {
        pendingWheel.accDeltaY += deltaY;
        pendingWheel.clientY = e.clientY;
        return;
      }
      pendingWheel = { accDeltaY: deltaY, clientY: e.clientY, rafId: 0 };
      pendingWheel.rafId = requestAnimationFrame(() => {
        const pending = pendingWheel;
        pendingWheel = null;
        if (!pending) return;
        const factor = Math.min(1.12, Math.max(0.89, Math.exp(-pending.accDeltaY * 0.0018)));
        const currentZoom = useReaderStore.getState().zoomLevel || 1.0;
        const nextZoom = Math.min(
          3.5,
          Math.max(0.4, parseFloat((currentZoom * factor).toFixed(2)))
        );

        if (nextZoom !== currentZoom) {
          const rect = container.getBoundingClientRect();
          const mouseY = pending.clientY - rect.top;
          const scrollY = container.scrollTop;
          const scrollFactor = nextZoom / currentZoom;

          setZoomLevel(nextZoom);
          container.scrollTop = (scrollY + mouseY) * scrollFactor - mouseY;
        }
      });
    };

    container.addEventListener('wheel', handleWheelZoom, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelZoom);
      if (pendingWheel && pendingWheel.rafId) cancelAnimationFrame(pendingWheel.rafId);
      pendingWheel = null;
    };
  }, [setZoomLevel]);

  // ۵. پرش اولیه پایدار بر مبنای آخرین صفحه خوانده‌شده
  useEffect(() => {
    let isMounted = true;
    hasResumedRef.current = false;
    isResumingRef.current = true;

    if (!currentFilePath) {
      isResumingRef.current = false;
      hasResumedRef.current = true;
      return;
    }

    const initPagePosition = async () => {
      try {
        const initialStorePage =
          comicData?.savedResumePage || useReaderStore.getState().currentPage;
        let targetToJump =
          initialStorePage && initialStorePage > 1 ? initialStorePage : null;

        if (!targetToJump) {
          const timeoutGuard = new Promise((resolve) =>
            setTimeout(() => resolve(null), 300)
          );
          const result = await Promise.race([
            coreApi.dbAction({
              action: 'GET_PROGRESS',
              payload: { filePath: currentFilePath },
            }),
            timeoutGuard,
          ]);

          if (result?.progress?.currentPage) {
            targetToJump = Number(result.progress.currentPage);
          }
        }

        if (!isMounted) return;

        if (targetToJump && targetToJump > 1 && targetToJump <= itemsCount) {
          requestAnimationFrame(() => {
            if (isMounted) {
              scrollToIndex(targetToJump - 1, 'auto');
              setCurrentPage(targetToJump);
              readingActivity.visitPage(targetToJump);

              setTimeout(() => {
                if (isMounted) {
                  scrollToIndex(targetToJump - 1, 'auto');
                  hasResumedRef.current = true;
                  isResumingRef.current = false;
                }
              }, 80);
            }
          });
        } else {
          hasResumedRef.current = true;
          isResumingRef.current = false;
        }
      } catch (err) {
        console.error('Error in VerticalViewer resume:', err);
        hasResumedRef.current = true;
        isResumingRef.current = false;
      }
    };

    initPagePosition();

    return () => {
      isMounted = false;
      hasResumedRef.current = false;
      isResumingRef.current = false;
    };
  }, [
    currentFilePath,
    itemsCount,
    comicData?.savedResumePage,
    scrollToIndex,
    setCurrentPage,
  ]);

  // ۶. پرش دستی به صفحه هدف انتخاب‌شده توسط کاربر
  useEffect(() => {
    if (targetPage !== null && targetPage >= 1 && targetPage <= itemsCount) {
      scrollToIndex(targetPage - 1, 'smooth');
      clearTargetPage();
    }
  }, [targetPage, itemsCount, clearTargetPage, scrollToIndex]);

  // ۷. همگام‌سازی شماره صفحه بدون سابسکرایب رندرر به currentPage
  useEffect(() => {
    if (isJumping.current || isResumingRef.current || !hasResumedRef.current) return;

    const calculatedPage = activePageIndex + 1;
    const storeCurrentPage = useReaderStore.getState().currentPage;

    if (
      calculatedPage !== storeCurrentPage &&
      calculatedPage >= 1 &&
      calculatedPage <= itemsCount
    ) {
      setCurrentPage(calculatedPage);
      readingActivity.visitPage(calculatedPage);

      if (currentFilePath) {
        updateReadingProgress(currentFilePath, calculatedPage, itemsCount);
      }
    }
  }, [
    activePageIndex,
    isJumping,
    itemsCount,
    currentFilePath,
    setCurrentPage,
    updateReadingProgress,
  ]);

  const handleFrameContextMenu = useCallback(
    (e, index, path) => {
      handleContextMenu(e, {
        pageIndex: index,
        imagePath: path,
        comic: comicData,
      });
    },
    [handleContextMenu, comicData]
  );

  if (!comicData || !comicData.items) return null;

  const activePageNum = activePageIndex + 1;
  const currentActivePageAnnotations =
    annotationsByPage[String(activePageNum)] || [];
  const enableHiDpiCrispPass = isScrollIdle && safeZoom > 1.12;

  return (
    <div style={styles.outerWrapper}>
      {/* فیلتر سخت‌افزاری SVG برای افزایش وضوح خطوط و متون کمیک در زوم‌های بالا (Pass 2) */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          <filter id="comic-hidpi-sharpen">
            <feConvolveMatrix
              order="3"
              preserveAlpha="true"
              kernelMatrix="0 -0.18 0 -0.18 1.72 -0.18 0 -0.18 0"
            />
          </filter>
        </defs>
      </svg>

      {/* نوار ابزار استودیو ویرایش (فقط هنگام فعال شدن از TopBar نمایش داده می‌شود) */}
      <AnnotationToolbar
        activePage={activePageNum}
        pageItemCount={currentActivePageAnnotations.length}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndoAnnotation}
        onRedo={handleRedoAnnotation}
        onClearPage={handleClearCurrentPageAnnotations}
      />

      <div
        ref={containerRef}
        data-reader-scroll-container="true"
        style={{
          ...styles.scrollContainer,
          pointerEvents: isSnippingActive || isAreaZoomActive ? 'none' : 'auto',
        }}
        onContextMenu={(e) => {
          if (!e.target.closest('.comic-page-item')) {
            const safeIndex = Math.max(0, Math.min(activePageIndex, itemsCount - 1));
            handleContextMenu(e, {
              pageIndex: safeIndex,
              imagePath: comicData.items[safeIndex]?.path,
              comic: comicData,
            });
          }
        }}
      >
        <div
          style={{
            width: `${Math.round(safeZoom * 100)}%`,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: safePageGap === 0 ? '#000000' : 'transparent',
          }}
        >
          <div style={{ height: `${paddingTop}px`, width: '100%', flexShrink: 0 }} />

          {visibleIndices.map((index) => {
            const item = comicData.items[index];
            if (!item) return null;
            const pageNum = index + 1;
            const pageAnnots = annotationsByPage[String(pageNum)] || EMPTY_PAGE_ANNOTATIONS;
            const isNearCenter = Math.abs(index - activePageIndex) <= 1;

            return (
              <ComicPageFrame
                key={
                  item.path
                    ? `frame-${index}-${item.path}`
                    : `frame-${index}-${hiDpiRenderTick}`
                }
                item={item}
                index={index}
                isLastItem={index === itemsCount - 1}
                knownHeight={heights ? heights[index] : null}
                frameWidth={frameWidth}
                pageGap={safePageGap}
                rotation={rotation}
                isHiDpiPassActive={enableHiDpiCrispPass && isNearCenter}
                isNearViewport={isNearCenter}
                isSharpenFilterActive={enableHiDpiCrispPass && isNearCenter && safeZoom <= 1.5 && !isAnnotationActive}
                pageAnnotations={pageAnnots}
                onCommitPageAnnotations={handleCommitPageAnnotations}
                pageFilter={pageFilter}
                onImageLoad={recordImageDimensions}
                onContextMenu={handleFrameContextMenu}
              />
            );
          })}

          <div
            style={{ height: `${paddingBottom}px`, width: '100%', flexShrink: 0 }}
          />
        </div>
      </div>
    </div>
  );
}

const styles = {
  outerWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  scrollContainer: {
    width: '100%',
    height: '100%',
    overflowY: 'auto',
    overflowX: 'auto',
    padding: '0',
    position: 'relative',
    userSelect: 'none',
    direction: 'ltr',
    overflowAnchor: 'none',
  },
  imageWrapper: {
    width: '100%',
    display: 'block',
    marginTop: '0',
    marginLeft: '0',
    marginRight: '0',
    padding: '0',
    backgroundColor: 'transparent',
    borderRadius: '0',
    lineHeight: 0,
    fontSize: 0,
    position: 'relative',
    boxSizing: 'border-box',
  },
  image: {
    width: '100%',
    display: 'block',
    margin: '0',
    padding: '0',
    borderRadius: '0',
    boxShadow: 'none',
    userSelect: 'none',
    WebkitUserDrag: 'none',
    imageRendering: 'high-quality',
  },
  errorPlaceholder: {
    width: '100%',
    height: '380px',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: 'var(--border)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
  },
  errorText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--muted)',
    direction: 'rtl',
  },
  retryBtn: {
    padding: '6px 14px',
    borderRadius: '8px',
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};