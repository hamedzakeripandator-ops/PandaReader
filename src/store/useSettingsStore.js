import { create } from 'zustand';
import { coreApi } from '../services/coreApi';

const SETTINGS_STORAGE_KEY = 'comic_reader_master_settings_v4';

export const DEFAULT_SHORTCUTS = {
  // Refinement Final: کلیدهای پیش‌فرضِ ابزارهای استودیو ویرایش.
  // با این ورودی‌ها، resolveStudioToolHotkeys در تولبار مستقیماً از
  // تنظیمات می‌خواند (قبلاً این ورودی‌ها نبودند و تولبار به نگاشتِ
  // پیش‌فرض برمی‌گشت). ساختارِ هر ورودی دقیقاً مثلِ بقیهٔ میانبرهاست
  // (id/title/category/ctrl/shift/alt/code/key/label) تا در منطقِ
  // ادغامِ تنظیماتِ ذخیره‌شده (merged) و در رابطِ ضبطِ میانبر هم
  // خودبه‌خود دیده شوند. توجه به تداخلِ آگاهانه: toolArrow با
  // prevChapter هر دو KeyAی ساده‌اند؛ اولویت با شاخهٔ ابزارِ
  // useKeyboard است وقتی استودیو روشن است، و گیتِ KeyA در
  // prevChapter، همان حالت را می‌بندد (به useKeyboard مراجعه کنید).
  toolSelect: {
    id: 'toolSelect',
    title: 'ابزار انتخاب (استودیو ویرایش)',
    category: 'استودیو ویرایش',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyV',
    key: 'v',
    label: 'V',
  },
  toolPen: {
    id: 'toolPen',
    title: 'ابزار قلم (استودیو ویرایش)',
    category: 'استودیو ویرایش',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyP',
    key: 'p',
    label: 'P',
  },
  toolBox: {
    id: 'toolBox',
    title: 'ابزار کادربندی (استودیو ویرایش)',
    category: 'استودیو ویرایش',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyB',
    key: 'b',
    label: 'B',
  },
  toolArrow: {
    id: 'toolArrow',
    title: 'ابزار فلش (استودیو ویرایش)',
    category: 'استودیو ویرایش',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyA',
    key: 'a',
    label: 'A',
  },
  toolText: {
    id: 'toolText',
    title: 'ابزار متن (استودیو ویرایش)',
    category: 'استودیو ویرایش',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyT',
    key: 't',
    label: 'T',
  },
  toolSticky: {
    id: 'toolSticky',
    title: 'ابزار استیکی‌نوت (استودیو ویرایش)',
    category: 'استودیو ویرایش',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyN',
    key: 'n',
    label: 'N',
  },
  toolHighlighter: {
    id: 'toolHighlighter',
    title: 'ابزار هایلایت (استودیو ویرایش)',
    category: 'استودیو ویرایش',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyH',
    key: 'h',
    label: 'H',
  },
  toolEraser: {
    id: 'toolEraser',
    title: 'ابزار پاک‌کن (استودیو ویرایش)',
    category: 'استودیو ویرایش',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyE',
    key: 'e',
    label: 'E',
  },
  openFile: {
    id: 'openFile',
    title: 'باز کردن فایل کمیک جدید',
    category: 'عمومی و فایل',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'KeyO',
    key: 'o',
    label: 'Ctrl + O',
  },
  openFolder: {
    id: 'openFolder',
    title: 'باز کردن پوشه کمیک',
    category: 'عمومی و فایل',
    ctrl: true,
    shift: true,
    alt: false,
    code: 'KeyO',
    key: 'o',
    label: 'Ctrl + Shift + O',
  },
  focusSearch: {
    id: 'focusSearch',
    title: 'پرش به نوار جستجوی بالا',
    category: 'عمومی و فایل',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'KeyF',
    key: 'f',
    label: 'Ctrl + F',
  },
  openSettings: {
    id: 'openSettings',
    title: 'باز کردن تنظیمات پیشرفته',
    category: 'عمومی و فایل',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'Comma',
    key: ',',
    label: 'Ctrl + ,',
  },
  copyPage: {
    id: 'copyPage',
    title: 'کپی تصویر صفحه جاری در کلیپ‌بورد',
    category: 'ابزارهای کمیک و اسکرین‌شات',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'KeyC',
    key: 'c',
    label: 'Ctrl + C',
  },
  screenshotWidget: {
    id: 'screenshotWidget',
    title: 'باز کردن داک ابزار اسکرین‌شات',
    category: 'ابزارهای کمیک و اسکرین‌شات',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyS',
    key: 's',
    label: 'S',
  },
  quickSnip: {
    id: 'quickSnip',
    title: 'شروع فوری برش کادر با ماوس (Snipping)',
    category: 'ابزارهای کمیک و اسکرین‌شات',
    ctrl: true,
    shift: true,
    alt: false,
    code: 'KeyS',
    key: 's',
    label: 'Ctrl + Shift + S',
  },
  toggleFavorite: {
    id: 'toggleFavorite',
    title: 'افزودن / حذف کمیک از علاقه‌مندی‌ها',
    category: 'ابزارهای کمیک و اسکرین‌شات',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'KeyD',
    key: 'd',
    label: 'Ctrl + D',
  },
  nextChapter: {
    id: 'nextChapter',
    title: 'رفتن به فصل / فایل بعدی پوشه',
    category: 'ناوبری و مطالعه',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyD',
    key: 'd',
    label: 'D',
  },
  prevChapter: {
    id: 'prevChapter',
    title: 'رفتن به فصل / فایل قبلی پوشه',
    category: 'ناوبری و مطالعه',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyA',
    key: 'a',
    label: 'A',
  },
  rotatePage: {
    id: 'rotatePage',
    title: 'چرخش ۹۰ درجه‌ای صفحات',
    category: 'نمایش و بزرگ‌نمایی',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyR',
    key: 'r',
    label: 'R',
  },
  zenMode: {
    id: 'zenMode',
    title: 'حالت تمرکز (مخفی/ظاهر کردن پنل‌ها)',
    category: 'نمایش و بزرگ‌نمایی',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyF',
    key: 'f',
    label: 'F',
  },
  fullscreen: {
    id: 'fullscreen',
    title: 'حالت تمام‌صفحه ویندوز',
    category: 'نمایش و بزرگ‌نمایی',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'F11',
    key: 'F11',
    label: 'F11',
  },
  zoomIn: {
    id: 'zoomIn',
    title: 'بزرگ‌نمایی صفحه (Zoom In)',
    category: 'نمایش و بزرگ‌نمایی',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'Equal',
    key: '=',
    label: '+',
  },
  zoomOut: {
    id: 'zoomOut',
    title: 'کوچک‌نمایی صفحه (Zoom Out)',
    category: 'نمایش و بزرگ‌نمایی',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'Minus',
    key: '-',
    label: '-',
  },
  resetZoom: {
    id: 'resetZoom',
    title: 'بازنشانی زوم به ۱۰۰٪',
    category: 'نمایش و بزرگ‌نمایی',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'Digit0',
    key: '0',
    label: '0',
  },
};

