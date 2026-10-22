import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

/**
 * هوک فوق‌بهینه اسکرول مجازی مجهز به ابعاد پیش‌استخراج‌شده بک‌اند و پشتیبانی از فاصله صفحات (pageGap)
 * ۱. استفاده مستقیم از aspectRatio استخراج‌شده در بک‌اند جهت حذف کامل پرش اسکرول (Layout Shift)
 * ۲. پشتیبانی دقیق ریاضی از فاصله صفحات (0px بدون درز برای کمیک و متغیر برای حالت دلخواه)
 * ۳. الگوریتم جستجوی دودویی O(log N) و صفر بار Re-render در پیکسل‌های میانی اسکرول
 */
export default function useVirtualScroll({
  items = [],
  itemsCount = 0,
  containerRef,
  estimatedItemHeight = 1200,
  overscan = 3,
  zoomLevel = 1,
  pageGap = 0,
  filePath = '',
}) {
  const aspectRatiosRef = useRef(new Map());
  const [measurementTick, setMeasurementTick] = useState(0);
  const [containerHeight, setContainerHeight] = useState(900);
  const [containerWidth, setContainerWidth] = useState(900);

  const containerWidthRef = useRef(900);
  const containerHeightRef = useRef(900);

  const [rangeState, setRangeState] = useState({
    startIndex: 0,
    endIndex: Math.max(0, Math.min(itemsCount - 1, overscan * 2)),
    activeIndex: 0,
  });

  const scrollTopRef = useRef(0);
  const rangeStateRef = useRef(rangeState);
  rangeStateRef.current = rangeState;

  const prevZoomRef = useRef(zoomLevel);
  const isJumpingRef = useRef(false);
  const jumpTimerRef = useRef(null);
  const batchTickTimerRef = useRef(null);
  const pendingScrollDeltaRef = useRef(0);

  const safeGap = Math.max(0, Math.round(Number(pageGap) || 0));

  // ۱. محاسبه آفست‌ها و ارتفاع کل با تطابق ۱۰۰٪ با عرض CSS و فاصله صفحات (pageGap)
  const { offsets, heights, totalHeight } = useMemo(() => {
    if (itemsCount <= 0) {
      return { offsets: [], heights: [], totalHeight: 0 };
    }

    const offs = new Array(itemsCount);
    const hts = new Array(itemsCount);
    let currentOffset = 0;

    const baseWidth =
      containerWidth > 0 ? containerWidth : containerWidthRef.current || 900;
    const safeZoom = Math.max(0.3, zoomLevel);
    const zoomPercentFactor = Math.round(safeZoom * 100) / 100;
    const effectiveWidth = baseWidth * zoomPercentFactor;
    const fallbackHeight = Math.round(estimatedItemHeight * zoomPercentFactor);

    for (let i = 0; i < itemsCount; i++) {
      offs[i] = currentOffset;

      let ratio = aspectRatiosRef.current.get(i);
      if (!ratio && items && items[i]) {
        const item = items[i];
        if (item.aspectRatio && item.aspectRatio > 0) {
          ratio = item.aspectRatio;
          aspectRatiosRef.current.set(i, ratio);
        } else if (item.width > 0 && item.height > 0) {
          ratio = item.height / item.width;
          aspectRatiosRef.current.set(i, ratio);
        }
      }

      const itemHeight = ratio
        ? Math.max(40, Math.round(effectiveWidth * ratio))
        : fallbackHeight;
      hts[i] = itemHeight;
      currentOffset += itemHeight + (i < itemsCount - 1 ? safeGap : 0);
    }

    return { offsets: offs, heights: hts, totalHeight: currentOffset };
  }, [
    items,
    itemsCount,
    zoomLevel,
    safeGap,
    estimatedItemHeight,
    containerWidth,
    measurementTick,
  ]);

  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;
  const heightsRef = useRef(heights);
  heightsRef.current = heights;

  // ۲. الگوریتم جستجوی دودویی O(log N) برای تعیین دامنه صفحات مرئی و صفحه فعال
  const computeAndCommitRange = useCallback(
    (currentScrollTop, viewHeight) => {
      if (itemsCount <= 0) return;

      const offs = offsetsRef.current;
      const hts = heightsRef.current;
      if (!offs || offs.length === 0) return;

      const vh = viewHeight || containerHeightRef.current || 900;

      let low = 0;
      let high = itemsCount - 1;
      let startIndex = 0;

      while (low <= high) {
        const mid = (low + high) >>> 1;
        const itemBottom =
          (offs[mid] || 0) + (hts[mid] || estimatedItemHeight) + safeGap;
        if (itemBottom < currentScrollTop) {
          low = mid + 1;
        } else {
          startIndex = mid;
          high = mid - 1;
        }
      }

      let endIndex = startIndex;
      const viewportBottom = currentScrollTop + vh;
      while (endIndex < itemsCount - 1 && (offs[endIndex] || 0) < viewportBottom) {
        endIndex++;
      }

      const safeStartIndex = Math.max(0, startIndex - overscan);
      const safeEndIndex = Math.min(itemsCount - 1, endIndex + overscan);

      const viewportCenter = currentScrollTop + vh / 2;
      let activeIndex = startIndex;
      if (viewportCenter >= (offs[itemsCount - 1] || 0)) {
        activeIndex = itemsCount - 1;
      } else {
        const searchStart = Math.max(0, startIndex - 1);
        const searchEnd = Math.min(itemsCount - 1, endIndex + 1);
        for (let i = searchStart; i <= searchEnd; i++) {
          const top = offs[i] || 0;
          const bottom = top + (hts[i] || estimatedItemHeight) + safeGap;
          if (viewportCenter >= top && viewportCenter <= bottom) {
            activeIndex = i;
            break;
          }
        }
      }

      const prev = rangeStateRef.current;
      if (
        prev.startIndex !== safeStartIndex ||
        prev.endIndex !== safeEndIndex ||
        prev.activeIndex !== activeIndex
      ) {
        const nextRange = {
          startIndex: safeStartIndex,
          endIndex: safeEndIndex,
          activeIndex,
        };
        rangeStateRef.current = nextRange;
        setRangeState(nextRange);
      }
    },
    [itemsCount, overscan, estimatedItemHeight, safeGap]
  );

  // ریست کامل وضعیت هنگام تعویض کمیک
  useEffect(() => {
    if (batchTickTimerRef.current) {
      cancelAnimationFrame(batchTickTimerRef.current);
      batchTickTimerRef.current = null;
    }
    pendingScrollDeltaRef.current = 0;
    aspectRatiosRef.current.clear();

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it?.aspectRatio > 0) {
          aspectRatiosRef.current.set(i, it.aspectRatio);
        } else if (it?.width > 0 && it?.height > 0) {
          aspectRatiosRef.current.set(i, it.height / it.width);
        }
      }
    }

    scrollTopRef.current = 0;
    const initialRange = {
      startIndex: 0,
      endIndex: Math.max(0, Math.min(itemsCount - 1, overscan * 2)),
      activeIndex: 0,
    };
    rangeStateRef.current = initialRange;
    setRangeState(initialRange);

    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [filePath, items, itemsCount, overscan, containerRef]);

  useEffect(() => {
    computeAndCommitRange(scrollTopRef.current, containerHeight);
  }, [offsets, containerHeight, computeAndCommitRange]);

  // ۳. ثبت دقیق ابعاد تصویر با دقت ۰.۰۰۰05 جهت حذف کامل شکاف‌های ۱ تا ۱۰ پیکسلی
  const recordImageDimensions = useCallback(
    (index, naturalWidth, naturalHeight) => {
      if (!naturalWidth || !naturalHeight || naturalWidth <= 0 || naturalHeight <= 0) {
        return;
      }
      const ratio = naturalHeight / naturalWidth;
      const oldRatio = aspectRatiosRef.current.get(index);

      if (oldRatio && Math.abs(oldRatio - ratio) <= 0.00005) {
        return;
      }

      aspectRatiosRef.current.set(index, ratio);

      const baseWidth = containerWidthRef.current || 900;
      const safeZoom = Math.max(0.3, zoomLevel);
      const zoomPercentFactor = Math.round(safeZoom * 100) / 100;
      const effectiveWidth = baseWidth * zoomPercentFactor;

      const oldHeight = oldRatio
        ? Math.round(effectiveWidth * oldRatio)
        : Math.round(estimatedItemHeight * zoomPercentFactor);
      const newHeight = Math.round(effectiveWidth * ratio);
      const delta = newHeight - oldHeight;

      const itemTop = offsetsRef.current[index] || 0;
      if (itemTop + oldHeight < scrollTopRef.current && Math.abs(delta) >= 1) {
        pendingScrollDeltaRef.current += delta;
      }

      if (!batchTickTimerRef.current) {
        batchTickTimerRef.current = requestAnimationFrame(() => {
          batchTickTimerRef.current = null;
          if (pendingScrollDeltaRef.current !== 0 && containerRef.current) {
            containerRef.current.scrollTop += pendingScrollDeltaRef.current;
            scrollTopRef.current = containerRef.current.scrollTop;
            pendingScrollDeltaRef.current = 0;
          }
          setMeasurementTick((t) => (t + 1) % 100000);
        });
      }
    },
    [zoomLevel, estimatedItemHeight, containerRef]
  );

  // ۴. حفظ کانون دید حین تغییر زوم
  useEffect(() => {
    const container = containerRef.current;
    const prev = prevZoomRef.current;

    if (!container || prev === zoomLevel || prev <= 0) {
      prevZoomRef.current = zoomLevel;
      return;
    }

    const factor = zoomLevel / prev;
    const ch = containerHeightRef.current || container.clientHeight || 900;
    const center = scrollTopRef.current + ch / 2;
    const newScrollTop = Math.max(0, center * factor - ch / 2);

    container.scrollTop = newScrollTop;
    scrollTopRef.current = newScrollTop;
    prevZoomRef.current = zoomLevel;
    computeAndCommitRange(newScrollTop, ch);
  }, [zoomLevel, containerRef, computeAndCommitRange]);

  // ۵. شنونده اسکرول Passive و ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const initialH = container.clientHeight || 900;
    const initialW = container.clientWidth || 900;
    containerHeightRef.current = initialH;
    containerWidthRef.current = initialW;
    setContainerHeight(initialH);
    setContainerWidth(initialW);

    let rafId = null;

    const handleScroll = () => {
      scrollTopRef.current = container.scrollTop;
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          computeAndCommitRange(scrollTopRef.current, containerHeightRef.current);
        });
      }
    };

    const updateDimensions = (w, h) => {
      const nextW = Math.round(w || container.clientWidth || 900);
      const nextH = Math.round(h || container.clientHeight || 900);
      let changed = false;

      if (Math.abs(nextW - containerWidthRef.current) >= 1) {
        containerWidthRef.current = nextW;
        setContainerWidth(nextW);
        changed = true;
      }
      if (Math.abs(nextH - containerHeightRef.current) >= 1) {
        containerHeightRef.current = nextH;
        setContainerHeight(nextH);
        changed = true;
      }
      if (changed) {
        computeAndCommitRange(scrollTopRef.current, nextH);
      }
    };

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const cr = entry.contentRect;
          updateDimensions(cr.width, cr.height);
        }
      });
      resizeObserver.observe(container);
    }

    const handleWindowResize = () => {
      updateDimensions(container.clientWidth, container.clientHeight);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleWindowResize, { passive: true });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (batchTickTimerRef.current) cancelAnimationFrame(batchTickTimerRef.current);
      if (resizeObserver) resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [containerRef, computeAndCommitRange]);

  // ۶. ساخت آرایه فریم‌های مرئی و محاسبه دقیق پدینگ‌های بالا و پایین با احتساب safeGap
  const { visibleIndices, paddingTop, paddingBottom } = useMemo(() => {
    if (itemsCount <= 0) {
      return { visibleIndices: [], paddingTop: 0, paddingBottom: 0 };
    }

    const safeStart = Math.max(0, Math.min(itemsCount - 1, rangeState.startIndex));
    const safeEnd = Math.max(safeStart, Math.min(itemsCount - 1, rangeState.endIndex));

    const indices = [];
    for (let i = safeStart; i <= safeEnd; i++) {
      indices.push(i);
    }

    const pTop = offsets[safeStart] || 0;
    const bottomOffset =
      (offsets[safeStart !== undefined ? safeEnd : 0] || 0) +
      (heights[safeEnd] || 0) +
      (safeEnd < itemsCount - 1 ? safeGap : 0);
    const pBottom = Math.max(0, totalHeight - bottomOffset);

    return {
      visibleIndices: indices,
      paddingTop: pTop,
      paddingBottom: pBottom,
    };
  }, [
    itemsCount,
    rangeState.startIndex,
    rangeState.endIndex,
    offsets,
    heights,
    totalHeight,
    safeGap,
  ]);

  // ۷. پرش بدون لرزش به صفحه هدف
  const scrollToIndex = useCallback(
    (index, behavior = 'smooth') => {
      const container = containerRef.current;
      if (!container || index < 0 || index >= itemsCount) return;

      isJumpingRef.current = true;
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);

      const targetOffset = offsetsRef.current[index] || 0;
      scrollTopRef.current = targetOffset;

      computeAndCommitRange(targetOffset, containerHeightRef.current);

      container.scrollTo({
        top: targetOffset,
        behavior,
      });

      const jumpDuration = behavior === 'smooth' ? 650 : 80;
      jumpTimerRef.current = setTimeout(() => {
        isJumpingRef.current = false;
        jumpTimerRef.current = null;
        if (containerRef.current) {
          scrollTopRef.current = containerRef.current.scrollTop;
          computeAndCommitRange(scrollTopRef.current, containerHeightRef.current);
        }
      }, jumpDuration);
    },
    [containerRef, itemsCount, computeAndCommitRange]
  );

  useEffect(() => {
    return () => {
      if (jumpTimerRef.current) clearTimeout(jumpTimerRef.current);
      if (batchTickTimerRef.current) cancelAnimationFrame(batchTickTimerRef.current);
    };
  }, []);

  return {
    visibleIndices,
    paddingTop,
    paddingBottom,
    heights,
    recordImageDimensions,
    scrollToIndex,
    activePageIndex: rangeState.activeIndex,
    isJumping: isJumpingRef,
  };
}