// ============================================================================
// AnnotationToolbar.jsx — فاز ۱: یکپارچه‌سازی با والد
// ساختار تمیز نسخه ۳ حفظ شده + اتصال props از PdfViewer
// قرارداد:
//   - اگر onUndo/onRedo/onClearPage از والد آمد → آن‌ها صدا زده می‌شوند
//   - در غیر این صورت → fallback به رویدادهای window
// ============================================================================

// Cycle-fix (2026-10-25) — قانونِ عدمِ چرخه: این فایل، هرگز نباید
// چیزی از './AnnotationLayer' ایمپورت کند و هرگز نباید خودش را
// re-export کند. تولبار، فقط از useAppStore و useSettingsStore و
// annotationEngine تغذیه می‌شود؛ PdfViewer، تولبار و لایه را هر
// کدام مستقیم از فایلِ خودشان ایمپورت می‌کنند. این کامنت، فقط
// مستندسازی است؛ کدِ این فایل در این گام، دست نخورده است (چون
// از قبل هم هیچ ارجاعی به لایه نداشت).

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Hand as HandLucide } from 'lucide-react';
import useAppStore from '../../store/useAppStore';
import useSettingsStore from '../../store/useSettingsStore';
import Icons from '../common/Icons';

const TOOLS = [
  // فاز ۵: ابزار انتخاب — اولین آیتم، طبقِ TASK. آیکونِ MousePointer
  // در Icons.jsxی کاربر موجود است (خط ۳۲۱)؛ مثلِ فازهای ۳ و ۴،
  // fallbackِ رشته‌ای ('MousePointer') استفاده نشد، چون در رندر به
  // المانِ HTMLِ ناشناخته تبدیل می‌شد، نه آیکون. اضافه شدنِ این
  // ورودی، تلهٔ activeId را هم رفع می‌کند (قبلاً 'select' در TOOLS
  // نبود و activeId به 'pen' برمی‌گشت).
  { id: 'select', label: 'انتخاب (V)', shortcut: 'V', Icon: Icons.MousePointer },
  // مرحله 44 §3: ابزارِ دست — آیکونِ Hand در Icons.jsx نیست، پس مستقیم از lucide-react می‌آید.
  { id: 'hand', label: 'ابزار دست (حرکت در صفحه)', Icon: HandLucide },
  { id: 'pen', label: 'قلم (P)', shortcut: 'P', Icon: Icons.PenTool },
  { id: 'box', label: 'کادربندی (B)', shortcut: 'B', Icon: Icons.Square },
  // فاز ۳: ابزار فلش — فیلد Icon با قرارداد موجود تولبار یکدست است
  // (در نسخه‌های Icons، چه فاز ۱ و چه قدیمی، ArrowUpRight موجود است).
  { id: 'arrow', label: 'فلش (A)', shortcut: 'A', Icon: Icons.ArrowUpRight },
  // فاز ۴: ابزارهای متن و استیکی — آیکون‌ها در Icons.jsx فاز ۱ و نسخهٔ
  // قدیمی موجود‌اند (Type و StickyNote)؛ مثل فاز ۳، فیلد Icon مستقیم
  // استفاده می‌شود، چون fallback رشته‌ای ('Type') در رندر به‌عنوانِ
  // المانِ ناشناختهٔ HTML درمی‌آمد، نه آیکون.
  { id: 'text', label: 'متن (T)', shortcut: 'T', Icon: Icons.Type },
  { id: 'sticky', label: 'استیکی‌نوت (N)', shortcut: 'N', Icon: Icons.StickyNote },
  { id: 'highlighter', label: 'هایلایت (H)', shortcut: 'H', Icon: Icons.Highlighter },
  { id: 'eraser', label: 'پاک‌کن (E)', shortcut: 'E', Icon: Icons.Eraser, danger: true },
];

const COLORS = [
  { hex: '#FFCC00', label: 'زرد' },
  { hex: '#00D4FF', label: 'فیروزه‌ای' },
  { hex: '#10B981', label: 'سبز' },
  { hex: '#FF577F', label: 'قرمز' },
  { hex: '#A855F7', label: 'بنفش' },
  { hex: '#FF8A00', label: 'نارنجی' },
  { hex: '#f8fafc', label: 'سفید' },
  { hex: '#0f172a', label: 'مشکی' },
];

const SIZES = [1, 2, 4, 7, 11];

