import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useVirtualScroll from '../../hooks/useVirtualScroll';
import useContextMenu from '../../hooks/useContextMenu';
import { coreApi } from '../../services/coreApi';
import { renderPageOverlay, buildPageGeometry } from '../../utils/annotationPdfExport';
import annotationLocalBackup from '../../services/annotationLocalBackup';
import Icons from '../common/Icons';
import AnnotationLayer from './AnnotationLayer';
import AnnotationToolbar from './AnnotationToolbar';
import useSettingsStore from '../../store/useSettingsStore';
import useBookmarkStore, { resolveActiveBookKey, normalizeBookKey } from '../../store/useBookmarkStore';
import BookmarkMarker from './BookmarkMarker';
import { clampYRatio, resolveBookmarkImage } from './bookmarkTemplates';
import readingActivity from '../../services/readingActivity';
import { getReadingThemeFilter } from '../../utils/readingTheme';

// تولید آدرس استاندارد و مطلق برای پروتکل امن comic://
function buildComicImageUrl(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const trimmed = filePath.trim();
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('comic://')
  ) {
    return trimmed;
  }
  const sanitized = trimmed.replace(/^[\\/]+/, '');
  return `comic://media/?path=${encodeURIComponent(sanitized)}`;
}

// مرحلهٔ ۴۴ §۴: بارگذاریِ یک تصویر از URL (comic:// یا data URL).
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('بارگذاریِ تصویرِ صفحه انجام نشد.'));
    img.src = src;
  });
}

// مرحلهٔ ۴۴ §۴: پختِ یک صفحهٔ CBZ — تصویرِ اصلی رویِ بومِ هم‌اندازهٔ
// naturalWidth × naturalHeight رسم می‌شود و حاشیه‌نویسی‌ها با همان
// renderPageOverlayای PDF (همان هندسهٔ buildPageGeometry با چرخشِ
// CSS) رویش پخته می‌شوند. مختصاتِ ذخیره‌سازی کسریِ خالص‌اند، پس
// هندسه با viewportای ۱۰۰۰ واحدی و aspectِ واقعیِ صفحه دقیق است.
// فرمتِ خروجی، همان فرمتِ اصلی است (JPEG با کیفیت ۰٫۹۲، WebP با
// ۰٫۹۲، بقیه PNG) تا حجمِ فایل منفجر نشود.
async function bakeCbzPageImage(rawPath, itemsForPage, rotation) {
  const img = await loadImageElement(buildComicImageUrl(rawPath));
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh) return null;
  const viewH = (1000 * nh) / nw;
  const geometry = buildPageGeometry({ width: 1000, height: viewH, transform: [1, 0, 0, -1, 0, viewH], rotate: 0, view: [0, 0, 1000, viewH] }, rotation || 0);
  const rendered = await renderPageOverlay(itemsForPage, geometry);
  if (!rendered || (!rendered.overlayPng && !rendered.highlightPng)) return null;
  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, nw, nh);
  if (rendered.highlightPng) {
    const hlImg = await loadImageElement(rendered.highlightPng);
    ctx.drawImage(hlImg, 0, 0, nw, nh);
  }
  if (rendered.overlayPng) {
    const ovImg = await loadImageElement(rendered.overlayPng);
    ctx.drawImage(ovImg, 0, 0, nw, nh);
  }
  const ext = String(rawPath || '').split('.').pop().toLowerCase();
  let dataUrl = null;
  if (ext === 'jpg' || ext === 'jpeg') dataUrl = canvas.toDataURL('image/jpeg', 0.96);
  else if (ext === 'webp') dataUrl = canvas.toDataURL('image/webp', 0.98);
  else dataUrl = canvas.toDataURL('image/png');
  const entryName = String(rawPath).split(/[\\/]/).pop() || '';
  try { canvas.width = 0; canvas.height = 0; } catch (_) {}
  return { entryName, imageDataUrl: dataUrl, width: nw, height: nh };
}

// کامپوننت فریم ایزوله‌شده با حذف درز سیاه زیرپیکسلی، پاس دوم وضوح بالا (HiDPI) و لایه استودیو ویرایش
// مرحله ۱۲: آرایهٔ مشترکِ «صفحه بدونِ حاشیه‌نویسی» — مثلِ
// PdfViewer: `|| []`ی تازه در هر رندرِ والد، مقایسهٔ سطحیِ
// React.memo را برای ComicPageFrame و لایهٔ Konvaی درونِ آن،
// شکست می‌داد. این آرایه، فریز شده و در همهٔ صفحه‌ها مشترک است.
const EMPTY_PAGE_ANNOTATIONS = Object.freeze([]);
import useDragPan from '../../hooks/useDragPan';

const EMPTY_PAGE_BOOKMARKS = Object.freeze([]);

