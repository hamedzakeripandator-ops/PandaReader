import { create } from 'zustand';
import { coreApi } from '../services/coreApi';

const SETTINGS_STORAGE_KEY = 'comic_reader_master_settings_v4';

export const DEFAULT_SHORTCUTS = {
  // Refinement Final: کلیدهای پیش‌فرضِ ابزارهای استودیو ویرایش.
  // با این ورودی‌ها، resolveStudioToolForEvent در تولبار (و
  // useKeyboard) مستقیماً از matchesShortcut می‌خواند؛ از مرحلهٔ
  // ۷، modifierها هم سنجیده می‌شوند. ساختارِ هر ورودی دقیقاً
  // مثلِ بقیهٔ میانبرهاست
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
    label: 'D / PageDown',
    // مرحله ۷ ـ بخش الف: PageDown، پیش از این با `||` هاردکدشده در
    // useKeyboard، همیشه فصلِ بعدی را می‌آورد — حتی وقتی کاربر،
    // این اکشن را به کلیدِ دیگری بسته بود. حالا PageDown، اسمِ
    // مستعارِ رسمیِ همین ورودی است و در matchesShortcut بررسی
    // می‌شود؛ با همان قانونِ مرجعِ واحد.
    aliases: [{ code: 'PageDown', key: 'PageDown', ctrl: false, shift: false, alt: false }],
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
    label: 'A / PageUp',
    // مرحله ۷ ـ بخش الف: PageUp، اسمِ مستعارِ رسمیِ همین ورودی
    // است (مثلِ nextChapter)؛ دیگر `||` هاردکدشده‌ای در کار نیست.
    aliases: [{ code: 'PageUp', key: 'PageUp', ctrl: false, shift: false, alt: false }],
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
    ctrl: true,
    shift: false,
    alt: false,
    code: 'Equal',
    key: '=',
    label: 'Ctrl + +',
    // مرحله ۷ ـ بخش الف: Shift در سنجشِ این ورودی نادیده گرفته
    // می‌شود، چون '+' روی چیدمانِ QWERTY فقط با Shift+Equal
    // تولید می‌شود و رفتارِ قبلی هم Ctrl+Shift+= را زوم می‌کرد.
    ignoreShift: true,
  },
  zoomOut: {
    id: 'zoomOut',
    title: 'کوچک‌نمایی صفحه (Zoom Out)',
    category: 'نمایش و بزرگ‌نمایی',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'Minus',
    key: '-',
    label: 'Ctrl + -',
    ignoreShift: true,
  },
  resetZoom: {
    id: 'resetZoom',
    title: 'بازنشانی زوم به ۱۰۰٪',
    category: 'نمایش و بزرگ‌نمایی',
    // مرحله ۷ ـ بخش الف: ctrl:true (واقعیتِ رفتارِ قبلی). پیش از این،
    // ctrl:false بود و matchesShortcut هرگز با Ctrl+0 جور نمی‌شد؛ به
    // همین دلیل، useKeyboard زوم را با چکِ هاردکدشده انجام می‌داد و
    // تغییرِ این میانبر در تنظیمات، هیچ اثری نداشت.
    ctrl: true,
    shift: false,
    alt: false,
    code: 'Digit0',
    key: '0',
    label: 'Ctrl + 0',
    ignoreShift: true,
  },
  // مرحله ۷ ـ بخش الف: اکشن‌هایی که تا امروز هیچ ورودی‌ای در تنظیمات
  // نداشتند و رفتارشان کاملاً هاردکدشده بود (Alt+Z، Ctrl+Z/Y و
  // Ctrl+F در ریدرِ PDF). حالا هر چهارتا، ورودیِ رسمی دارند و از
  // همین مرجعِ واحد خوانده می‌شوند؛ تغییرشان در تنظیمات، کلیدِ
  // قبلی را کاملاً خلع می‌کند.
  areaZoom: {
    id: 'areaZoom',
    title: 'زوم ناحیه‌ای با کشیدن باکس',
    category: 'نمایش و بزرگ‌نمایی',
    ctrl: false,
    shift: false,
    alt: true,
    code: 'KeyZ',
    key: 'z',
    label: 'Alt + Z',
  },
  undoAnnotation: {
    id: 'undoAnnotation',
    title: 'برگرداندنِ آخرین حاشیه‌نویسی (Undo)',
    category: 'استودیو ویرایش',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'KeyZ',
    key: 'z',
    label: 'Ctrl + Z',
  },
  redoAnnotation: {
    id: 'redoAnnotation',
    title: 'جلو بردنِ حاشیه‌نویسی (Redo)',
    category: 'استودیو ویرایش',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'KeyY',
    key: 'y',
    label: 'Ctrl + Y',
  },
  findInPdf: {
    id: 'findInPdf',
    title: 'جستجو در متنِ PDF',
    category: 'ناوبری و مطالعه',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'KeyF',
    key: 'f',
    label: 'Ctrl + F',
  },
  // مرحله ۷ ـ بخش الف: این دو ردیف، در پنلِ تنظیمات نمایش داده
  // می‌شدند ولی هیچ ورودی‌ای در DEFAULT_SHORTCUTS و هیچ شاخه‌ای در
  // useKeyboard نداشتند (ردیف‌های مرده که با موفقیتِ کاذب ذخیره
  // می‌شدند). حالا ورودیِ واقعی دارند؛ پیش‌فرض، بدونِ کلید
  // (Unbound) تا با هیچ میانبرِ موجودی تداخل نکنند و کاربر، خودش
  // در صورتِ نیاز، آن‌ها را ضبط کند.
  toggleLeftSidebar: {
    id: 'toggleLeftSidebar',
    title: 'باز و بسته کردن منوی سمت چپ',
    category: 'پنل‌ها و پنجره',
    ctrl: false,
    shift: false,
    alt: false,
    code: '',
    key: '',
    label: '',
  },
  toggleRightSidebar: {
    id: 'toggleRightSidebar',
    title: 'باز و بسته کردن فهرست صفحات راست',
    category: 'پنل‌ها و پنجره',
    ctrl: false,
    shift: false,
    alt: false,
    code: '',
    key: '',
    label: '',
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
  // مرحله ۶ ـ بخش الف: تمِ مطالعهٔ صفحه (فقط روی تصویرِ صفحه اعمال
  // می‌شود؛ راستی‌آزماییِ ادغام با تنظیماتِ ذخیره‌شدهٔ قدیمی: در
  // initSettings، تنظیماتِ ذخیره‌شده روی همین پیش‌فرض‌ها spread
  // می‌شوند، پس کلیدهای جدید برای کاربرانِ قدیمی هم مقدارِ پیش‌فرض
  // می‌گیرند و resetPreferences هم آن‌ها را برمی‌گرداند.
  readingTheme: 'default',
  readingBrightness: 1,
  readingWarmth: 0,
  // مرحله ۱۱: تعدادِ «مواردِ اخیر» در صفحهٔ خانه (پیش‌فرضِ ۱۲) و
  // عددهایِ سفارشیِ افزوده‌شده توسطِ کاربر. هر دو از طریقِ
  // updatePreferences، برای هر کلید با SAVE_SETTING در db.json
  // ماندگار می‌شوند و initSettings آن‌ها را روی پیش‌فرض‌ها spread
  // می‌کند؛ پس کاربرانِ قدیمی هم مقدارِ پیش‌فرض می‌گیرند و
  // resetPreferences هم آن‌ها را برمی‌گرداند.
  homeRecentLimit: 12,
  homeRecentCustomPresets: [],
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

// مرحله ۷ ـ بخش الف: ترمیمِ ورودی‌های قدیمیِ زوم. در نسخه‌های پیشین،
// سه ورودیِ zoomIn/zoomOut/resetZoom، ctrl:false داشتند؛ در حالی که
// رفتارِ واقعیِ برنامه همیشه Ctrl+کلید بود و matchesShortcut، آن
// ورودی‌ها را هرگز با رویدادِ واقعی جور نمی‌کرد (به همین دلیل، زوم
// با چکِ هاردکدشده انجام می‌شد). اگر ورودیِ ذخیره‌شده، دقیقاً همان
// پیش‌فرضِ قدیمیِ خراب باشد (همهٔ فیلدها یکسان)، ctrl آن true
// می‌شود تا با رفتارِ واقعی و برچسبِ جدید جور شود. ورودی‌ای که
// کاربر، خودش عوضش کرده باشد (code/key متفاوت)، دست نمی‌خورد.
const LEGACY_ZOOM_DEFAULTS = {
  zoomIn: { ctrl: false, shift: false, alt: false, code: 'Equal', key: '=', label: '+' },
  zoomOut: { ctrl: false, shift: false, alt: false, code: 'Minus', key: '-', label: '-' },
  resetZoom: { ctrl: false, shift: false, alt: false, code: 'Digit0', key: '0', label: '0' },
};
const LEGACY_ZOOM_LABELS = { zoomIn: 'Ctrl + +', zoomOut: 'Ctrl + -', resetZoom: 'Ctrl + 0' };
function normalizeLegacyShortcut(id, entry) {
  const legacy = LEGACY_ZOOM_DEFAULTS[id];
  if (!legacy || !entry) return entry;
  const isLegacy =
    Boolean(entry.ctrl) === legacy.ctrl &&
    Boolean(entry.shift) === legacy.shift &&
    Boolean(entry.alt) === legacy.alt &&
    entry.code === legacy.code &&
    entry.key === legacy.key &&
    entry.label === legacy.label;
  if (!isLegacy) return entry;
  return { ...entry, ctrl: true, label: LEGACY_ZOOM_LABELS[id] };
}

const buildInitialShortcuts = () => {
  if (!saved?.shortcuts) return { ...DEFAULT_SHORTCUTS };
  const merged = { ...DEFAULT_SHORTCUTS };
  Object.keys(DEFAULT_SHORTCUTS).forEach((id) => {
    if (saved.shortcuts[id]) {
      merged[id] = normalizeLegacyShortcut(id, {
        ...DEFAULT_SHORTCUTS[id],
        ...saved.shortcuts[id],
      });
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
        Object.keys(mergedShortcuts).forEach((id) => {
          mergedShortcuts[id] = normalizeLegacyShortcut(id, mergedShortcuts[id]);
        });
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
      // مرحله ۷ ـ بخش الف: تداخل، فقط بر اساسِ code نیست؛ دو codeِ
      // متفاوت که یک key تولید می‌کنند (مثلِ Equal و NumpadAdd که
      // هر دو '+') هم تداخل‌اند، چون matchesShortcut هر دو مسیر را
      // می‌سنجد. ورودی‌هایِ بدونِ کلید (Unbound) هرگز تداخل ندارند.
      const sameCode = Boolean(code) && item.code === code;
      const sameKey =
        Boolean(key) &&
        Boolean(item.key) &&
        String(item.key).toLowerCase() === String(key).toLowerCase();
      if (
        item.id !== actionId &&
        Boolean(item.ctrl) === Boolean(ctrl) &&
        Boolean(item.shift) === Boolean(shift) &&
        Boolean(item.alt) === Boolean(alt) &&
        (sameCode || sameKey)
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

  // مرحله ۷ ـ بخش الف: نامِ مستعارِ resetAllShortcuts؛ پنلِ
  // تنظیمات، این نام را صدا می‌زد و چون در استور نبود، دکمهٔ
  // «بازنشانی به پیش‌فرض» با TypeError می‌شکست. حالا هر دو نام،
  // یکی‌اند.
  resetShortcutsToDefault: () => get().resetAllShortcuts(),

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

  // مرحله ۷ ـ بخش الف: تنها مرجعِ تشخیصِ میانبر در کلِ برنامه.
  // همهٔ شنونده‌های کیبورد (useKeyboard، تولبار، ویوورها) فقط از
  // همین تابع می‌پرسند؛ هیچ چکِ هاردکدشدهٔ موازی‌ای باقی نمانده
  // است، پس تغییرِ یک میانبر در تنظیمات، کلیدِ قبلی را واقعاً
  // خلع می‌کند. اسم‌های مستعار (aliases) هم همین‌جا بررسی
  // می‌شوند و تابعِ modifierهای خودِ ورودی را مبنا می‌گیرد.
  matchesShortcut: (actionId, e) => {
    const sc = get().shortcuts[actionId];
    if (!sc || !e) return false;

    const eventCtrl = Boolean(e.ctrlKey || e.metaKey);
    const eventShift = Boolean(e.shiftKey);
    const eventAlt = Boolean(e.altKey);

    // Redo با Ctrl+Shift+Z: اسمِ مستعارِ redoAnnotation است که
    // shift دارد و با modifierهای ورودیِ اصلی جور نمی‌شود؛ پس
    // پیش از بررسیِ برابریِ modifierها، جداگانه سنجیده می‌شود.
    if (
      actionId === 'redoAnnotation' &&
      eventCtrl &&
      eventShift &&
      !eventAlt &&
      e.code === 'KeyZ'
    ) {
      return true;
    }

    if (
      Boolean(sc.ctrl) !== eventCtrl ||
      (!sc.ignoreShift && Boolean(sc.shift) !== eventShift) ||
      Boolean(sc.alt) !== eventAlt
    ) {
      return false;
    }

    if (sc.code && e.code === sc.code) return true;
    if (actionId === 'zoomIn' && (e.code === 'NumpadAdd' || e.key === '+')) return true;
    if (actionId === 'zoomOut' && (e.code === 'NumpadSubtract' || e.key === '-')) return true;
    if (actionId === 'resetZoom' && e.code === 'Numpad0') return true;

    if (sc.key && e.key && sc.key.toLowerCase() === e.key.toLowerCase()) return true;

    // اسم‌های مستعارِ ورودی (مثلِ PageDown برای nextChapter):
    // modifierهای خودِ اسمِ مستعار سنجیده می‌شود، نه ورودیِ اصلی.
    if (Array.isArray(sc.aliases)) {
      for (const alias of sc.aliases) {
        if (!alias) continue;
        if (
          Boolean(alias.ctrl) === eventCtrl &&
          Boolean(alias.shift) === eventShift &&
          Boolean(alias.alt) === eventAlt
        ) {
          if (alias.code && e.code === alias.code) return true;
          if (alias.key && e.key && String(alias.key).toLowerCase() === String(e.key).toLowerCase()) return true;
        }
      }
    }

    return false;
  },

  // مرحله ۶ ـ بخش ب: پیش‌نمایشِ زندهٔ تنظیمات، فقط در استیتِ
  // ریدر و بدونِ هیچ‌گونه ماندگاری (نه localStorage، نه دیتابیس).
  // فراخواننده (QuickSettingsModal) موظف است پس از پیش‌نمایش، یا
  // با updatePreferences ماندگارش کند (Save) یا با همین تابع،
  // مقادیرِ پیش از باز شدنِ مودال را برگرداند (Rollback on Cancel).
  previewPreferences: (partialPrefs) => {
    set({ preferences: { ...get().preferences, ...partialPrefs } });
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
