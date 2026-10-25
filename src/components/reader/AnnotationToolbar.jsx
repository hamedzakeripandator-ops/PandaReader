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
            title={label}
            onClick={() => setAnnotationTool(id)}
            style={{
              ...btnBase,
              // گام ۲ میانی: مورفِ تایپو — دکمه‌های ترسیمی در حالتِ تایپو
              // کوچک (scale ‏0.88) و کم‌رنگ (opacity ‏0.65) می‌شوند؛ text و
              // sticky در مقیاسِ کامل می‌مانند. ترنزیشن از btnBase می‌آید
              // (transform با منحنیِ کشسان + opacity). مورف، صرفاً افکتِ
              // بصری است: قفلِ پولیش کاملاً حذف شده، پس مورف هرگز مانعِ
              // کلیک نمی‌شود — همهٔ دکمه‌های ابزار، همیشه cursorِ
              // pointer و pointerEventsِ auto دارند (دو خطِ پایین).
              ...(isTypoMode && DRAWING_TOOL_IDS.includes(id)
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
            }}
          >
            <Icon size={18} />
          </button>
        );
      })}
    </>
  );
  const secondaryContent = (
    <>
      {/* فاز ۲: زیرمنوی کادربندی — فقط وقتی ابزار box فعال است */}
      {annotationTool === 'box' && (
        <>
          {divider}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {BOX_STYLES.map((bs) => {
              const active = annotationBoxStyle === bs.id;
              return (
                <button
                  key={bs.id}
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
        </>
      )}

      {/* فاز ۳ + Refinement Step 2: زیرمنوی فلش — وقتی ابزار arrow فعال است
          یا آیتمِ انتخاب‌شده فلش است (طبقِ TASK: tool OR selectedAnnotationTool) */}
      {(annotationTool === 'arrow' || selectedAnnotationTool === 'arrow') && (
        <>
          {divider}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {ARROW_STYLES.map((as) => {
              const active = annotationArrowStyle === as.id;
              return (
                <button
                  key={as.id}
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
        </>
      )}

      {/* فاز ۴: زیرمنوی متن — وقتی ابزار متن فعال است، یا آیتمِ انتخاب‌شده
          متنی است (شرطِ گستردهٔ قدیمی؛ چون تعویضِ ابزار، انتخاب را پاک
          می‌کند، شرطِ فقط-tool برای ویرایشِ متنِ انتخاب‌شده کافی نیست). */}
      {/* گام ۲ میانی: کنسولِ فونت برای متن و استیکی (isTypoMode) — ورود
          با keyframesی typoConsoleIn، بدونِ انیمیتِ width/margin. */}
      {isTypoMode && (
        <>
          {divider}
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', animation: 'typoConsoleIn 0.25s ease' }}>
            {FONT_OPTIONS.map((f) => {
              const active = annotationFontFamily === f.id;
              return (
                <button
                  key={f.id}
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
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '0 2px' }}>
        {COLORS.map((c) => {
          const active = annotationColor.toLowerCase() === c.hex.toLowerCase();
          return (
            <button
              key={c.hex}
              title={c.label}
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
                border: c.hex === '#f8fafc' ? '1px solid rgba(0,0,0,0.2)' : 'none',
                boxShadow: active
                  ? '0 0 0 2px rgba(8,12,16,1), 0 0 0 4px #22d3ee'
                  : '0 0 0 1px rgba(255,255,255,0.2)',
              }}
            />
          );
        })}
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
    </>
  );
  const actionsContent = (
    <>
      {/* Undo — فاز ۱: prop با fallback */}
      <button
        title="برگردان (Ctrl+Z)"
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
        title="ازنو (Ctrl+Y)"
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
      title={isVertical ? 'تغییر به تولبار افقی' : 'تغییر به تولبار عمودی'}
      onClick={() => {
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
  return (
    <>
      {/* گام ۲ میانی: keyframesی ورودِ کنسولِ فونت. ترنزیشنِ CSS روی المانی
          که تازه mount شده اجرا نمی‌شود (مقدارِ اولیه همان مقدارِ نهایی
          است)، پس ورودِ دقیقِ خواسته‌شده (opacity ‏0 به 1 و
          translateY(4px) scale(0.97) به none) با keyframes پیاده شد؛ بدونِ
          دست زدن به width/margin و بدونِ لمسِ transformی ریشه که مرکزچینی
          (translateX(-50%)) را نگه می‌دارد. */}
      <style>{`@keyframes typoConsoleIn { from { opacity: 0; transform: translateY(4px) scale(0.97); } to { opacity: 1; transform: none; } }`}</style>
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
            flexDirection: 'row',
            gap: 10,
            alignItems: 'flex-start',
            transition: isToolbarDragging ? 'none' : 'transform 0.25s ease, top 0.25s ease, left 0.25s ease, right 0.25s ease',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          <div
            dir="rtl"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 16,
              background: 'rgba(8, 12, 16, 0.92)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              userSelect: 'none',
              maxHeight: 'calc(100vh - 120px)',
              overflowY: 'auto',
              scrollbarWidth: 'none',
            }}
          >
            {secondaryContent}
          </div>
          <div
            dir="rtl"
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
              padding: '6px 10px',
              borderRadius: 16,
              background: 'rgba(8, 12, 16, 0.92)',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              userSelect: 'none',
              maxHeight: 'calc(100vh - 120px)',
              overflowY: 'auto',
              scrollbarWidth: 'none',
            }}
          >
            {dragHandle}
            {toolsButtons}
            {divider}
            {actionsContent}
            {orientationToggle}
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
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            padding: '6px 10px',
            borderRadius: 16,
            background: 'rgba(8, 12, 16, 0.92)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            userSelect: 'none',
            maxWidth: 'calc(100% - 24px)',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            transition: isToolbarDragging ? 'none' : 'transform 0.25s ease, top 0.25s ease, left 0.25s ease, right 0.25s ease',
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
        >
          {dragHandle}
          {toolsButtons}
          {secondaryContent}
          {divider}
          {actionsContent}
          {orientationToggle}
        </div>
      )}
    </>
  );

}

export default AnnotationToolbar;
