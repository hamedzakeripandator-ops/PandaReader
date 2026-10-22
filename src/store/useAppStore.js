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
  selectedAnnotationId: null,
  selectedAnnotationPage: null,

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
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️',
    };

    set({
      toast: {
        visible: true,
        message,
        type,
        icon: icon || defaultIcons[type] || 'ℹ️',
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
        : { selectedAnnotationId: null, selectedAnnotationPage: null }),
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
          ? { selectedAnnotationId: null, selectedAnnotationPage: null }
          : {}),
      };
    }),

  setAnnotationTool: (tool) =>
    set((state) => ({
      annotationTool: tool || state.annotationTool,
      ...(tool !== 'select'
        ? { selectedAnnotationId: null, selectedAnnotationPage: null }
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

  setSelectedAnnotation: (id, pageNumber = null) =>
    set({
      selectedAnnotationId: id || null,
      selectedAnnotationPage: id ? pageNumber : null,
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
            selectedAnnotationPage: null,
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