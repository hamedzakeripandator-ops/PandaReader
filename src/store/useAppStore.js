import { create } from 'zustand';

let toastTimerId = null;

const useAppStore = create((set, get) => ({
  // ویوهای معتبر: 'home' | 'library' | 'recent' | 'favorites' | 'downloads' | 'settings' | 'profile' | 'reader'
  currentView: 'home',
  isLeftSidebarOpen: false,
  isRightSidebarOpen: false,

  // جستجوی زنده سراسری
  searchQuery: '',
  isSearchFocused: false,

  // منوی کلیک‌راست
  isContextMenuOpen: false,
  contextMenuPos: { x: 0, y: 0 },
  contextMenuData: null,

  // اسکرین‌شات، برش، زوم باکسی و تنظیمات سریع
  isScreenshotModalOpen: false,
  isSnippingActive: false,
  isAreaZoomActive: false,
  activeCaptureTarget: null,
  isQuickSettingsOpen: false,

  // =========================================================================
  // استیت‌های استودیو ویرایش و حاشیه‌نویسی (فقط با دکمه TopBar فعال می‌شود)
  // ابزارها: 'select' | 'box' | 'highlighter' | 'pen' | 'arrow' | 'text' | 'sticky' | 'eraser'
  // =========================================================================
  isAnnotationActive: false,
  annotationTool: 'box',
  annotationBoxStyle: 'cloud', // 'cloud' | 'rect' | 'round'
  annotationHasFill: true,
  annotationColor: '#06b6d4',
  annotationStrokeWidth: 4,
  annotationOpacity: 0.85,
  annotationFontFamily: "'Estedad', 'Vazirmatn', sans-serif",
  annotationFontSize: 22,
  annotationArrowStyle: 'straight', // 'straight' | 'curved'
  annotationHasStartDot: true, // Refinement Step 2: دایرهٔ مبدأِ فلشِ جدید
  annotationHasEndArrow: true, // Refinement Step 2: تیکِ انتهای فلشِ جدید
  selectedAnnotationId: null,
  selectedAnnotationIds: [], // مولتی‌سلکت (مارکی)
  selectedAnnotationPage: null,
  selectedAnnotationTool: null,

  // اعلان HUD
  toast: {
    visible: false,
    message: '',
    type: 'info',
    icon: '',
    id: 0,
  },

  // ۱. مدیریت جستجو
  setSearchQuery: (query) => set({ searchQuery: typeof query === 'string' ? query : '' }),
  clearSearch: () => set({ searchQuery: '' }),
  setIsSearchFocused: (focused) => set({ isSearchFocused: Boolean(focused) }),

  // ۲. مدیریت Toast HUD
  showToast: (message, options = {}) => {
    const {
      type = 'info',
      icon = '',
      duration = 2200,
    } = typeof options === 'string' ? { type: options } : options;

    if (toastTimerId) {
      clearTimeout(toastTimerId);
      toastTimerId = null;
    }

    const defaultIcons = {
      success: '',
      error: '',
      warning: '',
      info: '',
    };

    set({
      toast: {
        visible: true,
        message,
        type,
        icon: icon || defaultIcons[type] || '',
        id: Date.now(),
      },
    });

    toastTimerId = setTimeout(() => {
      set((state) => ({
        toast: { ...state.toast, visible: false },
      }));
      toastTimerId = null;
    }, duration);
  },

  hideToast: () => {
    if (toastTimerId) {
      clearTimeout(toastTimerId);
      toastTimerId = null;
    }
    set((state) => ({
      toast: { ...state.toast, visible: false },
    }));
  },

  // ۳. مدیریت منوی کلیک‌راست
  openContextMenu: (pos, data = null) => {
    if (get().isSnippingActive || get().isAreaZoomActive) return;
    set({
      isContextMenuOpen: true,
      contextMenuPos: pos,
      contextMenuData: data,
    });
  },

  closeContextMenu: () => set({ isContextMenuOpen: false }),

  // ۴. مدیریت اسکرین‌شات و برش
  openScreenshotModal: (targetData = null) => {
    const currentData = targetData || get().contextMenuData;
    set({
      isContextMenuOpen: false,
      isAreaZoomActive: false,
      isScreenshotModalOpen: true,
      activeCaptureTarget: currentData,
    });
  },

  closeScreenshotModal: () =>
    set({
      isScreenshotModalOpen: false,
      activeCaptureTarget: null,
    }),

  setIsSnippingActive: (isActive) => {
    const next = Boolean(isActive);
    set({
      isSnippingActive: next,
      isContextMenuOpen: false,
      ...(next ? { isAnnotationActive: false, isAreaZoomActive: false } : {}),
    });
  },

  // ۵. مدیریت زوم ناحیه‌ای با کشیدن باکس (Area Box Zoom)
  setIsAreaZoomActive: (isActive) => {
    const next = Boolean(isActive);
    set({
      isAreaZoomActive: next,
      isContextMenuOpen: false,
      ...(next
        ? {
            isSnippingActive: false,
            isScreenshotModalOpen: false,
            isAnnotationActive: false,
          }
        : {}),
    });
  },

  toggleAreaZoom: () => {
    const next = !get().isAreaZoomActive;
    get().setIsAreaZoomActive(next);
    return next;
  },

  // ۶. مودال تنظیمات سریع
  openQuickSettings: () =>
    set({
      isContextMenuOpen: false,
      isQuickSettingsOpen: true,
    }),

  closeQuickSettings: () => set({ isQuickSettingsOpen: false }),

  // =========================================================================
  // ۷. مدیریت انحصاری استودیو ویرایش و حاشیه‌نویسی (متصل به دکمه TopBar)
  // =========================================================================
  setIsAnnotationActive: (active) => {
    const next = Boolean(active);
    set({
      isAnnotationActive: next,
      isContextMenuOpen: false,
      ...(next
        ? { isSnippingActive: false, isAreaZoomActive: false }
        : { selectedAnnotationId: null, selectedAnnotationIds: [], selectedAnnotationPage: null, selectedAnnotationTool: null }),
    });
  },

  toggleAnnotationMode: () =>
    set((state) => {
      const nextActive = !state.isAnnotationActive;
      return {
        isAnnotationActive: nextActive,
        isContextMenuOpen: false,
        isSnippingActive: false,
        isAreaZoomActive: false,
        ...(!nextActive
          ? { selectedAnnotationId: null, selectedAnnotationIds: [], selectedAnnotationPage: null, selectedAnnotationTool: null }
          : {}),
      };
    }),

  setAnnotationTool: (tool) =>
    set((state) => ({
      annotationTool: tool || state.annotationTool,
      ...(tool !== 'select'
        ? { selectedAnnotationId: null, selectedAnnotationIds: [], selectedAnnotationPage: null, selectedAnnotationTool: null }
        : {}),
    })),

  selectAnnotationTool: (tool, color = null) =>
    set((state) => ({
      annotationTool: tool || state.annotationTool,
      ...(color ? { annotationColor: color } : {}),
      ...(tool !== 'select'
        ? { selectedAnnotationId: null, selectedAnnotationPage: null }
        : {}),
    })),

  setAnnotationBoxStyle: (style) =>
    set({
      annotationBoxStyle: ['cloud', 'rect', 'round'].includes(style) ? style : 'cloud',
    }),

  setAnnotationHasFill: (hasFill) => set({ annotationHasFill: Boolean(hasFill) }),

  toggleAnnotationFill: () =>
    set((state) => ({ annotationHasFill: !state.annotationHasFill })),

  setAnnotationColor: (color) => set({ annotationColor: color || '#06b6d4' }),

  setAnnotationStrokeWidth: (width) =>
    set({
      annotationStrokeWidth: Math.max(1, Math.min(24, Number(width) || 4)),
    }),

  setAnnotationOpacity: (opacity) => {
    const num = Number(opacity);
    const normalized = num > 1 ? num / 100 : num;
    set({
      annotationOpacity: Math.max(0.15, Math.min(1, Number(normalized.toFixed(2)) || 0.85)),
    });
  },

  setAnnotationFontFamily: (family) =>
    set({ annotationFontFamily: family || "'Estedad', 'Vazirmatn', sans-serif" }),

  setAnnotationFontSize: (size) =>
    set({ annotationFontSize: Math.max(14, Math.min(76, Number(size) || 22)) }),

  setAnnotationArrowStyle: (style) =>
    set({ annotationArrowStyle: style === 'curved' ? 'curved' : 'straight' }),

  // Refinement Step 2: پرچم‌های ماژولارِ فلش برای فلش‌های جدید.
  // مقدارِ غیرِ boolean، true فرض می‌شود (تا فراخوانیِ بدونِ
  // آرگومان، حالتِ آناتومی را خاموش نکند).
  setAnnotationHasStartDot: (value) =>
    set({ annotationHasStartDot: value !== false }),
  setAnnotationHasEndArrow: (value) =>
    set({ annotationHasEndArrow: value !== false }),

  setSelectedAnnotation: (id, pageNumber = null, tool = null) =>
    set({
      selectedAnnotationId: id || null,
      selectedAnnotationIds: id ? [id] : [],
      selectedAnnotationPage: id ? pageNumber : null,
      selectedAnnotationTool: id ? tool : null,
    }),

  // انتخاب چندتایی (مارکی)
  setSelectedAnnotations: (ids, pageNumber = null) =>
    set((state) => {
      const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
      const lastId = list.length ? list[list.length - 1] : null;
      return {
        selectedAnnotationIds: list,
        selectedAnnotationId: lastId,
        selectedAnnotationPage: list.length ? pageNumber : null,
        selectedAnnotationTool: list.length ? state.selectedAnnotationTool : null,
      };
    }),

  // تاگل با Shift+کلیک
  toggleSelectedAnnotation: (id, pageNumber = null, tool = null) =>
    set((state) => {
      const ids = state.selectedAnnotationIds || [];
      const has = ids.includes(id);
      const next = has ? ids.filter((x) => x !== id) : [...ids, id];
      const lastId = next.length ? next[next.length - 1] : null;
      return {
        selectedAnnotationIds: next,
        selectedAnnotationId: lastId,
        selectedAnnotationPage: next.length ? pageNumber : null,
        selectedAnnotationTool: next.length ? tool || state.selectedAnnotationTool : null,
      };
    }),

  clearSelection: () =>
    set({
      selectedAnnotationId: null,
      selectedAnnotationIds: [],
      selectedAnnotationPage: null,
      selectedAnnotationTool: null,
    }),

  // همگام‌سازی نوار ابزار بالا با ویژگی‌های شکل انتخاب‌شده (Two-Way Binding)
  syncToolbarWithSelectedItem: (item) => {
    if (!item) return;
    set((state) => ({
      annotationColor: item.color || state.annotationColor,
      annotationStrokeWidth:
        item.tool === 'text'
          ? Math.max(1, Math.min(24, Math.round((item.fontSize || 20) / 5)))
          : Math.max(1, Math.min(24, Number(item.strokeWidth) || state.annotationStrokeWidth)),
      annotationOpacity:
        typeof item.opacity === 'number' ? item.opacity : state.annotationOpacity,
      annotationHasFill:
        typeof item.hasFill === 'boolean' ? item.hasFill : state.annotationHasFill,
      ...(item.boxStyle ? { annotationBoxStyle: item.boxStyle } : {}),
      ...(item.tool ? { selectedAnnotationTool: item.tool } : {}),
      ...(item.fontFamily ? { annotationFontFamily: item.fontFamily } : {}),
      ...(typeof item.fontSize === 'number'
        ? { annotationFontSize: Math.max(14, Math.min(76, item.fontSize)) }
        : {}),
      ...(item.arrowStyle
        ? { annotationArrowStyle: item.arrowStyle === 'curved' ? 'curved' : 'straight' }
        : {}),
      ...(typeof item.hasStartDot === 'boolean'
        ? { annotationHasStartDot: item.hasStartDot }
        : {}),
      ...(typeof item.hasEndArrow === 'boolean'
        ? { annotationHasEndArrow: item.hasEndArrow }
        : {}),
    }));
  },

  // ۸. بستن لایه‌های رویی با Escape
  closeAllOverlays: () =>
    set({
      isContextMenuOpen: false,
      isScreenshotModalOpen: false,
      isSnippingActive: false,
      isAreaZoomActive: false,
      isQuickSettingsOpen: false,
      activeCaptureTarget: null,
    }),

  // ۹. مسیردهی ویوها و سایدبارها
  setCurrentView: (view) =>
    set({
      currentView: view,
      isContextMenuOpen: false,
      ...(view !== 'reader'
        ? {
            isAnnotationActive: false,
            isAreaZoomActive: false,
            selectedAnnotationId: null,
            selectedAnnotationIds: [],
            selectedAnnotationPage: null,
            selectedAnnotationTool: null,
          }
        : {}),
    }),

  returnToReader: () =>
    set({
      currentView: 'reader',
      isContextMenuOpen: false,
    }),

  setIsLeftSidebarOpen: (isOpen) => set({ isLeftSidebarOpen: Boolean(isOpen) }),
  setIsRightSidebarOpen: (isOpen) => set({ isRightSidebarOpen: Boolean(isOpen) }),
  toggleLeftSidebar: () => set((state) => ({ isLeftSidebarOpen: !state.isLeftSidebarOpen })),
  toggleRightSidebar: () => set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),

  toggleZenMode: () =>
    set((state) => {
      const arePanelsOpen = state.isLeftSidebarOpen || state.isRightSidebarOpen;
      return {
        isLeftSidebarOpen: false,
        isRightSidebarOpen: !arePanelsOpen,
      };
    }),

  resetSidebars: () => set({ isLeftSidebarOpen: false, isRightSidebarOpen: false }),
}));

export default useAppStore;