export const DEFAULT_PREFERENCES = {
  screenshotFormat: 'png',
  jpgQuality: 0.94,
  defaultZoom: 1.0,
  zoomStep: 0.1,
  smoothScroll: true,
  autoZenOnOpen: true,
  autoZenDelay: 3200,
  pageGap: 0,
  accentColor: '#22d3ee',
  hudDuration: 2200,
  showSidebarCounts: true,
};

export const DEFAULT_PROFILE = {
  username: 'Haamed',
  subtitle: 'توسعه‌دهنده و کمیک‌خوان حرفه‌ای',
  avatar: null,
  avatarGradient: 'linear-gradient(135deg, #22d3ee 0%, #0f171c 100%)',
  dailyGoalPages: 50,
};

export function formatShortcutLabel({ ctrl, shift, alt, code, key }) {
  const parts = [];
  if (ctrl) parts.push('Ctrl');
  if (alt) parts.push('Alt');
  if (shift) parts.push('Shift');

  let keyName = '';
  if (code && code.startsWith('Key')) {
    keyName = code.replace('Key', '');
  } else if (code && code.startsWith('Digit')) {
    keyName = code.replace('Digit', '');
  } else if (code === 'Comma') {
    keyName = ',';
  } else if (code === 'Period') {
    keyName = '.';
  } else if (code === 'Equal' || key === '+') {
    keyName = '+';
  } else if (code === 'Minus' || key === '-') {
    keyName = '-';
  } else if (code === 'Space') {
    keyName = 'Space';
  } else {
    keyName = (key || code || '').toUpperCase();
  }

  parts.push(keyName);
  return parts.join(' + ');
}

const loadSavedState = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

const saveStateToStorage = (stateData) => {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stateData));
  } catch (e) {
    console.warn('Failed to persist settings:', e);
  }
};

const saved = loadSavedState();

