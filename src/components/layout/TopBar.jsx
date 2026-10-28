import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { coreApi } from '../../services/coreApi';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useReaderStore from '../../store/useReaderStore';
import useSettingsStore from '../../store/useSettingsStore';
import Icons from '../common/Icons';

function parsePageJumpQuery(rawQuery, totalPages) {
  if (!rawQuery || !totalPages || totalPages < 1) return null;
  const normalized = rawQuery
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .trim();

  const match = normalized.match(/^(?:ص|صفحه|p|page)?\s*(\d+)$/i);
  if (!match) return null;

  const num = parseInt(match[1], 10);
  return num >= 1 && num <= totalPages ? num : null;
}

export default function TopBar({
  onOpenClick,
  onOpenComic,
  isReaderActive = false,
  onMouseEnter,
  onMouseLeave,
}) {
  const currentView = useAppStore((state) => state.currentView);
  const searchQuery = useAppStore((state) => state.searchQuery);
  const setSearchQuery = useAppStore((state) => state.setSearchQuery);
  const clearSearch = useAppStore((state) => state.clearSearch);
  const isSearchFocused = useAppStore((state) => state.isSearchFocused);
  const setIsSearchFocused = useAppStore((state) => state.setIsSearchFocused);
  const openQuickSettings = useAppStore((state) => state.openQuickSettings);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const showToast = useAppStore((state) => state.showToast);

  // مرحله ۳ ـ بخش الف: وضعیتِ هر دو پنلِ کناری — مبنای قانونِ
  // انحصارِ متقابل (تا وقتی یکی باز است، TopBar نباید باز شود).
  const isLeftSidebarOpen = useAppStore((state) => Boolean(state.isLeftSidebarOpen));
  const isRightSidebarOpen = useAppStore((state) => Boolean(state.isRightSidebarOpen));
  const isSidePanelOpen = Boolean(isLeftSidebarOpen || isRightSidebarOpen);

  const isAnnotationActive = useAppStore((state) => Boolean(state.isAnnotationActive));
  const toggleAnnotationMode = useAppStore((state) => state.toggleAnnotationMode);
  const isAreaZoomActive = useAppStore((state) => Boolean(state.isAreaZoomActive));
  const toggleAreaZoom = useAppStore((state) => state.toggleAreaZoom);

  const hasComic = useReaderStore((state) => Boolean(state.comicData));
  const currentFilePath = useReaderStore((state) => state.comicData?.filePath || '');
  const totalPages = useReaderStore(
    (state) => state.comicData?.items?.length || state.comicData?.savedTotalPages || 0
  );
  const jumpToPage = useReaderStore((state) => state.jumpToPage);
  const setTargetPage = useReaderStore((state) => state.setTargetPage);
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);

  const shortcuts = useSettingsStore((state) => state.shortcuts);

  const [closeHover, setCloseHover] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [showBar, setShowBar] = useState(true);

  const headerRef = useRef(null);
  const searchContainerRef = useRef(null);
  const searchBarRef = useRef(null);
  const inputRef = useRef(null);

  const hideTimerRef = useRef(null);
  const isBarHoveredRef = useRef(false);
  const showBarRef = useRef(true);
  const pointerDownRef = useRef({ x: 0, y: 0, time: 0 });

  const effectiveReaderMode = Boolean(isReaderActive || (currentView === 'reader' && hasComic));

  const searchShortcutLabel = shortcuts?.focusSearch?.label || 'Ctrl + F';
  const openFileShortcutLabel = shortcuts?.openFile?.label || 'Ctrl + O';

  const updateShowBar = useCallback((nextVal) => {
    showBarRef.current = nextVal;
    setShowBar(nextVal);
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  // سپر محافظتی: خنثی‌سازی هر المان نامرئی بیرونی که روی کادر سرچ افتاده و کرسر را به pointer تغییر می‌دهد
  const releaseOverlappingBlockers = useCallback(() => {
    const barEl = searchBarRef.current;
    const hdrEl = headerRef.current;
    if (!barEl || !hdrEl) return;

    const appState = useAppStore.getState();
    if (
      appState.isContextMenuOpen ||
      appState.isQuickSettingsOpen ||
      appState.isSnippingActive ||
      appState.isAreaZoomActive
    ) {
      return;
    }

    const rect = barEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const midY = rect.top + rect.height / 2;
    const sampleRatios = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 0.92];

    sampleRatios.forEach((ratio) => {
      const sampleX = rect.left + rect.width * ratio;
      const hitElements = document.elementsFromPoint(sampleX, midY);

      for (const el of hitElements) {
        if (el === hdrEl || hdrEl.contains(el)) {
          break; // به خود TopBar رسیدیم؛ هیچ مانعی بالاتر از آن نیست
        }
        if (
          el.id === 'custom-context-menu' ||
          el.closest?.('#custom-context-menu') ||
          el === document.body ||
          el === document.documentElement
        ) {
          continue;
        }
        // خنثی کردن لایه مزاحمی که روی سرچ‌باکس افتاده است
        el.style.pointerEvents = 'none';
      }
    });
  }, []);

  const scheduleAutoHide = useCallback(
    (delayMs = 1600) => {
      clearHideTimer();
      hideTimerRef.current = setTimeout(() => {
        const appState = useAppStore.getState();
        const isInputActive =
          appState.isSearchFocused ||
          document.activeElement === inputRef.current ||
          Boolean(appState.searchQuery?.trim());

        if (!isBarHoveredRef.current && !isInputActive) {
          updateShowBar(false);
        }
        hideTimerRef.current = null;
      }, delayMs);
    },
    [clearHideTimer, updateShowBar]
  );

  // ۱. اجرای اسکن محافظتی کادر سرچ و مدیریت اتوهاید اولیه در ورود به ریدر
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      releaseOverlappingBlockers();
    });

    if (!effectiveReaderMode) {
      clearHideTimer();
      updateShowBar(true);
      return () => cancelAnimationFrame(raf);
    }

    updateShowBar(true);
    scheduleAutoHide(1100);

    return () => {
      cancelAnimationFrame(raf);
      clearHideTimer();
    };
  }, [
    effectiveReaderMode,
    currentFilePath,
    clearHideTimer,
    updateShowBar,
    scheduleAutoHide,
    releaseOverlappingBlockers,
  ]);

  // مرحله ۳ ـ بخش ب: انحصارِ متقابل فقط در حالتِ خواندن.
  // بررسیِ هندسی نشان داد در حالتِ غیرخواندن، Sidebar داخلِ
  // mainLayout و زیرِ نوار است و RightPanel اصلاً رندر نمی‌شود؛ پس
  // پنلی تا لبهٔ بالای پنجره نمی‌آید و دلیلی برای مخفی کردنِ نوار
  // نیست. معافیتِ غیرخواندن، هم پرشِ ۴۸ پیکسلیِ بخش الف را از بین
  // می‌برد و هم دسترسی به نوار در کتابخانه را برمی‌گرداند. در حالتِ
  // خواندن، قانونِ بخش الف سرِ جایش است (نوارِ شناور فوراً مخفی
  // می‌شود). این افکت بعد از افکتِ حالت اعلان شده تا در باز شدنِ
  // پنل، دستورِ بستن بر دستورِ باز شدنِ اولیه بچربد.
  useEffect(() => {
    if (isSidePanelOpen && effectiveReaderMode) {
      clearHideTimer();
      // مرحله ۳ ـ بخش ب: گیر کردنِ فوکوس. اگر فوکوسِ کیبورد داخلِ
      // نوارِ در حالِ مخفی شدن است، آن را رها کن تا تایپ به اینپوتِ
      // نامرئی نرود و فوکوس به بدنه برگردد.
      if (headerRef.current && headerRef.current.contains(document.activeElement)) {
        document.activeElement.blur();
        setIsSearchFocused(false);
      }
      updateShowBar(false);
    } else if (!effectiveReaderMode) {
      updateShowBar(true);
    }
  }, [isSidePanelOpen, effectiveReaderMode, clearHideTimer, updateShowBar, setIsSearchFocused]);

  // ۲. سنسور مجاورت با حاشیه امن ۱۵۵ پیکسل (برای لغزش دست هنگام تایپ) و بستن با کلیک وسط صفحه
  useEffect(() => {
    const handleMouseMove = (e) => {
      // مرحله ۳ ـ بخش الف/ب: در حالتِ خواندن و تا وقتی پنلِ کناری باز
      // است، سنسورِ بالای صفحه کاملاً خاموش است؛ getState تازه‌ترین
      // مقدار را می‌دهد (بدونِ وابستگی به رندرِ بعدی)، پس رفتنِ ماوس
      // به سمتِ دکمه‌های بالاییِ پنل‌ها هرگز TopBar را بیرون
      // نمی‌پراند. در حالتِ غیرخواندن این نگهبان اعمال نمی‌شود تا
      // رفتارِ عادیِ نوار (از جمله آزادسازیِ مسدودکننده‌ها) بماند.
      if (
        effectiveReaderMode &&
        (useAppStore.getState().isLeftSidebarOpen ||
          useAppStore.getState().isRightSidebarOpen)
      ) {
        return;
      }

      // اگر ماوس در محدوده کادر سرچ است، اطمینان حاصل کن هیچ لایه بیرونی روی آن نیفتاده باشد
      if (e.clientY <= 65 && showBarRef.current) {
        releaseOverlappingBlockers();
      }

      if (!effectiveReaderMode) return;

      const appState = useAppStore.getState();
      const isInputActive =
        appState.isSearchFocused ||
        document.activeElement === inputRef.current ||
        Boolean(appState.searchQuery?.trim());

      if (isInputActive) {
        clearHideTimer();
        if (!showBarRef.current) updateShowBar(true);
        return;
      }

      // باز شدن در ۴۸ پیکسل بالای صفحه | باز ماندن تا ۱۵۵ پیکسل برای تحمل لغزش دست
      const activeSafeZone = showBarRef.current ? 155 : 48;

      if (e.clientY <= activeSafeZone || isBarHoveredRef.current) {
        clearHideTimer();
        if (!showBarRef.current) updateShowBar(true);
      } else if (showBarRef.current && !hideTimerRef.current) {
        scheduleAutoHide(1600);
      }
    };

    const handlePointerDown = (e) => {
      pointerDownRef.current = {
        x: e.clientX,
        y: e.clientY,
        time: Date.now(),
      };

      // اگر کاربر دقیقاً درون مستطیل هندسی کادر سرچ کلیک کرد، حتی اگر المان دیگری مزاحم بود فوکوس را فعال کن
      if (searchBarRef.current && showBarRef.current) {
        const rect = searchBarRef.current.getBoundingClientRect();
        if (
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom
        ) {
          releaseOverlappingBlockers();
          clearHideTimer();
          setIsSearchFocused(true);
          if (e.target !== inputRef.current) {
            requestAnimationFrame(() => {
              inputRef.current?.focus();
            });
          }
        }
      }
    };

    const handlePointerUp = (e) => {
      if (!effectiveReaderMode) return;

      const { x, y, time } = pointerDownRef.current;
      const dist = Math.hypot(e.clientX - x, e.clientY - y);
      const elapsed = Date.now() - time;

      // تفکیک کلیک واقعی از لرزش دست (حداکثر ۷ پیکسل)
      if (dist <= 7 && elapsed < 420) {
        const clickedInsideTopBar = headerRef.current?.contains(e.target);
        const inEdgeZones =
          e.clientY <= 66 ||
          e.clientY >= window.innerHeight - 72 ||
          e.clientX <= 60 ||
          e.clientX >= window.innerWidth - 60;

        if (!clickedInsideTopBar && !inEdgeZones) {
          clearHideTimer();
          isBarHoveredRef.current = false;
          setIsSearchFocused(false);
          setSelectedIndex(-1);
          inputRef.current?.blur();
          updateShowBar(false);
        }
      }
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointerup', handlePointerUp, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [
    effectiveReaderMode,
    clearHideTimer,
    updateShowBar,
    scheduleAutoHide,
    setIsSearchFocused,
    releaseOverlappingBlockers,
  ]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setIsSearchFocused(false);
        setSelectedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, { passive: true });
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setIsSearchFocused]);

  const handleToggleAnnotationStudio = useCallback(
    (e) => {
      e.stopPropagation();
      toggleAnnotationMode?.();
      const nextState = useAppStore.getState().isAnnotationActive;
      showToast(
        nextState ? 'استودیو ویرایش و کادربندی فعال شد' : 'استودیو ویرایش بسته شد',
        { type: nextState ? 'success' : 'info' }
      );
    },
    [toggleAnnotationMode, showToast]
  );

  const handleToggleAreaZoom = useCallback(
    (e) => {
      e.stopPropagation();
      const nextState = toggleAreaZoom?.();
      if (nextState) {
        showToast('ناحیه مورد نظر را با ماوس کادر بکشید تا زوم شود', { type: 'info' });
      }
    },
    [toggleAreaZoom, showToast]
  );

  const matchedResults = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q || !isSearchFocused) return [];

    const { recentItems, favorites, library, downloads } = useLibraryStore.getState();
    const combinedMap = new Map();
    const allSources = [
      ...(recentItems || []).map((i) => ({ ...i, sourceBadge: 'اخیر' })),
      ...(favorites || []).map((i) => ({ ...i, sourceBadge: 'علاقه‌مندی' })),
      ...(library || []).map((i) => ({ ...i, sourceBadge: 'کتابخانه' })),
      ...(downloads || []).map((i) => ({ ...i, sourceBadge: 'آپدیت‌ها' })),
    ];

    allSources.forEach((item) => {
      const path = (item.path || item.filePath || '').trim();
      const name = (item.name || item.fileName || '').toLowerCase();
      if (path && (name.includes(q) || path.toLowerCase().includes(q))) {
        const normKey = path.replace(/[\\/]+/g, '\\').toLowerCase();
        if (!combinedMap.has(normKey)) {
          combinedMap.set(normKey, item);
        }
      }
    });

    return Array.from(combinedMap.values()).slice(0, 7);
  }, [searchQuery, isSearchFocused]);

  const pageJumpNumber = useMemo(() => {
    if (!hasComic || totalPages < 1) return null;
    return parsePageJumpQuery(searchQuery, totalPages);
  }, [searchQuery, hasComic, totalPages]);

  const executePageJump = useCallback(
    (targetPageNum) => {
      if (!targetPageNum || !useReaderStore.getState().comicData) return;

      setCurrentView('reader');
      setCurrentPage(targetPageNum);
      setTargetPage(targetPageNum);
      jumpToPage?.(targetPageNum);

      requestAnimationFrame(() => {
        setTargetPage(targetPageNum);
        jumpToPage?.(targetPageNum);
      });

      setIsSearchFocused(false);
      clearSearch();
      setSelectedIndex(-1);
      inputRef.current?.blur();
      showToast(`پرش به صفحه ${targetPageNum} از ${totalPages} انجام شد`, { type: 'info' });
    },
    [
      totalPages,
      setCurrentView,
      setCurrentPage,
      setTargetPage,
      jumpToPage,
      setIsSearchFocused,
      clearSearch,
      showToast,
    ]
  );

  const handleSelectResult = useCallback(
    (item) => {
      const targetPath = item.path || item.filePath;
      if (!targetPath) return;
      setIsSearchFocused(false);
      clearSearch();
      setSelectedIndex(-1);
      inputRef.current?.blur();
      if (onOpenComic) {
        onOpenComic(targetPath);
      } else {
        window.dispatchEvent(new CustomEvent('app:navigate-comic', { detail: targetPath }));
      }
    },
    [setIsSearchFocused, clearSearch, onOpenComic]
  );

  const handleKeyDown = (e) => {
    const totalItems = (pageJumpNumber ? 1 : 0) + matchedResults.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (totalItems > 0) setSelectedIndex((prev) => (prev + 1) % totalItems);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (totalItems > 0) setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex === 0 && pageJumpNumber) {
        executePageJump(pageJumpNumber);
        return;
      }
      const itemIndex = pageJumpNumber ? selectedIndex - 1 : selectedIndex;
      if (itemIndex >= 0 && itemIndex < matchedResults.length) {
        handleSelectResult(matchedResults[itemIndex]);
        return;
      }
      if (pageJumpNumber) {
        executePageJump(pageJumpNumber);
        return;
      }
      if (matchedResults.length > 0) {
        handleSelectResult(matchedResults[0]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setIsSearchFocused(false);
      setSelectedIndex(-1);
      inputRef.current?.blur();
    }
  };

  // مرحله ۳ ـ بخش ب: انحصارِ متقابل فقط در حالتِ خواندن. در حالتِ
  // غیرخواندن نوار همیشه مرئی است (پنل‌ها زیرِ آن‌اند و هم‌پوشانی
  // ندارند)؛ در حالتِ خواندن، باز بودنِ هر پنلِ کناری نوارِ شناور را
  // مخفی می‌کند.
  const isVisibleNow =
    !effectiveReaderMode || ((showBar || isSearchFocused) && !isSidePanelOpen);

  return (
    <>
      <style>{`
        #global-topbar-header,
        #global-topbar-header * {
          -webkit-app-region: no-drag;
        }
        .topbar-drag-spacer {
          -webkit-app-region: drag !important;
        }
        #global-topbar-search-box,
        #global-topbar-search-input {
          -webkit-app-region: no-drag !important;
          cursor: text !important;
          user-select: text !important;
          -webkit-user-select: text !important;
          pointer-events: auto !important;
        }
      `}</style>

      <header
        id="global-topbar-header"
        ref={headerRef}
        onMouseEnter={(e) => {
          isBarHoveredRef.current = true;
          clearHideTimer();
          releaseOverlappingBlockers();
          // مرحله ۳ ـ بخش الف: وقتی پنلِ کناری باز است، هاور روی خودِ
          // نوار هم آن را باز نمی‌کند (نوار در این حالت مخفی است و
          // این نگهبان از بازگشتِ غافلگیرکننده جلوگیری می‌کند).
          if (!showBarRef.current && !isSidePanelOpen) updateShowBar(true);
          onMouseEnter?.(e);
        }}
        onMouseLeave={(e) => {
          isBarHoveredRef.current = false;
          if (effectiveReaderMode && !useAppStore.getState().isSearchFocused) {
            scheduleAutoHide(1600);
          }
          onMouseLeave?.(e);
        }}
        style={{
          ...styles.topBar,
          position: effectiveReaderMode ? 'absolute' : 'relative',
          top: effectiveReaderMode ? '8px' : '0',
          left: effectiveReaderMode ? '16px' : '0',
          right: effectiveReaderMode ? '16px' : '0',
          transformOrigin: 'top center',
          transform: effectiveReaderMode
            ? isVisibleNow
              ? 'none'
              : 'translate3d(0, -42px, 0) scaleX(1.14) scaleY(0.28)'
            : 'none',
          opacity: isVisibleNow ? 1 : 0,
          pointerEvents: isVisibleNow ? 'auto' : 'none',
          // مرحله ۳ ـ بخش ب: جمع‌شدنِ ارتفاعِ بخش الف حذف شد. آن
          // ارتفاعِ صفر در حالتِ غیرخواندن، با هر باز و بسته شدنِ
          // پنل، کلِ محتوا را ۴۸ پیکسل بالا و پایین می‌پراند. با
          // معافیتِ غیرخواندن، دیگر موقعیتی برای صفر کردنِ ارتفاع
          // نیست و در حالتِ خواندن هم نوار absolute است و همین
          // transform مخفیِ موجود کافی است.
          backgroundColor: effectiveReaderMode ? 'rgba(10, 15, 19, 0.95)' : 'transparent',
          backdropFilter: effectiveReaderMode ? 'blur(18px)' : 'none',
          WebkitBackdropFilter: effectiveReaderMode ? 'blur(18px)' : 'none',
          borderRadius: effectiveReaderMode ? '14px' : '0',
          padding: effectiveReaderMode ? '0 16px' : '0',
          boxShadow: effectiveReaderMode ? '0 12px 32px rgba(0, 0, 0, 0.65)' : 'none',
          borderWidth: effectiveReaderMode ? '1px' : '0px',
          borderStyle: 'solid',
          borderColor: effectiveReaderMode ? 'var(--border)' : 'transparent',
          zIndex: 9000,
        }}
      >
        {/* ۱. لوگو و نام برنامه */}
        <div
          style={styles.logoGroup}
          onClick={() => setCurrentView('home')}
          title="صفحه اصلی (Home)"
        >
          <div style={styles.logoIcon}>
            <Icons.BookOpen size={15} />
          </div>
          <span style={styles.brandText}>ComicReader</span>
        </div>

        {/* فضای خالی درگ پنجره (کاملاً جدا از کادر سرچ) */}
        <div
          className={effectiveReaderMode ? '' : 'topbar-drag-spacer'}
          style={styles.dragSpacer}
        />

        {/* ۲. کنسول جستجوی سراسری با آزادی کامل انتخاب متن و کرسر متنی */}
        <div
          ref={searchContainerRef}
          style={styles.searchContainer}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            id="global-topbar-search-box"
            ref={searchBarRef}
            onMouseDown={(e) => {
              e.stopPropagation();
              clearHideTimer();
              setIsSearchFocused(true);
              // اگر روی فضای اطراف یا آیکون کلیک شد فوکوس را به اینپوت بده، اما اگر روی خود اینپوت کلیک شد اجازه بده مرورگر طبیعی مکان‌نما را بگذارد
              if (e.target !== inputRef.current) {
                e.preventDefault();
                inputRef.current?.focus();
              }
            }}
            style={{
              ...styles.searchBar,
              borderColor: isSearchFocused ? 'var(--accent)' : 'var(--border)',
              backgroundColor: isSearchFocused ? 'var(--panel)' : 'var(--panel2)',
              boxShadow: isSearchFocused ? '0 0 0 2px rgba(34, 211, 238, 0.16)' : 'none',
            }}
          >
            <span style={styles.searchIconWrap}>
              <Icons.Search size={15} />
            </span>

            <input
              ref={inputRef}
              id="global-topbar-search-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={searchQuery}
              onFocus={() => {
                clearHideTimer();
                updateShowBar(true);
                setIsSearchFocused(true);
              }}
              onChange={(e) => {
                clearHideTimer();
                setSearchQuery(e.target.value);
                setIsSearchFocused(true);
                setSelectedIndex(-1);
              }}
              onKeyDown={handleKeyDown}
              placeholder={
                hasComic && totalPages > 0
                  ? `تایپ نام کمیک یا شماره صفحه (۱ تا ${totalPages}) + Enter...`
                  : 'جستجو در نام کمیک‌ها، کتابخانه و تاریخچه...'
              }
              style={styles.searchInput}
            />

            {searchQuery ? (
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  clearSearch();
                  inputRef.current?.focus();
                }}
                style={styles.clearBtn}
                title="پاک کردن جستجو"
              >
                <Icons.X size={14} />
              </button>
            ) : (
              <span style={styles.shortcutHint}>{searchShortcutLabel}</span>
            )}
          </div>

          {isSearchFocused && searchQuery.trim().length > 0 && (
            <div
              style={styles.dropdownPanel}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {pageJumpNumber && (
                <div
                  onClick={() => executePageJump(pageJumpNumber)}
                  style={{
                    ...styles.jumpOption,
                    backgroundColor:
                      selectedIndex === 0
                        ? 'rgba(34, 211, 238, 0.22)'
                        : 'rgba(34, 211, 238, 0.12)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Icons.Zap size={15} />
                    <span>
                      پرش مستقیم به صفحه <strong style={styles.monoStrong}>{pageJumpNumber}</strong> از{' '}
                      <span style={styles.monoStrong}>{totalPages}</span> کمیک فعلی
                    </span>
                  </div>
                  <span style={styles.enterBadge}>Enter</span>
                </div>
              )}

              {matchedResults.length > 0 ? (
                matchedResults.map((item, idx) => {
                  const itemVirtualIdx = pageJumpNumber ? idx + 1 : idx;
                  const isSelected = selectedIndex === itemVirtualIdx;

                  return (
                    <div
                      key={item.path || idx}
                      onClick={() => handleSelectResult(item)}
                      style={{
                        ...styles.resultItem,
                        backgroundColor: isSelected
                          ? 'rgba(34, 211, 238, 0.1)'
                          : 'transparent',
                      }}
                    >
                      <span style={styles.resultIcon}>
                        <Icons.BookOpen size={16} />
                      </span>
                      <div style={styles.resultTextWrap}>
                        <span style={styles.resultTitle}>{item.name || item.fileName}</span>
                        <span style={styles.resultPath}>{item.path}</span>
                      </div>
                      <span style={styles.sourceTag}>{item.sourceBadge}</span>
                    </div>
                  );
                })
              ) : (
                !pageJumpNumber && (
                  <div style={styles.emptySearch}>
                    موردی با عبارت «{searchQuery}» یافت نشد.
                  </div>
                )
              )}
            </div>
          )}
        </div>

        {/* فضای خالی درگ پنجره */}
        <div
          className={effectiveReaderMode ? '' : 'topbar-drag-spacer'}
          style={styles.dragSpacer}
        />

        {/* ۳. دکمه‌های کنترلی و ابزارهای ریدر */}
        <div style={styles.windowControls}>
          <button
            type="button"
            onClick={onOpenClick}
            style={styles.openBtn}
            title={`باز کردن فایل جدید (${openFileShortcutLabel})`}
          >
            <Icons.FolderOpen size={15} />
            <span>فایل جدید</span>
          </button>

          {hasComic && (
            <button
              type="button"
              onClick={handleToggleAreaZoom}
              style={{
                ...styles.toolChipBtn,
                backgroundColor: isAreaZoomActive
                  ? 'rgba(167, 139, 250, 0.2)'
                  : 'var(--panel2)',
                borderColor: isAreaZoomActive ? '#a78bfa' : 'var(--border)',
                color: isAreaZoomActive ? '#a78bfa' : 'var(--text)',
              }}
              title="زوم ناحیه‌ای با کشیدن باکس (Alt + Z)"
            >
              {Icons.ScanSearch ? <Icons.ScanSearch size={14} /> : <Icons.ZoomIn size={14} />}
              <span>زوم باکسی</span>
            </button>
          )}

          {hasComic && (
            <button
              type="button"
              onClick={handleToggleAnnotationStudio}
              style={{
                ...styles.toolChipBtn,
                backgroundColor: isAnnotationActive
                  ? 'rgba(34, 211, 238, 0.2)'
                  : 'var(--panel2)',
                borderColor: isAnnotationActive ? 'var(--accent)' : 'var(--border)',
                color: isAnnotationActive ? 'var(--accent)' : 'var(--text)',
                boxShadow: isAnnotationActive
                  ? '0 0 14px rgba(34, 211, 238, 0.25)'
                  : 'none',
              }}
              title="فعال/غیرفعال کردن استودیو ویرایش، کادر ابری و هایلایت"
            >
              <Icons.Edit3 size={14} />
              <span>استودیو ویرایش</span>
            </button>
          )}

          <button
            type="button"
            onClick={openQuickSettings}
            style={styles.controlBtn}
            title="تنظیمات سریع مطالعه و فاصله صفحات"
          >
            <Icons.Zap size={15} />
          </button>

          <button
            type="button"
            onClick={coreApi.minimizeApp}
            style={styles.controlBtn}
            title="کوچک کردن پنجره"
          >
            <Icons.Minimize size={14} />
          </button>

          <button
            type="button"
            onClick={coreApi.maximizeApp}
            style={styles.controlBtn}
            title="بزرگ‌نمایی پنجره"
          >
            <Icons.Maximize size={14} />
          </button>

          <button
            type="button"
            onClick={coreApi.closeApp}
            onMouseEnter={() => setCloseHover(true)}
            onMouseLeave={() => setCloseHover(false)}
            style={{
              ...styles.controlBtn,
              backgroundColor: closeHover ? 'var(--danger)' : 'transparent',
              color: closeHover ? '#fff' : 'var(--muted)',
            }}
            title="بستن برنامه"
          >
            <Icons.X size={15} />
          </button>
        </div>
      </header>
    </>
  );
}

