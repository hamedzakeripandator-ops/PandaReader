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
  // مرحله ۱۲: اکشن‌های ورق زدنِ صفحه که تا امروز هیچ ورودی‌ای در
  // تنظیمات و هیچ شاخه‌ای در useKeyboard نداشتند؛ به همین دلیل،
  // PageDown/PageUp (که اسمِ مستعارِ فصل بودند) به‌جای ورق زدن،
  // فایلِ دیگری را باز می‌کردند. حالا ورق زدن، اکشنِ رسمیِ خودش
  // را دارد و PageDown/PageUp، کلیدِ اصلیِ آن‌اند؛ شاخهٔ
  // useKeyboard، دقیقاً jumpToPage را صدا می‌زند (همان تابعی که
  // پرشِ TopBar هم استفاده می‌کند).
  nextPage: {
    id: 'nextPage',
    title: 'رفتن به صفحهٔ بعد',
    category: 'ناوبری و مطالعه',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'PageDown',
    key: 'PageDown',
    label: 'PageDown',
  },
  prevPage: {
    id: 'prevPage',
    title: 'رفتن به صفحهٔ قبل',
    category: 'ناوبری و مطالعه',
    ctrl: false,
    shift: false,
    alt: false,
    code: 'PageUp',
    key: 'PageUp',
    label: 'PageUp',
  },
  nextChapter: {
    id: 'nextChapter',
    title: 'فصلِ بعدیِ کتاب یا فایلِ بعدیِ پوشه',
    category: 'ناوبری و مطالعه',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'PageDown',
    key: 'PageDown',
    label: 'Ctrl + PageDown',
    // مرحله ۱۲: کلیدهایِ سادهٔ بدونِ Modifier (D و PageDownِ بدونِ
    // Ctrl) دیگر هرگز فایلِ بازشدهٔ کاربر را نمی‌بندند؛ ناوبریِ
    // فصل/فایل، فقط با Ctrlِ نگه‌داشته‌شده انجام می‌شود. در
    // useKeyboard، اول پرشِ درون‌کتابی (فهرستِ PDF یا گروه‌هایِ
    // فصلِ کمیک) امتحان می‌شود و فقط وقتی فصلی نیست، فایلِ بعدیِ
    // پوشه باز می‌شود. اسمِ مستعارِ PageDownِ بدونِ Ctrl حذف شد،
    // چون حالا کلیدِ اصلیِ nextPage است.
  },
  prevChapter: {
    id: 'prevChapter',
    title: 'فصلِ قبلیِ کتاب یا فایلِ قبلیِ پوشه',
    category: 'ناوبری و مطالعه',
    ctrl: true,
    shift: false,
    alt: false,
    code: 'PageUp',
    key: 'PageUp',
    label: 'Ctrl + PageUp',
    // مرحله ۱۲: مانندِ nextChapter — کلیدهایِ سادهٔ A و PageUpِ
    // بدونِ Ctrl دیگر فایل را عوض نمی‌کنند؛ فقط Ctrl + PageUp.
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
  // مرحلهٔ ۵۳ مأموریت ۱: کلیدِ مردهٔ اسکرولِ نرم حذف شد — کلیدِ مرده بود؛
  // هیچ مصرف‌کننده‌ای نداشت و هیچ کنترلی هم برایش نبود.
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
  // مرحلهٔ ۳۵ §۶: تمپلیتِ کنترلِ اسلایدرِ هیرویِ کتابخانه (پیش‌فرض آینه).
  heroSliderVariant: 'mirror',
  // مرحلهٔ ۴۱ §۱: پیش‌فرض‌هایِ وابسته به فرمتِ فایل و رنگِ پس‌زمینهٔ ریدر.
  // در preferences ماندگار می‌شوند (localStorage + دیتابیس، مثلِ بقیهٔ کلیدها)
  // و رویِ فیلدهایِ هم‌نامِ سطحِ استور هم آینه می‌شوند.
  cbzDefaultZoom: 165,
  cbzDefaultViewMode: 'horizontal-paged',
  epubDefaultZoom: 100,
  epubDefaultViewMode: 'vertical',
  readerBackdropColor: '#2b3038',
  // مرحلهٔ ۵۲ §۳: گرادیانِ اسکرول‌بارِ صفحات (پیش‌فرض، همان گرادیانِ
  // فیروزه‌ای به بنفشِ مرحلهٔ ۴۵). در preferences ماندگار می‌شود
  // (localStorage + دیتابیس با SAVE_SETTING، مثلِ بقیهٔ کلیدها)
  // و رویِ فیلدهایِ هم‌نامِ سطحِ استور هم آینه می‌شود.
  scrollbarPresetId: 'neon-cyan-purple',
  scrollbarColorStart: '#22d3ee',
  scrollbarColorEnd: '#a78bfa',
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

// مرحلهٔ ۴۱ §۱: اعتبارسنجیِ مقادیرِ وابسته به فرمت (ورودیِ ذخیره‌شدهٔ
// قدیمی یا دیتابیس هم از همین فیلتر می‌گذرد).
const clampFormatZoom = (value, min, max, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};
const sanitizeFormatViewMode = (value, fallback) =>
  value === 'vertical' || value === 'horizontal-paged' ? value : fallback;
const sanitizeBackdropColor = (value, fallback) =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
// مرحلهٔ ۵۲ §۳: کاتالوگِ گرادیان‌هایِ آمادهٔ اسکرول‌بار — تنها مرجعِ
// پریست‌ها؛ SettingsView هم همین لیست را import می‌کند تا شناسه‌ها
// و رنگ‌ها در استور و رابط، دقیقاً یکی باشند.
export const SCROLLBAR_PRESETS = [
  { id: 'neon-cyan-purple', name: 'نئون سایبرپانک (پیش‌فرض)', start: '#22d3ee', end: '#a78bfa' },
  { id: 'emerald-ocean', name: 'زمرد اقیانوسی', start: '#34d399', end: '#0284c7' },
  { id: 'golden-coral-sunset', name: 'غروب طلایی و مرجانی', start: '#fbbf24', end: '#f43f5e' },
  { id: 'aurora-pink-violet', name: 'شفق قطبی (صورتی به بنفش)', start: '#f472b6', end: '#7c3aed' },
  { id: 'silver-navy-classic', name: 'نقره‌ای و سرمه‌ای کلاسیک', start: '#94a3b8', end: '#334155' },
];
// مرحلهٔ ۵۲ §۳: اعتبارسنجیِ پریست و رنگ‌هایِ گرادیان؛ مقدارِ نامعتبر،
// به مقدارِ جاری (fallback) برمی‌گردد و هرگز استور را خراب نمی‌کند.
// رنگ‌ها به حروفِ کوچک نرمال می‌شوند تا مقایسهٔ برابری، پایدار بماند.
const sanitizeScrollbarPresetId = (value, fallback) =>
  SCROLLBAR_PRESETS.some((p) => p.id === value) || value === 'custom' ? value : fallback;
const sanitizeScrollbarColor = (value, fallback) =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : fallback;
// آینهٔ سطحِ استور از preferences (منبعِ ماندگار): هر جا preferences
// عوض شود، این پنج فیلد هم همان‌جا همگام می‌شوند.
const syncFormatPrefs = (prefs) => ({
  cbzDefaultZoom: clampFormatZoom(prefs?.cbzDefaultZoom, 50, 300, 165),
  cbzDefaultViewMode: sanitizeFormatViewMode(prefs?.cbzDefaultViewMode, 'horizontal-paged'),
  epubDefaultZoom: clampFormatZoom(prefs?.epubDefaultZoom, 50, 250, 100),
  epubDefaultViewMode: sanitizeFormatViewMode(prefs?.epubDefaultViewMode, 'vertical'),
  readerBackdropColor: sanitizeBackdropColor(prefs?.readerBackdropColor, '#2b3038'),
  // مرحلهٔ ۵۲ §۳: آینهٔ سطحِ استورِ گرادیانِ اسکرول‌بار؛ چون این تابع
  // در همهٔ مسیرهایِ مقداردهی (initSettings ،updatePreferences
  // ،previewPreferences ،resetPreferences ،importSettingsJson)
  // صدا زده می‌شود، آینه همیشه با preferences همگام می‌ماند.
  scrollbarPresetId: sanitizeScrollbarPresetId(prefs?.scrollbarPresetId, 'neon-cyan-purple'),
  scrollbarColorStart: sanitizeScrollbarColor(prefs?.scrollbarColorStart, '#22d3ee'),
  scrollbarColorEnd: sanitizeScrollbarColor(prefs?.scrollbarColorEnd, '#a78bfa'),
});

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

// مرحله ۱۲: پیش‌فرض‌هایِ قدیمیِ فصل (کلیدهایِ سادهٔ D/A + اسمِ
// مستعارِ PageDown/PageUpِ بدونِ Ctrl) که فایلِ کاربر را
// بی‌هوا عوض می‌کردند. فقط ورودی‌ای که دقیقاً همین شکلِ قدیمی
// را دارد، به پیش‌فرضِ جدیدِ مرحلهٔ ۱۲ (Ctrl + PageDown/Up)
// مهاجرت می‌کند؛ ورودی‌ای که کاربر، خودش عوضش کرده باشد، دست
// نمی‌خورد (همان انضباطِ ترمیمِ زوم).
const LEGACY_CHAPTER_DEFAULTS = {
  nextChapter: {
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyD',
    key: 'd',
    label: 'D / PageDown',
    aliases: [{ code: 'PageDown', key: 'PageDown', ctrl: false, shift: false, alt: false }],
  },
  prevChapter: {
    ctrl: false,
    shift: false,
    alt: false,
    code: 'KeyA',
    key: 'a',
    label: 'A / PageUp',
    aliases: [{ code: 'PageUp', key: 'PageUp', ctrl: false, shift: false, alt: false }],
  },
};
const LEGACY_CHAPTER_REPLACEMENTS = {
  nextChapter: { ctrl: true, shift: false, alt: false, code: 'PageDown', key: 'PageDown', label: 'Ctrl + PageDown' },
  prevChapter: { ctrl: true, shift: false, alt: false, code: 'PageUp', key: 'PageUp', label: 'Ctrl + PageUp' },
};
function aliasesEqual(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((alias, i) => {
    const other = b[i];
    return (
      alias &&
      other &&
      Boolean(alias.ctrl) === Boolean(other.ctrl) &&
      Boolean(alias.shift) === Boolean(other.shift) &&
      Boolean(alias.alt) === Boolean(other.alt) &&
      alias.code === other.code &&
      alias.key === other.key
    );
  });
}

// مرحله ۱۲: اعتبارسنجیِ ساختاریِ ورودیِ میانبر. ورودیِ خراب یا
// ناقص (از جمله کلیدهایِ ناقصی که در دورهٔ باگِ پرشِ فوکوسِ
// ضبط‌کننده ثبت شده باشند) هرگز نباید رفتارِ اشتباه بسازد:
// ورودیِ غیرِآبجکتی، به پیش‌فرضِ همان اکشن برمی‌گردد؛ فیلدهایِ
// نامعتبر، به نوعِ درست برگردانده می‌شوند؛ اسم‌هایِ مستعارِ
// نامعتبر، حذف می‌شوند.
function sanitizeShortcutEntry(id, entry) {
  const fallback = DEFAULT_SHORTCUTS[id];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return fallback ? { ...fallback } : entry;
  }
  const clean = { ...(fallback || {}), ...entry, id };
  clean.ctrl = Boolean(clean.ctrl);
  clean.shift = Boolean(clean.shift);
  clean.alt = Boolean(clean.alt);
  clean.ignoreShift = Boolean(clean.ignoreShift);
  clean.code = typeof clean.code === 'string' ? clean.code : '';
  clean.key = typeof clean.key === 'string' ? clean.key : '';
  clean.label = typeof clean.label === 'string' ? clean.label : '';
  clean.title =
    typeof clean.title === 'string' && clean.title ? clean.title : fallback?.title || id;
  clean.category =
    typeof clean.category === 'string' && clean.category ? clean.category : fallback?.category || '';
  if (clean.aliases !== undefined) {
    if (Array.isArray(clean.aliases)) {
      clean.aliases = clean.aliases
        .filter(
          (alias) =>
            alias &&
            typeof alias === 'object' &&
            (typeof alias.code === 'string' || typeof alias.key === 'string')
        )
        .map((alias) => ({
          ...alias,
          ctrl: Boolean(alias.ctrl),
          shift: Boolean(alias.shift),
          alt: Boolean(alias.alt),
          code: typeof alias.code === 'string' ? alias.code : '',
          key: typeof alias.key === 'string' ? alias.key : '',
        }));
      if (clean.aliases.length === 0) delete clean.aliases;
    } else {
      delete clean.aliases;
    }
  }
  return clean;
}

