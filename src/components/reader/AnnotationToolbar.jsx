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

import { useCallback, useEffect, useRef, useState } from 'react';
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
  { hex: '#facc15', label: 'زرد' },
  { hex: '#22d3ee', label: 'فیروزه‌ای' },
  { hex: '#4ade80', label: 'سبز' },
  { hex: '#fb7185', label: 'قرمز' },
  { hex: '#c084fc', label: 'بنفش' },
  { hex: '#fb923c', label: 'نارنجی' },
  { hex: '#f8fafc', label: 'سفید' },
  { hex: '#0f172a', label: 'مشکی' },
];

const SIZES = [1, 2, 4, 7, 11];

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
      { hex: '#facc15', label: 'زرد فسفری' },
      { hex: '#4ade80', label: 'سبز نئون' },
      { hex: '#22d3ee', label: 'آبی فیروزه‌ای' },
      { hex: '#f43f5e', label: 'سرخابی نئون' },
      { hex: '#fb923c', label: 'نارنجی فسفری' },
    ],
  },
  {
    id: 'cyberpunk',
    label: 'سایبرپانک و دارک',
    colors: [
      { hex: '#00f2fe', label: 'فیروزه‌ای درخشان' },
      { hex: '#d946ef', label: 'ماژنتا نئون' },
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
const FONT_OPTIONS = [
  { id: "'Estedad', sans-serif", label: 'استعداد' },
  { id: "'Manrope', sans-serif", label: 'منروپ' },
  { id: "'JetBrains Mono', monospace", label: 'مونو' },
];

// ============================================================================
// Refinement Step 2: میانبرهای ابزار، خوانده‌شده از استورِ تنظیمات.
// قرارداد: اگر کاربر در تنظیمات، ورودی‌ای برای ابزارِ استودیو تعریف
// کرده باشد (کلیدهایی با شناسه‌های toolSelect/toolPen/toolBox/
// toolArrow/toolText/toolSticky/toolHighlighter/toolEraser، هر کدام با
// فیلدِ key یا code)، همان کلید استفاده می‌شود؛ وگرنه به نگاشتِ
// پیش‌فرض (V/P/B/A/T/N/H/E، همان STUDIO_TOOL_HOTKEYSی useKeyboard)
// برمی‌گردیم. توجه: در حالِ حاضر، DEFAULT_SHORTCUTSی تنظیمات هیچ
// ورودیِ ابزارِ استودیو ندارد، پس در عمل نگاشتِ پیش‌فرض اعمال
// می‌شود و این تابع، سازگاریِ رو به جلو برای وقتی است که کاربر
// چنین میانبرهایی را در تنظیمات تعریف کند. این تابع عمداً در هر
// keydown از getState خوانده می‌شود تا تغییرِ تنظیمات بدونِ
// ری‌ماونتِ تولبار اعمال شود.
// ============================================================================
const DEFAULT_STUDIO_TOOL_KEYS = {
  select: 'v',
  pen: 'p',
  box: 'b',
  arrow: 'a',
  text: 't',
  sticky: 'n',
  highlighter: 'h',
  eraser: 'e',
};
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
export function resolveStudioToolHotkeys() {
  const out = { ...DEFAULT_STUDIO_TOOL_KEYS };
  try {
    const settingsState = typeof useSettingsStore.getState === 'function'
      ? useSettingsStore.getState()
      : null;
    const shortcuts = settingsState?.shortcuts || null;
    if (shortcuts) {
      for (const [toolId, settingId] of Object.entries(STUDIO_TOOL_SETTING_IDS)) {
        const entry = shortcuts[settingId];
        if (!entry) continue;
        if (typeof entry.key === 'string' && entry.key.length === 1) {
          out[toolId] = entry.key.toLowerCase();
        } else if (typeof entry.code === 'string' && entry.code.startsWith('Key')) {
          out[toolId] = entry.code.slice(3).toLowerCase();
        }
      }
    }
  } catch (_) {
    // اگر استورِ تنظیمات در دسترس نبود، نگاشتِ پیش‌فرض می‌ماند.
  }
  return out;
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
} = {}) {
  const isAnnotationActive = useAppStore((s) => Boolean(s.isAnnotationActive));
  const annotationTool = useAppStore((s) => s.annotationTool || 'pen');
  const setAnnotationTool = useAppStore((s) => s.setAnnotationTool);
  const annotationColor = useAppStore((s) => s.annotationColor || '#22d3ee');
  const setAnnotationColor = useAppStore((s) => s.setAnnotationColor);
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

  // فاز ۳ پالت — همهٔ هوک‌های دراور، این‌جا و قبل از returnِ
  // زودهنگام‌اند (قانونِ هوک‌های ری‌اکت): وضعیتِ باز بودن، موقعیتِ
  // ثابتِ دراور (با اندازه‌گیریِ دکمه در لحظهٔ باز شدن)، پالتِ شخصی،
  // و refهای دکمه/پنل/ورودیِ رنگ برای بستن با کلیکِ بیرونی.
  const [colorDrawerOpen, setColorDrawerOpen] = useState(false);
  const [colorDrawerPos, setColorDrawerPos] = useState(null);
  const [userPalette, setUserPalette] = useState(() => {
    try {
      const rawPalette = window.localStorage.getItem('annotationUserPalette');
      if (!rawPalette) return [];
      const arr = JSON.parse(rawPalette);
      if (!Array.isArray(arr)) return [];
      return arr.filter((c) => typeof c === 'string').slice(0, 4);
    } catch (_) {
      return [];
    }
  });
  const paletteBtnRef = useRef(null);
  const colorDrawerRef = useRef(null);
  const colorInputRef = useRef(null);
  // فاز ۳ پالت — پایداریِ پالتِ شخصی در localStorage.
  useEffect(() => {
    try {
      window.localStorage.setItem('annotationUserPalette', JSON.stringify(userPalette));
    } catch (_) {
      // حافظهٔ محلی در دسترس نیست؛ پالت فقط تا رفرش می‌ماند.
    }
  }, [userPalette]);
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
  // نوارِ افقی، آن را نبرد)؛ پس هر اسکرول یا تغییرِ اندازهٔ پنجره،
  // مختصاتش را کهنه می‌کند. به‌جای دنبال کردنِ مختصات، دراور بسته
  // می‌شود — ارزان، قابلِ پیش‌بینی، و بدونِ شنوندهٔ پرهزینهٔ حرکت.
  useEffect(() => {
    if (!colorDrawerOpen) return undefined;
    const close = () => setColorDrawerOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [colorDrawerOpen]);

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
  // بستنِ پنل با دوبار کلیک، فقط وقتی ابزار عوض شود یا انتخابی
  // تازه ظاهر شود، ریست می‌شود (تغییرِ ابزار از راهِ کیبورد را هم
  // پوشش می‌دهد، چون کلیک‌هنلدر فقط کلیک‌ها را می‌بیند).
  useEffect(() => { setPanelClosed(false); }, [annotationTool]);
  useEffect(() => { if (hasSelection) setPanelClosed(false); }, [hasSelection]);
  // بسته شدنِ دراورِ رنگ وقتی پنلِ فرعی پنهان می‌شود (دکمهٔ پالت
  // خودش داخلِ همان پنل است، پس دراورِ باز، بی‌صاحب می‌ماند).
  // فرمول، همان showSecondary است که پایین‌تر تعریف می‌شود.
  useEffect(() => {
    if (!((annotationTool !== 'select' || hasSelection) && !panelClosed)) setColorDrawerOpen(false);
  }, [annotationTool, hasSelection, panelClosed]);
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
  const [hoverUserHex, setHoverUserHex] = useState(null);
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  const setIsAnnotationActive = useAppStore((s) => s.setIsAnnotationActive);
  const clearSelection = useAppStore((s) => s.clearSelection);
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

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
  // - فقط کلیدهایی که در نگاشتِ ابزار (resolveStudioToolHotkeys)
  //   هستند مهار می‌شوند؛ بقیهٔ کلیدها کاملاً آزاد می‌مانند (بدونِ
  //   preventDefault و بدونِ stopPropagation) تا به ناوبری یا جستجو
  //   برسند.
  // - تشخیصِ توالیِ تایپ (Typing Sequence Detection): با
  //   lastCharTimeRef، زمانِ آخرین کلیدِ کاراکتری ثبت می‌شود؛ اگر
  //   کلیدِ جدید کمتر از ۱۰۰۰ میلی‌ثانیه بعد از کلیدِ کاراکتریِ
  //   قبلی فشرده شود، به‌عنوانِ تایپِ کلمه/جستجو تفسیر می‌شود و
  //   تعویضِ ابزار لغو می‌گردد (بدونِ مهارِ رویداد، تا کلید به
  //   فیلدِ متنی یا جستجو برسد).
  //   ⚠️ بده‌بستانِ مشخصات: همین قانون، تعویضِ سریعِ پشتِ سرِ همِ
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
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;
      // Ctrl+Z / Ctrl+Y: فقط یک بار Undo/Redo، بدونِ رسیدن به PdfViewer.
      if (e.ctrlKey || e.metaKey) {
        const k = (e.key || '').toLowerCase();
        if (k === 'z' || k === 'y') {
          if (typeof onUndo !== 'function' && typeof onRedo !== 'function') return;
          e.preventDefault();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          } else if (typeof e.stopPropagation === 'function') {
            e.stopPropagation();
          }
          if (k === 'z') {
            if (e.shiftKey) {
              doRedo(); // Ctrl+Shift+Z → Redo
            } else {
              doUndo(); // Ctrl+Z → Undo
            }
          } else {
            doRedo(); // Ctrl+Y → Redo
          }
          return;
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
      const hotkeys = resolveStudioToolHotkeys();
      const toolByKey = {};
      for (const [toolId, key] of Object.entries(hotkeys)) {
        toolByKey[key] = toolId;
      }
      const tool = toolByKey[k];
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
  // میکروانیمیشن‌ها §۲ و §۳ — نمایان بودنِ پنلِ فرعی: وقتی ابزار،
  // انتخاب نیست، یا در حالتِ انتخاب، آیتمی انتخاب شده، و پنل با
  // دوبار کلیک بسته نشده باشد. در غیر این صورت، فقط داکِ جمع‌وجور
  // دیده می‌شود (ابزارها + بازگردانی + جهت + Done).
  const showSecondary = (annotationTool !== 'select' || hasSelection) && !panelClosed;
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
  const toolsButtons = (
    <>
      {/* ابزارها */}
      {TOOLS.map(({ id, label, Icon, danger }) => {
        const active = activeId === id;
        return (
          <button
            key={id}
            aria-label={label}
            onMouseEnter={(e) => {
              setHoverToolId(id);
              positionToolGlow(e.currentTarget);
              showTooltipDelayed(e, label);
            }}
            onMouseLeave={() => {
              setHoverToolId(null);
              hideToolGlow();
              hideTooltip();
            }}
            onClick={() => {
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
    const h = hex.toLowerCase();
    // تازه‌ترین، اول؛ تکراری، جابه‌جا می‌شود (نه دو بار)؛ سقف ۴ رنگ.
    setUserPalette((prev) => [h, ...prev.filter((c) => c.toLowerCase() !== h)].slice(0, 4));
  };
  const toggleColorDrawer = () => {
    if (colorDrawerOpen) {
      setColorDrawerOpen(false);
      return;
    }
    // دراور با position: fixed رندر می‌شود تا overflowی نوارِ افقی
    // (overflowX: auto) آن را نبرد؛ پس مختصاتش در لحظهٔ باز شدن، از
    // کادرِ دکمه اندازه‌گیری می‌شود. افقی: پایینِ دکمه، وسط‌چین، با
    // clamp در لبه‌های پنجره (عرضِ دراور ۳۰۰ است). عمودی: سمتِ
    // باز شدن، همان سمتِ فلای‌اوت است (قانونِ آینه‌ایِ §۱: داک در
    // نیمهٔ چپ → سمتِ راستِ دکمه؛ وگرنه سمتِ چپ)، با fallback به
    // سمتِ دیگر اگر سمتِ خواسته‌شده جا نداشت، و clamp در لبه‌ها.
    const rect = paletteBtnRef.current ? paletteBtnRef.current.getBoundingClientRect() : null;
    if (!rect) {
      setColorDrawerPos(isVertical
        ? { top: '50%', left: 10, transform: 'translate(0, -50%)' }
        : { top: 80, left: '50%', transform: 'translateX(-50%)' });
    } else if (isVertical) {
      const cy = rect.top + rect.height / 2;
      const fitsLeft = rect.left - 10 >= 300;
      const fitsRight = viewportW - rect.right - 10 >= 300;
      const openRight = isDockOnLeft ? (fitsRight || !fitsLeft) : (fitsRight && !fitsLeft);
      if (openRight) {
        setColorDrawerPos({ top: cy, left: Math.max(10, Math.min(rect.right + 10, viewportW - 300)), transform: 'translate(0, -50%)' });
      } else {
        setColorDrawerPos({ top: cy, left: Math.max(rect.left - 10, 300), transform: 'translate(-100%, -50%)' });
      }
    } else {
      const cx = Math.max(160, Math.min(rect.left + rect.width / 2, window.innerWidth - 160));
      setColorDrawerPos({ top: rect.bottom + 10, left: cx, transform: 'translateX(-50%)' });
    }
    setColorDrawerOpen(true);
  };

  const secondaryContent = (
    <>
      {/* فاز ۲: زیرمنوی کادربندی — فقط وقتی ابزار box فعال است */}
      {annotationTool === 'box' && (
        <div
          key="submenu-box"
          style={{ display: 'flex', flexDirection: isVertical ? 'column' : 'row', gap: isVertical ? 8 : 4, alignItems: 'center', animation: 'submenuIn 0.2s ease' }}
        >
          {divider}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
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
                  style={{
                    ...btnBase,
                    height: 32,
                    padding: '0 10px',
                    borderRadius: 9,
                    fontSize: 12,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    background: active ? 'rgba(34,211,238,0.20)' : 'transparent',
                    color: active ? '#67e8f9' : 'rgba(255,255,255,0.6)',
                    outline: active ? '1.5px solid #22d3ee' : 'none',
                    outlineOffset: -1,
                  }}
                >
                  {bs.label}
                </button>
              );
            })}
            {/* دکمه تاگل پر کردن داخل کادر */}
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
              style={{
                ...btnBase,
                height: 32,
                padding: '0 10px',
                borderRadius: 9,
                fontSize: 12,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                background: annotationHasFill ? 'rgba(34,211,238,0.20)' : 'transparent',
                color: annotationHasFill ? '#67e8f9' : 'rgba(255,255,255,0.4)',
                outline: annotationHasFill ? '1.5px solid #22d3ee' : '1px dashed rgba(255,255,255,0.2)',
                outlineOffset: -1,
              }}
            >
              {annotationHasFill ? '◉ توپر' : '○ توخالی'}
            </button>
          </div>
        </div>
      )}

      {/* فاز ۳ + Refinement Step 2: زیرمنوی فلش — وقتی ابزار arrow فعال است
          یا آیتمِ انتخاب‌شده فلش است (طبقِ TASK: tool OR selectedAnnotationTool) */}
      {(annotationTool === 'arrow' || selectedAnnotationTool === 'arrow') && (
        <div
          key="submenu-arrow"
          style={{ display: 'flex', flexDirection: isVertical ? 'column' : 'row', gap: isVertical ? 8 : 4, alignItems: 'center', animation: 'submenuIn 0.2s ease' }}
        >
          {divider}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
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
                  style={{
                    ...btnBase,
                    height: 32,
                    padding: '0 10px',
                    borderRadius: 9,
                    fontSize: 12,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    background: active ? 'rgba(34,211,238,0.20)' : 'transparent',
                    color: active ? '#67e8f9' : 'rgba(255,255,255,0.6)',
                    outline: active ? '1.5px solid #22d3ee' : 'none',
                    outlineOffset: -1,
                  }}
                >
                  {as.label}
                </button>
              );
            })}
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
              style={{
                ...btnBase,
                height: 32,
                padding: '0 10px',
                borderRadius: 9,
                fontSize: 12,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                background: annotationHasStartDot ? 'rgba(34,211,238,0.20)' : 'transparent',
                color: annotationHasStartDot ? '#67e8f9' : 'rgba(255,255,255,0.6)',
                outline: annotationHasStartDot ? '1.5px solid #22d3ee' : 'none',
                outlineOffset: -1,
              }}
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
              style={{
                ...btnBase,
                height: 32,
                padding: '0 10px',
                borderRadius: 9,
                fontSize: 12,
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
                background: annotationHasEndArrow ? 'rgba(34,211,238,0.20)' : 'transparent',
                color: annotationHasEndArrow ? '#67e8f9' : 'rgba(255,255,255,0.6)',
                outline: annotationHasEndArrow ? '1.5px solid #22d3ee' : 'none',
                outlineOffset: -1,
              }}
            >
              {annotationHasEndArrow ? '➤ با فلش' : '— خط'}
            </button>
          </div>
        </div>
      )}

      {/* فاز ۴: زیرمنوی متن — وقتی ابزار متن فعال است، یا آیتمِ انتخاب‌شده
          متنی است (شرطِ گستردهٔ قدیمی؛ چون تعویضِ ابزار، انتخاب را پاک
          می‌کند، شرطِ فقط-tool برای ویرایشِ متنِ انتخاب‌شده کافی نیست). */}
      {/* گام ۲ میانی: کنسولِ فونت برای متن و استیکی (isTypoMode) — ورود
          با keyframesی typoConsoleIn، بدونِ انیمیتِ width/margin. */}
      {isTypoMode && (
        <>
          {divider}
          <div key={annotationTool} style={{ display: 'flex', gap: 4, alignItems: 'center', animation: 'typoConsoleIn 0.25s ease' }}>
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
                  style={{
                    ...btnBase,
                    height: 32,
                    padding: '0 10px',
                    borderRadius: 9,
                    fontSize: 12,
                    fontFamily: 'inherit',
                    whiteSpace: 'nowrap',
                    background: active ? 'rgba(34,211,238,0.20)' : 'transparent',
                    color: active ? '#67e8f9' : 'rgba(255,255,255,0.6)',
                    outline: active ? '1.5px solid #22d3ee' : 'none',
                    outlineOffset: -1,
                  }}
                >
                  {f.label}
                </button>
              );
            })}
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
                style={{ width: 110, accentColor: '#22d3ee', cursor: 'pointer' }}
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
        </>
      )}

      {divider}

      {/* رنگ‌ها */}
      <div style={{ display: 'flex', gap: hoverSwatch && hoverSwatch.startsWith('q:') ? 8 : 6, alignItems: 'center', padding: '0 2px' }}>
        {COLORS.map((c) => {
          const active = annotationColor.toLowerCase() === c.hex.toLowerCase();
          return (
            <button
              key={c.hex}
              title={c.label}
              onMouseEnter={() => setHoverSwatch(`q:${c.hex}`)}
              onMouseLeave={() => setHoverSwatch(null)}
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
                width: active ? 24 : 20,
                height: active ? 24 : 20,
                borderRadius: '50%',
                background: c.hex,
                // فاز ۳ پالت — نشانگرِ رنگِ فعال (تسک §۱): به‌جای
                // رینگِ فیروزه‌ایِ قبلی، بجِ سفید + درخششِ هم‌رنگ.
                border: active
                  ? '1.5px solid rgba(255,255,255,0.85)'
                  : c.hex === '#f8fafc' ? '1px solid rgba(0,0,0,0.2)' : 'none',
                boxShadow: active
                  ? `0 0 8px ${c.hex}`
                  : hoverSwatch === `q:${c.hex}`
                    ? `0 6px 14px ${c.hex}`
                    : '0 0 0 1px rgba(255,255,255,0.2)',
                transform: hoverSwatch === `q:${c.hex}` ? 'translateY(-3px) scale(1.25)' : 'none',
                transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          );
        })}
        {/* فاز ۳ پالت — دکمهٔ دراورِ پالتِ تخصصی، کنارِ رنگ‌های
          دم‌دست. آیکونِ Paletteی لوسید با SVGی خام است، چون
          Icons.jsxی پروژه این آیکون را ندارد (الگوی Grip و
          Columns/Rows در همین فایل)؛ مسیرها از بستهٔ jaspr_icons_pack
          (همان منبعی که برای Pinی لوسید راستی‌آزمایی شده بود) گرفته
          شده‌اند. */}
        <button
          ref={paletteBtnRef}
          title="پالت رنگ تخصصی"
          onClick={toggleColorDrawer}
          style={{
            ...btnBase,
            width: 30,
            height: 30,
            borderRadius: '50%',
            flexShrink: 0,
            background: colorDrawerOpen ? 'rgba(34,211,238,0.22)' : 'transparent',
            color: colorDrawerOpen ? '#67e8f9' : 'rgba(255,255,255,0.75)',
            outline: colorDrawerOpen ? '1.5px solid #22d3ee' : '1px solid rgba(255,255,255,0.25)',
            outlineOffset: -1,
          }}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 22a1 1 0 0 1 0-20a10 9 0 0 1 10 9a5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z" />
            <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
            <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
            <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
            <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
          </svg>
        </button>
      </div>

      {!hideStrokeControls && (
        <>
      {divider}

      {/* اندازه */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
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
                width: 32,
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
        </>
      )}

      {/* Refinement Step 2: اسلایدرِ شفافیت — کنارِ پالتِ اندازه‌ها.
          روی تغییر: هم استور به‌روز می‌شود (برای شکل‌های بعدی) و هم
          broadcastSelectedPropertyPatch({ opacity }) برای اعمالِ زنده
          روی تمامِ آیتم‌های انتخاب‌شده (شنوندهٔ لایه، opacity را
          می‌پذیرد و بعد از مرحلهٔ ۳، به همهٔ انتخاب‌شده‌ها گسترش
          می‌دهد). محدوده ۱۵٪ تا ۱۰۰٪ با گامِ ۵٪، مثلِ TASK. */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 2px' }}>
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
          style={{ width: 110, accentColor: '#22d3ee', cursor: 'pointer' }}
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
      {/* میکروانیمیشن‌ها §۳ — راهنمای ریزِ دوبار کلیک: در ستونِ
          عمودی، آخرین آیتمِ فلای‌اوت (پایینِ پنل) و در نوارِ افقی،
          آخرین المانِ ردیفِ گزینه‌های فرعی است. */}
      <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textAlign: 'center', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>
        بسته شدن با دوبار کلیک
      </div>
    </>
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
  // معماریِ قطعی §۵ — دکمهٔ تأییدِ نهایی (Done) در انتهای نوار:
  // تیکِ لوسید با تمِ سبزِ زمردی (#10b981) و درخششِ هاور. کلیک:
  // لغوِ انتخاب‌های فعال + بستنِ همهٔ پنل‌ها (دراورِ رنگ و زیرمنوی
  // جمع‌شده) + خروج از مودِ ویرایش. آیکون از Icons.Check می‌آید
  // (در Icons.jsxی فاز ۱ موجود است) و اگر نبود، SVGی خامِ لوسید
  // (M20 6 9 17l-5-5) جایگزین می‌شود تا المانِ ناشناخته رندر نشود.
  const doneButton = (
    <button
      aria-label="اتمام ویرایش — لغو انتخاب و خروج از حالت ویرایش"
      onMouseEnter={(e) => showTooltipDelayed(e, 'اتمام ویرایش')}
      onMouseLeave={hideTooltip}
      onClick={() => {
        if (typeof clearSelection === 'function') clearSelection();
        setPanelClosed(false);
        setColorDrawerOpen(false);
        if (typeof setIsAnnotationActive === 'function') setIsAnnotationActive(false);
      }}
      onMouseEnter={() => setDoneHover(true)}
      onMouseLeave={() => setDoneHover(false)}
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
  const colorDrawer = colorDrawerOpen && colorDrawerPos && (
    <div
      dir="rtl"
      style={{
        position: 'fixed',
        top: colorDrawerPos.top,
        left: colorDrawerPos.left,
        transform: colorDrawerPos.transform,
        zIndex: 40,
      }}
    >
      <div
        ref={colorDrawerRef}
        style={{
          width: 300,
          maxHeight: 'calc(100vh - 40px)',
          overflowY: 'auto',
          scrollbarWidth: 'none',
          padding: 12,
          borderRadius: 16,
          background: 'radial-gradient(160px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(34, 211, 238, 0.12), rgba(147, 51, 234, 0.10) 45%, transparent 70%), rgba(10, 15, 24, 0.94)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          userSelect: 'none',
          animation: 'paletteDrawerIn 0.22s ease',
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onMouseMove={handleSpotMove}
        onMouseLeave={handleSpotLeave}
      >
        {PALETTE_CATEGORIES.map((cat) => (
          <div key={cat.id} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
              {cat.label}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: hoverSwatch && hoverSwatch.startsWith(`d:${cat.id}:`) ? 10 : 8, alignItems: 'center' }}>
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
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: c.hex,
                      border: active
                        ? '1.5px solid rgba(255,255,255,0.85)'
                        : '1px solid rgba(255,255,255,0.25)',
                      boxShadow: active ? `0 0 8px ${c.hex}` : hoverSwatch === `d:${cat.id}:${c.hex}` ? `0 6px 14px ${c.hex}` : 'none',
                      transform: hoverSwatch === `d:${cat.id}:${c.hex}` ? 'translateY(-3px) scale(1.25)' : 'none',
                      transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))}
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
            رنگ‌های من
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: hoverSwatch && hoverSwatch.startsWith('u:') ? 10 : 8, alignItems: 'center' }}>
            {userPalette.map((hex) => {
              const active = annotationColor.toLowerCase() === hex.toLowerCase();
              const hovered = hoverUserHex === hex;
              return (
                <div key={hex} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                  <button
                    title={hex}
                    onClick={() => applyDrawerColor(hex)}
                    onMouseEnter={() => { setHoverUserHex(hex); setHoverSwatch(`u:${hex}`); }}
                    onMouseLeave={() => { setHoverUserHex(null); setHoverSwatch(null); }}
                    style={{
                      ...btnBase,
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      flexShrink: 0,
                      background: hex,
                      border: active
                        ? '1.5px solid rgba(255,255,255,0.85)'
                        : '1px solid rgba(255,255,255,0.25)',
                      boxShadow: active ? `0 0 8px ${hex}` : hoverSwatch === `u:${hex}` ? `0 6px 14px ${hex}` : hovered ? `0 0 10px ${hex}` : 'none',
                      transform: hoverSwatch === `u:${hex}` ? 'translateY(-3px) scale(1.25)' : 'none',
                      transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}
                  />
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
                width: 26,
                height: 26,
                borderRadius: '50%',
                flexShrink: 0,
                background: 'transparent',
                border: '1px dashed rgba(255,255,255,0.4)',
                color: 'rgba(255,255,255,0.75)',
                fontSize: 18,
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
          </div>
          {userPalette.length === 0 && (
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
              هنوز رنگی ذخیره نشده؛ با + یک رنگِ دلخواه اضافه کنید (حداکثر ۴ رنگِ اخیر نگه داشته می‌شود).
            </div>
          )}
        </div>
      </div>
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
      <style>{`@keyframes typoConsoleIn { from { opacity: 0; transform: translateY(4px) scale(0.97); } to { opacity: 1; transform: none; } } @keyframes paletteDrawerIn { from { opacity: 0; transform: translateY(4px) scale(0.97); } to { opacity: 1; transform: none; } } @keyframes submenuIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } } .at-pill { transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1), filter 0.2s ease; } .at-pill:hover { transform: scale(1.06); filter: brightness(1.3); } .at-range { transition: filter 0.2s ease; } .at-range:hover { filter: drop-shadow(0 0 6px rgba(34, 211, 238, 0.6)); }`}</style>
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
          {showSecondary && (
          <div
            dir="rtl"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 16,
              background: 'radial-gradient(160px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(34, 211, 238, 0.12), rgba(147, 51, 234, 0.10) 45%, transparent 70%), rgba(8, 12, 16, 0.92)',
              border: `1px solid ${withAlpha(annotationColor, 0.35)}`,
              animation: 'submenuIn 0.25s ease',
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
            {secondaryContent}
          </div>)}
          <div
            dir="rtl"
            ref={toolsWrapRef}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
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
            {doneButton}
          </div>
        </div>
      ) : (
        <div
          dir="rtl"
          ref={(el) => { toolbarWrapRef.current = el; toolsWrapRef.current = el; }}
          style={{
            position: 'absolute',
            top: 26,
            left: '50%',
            transform: 'translateX(-50%)',
            ...floatingStyle,
            zIndex: 30,
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
            maxWidth: 'calc(100% - 24px)',
            overflowX: 'auto',
            scrollbarWidth: 'none',
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
          {toolGlow}
          {dragHandle}
          {toolsButtons}
          {showSecondary && (<div style={{ display: 'flex', gap: 4, alignItems: 'center', animation: 'submenuIn 0.25s ease' }}>{secondaryContent}</div>)}
          {divider}
          {actionsContent}
          {orientationToggle}
          {doneButton}
        </div>
      )}
      {colorDrawer}
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
