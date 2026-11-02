import React, { useMemo, useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { coreApi } from '../../services/coreApi';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useReaderStore from '../../store/useReaderStore';
import useSettingsStore from '../../store/useSettingsStore';
import Icons from '../common/Icons';
import { getPdfSessionPassword } from '../../services/pdfPasswordSession';

// مرحله ۱۱: نامِ پیش‌فرضِ نسخهٔ کپی: <نامِ اصلی>-editable.pdf
function defaultCopyName(filePath) {
  const base = String(filePath || '').split(/[\\/]/).pop() || 'copy.pdf';
  return base.replace(/\.pdf$/i, '') + '-editable.pdf';
}

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
  // Stage 8 Part A: Xodo strategy for protected PDFs. The modal only
  // opens on studio entry; the probe cache checks each file once per
  // session; the memory-only choice is per file per session.
  const [protectedModal, setProtectedModal] = useState(null);
  const [isCreatingCopy, setIsCreatingCopy] = useState(false);
  // مرحله ۸ ـ اصلاحِ نهایی: چرخشِ دکمهٔ استودیو هنگامِ پروب (پروب
  // حالا در ورکر است و تا ۶۰ ثانیه طول می‌کشد؛ کاربر باید ببیند
  // که کلیکش ثبت شده) + پیشرفتِ زندهٔ ساختِ کپی در مودال.
  const [isCheckingProtection, setIsCheckingProtection] = useState(false);
  const [copyProgress, setCopyProgress] = useState(null);
  // مرحله ۱۱: نامِ دلخواهِ نسخهٔ کپی (قابلِ ویرایش در مودال) و
  // مسیرِ انتخاب‌شده در دیالوگِ ویندوز. هر بار که مودال باز
  // می‌شود، در openProtectionModal مقدارِ پیش‌فرض می‌گیرند.
  const [copyFileName, setCopyFileName] = useState('');
  const [copyDesiredPath, setCopyDesiredPath] = useState(null);
  const [pendingCopySwitch, setPendingCopySwitch] = useState(null);
  const probeCacheRef = useRef(new Map());
  const probeInFlightRef = useRef(false);
  const memoryOnlyRef = useRef(new Set());
  // مرحله ۹: آینهٔ ref برای مودالِ محافظت — نگهبان‌هایِ ماوس/هاید
  // (releaseOverlappingBlockers و scheduleAutoHide) باید تازه‌ترین
  // وضعیتِ مودال را بدونِ وابستگی به رندرِ بعدی ببینند.
  const protectedModalRef = useRef(null);
  useEffect(() => {
    protectedModalRef.current = protectedModal;
  }, [protectedModal]);

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
    // مرحله ۹: وقتی مودالِ محافظت (پورتالِ روی body) باز است، این
    // اسکن اصلاً اجرا نمی‌شود؛ مودال، خودش pointerEvents دارد و
    // جهشِ ماوس به سمتِ وسطِ صفحه، نباید روی آن بنویسد.
    if (protectedModalRef.current) return;

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
        if (el.closest?.('[data-modal-overlay]')) {
          continue;
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
        // مرحله ۹: تا وقتی مودالِ محافظت باز است، نوار مخفی نمی‌شود.
        if (protectedModalRef.current) {
          hideTimerRef.current = null;
          return;
        }
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
      } else if (showBarRef.current && !hideTimerRef.current && !protectedModalRef.current) {
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
      // مرحله ۹: تا وقتی مودالِ محافظت باز است، کلیکِ وسطِ صفحه
      // (روی خودِ مودال) هرگز نوار را مخفی نمی‌کند.
      if (protectedModalRef.current) return;

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

  // Stage 8 Part A: activating the studio only when it is off, since
  // toggleAnnotationMode flips the state; an unconditional call would
  // close an already-open studio.
  const activateStudio = useCallback(() => {
    if (!useAppStore.getState().isAnnotationActive) toggleAnnotationMode?.();
    showToast('استودیو ویرایش و کادربندی فعال شد', { type: 'success' });
  }, [toggleAnnotationMode, showToast]);

  // مرحله ۱۱: باز کردنِ مودالِ محافظت با مقداردهیِ نامِ کپی.
  const openProtectionModal = useCallback((info) => {
    setCopyDesiredPath(null);
    setCopyFileName(defaultCopyName(info.filePath));
    setProtectedModal({
      filePath: info.filePath,
      pageCount: info.pageCount,
      reason: info.reason,
      rebuildRecommended: Boolean(info.rebuildRecommended),
      qpdfAvailable: Boolean(info.qpdfAvailable),
      encryptionLabel: (info.encryption && info.encryption.label) || '',
      preservedPage: info.preservedPage || useReaderStore.getState().currentPage || 1,
    });
  }, []);

  // مرحله ۱۱: جریانِ واحدِ بررسیِ محافظت — هم برای کلیکِ
  // استودیو و هم برای رویدادِ app:open-protection-modal (از
  // ذخیرهٔ فایلِ محافظت‌شده). هیچ مسیری، استودیو را بی‌چک باز
  // نمی‌کند: نتیجهٔ «نامشخص» (تایم‌اوت/خطای پروب) هم مودال را
  // نشان می‌دهد تا کاربر، خودش تصمیم بگیرد. پروبِ سریعِ دمِ
  // فایل، چند میلی‌ثانیه است و اسپینرِ دکمه، تا پایانِ پروب
  // می‌ماند؛ تایم‌اوتِ ۱۲۰۰ میلی‌ثانیه‌ایِ مرحلهٔ ۹ که مودال را
  // در کلیکِ اول قورت می‌داد، حذف شد.
  const ensureProtectionChecked = useCallback((filePath) => {
    const cached = probeCacheRef.current.get(filePath);
    if (cached && cached.protected === false && !cached.readOnly && cached.reason !== 'unknown') {
      return 'clean';
    }
    if (cached && (cached.protected === true || cached.readOnly === true)) {
      openProtectionModal({
        filePath,
        pageCount: cached.pageCount,
        reason: cached.reason,
        rebuildRecommended: cached.rebuildRecommended,
        qpdfAvailable: cached.qpdfAvailable,
        encryption: cached.encryption,
      });
      return 'modal';
    }
    if (probeInFlightRef.current) return 'pending';
    probeInFlightRef.current = true;
    setIsCheckingProtection(true);
    coreApi
      .checkPdfProtection(filePath)
      .then((res) => {
        const result = res || { protected: false, reason: 'unknown', pageCount: -1 };
        probeCacheRef.current.set(filePath, result);
        if (result.protected || result.readOnly || result.reason === 'unknown') {
          openProtectionModal({
            filePath,
            pageCount: result.pageCount,
            reason: result.reason,
            rebuildRecommended: result.rebuildRecommended,
            qpdfAvailable: result.qpdfAvailable,
            encryption: result.encryption,
          });
        } else {
          activateStudio();
        }
      })
      .catch(() => {
        openProtectionModal({
          filePath,
          pageCount: -1,
          reason: 'unknown',
          rebuildRecommended: false,
          qpdfAvailable: false,
          encryption: null,
        });
      })
      .finally(() => {
        probeInFlightRef.current = false;
        setIsCheckingProtection(false);
      });
    return 'pending';
  }, [activateStudio, openProtectionModal]);

  const handleToggleAnnotationStudio = useCallback(
    (e) => {
      e.stopPropagation();
      // Closing the studio: always direct, no probe.
      if (useAppStore.getState().isAnnotationActive) {
        toggleAnnotationMode?.();
        showToast('استودیو ویرایش بسته شد', { type: 'info' });
        return;
      }
      const filePath = useReaderStore.getState().comicData?.filePath || '';
      const isPdf = typeof filePath === 'string' && /\.pdf$/i.test(filePath);
      // Non-PDF, or a previous memory-only choice for this file: the
      // studio opens as before, without interruption.
      if (!isPdf || !filePath || memoryOnlyRef.current.has(filePath)) {
        activateStudio();
        return;
      }
      // مرحله ۱۱: جریانِ واحدِ بررسی (بالا). نتیجهٔ 'clean' یعنی
      // کش، تمیزیِ فایل را قطعی می‌داند؛ بقیهٔ حالت‌ها، مودال یا
      // فعال‌سازی را خودِ جریان انجام می‌دهد.
      if (ensureProtectionChecked(filePath) === 'clean') activateStudio();
    },
    [toggleAnnotationMode, showToast, activateStudio, ensureProtectionChecked]
  );

  // Stage 8 Part A: once the active file becomes the copy path after
  // the automatic switch, the studio turns on.
  useEffect(() => {
    if (!pendingCopySwitch) return;
    if (currentFilePath && currentFilePath === pendingCopySwitch.copyPath) {
      setPendingCopySwitch(null);
      activateStudio();
    }
  }, [pendingCopySwitch, currentFilePath, activateStudio]);
  // مرحله ۱۰: وقتی PdfViewer، کپیِ بازسازی‌شده را ساخت، همان
  // جابه‌جاییِ مرحلهٔ ۸ انجام می‌شود: seedِ تاریخچه + جابه‌جایی +
  // فعال‌سازیِ استودیو پس از باز شدنِ کپی.
  useEffect(() => {
    const onEditableCopyReady = (e) => {
      const detail = e && e.detail ? e.detail : {};
      if (!detail.copyPath) return;
      (async () => {
        try {
          const fileName = detail.copyPath.split(/[\\/]/).pop() || 'copy.pdf';
          await useLibraryStore.getState().addToRecent({
            path: detail.copyPath,
            name: fileName,
            type: 'pdf',
            fileSize: '',
            cover: null,
            totalPages: Number(detail.pageCount) > 0 ? Number(detail.pageCount) : totalPages,
            lastPage: detail.preservedPage || 1,
          });
        } catch (_) {}
        setPendingCopySwitch({ copyPath: detail.copyPath, page: detail.preservedPage || 1 });
        showToast('نسخهٔ قابل‌ویرایش ساخته شد؛ در حالِ باز کردنِ آن…', { type: 'success' });
        window.dispatchEvent(new CustomEvent('app:navigate-comic', { detail: detail.copyPath }));
      })();
    };
    window.addEventListener('app:editable-copy-ready', onEditableCopyReady);
    return () => window.removeEventListener('app:editable-copy-ready', onEditableCopyReady);
  }, [showToast, totalPages]);

  // مرحله ۱۱: وقتی PdfViewer هنگامِ ذخیره می‌فهمد فایل،
  // محافظت‌شده است و بدونِ کپی نمی‌توان ذخیره کرد، به‌جای بنرِ
  // قرمز، همین مودالِ محافظت را باز می‌کند (بدونِ تغییرِ وضعیتِ
  // استودیو).
  useEffect(() => {
    const onOpenProtectionModal = (e) => {
      const detail = (e && e.detail) || {};
      const fp = detail.filePath || useReaderStore.getState().comicData?.filePath || '';
      if (!fp || !/\.pdf$/i.test(fp)) return;
      if (memoryOnlyRef.current.has(fp)) return;
      ensureProtectionChecked(fp);
    };
    window.addEventListener('app:open-protection-modal', onOpenProtectionModal);
    return () => window.removeEventListener('app:open-protection-modal', onOpenProtectionModal);
  }, [ensureProtectionChecked]);


  // مرحله ۱۱: انتخابِ مسیر و نامِ کپی با دیالوگِ استانداردِ
  // ویندوز. نامِ انتخاب‌شده در فیلدِ ورودی هم نوشته می‌شود؛ اگر
  // کاربر بعداً نامِ فیلد را عوض کند، نامِ فیلد (در پوشهٔ اصلی)
  // بر مسیرِ انتخاب‌شده اولویت دارد.
  const handleChooseCopyPath = useCallback(async () => {
    if (!protectedModal || isCreatingCopy) return;
    try {
      const res = await coreApi.chooseCopySavePath(
        protectedModal.filePath,
        copyFileName || defaultCopyName(protectedModal.filePath)
      );
      if (res && !res.canceled && res.filePath) {
        setCopyDesiredPath(res.filePath);
        setCopyFileName(res.filePath.split(/[\\/]/).pop() || copyFileName);
      }
    } catch (_) {}
  }, [protectedModal, isCreatingCopy, copyFileName]);

  // Stage 8 Part A: build the unlocked copy and switch to it.
  // مرحلهٔ ۳۱ — method: 'auto' (رفتارِ قبلی: qpdf اول، سپس
  // بازسازی در صورتِ شکستِ رمزگشایی)، 'qpdf' (فقط کپیِ برداری؛
  // در صورتِ شکست، مودال باز می‌ماند تا کاربر خودش بازسازی را
  // انتخاب کند)، 'rebuild' (مستقیم، بازسازی از سندِ بازشده).
  const handleProtectedCopyConfirm = useCallback(async (method = 'auto') => {
    if (!protectedModal || isCreatingCopy) return;
    const { filePath, preservedPage } = protectedModal;
    // مرحله ۱۱: نام/مسیرِ دلخواهِ کاربر برای کپی.
    const desiredPathForCopy = copyDesiredPath && copyDesiredPath.split(/[\\/]/).pop() === copyFileName
      ? copyDesiredPath
      : undefined;
    const copyNaming = { desiredName: copyFileName || undefined, desiredPath: desiredPathForCopy };
    // مرحلهٔ ۳۱ — انتخابِ صریحِ qpdf وقتی موتور در دسترس نیست:
    // به‌جای افتادنِ پنهانی به بازسازی، خطا می‌دهیم و مودال باز
    // می‌ماند.
    if (method === 'qpdf' && !protectedModal.qpdfAvailable) {
      showToast('موتورِ qpdf در دسترس نیست؛ روشِ بازسازی را انتخاب کنید.', { type: 'error' });
      return;
    }
    // مرحلهٔ ۳۱ — 'rebuild'، مستقیم به بازسازی می‌رود (حتی اگر
    // qpdf در دسترس باشد)؛ 'auto'، رفتارِ قبلی را حفظ می‌کند.
    if (method === 'rebuild' || (method === 'auto' && protectedModal.rebuildRecommended && !protectedModal.qpdfAvailable)) {
      // مرحله ۱۰/۱۱: qpdf در دسترس نیست و pdf-lib هم نمی‌تواند
      // این فایل را رمزگشایی کند؛ کپی، با «بازسازی از سندِ
      // بازشده در pdf.js» ساخته می‌شود. خودِ بازسازی در PdfViewer
      // انجام می‌شود (سند، آن‌جاست) و نتیجه، با رویدادِ
      // app:editable-copy-ready برمی‌گردد تا همین جابه‌جاییِ
      // مرحلهٔ ۸ انجام شود.
      const rebuildFilePath = protectedModal.filePath;
      const rebuildPage = protectedModal.preservedPage || 1;
      setProtectedModal(null);
      window.dispatchEvent(new CustomEvent('app:rebuild-editable-copy', { detail: { filePath: rebuildFilePath, preservedPage: rebuildPage, desiredName: copyNaming.desiredName, desiredPath: copyNaming.desiredPath } }));
      showToast('در حالِ ساختِ نسخهٔ قابل‌ویرایش با بازسازیِ صفحات…', { type: 'info' });
      return;
    }
    // rebuildRecommended ولی qpdf در دسترس است: مسیرِ کپیِ
    // بی‌اتلافِ qpdf در saver، اول امتحان می‌شود؛ اگر آن هم
    // شکست خورد، پایین‌تر به بازسازی می‌افتیم.
    setIsCreatingCopy(true);
    setCopyProgress({ fraction: 0, label: 'در حالِ شروع…' });
    let unsubscribeProgress = null;
    try {
      if (typeof coreApi.onPdfCopyProgress === 'function') {
        unsubscribeProgress = coreApi.onPdfCopyProgress((progress) => {
          if (progress && progress.filePath === filePath) {
            setCopyProgress({ fraction: progress.fraction || 0, label: progress.label || '' });
          }
        });
      }
      // مرحله ۱۱: رمزِ نشست (اگر کاربر در مودالِ رمز وارد کرده
      // باشد) به کپی هم می‌رسد؛ پیش‌تر، کپی همیشه بدونِ رمز بود.
      const sessionPassword = getPdfSessionPassword(filePath) || '';
      const result = await coreApi.createUnlockedPdfCopy(filePath, sessionPassword, copyNaming);
      if (result && result.cancelled) {
        // لغوِ کاربر: مودال باز می‌ماند تا دوباره تصمیم بگیرد.
        showToast('ساختِ نسخهٔ کپی لغو شد.', { type: 'info' });
        return;
      }
      if (!result || !result.success) {
        // مرحله ۱۱: اگر qpdf هم نتوانست باز کند (رمزِ واقعی یا
        // رمزگذاریِ پشتیبانی‌نشده)، به‌جای پیامِ خطا، بازسازی از
        // pdf.js پیشنهاد می‌شود — همان مسیری که کپیِ بی‌اتلاف،
        // جایگزینِ آن بود.
        if (result && (result.code === 'PDF_COPY_PASSWORD_REQUIRED' || result.code === 'PDF_COPY_UNSUPPORTED_ENCRYPTION')) {
          if (method === 'qpdf') {
            // مرحلهٔ ۳۱ — انتخابِ صریحِ qpdf: شکستِ رمزگشایی، به
            // بازسازیِ خودکار نمی‌افتد؛ مودال باز می‌ماند تا کاربر،
            // خودش روشِ بازسازی را انتخاب کند.
            showToast('باز کردنِ بی‌اتلاف با qpdf ممکن نشد (رمز یا روشِ رمزگذاری پشتیبانی نمی‌شود)؛ می‌توانید روشِ بازسازی را انتخاب کنید.', { type: 'error' });
            return;
          }
          const rebuildFilePath = protectedModal.filePath;
          const rebuildPage = protectedModal.preservedPage || 1;
          setProtectedModal(null);
          window.dispatchEvent(new CustomEvent('app:rebuild-editable-copy', { detail: { filePath: rebuildFilePath, preservedPage: rebuildPage, desiredName: copyNaming.desiredName, desiredPath: copyNaming.desiredPath } }));
          showToast('باز کردنِ بی‌اتلاف ممکن نشد؛ نسخهٔ کپی با بازسازیِ صفحات ساخته می‌شود…', { type: 'info' });
          return;
        }
        showToast(result?.error || 'ساختِ نسخهٔ کپی انجام نشد.', { type: 'error' });
        return;
      }
      if (result.alreadyUnlocked) {
        // فایل، قفلِ فعالی ندارد (پروب، /Encrypt دیده بود ولی سند،
        // ارجاعِ معلق بود): هیچ کپی‌ای ساخته نشده؛ استودیو روی
        // همان فایل فعال می‌شود و کشِ پروب، اصلاح می‌شود.
        probeCacheRef.current.set(filePath, { protected: false, readOnly: false, reason: 'clean', pageCount: result.pageCount || -1, hasEncryptToken: false });
        setProtectedModal(null);
        activateStudio();
        showToast('این فایل، قفلِ فعالی ندارد؛ استودیو فعال شد.', { type: 'success' });
        return;
      }
      const copyPath = result.copyPath;
      setProtectedModal(null);
      // Seed recents/progress for the new file BEFORE switching, so the
      // open flow resumes on the same page and history stays correct.
      try {
        const fileName = copyPath.split(/[\\/]/).pop() || 'copy.pdf';
        await useLibraryStore.getState().addToRecent({
          path: copyPath,
          name: fileName,
          type: 'pdf',
          fileSize: '',
          cover: null,
          totalPages: Number(result.pageCount) > 0 ? Number(result.pageCount) : totalPages,
          lastPage: preservedPage || 1,
        });
      } catch (_) {}
      setPendingCopySwitch({ copyPath, page: preservedPage || 1 });
      if (result.binaryCopy) {
        // کپیِ باینری، بایت‌به‌بایت همان فایل است و قفل را باز
        // نمی‌کند؛ ذخیره روی آن، رمزگشایی را امتحان می‌کند. کاربر
        // باید این را همین‌جا بداند، نه موقعِ ذخیره.
        showToast(result.stillEncrypted
          ? 'نسخهٔ کپی ساخته شد و در حالِ باز شدن است؛ فایل همچنان قفل است و ذخیرهٔ آن، رمزگشایی با رمزِ خالی را امتحان می‌کند.'
          : 'نسخهٔ کپی ساخته شد؛ در حالِ باز کردنِ آن…', { type: 'success' });
      } else {
        showToast('نسخهٔ قابل‌ویرایش ساخته شد؛ در حالِ باز کردنِ آن…', { type: 'success' });
      }
      window.dispatchEvent(new CustomEvent('app:navigate-comic', { detail: copyPath }));
    } catch (err) {
      showToast(err?.message || 'ساختِ نسخهٔ کپی انجام نشد.', { type: 'error' });
    } finally {
      if (typeof unsubscribeProgress === 'function') {
        try { unsubscribeProgress(); } catch (_) {}
      }
      setCopyProgress(null);
      setIsCreatingCopy(false);
    }
  }, [protectedModal, isCreatingCopy, showToast, totalPages, activateStudio, copyFileName, copyDesiredPath]);

  // Stage 8 Part A: memory-only — the studio opens, but a direct save
  // is later refused loudly by the saver guard.
  const handleProtectedMemoryOnly = useCallback(() => {
    if (!protectedModal) return;
    memoryOnlyRef.current.add(protectedModal.filePath);
    setProtectedModal(null);
    activateStudio();
    showToast('حاشیه‌نویسی فقط در حافظهٔ برنامه انجام می‌شود؛ برای ذخیره، از همین مودال نسخهٔ کپی بسازید.', { type: 'info' });
  }, [protectedModal, activateStudio, showToast]);

  const handleProtectedCancel = useCallback(() => {
    setProtectedModal(null);
  }, []);

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

  // مرحله ۹: «جستجو در فایلِ کنونی» — فقط وقتی PDF در حالتِ
  // مطالعه باز است و عبارتی تایپ شده. triggerPdfSearch از
  // getState خوانده می‌شود تا نوار، با هر کلید، دوباره رندر نشود
  // و گزینه، جزوِ ناوبریِ ArrowUp/Down نیست.
  const isCurrentPdf =
    effectiveReaderMode &&
    typeof currentFilePath === 'string' &&
    /\.pdf$/i.test(currentFilePath);
  const showSearchInCurrentFile = Boolean(isCurrentPdf && searchQuery.trim().length > 0);

  const handleSearchInCurrentFile = useCallback(() => {
    const q = (searchQuery || '').trim();
    setIsSearchFocused(false);
    setSelectedIndex(-1);
    inputRef.current?.blur();
    useReaderStore.getState().triggerPdfSearch?.(q);
  }, [searchQuery, setIsSearchFocused]);

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
      // مرحله ۹: در حالتِ مطالعهٔ PDF، Enterِ بدونِ انتخابِ صریح،
      // جستجو در فایلِ کنونی را آغاز می‌کند (نه باز کردنِ اولین
      // نتیجهٔ کتابخانه).
      if (showSearchInCurrentFile) {
        handleSearchInCurrentFile();
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
  // مرحله ۹: تا وقتی مودالِ محافظت باز است، نوار باز می‌ماند.
  const isVisibleNow =
    !effectiveReaderMode || ((showBar || isSearchFocused || Boolean(protectedModal)) && !isSidePanelOpen);

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
        @keyframes protectedPdfModalIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .protected-modal-btn {
          transition: transform 0.12s ease, filter 0.12s ease;
        }
        .protected-modal-btn:active {
          transform: scale(0.98);
          filter: brightness(1.08);
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
          if (effectiveReaderMode && !useAppStore.getState().isSearchFocused && !protectedModalRef.current) {
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
          flexShrink: 0,
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
              {showSearchInCurrentFile && (
                <div
                  onClick={handleSearchInCurrentFile}
                  style={styles.searchInFileOption}
                >
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    <Icons.Search size={15} />
                  </span>
                  <span style={{ flex: 1, textAlign: 'right' }}>
                    جستجوی «{searchQuery.trim()}» در فایلِ کنونی
                  </span>
                  <span style={styles.enterBadge}>Enter</span>
                </div>
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
              {isCheckingProtection ? <Icons.Loader size={14} /> : <Icons.Edit3 size={14} />}
              <span>{isCheckingProtection ? 'در حالِ بررسی…' : 'استودیو ویرایش'}</span>
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

      {protectedModal && createPortal(
        <div
          data-modal-overlay="protected-pdf"
          role="dialog"
          aria-modal="true"
          aria-label="فایل PDF محافظت‌شده است"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !isCreatingCopy) handleProtectedCancel();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100002,
            pointerEvents: 'auto',
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <div
            style={{
              width: 'min(440px, calc(100vw - 32px))',
              pointerEvents: 'auto',
              backgroundColor: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
              padding: '22px',
              fontFamily: 'var(--font-fa)',
              color: 'var(--text)',
              animation: 'protectedPdfModalIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  color: '#f59e0b',
                  flexShrink: 0,
                }}
              >
                <Icons.AlertTriangle size={20} />
              </span>
              <div style={{ fontSize: '15px', fontWeight: 800, lineHeight: 1.5 }}>
                {protectedModal.reason === 'read-only'
                  ? 'این فایل فقط‌خواندنی است'
                  : 'این فایل PDF محافظت‌شده است'}
              </div>
            </div>
            <div style={{ fontSize: '13px', lineHeight: 1.9, color: 'var(--muted)', marginBottom: '16px' }}>
              {protectedModal.reason === 'read-only'
                ? 'امکانِ ذخیرهٔ مستقیمِ تغییرات روی این فایل وجود ندارد، چون فقط‌خواندنی است. آیا مایلید یک نسخهٔ کپیِ قابل‌ویرایش از این فایل ساخته و باز شود تا بتوانید حاشیه‌نویسی‌های خود را روی آن انجام دهید؟ فایلِ اصلی دست نمی‌خورد.'
                : 'امکانِ ذخیرهٔ مستقیمِ تغییرات روی این فایل وجود ندارد. آیا مایلید یک نسخهٔ کپیِ قابل‌ویرایش از این فایل ساخته و باز شود تا بتوانید حاشیه‌نویسی‌های خود را روی آن انجام دهید؟ فایلِ اصلی دست نمی‌خورد.'}
            </div>
            <div
              style={{
                fontSize: '12px',
                lineHeight: 1.8,
                color: 'var(--muted)',
                backgroundColor: 'var(--panel2)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '8px 12px',
                marginBottom: '18px',
                direction: 'ltr',
                textAlign: 'left',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
            {protectedModal.rebuildRecommended && (
              <div style={{ fontSize: '12px', lineHeight: 1.8, color: '#f59e0b', marginBottom: '16px' }}>
                {protectedModal.qpdfAvailable
                  ? `این فایل با روشی قفل شده است (${protectedModal.encryptionLabel || 'AES-256'}) که ابزارِ معمولی نمی‌تواند آن را باز کند؛ نسخهٔ کپی با موتورِ بی‌اتلاف ساخته می‌شود و متن، فونت‌ها و جستجو کامل حفظ می‌شوند.`
                  : `این فایل با روشی قفل شده است (${protectedModal.encryptionLabel || 'AES-256'}) که ابزارِ معمولی نمی‌تواند آن را باز کند؛ نسخهٔ کپی از صفحاتِ بازشده بازسازی می‌شود و لایهٔ متنِ آن در خودِ فایل حفظ نمی‌شود (جستجو در همین برنامه، از ایندکسِ کناری انجام می‌شود).`}
              </div>
            )}
              {(protectedModal.filePath.split(/[\\/]/).pop() || '').replace(/\.pdf$/i, '') + '-editable.pdf'}
            </div>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: 'var(--text)', marginBottom: '6px' }}>
                نامِ فایلِ کپی
              </label>
              <input
                type="text"
                value={copyFileName}
                onChange={(e) => { setCopyFileName(e.target.value); }}
                disabled={isCreatingCopy}
                dir="ltr"
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--panel2)',
                  color: 'var(--text)',
                  fontSize: '13px',
                  textAlign: 'left',
                  outline: 'none',
                }}
                placeholder="نامِ فایلِ کپی…"
              />
              <button
                type="button"
                onClick={handleChooseCopyPath}
                disabled={isCreatingCopy}
                style={{
                  marginTop: '8px',
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--panel2)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-fa)',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: isCreatingCopy ? 'wait' : 'pointer',
                }}
              >
                انتخابِ مسیر و نام با پنجرهٔ ویندوز…
              </button>
              {copyDesiredPath ? (
                <div style={{ fontSize: '11px', lineHeight: 1.8, color: 'var(--muted)', marginTop: '6px', direction: 'ltr', textAlign: 'left', wordBreak: 'break-all' }}>
                  {copyDesiredPath}
                </div>
              ) : null}
            </div>
            {isCreatingCopy && copyProgress && (
              <div style={{ marginBottom: '18px' }} aria-live="polite">
                <div
                  style={{
                    height: '8px',
                    borderRadius: '999px',
                    backgroundColor: 'var(--panel2)',
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: Math.round(Math.max(0, Math.min(1, Number(copyProgress.fraction) || 0)) * 100) + '%',
                      backgroundColor: 'var(--accent)',
                      borderRadius: '999px',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
                <div style={{ fontSize: '12px', lineHeight: 1.8, color: 'var(--muted)', marginTop: '6px', textAlign: 'center' }}>
                  {copyProgress.label || 'در حالِ ساختِ نسخهٔ کپی…'}
                  {' '}
                  {Math.round(Math.max(0, Math.min(1, Number(copyProgress.fraction) || 0)) * 100)}٪
                </div>
              </div>
            )}
            <div
              style={{
                fontSize: '12px',
                lineHeight: 1.9,
                color: 'var(--muted)',
                backgroundColor: 'var(--panel2)',
                border: '1px solid var(--border)',
                borderRadius: '10px',
                padding: '10px 12px',
                marginBottom: '14px',
              }}
            >
              <div style={{ fontWeight: 800, color: 'var(--text)', marginBottom: '4px' }}>
                سه روش در کنارِ هم — هیچ‌کدام حذف نشده است:
              </div>
              <div>
                <b style={{ color: 'var(--text)' }}>۱) مطالعه در برنامه، بدونِ ساختِ فایلِ جدید:</b> حاشیه‌نویسی‌ها و بوک‌مارک‌ها در دیتابیسِ برنامه، متصل به همین فایل، ذخیره می‌شوند و با بستن و باز کردنِ برنامه باقی می‌مانند؛ فایلِ اصلی دست نمی‌خورد.
              </div>
              <div>
                <b style={{ color: 'var(--text)' }}>۲) کپیِ برداری با qpdf:</b> نسخهٔ بازگشایی‌شده با حفظِ کاملِ متن‌ها، فونت‌ها و جستجو؛ زوم در آن مثلِ روزِ اول شفاف است.
              </div>
              <div>
                <b style={{ color: 'var(--text)' }}>۳) کپیِ بازسازی‌شده (تصویری):</b> روشِ جایگزینِ فعلیِ پروژه؛ صفحه‌ها از سندِ بازشده بازسازی می‌شوند و لایهٔ متن در خودِ فایل حفظ نمی‌شود (جستجو در همین برنامه، از ایندکسِ کناری انجام می‌شود).
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                className="protected-modal-btn"
                onClick={() => handleProtectedCopyConfirm('qpdf')}
                disabled={isCreatingCopy || !protectedModal.qpdfAvailable}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--accent)',
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                  fontFamily: 'var(--font-fa)',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isCreatingCopy ? 'wait' : 'pointer',
                  opacity: isCreatingCopy ? 0.75 : 1,
                }}
              >
                {isCreatingCopy ? <Icons.Loader size={16} /> : <Icons.Copy size={16} />}
                <span>{isCreatingCopy ? 'در حالِ ساختِ نسخهٔ کپی…' : 'ساخت نسخهٔ کپیِ برداری (qpdf) و شروع ویرایش'}</span>
              </button>
              {!protectedModal.qpdfAvailable && !isCreatingCopy && (
                <div style={{ fontSize: '11.5px', lineHeight: 1.8, color: '#f59e0b' }}>
                  موتورِ qpdf در این سیستم در دسترس نیست؛ روشِ بازسازی را انتخاب کنید.
                </div>
              )}
              <button
                type="button"
                className="protected-modal-btn"
                onClick={() => handleProtectedCopyConfirm('rebuild')}
                disabled={isCreatingCopy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--panel2)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-fa)',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: isCreatingCopy ? 'wait' : 'pointer',
                  opacity: isCreatingCopy ? 0.75 : 1,
                }}
              >
                <Icons.FileText size={16} />
                <span>ساخت نسخهٔ کپیِ بازسازی‌شده و شروع ویرایش</span>
              </button>
              {isCreatingCopy && (
                <button
                  type="button"
                  className="protected-modal-btn"
                  onClick={() => { try { coreApi.cancelPdfCopy(); } catch (_) {} }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    backgroundColor: 'var(--panel2)',
                    color: 'var(--text)',
                    fontFamily: 'var(--font-fa)',
                    fontSize: '13px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Icons.X size={15} />
                  <span>لغوِ ساختِ کپی</span>
                </button>
              )}
              <button
                type="button"
                className="protected-modal-btn"
                onClick={handleProtectedMemoryOnly}
                disabled={isCreatingCopy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--panel2)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-fa)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isCreatingCopy ? 'wait' : 'pointer',
                }}
              >
                <Icons.Edit3 size={15} />
                <span>فقط حاشیه‌نویسی در حافظهٔ برنامه</span>
              </button>
              <button
                type="button"
                className="protected-modal-btn"
                onClick={handleProtectedCancel}
                disabled={isCreatingCopy}
                style={{
                  padding: '9px 14px',
                  borderRadius: '10px',
                  border: 'none',
                  backgroundColor: 'transparent',
                  color: 'var(--muted)',
                  fontFamily: 'var(--font-fa)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isCreatingCopy ? 'wait' : 'pointer',
                }}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
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
  // مرحله ۹: گزینهٔ «جستجو در فایلِ کنونی» — متمایز و هم‌خانواده
  // با گزینهٔ پرشِ مستقیم.
  searchInFileOption: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '10px 12px',
    borderRadius: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.35)',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    color: 'var(--accent)',
    fontSize: '12.5px',
    fontWeight: 700,
    cursor: 'pointer',
    marginTop: '6px',
    transition: 'background-color 0.15s ease',
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