const styles = {
  topBar: {
    // مرحله ۴ ـ بخش ب: چیدمانِ هدر همیشه چپ‌به‌راست است (لوگو چپ،
    // کنترل‌های پنجره راست)؛ dir="rtl" سند از مرحلهٔ ۳، آن را برعکس
    // کرده بود. متن‌های فارسیِ داخل، جهتِ صریحِ خودشان را دارند
    // (searchBar/searchInput/dropdown روی rtl، brand/hint روی ltr).
    direction: 'ltr',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: '48px',
    marginBottom: '4px',
    transition:
      'transform 0.32s cubic-bezier(0.22, 1.12, 0.36, 1), opacity 0.22s ease',
    fontFamily: 'var(--font-fa)',
  },
  logoGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '9px',
    flexShrink: 0,
    cursor: 'pointer',
  },
  logoIcon: {
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    borderRadius: '8px',
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandText: {
    fontFamily: 'var(--font-latin)',
    fontWeight: 800,
    fontSize: '15px',
    color: 'var(--text)',
    letterSpacing: '-0.3px',
    direction: 'ltr',
  },
  dragSpacer: {
    flex: 1,
    height: '100%',
    minWidth: '12px',
  },
  searchContainer: {
    width: '100%',
    maxWidth: '490px',
    position: 'relative',
    cursor: 'text',
    zIndex: 9100,
  },
  searchBar: {
    display: 'flex',
    flexDirection: 'row',
    direction: 'rtl',
    alignItems: 'center',
    borderRadius: '12px',
    padding: '0 12px',
    height: '38px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    transition: 'all 0.18s ease',
    cursor: 'text',
    position: 'relative',
    zIndex: 9100,
  },
  searchIconWrap: {
    marginLeft: '8px',
    color: 'var(--muted)',
    display: 'flex',
    alignItems: 'center',
    pointerEvents: 'none',
    flexShrink: 0,
  },
  searchInput: {
    flex: 1,
    width: '100%',
    height: '100%',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    direction: 'rtl',
    textAlign: 'right',
    cursor: 'text',
    position: 'relative',
    zIndex: 5,
  },
  clearBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    padding: 0,
    outline: 'none',
    flexShrink: 0,
    zIndex: 6,
  },
  shortcutHint: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    fontWeight: 600,
    color: 'var(--muted)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    padding: '2px 7px',
    borderRadius: '6px',
    marginRight: '6px',
    whiteSpace: 'nowrap',
    direction: 'ltr',
    pointerEvents: 'none',
    flexShrink: 0,
  },
  dropdownPanel: {
    position: 'absolute',
    top: '44px',
    left: 0,
    right: 0,
    backgroundColor: 'var(--panel)',
    borderRadius: '14px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    boxShadow: '0 16px 40px rgba(0, 0, 0, 0.85)',
    padding: '6px',
    zIndex: 9200,
    direction: 'rtl',
    maxHeight: '330px',
    overflowY: 'auto',
    cursor: 'default',
  },
  jumpOption: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderRadius: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.35)',
    color: 'var(--accent)',
    fontSize: '12.5px',
    fontWeight: 600,
    cursor: 'pointer',
    marginBottom: '6px',
    transition: 'background-color 0.15s ease',
  },
  monoStrong: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 700,
  },
  enterBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    fontWeight: 600,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    padding: '2px 7px',
    borderRadius: '5px',
    direction: 'ltr',
  },
  resultItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '8px 10px',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'background-color 0.15s ease',
  },
  resultIcon: {
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
  },
  resultTextWrap: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    overflow: 'hidden',
    gap: '2px',
  },
  resultTitle: {
    fontFamily: 'var(--font-latin)',
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--text)',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    direction: 'ltr',
    textAlign: 'right',
  },
  resultPath: {
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
  sourceTag: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    fontWeight: 600,
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    padding: '2px 8px',
    borderRadius: '8px',
    flexShrink: 0,
  },
  emptySearch: {
    padding: '14px',
    textAlign: 'center',
    color: 'var(--muted)',
    fontSize: '12px',
  },
  windowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  controlBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--muted)',
    cursor: 'pointer',
    width: '32px',
    height: '32px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
    transition: 'all 0.18s ease',
    outline: 'none',
  },
  openBtn: {
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    padding: '6px 11px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.18s ease',
    outline: 'none',
  },
  toolChipBtn: {
    borderWidth: '1px',
    borderStyle: 'solid',
    padding: '6px 11px',
    borderRadius: '10px',
    cursor: 'pointer',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.18s ease',
    outline: 'none',
  },
};