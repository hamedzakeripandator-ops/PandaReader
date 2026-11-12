// مرحلهٔ ۵۳ — هاتفیکسِ ۲۲:۴۰: ایمپورتِ useSettingsStore پیش‌فرض است؛
// ایمپورتِ پیش‌فرض، سبکِ استانداردِ پروژه است (از مرحلهٔ ۵۴ خروجیِ نام‌دار هم دارد).
import { create } from 'zustand';
import useSettingsStore from './useSettingsStore';

let toastTimerId = null;

// =========================================================================
// مرحلهٔ ۳۹ §۳: سیستمِ رنگِ سفارشی — رنگ‌هایِ موردِ علاقه، تمپلیت‌هایِ
// رنگیِ شخصی و رنگِ آخرینِ هر ابزار. مرجعِ اول localStorage است
// (کلیدِ comicReader.customColorSystem.v2) و دیتابیس، پشتیبانِ دوم.
// مرحلهٔ ۵۷ مأموریتِ ۲: دو فیلدِ تازه به همین سیستم اضافه شد —
// activePaletteId (پالتِ فعالِ نوار ابزار) و primaryToolbarColors
// (رنگ‌هایِ اصلیِ نوارِ سریع)؛ هر دو در همان کلیدِ localStorage و
// همان payloadی دیتابیس (customColorSystem) می‌مانند، پس مسیرِ
// ماندگاری عوض نشده است.
// =========================================================================
const CUSTOM_COLOR_SYSTEM_KEY = 'comicReader.customColorSystem.v2';
const TOOL_COLOR_KEYS = ['pen', 'highlighter', 'box', 'arrow', 'text', 'sticky'];
const HEX6_RE = /^#[0-9a-fA-F]{6}$/;

// مرحلهٔ ۵۷ مأموریتِ ۲: پالتِ فعالِ نوار ابزار + رنگ‌هایِ اصلیِ نوار.
// شناسه‌هایِ معتبرِ پالت: 'default' (کلاسیک و استاندارد — همان ۸ رنگِ
// COLORSی تولبار)، شناسهٔ یکی از دسته‌هایِ سرخودِ تولبار
// ('medical' | 'neon' | 'cyberpunk' | 'pastel')، 'favorites'
// (رنگ‌هایِ من) یا 'template:<id>' (یکی از تمپلیت‌هایِ کاربر).
// primaryToolbarColors حداکثر ۱۰ رنگ دارد؛ خالی بودنِ آن یعنی نوار،
// به ۸ رنگِ کلاسیک برمی‌گردد (fallback در تولبار).
export const DEFAULT_PRIMARY_TOOLBAR_COLORS = ['#facc15', '#22d3ee', '#4ade80', '#fb7185', '#c084fc', '#fb923c', '#f8fafc', '#0f172a'];
const BUILTIN_PALETTE_IDS = ['medical', 'neon', 'cyberpunk', 'pastel'];
const MAX_PRIMARY_TOOLBAR_COLORS = 10;

function sanitizePrimaryToolbarColors(colors) {
  if (!Array.isArray(colors)) return null;
  return colors.map(sanitizeColorHex).filter(Boolean).slice(0, MAX_PRIMARY_TOOLBAR_COLORS);
}

function sanitizeActivePaletteId(value, templates) {
  if (value === 'default' || value === 'favorites') return value;
  if (typeof value === 'string' && BUILTIN_PALETTE_IDS.includes(value)) return value;
  if (typeof value === 'string' && value.startsWith('template:')) {
    const id = value.slice('template:'.length);
    if (Array.isArray(templates) && templates.some((t) => t && t.id === id)) return value;
  }
  return 'default';
}

function sanitizeColorHex(c) {
  return typeof c === 'string' && HEX6_RE.test(c) ? c : null;
}