// مرحلهٔ ۳۹ §۳: تبدیلِ هگز ↔ HSL برایِ اسلایدرهایِ انتخابگرِ پیشرفته.
function hexToHsl(hex) {
  const m = /^#([0-9a-fA-F]{6})$/.exec(String(hex || ''));
  if (!m) return { h: 190, s: 80, l: 55 };
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  const hh = ((((Number(h) || 0) % 360) + 360) % 360) / 360;
  const ss = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
  const ll = Math.max(0, Math.min(100, Number(l) || 0)) / 100;
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(hh + 1 / 3))}${to(f(hh))}${to(f(hh - 1 / 3))}`;
}

// مرحلهٔ ۵۸ مأموریتِ ۴: موتورِ مرزِ امنِ نمایِ دراور و پاپ‌اورها —
// پنل، همیشه باید داخلِ [SAFE_TOP ،window.innerHeight - 16] و
// [SAFE_LEFT ،window.innerWidth - 16] بماند و هرگز زیرِ TopBar
// (۶۴ پیکسلِ بالای صفحه) یا بیرونِ لبهٔ پایین نرود. تابع، خالص
// است (بدونِ خواندنِ state) تا تستِ Node هم بتواند مستقیم صدایش
// بزند؛ ورودیِ viewport اختیاری است و پیش‌فرض، window است.
export const SAFE_TOP = 64;
export const SAFE_LEFT = 16;
export const SAFE_VIEWPORT_GAP = 16;
export function computeSafePopoverPosition(desiredTop, panelHeight, desiredLeft, panelWidth, viewportWidth, viewportHeight) {
  const vw = Number(viewportWidth) || (typeof window !== 'undefined' ? window.innerWidth : 1024);
  const vh = Number(viewportHeight) || (typeof window !== 'undefined' ? window.innerHeight : 768);
  const safeBottom = vh - SAFE_VIEWPORT_GAP;
  const safeRight = vw - SAFE_VIEWPORT_GAP;
  const maxHeight = Math.min(440, vh - SAFE_TOP - 24);
  const height = Math.max(0, Math.min(Number(panelHeight) || 0, maxHeight));
  const width = Math.max(0, Number(panelWidth) || 0);
  const clampedTop = Math.max(SAFE_TOP, Math.min(Number(desiredTop) || SAFE_TOP, safeBottom - height));
  const maxLeft = Math.max(SAFE_LEFT, safeRight - width);
  const clampedLeft = Math.max(SAFE_LEFT, Math.min(Number(desiredLeft) || SAFE_LEFT, maxLeft));
  return { top: clampedTop, left: clampedLeft, maxHeight };
}

// فاز ۳ پالت — دسته‌بندی‌های تخصصیِ دراور (دقیقاً همان ۲۵ رنگِ
// فهرست‌شده در تسک: پزشکی ۸ + نئون ۵ + سایبرپانک ۶ + پاستلی ۶.
// توجهِ صادقانه: عنوانِ تسک «پالت ۳۰ رنگ» می‌گوید، ولی فهرستِ
// دسته‌ها ۲۵ رنگ دارد؛ پس همان ۲۵ رنگِ فهرست‌شده پیاده شد و هیچ
// رنگِ حدسی اضافه نشد — اگر ۵ رنگِ دیگر خواسته شود، همین‌جا
// اضافه می‌شود.)
const PALETTE_CATEGORIES = [
  {
    id: 'medical',
    label: 'پزشکی و آناتومی',
    colors: [
      { hex: '#ef4444', label: 'قرمز شریانی' },
      { hex: '#2563eb', label: 'آبی وریدی' },
      { hex: '#eab308', label: 'زرد عصبی' },
      { hex: '#16a34a', label: 'سبز لنفاوی' },
      { hex: '#fde68a', label: 'استخوانی/بژ' },
      { hex: '#9333ea', label: 'بنفش بافت' },
      { hex: '#ec4899', label: 'صورتی موکوس' },
      { hex: '#b45309', label: 'قهوه‌ای تاندون' },
    ],
  },
  {
    id: 'neon',
    label: 'نئون',
    colors: [
      { hex: '#FFCC00', label: 'زرد فسفری' },
      { hex: '#10B981', label: 'سبز نئون' },
      { hex: '#00D4FF', label: 'آبی فیروزه‌ای' },
      { hex: '#FF577F', label: 'سرخابی نئون' },
      { hex: '#FF8A00', label: 'نارنجی فسفری' },
    ],
  },
  {
    id: 'cyberpunk',
    label: 'سایبرپانک و دارک',
    colors: [
      { hex: '#00f2fe', label: 'فیروزه‌ای درخشان' },
      { hex: '#A855F7', label: 'ماژنتا نئون' },
      { hex: '#38bdf8', label: 'آبی آسمانی' },
      { hex: '#64748b', label: 'خاکستری اسلیتی' },
      { hex: '#1e293b', label: 'سرمه‌ای تیره' },
      { hex: '#000000', label: 'مشکی مطلق' },
    ],
  },
  {
    id: 'pastel',
    label: 'پاستلی ملایم',
    colors: [
      { hex: '#fca5a5', label: 'رز پاستلی' },
      { hex: '#fef08a', label: 'لیموعی ملایم' },
      { hex: '#86efac', label: 'نعنایی روشن' },
      { hex: '#93c5fd', label: 'آبی لطیف' },
      { hex: '#d8b4fe', label: 'یاسی روشن' },
      { hex: '#ffffff', label: 'سفید خالص' },
    ],
  },
];


// فاز ۲: استایل‌های کادربندی
const BOX_STYLES = [
  { id: 'cloud', label: 'ابری' },
  { id: 'rect', label: 'مستطیل' },
  { id: 'round', label: 'گوشه‌گرد' },
];

// فاز ۳: استایل‌های فلش
const ARROW_STYLES = [
  { id: 'straight', label: 'صاف' },
  { id: 'curved', label: 'منحنی' },
];

// گام ۲ میانی: گزینه‌های فونت — دقیقاً برابرِ فونت‌های محلیِ پروژه
// (public/fonts + @font-faceهای src/index.css): استعداد (فارسیِ اصلی،
// ۵ وزن)، منروپ (لاتین) و جت‌برینز مونو (تک‌فاصله). وزیرمتن کنار گذاشته
// شد، چون هیچ فایلِ woff2ای برایش در public/fonts نیست و @font-faceای
// هم ندارد (فقط در متغیرِ --font-fa به‌عنوانِ fallbackِ سیستمی آمده بود،
// نه فونتِ باندل‌شده). پیش‌فرضِ استور هم "'Estedad', sans-serif" است،
// پس پیلِ استعداد از اول فعال نشان داده می‌شود (مشکلِ قدیمیِ «هیچ پیلی
// فعال نیست» که در فاز ۴ مستند شده بود، با همین تغییر رفع می‌شود).
// مرحلهٔ ۵۸ مأموریتِ ۵ (تصحیحِ صادقانهٔ برچسب‌ها): پرامپت، سه برچسبِ
// «وزیرمتن (پیش‌فرض)»، «خوانا (نسخ)» و «کد (مونو)» خواسته بود، ولی
// هیچ‌کدام رویِ فونت‌هایِ باندل‌شده صادق نیست: وزیرمتن باندل نشده
// (پس برچسبِ «وزیرمتن» دروغ می‌گوید که چه فونتی رندر می‌شود) و هیچ
// فونتِ نسخی هم باندل نشده (منروپ، فونتِ لاتینِ عناوین است، نه نسخ).
// پس برچسب‌ها صادقانه ماندند: استعداد (که پیش‌فرضِ واقعیِ استور
// است و در سربرگِ کنسولِ تایپو هم «پیش‌فرض: استعداد» نوشته می‌شود)،
// منروپ با نشانِ «لاتین»، و مونو با «کد (مونو)». اگر وزیرمتن یا
// ایران‌یکان روزی باندل شدند، همین‌جا اضافه می‌شوند.
const FONT_OPTIONS = [
  { id: "'Estedad', sans-serif", label: 'استعداد' },
  { id: "'Manrope', sans-serif", label: 'منروپ (لاتین)' },
  { id: "'JetBrains Mono', monospace", label: 'کد (مونو)' },
];

// ============================================================================
// مرحله ۷ ـ بخش الف: میانبرهای ابزار، فقط از مرجعِ واحد
// (matchesShortcut در useSettingsStore) خوانده می‌شوند.
// نگاشتِ قبلیِ مبتنی بر حرفِ کلید، فقط حرفِ کلید را از ورودی
// می‌خواند و modifier را کاملاً نادیده می‌گرفت: میانبری مثلِ
// Ctrl+P در تولبار، با فشردنِ Pی ساده هم ابزار را عوض می‌کرد، و
// میانبری مثلِ F2 اصلاً از این مسیر، دست‌نیافتنی بود. حالا رویدادِ
// کامل (code/key/modifierها) به matcher داده می‌شود؛ پس تغییرِ
// میانبر در تنظیمات، کلیدِ قبلی را واقعاً خلع می‌کند. این تابع، در
// هر keydown از getState خوانده می‌شود تا تغییرِ تنظیمات، بدونِ
// ری‌ماونتِ تولبار اعمال شود.
// ============================================================================
const STUDIO_TOOL_SETTING_IDS = {
  select: 'toolSelect',
  pen: 'toolPen',
  box: 'toolBox',
  arrow: 'toolArrow',
  text: 'toolText',
  sticky: 'toolSticky',
  highlighter: 'toolHighlighter',
  eraser: 'toolEraser',
};
export function resolveStudioToolForEvent(e) {
  try {
    const settingsState = typeof useSettingsStore.getState === 'function'
      ? useSettingsStore.getState()
      : null;
    if (!settingsState?.matchesShortcut) return null;
    for (const [toolId, settingId] of Object.entries(STUDIO_TOOL_SETTING_IDS)) {
      if (settingsState.matchesShortcut(settingId, e)) return toolId;
    }
  } catch (_) {
    // اگر استورِ تنظیمات در دسترس نبود، هیچ ابزاری برنمی‌گردد.
  }
  return null;
}

const btnBase = {
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background 0.15s, color 0.15s, outline 0.15s, transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.25s ease',
};

export function AnnotationToolbar({
  activePage = 1,
  pageItemCount = 0,
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onClearPage,
  onExportAnnotatedPdf,
  isExportingPdf = false,
  pdfSaveState = 'idle',
} = {}) {
  const isAnnotationActive = useAppStore((s) => Boolean(s.isAnnotationActive));
  const annotationTool = useAppStore((s) => s.annotationTool || 'pen');
  const setAnnotationTool = useAppStore((s) => s.setAnnotationTool);
  // مرحله 44 §3: زیرحالتِ انتخاب + تغییرِ آن (برای چیپ‌های کنارِ دکمهٔ select).
  const selectSubMode = useAppStore((s) => s.selectSubMode || 'box');
  const setSelectSubMode = useAppStore((s) => s.setSelectSubMode);
  const annotationColor = useAppStore((s) => s.annotationColor || '#22d3ee');
  const setAnnotationColor = useAppStore((s) => s.setAnnotationColor);
  // مرحلهٔ ۳۹ §۳: سیستمِ رنگِ سفارشیِ استور.
  const favoriteColors = useAppStore((s) => s.favoriteColors || []);
  const addFavoriteColor = useAppStore((s) => s.addFavoriteColor);
  const removeFavoriteColor = useAppStore((s) => s.removeFavoriteColor);
  const customColorTemplates = useAppStore((s) => s.customColorTemplates || []);
  const createCustomColorTemplate = useAppStore((s) => s.createCustomColorTemplate);
  const deleteCustomColorTemplate = useAppStore((s) => s.deleteCustomColorTemplate);
  const updateCustomColorTemplate = useAppStore((s) => s.updateCustomColorTemplate);
  // مرحلهٔ ۵۷ مأموریتِ ۲: پالتِ فعالِ نوار ابزار + رنگ‌هایِ اصلیِ نوار
  // (همه در customColorSystemی استور؛ ماندگاری: localStorage + دیتابیس).
  const activePaletteId = useAppStore((s) => s.activePaletteId || 'default');
  const primaryToolbarColors = useAppStore((s) => s.primaryToolbarColors || []);
  const setActivePaletteId = useAppStore((s) => s.setActivePaletteId);
  const addPrimaryToolbarColor = useAppStore((s) => s.addPrimaryToolbarColor);
  const removePrimaryToolbarColor = useAppStore((s) => s.removePrimaryToolbarColor);
  // مرحلهٔ ۵۶ مأموریتِ ۱: توست برای بازخوردِ ذخیرهٔ تمپلیت/رنگ.
  const showToast = useAppStore((s) => s.showToast);
  const annotationStrokeWidth = useAppStore((s) => s.annotationStrokeWidth || 4);
  const setAnnotationStrokeWidth = useAppStore((s) => s.setAnnotationStrokeWidth);
  // فاز ۲: استیت‌های باکس
  const annotationBoxStyle = useAppStore((s) => s.annotationBoxStyle || 'cloud');
  const setAnnotationBoxStyle = useAppStore((s) => s.setAnnotationBoxStyle);
  const annotationHasFill = useAppStore((s) => Boolean(s.annotationHasFill));
  const toggleAnnotationFill = useAppStore((s) => s.toggleAnnotationFill);
  // فاز ۳: استیت‌های فلش
  const annotationArrowStyle = useAppStore((s) => s.annotationArrowStyle || 'straight');
  const setAnnotationArrowStyle = useAppStore((s) => s.setAnnotationArrowStyle);
  // Refinement Step 2: شفافیت + پرچم‌های ماژولارِ فلش (پیش‌فرض: هر دو روشن).
  const annotationOpacity = useAppStore((s) => (typeof s.annotationOpacity === 'number' ? s.annotationOpacity : 0.85));
  const zoomAdaptiveAnnotations = useAppStore((s) => s.zoomAdaptiveAnnotations !== false);
  const stickyManualScale = useAppStore((s) => s.stickyManualScale || 1);
  const setZoomAdaptiveAnnotations = useAppStore((s) => s.setZoomAdaptiveAnnotations);
  const setStickyManualScale = useAppStore((s) => s.setStickyManualScale);
  const setAnnotationOpacity = useAppStore((s) => s.setAnnotationOpacity);
  const annotationHasStartDot = useAppStore((s) => (s.annotationHasStartDot ?? true));
  const setAnnotationHasStartDot = useAppStore((s) => s.setAnnotationHasStartDot);
  const annotationHasEndArrow = useAppStore((s) => (s.annotationHasEndArrow ?? true));
  const setAnnotationHasEndArrow = useAppStore((s) => s.setAnnotationHasEndArrow);
  // فاز ۴: استیت‌های متن
  const annotationFontFamily = useAppStore((s) => s.annotationFontFamily || "'Estedad', sans-serif");
  const setAnnotationFontFamily = useAppStore((s) => s.setAnnotationFontFamily);
  const annotationFontSize = useAppStore((s) => s.annotationFontSize || 22);
  const setAnnotationFontSize = useAppStore((s) => s.setAnnotationFontSize);
  const selectedAnnotationTool = useAppStore((s) => s.selectedAnnotationTool);

  // پولیش — اصلاحِ بحرانیِ قانونِ هوک‌ها: این دو selector باید اینجا،
  // قبل از returnِ زودهنگامِ پایین باشند. قبلاً بعد از آن return بودند
  // و با فعال شدنِ استودیو، تعدادِ هوک‌های رندر عوض می‌شد و ری‌اکت با
  // خطای «Rendered more hooks than during the previous render» کرش
  // می‌کرد (دقیقاً خطِ ۳۹۷). هیچ هوکی نباید بعد از آن return بیاید.
  const toolbarOrientation = useAppStore((s) => s.toolbarOrientation || 'horizontal');
  const setToolbarOrientation = useAppStore((s) => s.setToolbarOrientation);

  // شناور (پولیشِ انقلابی) — موقعیتِ آزادِ تولبار: null یعنی داکِ
  // پیش‌فرض (افقی: بالا وسط؛ عمودی: راست وسط)؛ بعد از اولین درگ،
  // مختصاتِ style (نسبت به والدِ position‌دار) ذخیره می‌شود و با
  // localStorage (کلیدِ annotationToolbarPosition) بینِ رفرش‌ها
  // می‌ماند. لود، محافظت‌شده است و مختصات را در بازهٔ امنِ پنجره
  // نگه می‌دارد تا دستگیره همیشه در دسترس بماند.
  const [toolbarPos, setToolbarPos] = useState(() => {
    try {
      const raw = window.localStorage.getItem('annotationToolbarPosition');
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      return {
        x: Math.max(10, Math.min(p.x, Math.max(10, vw - 160))),
        y: Math.max(10, Math.min(p.y, Math.max(10, vh - 80))),
      };
    } catch (_) {
      return null;
    }
  });
  const [isToolbarDragging, setIsToolbarDragging] = useState(false);
  const [toggleSpinning, setToggleSpinning] = useState(false);
  const toolbarWrapRef = useRef(null);
  const toolbarDragRef = useRef(null);
  const toolbarPosRef = useRef(null);

  // Stage 8 Part A (Axis 4): user-defined tool order, persisted in
  // localStorage. Unknown ids are dropped, missing tools are appended
  // in default order, so a stale saved order can never lose a tool.
  const [toolOrder, setToolOrder] = useState(() => {
    try {
      const raw = window.localStorage.getItem('comicReader.studioToolOrder.v1');
      if (!raw) return TOOLS.map((t) => t.id);
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved)) return TOOLS.map((t) => t.id);
      const known = TOOLS.map((t) => t.id);
      const ordered = saved.filter((id) => known.includes(id));
      for (const id of known) if (!ordered.includes(id)) ordered.push(id);
      return ordered;
    } catch (_) {
      return TOOLS.map((t) => t.id);
    }
  });
  useEffect(() => {
    try { window.localStorage.setItem('comicReader.studioToolOrder.v1', JSON.stringify(toolOrder)); } catch (_) {}
  }, [toolOrder]);
  // Stage 8 Part A (Axis 4): live drag session state. toolDrag holds
  // the dragged id, ghost position and live insertion index; the
  // session ref holds the pointer session (start point, moved flag,
  // latest insertion index) for the window listeners.
  const [toolDrag, setToolDrag] = useState(null);
  const toolDragSessionRef = useRef(null);
  const suppressToolClickUntilRef = useRef(0);

  // فاز ۳ پالت — همهٔ هوک‌های دراور، این‌جا و قبل از returnِ
  // زودهنگام‌اند (قانونِ هوک‌های ری‌اکت): وضعیتِ باز بودن، موقعیتِ
  // ثابتِ دراور (با اندازه‌گیریِ دکمه در لحظهٔ باز شدن)، پالتِ شخصی،
  // و refهای دکمه/پنل/ورودیِ رنگ برای بستن با کلیکِ بیرونی.
  const [colorDrawerOpen, setColorDrawerOpen] = useState(false);
  // مرحلهٔ ۵۸ مأموریتِ ۳: پاپ‌اورِ شناورِ زیرحالتِ انتخاب (مرحلهٔ ۴۸
  // §۵) کاملاً حذف شد — کلیک روی select فقط ابزارِ انتخاب را فعال
  // می‌کند و هر پاپ‌اورِ بازی را می‌بندد؛ دو گزینهٔ باکسی/کمند با
  // همان آیکون‌های SVG، به بخشِ ۱ (کنترلِ یکپارچهٔ حالتِ ابزار) در
  // پانلِ بنتوی secondaryContent رفتند (به selectSubModeOptions
  // مراجعه کنید). stateها، refها و افکت‌هایِ آن پاپ‌اور هم با آن
  // حذف شدند تا هیچ state یا هندلرِ مرده‌ای نماند.
  // مرحلهٔ ۳۹ §۳: تمپلیتِ فعال در نوارِ سریع + ساختِ تمپلیتِ تازه +
  // پیش‌نویسِ کدِ هگزِ انتخابگرِ پیشرفته.
  // مرحلهٔ ۵۷ مأموریتِ ۲: حالتِ ویرایشِ نوارِ سریع (× روی هر رنگ)
  // و ویرایشِ درون‌خطیِ یک تمپلیت در دراور. پالتِ فعال دیگر stateی
  // محلی نیست؛ در استور است (activePaletteId) تا بینِ رفرش‌ها بماند.
  const [isEditingStrip, setIsEditingStrip] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState(null);
  const [editingTemplateName, setEditingTemplateName] = useState('');
  const [editingTemplateColors, setEditingTemplateColors] = useState([]);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  // مرحلهٔ ۵۶ مأموریتِ ۱: پیامِ خطایِ درون‌خطیِ فرمِ تمپلیت —
  // حتی اگر showToast در استورِ نصب‌شده نباشد، شکست دیده می‌شود.
  const [templateFormError, setTemplateFormError] = useState('');
  const [hexDraft, setHexDraft] = useState('');
  // فازِ عبورِ ژست از زیرِ تولبار + بستنِ خودکارِ دراور:
  // لایه، شروعِ هر ژستِ واقعیِ درگ (قلم، هایلایتر، باکس، فلش،
  // پاک‌کن، مارکی، جابه‌جاییِ دستی، درگِ هندل، درگِ Konva) را با
  // رویدادِ window ‏«annotation-gesture-start» اعلام می‌کند و پایانش
  // را با «annotation-gesture-end». با شروعِ ژست، دراورِ پالت بسته
  // می‌شود (تا هم کامپوزیتِ سبک شود و هم زیرِ قلم نماند) و پوسته‌های
  // مرئی، موقتاً pointer-events: none می‌گیرند تا خط، بی‌وقفه از زیرِ
  // تولبار ادامه پیدا کند. شنونده‌های pointerup/pointercancel/blur،
  // نگهبانِ گیر نکردنِ حالتِ عبورند (اگر پایانِ ژست از لایه نرسید).
  const [isGesturePassThrough, setIsGesturePassThrough] = useState(false);
  useEffect(() => {
    const onGestureStart = () => { setColorDrawerOpen(false); setIsGesturePassThrough(true); };
    const onGestureEnd = () => setIsGesturePassThrough(false);
    window.addEventListener('annotation-gesture-start', onGestureStart);
    window.addEventListener('annotation-gesture-end', onGestureEnd);
    window.addEventListener('pointerup', onGestureEnd);
    window.addEventListener('pointercancel', onGestureEnd);
    window.addEventListener('blur', onGestureEnd);
    return () => {
      window.removeEventListener('annotation-gesture-start', onGestureStart);
      window.removeEventListener('annotation-gesture-end', onGestureEnd);
      window.removeEventListener('pointerup', onGestureEnd);
      window.removeEventListener('pointercancel', onGestureEnd);
      window.removeEventListener('blur', onGestureEnd);
    };
  }, []);
  // قانونِ ایزولاسیونِ Hitbox: پوسته‌های مرئی، در حالتِ عادی auto و
  // حینِ ژستِ فعالِ ترسیم none هستند؛ کانتینرهای بیرونی، همیشه none.
  const shellPointerEvents = isGesturePassThrough ? 'none' : 'auto';
  const [colorDrawerPos, setColorDrawerPos] = useState(null);
  const paletteBtnRef = useRef(null);
  const colorDrawerRef = useRef(null);
  const colorInputRef = useRef(null);
  // مرحلهٔ ۵۸ مأموریتِ ۴: کلمپِ دوبارهٔ موقعیتِ دراورِ رنگ در
  // بازهٔ امنِ نما — با ارتفاعِ واقعیِ اندازه‌گیری‌شدهٔ پنل (نه
  // تخمینِ لحظهٔ باز شدن). با گاردِ برابری: اگر چیزی عوض نشده،
  // همان stateی قبلی برگردانده می‌شود تا حلقهٔ ResizeObserver
  // (که خودش با تغییرِ top دوباره صدا می‌زند) بی‌نهایت نشود.
  // top/left در colorDrawerPos همیشه عدد‌اند (به toggleColorDrawer
  // مراجعه کنید)، پس این‌جا رشته‌ایِ «50%» نداریم.
  const reclampColorDrawer = useCallback(() => {
    setColorDrawerPos((prev) => {
      if (!prev) return prev;
      const panel = colorDrawerRef.current;
      const panelHeight = panel && panel.offsetHeight
        ? panel.offsetHeight
        : Math.min(440, (typeof window !== 'undefined' ? window.innerHeight : 768) - SAFE_TOP - 24);
      const next = computeSafePopoverPosition(prev.top, panelHeight, prev.left, 272);
      if (next.top === prev.top && next.left === prev.left) return prev;
      return { ...prev, top: next.top, left: next.left };
    });
  }, []);
  // مرحلهٔ ۳۹ §۳: مهاجرتِ یک‌بارهٔ پالتِ ۴ رنگیِ قدیمی (کلیدِ
  // annotationUserPalette) به سیستمِ رنگِ v2 استور (حداکثر ۴۸ رنگ +
  // پشتیبانِ دیتابیس)؛ بعد از مهاجرت، کلیدِ قدیمی پاک می‌شود.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('annotationUserPalette');
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.filter((c) => typeof c === 'string').forEach((c) => {
          try { useAppStore.getState().addFavoriteColor?.(c); } catch (_) {}
        });
      }
      window.localStorage.removeItem('annotationUserPalette');
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // مرحلهٔ ۳۹ §۳: همگام‌سازیِ پیش‌نویسِ هگز با رنگِ فعال.
  useEffect(() => {
    setHexDraft(annotationColor || '#06b6d4');
  }, [annotationColor]);
  // مرحلهٔ ۵۷ مأموریتِ ۲: رنگ‌هایِ نوارِ سریع، همان
  // primaryToolbarColorsی استور است؛ اگر خالی بود (کاربر همه را حذف
  // کرده)، ۸ رنگِ کلاسیک نشان داده می‌شود (فقط نمایشی؛ در استور
  // چیزی نوشته نمی‌شود).
  const activePaletteLabel = (() => {
    if (activePaletteId === 'default') return 'کلاسیک و استاندارد';
    if (activePaletteId === 'favorites') return 'رنگ‌های من';
    if (typeof activePaletteId === 'string' && activePaletteId.startsWith('template:')) {
      const found = customColorTemplates.find((x) => x.id === activePaletteId.slice(9));
      return found ? found.name : 'کلاسیک و استاندارد';
    }
    const cat = PALETTE_CATEGORIES.find((c) => c.id === activePaletteId);
    return cat ? cat.label : 'کلاسیک و استاندارد';
  })();
  const stripHexes = primaryToolbarColors.length > 0
    ? primaryToolbarColors
    : COLORS.map((c) => c.hex);
  const quickColors = stripHexes.map((hex) => ({ hex, label: hex }));
  // فاز ۳ پالت — بستنِ خودکار با کلیکِ بیرونی (تسک §۴): هر mousedownی
  // که نه روی دکمهٔ پالت باشد و نه روی پنلِ دراور، دراور را می‌بندد.
  // دکمه، خودش toggle می‌کند، پس از این بررسی مستثناست؛ و چون این
  // شنونده روی mousedownی نیتیو است، stopPropagationی pointerdownی
  // تولبار روی آن اثری ندارد — کلیک روی دکمه‌های دیگرِ تولبار هم
  // دراور را می‌بندد (همان رفتارِ خواسته‌شده: بیرونِ دراور).
  useEffect(() => {
    if (!colorDrawerOpen) return undefined;
    const onDown = (e) => {
      const target = e && e.target;
      if (!target) return;
      if (paletteBtnRef.current && paletteBtnRef.current.contains(target)) return;
      if (colorDrawerRef.current && colorDrawerRef.current.contains(target)) return;
      setColorDrawerOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [colorDrawerOpen]);
  // فاز ۳ پالت — دراور با position: fixed رندر می‌شود (تا overflowی
  // نوارِ افقی، آن را نبرد)؛ پس هر اسکرولِ بیرونی، مختصاتش را کهنه
  // می‌کند و دراور بسته می‌شود (ارزان و قابلِ پیش‌بینی). اما تغییرِ
  // اندازهٔ پنجره، دیگر آن را نمی‌بندد — مرحلهٔ ۵۸ مأموریتِ ۴: با
  // موتورِ مرزِ امن (reclampColorDrawer) دوباره داخلِ بازهٔ امن
  // کلمپ می‌شود تا همیشه دیده شود و هرگز زیرِ TopBar یا بیرونِ
  // لبهٔ پایین نرود.
  useEffect(() => {
    if (!colorDrawerOpen) return undefined;
    // مرحلهٔ ۵۷ مأموریتِ ۲: اسکرولِ داخلِ خودِ دراور، آن را نمی‌بندد.
    // مسیرِ واقعیِ دزدیِ اسکرول همین‌جا بود: رویدادِ scroll با فازِ
    // capture از window می‌گذرد (حتی رویدادِ اسکرولِ خودِ پنلِ
    // دراور)، پس اولین چرخِ ماوس رویِ دراور، بی‌درنگ آن را می‌بست.
    // شنوندهٔ wheelی بومیِ PdfViewer (فقط با Ctrl، برایِ زوم) و
    // کانتینرِ اسکرولِ آن، در این مسیر نقشی ندارند: تولبار، خواهرِ
    // کانتینرِ اسکرول است، نه فرزندِ آن، پس چرخِ رویِ دراور هرگز به
    // آن شنونده نمی‌رسد؛ دزدی، همین بستنِ خودکار بود.
    const close = (e) => {
      if (e && e.target && typeof Node !== 'undefined' && e.target instanceof Node
        && colorDrawerRef.current && colorDrawerRef.current.contains(e.target)) return;
      setColorDrawerOpen(false);
    };
    const reclampOnResize = () => { reclampColorDrawer(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', reclampOnResize);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', reclampOnResize);
    };
  }, [colorDrawerOpen, reclampColorDrawer]);
  // مرحلهٔ ۵۱ §۴ + مرحلهٔ ۵۸ مأموریتِ ۳: اگر ابزار با هر مسیری
  // (کلیک، کلیدِ میانبر، یا فراخوانندهٔ دیگرِ setAnnotationTool)
  // به دست، انتخاب یا پاک‌کن عوض شد، دراورِ رنگ بسته می‌شود؛
  // دست و پاک‌کن هرگز دراور ندارند و کلیک روی select هم (طبقِ
  // مأموریتِ ۳) فقط ابزار را فعال می‌کند و هر پاپ‌اورِ بازی را
  // می‌بندد. setState با همان مقدارِ فعلی، ری‌رندر نمی‌سازد، پس
  // گاردِ برابری لازم نیست.
  useEffect(() => {
    if (annotationTool === 'hand' || annotationTool === 'select' || annotationTool === 'eraser') setColorDrawerOpen(false);
  }, [annotationTool]);

  // معماریِ قطعی — هوک‌های جدید، همه این‌جا و قبل از returnِ
  // زودهنگام: هاورِ Done و هگزِ کاربر (§۵)، عرضِ پنجره برای
  // آینه‌ای (§۱)، و سلکتورهای Done (§۵). استور، هر دو setter را
  // از قبل دارد (setIsAnnotationActive و clearSelection)، پس هیچ
  // تغییری در useAppStore لازم نیست.
  // میکروانیمیشن‌ها — حالت‌های جدید، همه این‌جا و قبل از returnِ
  // زودهنگام: بستنِ پنل با دوبار کلیک، هاورِ ابزار و رنگ، کپسولِ
  // راهنما و حالتِ تنفس. collapsedToolMenuی مرحلهٔ قبل، کاملاً با
  // panelClosed جایگزین شد (تک‌کلیک دیگر پنل را نمی‌بندد).
  const [panelClosed, setPanelClosed] = useState(false);
  const [hoverToolId, setHoverToolId] = useState(null);
  const [hoverSwatch, setHoverSwatch] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [toolbarIdle, setToolbarIdle] = useState(false);
  const selectedAnnotationId = useAppStore((s) => s.selectedAnnotationId);
  const selectedAnnotationIds = useAppStore((s) => s.selectedAnnotationIds);
  const toolClickRef = useRef(null);
  const tooltipTimerRef = useRef(null);
  const tooltipAnchorRef = useRef(null);
  const idleTimerRef = useRef(null);
  const toolGlowRef = useRef(null);
  const toolsWrapRef = useRef(null);
  // ابزارِ انتخاب‌شدهٔ واقعی: هر سه نشانه، چون لایه در مسیرهای
  // مختلف، idی تکی، فهرستِ چندتایی یا نوعِ آیتم را می‌نویسد.
  const hasSelection = selectedAnnotationId != null
    || (Array.isArray(selectedAnnotationIds) && selectedAnnotationIds.length > 0)
    || selectedAnnotationTool != null;
  // فاز ۴: فقط وقتی یک آیتم (تکی یا چندتایی) واقعاً انتخاب شده باشد،
  // دکمه‌های ترتیب لایه نشان داده می‌شوند — انتخابِ صرفِ ابزار
  // (selectedAnnotationTool) برای این کار کافی نیست.
  const hasSelectedItem = selectedAnnotationId != null
    || (Array.isArray(selectedAnnotationIds) && selectedAnnotationIds.length > 0);
  // بستنِ پنل با دوبار کلیک، فقط وقتی ابزار عوض شود یا انتخابی
  // تازه ظاهر شود، ریست می‌شود (تغییرِ ابزار از راهِ کیبورد را هم
  // پوشش می‌دهد، چون کلیک‌هنلدر فقط کلیک‌ها را می‌بیند).
  useEffect(() => { setPanelClosed(false); }, [annotationTool]);
  useEffect(() => { if (hasSelection) setPanelClosed(false); }, [hasSelection]);
  // بسته شدنِ دراورِ رنگ وقتی پنلِ فرعی پنهان می‌شود (دکمهٔ پالت
  // خودش داخلِ همان پنل است، پس دراورِ باز، بی‌صاحب می‌ماند).
  // فرمول، همان showSecondary است که پایین‌تر تعریف می‌شود.
  useEffect(() => {
    if (!(annotationTool !== 'hand' && !panelClosed)) setColorDrawerOpen(false);
  }, [annotationTool, panelClosed]);
  // تنفس: درگ یا دراورِ باز، کم‌نور شدن را لغو می‌کند؛ و پاک‌سازیِ
  // تایمرها هنگامِ unmount.
  useEffect(() => {
    if (colorDrawerOpen || isToolbarDragging) {
      if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
      setToolbarIdle(false);
    }
  }, [colorDrawerOpen, isToolbarDragging]);
  useEffect(() => () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
  }, []);

  // رفعِ TDZ (خطای ۱۲۹۱): این توابعِ کمکی، عمداً این‌جا، قبل از
  // returnِ زودهنگام و قبل از همهٔ بلوک‌های JSX، تعریف شده‌اند.
  // علت: actionsContent، hideTooltip را به‌صورتِ bare (بدونِ
  // تابعِ واسط) در onMouseLeave می‌گذارد و مقدارِ prop، همان
  // لحظهٔ ساختِ JSX خوانده می‌شود؛ پس اگر تعریف، پایین‌تر از
  // actionsContent باشد، رندر با ReferenceError می‌میرد. ارجاع
  // داخلِ بدنهٔ هندلرها (closure) دیرتر اجرا می‌شود و به‌تنهایی
  // خطا نمی‌دهد، ولی ارجاعِ bare حتماً باید بعد از تعریف باشد.
  // این بلوک را هرگز پایین‌تر از actionsContent نبرید.
  // میکروانیمیشن‌ها §۴ — اسپات‌لایت: موقعیتِ ماوس را بدونِ
  // بازرندر، در متغیرهای سی‌اس‌اسِ همان پنل می‌نویسد؛ گرادیانِ
  // پس‌زمینه از همین متغیرها می‌خواند.
  const handleSpotMove = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${e.clientX - r.left}px`);
    el.style.setProperty('--spot-y', `${e.clientY - r.top}px`);
  };
  const handleSpotLeave = (e) => {
    e.currentTarget.style.setProperty('--spot-x', '50%');
    e.currentTarget.style.setProperty('--spot-y', '50%');
  };
  // تنفس (§۴٫۳): ورود، تایمر را پاک و شفافیت را کامل می‌کند؛
  // خروج، پس از ۳ ثانیه کم‌نور می‌کند.
  const handleToolbarEnter = () => {
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    setToolbarIdle(false);
  };
  const handleToolbarLeave = () => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setToolbarIdle(true), 3000);
  };
  // کپسولِ راهنما (§۴٫۴): پس از نیم ثانیه مکث، از روی کادرِ
  // دکمهٔ ذخیره‌شده، جای کپسول را حساب می‌کند (بالای دکمه، یا
  // اگر نزدیکِ بالای صفحه بود، پایینِ آن) و در لبه‌ها clamp می‌کند.
  const showTooltipDelayed = (e, text) => {
    if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    tooltipAnchorRef.current = e.currentTarget;
    tooltipTimerRef.current = window.setTimeout(() => {
      const el = tooltipAnchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const left = Math.max(90, Math.min(r.left + r.width / 2, window.innerWidth - 90));
      const above = r.top >= 60;
      setTooltip({ text, left, top: above ? r.top - 12 : r.bottom + 12, above });
    }, 500);
  };
  const hideTooltip = () => {
    if (tooltipTimerRef.current) { clearTimeout(tooltipTimerRef.current); tooltipTimerRef.current = null; }
    tooltipAnchorRef.current = null;
    setTooltip(null);
  };
  // هالهٔ لغزندهٔ زیرِ ابزارها (§۱٫۱): جای هاله را مستقیم روی
  // DOM می‌نویسد تا با هر هاور، بازرندر و مختصاتِ کهنه پیش نیاید.
  // مختصات، نسبت به کانتینرِ ابزارها (dock یا نوارِ افقی) است که
  // هاله، فرزندِ همان‌هاست.
  const positionToolGlow = (btnEl) => {
    const glow = toolGlowRef.current;
    const wrap = toolsWrapRef.current;
    if (!glow || !wrap || !btnEl) return;
    const b = btnEl.getBoundingClientRect();
    const c = wrap.getBoundingClientRect();
    glow.style.left = `${b.left - c.left}px`;
    glow.style.top = `${b.top - c.top}px`;
    glow.style.width = `${b.width}px`;
    glow.style.height = `${b.height}px`;
    glow.style.opacity = '1';
  };
  const hideToolGlow = () => {
    const glow = toolGlowRef.current;
    if (glow) glow.style.opacity = '0';
  };
  // هاله، یک المانِ واحد است که فقط در شاخهٔ فعال (عمودی یا افقی)
  // رندر می‌شود؛ چون فقط یک شاخه mount است، ref همیشه همانِ فعال
  // را می‌گیرد. روی دکمه‌ها، یک شستشوی نوریِ نیمه‌شفاف است (نه
  // زیرِ آن‌ها، چون دکمه‌ها position ندارند)؛ با pointerEvents
  // none، هیچ کلیکی را نمی‌گیرد.
  const toolGlow = (
    <div
      ref={toolGlowRef}
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 38,
        height: 38,
        borderRadius: 11,
        background: 'rgba(34, 211, 238, 0.14)',
        boxShadow: '0 0 16px rgba(34, 211, 238, 0.18)',
        pointerEvents: 'none',
        opacity: 0,
        transition: 'left 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), top 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease',
      }}
    />
  );
  const [doneHover, setDoneHover] = useState(false);
  // مرحله ۵ ـ بخش الف: هاورِ دکمهٔ خروجیِ PDF (قبل از returnِ زودهنگام،
  // طبقِ قانونِ هوک‌ها — مثلِ doneHover).
  const [exportHover, setExportHover] = useState(false);
  // مرحله ۵ — بخش ب: هاورِ دو دکمهٔ ذخیرهٔ دوگانه (قبل از returnِ زودهنگام، طبقِ قانونِ هوک‌ها — مثلِ doneHover/exportHover).
  const [saveInPlaceHover, setSaveInPlaceHover] = useState(false);
  const [saveAsHover, setSaveAsHover] = useState(false);
  // مرحله ۷ ـ نهایی: درخششِ سبزِ ۳ ثانیه‌ایِ دکمهٔ ذخیره پس از موفقیت (بنر، ۴٫۵ ثانیه است).
  const [saveFlash, setSaveFlash] = useState(false);
  const saveFlashTimerRef = useRef(null);
  useEffect(() => {
    if (pdfSaveState === 'saved-inplace' || pdfSaveState === 'saved-as') {
      setSaveFlash(true);
      if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current);
      saveFlashTimerRef.current = setTimeout(() => setSaveFlash(false), 3000);
    } else {
      setSaveFlash(false);
    }
    return () => {
      if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current);
    };
  }, [pdfSaveState]);
  const [hoverUserHex, setHoverUserHex] = useState(null);
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  // Stage 8 Part A: viewport height drives the horizontal flyout/drawer
  // smart flip (open below in the top half, above in the bottom half).
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  const setIsAnnotationActive = useAppStore((s) => s.setIsAnnotationActive);
  const clearSelection = useAppStore((s) => s.clearSelection);
  useEffect(() => {
    const onResize = () => {
      setViewportW(window.innerWidth);
      setViewportH(window.innerHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // Stage 8 Part A (Axis 5): mount/exit lifecycle for the flyout card
  // and the palette drawer, so closing animates instead of vanishing.
  // The formulas mirror showSecondary/colorDrawerOpen below (same
  // inputs, computed here because hooks must stay above the early
  // return); the canonical consts after the return stay untouched.
  const showSecondaryForAnim = annotationTool !== 'hand' && !panelClosed;
  const [flyoutMounted, setFlyoutMounted] = useState(false);
  const [flyoutExiting, setFlyoutExiting] = useState(false);
  useEffect(() => {
    if (showSecondaryForAnim) {
      setFlyoutMounted(true);
      setFlyoutExiting(false);
      return;
    }
    if (!flyoutMounted) return;
    setFlyoutExiting(true);
    const t = setTimeout(() => {
      setFlyoutMounted(false);
      setFlyoutExiting(false);
    }, 200);
    return () => clearTimeout(t);
  }, [showSecondaryForAnim, flyoutMounted]);
  const [drawerMounted, setDrawerMounted] = useState(false);
  const [drawerExiting, setDrawerExiting] = useState(false);
  useEffect(() => {
    if (colorDrawerOpen) {
      setDrawerMounted(true);
      setDrawerExiting(false);
      return;
    }
    if (!drawerMounted) return;
    setDrawerExiting(true);
    const t = setTimeout(() => {
      setDrawerMounted(false);
      setDrawerExiting(false);
    }, 200);
    return () => clearTimeout(t);
  }, [colorDrawerOpen, drawerMounted]);

  // مرحلهٔ ۵۸ مأموریتِ ۴: کلمپِ دوبارهٔ دراور وقتی ارتفاعِ پنل
  // (با باز شدنِ سازندهٔ تمپلیت یا هر تغییرِ محتوایِ دیگر) یا
  // اندازهٔ پنجره عوض می‌شود — ResizeObserver، تغییرِ اندازهٔ
  // خودِ پنل را می‌بیند و reclampColorDrawer با ارتفاعِ واقعیِ
  // اندازه‌گیری‌شده، پنل را در بازهٔ امن نگه می‌دارد. گاردِ
  // برابریِ داخلِ reclampColorDrawer جلوی حلقه را می‌گیرد.
  useEffect(() => {
    if (!colorDrawerOpen || !drawerMounted) return undefined;
    const panel = colorDrawerRef.current;
    if (!panel || typeof ResizeObserver === 'undefined') return undefined;
    reclampColorDrawer();
    const observer = new ResizeObserver(() => { reclampColorDrawer(); });
    observer.observe(panel);
    return () => observer.disconnect();
  }, [colorDrawerOpen, drawerMounted, reclampColorDrawer]);
  // مرحلهٔ ۵۸ مأموریتِ ۴: باز/بسته شدنِ سازندهٔ تمپلیت یا ویرایشِ
  // درون‌خطیِ تمپلیت، ارتفاعِ دراور را عوض می‌کند — اگر پنل از
  // بازهٔ امن بیرون رفت، همین‌جا دوباره کلمپ می‌شود (ResizeObserver
  // هم همین را پوشش می‌دهد؛ این افکت، مسیرِ صریحِ همان رویداد است).
  useEffect(() => {
    if (!colorDrawerOpen) return;
    reclampColorDrawer();
  }, [colorDrawerOpen, isCreatingTemplate, editingTemplateId, reclampColorDrawer]);

  // تایید دو مرحله‌ای برای پاک کردن همه (بدون window.confirm زشت)
  const [armClear, setArmClear] = useState(false);
  useEffect(() => {
    if (!armClear) return;
    const t = setTimeout(() => setArmClear(false), 3000);
    return () => clearTimeout(t);
  }, [armClear]);

  // --- فاز ۱: Undo با اولویت prop والد ---
  const doUndo = useCallback(() => {
    if (typeof onUndo === 'function') {
      onUndo();
    } else {
      // fallback: رویداد window (اگر والد onUndo نداده باشد)
      window.dispatchEvent(new CustomEvent('annotation:undo'));
    }
  }, [onUndo]);

  // --- فاز ۱: Redo با اولویت prop والد ---
  const doRedo = useCallback(() => {
    if (typeof onRedo === 'function') {
      onRedo();
    } else {
      // fallback: رویداد window
      window.dispatchEvent(new CustomEvent('annotation:redo'));
    }
  }, [onRedo]);

  // --- فاز ۱: پاک‌سازی با اولویت prop والد ---
  const doClear = useCallback(() => {
    if (!armClear) {
      setArmClear(true);
      return;
    }
    setArmClear(false);
    if (typeof onClearPage === 'function') {
      onClearPage();
    } else {
      // fallback: رویداد window
      window.dispatchEvent(new CustomEvent('annotation:clear'));
    }
  }, [armClear, onClearPage]);

  // فاز ۲-مرحله ۳ (سناریو ۵): پخش تغییر استایل باکس برای آیتم انتخاب‌شده.
  // قرارداد قدیمی: فقط وقتی selectedAnnotationId در استور هست، رویداد
  // annotation:update-selected با patch تخت شلیک می‌شود؛ در غیر این صورت
  // هیچ رویدادی نیست تا رسم عادی (بدون انتخاب) بی‌دلیل کامیت نشود.
  // لایه این رویداد را می‌گیرد و با commit() استاندارد ذخیره می‌کند.
  const broadcastSelectedBoxPatch = useCallback((patch) => {
    const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
    if (!state.selectedAnnotationId) return;
    window.dispatchEvent(new CustomEvent('annotation:update-selected', { detail: patch }));
  }, []);

  // فاز ۳: پخش تغییر استایل فلش برای آیتم انتخاب‌شده — همان قرارداد باکس:
  // فقط وقتی selectedAnnotationId در استور هست، رویداد شلیک می‌شود.
  const broadcastSelectedArrowPatch = useCallback((patch) => {
    const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
    if (!state.selectedAnnotationId) return;
    window.dispatchEvent(new CustomEvent('annotation:update-selected', { detail: patch }));
  }, []);

  // فاز ۴: پخش تغییر فونت/اندازه برای آیتمِ متنیِ انتخاب‌شده — همان قرارداد:
  // فقط وقتی selectedAnnotationId در استور هست، رویداد شلیک می‌شود.
  const broadcastSelectedTextPatch = useCallback((patch) => {
    const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
    if (!state.selectedAnnotationId) return;
    window.dispatchEvent(new CustomEvent('annotation:update-selected', { detail: patch }));
  }, []);

  // گام ۲ میانی: پخش تغییر فونت/اندازه برای استیکیِ انتخاب‌شده — دقیقاً
  // همان قراردادِ helperی متن (فقط وقتی انتخابی هست) تا تغییرِ فونت از
  // تولبار، روی استیکی‌های انتخاب‌شده هم اعمال شود.
  const broadcastSelectedStickyPatch = useCallback((patch) => {
    const state = typeof useAppStore.getState === 'function' ? useAppStore.getState() : {};
    if (!state.selectedAnnotationId) return;
    window.dispatchEvent(new CustomEvent('annotation:update-selected', { detail: patch }));
  }, []);

  // فاز ۵: تابعِ عمومیِ بایندینگِ دوطرفه — دقیقاً طبقِ TASK.
  // برخلافِ helperهای تخصصیِ باکس/فلش/متن که detail را بدونِ id
  // می‌فرستند، این تابع id را هم در detail می‌گذارد؛ شنوندهٔ لایه
  // هر دو شکل را می‌پذیرد (detail.id || selectedAnnotationId)، پس
  // هر دو قرارداد با هم سازگارند. helperهای تخصصی دست نخورده
  // باقی مانده‌اند، چون در فازهای قبل تست شده‌اند و کار می‌کنند.
  const broadcastSelectedPropertyPatch = useCallback((patch) => {
    const sid = typeof useAppStore.getState === 'function'
      ? useAppStore.getState().selectedAnnotationId
      : null;
    if (!sid) return;
    window.dispatchEvent(new CustomEvent('annotation:update-selected', {
      detail: { id: sid, ...patch },
    }));
  }, []);

  // فاز ۴: ترتیب لایه — رویداد سراسری بدون چرخهٔ ایمپورت (الگوی
  // broadcastSelectedPropertyPatch). لایه، خودش صفحهٔ انتخاب را از
  // استور می‌خواند و فقط همان یک لایه عمل می‌کند.
  const dispatchLayerOrder = useCallback((direction) => {
    hideTooltip();
    window.dispatchEvent(new CustomEvent('annotation-layer-order', {
      detail: { direction },
    }));
  }, []);

  // گام ۲ میانی: انتخابِ helperی پخشِ تایپو بر اساسِ بافت — اگر ابزارِ
  // فعال یا آیتمِ انتخاب‌شده استیکی باشد، helperی استیکی؛ وگرنه helperی
  // متن. هر دو همان قرارداد را دارند و شنوندهٔ لایه، فونت را برای هر دو
  // ابزار می‌پذیرد، پس در انتخابِ مخلوطِ متن+استیکی هم هر دو عوض می‌شوند.
  const broadcastTypoPatch = useCallback((patch) => {
    if (annotationTool === 'sticky' || selectedAnnotationTool === 'sticky') {
      broadcastSelectedStickyPatch(patch);
    } else {
      broadcastSelectedTextPatch(patch);
    }
  }, [annotationTool, selectedAnnotationTool, broadcastSelectedStickyPatch, broadcastSelectedTextPatch]);

  // میانبرها — Refinement Step 2: مدیریتِ هوشمند در فازِ Capture.
  // - شنونده در فازِ Capture سوار می‌شود تا قبل از شنوندهٔ bubbleی
  //   PdfViewer اجرا شود؛ برای Ctrl+Z/Y، stopImmediatePropagation
  //   می‌کند تا Undo/Redoی والد دوباره اعمال نشود (رفعِ باگِ Undoی
  //   مضاعفِ گزارشِ ممیزی، §۱٫۳: قبلاً هم تولبار و هم PdfViewer،
  //   هر دو handleUndoAnnotation را صدا می‌زدند).
  // - فقط کلیدهایی که با میانبرِ فعلیِ تنظیمات جورند
  //   (resolveStudioToolForEvent / matchesShortcut) مهار می‌شوند؛
  //   بقیهٔ کلیدها کاملاً آزاد می‌مانند (بدونِ
  //   preventDefault و بدونِ stopPropagation) تا به ناوبری یا جستجو
  //   برسند.
  // - تشخیصِ توالیِ تایپ (Typing Sequence Detection): با
  //   lastCharTimeRef، زمانِ آخرین کلیدِ کاراکتری ثبت می‌شود؛ اگر
  //   کلیدِ جدید کمتر از ۱۰۰۰ میلی‌ثانیه بعد از کلیدِ کاراکتریِ
  //   قبلی فشرده شود، به‌عنوانِ تایپِ کلمه/جستجو تفسیر می‌شود و
  //   تعویضِ ابزار لغو می‌گردد (بدونِ مهارِ رویداد، تا کلید به
  //   فیلدِ متنی یا جستجو برسد).
  //    بده‌بستانِ مشخصات: همین قانون، تعویضِ سریعِ پشتِ سرِ همِ
  //   دو ابزار (مثلاً V و بلافاصله B در کمتر از ۱ ثانیه) را هم لغو
  //   می‌کند؛ تعویض با کلیک روی تولبار، از این قانون متأثر نمی‌شود.
  //   همچنین توجه: در سیم‌کشیِ فعلیِ برنامه، شنوندهٔ captureی
  //   useKeyboard (که در App سوار می‌شود) معمولاً زودتر از این
  //   شنونده ثبت شده است و برای کلیدهای ابزار، خودش ابزار را عوض
  //   و رویداد را متوقف می‌کند؛ پس این شنونده برای کلیدهای ابزار،
  //   نقشِ پشتیبان دارد و برای Ctrl+Z/Y، نقشِ اصلیِ رفعِ تداخل را
  //   بازی می‌کند (چون useKeyboard برای Ctrl+Z/Y در حالتِ استودیو
  //   زود برمی‌گردد، بدونِ توقف، و رویداد به اینجا می‌رسد).
  const lastCharTimeRef = useRef(0);
  useEffect(() => {
    if (!isAnnotationActive) return;
    const onKey = (e) => {
      const tag = e.target?.tagName;
      // مرحله ۷ ـ بخش ب: گیتِ فوکوس، با SELECT و contentEditable
      // هم کامل شد تا هیچ کادرِ متنی‌ای، زیرِ شورت‌کات‌های استودیو
      // نرود (ویرایشگرهای متن/استیکی، textarea هستند و از پیش
      // پوشش داده می‌شدند).
      if (
        tag === 'TEXTAREA' ||
        tag === 'INPUT' ||
        tag === 'SELECT' ||
        e.target?.isContentEditable
      )
        return;
      // Undo/Redo: فقط وقتی رویداد، با میانبرِ فعلیِ تنظیمات جور
      // است — و فقط یک بار، بدونِ رسیدن به PdfViewer. پیش از این،
      // هر Ctrl+Z/Y (حتی پس از تغییرِ میانبر در تنظیمات) این‌جا
      // Undo/Redo می‌کرد و کلیدِ قبلی، زنده می‌ماند.
      if (e.ctrlKey || e.metaKey) {
        let settingsState = null;
        try {
          settingsState = typeof useSettingsStore.getState === 'function'
            ? useSettingsStore.getState()
            : null;
        } catch (_) { /* ignore */ }
        const isRedo = Boolean(settingsState?.matchesShortcut?.('redoAnnotation', e));
        const isUndo = !isRedo && Boolean(settingsState?.matchesShortcut?.('undoAnnotation', e));
        if (isUndo || isRedo) {
          if (typeof onUndo !== 'function' && typeof onRedo !== 'function') return;
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          } else if (typeof e.stopPropagation === 'function') {
            e.stopPropagation();
          }
          if (isRedo) {
            doRedo(); // Ctrl+Y یا Ctrl+Shift+Z → Redo
          } else {
            doUndo(); // Ctrl+Z → Undo
          }
          return;
        }
        // بقیهٔ ترکیب‌های Ctrl: پشتیبانِ تعویضِ ابزارِ اصلاح‌شده
        // (مثلِ Alt/Ctrl+کلید) — useKeyboard، شنوندهٔ اصلی است و
        // معمولاً زودتر رویداد را مهار کرده است؛ این‌جا فقط اگر
        // رویداد هنوز زنده باشد، ابزار عوض می‌شود.
        const modifiedTool = resolveStudioToolForEvent(e);
        if (modifiedTool) {
          e.preventDefault();
          setAnnotationTool(modifiedTool);
        }
        return; // بقیهٔ ترکیب‌های Ctrl، به تولبار ربطی ندارند.
      }
      if (e.altKey || e.metaKey) return;
      const k = (e.key || '').toLowerCase();
      if (k.length !== 1) return; // فقط کلیدهای کاراکتری
      // تشخیصِ توالیِ تایپ: کلیدِ کاراکتریِ قبلی کمتر از ۱ ثانیه پیش.
      const now = (typeof performance !== 'undefined' && performance.now)
        ? performance.now()
        : Date.now();
      const prev = lastCharTimeRef.current || 0;
      lastCharTimeRef.current = now;
      if (prev && now - prev < 1000) {
        // تایپِ کلمه/جستجو فرض می‌شود: ابزار عوض نمی‌شود و رویداد
        // مهار نمی‌شود تا به مقصدِ خودش (فیلد/جستجو) برسد.
        return;
      }
      const tool = resolveStudioToolForEvent(e);
      if (tool) {
        e.preventDefault();
        setAnnotationTool(tool);
      }
      // اگر کلید، ابزار نیست: هیچ‌کار نکن — کاملاً آزاد می‌ماند.
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isAnnotationActive, setAnnotationTool, doUndo, doRedo, onUndo, onRedo]);

  // شناور — کلمپِ دقیقِ موقعیتِ ذخیره‌شده بعد از mount (فقط یک بار):
  // اگر پنجره کوچک‌تر شده باشد، تولبار را به داخلِ والد برمی‌گرداند
  // تا دستگیره هرگز بیرون از دسترس نماند.
  useEffect(() => {
    if (!toolbarPos) return;
    const el = toolbarWrapRef.current;
    if (!el) return;
    const parent = el.offsetParent;
    const pw = parent ? parent.clientWidth : window.innerWidth;
    const ph = parent ? parent.clientHeight : window.innerHeight;
    const maxX = Math.max(10, pw - el.offsetWidth - 10);
    const maxY = Math.max(10, ph - el.offsetHeight - 10);
    const nx = Math.max(10, Math.min(toolbarPos.x, maxX));
    const ny = Math.max(10, Math.min(toolbarPos.y, maxY));
    if (nx !== toolbarPos.x || ny !== toolbarPos.y) {
      const next = { x: nx, y: ny };
      toolbarPosRef.current = next;
      setToolbarPos(next);
      try { window.localStorage.setItem('annotationToolbarPosition', JSON.stringify(next)); } catch (_) {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // قانونِ هوک‌های ری‌اکت — تغییرناپذیر: همهٔ هوک‌ها (useAppStore،
  // useState، useEffect، useCallback، useRef) باید بالای این خط باشند
  // و هیچ هوکی بعد از این return نیاید؛ وگرنه با فعال/غیرفعال شدنِ
  // استودیو، ترتیب و تعدادِ هوک‌ها عوض می‌شود و کامپوننت کرش می‌کند.
  if (!isAnnotationActive) return null;

  const activeId = TOOLS.some((t) => t.id === annotationTool) ? annotationTool : 'pen';

  // گام ۲ میانی: حالتِ تمرکزِ تایپوگرافی + فهرستِ ابزارهای ترسیمی که در
  // این حالت مورف می‌شوند (text و sticky در مقیاسِ کامل می‌مانند).
  const isTypoMode = annotationTool === 'text' || annotationTool === 'sticky'
    || selectedAnnotationTool === 'text' || selectedAnnotationTool === 'sticky';

  // پولیشِ قطعی — مخفی‌سازیِ شرطیِ کنترل‌های ضخامت (دقیقاً فرمولِ تسک):
  // اگر ابزارِ فعال یا آیتمِ انتخاب‌شده text/sticky/box/image باشد،
  // بلوکِ «اندازه» (ضخامتِ نوکِ قلم) + جداکنندهٔ مجاورش از
  // secondaryContent حذف می‌شوند. چون secondaryContent در هر دو شاخهٔ
  // افقی و عمودی همان متغیر است، این شرط در هر دو حالت اعمال می‌شود.
  // توجه: کنترلِ ضخامت در این کد، ردیفِ دکمه‌های SIZES است، نه اسلایدر؛
  // تنها اسلایدرِ بجِ پیکسلی، اسلایدرِ اندازهٔ فونتِ کنسولِ تایپو است
  // که عمداً می‌ماند (مخصوصِ text/sticky است).
  const activeOrSelectedTool = selectedAnnotationTool || annotationTool;
  const hideStrokeControls = ['text', 'sticky', 'box', 'image'].includes(activeOrSelectedTool);
  // مرحلهٔ ۵۱ §۴: دست و پاک‌کن، رنگ/ضخامت/شفافیت ندارند — دست فقط
  // صفحه را جابه‌جا می‌کند و پاک‌کن با شعاعِ ثابتِ ۱۴ و خطِ قرمزِ
  // ثابت رندر می‌شود و هیچ‌یک از annotationColor/annotationOpacity/
  // annotationStrokeWidth را نمی‌خواند (به لایه مراجعه کنید)؛ پس
  // بلوکِ رنگ، دکمه‌های ضخامت و اسلایدرِ شفافیت برای این دو ابزار
  // پنهان می‌شوند. چون شرط، فقط روی annotationTool است، برگشت به
  // هر ابزارِ ترسیمی، همهٔ کنترل‌ها را دقیقاً مثلِ قبل برمی‌گرداند.
  const hideColorControls = annotationTool === 'hand' || annotationTool === 'eraser';
  const DRAWING_TOOL_IDS = ['select', 'pen', 'box', 'arrow', 'highlighter', 'eraser'];

  // پولیشِ قطعی: قفلِ ابزارها کاملاً حذف شده است — هیچ دکمهٔ ابزاری
  // disabled نمی‌شود و سوییچِ ابزار همیشه آزاد است. توجه: خودِ هوک‌های
  // toolbarOrientation و setToolbarOrientation بالاتر، قبل از returnِ
  // زودهنگام‌اند (قانونِ هوک‌های ری‌اکت) — اینجا فقط از مقدارشان
  // استفاده می‌شود.
  const isVertical = toolbarOrientation === 'vertical';
  // معماریِ قطعی §۱ — آینه‌ای: xی داک (شناور: toolbarPos.x؛ داکِ
  // عمودی: لبهٔ راست؛ داکِ افقی: مرکز) با نیمهٔ صفحه سنجیده
  // می‌شود. اگر داک در نیمهٔ چپ باشد، فلای‌اوت و دراورِ پالت به
  // سمتِ راست باز می‌شوند (به سمتِ مرکز)؛ وگرنه به سمتِ چپ.
  const dockX = toolbarPos ? toolbarPos.x : (isVertical ? viewportW - 80 : viewportW / 2);
  const isDockOnLeft = dockX < viewportW / 2;
  // میکروانیمیشن‌ها §۲ و §۳ + مرحلهٔ ۵۸ مأموریتِ ۳ و ۵ — نمایان
  // بودنِ پانلِ بنتوی ابزار: برای همهٔ ابزارها جز دست (دست، هیچ
  // پانلی ندارد و فقط صفحه را جابه‌جا می‌کند)، وقتی پنل با دوبار
  // کلیک بسته نشده باشد. در غیر این صورت، فقط داکِ جمع‌وجور دیده
  // می‌شود (ابزارها + بازگردانی + جهت + Done).
  const showSecondary = annotationTool !== 'hand' && !panelClosed;
  // هم‌رنگ‌سازیِ مرز و درخشش با رنگِ فعال (§۴٫۲): hexی ۶رقمی را
  // به rgba با آلفای خواسته‌شده تبدیل می‌کند؛ اگر رنگ، hex نبود،
  // همان مقدار برگردانده می‌شود تا چیزی خراب نشود.
  const withAlpha = (hex, a) => {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex || '');
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  // پولیش: جداکنندهٔ جهت‌آگاه — در حالتِ افقی خطِ عمودی (۱×۲۴) و در
  // حالتِ عمودی خطِ افقی (۲۴×۱) تا هم در ستونِ داک و هم در ستونِ فلای‌اوت
  // درست دیده شود.
  const divider = isVertical
    ? <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />
    : <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />;

  // استایل دکمه غیرفعال
  const disabledStyle = (disabled) => ({
    opacity: disabled ? 0.35 : 1,
    cursor: disabled ? 'default' : 'pointer',
  });


  // پولیش: بلوک‌های JSXی تولبار به‌صورتِ متغیر جدا شدند تا در دو حالتِ
  // افقی و عمودی، بدونِ تکرارِ کد، در جای درست رندر شوند:
  // - toolsButtons: دکمه‌های TOOLS (با مورفِ بصری؛ بدونِ هیچ قفل و غیرفعال‌سازی).
  // - secondaryContent: زیرمنوها (باکس/فلش/فونت) + رنگ + ضخامت + شفافیت.
  // - actionsContent: Undo/Redo/پاک‌کردن.
  // - orientationToggle: دکمهٔ سوییچِ جهت با آیکونِ Columns لوسید که در
  //   حالتِ عمودی ۹۰ درجه می‌چرخد (ترنزیشن روی خودِ svg است).
  // Stage 8 Part A (Axis 4): render order follows the persisted
  // toolOrder; any tool missing from a stale saved order is appended.
  const orderedTools = toolOrder
    .map((id) => TOOLS.find((t) => t.id === id))
    .filter(Boolean);
  for (const t of TOOLS) {
    if (!orderedTools.some((o) => o.id === t.id)) orderedTools.push(t);
  }
  // During a drag, the dragged tool is shown at the live insertion
  // index so the row visibly makes room for the drop.
  const displayTools = (() => {
    if (!toolDrag) return orderedTools;
    const without = orderedTools.filter((t) => t.id !== toolDrag.id);
    const dragged = orderedTools.find((t) => t.id === toolDrag.id);
    if (!dragged) return orderedTools;
    const idx = Math.max(0, Math.min(without.length, toolDrag.insertIndex ?? without.length));
    without.splice(idx, 0, dragged);
    return without;
  })();
  const dragGhostTool = toolDrag ? orderedTools.find((t) => t.id === toolDrag.id) : null;

  // Stage 8 Part A (Axis 4): insertion index from the other tool
  // buttons' centers along the toolbar's main axis. Horizontal runs in
  // RTL, so DOM order is right-to-left: the index counts buttons whose
  // center is to the RIGHT of the pointer. Vertical is top-to-bottom.
  const computeToolInsertIndex = (clientX, clientY, draggedId) => {
    const wrap = toolsWrapRef.current;
    if (!wrap) return toolOrder.length;
    const btns = Array.from(wrap.querySelectorAll('[data-tool-btn="1"]')).filter(
      (b) => b.getAttribute('data-tool-id') !== draggedId
    );
    if (btns.length === 0) return 0;
    let idx = 0;
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (isVertical) {
        if (r.top + r.height / 2 < clientY) idx += 1;
      } else if (r.left + r.width / 2 > clientX) {
        idx += 1;
      }
    }
    return idx;
  };

  // Stage 8 Part A (Axis 4): pointer-based drag with a 5px threshold,
  // so an ordinary click still selects the tool. Window listeners in
  // capture phase keep tracking even if the pointer leaves the button.
  const beginToolDrag = (e, id) => {
    if (e.button !== undefined && e.button !== 0) return;
    const session = { id, startX: e.clientX, startY: e.clientY, dragging: false, insertIndex: null };
    toolDragSessionRef.current = session;
    const onMove = (ev) => {
      if (!session.dragging) {
        if (Math.hypot(ev.clientX - session.startX, ev.clientY - session.startY) < 5) return;
        session.dragging = true;
        hideTooltip();
        setHoverToolId(null);
      }
      session.insertIndex = computeToolInsertIndex(ev.clientX, ev.clientY, id);
      setToolDrag({ id, x: ev.clientX, y: ev.clientY, insertIndex: session.insertIndex });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      toolDragSessionRef.current = null;
      if (session.dragging) {
        const target = session.insertIndex;
        setToolDrag(null);
        suppressToolClickUntilRef.current = Date.now() + 120;
        if (typeof target === 'number') {
          setToolOrder((prev) => {
            const without = prev.filter((t) => t !== id);
            const idx = Math.max(0, Math.min(without.length, target));
            without.splice(idx, 0, id);
            return without;
          });
        }
      }
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  // مرحلهٔ ۵۸ مأموریتِ ۵: selectChipStyle (چیپ‌های رنگیِ باکسی/
  // کمندِ پاپ‌اورِ مرحلهٔ ۴۸) حذف شد — کنترلِ یکپارچهٔ بخشِ ۱،
  // برای هر دو گزینه یکدستِ فیروزه‌ای است (به bentoSegmentedBtn
  // مراجعه کنید) و دیگر accentِ جداگانه ندارد.

  // مرحله ۴۸ §۵: آیکون‌های SVG دو گزینهٔ پاپ‌اورِ انتخاب — دکمه‌های
  // متنیِ مرحله ۴۴ هیچ آیکونی نداشتند (فقط متن بودند)، پس هر دو
  // آیکون این‌جا با SVG کشیده شدند: کادرِ خط‌چین برای انتخابِ باکسی،
  // حلقهٔ کمند با دنباله برای انتخابِ آزاد.
  const SelectBoxIcon = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="4.5 3.5" />
    </svg>
  );
  const SelectLassoIcon = ({ size = 18 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="10" cy="10" r="6" />
      <path d="M14.4 14.4 20 20" />
    </svg>
  );

  // مرحلهٔ ۵۸ مأموریتِ ۳ و ۵: گزینه‌های زیرحالتِ انتخاب (باکسی/
  // کمند) — همان دو گزینه با آیکونِ SVG؛ پاپ‌اورِ شناورِ مرحلهٔ ۴۸
  // §۵ حذف شد و این گزینه‌ها حالا دادهٔ کنترلِ یکپارچهٔ بخشِ ۱
  // پانلِ بنتو (secondaryContent) هستند — accentها برای سازگاری
  // نگه داشته شده‌اند، ولی دکمهٔ فعال در بنتو یکدستِ فیروزه‌ای است.
  const selectSubModeOptions = [
    { id: 'box', label: 'انتخاب کادری (مستطیلی)', accent: { bg: 'rgba(34,211,238,0.22)', fg: '#67e8f9', line: '#22d3ee' }, Icon: SelectBoxIcon },
    { id: 'lasso', label: 'انتخاب آزاد (کمند)', accent: { bg: 'rgba(167,139,250,0.22)', fg: '#c4b5fd', line: '#a78bfa' }, Icon: SelectLassoIcon },
  ];

  const toolsButtons = (
    <>
      {/* ابزارها */}
      {displayTools.map(({ id, label, Icon, danger }) => {
        const active = activeId === id;
        return (
          <Fragment key={id}>
          <button
            key={id}
            data-tool-btn="1"
            data-tool-id={id}
            aria-label={label}
            onPointerDown={(e) => beginToolDrag(e, id)}
            onMouseEnter={(e) => {
              if (toolDragSessionRef.current && toolDragSessionRef.current.dragging) return;
              setHoverToolId(id);
              positionToolGlow(e.currentTarget);
              showTooltipDelayed(e, label);
            }}
            onMouseLeave={() => {
              setHoverToolId(null);
              hideToolGlow();
              hideTooltip();
            }}
            onClick={(e) => {
              // Stage 8 Part A (Axis 4): a click that ends a tool drag
              // must not select the tool underneath the pointer.
              if (Date.now() < suppressToolClickUntilRef.current) return;
              // میکروانیمیشن‌ها §۳ — منطقِ پنل: کلیک روی ابزارِ
              // دیگر، یا کلیکِ تکی روی ابزارِ فعالی که پنلش بسته
              // است، پنل را باز می‌کند؛ کلیکِ تکی روی ابزارِ فعالِ
              // باز، پنل را نمی‌بندد (بستن فقط با دوبار کلیک است).
              // رکوردِ کلیک، فقط وقتی تازه می‌شود که این کلیک،
              // دومین کلیکِ سریعِ همان ابزار نباشد تا onDoubleClick
              // بتواند تشخیص دهد ابزار از قبلِ این جفت‌کلیک فعال
              // بوده است یا تازه با کلیکِ اول فعال شده است.
              const now = Date.now();
              const prev = toolClickRef.current;
              if (!prev || prev.id !== id || now - prev.time >= 350) {
                toolClickRef.current = { id, time: now, wasActive: id === activeId, wasPanelClosed: panelClosed };
              }
              if (id !== activeId || panelClosed) setPanelClosed(false);
              hideTooltip();
              setAnnotationTool(id);
              // مرحلهٔ ۵۱ §۴ + مرحلهٔ ۵۸ مأموریتِ ۳: کلیک روی دست،
              // انتخاب یا پاک‌کن، دراورِ رنگ را فوری می‌بندد (اگر از
              // ابزارِ قبلی باز مانده باشد)؛ دست و پاک‌کن،
              // رنگ/ضخامت/شفافیت ندارند و دراور هرگز برای آن‌ها باز
              // نمی‌شود، و کلیک روی select هم هیچ پاپ‌اوری باز
              // نمی‌کند — فقط ابزارِ انتخاب را فعال می‌کند (به گاردِ
              // toggleColorDrawer و افکتِ بستن با تغییرِ ابزار هم
              // مراجعه کنید). حالتِ باکسی/کمند، در بخشِ ۱ پانلِ
              // بنتو انتخاب می‌شود، نه با پاپ‌اورِ شناور.
              if (id === 'hand' || id === 'select' || id === 'eraser') setColorDrawerOpen(false);
            }}
            onDoubleClick={() => {
              // بستن/باز کردن با دوبار کلیک، فقط برای ابزاری که
              // از قبلِ این جفت‌کلیک فعال بوده است؛ دوبار کلیک روی
              // ابزارِ تازه‌فعال‌شده، فقط آن را فعال نگه می‌دارد و
              // پنل باز می‌ماند. اگر پنل از قبل بسته بود، دوبار
              // کلیک آن را باز می‌کند (نه بسته‌تر).
              const rec = toolClickRef.current;
              if (rec && rec.id === id && rec.wasActive) {
                setPanelClosed(!rec.wasPanelClosed);
              }
            }}
            style={{
              ...btnBase,
              // گام ۲ میانی: مورفِ تایپو — دکمه‌های ترسیمی در حالتِ تایپو
              // کوچک (scale ‏0.88) و کم‌رنگ (opacity ‏0.65) می‌شوند؛ text و
              // sticky در مقیاسِ کامل می‌مانند. ترنزیشن از btnBase می‌آید
              // (transform با منحنیِ کشسان + opacity). مورف، صرفاً افکتِ
              // بصری است: قفلِ پولیش کاملاً حذف شده، پس مورف هرگز مانعِ
              // کلیک نمی‌شود — همهٔ دکمه‌های ابزار، همیشه cursorِ
              // pointer و pointerEventsِ auto دارند (دو خطِ پایین).
              ...(isTypoMode && !active && DRAWING_TOOL_IDS.includes(id)
                ? { transform: 'scale(0.88)', opacity: 0.65 }
                : {}),
              cursor: 'pointer',
              pointerEvents: 'auto',
              touchAction: 'none',
              // Stage 8 Part A (Axis 4): the dragged slot stays visible
              // but dimmed with a dashed outline while the ghost moves.
              ...(toolDrag && toolDrag.id === id
                ? { opacity: 0.35, outline: '1.5px dashed rgba(34, 211, 238, 0.7)', outlineOffset: -1 }
                : {}),
              width: 38,
              height: 38,
              borderRadius: 11,
              background: active
                ? danger ? 'rgba(244,63,94,0.25)' : 'rgba(34,211,238,0.22)'
                : 'transparent',
              color: active
                ? danger ? '#fda4af' : '#67e8f9'
                : 'rgba(255,255,255,0.6)',
              outline: active ? `1.5px solid ${danger ? '#f43f5e' : '#22d3ee'}` : 'none',
              outlineOffset: -1,
              // معماریِ قطعی §۳ — دکمهٔ فعال: اسکیلِ نرمِ ۱٫۰۸ +
              // درخششِ هم‌رنگ + ترنزیشنِ تسک. (ترنزیشن، بعد از
              // btnBase می‌آید تا آن را override کند.)
              ...(active
                ? {
                    transform: 'scale(1.08)',
                    // میکروانیمیشن‌ها §۴٫۲ — درخششِ دکمهٔ فعال،
                    // هم‌رنگِ رنگِ فعالِ کاربر است (به‌جای فیروزه‌ایِ
                    // ثابت؛ حاشیهٔ قرمزِ پاک‌کن دست نخورده مانده است).
                    boxShadow: `0 0 12px ${withAlpha(annotationColor, 0.55)}`,
                  }
                : {}),
              // میکروانیمیشن‌ها §۱٫۱ — جهشِ هاور: دکمه زیرِ ماوس،
              // کمی بالا می‌پرد و بزرگ‌تر می‌شود؛ روی دکمهٔ فعال،
              // با اسکیلِ فعال ترکیب می‌شود (نه جایگزینِ آن).
              ...(hoverToolId === id
                ? { transform: active ? 'translateY(-3px) scale(1.15)' : 'translateY(-3px) scale(1.12)' }
                : {}),
              transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                transform: hoverToolId === id && ['pen', 'box', 'arrow', 'highlighter'].includes(id) ? 'rotate(-4deg)' : 'none',
                transition: 'transform 0.2s ease',
              }}
            >
              <Icon size={18} />
            </span>
          </button>
          {/* مرحله ۴۸ §۵ + مرحلهٔ ۵۸ مأموریتِ ۳: چیپ‌های متنیِ پهنِ زیرحالتِ انتخاب از این‌جا
              حذف شدند — دو گزینه با آیکونِ SVG، حالا در بخشِ ۱ پانلِ بنتوی secondaryContent
              هستند (به selectSubModeOptions مراجعه کنید)؛ پاپ‌اورِ شناورِ select در مرحلهٔ ۵۸
              کاملاً حذف شد. */}
          </Fragment>
        );
      })}
    </>
  );
  // فاز ۳ پالت — منطقِ دراور (توابعِ ساده‌اند، نه هوک؛ پس این‌جا،
  // بعد از returnِ زودهنگام، مشکلی ندارند — هوک‌هایشان بالاتر
  // تعریف شده‌اند).
  const applyDrawerColor = (hex) => {
    setAnnotationColor(hex);
    // مثلِ رنگ‌های دم‌دست: علاوه بر ساختِ ابزارِ بعدی، آیتمِ
    // انتخاب‌شده هم به‌روز می‌شود؛ اگر انتخابی نباشد، این تابع
    // هیچ رویدادی شلیک نمی‌کند. بعد، دراور خودکار بسته می‌شود.
    broadcastSelectedPropertyPatch({ color: hex });
    setColorDrawerOpen(false);
  };
  const addUserColor = (hex) => {
    if (!hex || typeof hex !== 'string') return;
    // مرحلهٔ ۳۹ §۳: رنگِ تازه به «رنگ‌هایِ موردِ علاقه»ی استور می‌رود
    // (localStorage + دیتابیس)؛ سقف ۴۸ رنگ.
    addFavoriteColor(hex.toLowerCase());
  };
  // مرحلهٔ ۳۹ §۳: اعمالِ رنگ بدونِ بستنِ دراور (برایِ انتخابگرِ پیشرفته).
  const applyPickerColor = (hex) => {
    if (!hex || typeof hex !== 'string') return;
    setAnnotationColor(hex);
    broadcastSelectedPropertyPatch({ color: hex });
  };
  // مرحلهٔ ۵۶ مأموریتِ ۱: ذخیرهٔ تمپلیتِ رنگی با بازخوردِ صریح.
  // علتِ خاموشِ گزارش‌شده این بود که createCustomColorTemplate،
  // وقتی رنگِ معتبری نمی‌رسید یا سقفِ ۲۴ تمپلیت پر بود، بی‌صدا
  // state برمی‌گشت و تولبار هم فرم را می‌بست؛ پس کاربر هیچ خطایی
  // نمی‌دید و لیست خالی می‌ماند. حالا: (۱) اگر اکشن در استورِ
  // نصب‌شده نباشد (استورِ قدیمی‌تر از مرحلهٔ ۳۹)، به‌جای TypeError،
  // پیامِ درون‌خطی + توست نشان داده می‌شود؛ (۲) نتیجهٔ boolean
  // بررسی می‌شود و موفقیت/شکست، هم با توست و هم با پیامِ درون‌خطی
  // گفته می‌شود؛ (۳) نامِ پیش‌فرض، خودکار «تمپلیت ۱»، «تمپلیت ۲»…
  // است (نخستین شمارهٔ استفاده‌نشده) و کاربر می‌تواند عوضش کند.
  // این‌ها تابعِ ساده‌اند، نه هوک؛ پس این‌جا، بعد از returnِ
  // زودهنگام، مشکلی ندارند (فقط در هندلرهای رویداد صدا زده می‌شوند).
  const suggestTemplateName = () => {
    const used = new Set((customColorTemplates || []).map((tm) => tm.name));
    let n = (customColorTemplates || []).length + 1;
    for (;;) {
      const candidate = `تمپلیت ${n.toLocaleString('fa-IR')}`;
      if (!used.has(candidate)) return candidate;
      n += 1;
    }
  };
  const saveColorTemplate = () => {
    if (typeof createCustomColorTemplate !== 'function') {
      const msg = 'ذخیرهٔ تمپلیت در این نسخه پشتیبانی نمی‌شود؛ فایلِ useAppStore.js را با نسخهٔ مرحلهٔ ۵۶ جایگزین کنید.';
      setTemplateFormError(msg);
      if (typeof showToast === 'function') showToast(msg, { type: 'error' });
      return;
    }
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    const source = favoriteColors.length > 0 ? favoriteColors : [annotationColor];
    const colors = source.filter((c) => typeof c === 'string' && hexRe.test(c));
    if (colors.length === 0) {
      const msg = 'رنگی برای ذخیره نیست؛ اول یک رنگ انتخاب کن.';
      setTemplateFormError(msg);
      if (typeof showToast === 'function') showToast(msg, { type: 'error' });
      return;
    }
    const name = newTemplateName.trim() || suggestTemplateName();
    const ok = createCustomColorTemplate(name, colors);
    if (ok) {
      setTemplateFormError('');
      setNewTemplateName('');
      setIsCreatingTemplate(false);
      if (typeof showToast === 'function') showToast(`تمپلیت «${name}» ذخیره شد.`, { type: 'success' });
    } else {
      const msg = 'تمپلیت ذخیره نشد؛ سقفِ ۲۴ تمپلیت پر است یا رنگ‌ها نامعتبرند.';
      setTemplateFormError(msg);
      if (typeof showToast === 'function') showToast(msg, { type: 'error' });
    }
  };
  // مرحلهٔ ۵۶ مأموریتِ ۱: «ذخیرهٔ رنگِ فعلی» هم بی‌بازخورد بود —
  // رنگِ تکراری یا نامعتبر، بی‌صدا رد می‌شد. حالا نتیجه گفته می‌شود.
  const saveCurrentFavoriteColor = () => {
    if (typeof annotationColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(annotationColor)) {
      if (typeof showToast === 'function') showToast('رنگِ فعلی معتبر نیست؛ اول یک رنگ انتخاب کن.', { type: 'error' });
      return;
    }
    if (typeof addFavoriteColor !== 'function') return;
    const added = addFavoriteColor(annotationColor);
    if (typeof showToast !== 'function') return;
    if (added) showToast('رنگِ فعلی در رنگ‌های من ذخیره شد.', { type: 'success' });
    else showToast('این رنگ قبلاً در رنگ‌های من است.', { type: 'info' });
  };
  // مرحلهٔ ۵۷ مأموریتِ ۲: رنگ‌هایِ یک پالت با شناسه — 'default' همان
  // ۸ رنگِ کلاسیک است؛ 'favorites' رنگ‌هایِ من؛ 'template:<id>'
  // تمپلیتِ کاربر؛ بقیه، دسته‌هایِ PALETTE_CATEGORIES. null یعنی
  // پالت، رنگِ قابلِ نصبی ندارد.
  const resolvePaletteColors = (paletteId) => {
    if (paletteId === 'favorites') {
      return favoriteColors.length > 0 ? [...favoriteColors] : [annotationColor];
    }
    if (typeof paletteId === 'string' && paletteId.startsWith('template:')) {
      const found = customColorTemplates.find((x) => x.id === paletteId.slice(9));
      return found && found.colors.length > 0 ? [...found.colors] : null;
    }
    const cat = PALETTE_CATEGORIES.find((c) => c.id === paletteId);
    if (cat) return cat.colors.map((c) => c.hex);
    return null;
  };
  // مرحلهٔ ۵۷ مأموریتِ ۲: نصبِ یک پالت در نوار ابزار — نوارِ سریع،
  // بی‌درنگ به رنگ‌هایِ همان پالت عوض می‌شود و دراور باز می‌ماند تا
  // کاربر بی‌درنگ پالتِ دیگری را هم امتحان کند (باز کردنِ دوبارهٔ
  // پنل لازم نیست).
  const activatePalette = (paletteId) => {
    if (typeof setActivePaletteId !== 'function') {
      if (typeof showToast === 'function') showToast('نصبِ پالت در این نسخه پشتیبانی نمی‌شود؛ فایلِ useAppStore.js را با نسخهٔ مرحلهٔ ۵۷ جایگزین کنید.', { type: 'error' });
      return;
    }
    const colors = paletteId === 'default' ? null : resolvePaletteColors(paletteId);
    if (paletteId !== 'default' && (!colors || colors.length === 0)) {
      if (typeof showToast === 'function') showToast('این پالت رنگی ندارد؛ اول رنگ اضافه کن.', { type: 'error' });
      return;
    }
    // برچسب، از رویِ پالتِ تازه‌نصب‌شده حساب می‌شود، نه پالتِ قبلیِ
    // فعال (activePaletteLabel هنوز مقدارِ پیش از تعویض را دارد).
    const targetLabel = (() => {
      if (paletteId === 'default') return 'کلاسیک و استاندارد';
      if (paletteId === 'favorites') return 'رنگ‌های من';
      if (typeof paletteId === 'string' && paletteId.startsWith('template:')) {
        const found = customColorTemplates.find((x) => x.id === paletteId.slice(9));
        return found ? found.name : 'تمپلیت';
      }
      const cat = PALETTE_CATEGORIES.find((c) => c.id === paletteId);
      return cat ? cat.label : 'پالت';
    })();
    const ok = setActivePaletteId(paletteId, colors);
    if (typeof showToast !== 'function') return;
    if (ok) showToast(`پالت «${targetLabel}» در نوار ابزار نصب شد.`, { type: 'success' });
    else showToast('نصبِ پالت انجام نشد.', { type: 'error' });
  };
  // مرحلهٔ ۵۷ مأموریتِ ۲: دکمهٔ + کنارِ رنگ‌هایِ نوارِ سریع و داخلِ
  // هر پالتِ کاربر — رنگِ فعلی را به نوارِ سریع اضافه می‌کند.
  const addCurrentColorToStrip = () => {
    if (typeof addPrimaryToolbarColor !== 'function') return;
    const added = addPrimaryToolbarColor(annotationColor);
    if (typeof showToast !== 'function') return;
    if (added) showToast('رنگِ فعلی به نوار ابزار اضافه شد.', { type: 'success' });
    else showToast('این رنگ در نوار ابزار هست یا نوار پر است (حداکثر ۱۰ رنگ).', { type: 'info' });
  };
  // مرحلهٔ ۵۷ مأموریتِ ۲: حذفِ یک رنگ از نوارِ سریع (کلیکِ راست یا
  // × در حالتِ ویرایش).
  const removeStripColor = (hex) => {
    if (typeof removePrimaryToolbarColor !== 'function') return;
    removePrimaryToolbarColor(hex);
  };
  // مرحلهٔ ۵۷ مأموریتِ ۲: ویرایشِ درون‌خطیِ تمپلیت — پیش‌نویسِ نام
  // و رنگ‌ها در stateی محلی است تا لغو، چیزی را عوض نکند.
  const startEditingTemplate = (t) => {
    setEditingTemplateId(t.id);
    setEditingTemplateName(t.name || '');
    setEditingTemplateColors(Array.isArray(t.colors) ? [...t.colors] : []);
  };
  const saveEditingTemplate = () => {
    if (typeof updateCustomColorTemplate !== 'function') {
      if (typeof showToast === 'function') showToast('ویرایشِ تمپلیت در این نسخه پشتیبانی نمی‌شود؛ فایلِ useAppStore.js را با نسخهٔ مرحلهٔ ۵۷ جایگزین کنید.', { type: 'error' });
      return;
    }
    const name = editingTemplateName.trim() || 'تمپلیت';
    updateCustomColorTemplate(editingTemplateId, { name, colors: editingTemplateColors });
    setEditingTemplateId(null);
    if (typeof showToast === 'function') showToast(`تمپلیت «${name}» به‌روز شد.`, { type: 'success' });
  };
  // مرحلهٔ ۵۷ مأموریتِ ۲: دکمهٔ «نصب در نوار ابزار» کنارِ هر عنوانِ
  // پالت؛ اگر همین پالت فعال باشد، «پالتِ فعال» نشان می‌دهد (مرحلهٔ
  // ۵۸: کاراکترِ تیک که در مرحلهٔ ۵۷ آمده بود، حذف شد — گلیفِ ممنوع
  // است؛ تمایزِ حالتِ فعال، با رنگِ سبز و برچسبِ «پالتِ فعال» است).
  const paletteInstallButton = (paletteId) => {
    const isActive = activePaletteId === paletteId;
    return (
      <button
        type="button"
        title={isActive ? 'این پالت الان در نوار ابزار فعال است' : 'نصبِ این پالت در نوار ابزار'}
        onClick={(e) => { e.stopPropagation(); activatePalette(paletteId); }}
        style={{
          ...btnBase,
          height: 22,
          padding: '0 8px',
          borderRadius: 11,
          background: isActive ? 'rgba(16,185,129,0.18)' : 'rgba(34,211,238,0.14)',
          border: isActive ? '1px solid rgba(16,185,129,0.55)' : '1px solid rgba(34,211,238,0.45)',
          color: isActive ? '#6ee7b7' : '#67e8f9',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: 'inherit',
          flexShrink: 0,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        {isActive ? 'پالتِ فعال' : 'نصب در نوار ابزار'}
      </button>
    );
  };
  // مرحلهٔ ۵۷ مأموریتِ ۲: یک دایرهٔ رنگ در دراور (بخشِ کلاسیک) —
  // دقیقاً همان ساختارِ دایره‌هایِ دسته‌ها (هاور، بجِ فعال، کلیک
  // برای اعمالِ رنگ و بستنِ دراور).
  const drawerColorSwatch = (groupKey, c) => {
    const active = annotationColor.toLowerCase() === c.hex.toLowerCase();
    return (
      <button
        key={c.hex}
        title={`${c.label} (${c.hex})`}
        onMouseEnter={() => setHoverSwatch(`d:${groupKey}:${c.hex}`)}
        onMouseLeave={() => setHoverSwatch(null)}
        onClick={() => applyDrawerColor(c.hex)}
        style={{
          ...btnBase,
          width: 24,
          height: 24,
          borderRadius: '50%',
          flexShrink: 0,
          padding: 0,
          boxSizing: 'border-box',
          background: 'transparent',
          border: 'none',
          boxShadow: 'none',
          transform: 'none',
          transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        <span
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 24,
            height: 24,
            borderRadius: '50%',
            pointerEvents: 'none',
            background: c.hex,
            border: active
              ? '1.5px solid rgba(255,255,255,0.85)'
              : '1px solid rgba(255,255,255,0.25)',
            boxShadow: active ? `inset 0 0 0 999px rgba(0, 0, 0, 0.35), 0 0 0 2px #ffffff, 0 0 10px ${c.hex}` : hoverSwatch === `d:${groupKey}:${c.hex}` ? `0 6px 14px ${c.hex}` : 'none',
            transform: hoverSwatch === `d:${groupKey}:${c.hex}` ? 'scale(1.16) translateY(-2px)' : 'scale(1)',
            transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          {active && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', pointerEvents: 'none' }}>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </span>
      </button>
    );
  };
  // مرحلهٔ ۵۸ مأموریتِ ۴: دراور با موتورِ مرزِ امن باز می‌شود —
  // موقعیت، دیگر با translateها ( ‎-50% / ‎-100% ) نگه داشته
  // نمی‌شود، بلکه گوشهٔ بالا-چپِ پنل مستقیم حساب و با
  // computeSafePopoverPosition در بازهٔ امنِ [64 ،innerHeight-16]
  // و [16 ،innerWidth-16] کلمپ می‌شود؛ ارتفاعِ تخمینیِ پنل هم
  // همان maxHeightی فرمول است (min(440, vh - 88)) و بعد از mount،
  // ResizeObserver با ارتفاعِ واقعیِ اندازه‌گیری‌شده دوباره کلمپ
  // می‌کند. عرضِ دراور، همان ۲۷۲ پیکسلِ فشردهٔ مرحلهٔ ۵۷ می‌ماند.
  const toggleColorDrawer = () => {
    // مرحلهٔ ۵۱ §۴: برای دست و پاک‌کن، دراورِ رنگ هرگز باز نمی‌شود؛
    // اگر به‌هر دلیل صدا زده شد، فقط می‌بندد.
    if (annotationTool === 'hand' || annotationTool === 'eraser') {
      setColorDrawerOpen(false);
      return;
    }
    if (colorDrawerOpen) {
      setColorDrawerOpen(false);
      return;
    }
    // دراور با position: fixed رندر می‌شود تا overflowی نوارِ افقی
    // (overflowX: auto) آن را نبرد؛ پس مختصاتش در لحظهٔ باز شدن، از
    // کادرِ دکمه اندازه‌گیری می‌شود. افقی: پایینِ دکمه، وسط‌چین، با
    // clamp در لبه‌های پنجره (عرضِ دراور ۲۷۲ است). عمودی: سمتِ
    // باز شدن، همان سمتِ فلای‌اوت است (قانونِ آینه‌ایِ §۱: داک در
    // نیمهٔ چپ → سمتِ راستِ دکمه؛ وگرنه سمتِ چپ)، با fallback به
    // سمتِ دیگر اگر سمتِ خواسته‌شده جا نداشت، و clamp در لبه‌ها.
    const DRAWER_WIDTH = 272;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const estHeight = Math.min(440, vh - SAFE_TOP - 24);
    const rect = paletteBtnRef.current ? paletteBtnRef.current.getBoundingClientRect() : null;
    if (!rect) {
      const pos = computeSafePopoverPosition(80, estHeight, (vw - DRAWER_WIDTH) / 2, DRAWER_WIDTH, vw, vh);
      setColorDrawerPos({ top: pos.top, left: pos.left, transform: 'none', above: false });
    } else if (isVertical) {
      const cy = rect.top + rect.height / 2;
      const fitsLeft = rect.left - 10 >= DRAWER_WIDTH;
      const fitsRight = vw - rect.right - 10 >= DRAWER_WIDTH;
      const openRight = isDockOnLeft ? (fitsRight || !fitsLeft) : (fitsRight && !fitsLeft);
      const desiredLeft = openRight ? rect.right + 10 : rect.left - 10 - DRAWER_WIDTH;
      const pos = computeSafePopoverPosition(cy - estHeight / 2, estHeight, desiredLeft, DRAWER_WIDTH, vw, vh);
      setColorDrawerPos({ top: pos.top, left: pos.left, transform: 'none', above: false });
    } else {
      const cx = Math.max(144, Math.min(rect.left + rect.width / 2, vw - 144));
      const desiredLeft = cx - DRAWER_WIDTH / 2;
      // Stage 8 Part A (Axis 3): smart flip — if there is not enough
      // room below the bar (drawer ~440px) but more room above, the
      // drawer opens ABOVE the bar so it is never clipped by the
      // bottom edge of the monitor. The safe clamp below is the
      // final guard even when the flip misjudges the real height.
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      const above = spaceBelow < estHeight + 10 && spaceAbove > spaceBelow;
      const desiredTop = above ? rect.top - 10 - estHeight : rect.bottom + 10;
      const pos = computeSafePopoverPosition(desiredTop, estHeight, desiredLeft, DRAWER_WIDTH, vw, vh);
      setColorDrawerPos({ top: pos.top, left: pos.left, transform: 'none', above });
    }
    setColorDrawerOpen(true);
  };

  // مرحلهٔ ۵۸ مأموریتِ ۵: یاری‌رسان‌هایِ چیدمانِ بنتو — کنترلِ
  // یکپارچهٔ حالتِ ابزار (پس‌زمینهٔ یکدستِ تیره، دکمهٔ فعالِ
  // فیروزه‌ای، سهم‌هایِ برابر در عرضِ کاملِ ردیف) و جداکنندهٔ
  // شرطیِ بخش‌ها (فقط وقتی بخشی بالای آن هست). این‌ها تابعِ
  // ساده‌اند، نه هوک.
  const bentoSegmentedWrap = (columns) => ({
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: 3,
    width: '100%',
    background: 'rgba(15,23,42,0.75)',
    border: '1px solid rgba(255,255,255,0.10)',
    borderRadius: 10,
    padding: 3,
    boxSizing: 'border-box',
  });
  const bentoSegmentedBtn = (active) => ({
    ...btnBase,
    height: 32,
    borderRadius: 8,
    fontSize: 12,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
    background: active ? 'rgba(34,211,238,0.22)' : 'transparent',
    color: active ? '#67e8f9' : 'rgba(255,255,255,0.65)',
    outline: active ? '1.5px solid #22d3ee' : 'none',
    outlineOffset: -1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  const bentoSepIf = (on) => (on ? { borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 10 } : {});
  const showThickness = !hideStrokeControls && !hideColorControls;
  const showOpacity = !hideColorControls;
  // بخشِ ۱ برای این ابزار هست؟ (برای جداکنندهٔ شرطیِ بخش‌های بعد)
  const hasModeSection = annotationTool === 'select' || annotationTool === 'box'
    || annotationTool === 'arrow' || selectedAnnotationTool === 'arrow' || isTypoMode;
  const zoomHasSectionsAbove = hasModeSection || !hideColorControls || showThickness || showOpacity;
  // مرحلهٔ ۵۸ مأموریتِ ۵: پانلِ بنتو — همهٔ پاپ‌اورهای ابزار، رویِ
  // یک چیدمانِ ثابتِ ۲۸۸ پیکسلیِ متقارن بازسازی شدند: بخشِ ۱
  // کنترلِ یکپارچهٔ حالتِ ابزار (فقط وقتی ابزار، حالتی دارد)،
  // بخشِ ۲ رنگِ ابزار با سربرگ و گریدِ ۸ ستونهٔ سوآچ‌ها، بخشِ ۳
  // ضخامت + شفافیت در یک جعبهٔ فشرده، و بخشِ ۴ فوترِ فشردهٔ زوم.
  // برای دست، پانل اصلاً رندر نمی‌شود (به showSecondary مراجعه
  // کنید — مأموریتِ ۳). راهنمای دوبار کلیکِ قدیمی حذف شد.
  const secondaryContent = (
    <div
      dir="rtl"
      style={{
        width: 288,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignItems: 'stretch',
      }}
    >
      {/* بخشِ ۱ — حالتِ ابزار: انتخاب (باکسی/کمند) */}
      {annotationTool === 'select' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, animation: 'submenuIn 0.2s ease' }}>
          <div style={bentoSegmentedWrap(2)}>
            {selectSubModeOptions.map((opt) => {
              const active = selectSubMode === opt.id;
              const OptIcon = opt.Icon;
              return (
                <button
                  key={opt.id}
                  type="button"
                  aria-pressed={active}
                  aria-label={opt.label}
                  title={opt.label}
                  onClick={() => { setSelectSubMode(opt.id); }}
                  style={{ ...bentoSegmentedBtn(active), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 6px' }}
                >
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>
                    <OptIcon size={16} />
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.id === 'box' ? 'کادری' : 'کمند'}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* بخشِ ۱ — حالتِ ابزار: کادربندی */}
      {annotationTool === 'box' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, animation: 'submenuIn 0.2s ease' }}>
          <div style={bentoSegmentedWrap(3)}>
            {BOX_STYLES.map((bs) => {
              const active = annotationBoxStyle === bs.id;
              return (
                <button
                  key={bs.id}
                  className="at-pill"
                  title={`استایل کادر: ${bs.label}`}
                  onClick={() => {
                    setAnnotationBoxStyle(bs.id);
                    broadcastSelectedBoxPatch({ boxStyle: bs.id });
                  }}
                  style={bentoSegmentedBtn(active)}
                >
                  {bs.label}
                </button>
              );
            })}
          </div>
          <button
            className="at-pill"
            title={annotationHasFill ? 'رنگ داخل: روشن (کلیک برای خاموش)' : 'رنگ داخل: خاموش (کلیک برای روشن)'}
            onClick={() => {
              toggleAnnotationFill();
              // مقدار جدید بعد از set همگام Zustand در getState در دسترس است
              const next = typeof useAppStore.getState === 'function'
                ? useAppStore.getState().annotationHasFill
                : !annotationHasFill;
              broadcastSelectedBoxPatch({ hasFill: Boolean(next) });
            }}
            style={{ ...bentoSegmentedBtn(annotationHasFill), width: '100%' }}
          >
            {annotationHasFill ? '◉ توپر' : '○ توخالی'}
          </button>
        </div>
      )}

      {/* بخشِ ۱ — حالتِ ابزار: فلش — وقتی ابزار arrow فعال است
          یا آیتمِ انتخاب‌شده فلش است (طبقِ TASK: tool OR selectedAnnotationTool) */}
      {(annotationTool === 'arrow' || selectedAnnotationTool === 'arrow') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, animation: 'submenuIn 0.2s ease' }}>
          <div style={bentoSegmentedWrap(2)}>
            {ARROW_STYLES.map((as) => {
              const active = annotationArrowStyle === as.id;
              return (
                <button
                  key={as.id}
                  className="at-pill"
                  title={`استایل فلش: ${as.label}`}
                  onClick={() => {
                    if (typeof setAnnotationArrowStyle === 'function') {
                      setAnnotationArrowStyle(as.id);
                    }
                    broadcastSelectedArrowPatch({ arrowStyle: as.id });
                  }}
                  style={bentoSegmentedBtn(active)}
                >
                  {as.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
            <button
              className="at-pill"
              title="نقطهٔ مبدأ فلش: ته‌گرد یا ساده"
              onClick={() => {
                const next = !annotationHasStartDot;
                if (typeof setAnnotationHasStartDot === 'function') {
                  setAnnotationHasStartDot(next);
                }
                broadcastSelectedPropertyPatch({ hasStartDot: next });
              }}
              style={bentoSegmentedBtn(annotationHasStartDot)}
            >
              {annotationHasStartDot ? '◉ ته‌گرد' : '○ ساده'}
            </button>
            <button
              className="at-pill"
              title="نوک فلش: با فلش یا خطِ ساده"
              onClick={() => {
                const next = !annotationHasEndArrow;
                if (typeof setAnnotationHasEndArrow === 'function') {
                  setAnnotationHasEndArrow(next);
                }
                broadcastSelectedPropertyPatch({ hasEndArrow: next });
              }}
              style={bentoSegmentedBtn(annotationHasEndArrow)}
            >
              {annotationHasEndArrow ? (<><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: 'middle', marginLeft: 5 }}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg><span>با فلش</span></>) : '— خط'}
            </button>
          </div>
        </div>
      )}

      {/* بخشِ ۱ — حالتِ ابزار: فونتِ متن/استیکی (کنسولِ تایپو) */}
      {isTypoMode && (
        <div key={annotationTool} style={{ display: 'flex', flexDirection: 'column', gap: 8, animation: 'typoConsoleIn 0.25s ease' }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
            فونتِ متن — پیش‌فرض: استعداد
          </div>
          <div style={bentoSegmentedWrap(3)}>
            {FONT_OPTIONS.map((f) => {
              const active = annotationFontFamily === f.id;
              return (
                <button
                  key={f.id}
                  className="at-pill"
                  title={`فونت: ${f.label}`}
                  onClick={() => {
                    if (typeof setAnnotationFontFamily === 'function') {
                      setAnnotationFontFamily(f.id);
                    }
                    broadcastTypoPatch({ fontFamily: f.id });
                  }}
                  style={bentoSegmentedBtn(active)}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>
              اندازه:
            </span>
            <input
              type="range"
              min={14}
              max={76}
              step={1}
              value={annotationFontSize}
              onChange={(e) => {
                const val = Math.max(14, Math.min(76, parseInt(e.target.value, 10) || 22));
                if (typeof setAnnotationFontSize === 'function') {
                  setAnnotationFontSize(val);
                }
                broadcastTypoPatch({ fontSize: val });
              }}
              className="at-range"
              style={{ flex: 1, minWidth: 0, accentColor: '#22d3ee', cursor: 'pointer' }}
            />
            <span
              style={{
                fontSize: 12,
                color: '#67e8f9',
                minWidth: 44,
                textAlign: 'center',
                background: 'rgba(34,211,238,0.12)',
                borderRadius: 7,
                padding: '2px 6px',
                whiteSpace: 'nowrap',
              }}
            >
              {annotationFontSize}px
            </span>
          </div>
        </div>
      )}

      {/* بخشِ ۲ — رنگِ ابزار: سربرگ + گریدِ ۸ ستونهٔ سوآچ‌ها.
          دکمه‌های ویرایش و +، دیگر ردیفِ سوآچ را نمی‌شکنند؛ در
          سربرگ‌اند. مرحلهٔ ۵۱ §۴: برای دست/پاک‌کن پنهان است. */}
      {!hideColorControls && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, ...bentoSepIf(hasModeSection) }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.85)', whiteSpace: 'nowrap' }}>
              رنگِ ابزار
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              <button
                ref={paletteBtnRef}
                type="button"
                title={`پالت‌ها — پالتِ فعال: ${activePaletteLabel} — باز کردنِ دراورِ پالتِ تخصصی`}
                onClick={toggleColorDrawer}
                style={{
                  ...btnBase,
                  height: 26,
                  padding: '0 8px',
                  borderRadius: 13,
                  background: colorDrawerOpen ? 'rgba(34,211,238,0.22)' : 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: colorDrawerOpen ? '#67e8f9' : 'rgba(255,255,255,0.8)',
                  fontSize: 11,
                  fontWeight: 700,
                  fontFamily: 'inherit',
                  flexShrink: 0,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  maxWidth: 128,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <path d="M12 22a1 1 0 0 1 0-20a10 9 0 0 1 10 9a5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
                  <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
                  <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
                  <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
                  <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
                </svg>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>پالت‌ها: {activePaletteLabel}</span>
              </button>
              <button
                type="button"
                title="افزودن رنگِ فعلی به نوار ابزار"
                onClick={addCurrentColorToStrip}
                style={{ ...btnBase, width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: '1px dashed rgba(255,255,255,0.4)', color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
              >
                +
              </button>
              <button
                type="button"
                title={isEditingStrip ? 'پایانِ ویرایشِ نوار ابزار' : 'ویرایشِ نوار ابزار (حذفِ رنگ‌ها با ×)'}
                onClick={() => setIsEditingStrip(!isEditingStrip)}
                style={{ ...btnBase, height: 26, padding: '0 8px', borderRadius: 13, background: isEditingStrip ? 'rgba(244,63,94,0.16)' : 'transparent', border: isEditingStrip ? '1px solid rgba(244,63,94,0.5)' : '1px solid rgba(255,255,255,0.25)', color: isEditingStrip ? '#fda4af' : 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                {isEditingStrip ? 'پایان ویرایش' : 'ویرایش'}
              </button>
            </span>
          </div>
          {activePaletteId !== 'default' && (
            <button
              type="button"
              title="بازگشت به پالتِ پیش‌فرض"
              onClick={() => activatePalette('default')}
              style={{ ...btnBase, alignSelf: 'flex-start', height: 26, padding: '0 8px', borderRadius: 13, background: 'rgba(34,211,238,0.16)', border: '1px solid rgba(34,211,238,0.5)', color: '#67e8f9', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0, cursor: 'pointer' }}
            >
              {activePaletteLabel} ×
            </button>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 6, justifyItems: 'center' }}>
            {quickColors.map((c) => {
              const active = annotationColor.toLowerCase() === c.hex.toLowerCase();
              return (
                <span key={c.hex} style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
                  <button
                    title={c.label}
                    onMouseEnter={() => setHoverSwatch(`q:${c.hex}`)}
                    onMouseLeave={() => setHoverSwatch(null)}
                    onContextMenu={(e) => { e.preventDefault(); removeStripColor(c.hex); }}
                    onClick={() => {
                      setAnnotationColor(c.hex);
                      // فاز ۵: بایندینگِ دوطرفهٔ رنگ — علاوه بر ساختِ
                      // ابزارِ بعدی، آیتمِ انتخاب‌شده هم به‌روز می‌شود.
                      // اگر انتخابی نباشد، broadcastSelectedPropertyPatch
                      // هیچ رویدادی شلیک نمی‌کند.
                      broadcastSelectedPropertyPatch({ color: c.hex });
                    }}
                    style={{
                      ...btnBase,
                      width: 28,
                      height: 28,
                      padding: 0,
                      boxSizing: 'border-box',
                      flexShrink: 0,
                      borderRadius: '50%',
                      background: 'transparent',
                      // فاز ۳ پالت — نشانگرِ رنگِ فعال (تسک §۱): به‌جای
                      // رینگِ فیروزه‌ایِ قبلی، بجِ سفید + درخششِ هم‌رنگ.
                      border: 'none',
                      boxShadow: 'none',
                      transform: 'none',
                      transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  >
                    {/* فاز ۴ — Fixed Hitbox: دکمه ۲۸×۲۸ ثابت است و هیچ
                      transformای ندارد؛ دایرهٔ رنگ، spanی داخلی با
                      pointerEvents خنثی است تا Hitbox هرگز تکان نخورد. */}
                    <span
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                        background: c.hex,
                        border: active
                          ? '1.5px solid rgba(255,255,255,0.85)'
                          : c.hex === '#f8fafc' ? '1px solid rgba(0,0,0,0.2)' : 'none',
                        boxShadow: active
                          // مرحلهٔ ۳۸ §۵: رنگِ انتخاب‌شده تیره + حلقهٔ سفید + تیک.
                          ? `inset 0 0 0 999px rgba(0, 0, 0, 0.35), 0 0 0 2px #ffffff, 0 0 10px ${c.hex}`
                          : hoverSwatch === `q:${c.hex}`
                            ? `0 6px 14px ${c.hex}`
                            : '0 0 0 1px rgba(255,255,255,0.2)',
                        transform: hoverSwatch === `q:${c.hex}` ? 'scale(1.16) translateY(-2px)' : 'scale(1)',
                        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    >
                      {active && (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', pointerEvents: 'none' }}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  </button>
                  {isEditingStrip && (
                    <button
                      type="button"
                      title={`حذف ${c.hex} از نوار ابزار`}
                      onClick={(e) => { e.stopPropagation(); removeStripColor(c.hex); }}
                      style={{ position: 'absolute', top: -7, left: -7, width: 16, height: 16, borderRadius: '50%', background: '#f43f5e', color: '#ffffff', border: '1px solid rgba(255,255,255,0.7)', fontSize: 11, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 1 }}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* بخشِ ۳ — ضخامت + شفافیت در یک جعبهٔ فشرده.
          مرحلهٔ ۵۱ §۴: برای دست/پاک‌کن، کلِ بخش پنهان است؛ برای
          متن/استیکی/باکس، ردیفِ ضخامت پنهان است و فقط شفافیت می‌ماند. */}
      {(showThickness || showOpacity) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 10, background: 'rgba(255,255,255,0.03)' }}>
          {showThickness && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
              {SIZES.map((v) => {
                const active = annotationStrokeWidth === v;
                const dot = Math.min(18, 5 + v * 1.2);
                return (
                  <button
                    key={v}
                    className="at-pill"
                    title={`ضخامت ${v}`}
                    onClick={() => {
                      setAnnotationStrokeWidth(v);
                      // فاز ۵: بایندینگِ دوطرفهٔ ضخامت — مثلِ رنگ.
                      // توجه: برای آیتمِ متنی، شنوندهٔ لایه strokeWidth را
                      // می‌پذیرد ولی رندرِ متن از strokeWidth استفاده
                      // نمی‌کند؛ پس تغییرِ ضخامت روی متنِ انتخاب‌شده،
                      // فقط میدان را ذخیره می‌کند و ظاهرِ متن را عوض
                      // نمی‌کند (نقشهٔ قدیمیِ strokeWidth برای متن، از
                      // fontSize ساخته می‌شود — به گزارشِ اسکنِ فاز ۵، §۱٫۳).
                      broadcastSelectedPropertyPatch({ strokeWidth: v });
                    }}
                    style={{
                      ...btnBase,
                      width: '100%',
                      height: 32,
                      borderRadius: 9,
                      background: active ? 'rgba(34,211,238,0.20)' : 'transparent',
                      outline: active ? '1.5px solid #22d3ee' : 'none',
                      outlineOffset: -1,
                    }}
                  >
                    <span
                      style={{
                        width: dot,
                        height: dot,
                        borderRadius: '50%',
                        background: active ? '#67e8f9' : 'rgba(255,255,255,0.5)',
                        flexShrink: 0,
                      }}
                    />
                  </button>
                );
              })}
            </div>
          )}
          {showOpacity && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap' }}>
                شفافیت:
              </span>
              <input
                type="range"
                min={15}
                max={100}
                step={5}
                value={Math.round((Number(annotationOpacity) || 0.85) * 100)}
                onChange={(e) => {
                  const pct = Math.max(15, Math.min(100, parseInt(e.target.value, 10) || 85));
                  const val = pct / 100;
                  if (typeof setAnnotationOpacity === 'function') {
                    setAnnotationOpacity(val);
                  }
                  broadcastSelectedPropertyPatch({ opacity: val });
                }}
                className="at-range"
                style={{ flex: 1, minWidth: 0, accentColor: '#22d3ee', cursor: 'pointer' }}
              />
              <span
                style={{
                  fontSize: 12,
                  color: '#67e8f9',
                  minWidth: 44,
                  textAlign: 'center',
                  background: 'rgba(34,211,238,0.12)',
                  borderRadius: 7,
                  padding: '2px 6px',
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.round((Number(annotationOpacity) || 0.85) * 100)}٪
              </span>
            </div>
          )}
        </div>
      )}

      {/* بخشِ ۴ — فوترِ فشردهٔ زوم (مرحلهٔ ۳۵ §۵: هماهنگیِ اندازهٔ
          استیکی‌نوت با زوم + تنظیمِ دستیِ مقیاسِ استیکی. تاگل،
          مقیاسِ رندرِ معکوسِ زوم را فعال می‌کند؛ دکمه‌های − و +،
          مقیاسِ دستیِ استیکیِ انتخاب‌شده را عوض می‌کنند. برای
          متن، اندازه با کنترلِ فونتِ بخشِ ۱ تنظیم می‌شود.) */}
      <div style={{ ...bentoSepIf(zoomHasSectionsAbove) }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, height: 32 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: 'rgba(255,255,255,0.6)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={zoomAdaptiveAnnotations}
              onChange={(e) => { if (typeof setZoomAdaptiveAnnotations === 'function') setZoomAdaptiveAnnotations(e.target.checked); }}
              style={{ accentColor: '#22d3ee', cursor: 'pointer' }}
            />
            تطبیق با زوم
          </label>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              aria-label="کوچک‌تر کردن استیکی"
              onClick={() => {
                const next = Math.max(0.25, Math.min(3, Math.round(((Number(stickyManualScale) || 1) - 0.25) * 100) / 100));
                if (typeof setStickyManualScale === 'function') setStickyManualScale(next);
                broadcastSelectedPropertyPatch({ customScale: next });
              }}
              style={{ width: 22, height: 22, borderRadius: 7, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            >−</button>
            <span style={{ fontSize: 12, color: '#67e8f9', minWidth: 44, textAlign: 'center', background: 'rgba(34,211,238,0.12)', borderRadius: 7, padding: '2px 6px', whiteSpace: 'nowrap' }}>
              {Math.round((Number(stickyManualScale) || 1) * 100)}٪
            </span>
            <button
              type="button"
              aria-label="بزرگ‌تر کردن استیکی"
              onClick={() => {
                const next = Math.max(0.25, Math.min(3, Math.round(((Number(stickyManualScale) || 1) + 0.25) * 100) / 100));
                if (typeof setStickyManualScale === 'function') setStickyManualScale(next);
                broadcastSelectedPropertyPatch({ customScale: next });
              }}
              style={{ width: 22, height: 22, borderRadius: 7, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', color: '#ffffff', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
            >+</button>
          </div>
        </div>
      </div>
    </div>
  );
  const actionsContent = (
    <>
      {/* Undo — فاز ۱: prop با fallback */}
      <button
        aria-label="برگردان (Ctrl+Z)"
        onMouseEnter={(e) => showTooltipDelayed(e, 'برگردان (Ctrl+Z)')}
        onMouseLeave={hideTooltip}
        onClick={doUndo}
        disabled={typeof onUndo !== 'function' || !canUndo}
        style={{
          ...btnBase,
          width: 38,
          height: 38,
          borderRadius: 11,
          background: 'transparent',
          color: 'rgba(255,255,255,0.6)',
          ...disabledStyle(typeof onUndo !== 'function' || !canUndo),
        }}
      >
        <Icons.Undo size={17} />
      </button>

      {/* Redo — فاز ۱: دکمه جدید */}
      <button
        aria-label="ازنو (Ctrl+Y)"
        onMouseEnter={(e) => showTooltipDelayed(e, 'ازنو (Ctrl+Y)')}
        onMouseLeave={hideTooltip}
        onClick={doRedo}
        disabled={typeof onRedo !== 'function' || !canRedo}
        style={{
          ...btnBase,
          width: 38,
          height: 38,
          borderRadius: 11,
          background: 'transparent',
          color: 'rgba(255,255,255,0.6)',
          ...disabledStyle(typeof onRedo !== 'function' || !canRedo),
        }}
      >
        <Icons.Redo size={17} />
      </button>

      {/* فاز ۴: ترتیب لایه — فقط وقتی آیتمی انتخاب شده است */}
      {hasSelectedItem && (
        <>
          <button
            aria-label="آوردن به رو"
            onMouseEnter={(e) => showTooltipDelayed(e, 'آوردن به رو')}
            onMouseLeave={hideTooltip}
            onClick={() => dispatchLayerOrder('front')}
            style={{
              ...btnBase,
              width: 38,
              height: 38,
              borderRadius: 11,
              background: 'transparent',
              color: 'rgba(255,255,255,0.75)',
            }}
          >
            <Icons.BringToFront size={17} />
          </button>
          <button
            aria-label="فرستادن به پشت"
            onMouseEnter={(e) => showTooltipDelayed(e, 'فرستادن به پشت')}
            onMouseLeave={hideTooltip}
            onClick={() => dispatchLayerOrder('back')}
            style={{
              ...btnBase,
              width: 38,
              height: 38,
              borderRadius: 11,
              background: 'transparent',
              color: 'rgba(255,255,255,0.75)',
            }}
          >
            <Icons.SendToBack size={17} />
          </button>
        </>
      )}

      {/* پاک کردن همه — دو مرحله‌ای، فاز ۱: prop با fallback */}
      {pageItemCount > 0 && (
        <button
          title={armClear ? 'برای تایید دوباره بزن' : `پاک کردن همه خط‌های صفحه ${activePage}`}
          onClick={doClear}
          style={{
            ...btnBase,
            minWidth: 38,
            height: 38,
            padding: armClear ? '0 10px' : 0,
            borderRadius: 11,
            background: armClear ? 'rgba(244,63,94,0.30)' : 'transparent',
            color: armClear ? '#fecdd3' : 'rgba(244,63,94,0.75)',
            outline: armClear ? '1.5px solid #f43f5e' : 'none',
            outlineOffset: -1,
            fontSize: 12,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          {armClear ? 'مطمئنی؟' : <Icons.Trash size={17} />}
        </button>
      )}
    </>
  );
  // شناور — منطقِ درگِ دستگیره. این‌ها تابع‌های معمولی‌اند، نه هوک؛
  // پس بودنشان بعد از returnِ زودهنگام، قانونِ هوک‌ها را نمی‌شکند.
  // نکتهٔ مهم: شنونده‌های window در فازِ capture نصب می‌شوند، چون
  // هندلرهای stopPropagationیِ wrapper (فازِ bubble) وگرنه رویدادِ
  // pointermove را قبل از رسیدن به window متوقف می‌کنند.
  const clampToolbarToViewport = (vx, vy, w, h) => {
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    return {
      x: Math.max(10, Math.min(vx, Math.max(10, vw - w - 10))),
      y: Math.max(10, Math.min(vy, Math.max(10, vh - h - 10))),
    };
  };

  const handleToolbarDragMove = (e) => {
    const d = toolbarDragRef.current;
    if (!d) return;
    const vx = d.origViewportX + (e.clientX - d.pointerX);
    const vy = d.origViewportY + (e.clientY - d.pointerY);
    const c = clampToolbarToViewport(vx, vy, d.w, d.h);
    const next = { x: c.x - d.parentLeft, y: c.y - d.parentTop };
    toolbarPosRef.current = next;
    setToolbarPos(next);
  };
  const handleToolbarDragEnd = (e) => {
    window.removeEventListener('pointermove', handleToolbarDragMove, true);
    window.removeEventListener('pointerup', handleToolbarDragEnd, true);
    window.removeEventListener('pointercancel', handleToolbarDragEnd, true);
    toolbarDragRef.current = null;
    setIsToolbarDragging(false);
    const finalPos = toolbarPosRef.current;
    if (finalPos) {
      try { window.localStorage.setItem('annotationToolbarPosition', JSON.stringify(finalPos)); } catch (_) {}
    }
    if (e && e.currentTarget && typeof e.currentTarget.releasePointerCapture === 'function') {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  };
  const handleToolbarDragStart = (e) => {
    e.stopPropagation();
    e.preventDefault();
    hideTooltip();
    const el = toolbarWrapRef.current;
    const parent = el ? el.offsetParent : null;
    const parentRect = parent ? parent.getBoundingClientRect() : { left: 0, top: 0 };
    const w = el ? el.offsetWidth : 320;
    const h = el ? el.offsetHeight : 60;
    // مبدأ به مختصاتِ viewport: اگر شناور است، از toolbarPos +
    // parentRect؛ وگرنه از rectِ فعلیِ داک.
    let origViewport;
    if (toolbarPos) {
      origViewport = { x: toolbarPos.x + parentRect.left, y: toolbarPos.y + parentRect.top };
    } else if (el) {
      const r = el.getBoundingClientRect();
      origViewport = { x: r.left, y: r.top };
    } else {
      origViewport = { x: 10, y: 10 };
    }
    toolbarDragRef.current = {
      pointerX: e.clientX, pointerY: e.clientY,
      origViewportX: origViewport.x, origViewportY: origViewport.y,
      parentLeft: parentRect.left, parentTop: parentRect.top, w, h,
    };
    toolbarPosRef.current = toolbarPos || null;
    setIsToolbarDragging(true);
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) {}
    window.addEventListener('pointermove', handleToolbarDragMove, true);
    window.addEventListener('pointerup', handleToolbarDragEnd, true);
    window.addEventListener('pointercancel', handleToolbarDragEnd, true);
  };
  const handleToolbarDragReset = (e) => {
    e.stopPropagation();
    try { window.localStorage.removeItem('annotationToolbarPosition'); } catch (_) {}
    toolbarPosRef.current = null;
    setToolbarPos(null);
  };

  // شناور — استایلِ موقعیتِ آزاد (بعد از استایلِ داک می‌آید تا آن را
  // override کند)؛ وقتی null است، داکِ پیش‌فرض برقرار می‌ماند.
  const floatingStyle = toolbarPos
    ? { left: toolbarPos.x, top: toolbarPos.y, right: 'auto', transform: 'none' }
    : {};

  // شناور — دستگیرهٔ درگ: در حالتِ افقی GripVertical، در حالتِ عمودی
  // GripHorizontal (مسیرهای استانداردِ لوسید؛ مثلِ آیکونِ تاگل،
  // به‌صورتِ SVGی خام آمده‌اند تا به Icons.jsx وابسته نباشیم —
  // Icons.jsxی فاز ۱ این دو آیکون را ندارد). دوبارکلیک، تولبار را
  // به داکِ پیش‌فرض برمی‌گرداند.
  const dragHandle = (
    <div
      title="بکشید تا جابه‌جا شود — دوبارکلیک: بازگشت به جای پیش‌فرض"
      onPointerDown={handleToolbarDragStart}
      onDoubleClick={handleToolbarDragReset}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 26,
        height: 26,
        flexShrink: 0,
        color: isToolbarDragging ? '#67e8f9' : 'rgba(255,255,255,0.45)',
        cursor: isToolbarDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {isVertical ? (
          <>
            <circle cx="12" cy="9" r="1" />
            <circle cx="12" cy="15" r="1" />
            <circle cx="5" cy="9" r="1" />
            <circle cx="5" cy="15" r="1" />
            <circle cx="19" cy="9" r="1" />
            <circle cx="19" cy="15" r="1" />
          </>
        ) : (
          <>
            <circle cx="9" cy="12" r="1" />
            <circle cx="9" cy="5" r="1" />
            <circle cx="9" cy="19" r="1" />
            <circle cx="15" cy="12" r="1" />
            <circle cx="15" cy="5" r="1" />
            <circle cx="15" cy="19" r="1" />
          </>
        )}
      </svg>
    </div>
  );

  const orientationToggle = (
    <button
      aria-label={isVertical ? 'تغییر به تولبار افقی' : 'تغییر به تولبار عمودی'}
      onMouseEnter={(e) => showTooltipDelayed(e, isVertical ? 'تغییر به تولبار افقی' : 'تغییر به تولبار عمودی')}
      onMouseLeave={hideTooltip}
      onClick={() => {
        // معماریِ قطعی §۴ — کلمپِ خودکارِ چرخش: فقط وقتی شناور است
        // (داک، ذاتاً داخلِ صفحه است). ابعادِ تقریبیِ تسک: افقی
        // ۶۵۰×۵۰، عمودی ۵۵×۴۵۰. موقعیتِ اصلاح‌شده، بلافاصله در
        // استیت، ref و localStorage ذخیره می‌شود.
        if (toolbarPos) {
          const toVertical = !isVertical;
          let nx = toolbarPos.x;
          let ny = toolbarPos.y;
          if (toVertical) {
            if (ny + 450 > window.innerHeight - 16) ny = Math.max(16, window.innerHeight - 450 - 16);
          } else {
            if (nx + 650 > window.innerWidth - 16) nx = Math.max(16, window.innerWidth - 650 - 16);
          }
          if (nx !== toolbarPos.x || ny !== toolbarPos.y) {
            const next = { x: nx, y: ny };
            setToolbarPos(next);
            toolbarPosRef.current = next;
            try { window.localStorage.setItem('annotationToolbarPosition', JSON.stringify(next)); } catch (_) {}
          }
        }
        if (typeof setToolbarOrientation === 'function') {
          setToolbarOrientation(isVertical ? 'horizontal' : 'vertical');
        }
        // چرخشِ نرمِ ۹۰ درجه حینِ کلیک: آیکون ۹۰ درجه می‌چرخد و بعد از
        // ۲۶۰ میلی‌ثانیه به جای اولش برمی‌گردد، تا گلیفِ نهایی در هر
        // حالت، سرراست بماند (Columns در افقی، Rows در عمودی).
        setToggleSpinning(true);
        window.setTimeout(() => setToggleSpinning(false), 260);
      }}
      style={{
        ...btnBase,
        width: 38,
        height: 38,
        borderRadius: 11,
        background: 'transparent',
        color: 'rgba(255,255,255,0.6)',
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: toggleSpinning ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.25s ease' }}
        aria-hidden="true"
      >
        <rect width="18" height="18" x="3" y="3" rx="2" />
        {isVertical ? <path d="M3 12h18" /> : <path d="M12 3v18" />}
      </svg>
    </button>
  );
  // مرحله ۵ ـ بخش الف — دکمهٔ «خروجی PDF با حاشیه‌نویسی‌ها» دقیقاً
  // قبل از Done (منطقهٔ اقدام‌های پایانی): فقط وقتی onExportAnnotatedPdf
  // داده شده است — در PdfViewer و (از مرحله 44 §4) در EpubViewer و
  // VerticalViewer؛ دکمه، نوعِ فایل را نمی‌سنجد و فقط بودنِ prop را
  // چک می‌کند؛ منطقِ ذخیره در خودِ ویوور است، نه در تولبار. هنگامِ
  // پردازش، غیرفعال و کم‌رنگ است تا کلیکِ تکراری، خروجیِ تکراری نسازد. توجه: برخلافِ

  // Done که دو onMouseEnter دارد (دومی، اولی را خنثی می‌کند و تولتیپِ
  // آن هیچ‌وقت نشان داده نمی‌شود)، اینجا هر دو کار در یک هندلر انجام
  // می‌شود تا هم تولتیپ بیاید و هم هاور.
  // مرحله 5 ـ بخش ب — دو دکمهٔ ذخیرهٔ دوگانه، دقیقاً قبل از Done
  // (منطقهٔ اقدام‌های پایانی): فقط وقتی onExportAnnotatedPdf داده
  // شده است — در PdfViewer و (از مرحله 44 §4) در EpubViewer و
  // VerticalViewer؛ هر دو دکمه، نوعِ فایل را نمی‌سنجند و فقط بودنِ
  // prop را چک می‌کنند. هنگامِ پردازش، هر دو غیرفعال و کم‌رنگ‌اند
  // تا کلیکِ تکراری، خروجیِ تکراری نسازد.

  //  • «ذخیره روی همین فایل» (کهربایی، آیکونِ Save): بدونِ دیالوگ،
  //    روی خودِ فایلِ بازشده می‌نشیند؛ پایهٔ خامِ `.orig.bak`
  //    جلوی پختِ دوباره را می‌گیرد.
  //  • «ذخیره به عنوان فایل جدید» (فیروزه‌ای، آیکونِ Download):
  //    دیالوگِ Save As با نامِ پیش‌فرضِ `<نام>-annotated.pdf`.
  // هر دو دکمه، هر دو کارِ هاور (تولتیپ + حالتِ هاور) را در یک
  // هندلر انجام می‌دهند (الگوی درستِ دکمهٔ خروجیِ بخش الف).
  const inPlaceSaving = pdfSaveState === 'saving-inplace';
  const inPlaceFlashed = saveFlash && pdfSaveState === 'saved-inplace';
  const saveInPlaceButton = typeof onExportAnnotatedPdf === 'function' ? (
    <button
      aria-label="ذخیره روی همین فایل"
      onMouseEnter={(e) => { showTooltipDelayed(e, 'ذخیره روی همین فایل'); setSaveInPlaceHover(true); }}
      onMouseLeave={() => { hideTooltip(); setSaveInPlaceHover(false); }}
      onClick={() => {
        if (isExportingPdf) return;
        onExportAnnotatedPdf('in-place');
      }}
      style={{
        ...btnBase,
        width: 38,
        height: 38,
        borderRadius: 11,
        background: inPlaceFlashed ? '#059669' : 'rgba(251,191,36,0.16)',
        color: inPlaceFlashed ? '#ffffff' : '#fcd34d',
        outline: inPlaceFlashed ? '1px solid rgba(5,150,105,0.9)' : '1px solid rgba(251,191,36,0.45)',
        outlineOffset: -1,
        boxShadow: inPlaceFlashed ? '0 0 16px rgba(5,150,105,0.65)' : (saveInPlaceHover && !isExportingPdf ? '0 0 14px rgba(251,191,36,0.55)' : 'none'),
        opacity: inPlaceFlashed ? 1 : (isExportingPdf ? 0.55 : 1),
        cursor: isExportingPdf ? 'default' : 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      {inPlaceFlashed ? <Icons.Check size={20} /> : inPlaceSaving ? <Icons.Loader size={18} /> : Icons.Save ? <Icons.Save size={18} /> : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
          <path d="M17 21v-8H7v8" />
          <path d="M7 3v5h8" />
        </svg>
      )}
    </button>
  ) : null;
  const saveAsSaving = pdfSaveState === 'saving-as';
  const saveAsFlashed = saveFlash && pdfSaveState === 'saved-as';
  const saveAsButton = typeof onExportAnnotatedPdf === 'function' ? (
    <button
      aria-label="ذخیره به عنوان فایل جدید"
      onMouseEnter={(e) => { showTooltipDelayed(e, 'ذخیره به عنوان فایل جدید'); setSaveAsHover(true); }}
      onMouseLeave={() => { hideTooltip(); setSaveAsHover(false); }}
      onClick={() => {
        if (isExportingPdf) return;
        onExportAnnotatedPdf('save-as');
      }}
      style={{
        ...btnBase,
        width: 38,
        height: 38,
        borderRadius: 11,
        background: saveAsFlashed ? '#059669' : 'rgba(34,211,238,0.16)',
        color: saveAsFlashed ? '#ffffff' : '#67e8f9',
        outline: saveAsFlashed ? '1px solid rgba(5,150,105,0.9)' : '1px solid rgba(34,211,238,0.45)',
        outlineOffset: -1,
        boxShadow: saveAsFlashed ? '0 0 16px rgba(5,150,105,0.65)' : (saveAsHover && !isExportingPdf ? '0 0 14px rgba(34,211,238,0.55)' : 'none'),
        opacity: saveAsFlashed ? 1 : (isExportingPdf ? 0.55 : 1),
        cursor: isExportingPdf ? 'default' : 'pointer',
        transition: 'all 0.2s ease',
      }}
    >
      {saveAsFlashed ? <Icons.Check size={20} /> : saveAsSaving ? <Icons.Loader size={18} /> : Icons.Download ? <Icons.Download size={18} /> : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <path d="M7 10l5 5 5-5" />
          <path d="M12 15V3" />
        </svg>
      )}
    </button>
  ) : null;
  // قطعهٔ واحدِ هر دو دکمه، برای هر دو جهتِ تولبار (افقی/عمودی) —
  // ترتیب، در هر دو جهت: درجا، بعد Save As، بعد Done.
  const exportButtons = (
    <>
      {saveInPlaceButton}
      {saveAsButton}
    </>
  );
  // معماریِ قطعی §۵ — دکمهٔ تأییدِ نهایی (Done) در انتهای نوار:
  // تیکِ لوسید با تمِ سبزِ زمردی (#10b981) و درخششِ هاور. کلیک:
  // لغوِ انتخاب‌های فعال + بستنِ همهٔ پنل‌ها (دراورِ رنگ و زیرمنوی
  // جمع‌شده) + خروج از مودِ ویرایش. آیکون از Icons.Check می‌آید
  // (در Icons.jsxی فاز ۱ موجود است) و اگر نبود، SVGی خامِ لوسید
  // (M20 6 9 17l-5-5) جایگزین می‌شود تا المانِ ناشناخته رندر نشود.
  const doneButton = (
    <button
      aria-label="اتمام ویرایش — لغو انتخاب و خروج از حالت ویرایش"
      onMouseEnter={(e) => { showTooltipDelayed(e, 'اتمام ویرایش'); setDoneHover(true); }}
      onMouseLeave={() => { hideTooltip(); setDoneHover(false); }}
      onClick={() => {
        if (typeof clearSelection === 'function') clearSelection();
        setPanelClosed(false);
        setColorDrawerOpen(false);
        if (typeof setIsAnnotationActive === 'function') setIsAnnotationActive(false);
      }}

      style={{
        ...btnBase,
        width: 38,
        height: 38,
        borderRadius: 11,
        background: 'rgba(16,185,129,0.18)',
        color: '#6ee7b7',
        outline: '1px solid rgba(16,185,129,0.45)',
        outlineOffset: -1,
        boxShadow: doneHover ? '0 0 14px rgba(16,185,129,0.55)' : 'none',
        transition: 'all 0.2s ease',
      }}
    >
      {Icons.Check ? <Icons.Check size={18} /> : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      )}
    </button>
  );
  // فاز ۳ پالت — دراورِ شیشه‌ایِ پالتِ تخصصی. لایهٔ بیرونی فقط
  // موقعیتِ fixed را نگه می‌دارد و لایهٔ درونی، پنلِ شیشه‌ای است
  // (تا انیمیشنِ ورودِ درونی، با transformی موقعیتِ بیرونی تداخل
  // نکند — همان الگوی typoConsoleIn). پنل، stopPropagationی pointer
  // دارد تا کلیک‌هایش به کانتینرِ حاشیه‌نویسی نرسد.
  // Stage 8 Part A (Axis 5): drawerMounted keeps the drawer alive
  // for the 200ms exit animation after colorDrawerOpen closes.
  // مرحلهٔ ۵۸ مأموریتِ ۴: بیشینهٔ ارتفاعِ دراور از فرمولِ مرزِ امن —
  // min(440, vh - 64 - 24) — تا پنل، همیشه بینِ TopBar و لبهٔ
  // پایین جا شود؛ viewportH با resize به‌روز می‌شود، پس این مقدار
  // هم زنده است.
  const drawerMaxHeight = Math.min(440, viewportH - SAFE_TOP - 24);
  const colorDrawer = drawerMounted && colorDrawerPos && (
    <div
      dir="rtl"
      style={{
        position: 'fixed',
        top: colorDrawerPos.top,
        left: colorDrawerPos.left,
        transform: colorDrawerPos.transform,
        zIndex: 40,
        // کانتینرِ بیرونیِ دراور، فقط موقعیت نگه می‌دارد؛ جعبه‌اش
        // دقیقاً همان کارتِ درونی است، ولی طبقِ قانون، صراحتاً none
        // می‌گیرد تا هیچ پیکسلِ اضافه‌ای مسدود نشود.
        pointerEvents: 'none',
      }}
    >
      <div
        ref={colorDrawerRef}
        className="at-color-drawer-scroll"
        style={{
          width: 272,
          maxHeight: drawerMaxHeight,
          pointerEvents: drawerExiting ? 'none' : 'auto',
          // transformOrigin follows the smart flip so the drawer grows
          // out of the bar edge it opened from.
          transformOrigin: colorDrawerPos.above ? '50% 100%' : '50% 0',
          overflowY: 'auto',
          padding: '10px 10px 20px',
          borderRadius: 14,
          background: 'radial-gradient(160px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(34, 211, 238, 0.12), rgba(147, 51, 234, 0.10) 45%, transparent 70%), rgba(10, 15, 24, 0.94)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          userSelect: 'none',
          animation: drawerExiting
            ? (colorDrawerPos.above
              ? 'drawerOutUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
              : 'drawerOutDown 0.2s cubic-bezier(0.16, 1, 0.3, 1)')
            : (colorDrawerPos.above
              ? 'drawerInUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
              : 'drawerInDown 0.2s cubic-bezier(0.16, 1, 0.3, 1)'),
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onMouseMove={handleSpotMove}
        onMouseLeave={handleSpotLeave}
      >
        {/* مرحلهٔ ۵۷ مأموریتِ ۲: پالتِ کلاسیک و استاندارد (همان ۸ رنگِ
            نوارِ سریع) در بالایِ دراور، با دکمهٔ نصبِ خودش. */}
        <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>
              کلاسیک و استاندارد
            </div>
            {paletteInstallButton('default')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {COLORS.map((c) => drawerColorSwatch('classic', c))}
          </div>
        </div>
        {PALETTE_CATEGORIES.map((cat) => (
          <div key={cat.id} style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)' }}>
                {cat.label}
              </div>
              {paletteInstallButton(cat.id)}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {cat.colors.map((c) => {
                const active = annotationColor.toLowerCase() === c.hex.toLowerCase();
                return (
                  <button
                    key={c.hex}
                    title={`${c.label} (${c.hex})`}
                    onMouseEnter={() => setHoverSwatch(`d:${cat.id}:${c.hex}`)}
                    onMouseLeave={() => setHoverSwatch(null)}
                    onClick={() => applyDrawerColor(c.hex)}
                    style={{
                      ...btnBase,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      flexShrink: 0,
                      padding: 0,
                      boxSizing: 'border-box',
                      background: 'transparent',
                      border: 'none',
                      boxShadow: 'none',
                      transform: 'none',
                      transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  >
                    {/* فاز ۴ — Fixed Hitbox (مانند نوار اصلی). */}
                    <span
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                        background: c.hex,
                        border: active
                          ? '1.5px solid rgba(255,255,255,0.85)'
                          : '1px solid rgba(255,255,255,0.25)',
                        boxShadow: active ? `inset 0 0 0 999px rgba(0, 0, 0, 0.35), 0 0 0 2px #ffffff, 0 0 10px ${c.hex}` : hoverSwatch === `d:${cat.id}:${c.hex}` ? `0 6px 14px ${c.hex}` : 'none',
                        transform: hoverSwatch === `d:${cat.id}:${c.hex}` ? 'scale(1.16) translateY(-2px)' : 'scale(1)',
                        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    >
                      {active && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', pointerEvents: 'none' }}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)', flex: 1 }}>
              رنگ‌های من
            </div>
            <button
              type="button"
              title="افزودن رنگِ فعلی به نوار ابزار"
              onClick={addCurrentColorToStrip}
              style={{ ...btnBase, width: 22, height: 22, borderRadius: '50%', flexShrink: 0, background: 'transparent', border: '1px dashed rgba(255,255,255,0.4)', color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 1, cursor: 'pointer' }}
            >
              +
            </button>
            {paletteInstallButton('favorites')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {favoriteColors.map((hex) => {
              const active = annotationColor.toLowerCase() === hex.toLowerCase();
              const hovered = hoverUserHex === hex;
              return (
                <div key={hex} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <button
                    title={hex}
                    onClick={() => applyDrawerColor(hex)}
                    onContextMenu={(e) => { e.preventDefault(); removeFavoriteColor(hex); }}
                    onMouseEnter={() => { setHoverUserHex(hex); setHoverSwatch(`u:${hex}`); }}
                    onMouseLeave={() => { setHoverUserHex(null); setHoverSwatch(null); }}
                    style={{
                      ...btnBase,
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      flexShrink: 0,
                      padding: 0,
                      boxSizing: 'border-box',
                      background: 'transparent',
                      border: 'none',
                      boxShadow: 'none',
                      transform: 'none',
                      transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  >
                    {/* فاز ۴ — Fixed Hitbox (مانند نوار اصلی). */}
                    <span
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        pointerEvents: 'none',
                        background: hex,
                        border: active
                          ? '1.5px solid rgba(255,255,255,0.85)'
                          : '1px solid rgba(255,255,255,0.25)',
                        boxShadow: active ? `inset 0 0 0 999px rgba(0, 0, 0, 0.35), 0 0 0 2px #ffffff, 0 0 10px ${hex}` : hoverSwatch === `u:${hex}` ? `0 6px 14px ${hex}` : hovered ? `0 0 10px ${hex}` : 'none',
                        transform: hoverSwatch === `u:${hex}` ? 'scale(1.16) translateY(-2px)' : 'scale(1)',
                        transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      }}
                    >
                      {active && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.85))', pointerEvents: 'none' }}>
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </span>
                  </button>
                  {isEditingStrip && (
                    <button
                      type="button"
                      title={`حذف ${hex} از رنگ‌های من`}
                      onClick={(e) => { e.stopPropagation(); removeFavoriteColor(hex); }}
                      style={{ position: 'absolute', top: -7, left: -7, width: 16, height: 16, borderRadius: '50%', background: '#f43f5e', color: '#ffffff', border: '1px solid rgba(255,255,255,0.7)', fontSize: 11, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, zIndex: 1 }}
                    >
                      ×
                    </button>
                  )}
                  <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono', monospace", color: hovered ? '#ffffff' : 'rgba(255,255,255,0.5)', direction: 'ltr' }}>
                    {hex}
                  </span>
                </div>
              );
            })}
            <button
              title="افزودن رنگ دلخواه"
              onClick={() => { if (colorInputRef.current) colorInputRef.current.click(); }}
              style={{
                ...btnBase,
                width: 24,
                height: 24,
                borderRadius: '50%',
                flexShrink: 0,
                background: 'transparent',
                border: '1px dashed rgba(255,255,255,0.4)',
                color: 'rgba(255,255,255,0.75)',
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              +
            </button>
            <input
              ref={colorInputRef}
              type="color"
              value={annotationColor}
              onChange={(e) => addUserColor(e.target.value)}
              style={{ display: 'none' }}
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              type="button"
              title="ذخیرهٔ رنگِ فعلی در رنگ‌هایِ موردِ علاقه"
              onClick={saveCurrentFavoriteColor}
              style={{ ...btnBase, height: 24, padding: '0 8px', borderRadius: 12, background: 'rgba(34,211,238,0.14)', border: '1px solid rgba(34,211,238,0.45)', color: '#67e8f9', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0, cursor: 'pointer' }}
            >
              + ذخیرهٔ رنگِ فعلی
            </button>
          </div>
          {favoriteColors.length === 0 && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
              هنوز رنگی ذخیره نشده؛ با + یک رنگِ دلخواه اضافه کنید یا رنگِ فعلی را ذخیره کنید (حداکثر ۴۸ رنگ، با پشتیبانِ دیتابیس). برایِ حذفِ یک رنگ، رویِ آن کلیکِ راست کنید.
            </div>
          )}
        </div>

        {/* مرحلهٔ ۳۹ §۳: تمپلیت‌هایِ رنگیِ من (پالت‌هایِ سفارشی) */}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
            تمپلیت‌هایِ رنگیِ من
          </div>
          {customColorTemplates.length === 0 && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              هنوز تمپلیتی نساخته‌اید؛ رنگ‌هایِ موردِ علاقه‌تان را در یک تمپلیت با نامِ دلخواه ذخیره کنید.
            </div>
          )}
          {customColorTemplates.map((t) => (
            <Fragment key={t.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <button
                type="button"
                title="اعمالِ این تمپلیت در نوارِ سریع"
                onClick={() => activatePalette(`template:${t.id}`)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, background: activePaletteId === `template:${t.id}` ? 'rgba(34,211,238,0.14)' : 'transparent', border: activePaletteId === `template:${t.id}` ? '1px solid rgba(34,211,238,0.5)' : '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, textAlign: 'right' }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                <span style={{ display: 'flex', gap: 3, marginRight: 'auto', flexShrink: 0 }}>
                  {t.colors.slice(0, 6).map((hex) => (
                    <span key={hex} style={{ width: 14, height: 14, borderRadius: '50%', background: hex, border: '1px solid rgba(255,255,255,0.3)' }} />
                  ))}
                </span>
              </button>
              {paletteInstallButton(`template:${t.id}`)}
              <button
                type="button"
                title="ویرایشِ نام و رنگ‌هایِ تمپلیت"
                onClick={() => startEditingTemplate(t)}
                style={{ ...btnBase, height: 24, padding: '0 8px', borderRadius: 12, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', fontSize: 11, fontFamily: 'inherit', flexShrink: 0, cursor: 'pointer' }}
              >
                ویرایش
              </button>
              <button
                type="button"
                title="حذفِ تمپلیت"
                onClick={() => { if (editingTemplateId === t.id) setEditingTemplateId(null); deleteCustomColorTemplate(t.id); }}
                style={{ ...btnBase, width: 24, height: 24, borderRadius: '50%', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.7)', fontSize: 13, flexShrink: 0, cursor: 'pointer' }}
              >
                ×
              </button>
            </div>
            {editingTemplateId === t.id && (
              <div style={{ marginBottom: 8, padding: 8, border: '1px solid rgba(34,211,238,0.35)', borderRadius: 10, background: 'rgba(34,211,238,0.06)' }}>
                <input
                  type="text"
                  value={editingTemplateName}
                  onChange={(e) => setEditingTemplateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); saveEditingTemplate(); }
                    else if (e.key === 'Escape') { setEditingTemplateId(null); }
                  }}
                  placeholder="نامِ تمپلیت…"
                  autoFocus
                  style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, padding: '6px 8px' }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '8px 0', alignItems: 'center' }}>
                  {editingTemplateColors.map((hex) => (
                    <span key={hex} style={{ position: 'relative', display: 'inline-flex' }}>
                      <span title={hex} style={{ width: 22, height: 22, borderRadius: '50%', background: hex, border: '1px solid rgba(255,255,255,0.3)', display: 'inline-block' }} />
                      <button
                        type="button"
                        title={`حذف ${hex} از تمپلیت`}
                        onClick={() => setEditingTemplateColors(editingTemplateColors.filter((x) => x !== hex))}
                        style={{ position: 'absolute', top: -6, left: -6, width: 16, height: 16, borderRadius: '50%', background: '#f43f5e', color: '#ffffff', border: '1px solid rgba(255,255,255,0.7)', fontSize: 11, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <button
                    type="button"
                    title="افزودن رنگِ فعلی به این تمپلیت"
                    onClick={() => {
                      const c = annotationColor;
                      if (/^#[0-9a-fA-F]{6}$/.test(c) && !editingTemplateColors.some((x) => x.toLowerCase() === c.toLowerCase()) && editingTemplateColors.length < 12) {
                        setEditingTemplateColors([...editingTemplateColors, c]);
                      }
                    }}
                    style={{ ...btnBase, height: 24, padding: '0 8px', borderRadius: 12, background: 'rgba(34,211,238,0.14)', border: '1px solid rgba(34,211,238,0.45)', color: '#67e8f9', fontSize: 11, fontWeight: 700, fontFamily: 'inherit', flexShrink: 0, cursor: 'pointer' }}
                  >
                    + رنگِ فعلی
                  </button>
                </div>
                {editingTemplateColors.length === 0 && (
                  <div style={{ fontSize: 11, color: '#fca5a5', marginBottom: 6 }}>تمپلیت بدونِ رنگ ذخیره نمی‌شود؛ اول یک رنگ اضافه کن.</div>
                )}
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => { if (editingTemplateColors.length > 0) saveEditingTemplate(); }}
                    style={{ ...btnBase, height: 28, padding: '0 10px', borderRadius: 8, background: 'rgba(34,211,238,0.16)', border: '1px solid rgba(34,211,238,0.5)', color: '#67e8f9', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', opacity: editingTemplateColors.length > 0 ? 1 : 0.5 }}
                  >
                    ثبت
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTemplateId(null)}
                    style={{ ...btnBase, height: 28, padding: '0 10px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.8)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}
                  >
                    لغو
                  </button>
                </div>
              </div>
            )}
            </Fragment>
          ))}
          {isCreatingTemplate ? (
            <div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  type="text"
                  value={newTemplateName}
                  onChange={(e) => { setNewTemplateName(e.target.value); setTemplateFormError(''); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      saveColorTemplate();
                    } else if (e.key === 'Escape') {
                      setIsCreatingTemplate(false);
                      setTemplateFormError('');
                    }
                  }}
                  placeholder="نامِ تمپلیت…"
                  autoFocus
                  style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, color: 'var(--text)', fontFamily: 'inherit', fontSize: 12, padding: '6px 8px' }}
                />
                <button
                  type="button"
                  onClick={saveColorTemplate}
                  style={{ ...btnBase, height: 28, padding: '0 10px', borderRadius: 8, background: 'rgba(34,211,238,0.16)', border: '1px solid rgba(34,211,238,0.5)', color: '#67e8f9', fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}
                >
                  ثبت
                </button>
                <button
                  type="button"
                  onClick={() => { setIsCreatingTemplate(false); setNewTemplateName(''); setTemplateFormError(''); }}
                  style={{ ...btnBase, height: 28, padding: '0 10px', borderRadius: 8, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.8)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}
                >
                  لغو
                </button>
              </div>
              {templateFormError ? (
                <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 6, lineHeight: 1.7 }}>{templateFormError}</div>
              ) : null}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => { setNewTemplateName(suggestTemplateName()); setTemplateFormError(''); setIsCreatingTemplate(true); }}
              style={{ ...btnBase, height: 28, padding: '0 10px', borderRadius: 8, background: 'transparent', border: '1px dashed rgba(255,255,255,0.35)', color: 'rgba(255,255,255,0.8)', fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}
            >
              + ساخت تمپلیتِ رنگیِ جدید
            </button>
          )}
        </div>

        {/* مرحلهٔ ۳۹ §۳: انتخابگرِ پیشرفتهٔ رنگ (چرخِ رنگ + هگز + HSL + قطره‌چکان) */}
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
            انتخابگرِ پیشرفته
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(annotationColor) ? annotationColor : '#06b6d4'}
              onChange={(e) => applyPickerColor(e.target.value)}
              style={{ width: 30, height: 30, padding: 0, border: '1px solid rgba(255,255,255,0.25)', borderRadius: 8, background: 'transparent', cursor: 'pointer', flexShrink: 0 }}
            />
            <input
              type="text"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => { if (/^#[0-9a-fA-F]{6}$/.test(hexDraft.trim())) applyPickerColor(hexDraft.trim().toLowerCase()); else setHexDraft(annotationColor); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (/^#[0-9a-fA-F]{6}$/.test(hexDraft.trim())) applyPickerColor(hexDraft.trim().toLowerCase());
                  e.target.blur();
                }
              }}
              placeholder="#RRGGBB"
              dir="ltr"
              style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 8, color: 'var(--text)', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, padding: '6px 8px', textAlign: 'left' }}
            />
            {typeof window !== 'undefined' && window.EyeDropper && (
              <button
                type="button"
                title="قطره‌چکان (انتخابِ رنگ از صفحه)"
                onClick={async () => {
                  try {
                    const eye = new window.EyeDropper();
                    const r = await eye.open();
                    if (r && r.sRGBHex) applyPickerColor(r.sRGBHex.toLowerCase());
                  } catch (_) {}
                }}
                style={{ ...btnBase, height: 30, padding: '0 10px', borderRadius: 8, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)', fontSize: 12, fontFamily: 'inherit', flexShrink: 0, cursor: 'pointer' }}
              >
                قطره‌چکان
              </button>
            )}
          </div>
          {(() => {
            const hsl = hexToHsl(annotationColor);
            const setHsl = (nextPatch) => {
              const next = { ...hsl, ...nextPatch };
              applyPickerColor(hslToHex(next.h, next.s, next.l));
            };
            const sliderRow = (label, value, min, max, onChange) => (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, color: 'rgba(255,255,255,0.6)', marginBottom: 2 }}>
                <span style={{ width: 14, flexShrink: 0 }}>{label}</span>
                <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, accentColor: '#22d3ee' }} />
                <span style={{ width: 24, textAlign: 'left', color: 'var(--text)', direction: 'ltr' }}>{value}</span>
              </label>
            );
            return (
              <div>
                {sliderRow('H', hsl.h, 0, 360, (v) => setHsl({ h: v }))}
                {sliderRow('S', hsl.s, 0, 100, (v) => setHsl({ s: v }))}
                {sliderRow('L', hsl.l, 0, 100, (v) => setHsl({ l: v }))}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );

  // Stage 8 Part A (Axes 3+5): smart flip + animated flyout cards.
  // The flip decision uses the bar's anchor point (floating y, or the
  // docked top 26) against the viewport middle; the card then opens
  // toward the roomier half so it is never clipped by the monitor edge.
  const flyoutBelow = (toolbarPos ? toolbarPos.y : 26) + 26 < viewportH / 2;
  const flyoutGlass = {
    borderRadius: 16,
    background: 'radial-gradient(160px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(34, 211, 238, 0.12), rgba(147, 51, 234, 0.10) 45%, transparent 70%), rgba(8, 12, 16, 0.92)',
    border: `1px solid ${withAlpha(annotationColor, 0.35)}`,
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
    backdropFilter: 'blur(16px)',
    WebkitBackdropFilter: 'blur(16px)',
    userSelect: 'none',
  };
  const verticalFlyoutCard = flyoutMounted && (
    <div
      dir="rtl"
      style={{
        ...flyoutGlass,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        pointerEvents: flyoutExiting ? 'none' : shellPointerEvents,
        alignSelf: 'flex-start',
        animation: flyoutExiting
          ? 'submenuOut 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
          : 'submenuIn 0.25s ease',
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto',
        scrollbarWidth: 'none',
      }}
      onMouseMove={handleSpotMove}
      onMouseLeave={handleSpotLeave}
    >
      {secondaryContent}
    </div>
  );
  const horizontalFlyoutCard = flyoutMounted && (
    <div
      dir="rtl"
      style={{
        ...flyoutGlass,
        display: 'flex',
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
        pointerEvents: flyoutExiting ? 'none' : shellPointerEvents,
        alignSelf: 'center',
        maxWidth: 'calc(100vw - 24px)',
        maxHeight: 'calc(100vh - 120px)',
        overflowX: 'auto',
        overflowY: 'auto',
        scrollbarWidth: 'none',
        animation: flyoutExiting
          ? (flyoutBelow
            ? 'flyoutOutDown 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            : 'flyoutOutUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)')
          : (flyoutBelow
            ? 'flyoutInDown 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            : 'flyoutInUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'),
      }}
      onMouseMove={handleSpotMove}
      onMouseLeave={handleSpotLeave}
    >
      {secondaryContent}
    </div>
  );

  return (
    <>
      {/* گام ۲ میانی: keyframesی ورودِ کنسولِ فونت. ترنزیشنِ CSS روی المانی
          که تازه mount شده اجرا نمی‌شود (مقدارِ اولیه همان مقدارِ نهایی
          است)، پس ورودِ دقیقِ خواسته‌شده (opacity ‏0 به 1 و
          translateY(4px) scale(0.97) به none) با keyframes پیاده شد؛ بدونِ
          دست زدن به width/margin و بدونِ لمسِ transformی ریشه که مرکزچینی
          (translateX(-50%)) را نگه می‌دارد. */}
      <style>{`@keyframes typoConsoleIn { from { opacity: 0; transform: translateY(4px) scale(0.97); } to { opacity: 1; transform: none; } } @keyframes submenuIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } } @keyframes submenuOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(4px) scale(0.97); } } @keyframes flyoutInDown { from { opacity: 0; transform: translateY(-6px) scale(0.96); } to { opacity: 1; transform: none; } } @keyframes flyoutOutDown { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-6px) scale(0.96); } } @keyframes flyoutInUp { from { opacity: 0; transform: translateY(6px) scale(0.96); } to { opacity: 1; transform: none; } } @keyframes flyoutOutUp { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(6px) scale(0.96); } } @keyframes drawerInDown { from { opacity: 0; transform: translateY(-6px) scale(0.97); } to { opacity: 1; transform: none; } } @keyframes drawerOutDown { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(-6px) scale(0.97); } } @keyframes drawerInUp { from { opacity: 0; transform: translateY(6px) scale(0.97); } to { opacity: 1; transform: none; } } @keyframes drawerOutUp { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateY(6px) scale(0.97); } } .at-pill { transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.2s ease; } .at-pill:hover { transform: scale(1.06); filter: brightness(1.3); } .at-range { transition: filter 0.2s ease; } .at-range:hover { filter: drop-shadow(0 0 6px rgba(34, 211, 238, 0.6)); }`}</style>
      {isVertical ? (
        // پولیش: حالتِ عمودی — یک قابِ wrap که کلِ مجموعه را در سمتِ راست
        // و وسطِ ارتفاع نگه می‌دارد (position/top/right/transform دقیقاً
        // طبقِ تسک)؛ داخلش فلای‌اوت (سمتِ چپ، به داخلِ صفحه) + داکِ ستونی.
        // فلای‌اوت، خواهرِ داک است (نه فرزندِ آن) تا overflowی داک، آن را
        // نبرد — برای همین wrap، خودش هندلرهای stopPropagation را دارد.
        <div
          dir="ltr"
          ref={toolbarWrapRef}
          style={{
            position: 'absolute',
            top: '50%',
            right: '18px',
            transform: 'translateY(-50%)',
            ...floatingStyle,
            zIndex: 30,
            // کالبدشکافیِ شیشهٔ نامرئی: این wrapِ flex، جعبه‌اش به
            // اندازهٔ بلندترین فرزند × مجموعِ عرض‌هاست؛ پس وقتی
            // فلای‌اوت کوتاه‌تر از داکِ ستونی است، فضای خالیِ بالا/
            // پایینِ فلای‌اوت و نوارِ gapِ ۱۰ پیکسلی، داخلِ جعبهٔ
            // wrap می‌افتند و با pointer-eventsِ پیش‌فرضِ auto،
            // رویدادِ آن ناحیه‌ها را می‌بلعیدند (دقیقاً علامتِ
            // گزارش‌شده: مسدود شدنِ فضای بالا و پایینِ پنل، نه
            // خودِ پنل). حالا wrap، none است و فقط پوسته‌های مرئی،
            // auto می‌گیرند؛ stopPropagationهای روی wrap، از طریقِ
            // حباب از فرزندان همچنان کار می‌کنند، پس کلیکِ روی
            // دکمه‌ها هرگز به صفحه نمی‌رسد.
            pointerEvents: 'none',
            display: 'flex',
            // معماریِ قطعی §۱ — آینه‌ای: فلای‌اوت، خواهرِ flexیِ داک
            // است (نه absolute)، پس آینه‌ای شدن یعنی وارونه شدنِ
            // ترتیبِ ردیف: داک در نیمهٔ چپ → فلای‌اوت سمتِ راستِ داک
            // (به سمتِ مرکز)؛ داک در نیمهٔ راست → فلای‌اوت سمتِ چپ.
            flexDirection: isDockOnLeft ? 'row-reverse' : 'row',
            gap: 10,
            alignItems: 'flex-start',
            transition: isToolbarDragging ? 'none' : 'transform 0.25s ease, top 0.25s ease, left 0.25s ease, right 0.25s ease, opacity 0.3s ease',
            opacity: toolbarIdle ? 0.72 : 1,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseMove={handleSpotMove}
          onMouseEnter={handleToolbarEnter}
          onMouseLeave={(e) => { handleSpotLeave(e); handleToolbarLeave(); }}
        >
          {verticalFlyoutCard}
          <div
            dir="rtl"
            ref={toolsWrapRef}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              pointerEvents: shellPointerEvents,
              position: 'relative',
              borderRadius: 16,
              background: 'radial-gradient(160px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(34, 211, 238, 0.12), rgba(147, 51, 234, 0.10) 45%, transparent 70%), rgba(8, 12, 16, 0.92)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              userSelect: 'none',
              maxHeight: 'calc(100vh - 120px)',
              overflowY: 'auto',
              scrollbarWidth: 'none',
            }}
            onMouseMove={handleSpotMove}
            onMouseLeave={handleSpotLeave}
          >
            {toolGlow}
            {dragHandle}
            {toolsButtons}
            {divider}
            {actionsContent}
            {orientationToggle}
            {exportButtons}
            {doneButton}
          </div>
        </div>
      ) : (
        <div
          dir="rtl"
          ref={toolbarWrapRef}
          style={{
            position: 'absolute',
            top: 26,
            left: '50%',
            transform: 'translateX(-50%)',
            ...floatingStyle,
            zIndex: 30,
            // Stage 8 Part A (Axis 3): hitbox isolation, exactly like
            // the vertical wrap — the wrapper is none, only the
            // capsule and the flyout card are auto, so the empty
            // space left/right of the card never blocks drawing.
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 8,
            maxWidth: 'calc(100% - 24px)',
            transition: isToolbarDragging ? 'none' : 'transform 0.25s ease, top 0.25s ease, left 0.25s ease, right 0.25s ease, opacity 0.3s ease',
            opacity: toolbarIdle ? 0.72 : 1,
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseMove={handleSpotMove}
          onMouseEnter={handleToolbarEnter}
          onMouseLeave={(e) => { handleSpotLeave(e); handleToolbarLeave(); }}
        >
          {!flyoutBelow && horizontalFlyoutCard}
          <div
            dir="rtl"
            ref={toolsWrapRef}
            style={{
              pointerEvents: shellPointerEvents,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              borderRadius: 16,
              background: 'radial-gradient(160px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(34, 211, 238, 0.12), rgba(147, 51, 234, 0.10) 45%, transparent 70%), rgba(8, 12, 16, 0.92)',
              border: `1px solid ${withAlpha(annotationColor, 0.35)}`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              userSelect: 'none',
              maxWidth: 'calc(100vw - 24px)',
              overflowX: 'auto',
              scrollbarWidth: 'none',
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerMove={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onMouseMove={handleSpotMove}
            onMouseEnter={handleToolbarEnter}
            onMouseLeave={(e) => { handleSpotLeave(e); handleToolbarLeave(); }}
          >
          {toolGlow}
          {dragHandle}
          {toolsButtons}

          {divider}
          {actionsContent}
          {orientationToggle}
          {exportButtons}
          {doneButton}
          </div>
          {flyoutBelow && horizontalFlyoutCard}
        </div>
      )}
      {colorDrawer}
      {toolDrag && dragGhostTool && (
        <div
          style={{
            position: 'fixed',
            left: toolDrag.x,
            top: toolDrag.y,
            transform: 'translate(-50%, -50%) scale(1.08)',
            width: 38,
            height: 38,
            borderRadius: 11,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(34, 211, 238, 0.25)',
            color: '#67e8f9',
            outline: '1.5px solid #22d3ee',
            outlineOffset: -1,
            boxShadow: '0 0 16px rgba(34, 211, 238, 0.65)',
            opacity: 0.92,
            pointerEvents: 'none',
            zIndex: 70,
          }}
        >
          <dragGhostTool.Icon size={18} />
        </div>
      )}
      {tooltip && (
        <div
          dir="rtl"
          style={{
            position: 'fixed',
            left: tooltip.left,
            top: tooltip.top,
            transform: tooltip.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
            zIndex: 60,
            pointerEvents: 'none',
            padding: '5px 10px',
            borderRadius: 10,
            background: 'rgba(10, 15, 24, 0.92)',
            border: '1px solid rgba(255,255,255,0.14)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            color: 'rgba(255,255,255,0.9)',
            fontSize: 12,
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}
        >
          {tooltip.text}
        </div>
      )}
    </>
  );

}

export default AnnotationToolbar;
