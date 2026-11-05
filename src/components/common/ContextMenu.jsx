import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import useReaderStore from '../../store/useReaderStore';
import useLibraryStore from '../../store/useLibraryStore';
import useSettingsStore from '../../store/useSettingsStore';
import { coreApi } from '../../services/coreApi';
import thumbnailService from '../../services/thumbnailService';
import Icons from './Icons';
import useBookmarkStore, { resolveActiveBookKey } from '../../store/useBookmarkStore';
import { BOOKMARK_TEMPLATE_MAP, computeViewportCenterYRatio, resolveBookmarkImage } from '../reader/bookmarkTemplates';

export default function ContextMenu({ onOpenComic, onOpenFile }) {
  const isContextMenuOpen = useAppStore((state) => state.isContextMenuOpen);
  const contextMenuPos = useAppStore((state) => state.contextMenuPos);
  const contextMenuData = useAppStore((state) => state.contextMenuData);
  const closeContextMenu = useAppStore((state) => state.closeContextMenu);
  const openScreenshotModal = useAppStore((state) => state.openScreenshotModal);
  const setIsAreaZoomActive = useAppStore((state) => state.setIsAreaZoomActive);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const showToast = useAppStore((state) => state.showToast);

  const comicData = useReaderStore((state) => state.comicData);
  const resetZoom = useReaderStore((state) => state.resetZoom);
  const rotateClockwise = useReaderStore((state) => state.rotateClockwise);

  const libraryFolders = useLibraryStore((state) => state.libraryFolders || []);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const togglePin = useLibraryStore((state) => state.togglePin);
  const selectAndSetCustomCover = useLibraryStore((state) => state.selectAndSetCustomCover);
  const assignToFolder = useLibraryStore((state) => state.assignToFolder);

  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const currentView = useAppStore((state) => state.currentView);
  const bookmarkPreferences = useBookmarkStore((state) => state.preferences || {});
  const savedPresets = useBookmarkStore((state) => state.preferences?.savedPresets || []);
  const addBookmark = useBookmarkStore((state) => state.addBookmark);

  const [highlightStyle, setHighlightStyle] = useState({
    top: 0,
    height: 0,
    opacity: 0,
    isDanger: false,
  });

  const [isListHovered, setIsListHovered] = useState(false);
  const [hoveredActionId, setHoveredActionId] = useState(null);
  const [clickedActionId, setClickedActionId] = useState(null);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // مرحله ۹: نوارِ جستجویِ بالایِ منو — عبارت، با بسته شدنِ منو
  // پاک می‌شود تا باز شدنِ بعدی، همیشه خالی شروع شود.
  const [menuSearchQuery, setMenuSearchQuery] = useState('');
  const menuSearchInputRef = useRef(null);

  // استیت بخش‌های بازشونده (Collapsible Accordions) برای جلوگیری از شلوغی منو
  const [expandedSection, setExpandedSection] = useState(null); // 'library' | 'view' | 'bookmark' | null
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [menuDimensions, setMenuDimensions] = useState({ width: 256, height: 340 });


  const menuRef = useRef(null);
  const itemsRef = useRef({});

  const targetComicObj = contextMenuData?.comic || comicData;
  const hasComic = Boolean(targetComicObj);
  const filePath = resolveActiveBookKey(contextMenuData?.comic, comicData);

  const normPath = useMemo(() => {
    return filePath ? filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase() : '';
  }, [filePath]);

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

  const isPinned = useLibraryStore(
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

  const currentFolderId = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return null;
        const found = (state.library || []).find(
          (item) =>
            (item.path || item.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
            normPath
        );
        return found?.folderId || null;
      },
      [normPath]
    )
  );

  // ریست زیرمنوها هنگام بسته شدن و اندازه‌گیری دقیق ارتفاع برای مهار لبه‌های صفحه
  useEffect(() => {
    if (!isContextMenuOpen) {
      setExpandedSection(null);
      setShowFolderPicker(false);
      setHoveredActionId(null);
      setIsListHovered(false);
      setMenuSearchQuery('');
      setHighlightStyle((prev) => ({ ...prev, opacity: 0 }));
      return;
    }
    const rafId = requestAnimationFrame(() => {
      if (menuRef.current) {
        const rect = menuRef.current.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setMenuDimensions({ width: rect.width, height: rect.height });
        }
      }
      // مرحله ۹: فوکوسِ مستقیمِ کادرِ جستجو هنگامِ باز شدنِ منو،
      // تا کاربر بی‌درنگ تایپ کند و کلیدها به شورت‌کات‌ها نروند.
      try { menuSearchInputRef.current?.focus({ preventScroll: true }); } catch (_) { menuSearchInputRef.current?.focus(); }
    });
    return () => cancelAnimationFrame(rafId);
  }, [isContextMenuOpen, expandedSection, showFolderPicker, hasComic]);

  // ایزولاسیون ۱۰۰٪ چرخ ماوس (Scroll Trap): جلوگیری از اسکرول شدن صفحه کمیک/PDF زیرین
  useEffect(() => {
    if (!isContextMenuOpen) return;
    const el = menuRef.current;
    if (!el) return;

    const handleWheelTrap = (e) => {
      e.stopPropagation();
      const canScroll = el.scrollHeight > el.clientHeight;
      if (!canScroll) {
        e.preventDefault();
        return;
      }
      const isAtTop = el.scrollTop <= 0 && e.deltaY < 0;
      const isAtBottom =
        el.scrollTop + el.clientHeight >= el.scrollHeight - 1 && e.deltaY > 0;
      if (isAtTop || isAtBottom) {
        e.preventDefault();
      }
    };

    el.addEventListener('wheel', handleWheelTrap, { passive: false });
    return () => el.removeEventListener('wheel', handleWheelTrap);
  }, [isContextMenuOpen]);

  // مرحله ۹: حالتِ جستجو — اگر PDFای در ریدر باز است، جستجو در
  // فایلِ کنونی است؛ وگرنه جستجو در کتابخانه (از طریقِ سرچِ
  // سراسریِ TopBar).
  const isPdfReading = Boolean(
    comicData?.filePath && /\.pdf$/i.test(String(comicData.filePath))
  );

  const executeMenuSearch = useCallback(() => {
    const q = (menuSearchQuery || '').trim();
    closeContextMenu();
    if (isPdfReading) {
      // عبارتِ خالی = فقط باز کردنِ نوارِ جستجویِ PDF و فوکوس.
      useReaderStore.getState().triggerPdfSearch?.(q);
    } else {
      useAppStore.getState().setSearchQuery?.(q);
      useAppStore.getState().setIsSearchFocused?.(true);
    }
  }, [menuSearchQuery, isPdfReading, closeContextMenu]);

  const nextComic = comicData?.nextComic;
  const prevComic = comicData?.prevComic;

  const safePosition = useMemo(() => {
    const menuWidth = menuDimensions.width || 256;
    const menuHeight = menuDimensions.height || 340;
    const margin = 10;

    let x = contextMenuPos?.x || 0;
    let y = contextMenuPos?.y || 0;

    if (typeof window !== 'undefined') {
      if (x + menuWidth > window.innerWidth - margin) {
        x = window.innerWidth - menuWidth - margin;
      }
      if (x < margin) x = margin;

      if (y + menuHeight > window.innerHeight - margin) {
        y = Math.max(margin, window.innerHeight - menuHeight - margin);
      }
      if (y < margin) y = margin;
    }

    return { x, y };
  }, [contextMenuPos, menuDimensions]);

  const triggerExplosion = (x, y, isDanger = false) => {
    const container = document.createElement('div');
    container.className = 'click-explosion';
    container.style.position = 'fixed';
    container.style.left = `${x}px`;
    container.style.top = `${y}px`;
    container.style.pointerEvents = 'none';
    container.style.zIndex = '10001';

    const ring = document.createElement('div');
    ring.className = `explosion-ring ${isDanger ? 'danger' : ''}`;
    container.appendChild(ring);

    const particleCount = 10;
    for (let i = 0; i < particleCount; i++) {
      const particle = document.createElement('div');
      particle.className = `explosion-particle ${isDanger ? 'danger' : ''}`;

      const angle = (i / particleCount) * Math.PI * 2;
      const distance = 30 + Math.random() * 25;
      const tx = Math.cos(angle) * distance;
      const ty = Math.sin(angle) * distance;

      particle.style.setProperty('--tx', `${tx}px`);
      particle.style.setProperty('--ty', `${ty}px`);
      particle.style.animationDelay = `${Math.random() * 0.06}s`;

      container.appendChild(particle);
    }

    document.body.appendChild(container);
    setTimeout(() => {
      if (container && container.parentNode) {
        container.remove();
      }
    }, 700);
  };

  const handleItemMouseEnter = (id, isDanger = false) => {
    setHoveredActionId(id);
    setIsListHovered(true);
    const element = itemsRef.current[id];

    if (element) {
      setHighlightStyle({
        top: element.offsetTop,
        height: element.offsetHeight,
        opacity: 1,
        isDanger,
      });
    }
  };

  const handleMenuMouseLeave = () => {
    setIsListHovered(false);
    setHoveredActionId(null);
    setHighlightStyle((prev) => ({ ...prev, opacity: 0 }));
  };

  const handleActionClick = (e, actionFn, id, isDanger = false, keepOpen = false) => {
    e.stopPropagation();
    const clickX = e.clientX;
    const clickY = e.clientY;

    setClickedActionId(id);
    triggerExplosion(clickX, clickY, isDanger);

    if (keepOpen) {
      setTimeout(() => setClickedActionId(null), 160);
      actionFn();
      return;
    }

    setTimeout(() => {
      setClickedActionId(null);
      closeContextMenu();
      actionFn();
    }, 160);
  };

  // Stage 8 Part B: plain toggle again. The grid accordion keeps
  // sections mounted and animates their height, so no closing
  // timer/retention state is needed at all.
  const toggleSection = (secId) => {
    setHighlightStyle((prev) => ({ ...prev, opacity: 0 }));
    if (expandedSection === secId) {
      setExpandedSection(null);
      if (secId === 'library') setShowFolderPicker(false);
    } else {
      setExpandedSection(secId);
    }
    if (secId !== 'library') {
      setShowFolderPicker(false);
    }
  };

  // مرحله ۱۳: هدفِ بوک‌مارکِ نقطهٔ کلیک‌راست. اگر yRatio از ویوور
  // نیامده باشد (مثلاً منویِ کانتینر)، نقطهٔ مرکزِ دیدِ صفحهٔ فعال
  // مبناست.
  const bookmarkPage = Math.max(1, (Number(contextMenuData?.pageIndex) || 0) + 1);
  const bookmarkYRatio =
    typeof contextMenuData?.yRatio === 'number'
      ? contextMenuData.yRatio
      : computeViewportCenterYRatio(bookmarkPage);
  const isReaderMenu = currentView === 'reader';

  // مرحله ۱۴: افزودنِ بوک‌مارک با یک ساختِ سفارشیِ کاربر
  // (تمپلیت + عکس + نقطهٔ تمرکز + سمتِ همان پریست).
  const handleAddPresetBookmark = useCallback(async (preset) => {
    if (!preset || !filePath) return;
    const created = await addBookmark({
      filePath,
      page: bookmarkPage,
      yRatio: bookmarkYRatio,
      template: preset.template,
      image: preset.image || null,
      focalPoint: preset.focalPoint || 'center',
      side: preset.side || bookmarkPreferences.defaultSide || 'right',
      name: preset.name || '',
    });
    if (created) {
      showToast('بوک‌مارک ساخته شد.', { type: 'success' });
      closeContextMenu();
    }
  }, [filePath, bookmarkPage, bookmarkYRatio, bookmarkPreferences, addBookmark, showToast, closeContextMenu]);

  // لیست اکشن‌های منو با ساختار بازشونده (Accordion) و خلوت
  const actions = useMemo(() => {
    const list = [
      {
        id: 'next',
        label: 'فصل / فایل بعدی',
        shortcut: shortcuts?.nextChapter?.label || 'D',
        icon: <Icons.SkipForward size={15} />,
        disabled: !nextComic,
        onClick: () => nextComic && onOpenComic?.(nextComic.path),
      },
      {
        id: 'prev',
        label: 'فصل / فایل قبلی',
        shortcut: shortcuts?.prevChapter?.label || 'A',
        icon: <Icons.SkipBack size={15} />,
        disabled: !prevComic,
        onClick: () => prevComic && onOpenComic?.(prevComic.path),
      },
      { type: 'separator' },
      {
        id: 'areaZoom',
        label: 'زوم ناحیه‌ای با کشیدن باکس',
        shortcut: 'Alt+Z',
        icon: <Icons.ScanSearch size={15} />,
        disabled: !comicData,
        onClick: () => {
          setIsAreaZoomActive?.(true);
        },
      },
      {
        id: 'snip',
        label: 'ابزار برش و اسکرین‌شات',
        shortcut: shortcuts?.quickSnip?.label || 'Ctrl+Shift+S',
        icon: <Icons.Scissors size={15} />,
        disabled: !comicData,
        onClick: () => openScreenshotModal(contextMenuData),
      },
      {
        id: 'copy',
        label: copyFeedback ? 'در کلیپ‌بورد کپی شد!' : 'کپی تصویر این صفحه',
        shortcut: shortcuts?.copyPage?.label || 'Ctrl+C',
        icon: <Icons.Copy size={15} />,
        disabled: !comicData,
        onClick: async () => {
          if (!comicData) return;
          const liveCurrentPage = useReaderStore.getState().currentPage || 1;
          const totalPages = comicData.items?.length || 1;
          const rawIndex = contextMenuData?.pageIndex ?? liveCurrentPage - 1;
          const safeIndex = Math.max(0, Math.min(rawIndex, totalPages - 1));
          const targetItem = comicData.items?.[safeIndex];
          const imgPath = contextMenuData?.imagePath || targetItem?.path;
          const dataUrl = contextMenuData?.dataUrl || null;

          if (dataUrl || imgPath) {
            const res = await coreApi.copyImageToClipboard({
              dataUrl,
              filePath: imgPath,
            });
            if (res?.success) {
              setCopyFeedback(true);
              showToast('تصویر صفحه در کلیپ‌بورد کپی شد', { type: 'success' });
              setTimeout(() => setCopyFeedback(false), 800);
            } else {
              showToast(res?.error || 'خطا در کپی تصویر صفحه', { type: 'error' });
            }
          }
        },
      },
      {
        id: 'favorite',
        label: isFav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها',
        shortcut: isFav ? '❤️' : '🤍',
        icon: <Icons.Heart size={15} filled={isFav} />,
        disabled: !hasComic,
        onClick: () => {
          if (!hasComic) return;
          const added = toggleFavorite(targetComicObj);
          showToast(
            added ? 'به علاقه‌مندی‌ها اضافه شد' : 'از علاقه‌مندی‌ها حذف شد',
            { type: added ? 'success' : 'info' }
          );
        },
      },
      { type: 'separator' },

      // بخش بازشونده ۱: مدیریت در کتابخانه، کاور و پوشه
      {
        id: 'acc_library',
        type: 'accordion',
        label: 'مدیریت در کتابخانه و کاور',
        isOpen: expandedSection === 'library',
        icon: <Icons.Library size={15} />,
        disabled: !hasComic,
        onClick: () => toggleSection('library'),
      },
    ];

    // Stage 8 Part B: sub-items stay mounted; the grid accordion
    // below animates their height. (Part A conditionally mounted
    // them, so their height snapped 0 <-> full in 0ms.)
    if (hasComic) {
      list.push(
        {
          id: 'pinLibrary',
          isSubItem: true,
          section: 'library',
          label: isPinned ? 'برداشتن پین از صدر کتابخانه' : 'پین کردن در صدر کتابخانه',
          shortcut: isPinned ? '📌' : '',
          icon: <Icons.Pin size={14} filled={isPinned} />,
          onClick: async () => {
            const pinnedNow = await togglePin(targetComicObj);
            showToast(
              pinnedNow ? 'در صدر کتابخانه پین شد' : 'از حالت پین خارج شد',
              { type: pinnedNow ? 'success' : 'info' }
            );
          },
        },
        {
          id: 'customCover',
          isSubItem: true,
          section: 'library',
          label: 'تنظیم تصویر کاور سفارشی...',
          icon: <Icons.Image size={14} />,
          onClick: async () => {
            if (!filePath) return;
            const res = await selectAndSetCustomCover(filePath);
            if (res?.success && res?.cover) {
              thumbnailService.seedCover?.(filePath, res.cover);
              showToast('تصویر کاور سفارشی با موفقیت ذخیره شد', { type: 'success' });
            }
          },
        },
        {
          id: 'moveToFolder',
          isSubItem: true,
          section: 'library',
          label: 'انتقال به پوشه کتابخانه...',
          shortcut: showFolderPicker ? '▲' : '▼',
          icon: <Icons.FolderPlus size={14} />,
          keepOpen: true,
          onClick: () => setShowFolderPicker((prev) => !prev),
        },
        {
          id: 'explorer',
          isSubItem: true,
          section: 'library',
          label: 'نمایش در فایل اکسپلورر',
          icon: <Icons.Folder size={14} />,
          onClick: () => filePath && coreApi.showItemInFolder(filePath),
        }
      );
    }

    // بخش بازشونده ۲: تنظیمات نمایش، چرخش و فایل
    list.push({
      id: 'acc_view',
      type: 'accordion',
      label: 'ابزارهای نمایش و سیستم',
      isOpen: expandedSection === 'view',
      icon: <Icons.Sliders size={15} />,
      onClick: () => toggleSection('view'),
    });

    list.push(
        {
          id: 'rotate',
          isSubItem: true,
          section: 'view',
          label: 'چرخش ۹۰ درجه صفحه',
          shortcut: shortcuts?.rotatePage?.label || 'R',
          icon: <Icons.RotateCw size={14} />,
          disabled: !comicData,
          onClick: () => rotateClockwise(),
        },
        {
          id: 'zoomReset',
          isSubItem: true,
          section: 'view',
          label: 'اندازه طبیعی (100%)',
          shortcut: shortcuts?.resetZoom?.label || '0',
          icon: <Icons.Maximize size={14} />,
          disabled: !comicData,
          onClick: () => resetZoom(),
        },
        {
          id: 'fullscreen',
          isSubItem: true,
          section: 'view',
          label: 'حالت تمام‌صفحه ویندوز',
          shortcut: shortcuts?.fullscreen?.label || 'F11',
          icon: <Icons.Maximize size={14} />,
          onClick: () => coreApi.toggleFullscreen(),
        },
        {
          id: 'openFile',
          isSubItem: true,
          section: 'view',
          label: 'باز کردن فایل جدید',
          shortcut: shortcuts?.openFile?.label || 'Ctrl+O',
          icon: <Icons.FolderOpen size={14} />,
          onClick: () => onOpenFile?.(),
        },
        {
          id: 'openFolder',
          isSubItem: true,
          section: 'view',
          label: 'باز کردن پوشه',
          icon: <Icons.Folder size={14} />,
          onClick: async () => {
            try {
              const r = await coreApi.openFolder();
              if (r && r.success && r.filePath) onOpenComic?.(r.filePath);
            } catch (_) {}
          },
        },
        {
          id: 'settings',
          isSubItem: true,
          section: 'view',
          label: 'تنظیمات و میانبرها',
          shortcut: shortcuts?.openSettings?.label || 'Ctrl+,',
          icon: <Icons.Settings size={14} />,
          onClick: () => setCurrentView('settings'),
        }
      );

    // مرحله ۱۳: بخشِ بوک‌مارکِ دیجیتال — فقط وقتی در محیطِ مطالعه
    // هستیم و کتابی باز است.
    if (hasComic && isReaderMenu) {
      list.push({
        id: 'acc_bookmark',
        type: 'accordion',
        label: 'بوک‌مارکِ دیجیتال',
        isOpen: expandedSection === 'bookmark',
        icon: <Icons.Bookmark size={15} />,
        onClick: () => toggleSection('bookmark'),
      });

      // مرحله ۱۵ — جریانِ سایدبار-اول: منو، فقط مصرف‌کنندهٔ
      // تمپلیت‌هایِ ساخته‌شده در صفحهٔ بوک‌مارک‌هاست (ساختِ تمپلیتِ
      // خام و استودیویِ نقطه‌ای، از منو حذف شدند). اگر هنوز تمپلیتی
      // ساخته نشده، به‌جایِ لیستِ خام، یک کارتِ هدایتگر نشان داده
      // می‌شود؛ وگرنه همان تمپلیت‌ها به‌صورتِ کارتی (تصویرِ کوچک +
      // نام + نوعِ انیمیشن) + دکمهٔ ساختِ تازه در پایینِ لیست.
      // کلیک رویِ هر کارت، همان بوک‌مارک را در همین صفحه و همین
      // مختصاتِ عمودی، رویِ حاشیهٔ ۱۳ پیکسلیِ کاغذ می‌نشاند.
      const goToBookmarkBuilder = () => {
        setCurrentView('bookmarks');
        closeContextMenu();
      };
      if (savedPresets.length === 0) {
        list.push({
          id: 'bm-go-to-builder',
          isSubItem: true,
          section: 'bookmark',
          label: (<span style={{ whiteSpace: 'normal', lineHeight: 1.7 }}>هنوز تمپلیت بوک‌مارکی نساخته‌اید — رفتن به بخش ساخت بوک‌مارک</span>),
          icon: <Icons.Bookmark size={14} />,
          onClick: goToBookmarkBuilder,
        });
      } else {
        list.push(
          ...savedPresets.map((preset) => {
            const presetImage = resolveBookmarkImage(
              { image: preset.image || null, template: preset.template },
              bookmarkPreferences
            );
            const animationLabel = BOOKMARK_TEMPLATE_MAP[preset.template]?.faLabel || preset.template;
            return {
              id: `bm-preset-${preset.id}`,
              isSubItem: true,
              section: 'bookmark',
              label: `${preset.name || `ساختِ ${animationLabel}`} — انیمیشنِ ${animationLabel}`,
              icon: presetImage
                ? <img src={presetImage} alt="" draggable={false} style={{ width: '18px', height: '26px', objectFit: 'cover', borderRadius: '3px', display: 'block' }} />
                : <Icons.Bookmark size={14} />,
              onClick: () => handleAddPresetBookmark(preset),
            };
          }),
          {
            id: 'bm-new-preset',
            isSubItem: true,
            section: 'bookmark',
            label: '+ ساخت تمپلیت جدید در بخش بوک‌مارک‌ها',
            icon: <Icons.Plus size={14} />,
            onClick: goToBookmarkBuilder,
          }
        );
      }
    }

    list.push(
      { type: 'separator' },
      {
        id: 'closeComic',
        label: 'بستن فایل جاری',
        shortcut: 'Esc',
        isDanger: true,
        icon: <Icons.X size={15} />,
        disabled: !comicData,
        onClick: () => {
          window.dispatchEvent(new CustomEvent('app:close-comic'));
        },
      }
    );

    return list;
  }, [
    nextComic,
    prevComic,
    comicData,
    hasComic,
    isFav,
    isPinned,
    copyFeedback,
    expandedSection,
    showFolderPicker,
    shortcuts,
    contextMenuData,
    filePath,
    targetComicObj,
    onOpenComic,
    onOpenFile,
    openScreenshotModal,
    setIsAreaZoomActive,
    toggleFavorite,
    togglePin,
    selectAndSetCustomCover,
    rotateClockwise,
    resetZoom,
    setCurrentView,
    showToast,
    isReaderMenu,
    savedPresets,
    handleAddPresetBookmark,
    closeContextMenu,
  ]);

  // Stage 8 Part B: one menu row. Extracted verbatim from the old
  // flat map so row behaviour (hover, click, highlight, chevron)
  // is unchanged; only the accordion grouping around it is new.
  // The chevron now rotates on the prompt's 250ms spring curve.
  const renderMenuItem = (action) => {
    const isAccordion = action.type === 'accordion';
    const isHovered = hoveredActionId === action.id;
    const isClicked = clickedActionId === action.id;
    const isDimmed = isListHovered && !isHovered && !action.disabled;
    const isDanger = Boolean(action.isDanger);
    return (
                <div
                  ref={(el) => (itemsRef.current[action.id] = el)}
                  className={isClicked ? 'menu-item-clicked' : ''}
                  onMouseEnter={() =>
                    !action.disabled && handleItemMouseEnter(action.id, isDanger)
                  }
                  onClick={(e) =>
                    !action.disabled &&
                    handleActionClick(
                      e,
                      action.onClick,
                      action.id,
                      isDanger,
                      Boolean(action.keepOpen || isAccordion)
                    )
                  }
                  style={{
                    ...styles.menuItem,
                    ...(action.isSubItem ? styles.subMenuItem : {}),
                    ...(isAccordion && action.isOpen ? styles.accordionOpenItem : {}),
                    color: action.disabled
                      ? '#484F58'
                      : isDanger
                      ? isHovered
                        ? '#ff7b74'
                        : '#F85149'
                      : isAccordion && action.isOpen
                      ? '#22d3ee'
                      : isHovered
                      ? '#ffffff'
                      : '#C9D1D9',
                    opacity: action.disabled ? 0.35 : isDimmed ? 0.78 : 1,
                    cursor: action.disabled ? 'default' : 'pointer',
                    // مرحله ۸ ـ اصلاحِ نهاییِ تأییدشده: زوم و
                    // برجسته‌شدنِ کلِ ردیف هنگامِ هاور، دقیقاً با
                    // مقادیرِ پرامپت (زومِ 1.035 + لغزشِ 3px + سایهٔ
                    // عمق‌دهنده + روشن‌تر شدنِ پس‌زمینه). ردیف‌های
                    // غیرفعال، هرگز زوم نمی‌شوند.
                    transform: isHovered && !action.disabled ? 'scale(1.035) translateX(-3px)' : 'scale(1) translateX(0)',
                    boxShadow: isHovered && !action.disabled
                      ? '0 6px 16px -4px rgba(0, 0, 0, 0.45), 0 0 12px -2px rgba(99, 102, 241, 0.25)'
                      : 'none',
                    backgroundColor: isHovered && !action.disabled ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                  }}
                >
                  <span
                    style={{
                      ...styles.iconWrapper,
                      color: action.disabled
                        ? '#484F58'
                        : isDanger
                        ? '#F85149'
                        : isHovered || (isAccordion && action.isOpen)
                        ? '#22d3ee'
                        : '#8B949E',
                      transform:
                        isHovered && !action.disabled
                          ? 'translateX(-2px) scale(1.08)'
                          : 'none',
                    }}
                  >
                    {action.icon}
                  </span>

                  <span style={styles.label}>{action.label}</span>

                  {isAccordion ? (
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        color: action.isOpen ? '#22d3ee' : '#8B949E',
                        transition: 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)',
                        transform: action.isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                      }}
                    >
                      <Icons.ChevronDown size={13} />
                    </span>
                  ) : (
                    action.shortcut && (
                      <span
                        style={{
                          ...styles.shortcutBadge,
                          color: isHovered && !action.disabled ? '#22d3ee' : '#6E7681',
                          backgroundColor:
                            isHovered && !action.disabled
                              ? 'rgba(34, 211, 238, 0.1)'
                              : 'rgba(255, 255, 255, 0.03)',
                          borderColor:
                            isHovered && !action.disabled
                              ? 'rgba(34, 211, 238, 0.3)'
                              : '#21262C',
                        }}
                      >
                        {action.shortcut}
                      </span>
                    )
                  )}
                </div>

    );
  };

  // Stage 8 Part B: menu zoom restored to the exact pre-Part-A
  // behaviour — render only while open, no exit retention, no
  // dynamic transformOrigin, no fade-out override. The entry
  // keyframe below is byte-identical to the pre-Part-A one
  // (scale(0.94) + translateY(-6px), 0.18s, spring curve).
  if (!isContextMenuOpen) return null;

  return (
    <>
      <style>{`
        @keyframes contextMenuFadeIn {
          from { opacity: 0; transform: scale(0.94) translateY(-6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes indicatorPulse {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px #22d3ee; }
          50% { opacity: 0.6; box-shadow: 0 0 14px #22d3ee; }
        }
        @keyframes indicatorPulseDanger {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px #F85149; }
          50% { opacity: 0.6; box-shadow: 0 0 14px #F85149; }
        }
        @keyframes ring-expand {
          0% { width: 10px; height: 10px; opacity: 1; border-width: 3px; }
          100% { width: 70px; height: 70px; opacity: 0; border-width: 0.5px; }
        }
        @keyframes particle-fly {
          0% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
          100% { opacity: 0; transform: translate(var(--tx), var(--ty)) scale(0.3); }
        }
        @keyframes item-squeeze {
          0% { transform: scale(1); }
          30% { transform: scale(0.95) translateX(-2px); }
          60% { transform: scale(1.01); }
          100% { transform: scale(1); }
        }
        .explosion-ring {
          position: absolute;
          width: 10px;
          height: 10px;
          border: 2px solid #22d3ee;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          animation: ring-expand 0.55s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .explosion-ring.danger {
          border-color: #F85149;
        }
        .explosion-particle {
          position: absolute;
          width: 4.5px;
          height: 4.5px;
          background: #22d3ee;
          border-radius: 50%;
          transform: translate(-50%, -50%);
          animation: particle-fly 0.65s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          box-shadow: 0 0 6px #22d3ee;
        }
        .explosion-particle.danger {
          background: #F85149;
          box-shadow: 0 0 6px #F85149;
        }
        .menu-item-clicked {
          animation: item-squeeze 0.32s cubic-bezier(0.34, 1.56, 0.64, 1) !important;
        }
      `}</style>

      <div
        id="custom-context-menu"
        ref={menuRef}
        onMouseLeave={handleMenuMouseLeave}
        onClick={(e) => e.stopPropagation()}
        style={{
          ...styles.ctxMenu,
          left: `${safePosition.x}px`,
          top: `${safePosition.y}px`,
        }}
      >
        <div style={styles.menuList}>
          {/* مرحله ۹: نوارِ جستجویِ بالایِ منو — تایپ داخلِ آن،
              هرگز منو را نمی‌بندد و شورت‌کات‌ها را فعال نمی‌کند
              (stopPropagation در همهٔ رویدادهایِ ورودی). */}
          <div
            style={styles.menuSearchBar}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <span style={styles.menuSearchIcon}>
              <Icons.Search size={15} />
            </span>
            <input
              ref={menuSearchInputRef}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={menuSearchQuery}
              placeholder={isPdfReading ? 'جستجو در فایل کنونی...' : 'جستجو در کتابخانه...'}
              onChange={(e) => setMenuSearchQuery(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  executeMenuSearch();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  closeContextMenu();
                }
              }}
              style={styles.menuSearchInput}
            />
            <button
              type="button"
              title="جستجو"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                executeMenuSearch();
              }}
              style={styles.menuSearchBtn}
            >
              <Icons.Search size={14} />
            </button>
          </div>
          <div
            style={{
              ...styles.slidingHighlight,
              transform: `translateY(${highlightStyle.top}px)`,
              height: `${highlightStyle.height}px`,
              opacity: highlightStyle.opacity,
              background: highlightStyle.isDanger
                ? 'linear-gradient(90deg, rgba(248, 81, 73, 0.16), rgba(248, 81, 73, 0.08))'
                : 'linear-gradient(90deg, rgba(34, 211, 238, 0.16), rgba(34, 211, 238, 0.06))',
              borderColor: highlightStyle.isDanger
                ? 'rgba(248, 81, 73, 0.45)'
                : 'rgba(34, 211, 238, 0.45)',
              boxShadow: highlightStyle.isDanger
                ? '0 0 18px rgba(248, 81, 73, 0.22)'
                : '0 0 18px rgba(34, 211, 238, 0.18)',
            }}
          >
            <div
              style={{
                ...styles.highlightIndicatorBar,
                backgroundColor: highlightStyle.isDanger ? '#F85149' : '#22d3ee',
                animation: highlightStyle.isDanger
                  ? 'indicatorPulseDanger 1.8s ease-in-out infinite'
                  : 'indicatorPulse 1.8s ease-in-out infinite',
              }}
            />
          </div>

          {(() => {
            // Stage 8 Part B: group the flat actions list into
            // accordion segments (header + its sub-items) so each
            // section renders inside ONE grid-height container.
            const segments = [];
            let pending = null;
            for (const action of actions) {
              if (action.type === 'accordion') {
                pending = { header: action, children: [] };
                segments.push(pending);
              } else if (action.isSubItem && pending) {
                pending.children.push(action);
              } else {
                pending = null;
                segments.push({ item: action });
              }
            }
            return segments.map((seg, segIdx) => {
              if (seg.item) {
                const action = seg.item;
                if (action.type === 'separator') {
                  return <div key={`sep-${segIdx}`} style={styles.separator} />;
                }
                return <React.Fragment key={action.id}>{renderMenuItem(action)}</React.Fragment>;
              }
              // مرحله ۱۴ — رفعِ علتِ «در کلیک‌راست هیچی نیست»:
              // نسخهٔ قبلی، هر هدرِ غیرِ library را 'view' می‌دانست،
              // پس آکاردئونِ بوک‌مارک هرگز باز نمی‌شد (isOpen آن
              // با 'bookmark' سنجیده می‌شد ولی رندر با 'view') و
              // آیتم‌هایِ بوک‌مارک، فقط با باز شدنِ بخشِ view، زیرِ
              // هدرِ اشتباه دیده می‌شدند.
              const sectionId = seg.header.id === 'acc_library' ? 'library' : seg.header.id === 'acc_bookmark' ? 'bookmark' : 'view';
              const isOpen = expandedSection === sectionId;
              return (
                <React.Fragment key={seg.header.id}>
                  {renderMenuItem(seg.header)}
                  <div style={{ display: 'grid', gridTemplateRows: isOpen ? '1fr' : '0fr', opacity: isOpen ? 1 : 0, transition: 'grid-template-rows 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease, margin-top 240ms cubic-bezier(0.16, 1, 0.3, 1)', marginTop: isOpen ? '6px' : '0px', pointerEvents: isOpen ? 'auto' : 'none' }}>
                    <div style={{ overflow: 'hidden', minHeight: 0 }}>
                      {seg.children.map((child) => (
                        <React.Fragment key={child.id}>
                          {renderMenuItem(child)}
                          {child.id === 'moveToFolder' && hasComic && (
                            <div style={{ display: 'grid', gridTemplateRows: showFolderPicker ? '1fr' : '0fr', opacity: showFolderPicker ? 1 : 0, transition: 'grid-template-rows 260ms cubic-bezier(0.16, 1, 0.3, 1), opacity 200ms ease, margin-top 240ms cubic-bezier(0.16, 1, 0.3, 1)', marginTop: showFolderPicker ? '6px' : '0px', pointerEvents: showFolderPicker ? 'auto' : 'none' }}>
                              <div style={{ overflow: 'hidden', minHeight: 0 }}>
                  <div
                    style={{
                      ...styles.folderPickerBox,
                    }}
                    onMouseEnter={handleMenuMouseLeave}
                    onWheel={(e) => e.stopPropagation()}
                  >
                    <div
                      onClick={async () => {
                        await assignToFolder(targetComicObj, null);
                        closeContextMenu();
                        showToast('از پوشه خارج شد (نمایش در نمای کلی)', { type: 'info' });
                      }}
                      style={{
                        ...styles.folderOption,
                        color: !currentFolderId ? '#22d3ee' : '#C9D1D9',
                        borderColor: !currentFolderId
                          ? 'rgba(34, 211, 238, 0.35)'
                          : 'transparent',
                      }}
                    >
                      <span>بدون پوشه (همه کتاب‌ها)</span>
                      {!currentFolderId && <Icons.Check size={13} />}
                    </div>

                    {libraryFolders.length > 0 ? (
                      libraryFolders.map((folder) => {
                        const isAssigned = currentFolderId === folder.id;
                        return (
                          <div
                            key={folder.id}
                            onClick={async () => {
                              await assignToFolder(targetComicObj, folder.id);
                              closeContextMenu();
                              showToast(`به پوشه «${folder.name}» منتقل شد`, {
                                type: 'success',
                              });
                            }}
                            style={{
                              ...styles.folderOption,
                              color: isAssigned ? '#22d3ee' : '#C9D1D9',
                              borderColor: isAssigned
                                ? 'rgba(34, 211, 238, 0.35)'
                                : 'transparent',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span
                                style={{
                                  width: '8px',
                                  height: '8px',
                                  borderRadius: '50%',
                                  backgroundColor: folder.color || '#22d3ee',
                                }}
                              />
                              <span>{folder.name}</span>
                            </div>
                            {isAssigned && <Icons.Check size={13} />}
                          </div>
                        );
                      })
                    ) : (
                      <div style={styles.emptyFoldersHint}>
                        هنوز پوشه‌ای در کتابخانه نساخته‌اید.
                      </div>
                    )}
                  </div>
                              </div>
                            </div>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </React.Fragment>
              );
            });
          })()}
        </div>
      </div>
    </>
  );
}

const styles = {
  ctxMenu: {
    position: 'fixed',
    width: '256px',
    maxHeight: '84vh',
    overflowY: 'auto',
    overflowX: 'hidden',
    overscrollBehavior: 'contain',
    backgroundColor: 'rgba(13, 17, 23, 0.97)',
    backdropFilter: 'blur(22px)',
    WebkitBackdropFilter: 'blur(22px)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#30363D',
    borderRadius: '14px',
    padding: '6px',
    zIndex: 10000,
    boxShadow: '0 18px 50px rgba(0, 0, 0, 0.8)',
    userSelect: 'none',
    direction: 'rtl',
    animation: 'contextMenuFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) forwards',
    boxSizing: 'border-box',
  },
  menuList: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    width: '100%',
    boxSizing: 'border-box',
  },
  // مرحله ۹: نوارِ جستجویِ بالایِ منو — هم‌خانواده با طراحیِ
  // شیشه‌ایِ منو، بدونِ backdrop-filterِ اضافه.
  menuSearchBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '5px 8px',
    marginBottom: '4px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#30363D',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    position: 'relative',
    zIndex: 2,
    boxSizing: 'border-box',
  },
  menuSearchIcon: {
    color: '#8B949E',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  menuSearchInput: {
    flex: 1,
    minWidth: 0,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: '#C9D1D9',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    direction: 'rtl',
    textAlign: 'right',
    padding: '2px 0',
  },
  menuSearchBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.35)',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    color: '#22d3ee',
    cursor: 'pointer',
    flexShrink: 0,
    padding: 0,
  },
  slidingHighlight: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    width: '100%',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    pointerEvents: 'none',
    zIndex: 1,
    boxSizing: 'border-box',
    transition:
      'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.16s ease, height 0.16s ease',
  },
  highlightIndicatorBar: {
    position: 'absolute',
    top: '4px',
    right: '2px',
    width: '3px',
    height: 'calc(100% - 8px)',
    borderRadius: '3px',
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '7px 10px',
    borderRadius: '8px',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    position: 'relative',
    zIndex: 2,
    boxSizing: 'border-box',
    // مرحله ۸ ـ اصلاحِ نهاییِ تأییدشده: transitionِ فنریِ دقیقِ
    // پرامپت، به‌همراهِ opacity برای نرمیِ کم‌رنگ‌شدنِ ردیف‌های
    // غیرِهاور (رفتارِ قبلیِ isDimmed). transform-origin، مرکزِ
    // ردیف است تا زوم، متقارن باشد.
    transition: 'transform 220ms cubic-bezier(0.16, 1, 0.3, 1), background 180ms ease, border-color 180ms ease, box-shadow 220ms ease, color 150ms ease, opacity 0.18s ease',
    transformOrigin: 'center center',
    willChange: 'transform',
  },
  subMenuItem: {
    paddingRight: '22px',
    fontSize: '12px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  accordionOpenItem: {
    backgroundColor: 'rgba(34, 211, 238, 0.06)',
  },
  iconWrapper: {
    width: '16px',
    height: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'color 0.18s ease, transform 0.22s ease',
  },
  label: {
    flex: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    textAlign: 'right',
  },
  shortcutBadge: {
    fontSize: '10.5px',
    fontFamily: 'var(--font-mono)',
    padding: '1.5px 6px',
    borderRadius: '5px',
    borderWidth: '1px',
    borderStyle: 'solid',
    direction: 'ltr',
    flexShrink: 0,
    transition: 'all 0.2s ease',
  },
  separator: {
    height: '1px',
    backgroundColor: '#21262C',
    margin: '3px 2px',
    position: 'relative',
    zIndex: 2,
  },
  folderPickerBox: {
    backgroundColor: 'rgba(10, 15, 19, 0.92)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: '#30363D',
    borderRadius: '8px',
    padding: '4px',
    margin: '2px 14px 4px 6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    maxHeight: '120px',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    position: 'relative',
    zIndex: 3,
  },
  folderOption: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 8px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    backgroundColor: 'rgba(255,255,255,0.02)',
  },
  emptyFoldersHint: {
    padding: '6px',
    textAlign: 'center',
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    color: '#8B949E',
  },
};