// مرحله ۱۵: کپسولِ شناورِ درصدِ پیشرفتِ ری‌رندر — غیرمزاحم
// (pointerEvents: none) در گوشهٔ پایین-چپِ ویوور. در ۱۰۰٪، یک
// ثانیه سبزِ زمردی نشان می‌دهد و بعد محو می‌شود.
function RenderProgressHud({ total, done, isDone, visible }) {
  if (!visible || total <= 0) return null;
  const percent = Math.min(100, Math.round((done / total) * 100));
  return (
    <div
      style={{
        position: 'absolute',
        left: '16px',
        bottom: '16px',
        zIndex: 60,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 14px',
        borderRadius: '20px',
        backgroundColor: isDone ? 'rgba(6, 78, 59, 0.92)' : 'rgba(13, 18, 24, 0.92)',
        border: isDone ? '1px solid rgba(52, 211, 153, 0.5)' : '1px solid var(--border)',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        fontFamily: 'var(--font-fa)',
        fontSize: '12px',
        color: isDone ? '#a7f3d0' : 'var(--text)',
        direction: 'rtl',
      }}
    >
      <span>
        {isDone
          ? `\u2713 بازسازی کیفیت کامل شد (${percent.toLocaleString('fa-IR')}٪)`
          : `در حال بازسازی کیفیت صفحات... ${percent.toLocaleString('fa-IR')}٪`}
      </span>
      <span
        style={{
          width: '90px',
          height: '4px',
          borderRadius: '2px',
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${percent}%`,
            backgroundColor: isDone ? '#34d399' : '#22d3ee',
            transition: 'width 200ms ease',
          }}
        />
      </span>
    </div>
  );
}



const ComicPageFrame = React.memo(function ComicPageFrame({
  item,
  index,
  isLastItem,
  knownHeight,
  frameWidth,
  pageGap,
  rotation,
  isHiDpiPassActive,
  isNearViewport,
  isSharpenFilterActive,
  pageAnnotations,
  onCommitPageAnnotations,
  onTransferItemsToPage,
  onImageLoad,
  onFrameRendered,
  onContextMenu,
  pageFilter,
  frameZoomLevel,
  fitToScreen,
}) {
  const pageNum = index + 1;
  const rawPath = item?.path || item?.filePath || '';
  // مرحلهٔ ۵۰ §۲: اشتراکِ استودیو برای overflowِ visibleِ قاب (Bleed).
  const isAnnotationActive = useAppStore((s) => Boolean(s.isAnnotationActive));
  const [retryCount, setRetryCount] = useState(0);
  const [hasError, setHasError] = useState(false);

  const imgSrc = useMemo(() => {
    const base = buildComicImageUrl(rawPath);
    if (!base) return '';
    return retryCount > 0 ? `${base}&retry=${retryCount}` : base;
  }, [rawPath, retryCount]);

  const handleImgError = useCallback(() => {
    if (retryCount < 2) {
      setTimeout(() => {
        setRetryCount((prev) => prev + 1);
      }, 250 * (retryCount + 1));
    } else {
      setHasError(true);
      // تلاشِ نهایی هم تمام شد؛ برای HUD، این صفحه «تمام‌شده»
      // حساب می‌شود تا درصد، هیچ‌وقت گیر نکند.
      if (typeof onFrameRendered === 'function') onFrameRendered(index);
    }
  }, [retryCount, index, onFrameRendered]);

  const handleLoad = useCallback(
    (e) => {
      const nw = e.target.naturalWidth;
      const nh = e.target.naturalHeight;
      if (nw > 0 && nh > 0) {
        onImageLoad(index, nw, nh);
      }
      if (typeof onFrameRendered === 'function') onFrameRendered(index);
    },
    [index, onImageLoad, onFrameRendered]
  );

  const normalizedRotation = ((Number(rotation) || 0) % 360 + 360) % 360;
  const isSwappedRotation = normalizedRotation === 90 || normalizedRotation === 270;
  const useSwappedLayout = isSwappedRotation && frameWidth > 0;
  // مرحلهٔ ۴۳ §۴: Fit-to-Screen در حالت افقی — در زوم ۱۰۰٪، ارتفاع
  // صفحه دقیقاً 'calc(100vh - 28px)' است؛ با زوم دستی، همان سقف
  // ضربدر زوم می‌شود تا صفحه بزرگ شود و جای اسکرول عمودی پیدا کند
  // (وگرنه گیت لبه مرحله ۴۲ در افقی، هیچ‌وقت شاخه «اول اسکرول»
  // را نمی‌دید).
  const fitZoom = Math.min(3.5, Math.max(0.1, Number(frameZoomLevel) || 1));
  const fitMaxHeight = fitToScreen
    ? (fitZoom === 1 ? 'calc(100vh - 28px)' : `calc((100vh - 28px) * ${fitZoom})`)
    : undefined;

  const isSeamlessMode = pageGap === 0 && !rotation;
  // مرحلهٔ ۳۵ §۵: اگر صفحه، استیکیِ کاملاً بیرون از کاغذ دارد، قاب
  // باید overflow: visible داشته باشد تا پینِ DOM لایه دیده شود
  // (در چرخش، قاب بریده می‌ماند تا چیدمانِ چرخان به‌هم نریزد).
  const frameHasOverflowSticky = normalizedRotation === 0 &&
    Array.isArray(pageAnnotations) &&
    pageAnnotations.some((a) => {
      if (!a || a.tool !== 'sticky') return false;
      const ax = Number(a.x ?? a.startX ?? 0);
      const ay = Number(a.y ?? a.startY ?? 0);
      const aw = Number(a.width) || 210;
      const ah = Number(a.height) || 170;
      return ax + aw <= 0 || ax >= 1000 || ay + ah <= 0 || ay >= 1000;
    });

  return (
    <div
      id={`comic-page-${pageNum}`}
      data-page={pageNum}
      data-page-number={pageNum}
      data-index={index}
      className="comic-page-item"
      style={{
        ...styles.imageWrapper,
        width: fitToScreen ? 'fit-content' : undefined,
        maxWidth: fitToScreen ? '100%' : undefined,
        height: fitToScreen ? 'auto' : (knownHeight ? `${knownHeight}px` : 'auto'),
        minHeight: fitToScreen ? '0' : (knownHeight ? `${knownHeight}px` : '450px'),
        marginBottom: isLastItem ? '0px' : `${pageGap}px`,
        // مرحلهٔ ۵۰ §۲: قاب، overflow: visible می‌گیرد تا بومِ
        // حاشیه‌دارِ لایه (Bleed) بیرونِ کاغذ دیده شود (وقتی استودیو فعال است).
        contain: (isSeamlessMode || frameHasOverflowSticky || isAnnotationActive) ? 'layout style' : 'layout paint',
        overflow: (isSeamlessMode || frameHasOverflowSticky || isAnnotationActive) ? 'visible' : 'hidden',
      }}
      onContextMenu={(e) => {
        // مرحله ۱۳: مختصاتِ عمودیِ کلیک نسبت به بالایِ همین صفحه.
        let yRatio = 0;
        try {
          const rect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : null;
          if (rect && rect.height > 0) {
            yRatio = clampYRatio((e.clientY - rect.top) / rect.height);
          }
        } catch (_) {}
        onContextMenu(e, index, rawPath, yRatio);
      }}
    >
      {/* مانتِ دائمیِ لایهٔ حاشیه‌نویسی (یکسان‌سازی با PdfViewer، فاز ۱):
          قبلاً AnnotationLayer فقط وقتی imgSrc آماده و بدونِ خطا بود
          مانت می‌شد؛ پس صفحه‌های کمیکِ در حالِ بارگذاری یا خطادار،
          اصلاً لایه نداشتند و هیچ ورودی‌ای نمی‌گرفتند. حالا لایه همیشه
          مانت است و تا وقتی تصویر آماده نیست، روی placeholder می‌نشیند.
          وقتی استودیو غیرفعال است، pointerEventsِ لایه none است، پس
          دکمهٔ «تلاش مجدد» همچنان کلیک‌پذیر می‌ماند. لایه آخرین فرزندِ
          wrapperِ چرخان است تا روی تصویر رنگ شود و چرخش را به‌ارث ببرد.
          یکسان‌سازی با PdfViewer: از این فاز، rotation به لایه هم پاس
          داده می‌شود تا مختصاتِ معکوسِ چرخش در extractPoints، با
          چیدمانِ جابه‌جا شدهٔ بالا هم‌خوان باشد. */}
      <div
        style={{
          // یکسان‌سازی با PdfViewer (رفعِ بدهیِ فنی): برای چرخشِ
          // ۹۰/۲۷۰، چیدمانِ wrapper باید جابه‌جا شده باشد، وگرنه
          // wrapperِ ۱۰۰٪×۱۰۰٪ پس از چرخش، از دو طرف از کادر بیرون
          // می‌زند و contain/overflowِ کادر، هم تصویر و هم لایه را
          // می‌بُرد (همان خانوادهٔ باگِ ناحیه‌های مردهٔ PDF). عرضِ
          // واقعیِ کادر (frameWidth) از والد می‌آید؛ تا وقتی اندازه
          // نشده، چیدمانِ قدیمی حفظ می‌شود (فقط یک رندرِ گذرا).
          position: useSwappedLayout ? 'absolute' : 'relative',
          left: useSwappedLayout ? '50%' : undefined,
          top: useSwappedLayout ? '50%' : undefined,
          width: useSwappedLayout ? (knownHeight ? `${knownHeight}px` : '450px') : '100%',
          height: useSwappedLayout ? `${frameWidth}px` : (fitToScreen ? 'auto' : '100%'),
          // کانتینرِ درونی، هرگز فرو نمی‌ریزد: حتی وقتی تصویر هنوز
          // اندازه نشده یا خطا داده، minHeightِ کادر را دارد تا
          // لایه، همیشه جعبهٔ زنده داشته باشد.
          minHeight: fitToScreen ? '0' : (knownHeight ? `${knownHeight}px` : '450px'),
          transform: useSwappedLayout
            ? `translate(-50%, -50%) rotate(${rotation}deg)`
            : (rotation ? `rotate(${rotation}deg)` : 'none'),
        }}
      >
        {imgSrc && !hasError ? (
          <img
            src={imgSrc}
            alt={`Page ${pageNum}`}
            loading="eager"
            decoding="sync"
            draggable={false}
            style={{
              ...styles.image,
              width: fitToScreen ? 'auto' : undefined,
              height: fitToScreen
                ? 'auto'
                : (knownHeight
                  ? isSeamlessMode && !isLastItem
                    ? 'calc(100% + 1px)'
                    : '100%'
                  : 'auto'),
              maxWidth: fitToScreen ? '100%' : undefined,
              maxHeight: fitMaxHeight,
              objectFit: fitToScreen ? 'contain' : 'fill',
              // فاز ۳: فیلترِ شارپنسِ SVG (کانولوشنِ ۳×۳ روی کلِ تصویر)
              // فقط وقتی روشن است که پاسِ HiDPI فعال باشد و زوم ≤ ۱٫۵
              // و استودیو خاموش باشد؛ در زومِ بالا یا حینِ حاشیه‌نویسی،
              // مرورگر از این کانولوشنِ هر فریم راحت می‌شود.
              // مرحله ۶ ـ بخش الف: تمِ مطالعه با فیلترِ شارپنسِ HiDPI
              // ترکیب می‌شود (هر دو فقط روی همین img اثر می‌کنند؛
              // لایهٔ حاشیه‌نویسی، خواهرِ wrapper است و دست نمی‌خورد).
              filter: [pageFilter && pageFilter !== 'none' ? pageFilter : null, isSharpenFilterActive ? 'url(#comic-hidpi-sharpen)' : null].filter(Boolean).join(' ') || 'none',
              transform: isHiDpiPassActive ? 'translateZ(0)' : 'none',
            }}
            onLoad={handleLoad}
            onError={handleImgError}
          />
        ) : (
          <div style={styles.errorPlaceholder}>
            <span style={{ color: 'var(--danger)', display: 'flex' }}>
              <Icons.AlertTriangle size={24} />
            </span>
            <span style={styles.errorText}>خطا در بارگذاری صفحه {pageNum}</span>
            <button
              type="button"
              onClick={() => {
                setHasError(false);
                setRetryCount((c) => c + 1);
              }}
              style={styles.retryBtn}
            >
              تلاش مجدد
            </button>
          </div>
        )}

        {/* لایه تعاملی استودیو ویرایش روی صفحات کمیک — همیشه مانت است */}
        <AnnotationLayer
          pageNumber={pageNum}
          rotation={rotation}
          items={pageAnnotations}
          onCommitPageItems={onCommitPageAnnotations}
          onTransferItemsToPage={onTransferItemsToPage}
          isNearViewport={isNearViewport}
          zoomLevel={frameZoomLevel || 1}
        />
      </div>
    </div>
  );
});

export default function VerticalViewer() {
  const comicData = useReaderStore((state) => state.comicData);
  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const setZoomLevel = useReaderStore((state) => state.setZoomLevel);
  const areaZoomTarget = useReaderStore((state) => state.areaZoomTarget);
  const clearAreaZoomTarget = useReaderStore((state) => state.clearAreaZoomTarget);
  const hiDpiRenderTick = useReaderStore((state) => state.hiDpiRenderTick);
  const triggerHiDpiRender = useReaderStore((state) => state.triggerHiDpiRender);
  const comicPageGap = useReaderStore((state) => state.comicPageGap ?? 0);
  const rotation = useReaderStore((state) => state.rotation);
  const readingTheme = useSettingsStore((state) => state.preferences?.readingTheme || 'default');
  const readingBrightness = useSettingsStore((state) => state.preferences?.readingBrightness ?? 1);
  const readingWarmth = useSettingsStore((state) => state.preferences?.readingWarmth ?? 0);
  // مرحلهٔ ۴۱ §۴: رنگِ پس‌زمینهٔ ناحیهٔ خواندن (از تنظیمات؛ تا وقتی
  // فیلد در استور نیامده، همان پیش‌فرضِ '#2b3038' استفاده می‌شود).
  const readerBackdropColor = useSettingsStore((state) => state.readerBackdropColor || '#2b3038');
  const pageFilter = useMemo(
    () => getReadingThemeFilter(readingTheme, readingBrightness, readingWarmth),
    [readingTheme, readingBrightness, readingWarmth]
  );
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const targetPage = useReaderStore((state) => state.targetPage);
  const clearTargetPage = useReaderStore((state) => state.clearTargetPage);

  const isSnippingActive = useAppStore((state) => state.isSnippingActive);
  const isAreaZoomActive = useAppStore((state) => Boolean(state.isAreaZoomActive));
  const isAnnotationActive = useAppStore((state) => Boolean(state.isAnnotationActive));
  const showToast = useAppStore((state) => state.showToast);
  const isRightSidebarOpen = useAppStore((state) => state.isRightSidebarOpen);
  const updateReadingProgress = useLibraryStore((state) => state.updateReadingProgress);
  const { handleContextMenu } = useContextMenu();

  const [annotationsByPage, setAnnotationsByPage] = useState({});
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  // مرحلهٔ ۵۰ §۲: آینهٔ refیِ annotationsByPage برای هندلرِ انتقالِ
  // بین‌صفحه‌ای (آینهٔ PdfViewer/EpubViewer).
  const annotationsByPageRef = useRef({});
  annotationsByPageRef.current = annotationsByPage;
  // مرحلهٔ ۴۴ §۴: وضعیتِ ذخیرهٔ CBZ (آینهٔ showSaveStatusی PdfViewer —
  // بنرِ شناور ندارد؛ پیام‌ها با Toast می‌آیند و تولبار از همین
  // pdfSaveState، دکمه‌ها را غیرفعال/سبز می‌کند).
  const [isExportingCbz, setIsExportingCbz] = useState(false);
  const [cbzSaveState, setCbzSaveState] = useState('idle');
  const cbzSaveTimerRef = useRef(null);
  const showCbzSaveStatus = useCallback((state, ms) => {
    if (cbzSaveTimerRef.current) clearTimeout(cbzSaveTimerRef.current);
    setCbzSaveState(state);
    if (ms > 0) {
      cbzSaveTimerRef.current = setTimeout(() => {
        setCbzSaveState('idle');
        cbzSaveTimerRef.current = null;
      }, ms);
    }
  }, []);
  useEffect(() => () => {
    if (cbzSaveTimerRef.current) clearTimeout(cbzSaveTimerRef.current);
  }, []);
  const [isScrollIdle, setIsScrollIdle] = useState(true);

  // مرحله ۱۵ — پیشرفتِ ری‌رندر: مجموعهٔ فریم‌هایِ بارگذاری‌شدهٔ
  // کتابِ جاری (در ref تا بازرندرِ اضافه نسازد) + شمارندهٔ پنجرهٔ
  // دیدنیِ جاری. HUD، فقط وقتی نشان داده می‌شود که رندر، بیش از
  // ۳۰۰ میلی‌ثانیه طول بکشد تا اسکرول‌هایِ سریع، چشمک نزنند؛
  // حالتِ «کامل شد» هم فقط وقتی نشان داده می‌شود که HUD، قبلاً
  // در همین نشستِ رندر دیده شده باشد.
  // مرحله ۱۶ — HUDِ ری‌رندر، فقط هنگامِ تغییرِ زوم (نه اسکرول و
  // نه باز شدنِ کتاب). در این ویوور، زوم فقط عرضِ CSS است و
  // تصویرها دوباره بارگذاری نمی‌شوند؛ پس تایمرِ محافظِ ۱۲۰۰
  // میلی‌ثانیه، تکمیل‌کنندهٔ اصلی است و onFrameRendered فقط
  // بارگذاری‌هایِ واقعی (تغییرِ منبع یا خطایِ نهایی) را جلو می‌اندازد.
  const visibleIndicesRef = useRef([]);
  const zoomHudSessionRef = useRef(null);
  const zoomHudSafetyRef = useRef(null);
  const zoomHudGreenRef = useRef(null);
  const prevZoomRef = useRef(null);
  const [zoomHud, setZoomHud] = useState({ visible: false, done: 0, total: 0, isDone: false });

  const completeZoomHud = useCallback(() => {
    const session = zoomHudSessionRef.current;
    if (!session) return;
    if (zoomHudSafetyRef.current) { clearTimeout(zoomHudSafetyRef.current); zoomHudSafetyRef.current = null; }
    setZoomHud((prev) => ({ ...prev, visible: true, done: prev.total, isDone: true }));
    if (zoomHudGreenRef.current) clearTimeout(zoomHudGreenRef.current);
    zoomHudGreenRef.current = setTimeout(() => {
      zoomHudSessionRef.current = null;
      setZoomHud({ visible: false, done: 0, total: 0, isDone: false });
    }, 800);
  }, []);

  const containerRef = useRef(null);

  // مرحلهٔ ۴۰ §۴: حالتِ افقیِ صفحه‌ای (CBZ/مانگا) — کانتینرِ جدا،
  // صفحهٔ جاریِ جدا، و جهتِ ورق برایِ انیمیشن.
  const hContainerRef = useRef(null);
  const hPageIndexRef = useRef(0);
  const hFlipDirRef = useRef(1);
  const hWheelAtRef = useRef(0);
  // مرحلهٔ ۴۲ §۳: ثبت لحظه رسیدن به لبه اسکرول (گیت دوگامی چرخ ماوس)
  // و پنجره محافظت پس از ورق خودکار (تا اسکرول ناشی از ورق، ورق دیگری نسازد).
  const edgeReachedAtRef = useRef(0);
  const programmaticScrollUntilRef = useRef(0);
  const hSyncKeyRef = useRef('');
  const isHorizontalPagedRef = useRef(false);
  const [hPageIndex, setHPageIndex] = useState(0);
  const [hEntering, setHEntering] = useState(false);
  // مرحلهٔ ۴۳ §۴: چیدمان افقی — تک‌برگ (پیش‌فرض) یا دو‌صفحه‌ای کنار هم.
  const [isDoubleSpread, setIsDoubleSpread] = useState(false);

  // مرحله ۱۵ — درگِ چهارجهته با ماوس (دکمهٔ چپ در مطالعهٔ عادی،
  // دکمهٔ وسط در هر حالتی؛ جزئیاتِ کامل در useDragPan). این فراخوان،
  // عمداً پس از اعلانِ containerRef است تا TDZ نگیرد.
  const { handlePanMouseDown, isPanning } = useDragPan({
    containerRef,
    isAnnotationActive,
    isAreaZoomActive,
  });
  // مرحلهٔ ۴۰ §۴: درگِ چهارجهته برایِ کانتینرِ افقی (نمونهٔ دومِ هوک —
  // هر دو نمونه، همیشه و بدونِ شرط صدا زده می‌شوند).
  const { handlePanMouseDown: handleHPanMouseDown, isPanning: isHPanning } = useDragPan({
    containerRef: hContainerRef,
    isAnnotationActive,
    isAreaZoomActive,
  });
  const [containerWidth, setContainerWidth] = useState(0);

  // یکسان‌سازی با PdfViewer: عرضِ کانتینر باید با تغییرِ اندازهٔ
  // پنجره هم به‌روز شود، وگرنه عرضِ کادرِ چرخیده (frameWidth) که از
  // آن حساب می‌شود، کهنه می‌ماند و لایهٔ چرخیده، دوباره از کادر
  // بیرون می‌زند. نگهبانِ ۲ پیکسلی، از رندرِ بیهوده جلوگیری می‌کند.
  useEffect(() => {
    const measure = () => {
      const c = containerRef.current || hContainerRef.current;
      if (!c) return;
      const w = Math.round(c.clientWidth || 0);
      setContainerWidth((prev) => (Math.abs(w - prev) > 2 ? w : prev));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  const hasResumedRef = useRef(false);
  const isResumingRef = useRef(false);
  const predecodedMapRef = useRef(new Map());
  const scrollIdleTimerRef = useRef(null);

  const items = comicData?.items || [];
  const itemsCount = items.length;
  const jumpToPage = useReaderStore((state) => state.jumpToPage);
  // مرحلهٔ ۳۹ §۵: ویرایشِ مستقیمِ شمارهٔ صفحه از رویِ نشانگرِ پایین-راست.
  const [isEditingPageHud, setIsEditingPageHud] = useState(false);
  const [pageHudDraft, setPageHudDraft] = useState('');
  const [pageHudHovered, setPageHudHovered] = useState(false);
  const commitHudJump = useCallback(() => {
    const n = Math.max(1, Math.min(itemsCount, Number(pageHudDraft) || 1));
    setIsEditingPageHud(false);
    jumpToPage(n);
  }, [itemsCount, pageHudDraft, jumpToPage]);
  const currentFilePath = resolveActiveBookKey(comicData, null);
  // مرحلهٔ ۴۴ §۴: دکمه‌هایِ ذخیره فقط وقتی فایلِ آرشیوِ CBZ/ZIP باز است
  // (پوشهٔ عکس و RAR/CBR — که JSZip نمی‌خواند — دکمه ندارند).
  const isCbzArchive = comicData?.type === 'zip' && typeof currentFilePath === 'string' && /\.(cbz|zip)$/i.test(currentFilePath);

  // مرحلهٔ ۴۰ §۴: حالتِ نمایش (عمودی/افقیِ صفحه‌ای).
  const comicViewMode = useReaderStore((state) => state.comicViewMode || 'vertical');
  const isHorizontalPaged = comicViewMode === 'horizontal-paged';
  // همگام‌سازیِ ref با جدیدترین مقدار (برایِ افکتِ resume که
  // isHorizontalPaged را در deps ندارد تا با تغییرِ حالت، دوباره اجرا نشود).
  useEffect(() => {
    isHorizontalPagedRef.current = isHorizontalPaged;
  });

  // مرحلهٔ ۴۰ §۴: رفتن به صفحهٔ N در حالتِ افقی — با انیمیشنِ ورود،
  // ریستِ اسکرولِ صحنه، و همگام‌سازیِ استور/آمار (آینهٔ افکتِ ۷).
  const goToHorizontalPage = useCallback((nextIndex) => {
    if (itemsCount === 0) return;
    const clamped = Math.max(0, Math.min(itemsCount - 1, nextIndex));
    const prev = hPageIndexRef.current;
    hPageIndexRef.current = clamped;
    setHPageIndex(clamped);
    hFlipDirRef.current = clamped >= prev ? 1 : -1;
    setHEntering(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setHEntering(false));
    });
    if (hContainerRef.current) {
      hContainerRef.current.scrollLeft = 0;
      hContainerRef.current.scrollTop = 0;
    }
    setCurrentPage(clamped + 1);
    try { readingActivity.visitPage(clamped + 1); } catch (_) {}
    try { updateReadingProgress(currentFilePath, clamped + 1, itemsCount); } catch (_) {}
  }, [itemsCount, currentFilePath, setCurrentPage, updateReadingProgress]);

  // مرحلهٔ ۴۳ §۴: در حالت دو‌صفحه‌ای، هر ورق دو صفحه جلو می‌رود؛
  // در تک‌برگ، یک صفحه (مثل قبل).
  const flipHorizontalPage = useCallback((dir) => {
    goToHorizontalPage(hPageIndexRef.current + dir * (isDoubleSpread ? 2 : 1));
  }, [goToHorizontalPage, isDoubleSpread]);

  // مرحلهٔ ۴۰ §۴: ورود به حالتِ افقی (یا عوض شدنِ فایل) — صفحهٔ
  // افقی از صفحهٔ جاریِ استور شروع می‌شود.
  useEffect(() => {
    if (!isHorizontalPaged) return;
    const key = `${currentFilePath}::${itemsCount}`;
    if (hSyncKeyRef.current === key) return;
    hSyncKeyRef.current = key;
    const p = Math.max(0, Math.min(itemsCount - 1, (useReaderStore.getState().currentPage || 1) - 1));
    hPageIndexRef.current = p;
    setHPageIndex(p);
  }, [isHorizontalPaged, currentFilePath, itemsCount]);

  // مرحلهٔ ۴۰ §۴: پیش‌دیکدِ صفحاتِ همسایه در VRAM (GPU Image Pre-Decoding).
  useEffect(() => {
    if (!isHorizontalPaged) return;
    const keepUrls = new Set();
    // مرحلهٔ ۴۳ §۴: در دو‌صفحه‌ای، برگ دوم جفت بعدی هم پیش‌دیکد می‌شود.
    for (const ni of [hPageIndex - 1, hPageIndex, hPageIndex + 1, hPageIndex + 2]) {
      if (ni < 0 || ni >= itemsCount) continue;
      const raw = items[ni]?.path || items[ni]?.filePath || '';
      if (!raw) continue;
      const url = buildComicImageUrl(raw);
      if (!url) continue;
      keepUrls.add(url);
      if (predecodedMapRef.current.has(url)) continue;
      try {
        const img = new Image();
        img.src = url;
        if (typeof img.decode === 'function') img.decode().catch(() => {});
        predecodedMapRef.current.set(url, img);
      } catch (_) {}
    }
    for (const key of Array.from(predecodedMapRef.current.keys())) {
      if (!keepUrls.has(key)) predecodedMapRef.current.delete(key);
    }
  }, [isHorizontalPaged, hPageIndex, items, itemsCount]);

  // مرحلهٔ ۴۰ §۴: ورق زدن با ArrowLeft/ArrowRight (فازِ capture تا
  // useKeyboardِ سراسری، آن را به‌عنوانِ صفحهٔ بعدی/قبلی نخواند).
  useEffect(() => {
    if (!isHorizontalPaged) return undefined;
    const onKey = (e) => {
      const t = e.target;
      if (t && (t.closest?.('input, textarea, select') || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        programmaticScrollUntilRef.current = Date.now() + 500;
        flipHorizontalPage(1);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        programmaticScrollUntilRef.current = Date.now() + 500;
        flipHorizontalPage(-1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isHorizontalPaged, flipHorizontalPage]);

  // مرحلهٔ ۴۰ §۴: چرخِ ماوس در لبه‌هایِ اسکرول، صفحه را ورق می‌زند
  // (فقط وقتی در آن جهت، دیگر جایی برایِ اسکرول نیست).
  useEffect(() => {
    if (!isHorizontalPaged) return undefined;
    const el = hContainerRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const now = Date.now();
      // مرحلهٔ ۴۲ §۳: تا ۵۰۰ میلی‌ثانیه پس از ورق خودکار (دکمه/کلید)،
      // چرخ ماوس نادیده گرفته می‌شود تا اسکرول ناشی از ورق، ورق دیگری نسازد.
      if (now < programmaticScrollUntilRef.current) return;
      if (now - hWheelAtRef.current < 400) return;
      const el = hContainerRef.current;
      if (!el) return;
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const canScrollDown = el.scrollTop < maxScrollTop - 2;
      const canScrollUp = el.scrollTop > 2;
      const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
      const canScrollRight = el.scrollLeft < maxScrollLeft - 2;
      const canScrollLeft = el.scrollLeft > 2;
      // ژست عمودی‌غالب: تا وقتی جای اسکرول هست، بگذار طبیعی اسکرول شود؛
      // در لبه، لمس اول فقط ثبت می‌شود و لمس دوم (پس از ۳۸۰ میلی‌ثانیه
      // و با شدت بیش از ۳۵) ورق می‌زند.
      if (Math.abs(e.deltaY) >= Math.abs(e.deltaX || 0)) {
        if (e.deltaY > 0 && canScrollDown) {
          edgeReachedAtRef.current = 0;
          return;
        }
        if (e.deltaY < 0 && canScrollUp) {
          edgeReachedAtRef.current = 0;
          return;
        }
        if (e.deltaY === 0) return;
        if (edgeReachedAtRef.current === 0) {
          edgeReachedAtRef.current = now;
          return;
        }
        if (now - edgeReachedAtRef.current >= 380 && Math.abs(e.deltaY) > 35) {
          e.preventDefault();
          hWheelAtRef.current = now;
          programmaticScrollUntilRef.current = now + 500;
          flipHorizontalPage(e.deltaY > 0 ? 1 : -1);
          edgeReachedAtRef.current = 0;
        }
        return;
      }
      // ژست افقی‌غالب: تا وقتی جای پن هست، بگذار طبیعی پن شود؛
      // در لبه افقی، فوراً ورق می‌زند.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) * 1.5) {
        if (e.deltaX > 0 && canScrollRight) return;
        if (e.deltaX < 0 && canScrollLeft) return;
        if (e.deltaX === 0) return;
        e.preventDefault();
        hWheelAtRef.current = now;
        programmaticScrollUntilRef.current = now + 500;
        flipHorizontalPage(e.deltaX > 0 ? 1 : -1);
        edgeReachedAtRef.current = 0;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isHorizontalPaged, flipHorizontalPage]);

  // مرحله ۱۳: بوک‌مارک‌هایِ دیجیتالِ فایلِ جاری.
  const pageBookmarkList = useBookmarkStore((state) => state.bookmarksByFile[normalizeBookKey(currentFilePath)] || EMPTY_PAGE_BOOKMARKS);
  const bookmarkPreferences = useBookmarkStore((state) => state.preferences);
  const loadBookmarksForFile = useBookmarkStore((state) => state.loadBookmarksForFile);
  const loadBookmarkPreferences = useBookmarkStore((state) => state.loadPreferences);
  const deleteBookmark = useBookmarkStore((state) => state.deleteBookmark);
  const updateBookmark = useBookmarkStore((state) => state.updateBookmark);
  const openBookmarkStudio = useBookmarkStore((state) => state.openStudio);
  const bookmarkJumpTarget = useBookmarkStore((state) => state.jumpTarget);
  const clearBookmarkJumpTarget = useBookmarkStore((state) => state.clearJumpTarget);

  useEffect(() => {
    if (!currentFilePath) return;
    loadBookmarksForFile(currentFilePath);
    loadBookmarkPreferences();
  }, [currentFilePath, loadBookmarksForFile, loadBookmarkPreferences]);

  const pageBookmarkMap = useMemo(() => {
    const map = {};
    (pageBookmarkList || []).forEach((bm) => {
      if (!map[bm.page]) map[bm.page] = [];
      map[bm.page].push(bm);
    });
    return map;
  }, [pageBookmarkList]);

  const handleOpenBookmark = useCallback((bm) => {
    if (!bm) return;
    openBookmarkStudio({ filePath: currentFilePath, page: bm.page, yRatio: bm.yRatio, bookmarkId: bm.id });
  }, [openBookmarkStudio, currentFilePath]);

  const handleDeleteBookmark = useCallback((bm) => {
    if (!bm) return;
    deleteBookmark(currentFilePath, bm.id);
  }, [deleteBookmark, currentFilePath]);

  const handleRenameBookmark = useCallback((bm, newName) => {
    if (!bm) return;
    updateBookmark(currentFilePath, bm.id, { name: newName });
  }, [updateBookmark, currentFilePath]);

  // مرحله ۱۸ — ثبتِ مکانِ تازهٔ بوک‌مارک پس از پایانِ درگ (فقط یک
  // ذخیره در pointerup؛ در حینِ حرکت، هیچ IPCای صدا زده نمی‌شود).
  const handleMoveBookmark = useCallback((bm, patch) => {
    if (!bm || !patch) return;
    updateBookmark(currentFilePath, bm.id, patch);
  }, [updateBookmark, currentFilePath]);

  // Minimum zoom lowered from 40% to 10% (0.1) per user requirement
  const safeZoom = Math.min(3.5, Math.max(0.1, Number(zoomLevel) || 1));
  // عرضِ واقعیِ هر کادر = عرضِ کانتینر × ضریبِ زوم (همان درصدی که
  // zoomWrapper با آن ساخته می‌شود؛ بدونِ کف، چون wrapper هم کفی
  // ندارد). تا قبل از اندازه‌گیری، صفر است و کادر، چیدمانِ قدیمی را
  // نگه می‌دارد.
  const frameWidth = containerWidth > 0
    ? Math.round(containerWidth * (Math.round(safeZoom * 100) / 100))
    : 0;
  const safePageGap = Math.max(0, Math.min(48, Math.round(Number(comicPageGap) || 0)));

  const {
    visibleIndices,
    paddingTop,
    paddingBottom,
    heights,
    offsets,
    recordImageDimensions,
    scrollToIndex,
    activePageIndex,
    isJumping,
  } = useVirtualScroll({
    items,
    itemsCount,
    containerRef,
    estimatedItemHeight: 1200,
    overscan: 3,
    zoomLevel: safeZoom,
    pageGap: safePageGap,
    filePath: currentFilePath,
  });
  visibleIndicesRef.current = visibleIndices;

  // مرحلهٔ ۴۳ §۱: ورق با دکمه‌های نشانگر پایین-راست — ناوبری عمدی
  // مستقیم (نه چرخ ماوس) تا با گیت لبه مرحله ۴۲ تداخل نکند؛ در
  // افقی، پنجره ۵۰۰ میلی‌ثانیه‌ای محافظ ورق هم ست می‌شود.
  const goHudPage = useCallback((dir) => {
    if (isHorizontalPaged) {
      programmaticScrollUntilRef.current = Date.now() + 500;
      flipHorizontalPage(dir);
    } else {
      jumpToPage(Math.max(1, Math.min(itemsCount, activePageIndex + 1 + dir)));
    }
  }, [isHorizontalPaged, flipHorizontalPage, jumpToPage, itemsCount, activePageIndex]);

  useEffect(() => {
    if (zoomHudSafetyRef.current) clearTimeout(zoomHudSafetyRef.current);
    if (zoomHudGreenRef.current) clearTimeout(zoomHudGreenRef.current);
    zoomHudSessionRef.current = null;
    prevZoomRef.current = null;
    setZoomHud({ visible: false, done: 0, total: 0, isDone: false });
  }, [currentFilePath]);



  const handleFrameRendered = useCallback((index) => {
    const session = zoomHudSessionRef.current;
    if (!session || typeof index !== 'number') return;
    if (!session.targets.has(index)) return;
    session.done.add(index);
    setZoomHud((prev) => ({ ...prev, done: session.done.size }));
    if (session.done.size >= session.targets.size) completeZoomHud();
  }, [completeZoomHud]);

  useEffect(() => {
    if (!currentFilePath) return undefined;
    const prev = prevZoomRef.current;
    if (prev && prev.file === currentFilePath && prev.zoom === safeZoom) return undefined;
    const changedFile = !prev || prev.file !== currentFilePath;
    prevZoomRef.current = { file: currentFilePath, zoom: safeZoom };
    if (changedFile) {
      if (zoomHudSafetyRef.current) clearTimeout(zoomHudSafetyRef.current);
      if (zoomHudGreenRef.current) clearTimeout(zoomHudGreenRef.current);
      zoomHudSessionRef.current = null;
      setZoomHud({ visible: false, done: 0, total: 0, isDone: false });
      return undefined;
    }
    const targets = new Set(visibleIndicesRef.current || []);
    if (targets.size === 0) return undefined;
    if (zoomHudSafetyRef.current) clearTimeout(zoomHudSafetyRef.current);
    if (zoomHudGreenRef.current) clearTimeout(zoomHudGreenRef.current);
    zoomHudSessionRef.current = { targets, done: new Set() };
    setZoomHud({ visible: true, done: 0, total: targets.size, isDone: false });
    // مرحلهٔ ۶۰ — حذف تایمر ۱۲۰۰ میلی‌ثانیه‌ای فیک ۱۰۰٪؛ تایمر محافظ فقط برای لغو آرام پس از ۱۵ ثانیه است
    zoomHudSafetyRef.current = setTimeout(() => {
      zoomHudSessionRef.current = null;
      setZoomHud({ visible: false, done: 0, total: 0, isDone: false });
    }, 15000);
    return () => {
      if (zoomHudSafetyRef.current) clearTimeout(zoomHudSafetyRef.current);
    };
  }, [safeZoom, currentFilePath, completeZoomHud]);


  // ۱. تشخیص توقف اسکرول برای فعال‌سازی پاس دوم وضوح تصویر (Dual-Pass Crispness)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScrollActivity = () => {
      setIsScrollIdle(false);
      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = setTimeout(() => {
        setIsScrollIdle(true);
        triggerHiDpiRender?.();
      }, 180);
    };

    container.addEventListener('scroll', handleScrollActivity, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScrollActivity);
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
    };
  }, [triggerHiDpiRender]);

  // ۲. قفل دقیق اسکرول افقی و عمودی روی مرکز کادر کشیده‌شده در «زوم باکسی» (AreaZoomOverlay)
  useEffect(() => {
    if (!areaZoomTarget || !containerRef.current) return;

    requestAnimationFrame(() => {
      const c = containerRef.current;
      if (!c) return;

      const { normCenterX = 0.5, normCenterY = 0.5, rect } = areaZoomTarget;


      // مرحله ۲۵ — تأیید و تصحیحِ دومرحله‌ای: اگر چیدمانِ ستون
      // هنوز با زومِ تازه ننشسته بود، یک فریم بعد، موقعیتِ واقعی
      // با هدف مقایسه و در صورتِ اختلافِ بیش از ۲ پیکسل، یک بارِ
      // دیگر ست می‌شود. (منطقِ اصلی، همان normCenter × scrollWidth
      // است که با نرم‌هایِ کانتینرِ تازهٔ اورلی، دقیق شده است.)
      const applyLanding = () => {
        let top = 0;
        if (
          rect?.pageNumber &&
          rect.pageNumber >= 1 &&
          rect.pageNumber <= itemsCount &&
          heights
        ) {
          const idx = rect.pageNumber - 1;
          let pageTop = 0;
          if (offsets && offsets[idx] !== undefined) {
            pageTop = offsets[idx];
          } else {
            for (let i = 0; i < idx; i++) {
              pageTop += (heights[i] || 1200) + safePageGap;
            }
          }
          const pageH = heights[idx] || 1200;
          const relY = typeof rect.pageRelativeY === 'number' ? rect.pageRelativeY : 0.5;
          top = pageTop + pageH * relY - c.clientHeight / 2;
        } else {
          top = normCenterY * c.scrollHeight - c.clientHeight / 2;
        }
        const left = normCenterX * c.scrollWidth - c.clientWidth / 2;
        c.scrollTop = Math.max(0, top);
        c.scrollLeft = Math.max(0, left);
        return { top: Math.max(0, top), left: Math.max(0, left) };
      };
      const first = applyLanding();
      requestAnimationFrame(() => {
        const cc = containerRef.current;
        if (!cc) {
          clearAreaZoomTarget();
          return;
        }
        if (
          Math.abs(cc.scrollTop - first.top) > 2 ||
          Math.abs(cc.scrollLeft - first.left) > 2
        ) {
          applyLanding();
        }
        clearAreaZoomTarget();
      });
    });
  }, [
    areaZoomTarget,
    itemsCount,
    heights,
    offsets,
    safePageGap,
    clearAreaZoomTarget,
  ]);

  // ۳. واکشی یک‌باره تمام یادداشت‌ها و هایلایت‌های ذخیره‌شده این کمیک از دیتابیس
  useEffect(() => {
    let isMounted = true;
    setAnnotationsByPage({});
    setUndoStack([]);
    setRedoStack([]);

    if (!currentFilePath) return;
    if (!coreApi.isAvailable()) {
      // فاز ۴، بخش ۳: بدونِ Electron، دیتابیس در دسترس نیست؛ فقط از
      // پشتیبانِ localStorage بخوان تا حاشیه‌نویسی‌ها با بستنِ برنامه
      // از بین نروند.
      setAnnotationsByPage(annotationLocalBackup.restoreBackupsAsPages(currentFilePath));
      return;
    }

    coreApi
      .dbAction({
        action: 'GET_ANNOTATIONS',
        payload: { filePath: currentFilePath },
      })
      .then((res) => {
        if (!isMounted) return;
        const dbPages = res?.annotations && typeof res.annotations === 'object' ? res.annotations : {};
        // فاز ۴، بخش ۳: آینهٔ localStorage فقط جاهای خالیِ دیتابیس را پر
        // می‌کند (دیتابیس، حتی با آرایهٔ خالی، برنده است).
        const merged = annotationLocalBackup.mergeBackupsIntoPages(currentFilePath, dbPages);
        setAnnotationsByPage(merged.pages);
        // ترمیم: صفحه‌هایی که فقط در پشتیبان بودند، به دیتابیس هم برگردند.
        if (coreApi.isAvailable()) {
          merged.healed.forEach((({ pageNum, items }) => {
            coreApi.savePageAnnotations(currentFilePath, pageNum, items).catch(() => {});
          }));
        }
        // مرحلهٔ ۴۴ §۴: بارگذاریِ خودکارِ مانیفستِ جاسازی‌شده — فقط
        // وقتی دیتابیسِ محلی (با آینهٔ محلی) برایِ این فایل، هیچ
        // حاشیه‌نویسی‌ای ندارد؛ دیتابیس مقدم است و هرگز رونویسی نمی‌شود.
        const mergedHasAny = Object.values(merged.pages || {}).some((arr) => Array.isArray(arr) && arr.length > 0);
        if (!mergedHasAny && coreApi.isAvailable()) {
          coreApi.getEmbeddedCbzAnnotations(currentFilePath).then((emb) => {
            if (!isMounted) return;
            if (!emb || !emb.success || !emb.hasManifest) return;
            const embPages = emb.annotationsByPage && typeof emb.annotationsByPage === 'object' ? emb.annotationsByPage : {};
            const embHasAny = Object.values(embPages).some((arr) => Array.isArray(arr) && arr.length > 0);
            if (!embHasAny) return;
            setAnnotationsByPage(embPages);
            Object.entries(embPages).forEach(([pageNum, items]) => {
              if (Array.isArray(items) && items.length > 0) {
                coreApi.savePageAnnotations(currentFilePath, pageNum, items).catch(() => {});
                annotationLocalBackup.writePageBackup(currentFilePath, pageNum, items);
              }
            });
            showToast('حاشیه‌نویسی‌های ذخیره‌شده در فایل بازیابی شد.', { type: 'info' });
          }).catch(() => {});
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [currentFilePath]);

  const handleCommitPageAnnotations = useCallback(
    (pageNum, nextPageItems) => {
      const pageKey = String(pageNum);
      setAnnotationsByPage((prev) => {
        const prevItems = prev[pageKey] || [];
        setUndoStack((u) => [
          ...u.slice(-29),
          { pageNum, prevItems, nextItems: nextPageItems },
        ]);
        setRedoStack([]);
        return {
          ...prev,
          [pageKey]: nextPageItems,
        };
      });

      if (currentFilePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(currentFilePath, pageNum, nextPageItems)
          .catch(() => {});
      }
      // فاز ۴، بخش ۳: آینهٔ localStorage — هرگز throw نمی‌کند و روی
      // مسیرِ دیتابیس اثر نمی‌گذارد.
      annotationLocalBackup.writePageBackup(currentFilePath, pageNum, nextPageItems);
    },
    [currentFilePath]
  );

  // مرحلهٔ ۵۰ §۲ (ب): انتقالِ بین‌صفحه‌ایِ حاشیه‌نویسی — آینهٔ
  // PdfViewer: یک تراکنشِ واحد برای هر دو صفحه + دقیقاً یک ورودیِ
  // Undo (با پرچمِ transfer تا Undo/Redo هر دو صفحه را با هم برگردانند).
  const handleTransferItemsToPage = useCallback(
    (sourcePage, targetPage, movedItems, remainingSourceItems) => {
      const src = Number(sourcePage);
      const tgt = Number(targetPage);
      if (!Number.isFinite(src) || !Number.isFinite(tgt) || src === tgt) return;
      if (!Array.isArray(movedItems) || movedItems.length === 0) return;
      const srcKey = String(src);
      const tgtKey = String(tgt);
      const prevSourceItems = annotationsByPageRef.current[srcKey] || [];
      const prevTargetItems = annotationsByPageRef.current[tgtKey] || [];
      const nextSourceItems = Array.isArray(remainingSourceItems) ? remainingSourceItems : prevSourceItems;
      const nextTargetItems = [...prevTargetItems, ...movedItems];
      setUndoStack((u) => [
        ...u.slice(-29),
        {
          pageNum: src,
          prevItems: prevSourceItems,
          nextItems: nextSourceItems,
          transfer: {
            targetPage: tgt,
            targetPrevItems: prevTargetItems,
            targetNextItems: nextTargetItems,
          },
        },
      ]);
      setRedoStack([]);
      setAnnotationsByPage((prev) => ({
        ...prev,
        [srcKey]: nextSourceItems,
        [tgtKey]: nextTargetItems,
      }));
      if (currentFilePath && coreApi.isAvailable()) {
        coreApi.savePageAnnotations(currentFilePath, src, nextSourceItems).catch(() => {});
        coreApi.savePageAnnotations(currentFilePath, tgt, nextTargetItems).catch(() => {});
      }
      annotationLocalBackup.writePageBackup(currentFilePath, src, nextSourceItems);
      annotationLocalBackup.writePageBackup(currentFilePath, tgt, nextTargetItems);
    },
    [currentFilePath]
  );

  const handleUndoAnnotation = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const lastAction = prevUndo[prevUndo.length - 1];
      const pageKey = String(lastAction.pageNum);

      // مرحلهٔ ۵۰ §۲ (ب): Undoی انتقال، هر دو صفحه را با هم برمی‌گرداند.
      setAnnotationsByPage((prevMap) => {
        const nextMap = { ...prevMap, [pageKey]: lastAction.prevItems };
        if (lastAction.transfer) {
          nextMap[String(lastAction.transfer.targetPage)] = lastAction.transfer.targetPrevItems;
        }
        return nextMap;
      });
      setRedoStack((r) => [...r, lastAction]);

      if (currentFilePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(
            currentFilePath,
            lastAction.pageNum,
            lastAction.prevItems
          )
          .catch(() => {});
        if (lastAction.transfer) {
          coreApi
            .savePageAnnotations(
              currentFilePath,
              lastAction.transfer.targetPage,
              lastAction.transfer.targetPrevItems
            )
            .catch(() => {});
        }
      }
      annotationLocalBackup.writePageBackup(currentFilePath, lastAction.pageNum, lastAction.prevItems);
      if (lastAction.transfer) {
        annotationLocalBackup.writePageBackup(currentFilePath, lastAction.transfer.targetPage, lastAction.transfer.targetPrevItems);
      }
      return prevUndo.slice(0, -1);
    });
  }, [currentFilePath]);

  const handleRedoAnnotation = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const nextAction = prevRedo[prevRedo.length - 1];
      const pageKey = String(nextAction.pageNum);

      // مرحلهٔ ۵۰ §۲ (ب): Redoی انتقال، هر دو صفحه را با هم جلو می‌برد.
      setAnnotationsByPage((prevMap) => {
        const nextMap = { ...prevMap, [pageKey]: nextAction.nextItems };
        if (nextAction.transfer) {
          nextMap[String(nextAction.transfer.targetPage)] = nextAction.transfer.targetNextItems;
        }
        return nextMap;
      });
      setUndoStack((u) => [...u, nextAction]);

      if (currentFilePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(
            currentFilePath,
            nextAction.pageNum,
            nextAction.nextItems
          )
          .catch(() => {});
        if (nextAction.transfer) {
          coreApi
            .savePageAnnotations(
              currentFilePath,
              nextAction.transfer.targetPage,
              nextAction.transfer.targetNextItems
            )
            .catch(() => {});
        }
      }
      annotationLocalBackup.writePageBackup(currentFilePath, nextAction.pageNum, nextAction.nextItems);
      if (nextAction.transfer) {
        annotationLocalBackup.writePageBackup(currentFilePath, nextAction.transfer.targetPage, nextAction.transfer.targetNextItems);
      }
      return prevRedo.slice(0, -1);
    });
  }, [currentFilePath]);

  const handleClearCurrentPageAnnotations = useCallback(() => {
    const pageNum = activePageIndex + 1;
    handleCommitPageAnnotations(pageNum, []);
    showToast(`یادداشت‌های صفحه ${pageNum} پاک شد`, { type: 'info' });
  }, [activePageIndex, handleCommitPageAnnotations, showToast]);

  // مرحلهٔ ۴۴ §۴: ذخیرهٔ CBZِ حاشیه‌نویسی‌شده — آینهٔ
  // handleExportAnnotatedPdfی PdfViewer با همان دو mode و همان پیام‌ها؛
  // فقط آماده‌سازی فرق دارد: هر صفحهٔ دارایِ حاشیه‌نویسی، با
  // bakeCbzPageImage پخته می‌شود و مانیفستِ کامل هم فرستاده می‌شود.
  const handleExportAnnotatedCbz = useCallback(async (mode = 'save-as') => {
    if (isExportingCbz) return;
    if (!coreApi.isAvailable()) {
      showCbzSaveStatus('error', 6000);
      showToast('خروجی فقط در نسخهٔ دسکتاپ در دسترس است.', { type: 'warning' });
      return;
    }
    if (!isCbzArchive) {
      showCbzSaveStatus('error', 6000);
      showToast('ذخیرهٔ مستقیم فقط برای فایل‌های CBZ و ZIP است.', { type: 'warning' });
      return;
    }
    const saveMode = mode === 'in-place' ? 'in-place' : 'save-as';
    const pages = annotationsByPage || {};
    const annotatedCount = Object.values(pages).reduce(
      (n, items) => n + (Array.isArray(items) ? items.length : 0),
      0
    );
    if (annotatedCount === 0 && saveMode !== 'in-place') {
      showCbzSaveStatus('info', 4500);
      showToast('هنوز حاشیه‌نویسی‌ای روی این فایل نیست.', { type: 'info' });
      return;
    }
    setIsExportingCbz(true);
    showCbzSaveStatus(saveMode === 'in-place' ? 'saving-inplace' : 'saving-as', 0);
    showToast('در حالِ آماده‌سازیِ خروجی…', { type: 'info' });
    try {
      const bakedPages = {};
      let totalItems = 0;
      let bakedCount = 0;
      let skippedCount = 0;
      const pageNumbers = Object.keys(pages)
        .map(Number)
        .filter((n) => Number.isFinite(n) && Array.isArray(pages[n]) && pages[n].length > 0)
        .sort((a, b) => a - b);
      for (const pageNum of pageNumbers) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        const itemsForPage = pages[pageNum];
        totalItems += itemsForPage.length;
        const item = items[pageNum - 1];
        const rawPath = item?.path || item?.filePath || '';
        if (!rawPath) { skippedCount++; continue; }
        try {
          const baked = await bakeCbzPageImage(rawPath, itemsForPage, rotation);
          if (!baked) { skippedCount++; continue; }
          bakedPages[pageNum] = baked;
          bakedCount++;
        } catch (_) { skippedCount++; }
      }
      if (annotatedCount > 0 && bakedCount === 0) {
        showCbzSaveStatus('info', 4500);
        showToast('حاشیه‌نویسیِ قابلِ خروجی پیدا نشد.', { type: 'info' });
        return;
      }
      const result = await coreApi.exportAnnotatedCbz({
        cbzPath: currentFilePath,
        mode: saveMode,
        pages: bakedPages,
        annotationsByPage: pages,
      });
      if (result && result.canceled) {
        showCbzSaveStatus('info', 4500);
        showToast('ذخیرهٔ فایل لغو شد.', { type: 'info' });
        return;
      }
      if (result && result.success) {
        const savedName = String((result && result.outputPath) || currentFilePath || '').split(/[\\/]/).pop() || '';
        const savedTime = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const savedSuffix = savedName ? ' (' + savedName + '، ' + savedTime + ')' : '';
        const skippedSuffix = skippedCount > 0 ? ` (${skippedCount} صفحه رد شد)` : '';
        if (result.restoredClean) {
          showCbzSaveStatus('saved-inplace', 4500);
          showToast('فایل به حالتِ بدونِ حاشیه‌نویسی برگشت.' + savedSuffix, { type: 'success' });
        } else if (saveMode === 'in-place') {
          showCbzSaveStatus('saved-inplace', 4500);
          showToast(
            `روی همین فایل ذخیره شد: ${totalItems} حاشیه‌نویسی در ${bakedCount} صفحه.${skippedSuffix}`,
            { type: 'success' }
          );
        } else {
          showCbzSaveStatus('saved-as', 4500);
          showToast(
            `فایل با ${totalItems} حاشیه‌نویسی در ${bakedCount} صفحه ذخیره شد.${skippedSuffix}`,
            { type: 'success' }
          );
        }
      } else if (result && result.locked) {
        showCbzSaveStatus('error', 6000);
        showToast('فایل در برنامهٔ دیگری باز است؛ آن را ببندید و دوباره تلاش کنید. فایلِ اصلی دست نخورده است.', { type: 'error' });
      } else {
        showCbzSaveStatus('error', 6000);
        showToast((result && result.error) || 'ذخیرهٔ حاشیه‌نویسی‌ها انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      showCbzSaveStatus('error', 6000);
      showToast('آماده‌سازیِ خروجی انجام نشد: ' + (err && err.message ? err.message : String(err)), { type: 'error' });
    } finally {
      setIsExportingCbz(false);
    }
  }, [annotationsByPage, currentFilePath, isCbzArchive, isExportingCbz, rotation, showToast, showCbzSaveStatus]);

  // مرحله ۳ ـ بخش الف (ممیزی §۲.۶): گیتِ وارونه اصلاح شد تا دقیقاً
  // هم‌تراز با PdfViewer باشد: وقتی استودیو روشن است، فقط تولبار
  // Undo/Redo را مدیریت می‌کند و این شنونده خاموش می‌ماند؛ وقتی
  // استودیو خاموش است، خودِ ویوور Undo/Redo حاشیه‌نویسی‌های صفحه
  // را انجام می‌دهد (قبلاً برعکس بود و Ctrl+Z در کمیکِ بدونِ
  // استودیو هیچ کاری نمی‌کرد).
  useEffect(() => {
    if (isAnnotationActive) return;
    const onKeyDown = (e) => {
      // مرحله ۱۲: در حالِ ضبطِ شورت‌کات در تنظیمات، هیچ‌کاری نکن.
      if (window.__isRecordingShortcut ||
        (typeof document !== 'undefined' &&
          document.body?.dataset?.recordingShortcut === 'true')) return;
      // مرحله ۷ ـ بخش ب: وقتی فوکوس داخلِ کادرِ متنی است (جستجوی
      // PDF، ویرایشگرِ متن/استیکی، سرچ‌بار)، Ctrl+Z/Y باید Undoی
      // متنیِ خودِ مرورگر باشد، نه Undoی حاشیه‌نویسی — وگرنه تایپِ
      // کاربر، بی‌صدا حاشیه‌نویسی را برمی‌گرداند. (شنوندهٔ تولبار و
      // useKeyboard، از پیش همین گیت را داشتند؛ این شنونده نداشت.)
      const t = e.target;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return;
      // مرحله ۷ ـ بخش الف: مالکیتِ این شنونده (فقط وقتی استودیو
      // خاموش است) دقیقاً مثلِ قبل می‌ماند؛ فقط گزاره، از
      // مرجعِ واحد (matchesShortcut) خوانده می‌شود تا تغییرِ
      // میانبرِ Undo/Redo در تنظیمات، کلیدِ قبلی را خلع کند.
      // Ctrl+Shift+Z، اسمِ مستعارِ redo است و در خودِ matcher
      // حل شده است.
      let settingsState = null;
      try {
        settingsState = typeof useSettingsStore.getState === 'function'
          ? useSettingsStore.getState()
          : null;
      } catch (_) { /* ignore */ }
      if (settingsState?.matchesShortcut?.('redoAnnotation', e)) {
        e.preventDefault();
        handleRedoAnnotation();
      } else if (settingsState?.matchesShortcut?.('undoAnnotation', e)) {
        e.preventDefault();
        handleUndoAnnotation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAnnotationActive, handleUndoAnnotation, handleRedoAnnotation]);

  // پیش‌دیکودر غیرمسدودکننده در زمان بیکاری ترد اصلی
  useEffect(() => {
    if (!items || itemsCount === 0) return;

    let isCancelled = false;
    const activeImages = [];

    const timerId = setTimeout(() => {
      if (isCancelled) return;

      const lastVisible =
        visibleIndices.length > 0
          ? visibleIndices[visibleIndices.length - 1]
          : activePageIndex;

      const targets = [lastVisible + 1, lastVisible + 2].filter(
        (idx) => idx >= 0 && idx < itemsCount
      );

      targets.forEach((idx) => {
        const item = items[idx];
        const rawPath = item?.path || item?.filePath;
        if (!rawPath) return;

        const url = buildComicImageUrl(rawPath);
        if (!url || predecodedMapRef.current.has(url)) return;

        predecodedMapRef.current.set(url, idx);

        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        activeImages.push(img);

        img.onload = () => {
          if (isCancelled) return;
          if (img.naturalWidth > 0 && img.naturalHeight > 0) {
            recordImageDimensions(idx, img.naturalWidth, img.naturalHeight);
          }
          if (typeof img.decode === 'function') {
            img.decode().catch(() => {});
          }
        };
      });
      // پاک‌سازیِ کشِ پیش‌دیکود در پیمایش‌های طولانی: Setِ قبلی،
      // هرگز خالی نمی‌شد و در کمیک‌های چندصد صفحه‌ای تا پایانِ فایل
      // رشد می‌کرد. حالا فقط URLهای نزدیکِ پنجرهٔ مرئی (±۴ صفحه)
      // نگه داشته می‌شوند و سقفِ سخت، ۴۸ ورودی است (دورترین‌ها اول
      // حذف می‌شوند). حذف از Map، فقط به‌معنای «دیکودِ دوباره در
      // بازگشت» است؛ خودِ تصویر در کشِ مرورگر می‌ماند و چیزی از
      // صفحه پاک نمی‌شود. شی‌های Imageی هر دور هم از قبل با
      // onload=null و src='' آزاد می‌شدند و همان‌طور مانده‌اند.
      const firstVisible = visibleIndices.length > 0 ? visibleIndices[0] : activePageIndex;
      for (const [cachedUrl, cachedIdx] of predecodedMapRef.current) {
        if (cachedIdx < firstVisible - 4 || cachedIdx > lastVisible + 4) {
          predecodedMapRef.current.delete(cachedUrl);
        }
      }
      if (predecodedMapRef.current.size > 48) {
        const windowCenter = (firstVisible + lastVisible) / 2;
        const sorted = [...predecodedMapRef.current.entries()].sort(
          (a, b) => Math.abs(a[1] - windowCenter) - Math.abs(b[1] - windowCenter)
        );
        for (const [cachedUrl] of sorted.slice(48)) predecodedMapRef.current.delete(cachedUrl);
      }
    }, 120);

    return () => {
      isCancelled = true;
      clearTimeout(timerId);
      activeImages.forEach((img) => {
        img.onload = null;
        img.src = '';
      });
    };
  }, [activePageIndex, visibleIndices, items, itemsCount, recordImageDimensions]);

  useEffect(() => {
    predecodedMapRef.current.clear();
  }, [currentFilePath]);

  // مرحله ۶ ـ بخش الف: نشستِ آمارِ مطالعه برای فایلِ جاری؛ با
  // عوض‌شدنِ فایل یا بسته‌شدنِ ریدر، نشست پایان می‌یابد و
  // باقی‌ماندهٔ گزارش‌ها فرستاده می‌شوند.
  useEffect(() => {
    if (!currentFilePath) return undefined;
    readingActivity.begin(currentFilePath);
    return () => {
      readingActivity.end();
    };
  }, [currentFilePath]);

  // ۴. مدیریت هوشمند زوم با چرخ ماوس (Ctrl + Wheel تا سقف 3.5x) — مرحله ۶:
  // نسخهٔ قبلی، شنوندهٔ wheel را فقط وقتی Ctrl نگه داشته شده بود
  // وصل می‌کرد؛ ژستِ Pinchِ ترک‌پد، keydownِ Control نمی‌فرستد و
  // چرخِ ماوس وقتی Ctrl از قبل نگه داشته شده بود هم شنونده را نداشت.
  // حالا شنونده همیشه وصل است و ctrlKey/metaKey داخلِ هندلر بررسی
  // می‌شود. زوم، ضربی و نرم است تا ژستِ پیوستهٔ دو انگشتی روان حس شود.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // مرحله ۶ ـ بخش ب: تجمیعِ رویدادهای wheel در یک فریم با
    // requestAnimationFrame — مانند PdfViewer: دلتاهای یک فریم جمع
    // و فقط یک setZoomLevel اعمال می‌شود تا سیلِ ۶۰ تا ۱۲۰ رویدادِ
    // ترک‌پد در ثانیه، استیت را در هر رویداد تکان ندهد.
    let pendingWheel = null;

    const handleWheelZoom = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();

      const deltaY = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      if (pendingWheel) {
        pendingWheel.accDeltaY += deltaY;
        pendingWheel.clientY = e.clientY;
        return;
      }
      pendingWheel = { accDeltaY: deltaY, clientY: e.clientY, rafId: 0 };
      pendingWheel.rafId = requestAnimationFrame(() => {
        const pending = pendingWheel;
        pendingWheel = null;
        if (!pending) return;
        const factor = Math.min(1.12, Math.max(0.89, Math.exp(-pending.accDeltaY * 0.0018)));
        const currentZoom = useReaderStore.getState().zoomLevel || 1.0;
        const nextZoom = Math.min(
          3.5,
          // Minimum zoom lowered from 40% to 10% (0.1) per user requirement
          Math.max(0.1, parseFloat((currentZoom * factor).toFixed(2)))
        );

        if (nextZoom !== currentZoom) {
          const rect = container.getBoundingClientRect();
          const mouseY = pending.clientY - rect.top;
          const scrollY = container.scrollTop;
          const scrollFactor = nextZoom / currentZoom;

          setZoomLevel(nextZoom);
          container.scrollTop = (scrollY + mouseY) * scrollFactor - mouseY;
        }
      });
    };

    container.addEventListener('wheel', handleWheelZoom, { passive: false });
    return () => {
      container.removeEventListener('wheel', handleWheelZoom);
      if (pendingWheel && pendingWheel.rafId) cancelAnimationFrame(pendingWheel.rafId);
      pendingWheel = null;
    };
  }, [setZoomLevel]);

  // ۵. پرش اولیه پایدار بر مبنای آخرین صفحه خوانده‌شده
  useEffect(() => {
    let isMounted = true;
    hasResumedRef.current = false;
    isResumingRef.current = true;

    if (!currentFilePath) {
      isResumingRef.current = false;
      hasResumedRef.current = true;
      return;
    }

    const initPagePosition = async () => {
      try {
        const initialStorePage =
          comicData?.savedResumePage || useReaderStore.getState().currentPage;
        let targetToJump =
          initialStorePage && initialStorePage > 1 ? initialStorePage : null;

        if (!targetToJump) {
          const timeoutGuard = new Promise((resolve) =>
            setTimeout(() => resolve(null), 300)
          );
          const result = await Promise.race([
            coreApi.dbAction({
              action: 'GET_PROGRESS',
              payload: { filePath: currentFilePath },
            }),
            timeoutGuard,
          ]);

          if (result?.progress?.currentPage) {
            targetToJump = Number(result.progress.currentPage);
          }
        }

        if (!isMounted) return;

        if (targetToJump && targetToJump > 1 && targetToJump <= itemsCount) {
          requestAnimationFrame(() => {
            if (isMounted) {
              if (isHorizontalPagedRef.current) {
                goToHorizontalPage(targetToJump - 1);
              } else {
                scrollToIndex(targetToJump - 1, 'auto');
              }
              setCurrentPage(targetToJump);
              readingActivity.visitPage(targetToJump);

              setTimeout(() => {
                if (isMounted) {
                  if (!isHorizontalPagedRef.current) scrollToIndex(targetToJump - 1, 'auto');
                  hasResumedRef.current = true;
                  isResumingRef.current = false;
                }
              }, 80);
            }
          });
        } else {
          hasResumedRef.current = true;
          isResumingRef.current = false;
        }
      } catch (err) {
        console.error('Error in VerticalViewer resume:', err);
        hasResumedRef.current = true;
        isResumingRef.current = false;
      }
    };

    initPagePosition();

    return () => {
      isMounted = false;
      hasResumedRef.current = false;
      isResumingRef.current = false;
    };
  }, [
    currentFilePath,
    itemsCount,
    comicData?.savedResumePage,
    scrollToIndex,
    setCurrentPage,
    goToHorizontalPage,
  ]);

  // ۶. پرش دستی به صفحه هدف انتخاب‌شده توسط کاربر
  useEffect(() => {
    if (targetPage !== null && targetPage >= 1 && targetPage <= itemsCount) {
      if (isHorizontalPaged) {
        goToHorizontalPage(targetPage - 1);
      } else {
        scrollToIndex(targetPage - 1, 'smooth');
      }
      clearTargetPage();
    }
  }, [targetPage, itemsCount, clearTargetPage, scrollToIndex, isHorizontalPaged, goToHorizontalPage]);

  // مرحله ۱۳: پرشِ نقطه‌ای به بوک‌مارک — اول scrollToIndex تا صفحه
  // در پنجرهٔ مجازی بیاید، بعد اسکرولِ دقیقِ DOM به همان نقطه.
  // کانتینر، padding ندارد، پس فرمول، همان pageOffsetTop +
  // pageHeight*yRatio است (با مختصاتِ واقعیِ DOM).
  useEffect(() => {
    if (!bookmarkJumpTarget || bookmarkJumpTarget.filePath !== currentFilePath) { clearBookmarkJumpTarget(); return; }
    const page = bookmarkJumpTarget.page;
    if (page < 1 || page > itemsCount) { clearBookmarkJumpTarget(); return; }
    if (isHorizontalPaged) {
      goToHorizontalPage(page - 1);
      clearBookmarkJumpTarget();
      const t1 = setTimeout(() => {
        const container = hContainerRef.current;
        const el = document.getElementById(`comic-page-${page}`);
        if (!container || !el) return;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        container.scrollTo({
          top: container.scrollTop + (eRect.top - cRect.top) + eRect.height * yRatio,
          behavior: 'auto',
        });
      }, 250);
      return () => clearTimeout(t1);
    }
    scrollToIndex(page - 1, 'auto');
    setCurrentPage(page);
    const yRatio = bookmarkJumpTarget.yRatio;
    const doPreciseScroll = () => {
      const container = containerRef.current;
      const el = document.getElementById(`comic-page-${page}`);
      if (!container || !el) return false;
      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      container.scrollTo({
        top: container.scrollTop + (eRect.top - cRect.top) + eRect.height * yRatio,
        behavior: 'auto',
      });
      return true;
    };
    clearBookmarkJumpTarget();
    const t1 = setTimeout(() => {
      if (!doPreciseScroll()) setTimeout(doPreciseScroll, 600);
    }, 250);
    return () => clearTimeout(t1);
  }, [bookmarkJumpTarget, currentFilePath, itemsCount, scrollToIndex, setCurrentPage, clearBookmarkJumpTarget, isHorizontalPaged, goToHorizontalPage]);

  // ۷. همگام‌سازی شماره صفحه بدون سابسکرایب رندرر به currentPage
  useEffect(() => {
    if (isHorizontalPaged) return;
    if (isJumping.current || isResumingRef.current || !hasResumedRef.current) return;

    const calculatedPage = activePageIndex + 1;
    const storeCurrentPage = useReaderStore.getState().currentPage;

    if (
      calculatedPage !== storeCurrentPage &&
      calculatedPage >= 1 &&
      calculatedPage <= itemsCount
    ) {
      setCurrentPage(calculatedPage);
      readingActivity.visitPage(calculatedPage);

      if (currentFilePath) {
        updateReadingProgress(currentFilePath, calculatedPage, itemsCount);
      }
    }
  }, [
    activePageIndex,
    isJumping,
    itemsCount,
    currentFilePath,
    setCurrentPage,
    updateReadingProgress,
    isHorizontalPaged,
  ]);

  const handleFrameContextMenu = useCallback(
    (e, index, path, yRatio) => {
      handleContextMenu(e, {
        pageIndex: index,
        imagePath: path,
        yRatio: typeof yRatio === 'number' ? yRatio : undefined,
        comic: comicData,
      });
    },
    [handleContextMenu, comicData]
  );

  if (!comicData || !comicData.items) return null;

  const activePageNum = (isHorizontalPaged ? hPageIndex : activePageIndex) + 1;
  const currentActivePageAnnotations =
    annotationsByPage[String(activePageNum)] || EMPTY_PAGE_ANNOTATIONS;
  const enableHiDpiCrispPass = isScrollIdle && safeZoom > 1.12;

  // مرحلهٔ ۴۳ §۴: قاب افقی یک صفحه با بوک‌مارک‌های همان صفحه —
  // در تک‌برگ، همان قاب تنها؛ در دو‌صفحه‌ای، یکی از دو برگ کنار هم.
  // هر برگ، حاشیه‌نویسی‌ها و بوک‌مارک‌های صفحه خودش را می‌گیرد.
  const renderHorizontalFrame = (pageIdx) => {
    const frameBookmarks = pageBookmarkMap[pageIdx + 1] || EMPTY_PAGE_BOOKMARKS;
    const frameAnnotations = annotationsByPage[String(pageIdx + 1)] || EMPTY_PAGE_ANNOTATIONS;
    return (
      <div
        key={pageIdx}
        style={isDoubleSpread
          ? { position: 'relative', flex: '0 1 auto', width: 'fit-content', maxWidth: 'calc(50% - 6px)' }
          : { position: 'relative', width: 'fit-content', maxWidth: '100%' }}
      >
        <ComicPageFrame
          item={items[pageIdx]}
          index={pageIdx}
          isLastItem={pageIdx === itemsCount - 1}
          knownHeight={(heights || [])[pageIdx] ?? null}
          frameWidth={frameWidth}
          pageGap={safePageGap}
          rotation={rotation}
          isHiDpiPassActive={enableHiDpiCrispPass}
          isNearViewport
          isSharpenFilterActive={enableHiDpiCrispPass && safeZoom <= 1.5 && !isAnnotationActive}
          pageAnnotations={frameAnnotations}
          onCommitPageAnnotations={handleCommitPageAnnotations}
          onTransferItemsToPage={handleTransferItemsToPage}
          pageFilter={pageFilter}
          frameZoomLevel={safeZoom}
          onImageLoad={recordImageDimensions}
          onFrameRendered={handleFrameRendered}
          onContextMenu={handleFrameContextMenu}
          fitToScreen
        />
        {frameBookmarks.map((bm) => (
          <div
            key={bm.id}
            style={{
              position: 'absolute',
              top: bm.yRatio <= 0 ? '0px' : `calc(${bm.yRatio * 100}% - 12px)`,
              left: bm.side === 'left' ? undefined : 'calc(100% + 10px)',
              right: bm.side === 'left' ? 'calc(100% + 10px)' : undefined,
              zIndex: 50,
            }}
          >
            <BookmarkMarker
              bookmark={bm}
              imageUrl={resolveBookmarkImage(bm, bookmarkPreferences)}
              onOpen={handleOpenBookmark}
              onDelete={handleDeleteBookmark}
              onRename={handleRenameBookmark}
              onMove={handleMoveBookmark}
              onMoveBookmark={handleMoveBookmark}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={styles.outerWrapper}>
      {/* فیلتر سخت‌افزاری SVG برای افزایش وضوح خطوط و متون کمیک در زوم‌های بالا (Pass 2) */}
      <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          <filter id="comic-hidpi-sharpen">
            <feConvolveMatrix
              order="3"
              preserveAlpha="true"
              kernelMatrix="0 -0.10 0 -0.10 1.40 -0.10 0 -0.10 0"
            />
          </filter>
          {/* مرحلهٔ ۲۶ — فیلترِ anatomy-soft-clarityِ مرحلهٔ ۲۵،
              به‌طورِ کامل حذف شد: بلارِ گاوسی، حتی ملایم، عکس‌هایِ
              .webp را از شفافیتِ بومیِ خودشان تارتر نشان می‌داد؛
              حالا تصاویر با ۱۰۰٪ کیفیتِ واقعیِ خودشان دیده می‌شوند. */}
        </defs>
      </svg>

      {/* نوار ابزار استودیو ویرایش (فقط هنگام فعال شدن از TopBar نمایش داده می‌شود) */}
      <AnnotationToolbar
        activePage={activePageNum}
        pageItemCount={currentActivePageAnnotations.length}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndoAnnotation}
        onRedo={handleRedoAnnotation}
        onClearPage={handleClearCurrentPageAnnotations}
        onExportAnnotatedPdf={isCbzArchive ? handleExportAnnotatedCbz : undefined}
        isExportingPdf={isExportingCbz}
        pdfSaveState={cbzSaveState}
      />

      {isHorizontalPaged && itemsCount > 0 ? (
        <div
          ref={hContainerRef}
          data-reader-scroll-container="true"
          style={{
            ...styles.scrollContainer,
            backgroundColor: readerBackdropColor,
            pointerEvents: isSnippingActive || isAreaZoomActive ? 'none' : 'auto',
            cursor: isHPanning ? 'grabbing' : undefined,
            userSelect: isHPanning ? 'none' : undefined,
          }}
          onMouseDown={handleHPanMouseDown}
          onContextMenu={(e) => {
            if (!e.target.closest('.comic-page-item')) {
              handleContextMenu(e, {
                pageIndex: hPageIndex,
                imagePath: items[hPageIndex]?.path,
                comic: comicData,
              });
            }
          }}
        >
          <div
            style={{
              position: 'relative',
              direction: 'rtl',
              width: frameWidth || '100%',
              margin: '0 auto',
              display: 'flex',
              flexDirection: isDoubleSpread ? 'row' : 'column',
              alignItems: isDoubleSpread ? 'flex-start' : 'center',
              justifyContent: isDoubleSpread ? 'center' : undefined,
              gap: isDoubleSpread ? 12 : 0,
              // مرحلهٔ ۴۱ §۳: ورقِ فوق‌نرمِ افقی — لغزشِ translate3d +
              // مقیاسِ ظریفِ 0.97 به 1 + محو/ظاهرِ نرم، در ۳۴۰ میلی‌ثانیه.
              opacity: hEntering ? 0 : 1,
              transform: hEntering ? `translate3d(${hFlipDirRef.current >= 0 ? 48 : -48}px, 0, 0) scale(0.97)` : 'translate3d(0, 0, 0) scale(1)',
              transition: 'opacity 340ms cubic-bezier(0.22, 1, 0.36, 1), transform 340ms cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: 'transform, opacity',
            }}
          >
            {isDoubleSpread
              ? [hPageIndex, hPageIndex + 1].filter((i) => i < itemsCount).map((i) => renderHorizontalFrame(i))
              : renderHorizontalFrame(hPageIndex)}
          </div>
        </div>
      ) : (
      <div
        ref={containerRef}
        data-reader-scroll-container="true"
        style={{
          ...styles.scrollContainer,
          backgroundColor: readerBackdropColor,
          pointerEvents: isSnippingActive || isAreaZoomActive ? 'none' : 'auto',
          cursor: isPanning ? 'grabbing' : undefined,
          userSelect: isPanning ? 'none' : undefined,
        }}
        onMouseDown={handlePanMouseDown}
        onContextMenu={(e) => {
          if (!e.target.closest('.comic-page-item')) {
            const safeIndex = Math.max(0, Math.min(activePageIndex, itemsCount - 1));
            handleContextMenu(e, {
              pageIndex: safeIndex,
              imagePath: items[safeIndex]?.path,
              comic: comicData,
            });
          }
        }}
      >
        <div
          style={{
            position: 'relative',
            direction: 'rtl',
            width: `${Math.round(safeZoom * 100)}%`,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            backgroundColor: safePageGap === 0 ? '#000000' : 'transparent',
          }}
        >
          <div style={{ height: `${paddingTop}px`, width: '100%', flexShrink: 0 }} />

          {visibleIndices.map((index) => {
            // مرحله ۱۵ — رفعِ کرشِ «reading '10'»: به‌جایِ خواندنِ
            // مستقیمِ comicData.items (که هنگامِ تعویضِ کتاب، لحظه‌ای
            // undefined است)، همان آرایهٔ امن‌شدهٔ items خوانده می‌شود
            // که visibleIndices هم از رویِ آن ساخته شده است.
            const item = items[index];
            if (!item) return null;
            const pageNum = index + 1;
            const pageAnnots = annotationsByPage[String(pageNum)] || EMPTY_PAGE_ANNOTATIONS;
            const isNearCenter = Math.abs(index - activePageIndex) <= 1;
            const frameBookmarks = pageBookmarkMap[pageNum] || EMPTY_PAGE_BOOKMARKS;

            return (
              <div
                key={
                  item.path
                    ? `frame-${index}-${item.path}`
                    : `frame-${index}-${hiDpiRenderTick}`
                }
                style={{ position: 'relative', overflow: 'visible', width: '100%' }}
              >
              <ComicPageFrame
                item={item}
                index={index}
                isLastItem={index === itemsCount - 1}
                knownHeight={(heights || [])[index] ?? null}
                frameWidth={frameWidth}
                pageGap={safePageGap}
                rotation={rotation}
                isHiDpiPassActive={enableHiDpiCrispPass && isNearCenter}
                isNearViewport={isNearCenter}
                isSharpenFilterActive={enableHiDpiCrispPass && isNearCenter && safeZoom <= 1.5 && !isAnnotationActive}
                pageAnnotations={pageAnnots}
                onCommitPageAnnotations={handleCommitPageAnnotations}
                onTransferItemsToPage={handleTransferItemsToPage}
                pageFilter={pageFilter}
                frameZoomLevel={safeZoom}
                onImageLoad={recordImageDimensions}
                onFrameRendered={handleFrameRendered}
                onContextMenu={handleFrameContextMenu}
              />
              {frameBookmarks.map((bm) => (
                <div
                  key={bm.id}
                  style={{
                    position: 'absolute',
                    top: bm.yRatio <= 0 ? '0px' : `calc(${bm.yRatio * 100}% - 12px)`,
                    left: bm.side === 'left' ? undefined : 'calc(100% + 10px)',
                    right: bm.side === 'left' ? 'calc(100% + 10px)' : undefined,
                    zIndex: 50,
                  }}
                >
                  <BookmarkMarker
                    bookmark={bm}
                    imageUrl={resolveBookmarkImage(bm, bookmarkPreferences)}
                    onOpen={handleOpenBookmark}
                    onDelete={handleDeleteBookmark}
                    onRename={handleRenameBookmark}
                    onMove={handleMoveBookmark}
                  />
                </div>
              ))}
              </div>
            );
          })}

          <div
            style={{ height: `${paddingBottom}px`, width: '100%', flexShrink: 0 }}
          />
        </div>
      </div>
      )}
      {/* مرحلهٔ ۳۷ §۳: نشانگرِ شناورِ «صفحهٔ X از Y» در پایین-راستِ
          محیطِ مطالعه — بدونِ هیچ تغییری در RightPanel. */}
      {itemsCount > 0 && (
        <div
          onClick={() => { if (!isEditingPageHud) { setPageHudDraft(String((isHorizontalPaged ? hPageIndex : activePageIndex) + 1)); setIsEditingPageHud(true); } }}
          onMouseEnter={() => setPageHudHovered(true)}
          onMouseLeave={() => setPageHudHovered(false)}
          title="برای رفتن به صفحهٔ دلخواه کلیک کنید"
          style={{ position: 'absolute', bottom: '18px', right: isRightSidebarOpen ? '342px' : '22px', zIndex: 35, background: 'rgba(13, 19, 26, 0.86)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: pageHudHovered || isEditingPageHud ? '1px solid rgba(34, 211, 238, 0.7)' : '1px solid rgba(34, 211, 238, 0.25)', borderRadius: '10px', padding: '6px 8px', color: '#e2e8f0', fontSize: '12.5px', fontWeight: 700, direction: 'rtl', pointerEvents: 'auto', cursor: isEditingPageHud ? 'default' : 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.4)', transition: 'right 0.25s ease, border-color 0.2s ease', display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <button
            type="button"
            title="صفحه قبلی"
            aria-label="صفحه قبلی"
            disabled={isHorizontalPaged ? hPageIndex <= 0 : activePageIndex <= 0}
            onClick={(e) => { e.stopPropagation(); goHudPage(-1); }}
            style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (isHorizontalPaged ? hPageIndex <= 0 : activePageIndex <= 0) ? 0.35 : 1, padding: 0, flexShrink: 0 }}
          >
            <Icons.ChevronRight size={16} />
          </button>
          {isEditingPageHud ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="number"
                min={1}
                max={itemsCount}
                value={pageHudDraft}
                autoFocus
                onFocus={(e) => e.target.select()}
                onChange={(e) => setPageHudDraft(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitHudJump();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setIsEditingPageHud(false);
                  }
                }}
                onBlur={() => setIsEditingPageHud(false)}
                style={{ width: 58, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(34,211,238,0.6)', borderRadius: 6, color: '#e2e8f0', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, padding: '2px 6px', textAlign: 'center', direction: 'ltr' }}
              />
              <span>{`از ${itemsCount}`}</span>
              <button
                type="button"
                title="رفتن"
                onMouseDown={(e) => { e.preventDefault(); commitHudJump(); }}
                style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(34,211,238,0.18)', border: '1px solid rgba(34,211,238,0.5)', color: '#67e8f9', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', pointerEvents: 'none' }}><polyline points="20 6 9 17 4 12" /></svg>
              </button>
            </span>
          ) : (
            isHorizontalPaged && isDoubleSpread
              ? `صفحه ${hPageIndex + 1}-${Math.min(hPageIndex + 2, itemsCount)} از ${itemsCount}`
              : `صفحه ${(isHorizontalPaged ? hPageIndex : activePageIndex) + 1} از ${itemsCount}`
          )}
          <button
            type="button"
            title="صفحه بعدی"
            aria-label="صفحه بعدی"
            disabled={isHorizontalPaged ? hPageIndex >= itemsCount - (isDoubleSpread ? 2 : 1) : activePageIndex >= itemsCount - 1}
            onClick={(e) => { e.stopPropagation(); goHudPage(1); }}
            style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#e2e8f0', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: (isHorizontalPaged ? hPageIndex >= itemsCount - (isDoubleSpread ? 2 : 1) : activePageIndex >= itemsCount - 1) ? 0.35 : 1, padding: 0, flexShrink: 0 }}
          >
            <Icons.ChevronLeft size={16} />
          </button>
        </div>
      )}
      {/* مرحلهٔ ۴۳ §۴: گزینه تک‌برگ / دو‌صفحه‌ای — فقط در حالت افقی. */}
      {isHorizontalPaged && itemsCount > 1 && (
        <div
          style={{ position: 'absolute', bottom: '18px', left: '22px', zIndex: 35, background: 'rgba(13, 19, 26, 0.86)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)', border: '1px solid rgba(34, 211, 238, 0.25)', borderRadius: '10px', padding: '4px', color: '#e2e8f0', fontSize: '12px', fontWeight: 700, direction: 'rtl', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 4px 14px rgba(0,0,0,0.4)' }}
        >
          <button
            type="button"
            title="نمایش تک‌برگ (تناسب با صفحه)"
            aria-pressed={!isDoubleSpread}
            onClick={() => setIsDoubleSpread(false)}
            style={{ borderRadius: '7px', border: 'none', padding: '5px 10px', fontFamily: 'inherit', fontSize: '12px', fontWeight: 700, cursor: 'pointer', color: !isDoubleSpread ? '#06202a' : '#e2e8f0', background: !isDoubleSpread ? '#22d3ee' : 'transparent' }}
          >
            تک‌برگ
          </button>
          <button
            type="button"
            title="نمایش دوصفحه‌ای کنار هم"
            aria-pressed={isDoubleSpread}
            onClick={() => setIsDoubleSpread(true)}
            style={{ borderRadius: '7px', border: 'none', padding: '5px 10px', fontFamily: 'inherit', fontSize: '12px', fontWeight: 700, cursor: 'pointer', color: isDoubleSpread ? '#06202a' : '#e2e8f0', background: isDoubleSpread ? '#22d3ee' : 'transparent' }}
          >
            دو‌صفحه‌ای
          </button>
        </div>
      )}
      <RenderProgressHud
        total={zoomHud.total}
        done={zoomHud.done}
        isDone={zoomHud.isDone}
        visible={zoomHud.visible}
      />
    </div>
  );
}

const styles = {
  outerWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  scrollContainer: {
    width: '100%',
    height: '100%',
    overflowY: 'auto',
    overflowX: 'auto',
    // مرحله ۱۶: پدینگِ افقیِ ۸۰ = جایِ مارکرِ ۶۸ + ۱۲ فاصله.
    padding: '0 80px',
    position: 'relative',
    userSelect: 'none',
    direction: 'ltr',
    overflowAnchor: 'none',
  },
  imageWrapper: {
    width: '100%',
    display: 'block',
    marginTop: '0',
    marginLeft: '0',
    marginRight: '0',
    padding: '0',
    backgroundColor: 'transparent',
    borderRadius: '0',
    lineHeight: 0,
    fontSize: 0,
    position: 'relative',
    boxSizing: 'border-box',
  },
  image: {
    width: '100%',
    display: 'block',
    margin: '0',
    padding: '0',
    borderRadius: '0',
    boxShadow: 'none',
    userSelect: 'none',
    WebkitUserDrag: 'none',
    imageRendering: 'high-quality',
  },
  errorPlaceholder: {
    width: '100%',
    height: '380px',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: 'var(--border)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
  },
  errorText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--muted)',
    direction: 'rtl',
  },
  retryBtn: {
    padding: '6px 14px',
    borderRadius: '8px',
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};