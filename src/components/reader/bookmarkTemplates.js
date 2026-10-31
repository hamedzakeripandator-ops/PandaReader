// مرحله ۱۳: تمپلیت‌ها و پس‌زمینه‌هایِ داخلیِ سیستمِ بوک‌مارکِ دیجیتال.
// دقیقاً همین ۱۵ تمپلیت پشتیبانی می‌شوند؛ تمپلیتِ دیگری ساخته
// نمی‌شود و نام‌هایِ قدیمیِ حذف‌شده، این‌جا وجود ندارند.

export const BOOKMARK_TEMPLATE_IDS = [
  'MARGIN',
  'SLANT',
  'ARROW',
  'MIRROR',
  'FLIP',
  'ZOOM',
  'SWAY',
  'GLOW',
  'FLOAT',
  'SLIDE',
  'SPLIT',
  'TILT',
  'WAVE',
  'DIAGONAL',
  'OFFSET',
];

export const BOOKMARK_TEMPLATES = [
  { id: 'MARGIN', faLabel: 'حاشیه', desc: 'قابِ طلایی با جابه‌جاییِ ملایم در هاور' },
  { id: 'SLANT', faLabel: 'کج', desc: 'کمی کج می‌ایستد و در هاور صاف می‌شود' },
  { id: 'ARROW', faLabel: 'پیکان', desc: 'نوکِ پیکانی در پایین و پرشِ نرم در هاور' },
  { id: 'MIRROR', faLabel: 'آینه', desc: 'عکس + انعکاسِ وارونهٔ محو در پایین' },
  { id: 'FLIP', faLabel: 'چرخان', desc: 'کارتِ سه‌بعدی؛ در هاور پشتِ کارت دیده می‌شود' },
  { id: 'ZOOM', faLabel: 'بزرگ‌نما', desc: 'عکس در هاور از مرکز بزرگ می‌شود' },
  { id: 'SWAY', faLabel: 'تاب‌خور', desc: 'در هاور مثلِ آویز تاب می‌خورد' },
  { id: 'GLOW', faLabel: 'درخشان', desc: 'درخششِ طلاییِ ضربان‌دار در هاور' },
  { id: 'FLOAT', faLabel: 'شناور', desc: 'در هاور شناور می‌شود و سایه‌اش عمیق‌تر می‌شود' },
  { id: 'SLIDE', faLabel: 'لغزنده', desc: 'تصویر در هاور به بالا می‌لغزد' },
  { id: 'SPLIT', faLabel: 'برش‌خورده', desc: 'عکس در سه برشِ افقی؛ برش‌هایِ کناری در هاور جابه‌جا می‌شوند' },
  { id: 'TILT', faLabel: 'کجِ سه‌بعدی', desc: 'کجیِ سه‌بعدی در هاور' },
  { id: 'WAVE', faLabel: 'موجی', desc: 'تکانِ موجیِ ملایم در هاور' },
  { id: 'DIAGONAL', faLabel: 'مورب', desc: 'برشِ موربِ ملایم در بالایِ عکس' },
  { id: 'OFFSET', faLabel: 'سایه‌دار', desc: 'لایهٔ پشتیِ خاکستریِ هم‌عکس که در هاور نزدیک‌تر می‌شود' },
];

export const BOOKMARK_TEMPLATE_MAP = Object.fromEntries(
  BOOKMARK_TEMPLATES.map((t) => [t.id, t])
);

export function isValidBookmarkTemplate(id) {
  return BOOKMARK_TEMPLATE_IDS.includes(id);
}

export const DEFAULT_BOOKMARK_PREFERENCES = {
  defaultTemplate: 'MARGIN',
  globalImage: null,
  templateImages: {},
  defaultSide: 'right',
};

// پس‌زمینه‌هایِ داخلی (SVG به‌صورتِ Data-URI). این‌ها همیشه در
// گالری هستند، حتی وقتی پوشهٔ bookmark-backgrounds خالی است.
const svgUri = (svg) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);

// مرحله ۱۵: ۷ والپیپرِ پیش‌فرضِ اولیه (شب و ماه، طلایی و...)
// به دستورِ کاربر، به‌طورِ کامل حذف شدند. نامِ خروجی، برای
// سازگاریِ ایمپورت‌ها حفظ شده ولی فهرست، خالی است تا گالری،
// فقط عکس‌هایِ واقعیِ پوشهٔ bookmark-backgrounds را نشان دهد.
// پریست‌هایی که از قبل، آدرسِ داده‌ایِ (data URI) همان عکس‌ها
// را ذخیره کرده‌اند، همچنان کار می‌کنند چون آدرس، در خودِ
// رکورد است، نه در این فهرست.
export const BUILTIN_BOOKMARK_BACKGROUNDS = [];

// مختصاتِ عمودی: همیشه بینِ ۰ تا ۰٫۹۲ نگه داشته می‌شود تا
// بوک‌مارک، هرگز پایین‌تر از محدودهٔ دیدِ صفحه نرود.
export function clampYRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(0.92, n));
}

// نقطهٔ مرکزِ دیدِ ویوپورت رویِ صفحهٔ فعال: وقتی بوک‌مارک از
// راهِ دکمه/پنل (نه کلیکِ مستقیم) ساخته می‌شود، همین نقطه مبناست.
export function computeViewportCenterYRatio(pageNumber) {
  try {
    const el = document.getElementById(`comic-page-${pageNumber}`);
    if (!el) return 0.5;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.height <= 0) return 0.5;
    const centerY = window.innerHeight / 2;
    return clampYRatio((centerY - rect.top) / rect.height);
  } catch (_) {
    return 0.5;
  }
}

// ترتیبِ حلِ تصویرِ بوک‌مارک: تصویرِ اختصاصیِ خودِ بوک‌مارک،
// بعد تصویرِ پیش‌فرضِ تمپلیت، بعد تصویرِ سراسری، وگرنه null
// (یعنی بافتِ خاکستریِ پیش‌فرضِ مارکر).
export function resolveBookmarkImage(bookmark, preferences) {
  if (!bookmark) return null;
  if (bookmark.image) return bookmark.image;
  const prefs = preferences || {};
  if (prefs.templateImages && prefs.templateImages[bookmark.template]) {
    return prefs.templateImages[bookmark.template];
  }
  if (prefs.globalImage) return prefs.globalImage;
  return null;
}

export function newBookmarkId() {
  return 'bm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// اعتبارسنجیِ بوک‌مارکِ خوانده‌شده از دیتابیس؛ ورودیِ خراب،
// به‌جایِ شکستنِ رندر، حذف می‌شود (null برمی‌گردد).
export function sanitizeBookmark(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const page = Number(raw.page);
  if (!Number.isFinite(page) || page < 1) return null;
  const template = isValidBookmarkTemplate(raw.template)
    ? raw.template
    : 'MARGIN';
  const side = raw.side === 'left' ? 'left' : 'right';
  const focalPoint =
    raw.focalPoint === 'top' || raw.focalPoint === 'bottom' ? raw.focalPoint : 'center';
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newBookmarkId(),
    page: Math.floor(page),
    yRatio: clampYRatio(raw.yRatio),
    side,
    template,
    image: typeof raw.image === 'string' ? raw.image : null,
    focalPoint,
    name: typeof raw.name === 'string' ? raw.name.slice(0, 60) : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };
}