const buildInitialShortcuts = () => {
  if (!saved?.shortcuts) return { ...DEFAULT_SHORTCUTS };
  const merged = { ...DEFAULT_SHORTCUTS };
  Object.keys(DEFAULT_SHORTCUTS).forEach((id) => {
    if (saved.shortcuts[id]) {
      merged[id] = {
        ...DEFAULT_SHORTCUTS[id],
        ...saved.shortcuts[id],
      };
    }
  });
  return merged;
};

const useSettingsStore = create((set, get) => ({
  shortcuts: buildInitialShortcuts(),
  preferences: { ...DEFAULT_PREFERENCES, ...(saved?.preferences || {}) },
  profile: { ...DEFAULT_PROFILE, ...(saved?.profile || {}) },

  // ۱. واکشی و ادغام تنظیمات و پروفایل از دیتابیس لوکال
  initSettings: async () => {
    if (!coreApi.isAvailable()) return;
    try {
      // دریافت پروفایل
      const profRes = await coreApi.dbAction({ action: 'GET_PROFILE' });
      if (profRes?.profile) {
        const mergedProfile = { ...get().profile, ...profRes.profile };
        set({ profile: mergedProfile });
      }

      // دریافت تنظیمات
      const setsRes = await coreApi.dbAction({ action: 'GET_SETTINGS' });
      if (setsRes?.settings) {
        const mergedPrefs = { ...get().preferences, ...setsRes.settings };
        set({ preferences: mergedPrefs });
      }

      // دریافت میانبرها
      const scRes = await coreApi.dbAction({ action: 'GET_SHORTCUTS' });
      if (scRes?.shortcuts && Object.keys(scRes.shortcuts).length > 0) {
        const mergedShortcuts = { ...get().shortcuts, ...scRes.shortcuts };
        set({ shortcuts: mergedShortcuts });
      }
    } catch (e) {
      console.error('Failed to init settings from native DB:', e);
    }
  },

  // ۲. به‌روزرسانی میانبرها
  updateShortcut: (actionId, newKeyObj) => {
    const currentShortcuts = { ...get().shortcuts };
    if (!currentShortcuts[actionId]) return { success: false, error: 'اکشن یافت نشد' };

    const { ctrl = false, shift = false, alt = false, code = '', key = '' } = newKeyObj;
    const label = formatShortcutLabel({ ctrl, shift, alt, code, key });

    let conflictedActionTitle = null;
    Object.values(currentShortcuts).forEach((item) => {
      if (
        item.id !== actionId &&
        Boolean(item.ctrl) === Boolean(ctrl) &&
        Boolean(item.shift) === Boolean(shift) &&
        Boolean(item.alt) === Boolean(alt) &&
        item.code === code
      ) {
        conflictedActionTitle = item.title;
      }
    });

    if (conflictedActionTitle) {
      return {
        success: false,
        conflict: true,
        error: `این کلید قبلاً برای «${conflictedActionTitle}» تنظیم شده است.`,
      };
    }

    currentShortcuts[actionId] = {
      ...currentShortcuts[actionId],
      ctrl: Boolean(ctrl),
      shift: Boolean(shift),
      alt: Boolean(alt),
      code,
      key,
      label,
    };

    set({ shortcuts: currentShortcuts });
    saveStateToStorage({
      shortcuts: currentShortcuts,
      preferences: get().preferences,
      profile: get().profile,
    });

    coreApi
      .dbAction({
        action: 'SAVE_SHORTCUTS',
        payload: { shortcuts: currentShortcuts },
      })
      .catch(() => {});

    return { success: true, label };
  },

  resetShortcut: (actionId) => {
    if (!DEFAULT_SHORTCUTS[actionId]) return;
    const updated = {
      ...get().shortcuts,
      [actionId]: { ...DEFAULT_SHORTCUTS[actionId] },
    };
    set({ shortcuts: updated });
    saveStateToStorage({
      shortcuts: updated,
      preferences: get().preferences,
      profile: get().profile,
    });

    coreApi
      .dbAction({
        action: 'SAVE_SHORTCUTS',
        payload: { shortcuts: updated },
      })
      .catch(() => {});
  },

  resetAllShortcuts: () => {
    const fresh = { ...DEFAULT_SHORTCUTS };
    set({ shortcuts: fresh });
    saveStateToStorage({
      shortcuts: fresh,
      preferences: get().preferences,
      profile: get().profile,
    });

    coreApi
      .dbAction({
        action: 'SAVE_SHORTCUTS',
        payload: { shortcuts: fresh },
      })
      .catch(() => {});
  },

  matchesShortcut: (actionId, e) => {
    const sc = get().shortcuts[actionId];
    if (!sc || !e) return false;

    const eventCtrl = Boolean(e.ctrlKey || e.metaKey);
    const eventShift = Boolean(e.shiftKey);
    const eventAlt = Boolean(e.altKey);

    if (
      Boolean(sc.ctrl) !== eventCtrl ||
      Boolean(sc.shift) !== eventShift ||
      Boolean(sc.alt) !== eventAlt
    ) {
      return false;
    }

    if (sc.code && e.code === sc.code) return true;
    if (actionId === 'zoomIn' && (e.code === 'NumpadAdd' || e.key === '+')) return true;
    if (actionId === 'zoomOut' && (e.code === 'NumpadSubtract' || e.key === '-')) return true;
    if (actionId === 'resetZoom' && e.code === 'Numpad0') return true;

    if (sc.key && e.key && sc.key.toLowerCase() === e.key.toLowerCase()) return true;

    return false;
  },

  // ۳. تنظیمات برنامه و ریدر با ذخیره هماهنگ در دیتابیس
  updatePreferences: (partialPrefs) => {
    const updated = { ...get().preferences, ...partialPrefs };
    set({ preferences: updated });
    saveStateToStorage({
      shortcuts: get().shortcuts,
      preferences: updated,
      profile: get().profile,
    });

    // ذخیره در دیتابیس لوکال برای هر کلید با اکشن استاندارد SAVE_SETTING
    Object.entries(partialPrefs).forEach(([k, v]) => {
      coreApi
        .dbAction({
          action: 'SAVE_SETTING',
          payload: { key: k, value: v },
        })
        .catch(() => {});
    });
  },

  resetPreferences: () => {
    set({ preferences: { ...DEFAULT_PREFERENCES } });
    saveStateToStorage({
      shortcuts: get().shortcuts,
      preferences: { ...DEFAULT_PREFERENCES },
      profile: get().profile,
    });

    Object.entries(DEFAULT_PREFERENCES).forEach(([k, v]) => {
      coreApi
        .dbAction({
          action: 'SAVE_SETTING',
          payload: { key: k, value: v },
        })
        .catch(() => {});
    });
  },

  // ۴. مدیریت پروفایل
  updateProfile: (partialProfile) => {
    const updated = { ...get().profile, ...partialProfile };
    set({ profile: updated });
    saveStateToStorage({
      shortcuts: get().shortcuts,
      preferences: get().preferences,
      profile: updated,
    });

    coreApi
      .dbAction({
        action: 'SAVE_PROFILE',
        payload: updated,
      })
      .catch(() => {});
  },

  setProfileAvatar: (avatarDataUrl, avatarGradient) => {
    const updated = {
      ...get().profile,
      avatar: avatarDataUrl,
      avatarGradient: avatarGradient || `url("${avatarDataUrl}") center/cover no-repeat`,
    };
    set({ profile: updated });
    saveStateToStorage({
      shortcuts: get().shortcuts,
      preferences: get().preferences,
      profile: updated,
    });

    coreApi
      .dbAction({
        action: 'SAVE_PROFILE_AVATAR',
        payload: {
          avatar: avatarDataUrl,
          avatarGradient: updated.avatarGradient,
        },
      })
      .catch(() => {});
  },

  // ۵. صدور و ورود فایل تنظیمات
  exportSettingsJson: () => {
    const data = {
      shortcuts: get().shortcuts,
      preferences: get().preferences,
      profile: get().profile,
      exportedAt: new Date().toISOString(),
    };
    return JSON.stringify(data, null, 2);
  },

  importSettingsJson: (jsonString) => {
    try {
      const parsed = JSON.parse(jsonString);
      const nextShortcuts = parsed.shortcuts
        ? { ...DEFAULT_SHORTCUTS, ...parsed.shortcuts }
        : get().shortcuts;
      const nextPrefs = parsed.preferences
        ? { ...DEFAULT_PREFERENCES, ...parsed.preferences }
        : get().preferences;
      const nextProfile = parsed.profile
        ? { ...DEFAULT_PROFILE, ...parsed.profile }
        : get().profile;

      set({
        shortcuts: nextShortcuts,
        preferences: nextPrefs,
        profile: nextProfile,
      });

      saveStateToStorage({
        shortcuts: nextShortcuts,
        preferences: nextPrefs,
        profile: nextProfile,
      });

      coreApi
        .dbAction({
          action: 'SAVE_SHORTCUTS',
          payload: { shortcuts: nextShortcuts },
        })
        .catch(() => {});

      coreApi
        .dbAction({
          action: 'SAVE_PROFILE',
          payload: nextProfile,
        })
        .catch(() => {});

      return { success: true };
    } catch (e) {
      return { success: false, error: 'ساختار فایل تنظیمات معتبر نیست.' };
    }
  },
}));

export default useSettingsStore;