function readCustomColorSystem() {
  const fallback = { favoriteColors: [], customColorTemplates: [], toolColors: {}, activePaletteId: 'default', primaryToolbarColors: [...DEFAULT_PRIMARY_TOOLBAR_COLORS] };
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(CUSTOM_COLOR_SYSTEM_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallback;
    const favoriteColors = Array.isArray(parsed.favoriteColors)
      ? parsed.favoriteColors.map(sanitizeColorHex).filter(Boolean).slice(0, 48)
      : [];
    const customColorTemplates = Array.isArray(parsed.customColorTemplates)
      ? parsed.customColorTemplates
        .filter((t) => t && typeof t === 'object' && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.colors))
        .map((t) => ({
          id: t.id,
          name: String(t.name).slice(0, 40),
          colors: t.colors.map(sanitizeColorHex).filter(Boolean).slice(0, 12),
        }))
        .slice(0, 24)
      : [];
    const toolColors = {};
    if (parsed.toolColors && typeof parsed.toolColors === 'object') {
      for (const k of TOOL_COLOR_KEYS) {
        const c = sanitizeColorHex(parsed.toolColors[k]);
        if (c) toolColors[k] = c;
      }
    }
    // مرحلهٔ ۵۷ مأموریتِ ۲: فیلدِ قدیمی (بدونِ این دو کلید) یعنی
    // پالتِ پیش‌فرض؛ آرایهٔ خالیِ صریح حفظ می‌شود (نوار به کلاسیک
    // برمی‌گردد) و شناسهٔ تمپلیتِ حذف‌شده، به 'default' برمی‌گردد.
    const primaryToolbarColors = Array.isArray(parsed.primaryToolbarColors)
      ? sanitizePrimaryToolbarColors(parsed.primaryToolbarColors)
      : [...DEFAULT_PRIMARY_TOOLBAR_COLORS];
    const activePaletteId = sanitizeActivePaletteId(parsed.activePaletteId, customColorTemplates);
    return { favoriteColors, customColorTemplates, toolColors, activePaletteId, primaryToolbarColors };
  } catch (_) {
    return fallback;
  }
}

function persistCustomColorSystem(state) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CUSTOM_COLOR_SYSTEM_KEY, JSON.stringify({
      favoriteColors: state.favoriteColors || [],
      customColorTemplates: state.customColorTemplates || [],
      toolColors: state.toolColors || {},
      activePaletteId: state.activePaletteId || 'default',
      primaryToolbarColors: state.primaryToolbarColors || [],
    }));
  } catch (_) {}
}

let colorDbSyncTimer = null;
function scheduleColorDbSync() {
  try {
    if (typeof setTimeout === 'undefined') return;
    if (colorDbSyncTimer) clearTimeout(colorDbSyncTimer);
    colorDbSyncTimer = setTimeout(() => {
      colorDbSyncTimer = null;
      try {
        useAppStore.getState().syncCustomColorSystemToDb?.();
      } catch (_) {}
    }, 800);
  } catch (_) {}
}