function normalizeLegacyShortcut(id, entry) {
  const clean = sanitizeShortcutEntry(id, entry);
  const legacy = LEGACY_ZOOM_DEFAULTS[id];
  if (legacy && clean) {
    const isLegacy =
      Boolean(clean.ctrl) === legacy.ctrl &&
      Boolean(clean.shift) === legacy.shift &&
      Boolean(clean.alt) === legacy.alt &&
      clean.code === legacy.code &&
      clean.key === legacy.key &&
      clean.label === legacy.label;
    if (isLegacy) return { ...clean, ctrl: true, label: LEGACY_ZOOM_LABELS[id] };
  }
  const chapterLegacy = LEGACY_CHAPTER_DEFAULTS[id];
  if (chapterLegacy && clean) {
    const isChapterLegacy =
      Boolean(clean.ctrl) === chapterLegacy.ctrl &&
      Boolean(clean.shift) === chapterLegacy.shift &&
      Boolean(clean.alt) === chapterLegacy.alt &&
      clean.code === chapterLegacy.code &&
      clean.key === chapterLegacy.key &&
      clean.label === chapterLegacy.label &&
      aliasesEqual(clean.aliases, chapterLegacy.aliases);
    if (isChapterLegacy) {
      const replacement = LEGACY_CHAPTER_REPLACEMENTS[id];
      const migrated = { ...clean, ...replacement };
      delete migrated.aliases;
      return migrated;
    }
  }
  return clean;
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

export const useSettingsStore = create((set, get) => ({
  shortcuts: buildInitialShortcuts(),
  preferences: (() => {
    const base = { ...DEFAULT_PREFERENCES, ...(saved?.preferences || {}) };
    // مرحلهٔ ۵۳ مأموریت ۱: مقدارِ قدیمیِ کلیدِ مرده در
    // localStorage (از نسخه‌هایِ پیشین) این‌جا حذف می‌شود تا در
    // استورِ زنده نماند.
    delete base.smoothScroll;
    // مرحلهٔ ۳۵ §۶: اگر تنظیماتِ ذخیره‌شده، تمپلیت را ندارند، آینهٔ
    // localStorage (کلیدِ comicReader.heroSliderVariant.v1) به‌عنوانِ
    // fallback خوانده می‌شود؛ وگرنه پیش‌فرضِ 'mirror' می‌ماند.
    if (!saved?.preferences?.heroSliderVariant) {
      try {
        const mirror = localStorage.getItem('comicReader.heroSliderVariant.v1');
        if (['led', 'mirror', 'matrix', 'pendulum', 'firefly'].includes(mirror)) base.heroSliderVariant = mirror;
      } catch (_) {}
    }
    return base;
  })(),
  profile: { ...DEFAULT_PROFILE, ...(saved?.profile || {}) },
  // مرحلهٔ ۴۱ §۱: آینهٔ سطحِ استورِ تنظیماتِ وابسته به فرمت؛ مقدارِ
  // اولیه از همان preferencesِ ذخیره‌شده در localStorage خوانده می‌شود.
  ...syncFormatPrefs(saved?.preferences),

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
        // مرحلهٔ ۵۳ مأموریت ۱: ردیفِ قدیمیِ کلیدِ مرده در
        // دیتابیس (از نسخه‌هایِ پیشین) این‌جا حذف می‌شود تا در
        // ادغام برنگردد.
        delete mergedPrefs.smoothScroll;
        set({ preferences: mergedPrefs, ...syncFormatPrefs(mergedPrefs) });
      }

      // دریافت میانبرها
      const scRes = await coreApi.dbAction({ action: 'GET_SHORTCUTS' });
      if (scRes?.shortcuts && Object.keys(scRes.shortcuts).length > 0) {
        const mergedShortcuts = { ...get().shortcuts, ...scRes.shortcuts };
        Object.keys(mergedShortcuts).forEach((id) => {
          // مرحله ۱۲: شناسهٔ ناشناخته (اکشنِ حذف‌شده یا ورودیِ
          // خرابِ دیتابیس)، از ادغام حذف می‌شود تا ردیفِ مرده
          // نسازد؛ بقیه، اعتبارسنجی و مهاجرتِ قدیمی را می‌گذرانند.
          if (!DEFAULT_SHORTCUTS[id]) {
            delete mergedShortcuts[id];
            return;
          }
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
    const nextPrefs = { ...get().preferences, ...partialPrefs };
    set({ preferences: nextPrefs, ...syncFormatPrefs(nextPrefs) });
  },

  // ۳. تنظیمات برنامه و ریدر با ذخیره هماهنگ در دیتابیس
  // مرحلهٔ ۳۵ §۶: انتخابِ تمپلیتِ اسلایدر — هم در استور و دیتابیس
  // (از طریقِ updatePreferences) و هم در آینهٔ localStorage ماندگار
  // می‌شود تا انتخابِ کاربر، حتی پیش از initSettings هم خوانا باشد.
  setHeroSliderVariant: (variant) => {
    const v = ['led', 'mirror', 'matrix', 'pendulum', 'firefly'].includes(variant) ? variant : 'mirror';
    get().updatePreferences({ heroSliderVariant: v });
    try { localStorage.setItem('comicReader.heroSliderVariant.v1', v); } catch (_) {}
  },

  // مرحلهٔ ۴۱ §۱: اکشن‌هایِ تنظیماتِ وابسته به فرمت و رنگِ پس‌زمینهٔ ریدر.
  // هر کدام از همان مسیرِ updatePreferences می‌گذرد، پس هم در localStorage
  // و هم با SAVE_SETTING در دیتابیس ماندگار می‌شود. مقدارِ نامعتبر،
  // بی‌صدا نادیده گرفته می‌شود (مقدارِ جاری می‌ماند).
  setCbzDefaultZoom: (value) => {
    const v = clampFormatZoom(value, 50, 300, get().cbzDefaultZoom ?? 165);
    if (get().cbzDefaultZoom === v) return;
    get().updatePreferences({ cbzDefaultZoom: v });
  },

  setCbzDefaultViewMode: (mode) => {
    const v = sanitizeFormatViewMode(mode, get().cbzDefaultViewMode ?? 'horizontal-paged');
    if (get().cbzDefaultViewMode === v) return;
    get().updatePreferences({ cbzDefaultViewMode: v });
  },

  setEpubDefaultZoom: (value) => {
    const v = clampFormatZoom(value, 50, 250, get().epubDefaultZoom ?? 100);
    if (get().epubDefaultZoom === v) return;
    get().updatePreferences({ epubDefaultZoom: v });
  },

  setEpubDefaultViewMode: (mode) => {
    const v = sanitizeFormatViewMode(mode, get().epubDefaultViewMode ?? 'vertical');
    if (get().epubDefaultViewMode === v) return;
    get().updatePreferences({ epubDefaultViewMode: v });
  },

  setReaderBackdropColor: (color) => {
    const v = sanitizeBackdropColor(color, get().readerBackdropColor ?? '#2b3038');
    if (get().readerBackdropColor === v) return;
    get().updatePreferences({ readerBackdropColor: v });
  },

  // مرحلهٔ ۵۲ §۳: گرادیانِ اسکرول‌بارِ صفحات. انتخابِ یک پریست، هر
  // سه مقدار (presetId و دو رنگ) را با هم می‌گذارد؛ ویرایشِ رنگِ
  // سفارشی، presetId را 'custom' می‌کند (فراخواننده همین مقدار را
  // می‌فرستد). از همان مسیرِ updatePreferences می‌گذرد، پس هم در
  // localStorage و هم با SAVE_SETTING برایِ هر کلید در kv_store
  // ماندگار می‌شود. مقدارِ نامعتبر، بی‌صدا نادیده گرفته می‌شود
  // (مقدارِ جاری می‌ماند) و تغییرِ تکراری، هیچ ذخیره‌ای نمی‌کند.
  setScrollbarGradient: (presetId, startColor, endColor) => {
    const current = get();
    const vPreset = sanitizeScrollbarPresetId(presetId, current.scrollbarPresetId ?? 'neon-cyan-purple');
    const vStart = sanitizeScrollbarColor(startColor, current.scrollbarColorStart ?? '#22d3ee');
    const vEnd = sanitizeScrollbarColor(endColor, current.scrollbarColorEnd ?? '#a78bfa');
    if (
      current.scrollbarPresetId === vPreset &&
      current.scrollbarColorStart === vStart &&
      current.scrollbarColorEnd === vEnd
    ) {
      return;
    }
    get().updatePreferences({
      scrollbarPresetId: vPreset,
      scrollbarColorStart: vStart,
      scrollbarColorEnd: vEnd,
    });
  },

  updatePreferences: (partialPrefs) => {
    const updated = { ...get().preferences, ...partialPrefs };
    set({ preferences: updated, ...syncFormatPrefs(updated) });
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

  // مرحلهٔ ۵۳ مأموریت ۱: نامِ مستعارِ مفردِ updatePreferences —
  // SettingsView و هر فراخوانندهٔ قدیمی با امضایِ (key, value)
  // صدا می‌زنند؛ هر دو امضا از یک مسیر می‌گذرند، پس هم در
  // localStorage و هم با SAVE_SETTING در دیتابیس ماندگار می‌شوند.
  updatePreference: (key, value) => get().updatePreferences({ [key]: value }),

  resetPreferences: () => {
    set({ preferences: { ...DEFAULT_PREFERENCES }, ...syncFormatPrefs(DEFAULT_PREFERENCES) });
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
      // مرحلهٔ ۵۳ مأموریت ۱: مقدارِ قدیمیِ کلیدِ مرده در فایلِ
      // واردشده حذف می‌شود تا کلیدِ مرده برنگردد.
      if (parsed.preferences) delete nextPrefs.smoothScroll;
      const nextProfile = parsed.profile
        ? { ...DEFAULT_PROFILE, ...parsed.profile }
        : get().profile;

      set({
        shortcuts: nextShortcuts,
        preferences: nextPrefs,
        profile: nextProfile,
        ...syncFormatPrefs(nextPrefs),
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
