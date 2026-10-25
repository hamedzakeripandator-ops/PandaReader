import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useVirtualScroll from '../../hooks/useVirtualScroll';
import useContextMenu from '../../hooks/useContextMenu';
import { coreApi } from '../../services/coreApi';
import Icons from '../common/Icons';
import AnnotationLayer from './AnnotationLayer';
import AnnotationToolbar from './AnnotationToolbar';

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
const ComicPageFrame = React.memo(function ComicPageFrame({
  item,
  index,
  isLastItem,
  knownHeight,
  pageGap,
  rotation,
  isHiDpiPassActive,
  pageAnnotations,
  onCommitPageAnnotations,
  onImageLoad,
  onContextMenu,
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
      {imgSrc && !hasError ? (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            transform: rotation ? `rotate(${rotation}deg)` : 'none',
          }}
        >
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
              filter: isHiDpiPassActive ? 'url(#comic-hidpi-sharpen)' : 'none',
              transform: isHiDpiPassActive ? 'translateZ(0)' : 'none',
            }}
            onLoad={handleLoad}
            onError={handleImgError}
          />

          {/* لایه تعاملی استودیو ویرایش روی صفحات کمیک */}
          <AnnotationLayer
            pageNumber={pageNum}
            items={pageAnnotations}
            onCommitPageItems={onCommitPageAnnotations}
          />
        </div>
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
  const hasResumedRef = useRef(false);
  const isResumingRef = useRef(false);
  const predecodedSetRef = useRef(new Set());
  const scrollIdleTimerRef = useRef(null);

  const items = comicData?.items || [];
  const itemsCount = items.length;
  const currentFilePath = comicData?.filePath;

  const safeZoom = Math.min(3.5, Math.max(0.4, Number(zoomLevel) || 1));
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

    if (!currentFilePath || !coreApi.isAvailable()) return;

    coreApi
      .dbAction({
        action: 'GET_ANNOTATIONS',
        payload: { filePath: currentFilePath },
      })
      .then((res) => {
        if (isMounted && res?.annotations && typeof res.annotations === 'object') {
          setAnnotationsByPage(res.annotations);
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
      return prevRedo.slice(0, -1);
    });
  }, [currentFilePath]);

  const handleClearCurrentPageAnnotations = useCallback(() => {
    const pageNum = activePageIndex + 1;
    handleCommitPageAnnotations(pageNum, []);
    showToast(`یادداشت‌های صفحه ${pageNum} پاک شد`, { type: 'info' });
  }, [activePageIndex, handleCommitPageAnnotations, showToast]);

  useEffect(() => {
    if (!isAnnotationActive) return;
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedoAnnotation();
        } else {
          e.preventDefault();
          handleUndoAnnotation();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedoAnnotation();
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
        if (!url || predecodedSetRef.current.has(url)) return;

        predecodedSetRef.current.add(url);

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
    predecodedSetRef.current.clear();
  }, [currentFilePath]);

  // ۴. مدیریت هوشمند زوم با چرخ ماوس (Ctrl + Wheel تا سقف 3.5x)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let isWheelListenerAttached = false;

    const handleWheelZoom = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      const currentZoom = useReaderStore.getState().zoomLevel || 1.0;
      const nextZoom = Math.min(
        3.5,
        Math.max(0.4, parseFloat((currentZoom + delta).toFixed(2)))
      );

      if (nextZoom !== currentZoom) {
        const rect = container.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const scrollY = container.scrollTop;
        const factor = nextZoom / currentZoom;

        setZoomLevel(nextZoom);

        requestAnimationFrame(() => {
          container.scrollTop = (scrollY + mouseY) * factor - mouseY;
        });
      }
    };

    const attachNonPassiveWheel = () => {
      if (!isWheelListenerAttached && containerRef.current) {
        containerRef.current.addEventListener('wheel', handleWheelZoom, {
          passive: false,
        });
        isWheelListenerAttached = true;
      }
    };

    const detachNonPassiveWheel = () => {
      if (isWheelListenerAttached && containerRef.current) {
        containerRef.current.removeEventListener('wheel', handleWheelZoom);
        isWheelListenerAttached = false;
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Control' || e.key === 'Meta' || e.ctrlKey || e.metaKey) {
        attachNonPassiveWheel();
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Control' || e.key === 'Meta' || (!e.ctrlKey && !e.metaKey)) {
        detachNonPassiveWheel();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: true });
    window.addEventListener('keyup', handleKeyUp, { passive: true });
    window.addEventListener('blur', detachNonPassiveWheel, { passive: true });

    return () => {
      detachNonPassiveWheel();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', detachNonPassiveWheel);
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
            const pageAnnots = annotationsByPage[String(pageNum)] || [];
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
                pageGap={safePageGap}
                rotation={rotation}
                isHiDpiPassActive={enableHiDpiCrispPass && isNearCenter}
                pageAnnotations={pageAnnots}
                onCommitPageAnnotations={handleCommitPageAnnotations}
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