export const useAppStore = create((set, get) => ({
  // ویوهای معتبر: 'home' | 'library' | 'recent' | 'favorites' | 'downloads' | 'settings' | 'profile' | 'reader'
  currentView: 'home',
  // مرحلهٔ ۳۶ §۳: وضعیتِ مشترکِ انتخابِ کتاب برایِ ساخت/ویرایشِ آماربندی.
  isStatsBookSelectionMode: false,
  statsSelectedBookPaths: [],
  editingStatCategoryId: null,
  statsSelectionOrigin: null,
  pendingStatViewAction: null,
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
  // ابزارها: 'select' | 'hand' | 'box' | 'highlighter' | 'pen' | 'arrow' | 'text' | 'sticky' | 'eraser'
  // =========================================================================
  isAnnotationActive: false,
  annotationTool: 'box',
  selectSubMode: 'box', // مرحله 44 §3: زیرحالتِ انتخاب — 'box' | 'lasso'
  // پولیش: جهتِ تولبار ('horizontal' | 'vertical') با خواندنِ اولیه از
  // localStorage؛ guard دارد تا در محیطِ بدونِ storage هم کار کند.
  toolbarOrientation: (() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('annotationToolbarOrientation') === 'vertical' ? 'vertical' : 'horizontal';
    } catch {
      return 'horizontal';
    }
  })(),
  annotationBoxStyle: 'cloud', // 'cloud' | 'rect' | 'round'
  annotationHasFill: true,
  annotationColor: '#06b6d4',
  annotationStrokeWidth: 4,
  annotationOpacity: 0.85,
  // مرحلهٔ ۳۹ §۳: رنگ‌هایِ موردِ علاقه + تمپلیت‌هایِ رنگیِ شخصی + رنگِ
  // آخرینِ هر ابزار (خواندنِ اولیه از localStorage).
  ...readCustomColorSystem(),
  // مرحلهٔ ۳۵ §۵: تطبیقِ خودکارِ اندازهٔ استیکی‌نوت با زوم (پیش‌فرض
  // روشن) و مقیاسِ دستیِ استیکی (پیش‌فرض ۱؛ بازهٔ ۰٫۲۵ تا ۳).
  zoomAdaptiveAnnotations: true,
  stickyManualScale: 1.0,
  // گام ۲ میانی: پیش‌فرضِ محلی (استعداد — مهم‌ترین فونتِ public/fonts).
  // وزیرمتن فونتِ باندل‌شده نیست (هیچ woff2 و @font-faceای ندارد)، پس
  // از پیش‌فرض حذف شد تا پیلِ استعداد از اول فعال باشد.
  annotationFontFamily: "'Estedad', sans-serif",
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
      duration,
    } = typeof options === 'string' ? { type: options } : options;

    // مرحلهٔ ۵۳ مأموریتِ ۱: مدتِ نمایشِ پیامِ شناور از تنظیمِ hudDuration
    // خوانده می‌شود (پیش‌فرض ۲۲۰۰)؛ فقط وقتی فراخواننده مدتِ صریح نداده
    // باشد. تایمرِ واقعیِ پیام‌هایِ شناور همین‌جاست، نه در ویوئرها.
    const resolvedDuration =
      typeof duration === 'number' && Number.isFinite(duration) && duration > 0
        ? duration
        : (useSettingsStore.getState().preferences?.hudDuration ?? 2200);

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
    }, resolvedDuration);
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

  // مرحله 44 §3: زیرحالتِ انتخاب — فقط 'box' یا 'lasso' پذیرفته می‌شود.
  setSelectSubMode: (mode) =>
    set({ selectSubMode: mode === 'lasso' ? 'lasso' : 'box' }),

  // پولیش: تغییرِ جهتِ تولبار با اعتبارسنجی + پایداری در localStorage
  // (نوشتن با try/catch تا اگر storage در دسترس نبود، state همچنان عوض
  // شود؛ خواندنِ اولیه در فیلدِ toolbarOrientation انجام می‌شود).
  setToolbarOrientation: (orientation) => {
    const next = orientation === 'vertical' ? 'vertical' : 'horizontal';
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem('annotationToolbarOrientation', next);
    } catch { /* storage در دسترس نیست؛ فقط state عوض می‌شود */ }
    set({ toolbarOrientation: next });
  },

  selectAnnotationTool: (tool, color = null) =>
    set((state) => ({
      annotationTool: tool || state.annotationTool,
      ...(color
        ? { annotationColor: color }
        : tool && state.toolColors && state.toolColors[tool]
          ? { annotationColor: state.toolColors[tool] }
          : {}),
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

  // مرحلهٔ ۳۹ §۳: رنگِ تازه، رنگِ آخرینِ ابزارِ فعلی هم می‌شود و در
  // localStorage (و با تأخیر، در دیتابیس) می‌ماند.
  setAnnotationColor: (color) =>
    set((state) => {
      const c = color || '#06b6d4';
      const next = { ...state, annotationColor: c };
      const tool = state.annotationTool;
      if (TOOL_COLOR_KEYS.includes(tool)) {
        next.toolColors = { ...(state.toolColors || {}), [tool]: c };
      }
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      return next;
    }),

  // مرحلهٔ ۳۹ §۳: رنگ‌هایِ موردِ علاقه (سقف ۴۸ رنگ).
  // مرحلهٔ ۵۶ مأموریتِ ۱: true برمی‌گرداند اگر رنگ اضافه شد، وگرنه
  // false (نامعتبر، تکراری یا سقفِ پر) — تا تولبار بتواند به کاربر
  // بگوید چه شد؛ قبلاً همیشه undefined بود و ردِ بی‌صدا، شبیهِ
  // «ذخیره نشد» دیده می‌شد.
  addFavoriteColor: (color) => {
    let added = false;
    set((state) => {
      const c = sanitizeColorHex(typeof color === 'string' ? color.trim() : '');
      if (!c) return state;
      if ((state.favoriteColors || []).some((x) => x.toLowerCase() === c.toLowerCase())) return state;
      if ((state.favoriteColors || []).length >= 48) return state;
      const next = { ...state, favoriteColors: [...(state.favoriteColors || []), c].slice(0, 48) };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      added = true;
      return next;
    });
    return added;
  },

  removeFavoriteColor: (color) =>
    set((state) => {
      const next = {
        ...state,
        favoriteColors: (state.favoriteColors || []).filter((x) => x.toLowerCase() !== String(color || '').toLowerCase()),
      };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      return next;
    }),

  // مرحلهٔ ۳۹ §۳: تمپلیت‌هایِ رنگیِ شخصی (سقف ۲۴ تمپلیت، هر کدام تا ۱۲ رنگ).
  // مرحلهٔ ۵۶ مأموریتِ ۱: true برمی‌گرداند اگر تمپلیت ساخته شد،
  // false اگر رنگِ معتبری نرسید یا سقفِ ۲۴ تمپلیت پر بود. قبلاً در
  // هر دو حالت، بی‌صدا state برمی‌گشت (و در سقفِ پر، slice(0, 24)
  // تمپلیتِ تازه را دور می‌انداخت) و تولبار هم فرم را می‌بست؛ پس
  // کاربر هیچ بازخوردی نمی‌دید و لیست خالی می‌ماند — همان شکستِ
  // خاموشِ گزارش‌شده. localStorage مرجعِ اول است و سینکِ دیتابیس،
  // مثلِ قبل، debounceدار (۸۰۰ میلی‌ثانیه) انجام می‌شود.
  createCustomColorTemplate: (name, colors) => {
    let created = false;
    set((state) => {
      const clean = (Array.isArray(colors) ? colors : []).map(sanitizeColorHex).filter(Boolean).slice(0, 12);
      if (clean.length === 0) return state;
      if ((state.customColorTemplates || []).length >= 24) return state;
      const id = `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const next = {
        ...state,
        customColorTemplates: [
          ...(state.customColorTemplates || []),
          { id, name: String(name || 'تمپلیتِ جدید').slice(0, 40), colors: clean },
        ].slice(0, 24),
      };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      created = true;
      return next;
    });
    return created;
  },

  deleteCustomColorTemplate: (id) =>
    set((state) => {
      // مرحلهٔ ۵۷ مأموریتِ ۲: اگر تمپلیتِ حذف‌شده، پالتِ فعالِ نوار
      // بود، نوار به پالتِ کلاسیک برمی‌گردد تا به رنگ‌هایِ مرده
      // اشاره نکند.
      const wasActive = state.activePaletteId === `template:${id}`;
      const next = {
        ...state,
        customColorTemplates: (state.customColorTemplates || []).filter((t) => t.id !== id),
        ...(wasActive
          ? { activePaletteId: 'default', primaryToolbarColors: [...DEFAULT_PRIMARY_TOOLBAR_COLORS] }
          : {}),
      };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      return next;
    }),

  updateCustomColorTemplate: (id, patch) =>
    set((state) => {
      const next = {
        ...state,
        customColorTemplates: (state.customColorTemplates || []).map((t) => {
          if (t.id !== id) return t;
          const out = { ...t };
          if (patch && typeof patch.name === 'string') out.name = patch.name.slice(0, 40);
          if (patch && Array.isArray(patch.colors)) {
            out.colors = patch.colors.map(sanitizeColorHex).filter(Boolean).slice(0, 12);
          }
          return out;
        }),
      };
      // مرحلهٔ ۵۷ مأموریتِ ۲: اگر تمپلیتِ ویرایش‌شده، پالتِ فعالِ
      // نوار است، نوارِ سریع همان‌جا با رنگ‌هایِ تازه همگام می‌شود.
      if (state.activePaletteId === `template:${id}`) {
        const edited = next.customColorTemplates.find((t) => t.id === id);
        if (edited && Array.isArray(edited.colors) && edited.colors.length > 0) {
          next.primaryToolbarColors = edited.colors.slice(0, MAX_PRIMARY_TOOLBAR_COLORS);
        }
      }
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      return next;
    }),

  // مرحلهٔ ۵۷ مأموریتِ ۲: پالتِ فعالِ نوار ابزار. آرگومانِ دوم
  // (colors) فقط برایِ دسته‌هایِ سرخود لازم است، چون رنگ‌هایِ آن‌ها
  // در تولبار تعریف شده‌اند؛ 'default' از
  // DEFAULT_PRIMARY_TOOLBAR_COLORS، 'favorites' از رنگ‌هایِ من و
  // 'template:<id>' از خودِ تمپلیت خوانده می‌شوند. true یعنی پالت
  // عوض شد، false یعنی شناسه یا رنگ‌ها نامعتبر بودند (مثلِ تمپلیتِ
  // خالی یا دستهٔ ناشناخته) و state دست نخورده ماند. دراور بعد از
  // این فراخوانی باز می‌ماند تا کاربر بی‌درنگ پالتِ دیگری را هم
  // امتحان کند.
  setActivePaletteId: (paletteId, colors) => {
    let ok = false;
    set((state) => {
      const templates = state.customColorTemplates || [];
      let nextColors = null;
      if (paletteId === 'default') {
        nextColors = [...DEFAULT_PRIMARY_TOOLBAR_COLORS];
      } else if (paletteId === 'favorites') {
        const favs = (state.favoriteColors || []).slice(0, MAX_PRIMARY_TOOLBAR_COLORS);
        nextColors = favs.length > 0 ? favs : [state.annotationColor || '#22d3ee'];
      } else if (typeof paletteId === 'string' && paletteId.startsWith('template:')) {
        const t = templates.find((x) => x && x.id === paletteId.slice('template:'.length));
        if (!t || !Array.isArray(t.colors) || t.colors.length === 0) return state;
        nextColors = t.colors.slice(0, MAX_PRIMARY_TOOLBAR_COLORS);
      } else if (typeof paletteId === 'string' && BUILTIN_PALETTE_IDS.includes(paletteId)) {
        const clean = sanitizePrimaryToolbarColors(colors);
        if (!clean || clean.length === 0) return state;
        nextColors = clean;
      } else {
        return state;
      }
      const next = { ...state, activePaletteId: paletteId, primaryToolbarColors: nextColors };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      ok = true;
      return next;
    });
    return ok;
  },

  // مرحلهٔ ۵۷ مأموریتِ ۲: جایگزینیِ کاملِ رنگ‌هایِ نوارِ سریع
  // (حداکثر ۱۰ رنگ؛ خالی یعنی fallback به کلاسیک در تولبار).
  setPrimaryToolbarColors: (colors) => {
    let ok = false;
    set((state) => {
      const clean = sanitizePrimaryToolbarColors(colors);
      if (clean === null) return state;
      const next = { ...state, primaryToolbarColors: clean };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      ok = true;
      return next;
    });
    return ok;
  },

  // مرحلهٔ ۵۷ مأموریتِ ۲: افزودنِ یک رنگ به نوارِ سریع (دکمهٔ +).
  // true اگر اضافه شد، false اگر نامعتبر، تکراری یا سقفِ ۱۰ رنگ پر بود.
  addPrimaryToolbarColor: (color) => {
    let added = false;
    set((state) => {
      const c = sanitizeColorHex(typeof color === 'string' ? color.trim() : '');
      if (!c) return state;
      const list = state.primaryToolbarColors || [];
      if (list.some((x) => x.toLowerCase() === c.toLowerCase())) return state;
      if (list.length >= MAX_PRIMARY_TOOLBAR_COLORS) return state;
      const next = { ...state, primaryToolbarColors: [...list, c].slice(0, MAX_PRIMARY_TOOLBAR_COLORS) };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      added = true;
      return next;
    });
    return added;
  },

  // مرحلهٔ ۵۷ مأموریتِ ۲: حذفِ یک رنگ از نوارِ سریع (کلیکِ راست یا
  // × در حالتِ ویرایش). خالی شدنِ کامل مجاز است؛ تولبار در آن حالت،
  // ۸ رنگِ کلاسیک را نشان می‌دهد.
  removePrimaryToolbarColor: (color) =>
    set((state) => {
      const next = {
        ...state,
        primaryToolbarColors: (state.primaryToolbarColors || []).filter(
          (x) => x.toLowerCase() !== String(color || '').toLowerCase()
        ),
      };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      return next;
    }),

  setToolColor: (tool, color) =>
    set((state) => {
      if (!TOOL_COLOR_KEYS.includes(tool)) return state;
      const c = sanitizeColorHex(color);
      if (!c) return state;
      const next = { ...state, toolColors: { ...(state.toolColors || {}), [tool]: c } };
      persistCustomColorSystem(next);
      scheduleColorDbSync();
      return next;
    }),

  // مرحلهٔ ۳۹ §۳: همگام‌سازی با دیتابیس (LS مرجعِ اول است؛ DB فقط
  // پشتیبانِ دوم — اگر LS چیزی دارد، DB خوانده نمی‌شود).
  loadCustomColorSystemFromDb: async () => {
    try {
      const { coreApi } = await import('../services/coreApi.js');
      const res = await coreApi.dbAction({ action: 'GET_CUSTOM_COLOR_SYSTEM', payload: {} });
      const saved = res?.customColorSystem;
      if (!saved || typeof saved !== 'object') return false;
      const current = get();
      if (((current.favoriteColors || []).length > 0) || ((current.customColorTemplates || []).length > 0)) return false;
      const next = { ...current, ...readCustomColorSystem() };
      const fav = Array.isArray(saved.favoriteColors) ? saved.favoriteColors.map(sanitizeColorHex).filter(Boolean).slice(0, 48) : [];
      const tpl = Array.isArray(saved.customColorTemplates) ? saved.customColorTemplates.filter((t) => t && typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.colors)).map((t) => ({ id: t.id, name: String(t.name).slice(0, 40), colors: t.colors.map(sanitizeColorHex).filter(Boolean).slice(0, 12) })).slice(0, 24) : [];
      const tc = {};
      if (saved.toolColors && typeof saved.toolColors === 'object') {
        for (const k of TOOL_COLOR_KEYS) {
          const c = sanitizeColorHex(saved.toolColors[k]);
          if (c) tc[k] = c;
        }
      }
      next.favoriteColors = fav;
      next.customColorTemplates = tpl;
      next.toolColors = tc;
      // مرحلهٔ ۵۷ مأموریتِ ۲: پالتِ فعال و رنگ‌هایِ نوار هم از
      // دیتابیس برمی‌گردند. رکوردِ ذخیره‌شده با همین نسخه، همیشه هر
      // دو را با هم دارد؛ اگر نوار ذخیره نشده بود، از رویِ پالت
      // حل می‌شود (تمپلیت → رنگ‌هایِ تمپلیت، علاقه‌مندی‌ها → رنگ‌هایِ
      // من، کلاسیک → پیش‌فرض) و اگر حل نشد، پالت به 'default' برمی‌گردد.
      const savedPaletteId = sanitizeActivePaletteId(saved.activePaletteId, tpl);
      const savedStrip = Array.isArray(saved.primaryToolbarColors)
        ? sanitizePrimaryToolbarColors(saved.primaryToolbarColors)
        : null;
      next.activePaletteId = savedPaletteId;
      if (savedStrip && savedStrip.length > 0) {
        next.primaryToolbarColors = savedStrip;
      } else if (savedPaletteId === 'default') {
        next.primaryToolbarColors = [...DEFAULT_PRIMARY_TOOLBAR_COLORS];
      } else if (savedPaletteId === 'favorites') {
        next.primaryToolbarColors = fav.length > 0 ? fav.slice(0, MAX_PRIMARY_TOOLBAR_COLORS) : [...DEFAULT_PRIMARY_TOOLBAR_COLORS];
      } else if (savedPaletteId.startsWith('template:')) {
        const t = tpl.find((x) => x.id === savedPaletteId.slice('template:'.length));
        next.primaryToolbarColors = t && t.colors.length > 0 ? t.colors.slice(0, MAX_PRIMARY_TOOLBAR_COLORS) : [...DEFAULT_PRIMARY_TOOLBAR_COLORS];
        if (!t || t.colors.length === 0) next.activePaletteId = 'default';
      } else {
        next.activePaletteId = 'default';
        next.primaryToolbarColors = [...DEFAULT_PRIMARY_TOOLBAR_COLORS];
      }
      persistCustomColorSystem(next);
      set(next);
      return true;
    } catch (_) {
      return false;
    }
  },

  // مرحلهٔ ۵۶ مأموریتِ ۱: true برمی‌گرداند اگر ورکر، نوشتن را
  // تأیید کرد، وگرنه false. کلیدِ payload (customColorSystem) دقیقاً
  // همان است که ورکرِ دیتابیس در هر دو شاخهٔ JSON و SQLite از آن
  // می‌خواند (SAVE_CUSTOM_COLOR_SYSTEM)؛ localStorage همچنان مرجعِ
  // اول است و شکستِ سینک، state را خراب نمی‌کند.
  syncCustomColorSystemToDb: async () => {
    try {
      const { coreApi } = await import('../services/coreApi.js');
      const s = get();
      const res = await coreApi.dbAction({
        action: 'SAVE_CUSTOM_COLOR_SYSTEM',
        payload: {
          customColorSystem: {
            favoriteColors: s.favoriteColors || [],
            customColorTemplates: s.customColorTemplates || [],
            toolColors: s.toolColors || {},
            activePaletteId: s.activePaletteId || 'default',
            primaryToolbarColors: s.primaryToolbarColors || [],
          },
        },
      });
      return Boolean(res && res.type !== 'error' && res.success !== false);
    } catch (_) {
      return false;
    }
  },

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

  setZoomAdaptiveAnnotations: (enabled) =>
    set({ zoomAdaptiveAnnotations: Boolean(enabled) }),

  setStickyManualScale: (scale) =>
    set({
      stickyManualScale: Math.max(0.25, Math.min(3, Number(scale) || 1)),
    }),

  setAnnotationFontFamily: (family) =>
    set({ annotationFontFamily: family || "'Estedad', sans-serif" }),

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

  // مرحلهٔ ۳۶ §۳: جریانِ انتخابِ کتاب از Recent برایِ آماربندی.
  // start: هدایتِ فوری به Recent؛ finish: بازگشت به Profile با پنجرهٔ نهایی‌سازی.
  startStatsSelectionInRecent: (initialPaths, editingId, origin) => {
    const paths = Array.isArray(initialPaths) ? [...initialPaths] : [];
    get().setCurrentView('recent');
    set({ isStatsBookSelectionMode: true, statsSelectedBookPaths: paths, editingStatCategoryId: editingId || null, statsSelectionOrigin: origin || 'profile', pendingStatViewAction: null });
  },
  enterStatsSelectionFromRecent: () => {
    set({ isStatsBookSelectionMode: true, statsSelectedBookPaths: [], editingStatCategoryId: null, statsSelectionOrigin: 'recent', pendingStatViewAction: null });
  },
  setStatsSelectedBookPaths: (paths) => set({ statsSelectedBookPaths: Array.isArray(paths) ? [...paths] : [] }),
  toggleStatsSelectedBookPath: (path) => set((state) => {
    const list = state.statsSelectedBookPaths || [];
    return { statsSelectedBookPaths: list.includes(path) ? list.filter((p) => p !== path) : [...list, path] };
  }),
  cancelStatsSelection: () => {
    const origin = get().statsSelectionOrigin;
    set({ isStatsBookSelectionMode: false, statsSelectedBookPaths: [], editingStatCategoryId: null, statsSelectionOrigin: null });
    if (origin === 'profile') get().setCurrentView('profile');
  },
  finishStatsSelectionToProfile: (selectedPaths) => {
    const paths = Array.isArray(selectedPaths) ? [...selectedPaths] : (get().statsSelectedBookPaths || []);
    const editingId = get().editingStatCategoryId;
    set({ isStatsBookSelectionMode: false, statsSelectedBookPaths: paths, pendingStatViewAction: { type: 'edit', id: editingId, paths }, statsSelectionOrigin: null });
    get().setCurrentView('profile');
  },
  finishWithSavedStatView: (viewId) => {
    set({ isStatsBookSelectionMode: false, statsSelectedBookPaths: [], editingStatCategoryId: null, statsSelectionOrigin: null, pendingStatViewAction: { type: 'activate', viewId } });
    get().setCurrentView('profile');
  },
  clearPendingStatViewAction: () => set({ pendingStatViewAction: null }),

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
