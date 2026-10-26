import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useContextMenu from '../../hooks/useContextMenu';
import { coreApi } from '../../services/coreApi';
import annotationLocalBackup from '../../services/annotationLocalBackup';
import thumbnailService from '../../services/thumbnailService';
import hiDpiRenderService from '../../services/hiDpiRenderService';
import Icons from '../common/Icons';
import { normalizeSearchText } from '../../utils/persianSearch';
// Cycle-fix (2026-10-25): هر ماژول، مستقیم از فایلِ خودش ایمپورت
// می‌شود — تولبار دیگر از طریقِ لایه re-export نمی‌شود، پس هیچ
// مسیری بینِ لایه و تولبار (در هیچ جهتی) وجود ندارد.
import AnnotationLayer from './AnnotationLayer';
import AnnotationToolbar from './AnnotationToolbar';

// ============================================================================
// ۱. پکیج جامع پلی‌فیل‌های ES2025/ES2026 برای سازگاری ۱۰۰٪ pdfjs-dist با الکترون
// ============================================================================
const POLYFILL_RAW_CODE = `
(function() {
  if (typeof Map !== 'undefined') {
    if (typeof Map.prototype.getOrInsert !== 'function') {
      Object.defineProperty(Map.prototype, 'getOrInsert', {
        value: function (key, defaultValue) {
          if (!this.has(key)) this.set(key, defaultValue);
          return this.get(key);
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof Map.prototype.getOrInsertComputed !== 'function') {
      Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
        value: function (key, callbackfn) {
          if (!this.has(key)) this.set(key, callbackfn(key));
          return this.get(key);
        },
        configurable: true,
        writable: true
      });
    }
  }
  if (typeof WeakMap !== 'undefined') {
    if (typeof WeakMap.prototype.getOrInsert !== 'function') {
      Object.defineProperty(WeakMap.prototype, 'getOrInsert', {
        value: function (key, defaultValue) {
          if (!this.has(key)) this.set(key, defaultValue);
          return this.get(key);
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof WeakMap.prototype.getOrInsertComputed !== 'function') {
      Object.defineProperty(WeakMap.prototype, 'getOrInsertComputed', {
        value: function (key, callbackfn) {
          if (!this.has(key)) this.set(key, callbackfn(key));
          return this.get(key);
        },
        configurable: true,
        writable: true
      });
    }
  }
  if (typeof Uint8Array !== 'undefined') {
    if (typeof Uint8Array.prototype.toHex !== 'function') {
      Object.defineProperty(Uint8Array.prototype, 'toHex', {
        value: function () {
          let out = '';
          for (let i = 0; i < this.length; i++) {
            out += this[i].toString(16).padStart(2, '0');
          }
          return out;
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof Uint8Array.fromHex !== 'function') {
      Uint8Array.fromHex = function (hexString) {
        const clean = String(hexString || '').replace(/[^0-9a-fA-F]/g, '');
        const bytes = new Uint8Array(Math.floor(clean.length / 2));
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
        }
        return bytes;
      };
    }
    if (typeof Uint8Array.prototype.setFromHex !== 'function') {
      Object.defineProperty(Uint8Array.prototype, 'setFromHex', {
        value: function (hexString) {
          const bytes = Uint8Array.fromHex(hexString);
          const len = Math.min(this.length, bytes.length);
          for (let i = 0; i < len; i++) this[i] = bytes[i];
          return { read: len * 2, written: len };
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof Uint8Array.prototype.toBase64 !== 'function') {
      Object.defineProperty(Uint8Array.prototype, 'toBase64', {
        value: function () {
          let binary = '';
          const len = this.byteLength;
          const chunkSize = 0x8000;
          for (let i = 0; i < len; i += chunkSize) {
            binary += String.fromCharCode.apply(null, this.subarray(i, i + chunkSize));
          }
          return typeof btoa === 'function' ? btoa(binary) : '';
        },
        configurable: true,
        writable: true
      });
    }
    if (typeof Uint8Array.fromBase64 !== 'function') {
      Uint8Array.fromBase64 = function (base64String) {
        const clean = String(base64String || '').replace(/-/g, '+').replace(/_/g, '/');
        const bin = typeof atob === 'function' ? atob(clean) : '';
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      };
    }
  }
  if (typeof Promise !== 'undefined') {
    if (typeof Promise.withResolvers !== 'function') {
      Promise.withResolvers = function () {
        let resolve, reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
      };
    }
    if (typeof Promise.try !== 'function') {
      Promise.try = function (callbackfn, ...args) {
        return new Promise((resolve) => resolve(callbackfn(...args)));
      };
    }
  }
  if (typeof Math !== 'undefined' && typeof Math.sumPrecise !== 'function') {
    Math.sumPrecise = function (iterable) {
      let sum = 0;
      for (const val of iterable) sum += Number(val);
      return sum;
    };
  }
  if (typeof RegExp !== 'undefined' && typeof RegExp.escape !== 'function') {
    RegExp.escape = function (str) {
      return String(str).replace(/[\\\\^$*+?.()|[\\]{}]/g, '\\\\$&');
    };
  }
})();
`;

export function ensurePdfJsEnvironmentReady() {
  try {
    // eslint-disable-next-line no-new-func
    new Function(POLYFILL_RAW_CODE)();
  } catch (_) {}

  if (typeof window !== 'undefined' && !window.__pdfWorkerPatchedUrlV2) {
    try {
      const resolvedWorkerUrl = new URL(pdfjsWorker, window.location.href).href;
      const polyfillModuleUrl =
        'data:text/javascript;charset=utf-8,' + encodeURIComponent(POLYFILL_RAW_CODE);

      const wrapperSource = `${POLYFILL_RAW_CODE}\nimport "${polyfillModuleUrl}";\nimport "${resolvedWorkerUrl}";\n`;
      const blob = new Blob([wrapperSource], { type: 'text/javascript' });
      window.__pdfWorkerPatchedUrlV2 = URL.createObjectURL(blob);

      const NativeWorker = window.__OriginalNativeWorker || window.Worker;
      window.__OriginalNativeWorker = NativeWorker;

      if (NativeWorker) {
        const PatchedWorker = function (scriptURL, options) {
          const urlStr = String(scriptURL || '');
          if (
            (urlStr.includes('pdf.worker') || urlStr === window.__pdfWorkerPatchedUrl) &&
            window.__pdfWorkerPatchedUrlV2
          ) {
            return new NativeWorker(window.__pdfWorkerPatchedUrlV2, {
              ...(options || {}),
              type: 'module',
            });
          }
          return new NativeWorker(scriptURL, options);
        };
        PatchedWorker.prototype = NativeWorker.prototype;
        Object.setPrototypeOf(PatchedWorker, NativeWorker);
        window.Worker = PatchedWorker;
      }
    } catch (err) {
      console.warn('Worker wrapper fallback:', err);
    }
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = window.__pdfWorkerPatchedUrlV2 || pdfjsWorker;
}

ensurePdfJsEnvironmentReady();

const DOM_OVERSCAN = 4;
const RENDER_RADIUS = 3;
const MAX_CACHED_BLOBS = 18;

function extractDataUrlFromImgElement(imgEl) {
  try {
    if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return null;
    const canvas = document.createElement('canvas');
    canvas.width = imgEl.naturalWidth;
    canvas.height = imgEl.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgEl, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    canvas.width = 0;
    canvas.height = 0;
    return dataUrl;
  } catch (_) {
    return null;
  }
}

// ============================================================================
// ۲. کامپوننت ایزوله هر صفحه PDF مجهز به رندر دو مرحله‌ای (Base + HiDPI Pass)
// ============================================================================
const PdfPageItem = React.memo(function PdfPageItem({
  filePath,
  pageNumber,
  isLastPage,
  pageGap,
  pdfDoc,
  zoomLevel,
  hiDpiRenderTick,
  distanceFromActive,
  shouldRender,
  cachedBlobUrl,
  onStorePageBlob,
  expectedHeight,
  rotation,
  pageWidth,
  pageAnnotations,
  onCommitPageAnnotations,
  onPageRatioMeasured,
  onContextMenu,
  searchHighlights,
}) {
  const [blobUrl, setBlobUrl] = useState(cachedBlobUrl || null);
  const [hiDpiUrl, setHiDpiUrl] = useState(() =>
    hiDpiRenderService.peekHiDpiPage(filePath, pageNumber, zoomLevel)
  );
  const [renderFailed, setRenderFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  const imgRef = useRef(null);
  const renderTaskRef = useRef(null);

  useEffect(() => {
    if (cachedBlobUrl && cachedBlobUrl !== blobUrl) {
      setBlobUrl(cachedBlobUrl);
      setRenderFailed(false);
    }
  }, [cachedBlobUrl, blobUrl]);

  // الف: پاس اول (Fast Base Render) برای اسکرول بدون لگ
  useEffect(() => {
    if (!shouldRender || !pdfDoc || cachedBlobUrl || blobUrl) return;

    let isCancelled = false;
    let tempCanvas = null;
    let activePageObj = null;

    const priorityDelay =
      distanceFromActive === 0 ? 6 : distanceFromActive === 1 ? 40 : 100;

    const timerId = setTimeout(async () => {
      if (isCancelled) return;
      try {
        setRenderFailed(false);
        const page = await pdfDoc.getPage(pageNumber);
        activePageObj = page;
        if (isCancelled) return;

        const baseViewport = page.getViewport({ scale: 1.0 });
        if (baseViewport.width > 0 && baseViewport.height > 0) {
          onPageRatioMeasured(pageNumber - 1, baseViewport.height / baseViewport.width);
        }

        const maxDimension = Math.max(baseViewport.width, baseViewport.height);
        const optimalScale = maxDimension > 1600 ? 1.55 : 1.9;
        const viewport = page.getViewport({ scale: optimalScale });

        tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.max(1, Math.floor(viewport.width));
        tempCanvas.height = Math.max(1, Math.floor(viewport.height));
        const context = tempCanvas.getContext('2d', { alpha: false });

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

        const renderTask = page.render({
          canvasContext: context,
          viewport,
        });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        renderTaskRef.current = null;

        if (isCancelled) {
          tempCanvas.width = 0;
          tempCanvas.height = 0;
          return;
        }

        tempCanvas.toBlob(
          (blob) => {
            if (tempCanvas) {
              tempCanvas.width = 0;
              tempCanvas.height = 0;
              tempCanvas = null;
            }
            if (activePageObj && typeof activePageObj.cleanup === 'function') {
              try {
                activePageObj.cleanup();
              } catch (_) {}
            }
            if (isCancelled || !blob) return;

            const nextUrl = URL.createObjectURL(blob);
            onStorePageBlob(pageNumber, nextUrl);
            setBlobUrl(nextUrl);
          },
          'image/webp',
          0.93
        );
      } catch (err) {
        if (tempCanvas) {
          tempCanvas.width = 0;
          tempCanvas.height = 0;
          tempCanvas = null;
        }
        const errName = err?.name || '';
        const errMsg = String(err?.message || '');
        if (
          errName !== 'RenderingCancelledException' &&
          !errMsg.includes('Rendering cancelled') &&
          !isCancelled
        ) {
          console.error(`Error rendering PDF page ${pageNumber}:`, err);
          setRenderFailed(true);
        }
      }
    }, priorityDelay);

    return () => {
      isCancelled = true;
      clearTimeout(timerId);
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (_) {}
        renderTaskRef.current = null;
      }
      if (tempCanvas) {
        tempCanvas.width = 0;
        tempCanvas.height = 0;
        tempCanvas = null;
      }
    };
  }, [
    shouldRender,
    pdfDoc,
    pageNumber,
    distanceFromActive,
    cachedBlobUrl,
    blobUrl,
    retryTick,
    onPageRatioMeasured,
    onStorePageBlob,
  ]);

  // ب: پاس دوم (Crystal-Clear HiDPI Re-render) پس از تثبیت زوم یا توقف روی صفحه
  useEffect(() => {
    if (!pdfDoc || distanceFromActive > 1) return;

    const dpr = window.devicePixelRatio || 1;
    const needsHiDpi = zoomLevel > 1.08 || dpr > 1.15;
    if (!needsHiDpi) {
      setHiDpiUrl(null);
      return;
    }

    const cachedSharp = hiDpiRenderService.peekHiDpiPage(filePath, pageNumber, zoomLevel);
    if (cachedSharp) {
      setHiDpiUrl(cachedSharp);
      return;
    }

    let isCancelled = false;
    const debounceMs = distanceFromActive === 0 ? 170 : 320;

    const timer = setTimeout(async () => {
      if (isCancelled) return;
      const sharpUrl = await hiDpiRenderService.renderPdfPageHiDpi({
        pdfDoc,
        filePath,
        pageNumber,
        zoomLevel,
      });
      if (!isCancelled && sharpUrl) {
        setHiDpiUrl(sharpUrl);
      }
    }, debounceMs);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [pdfDoc, filePath, pageNumber, zoomLevel, hiDpiRenderTick, distanceFromActive]);

  const handleFrameContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dataUrl = extractDataUrlFromImgElement(imgRef.current);
      onContextMenu?.(e, pageNumber - 1, dataUrl);
    },
    [onContextMenu, pageNumber]
  );

  // تصویر HiDPI در صورت آماده بودن بدون هیچ پرشی جایگزین تصویر پایه می‌شود
  const activeSrc = hiDpiUrl || cachedBlobUrl || blobUrl;

  // کالبدشکافیِ ناحیه‌های مردهٔ جزئی: برای چرخشِ ۹۰/۲۷۰، کادرِ
  // چیدمانِ wrapper باید ابعادِ جابه‌جا شده (ارتفاعِ کارت × عرضِ
  // کارت) داشته باشد تا پس از چرخش، دقیقاً کادرِ کارت را پر کند؛
  // wrapperِ ۱۰۰٪×۱۰۰٪ پس از چرخش، از دو طرف از کادر بیرون می‌زد و
  // contain: paintِ کارت، هم تصویر و هم لایه را از همان دو طرف
  // می‌برید (نوارِ مردهٔ متناسب با زوم). چرخشِ ۱۸۰ نیازی به جابه‌جایی
  // ندارد (کادرِ چرخیده، همان کادر است).
  const normalizedRotation = ((Number(rotation) || 0) % 360 + 360) % 360;
  const isSwappedRotation = normalizedRotation === 90 || normalizedRotation === 270;

  return (
    <div
      id={`comic-page-${pageNumber}`}
      data-page={pageNumber}
      data-index={pageNumber - 1}
      className="comic-page-item pdf-page-container"
      style={{
        ...styles.pageWrapper,
        height: expectedHeight ? `${expectedHeight}px` : '650px',
        minHeight: expectedHeight ? `${expectedHeight}px` : '650px',
        marginBottom: isLastPage ? '0px' : `${pageGap}px`,
      }}
      onContextMenu={handleFrameContextMenu}
    >
      {/* مانتِ دائمیِ لایهٔ حاشیه‌نویسی (رفعِ صفحاتِ مردهٔ PDF، بخش ۱ تسک):
          قبلاً AnnotationLayer فقط وقتی activeSrc آماده بود مانت می‌شد؛
          پس صفحه‌های در حالِ رندر، صفحه‌های با فاصلهٔ ۴ از صفحهٔ فعال
          (بیرونِ RENDER_RADIUS=۳ ولی داخلِ پنجرهٔ DOM_OVERSCAN=۴) و
          صفحه‌های رندرِ ناموفق، اصلاً لایه نداشتند و هیچ ورودی‌ای
          نمی‌گرفتند (کرسر هم به حالتِ عادی برمی‌گشت). حالا لایه همیشه
          مانت است و تا وقتی تصویر آماده نیست، روی placeholder می‌نشیند.
          وقتی استودیو غیرفعال است، pointerEventsِ لایه none است، پس
          دکمهٔ «تلاش مجدد» روی placeholder همچنان کلیک‌پذیر می‌ماند؛
          وقتی فعال است، لایه با zIndex ۱۰۰ بالای تصویر/placeholder است
          و رویدادها را خودش می‌گیرد. لایه آخرین فرزندِ wrapperِ چرخان
          است تا روی تصویر رنگ شود و چرخشِ صفحه را هم به‌ارث ببرد. */}
      <div
        style={{
          // در حالتِ جابه‌جا شده، wrapper مطلق و وسط‌چین است (از جریانِ
          // flex خارج می‌شود؛ ارتفاعِ کارت صریح است، پس چیزی فرو
          // نمی‌ریزد) و با translate(-۵۰٪، -۵۰٪) + چرخش، دقیقاً روی
          // کادرِ کارت می‌نشیند. wrapper همچنان positioned است، پس
          // کانتینرِ مطلقِ لایه، مرجعش را از دست نمی‌دهد.
          position: isSwappedRotation ? 'absolute' : 'relative',
          left: isSwappedRotation ? '50%' : undefined,
          top: isSwappedRotation ? '50%' : undefined,
          width: isSwappedRotation ? (expectedHeight ? `${expectedHeight}px` : '650px') : '100%',
          height: isSwappedRotation ? `${pageWidth}px` : '100%',
          // فاز ۲، بخش ۱: minHeightِ صریحِ برابرِ ارتفاعِ صفحه تا
          // wrapper تحتِ هیچ شرایطی (لودینگ، خطا، چرخش) فرو نریزد
          // و والدِ AnnotationLayer هرگز صفر نشود. (در حالتِ
          // جابه‌جا شده، ارتفاع صریحِ پیکسلی هست، پس minHeight لازم
          // نیست.)
          minHeight: isSwappedRotation ? undefined : (expectedHeight ? `${expectedHeight}px` : '650px'),
          transform: isSwappedRotation
            ? `translate(-50%, -50%) rotate(${rotation}deg)`
            : (rotation ? `rotate(${rotation}deg)` : 'none'),
        }}
      >
        {activeSrc ? (
          <img
            ref={imgRef}
            src={activeSrc}
            alt={`صفحه ${pageNumber}`}
            loading="eager"
            decoding="async"
            draggable={false}
            style={{
              ...styles.pageImage,
              // کالبدشکافی: ارتفاعِ ۱۰۰٪ِ wrapper (نه ارتفاعِ کارت) —
              // در حالتِ عادی، wrapper دقیقاً به ارتفاعِ کارت است و
              // نتیجه یکسان است؛ در حالتِ چرخیدهٔ ۹۰/۲۷۰، wrapper به
              // عرضِ کارت است و همین، تصویر را دقیقاً هم‌اندازهٔ لایه
              // می‌کند (قبلاً ارتفاعِ کارت، تصویرِ چرخیده را بدقواره
              // و بریده می‌کرد).
              height: '100%',
            }}
          />
        ) : (
          <div style={styles.pagePlaceholder}>
            {renderFailed ? (
              <>
                <span style={{ color: 'var(--danger)', display: 'flex' }}>
                  <Icons.AlertTriangle size={22} />
                </span>
                <span style={styles.placeholderText}>خطا در ترسیم صفحه {pageNumber}</span>
                <button
                  type="button"
                  onClick={() => setRetryTick((t) => t + 1)}
                  style={styles.retryBtn}
                >
                  تلاش مجدد
                </button>
              </>
            ) : (
              <>
                <div style={styles.spinnerBox}>
                  <Icons.Loader size={24} />
                </div>
                <span style={styles.placeholderText}>صفحه {pageNumber}</span>
              </>
            )}
          </div>
        )}

        {/* هایلایتِ نتایجِ جستجوی درون‌متنی (مرحله ۴): داخلِ همان wrapperِ
            چرخان قرار می‌گیرد تا چرخش را به‌ارث ببرد؛ مختصات‌ها درصدی‌اند،
            پس با زوم هم بی‌نیاز از محاسبهٔ مجدد هم‌تراز می‌مانند.
            pointerEvents: none تا هرگز جلوی حاشیه‌نویسی را نگیرد. */}
        {searchHighlights && searchHighlights.length > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              pointerEvents: 'none',
              zIndex: 5,
            }}
          >
            {searchHighlights.flatMap((highlight, hi) =>
              highlight.rects.map((rect, ri) => (
                <div
                  key={`${hi}-${ri}`}
                  style={{
                    position: 'absolute',
                    left: `${rect.left}%`,
                    top: `${rect.top}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                    backgroundColor: highlight.isActive
                      ? 'rgba(255, 196, 0, 0.55)'
                      : 'rgba(255, 235, 59, 0.30)',
                    border: highlight.isActive
                      ? '1px solid rgba(255, 160, 0, 0.9)'
                      : 'none',
                    borderRadius: '2px',
                    boxSizing: 'border-box',
                  }}
                />
              ))
            )}
          </div>
        )}

        {/* لایه تعاملی استودیو ویرایش روی صفحه — همیشه مانت است */}
        <AnnotationLayer
          pageNumber={pageNumber}
          items={pageAnnotations}
          onCommitPageItems={onCommitPageAnnotations}
          rotation={rotation}
          isNearViewport={distanceFromActive <= 1}
        />
      </div>
    </div>
  );
});

// ============================================================================
// ۳. کامپوننت اصلی PdfViewer (مجهز به Dual-Pass HiDPI و Area Box Zoom)
// ============================================================================
export default function PdfViewer({ filePath }) {
  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const setZoomLevel = useReaderStore((state) => state.setZoomLevel);
  const areaZoomTarget = useReaderStore((state) => state.areaZoomTarget);
  const clearAreaZoomTarget = useReaderStore((state) => state.clearAreaZoomTarget);
  const hiDpiRenderTick = useReaderStore((state) => state.hiDpiRenderTick);
  const triggerHiDpiRender = useReaderStore((state) => state.triggerHiDpiRender);
  const pdfPageGap = useReaderStore((state) => state.pdfPageGap ?? 12);
  const rotation = useReaderStore((state) => state.rotation);
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const targetPage = useReaderStore((state) => state.targetPage);
  const clearTargetPage = useReaderStore((state) => state.clearTargetPage);

  const isSnippingActive = useAppStore((state) => state.isSnippingActive);
  const isAreaZoomActive = useAppStore((state) => Boolean(state.isAreaZoomActive));
  const isAnnotationActive = useAppStore((state) => Boolean(state.isAnnotationActive));
  const showToast = useAppStore((state) => state.showToast);
  const updateReadingProgress = useLibraryStore((state) => state.updateReadingProgress);
  const { handleContextMenu } = useContextMenu();

  const [numPages, setNumPages] = useState(0);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activePage, setActivePage] = useState(1);
  const [defaultRatio, setDefaultRatio] = useState(1.4142);
  const [containerWidth, setContainerWidth] = useState(900);
  const [ratioTick, setRatioTick] = useState(0);

  const [annotationsByPage, setAnnotationsByPage] = useState({});
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);

  const containerRef = useRef(null);

  // کالبدشکافی: عرضِ کانتینر باید با تغییرِ اندازهٔ پنجره هم به‌روز
  // شود، وگرنه ارتفاع‌ها (که از عرضِ قدیمی حساب شده‌اند) با عرضِ
  // تازهٔ کارت نمی‌خوانند و آفستِ صفحه‌ها منحرف می‌شود (فعال/دورِ
  // اشتباه و غافلگیریِ حالتِ سبک/نیم‌کیفیت).
  useEffect(() => {
    const onResize = () => {
      const c = containerRef.current;
      if (!c) return;
      const w = Math.round(c.clientWidth || 900);
      setContainerWidth((prev) => (Math.abs(w - prev) > 2 ? w : prev));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const isJumpingRef = useRef(false);
  const isResumingRef = useRef(false);
  const hasResumedRef = useRef(false);
  const pendingResumePageRef = useRef(null);
  const abortControllerRef = useRef(null);
  const customRatiosRef = useRef(new Map());
  const pageBlobCacheRef = useRef(new Map());
  // فاز ۳: صفحه‌های در دید، برای تخلیهٔ هوشمندِ کش (مراجعهٔ زیر).
  const visiblePageNumbersRef = useRef([]);
  const prevZoomRef = useRef(zoomLevel);
  const scrollIdleTimerRef = useRef(null);
  const activePageRef = useRef(1);
  activePageRef.current = activePage;

  // مرحله ۴ — جستجوی درون‌متنی PDF (غیرمسدودکننده):
  // pdfDocRef آینهٔ همان سندِ state است (سندِ دومی باز نمی‌شود)؛
  // pageTextCacheRef فقط متن + مستطیل‌های درصدی را نگه می‌دارد (نه تصویر)،
  // پس با کشِ Blobِ صفحات (pageBlobCacheRef) هیچ تماسی ندارد.
  const pdfDocRef = useRef(null);
  pdfDocRef.current = pdfDoc;
  const pageTextCacheRef = useRef(new Map());
  const searchRunIdRef = useRef(0);
  const searchInputRef = useRef(null);
  const searchDebounceRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchCurrentKey, setSearchCurrentKey] = useState(null);
  const [searchScanning, setSearchScanning] = useState(false);
  const [searchScannedCount, setSearchScannedCount] = useState(0);

  const safeZoom = Math.min(3.5, Math.max(0.4, Number(zoomLevel) || 1));
  const safePageGap = Math.max(0, Math.min(48, Math.round(Number(pdfPageGap) ?? 12)));

  const clearAllCachedPageBlobs = useCallback(() => {
    for (const [, url] of pageBlobCacheRef.current.entries()) {
      if (url) {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }
    }
    pageBlobCacheRef.current.clear();
  }, []);

  const storePageBlobInCache = useCallback((pageNum, blobUrl) => {
    if (!pageNum || !blobUrl) return;
    const cache = pageBlobCacheRef.current;

    if (cache.has(pageNum)) {
      const oldUrl = cache.get(pageNum);
      if (oldUrl && oldUrl !== blobUrl) {
        try {
          URL.revokeObjectURL(oldUrl);
        } catch (_) {}
      }
      cache.delete(pageNum);
    }

    // فاز ۳: تخلیه، اولِ قدیمی‌ترین صفحهٔ خارج از دید را می‌زند (نه
    // لزوماً قدیمی‌ترینِ مطلق) تا صفحه‌های در دید، بی‌دلیل از کش
    // نیفتند. اگر همهٔ صفحه‌های کش در دید بودند، قدیمی‌ترین می‌رود
    // تا سقف، همیشه برقرار بماند. (سقف از قبل ۱۸ بود — کمتر از
    // ۳۰ای که تسک گفته بود — پس بالا برده نشد.)
    while (cache.size >= MAX_CACHED_BLOBS) {
      const visible = visiblePageNumbersRef.current || [];
      let evictKey = null;
      for (const key of cache.keys()) {
        if (!visible.includes(key)) { evictKey = key; break; }
      }
      if (evictKey == null) evictKey = cache.keys().next().value;
      const evictUrl = cache.get(evictKey);
      if (evictUrl) {
        try {
          URL.revokeObjectURL(evictUrl);
        } catch (_) {}
      }
      cache.delete(evictKey);
    }

    cache.set(pageNum, blobUrl);
  }, []);

  // ۱. واکشی یادداشت‌ها و هایلایت‌های ذخیره‌شده از دیتابیس
  useEffect(() => {
    let isMounted = true;
    setAnnotationsByPage({});
    setUndoStack([]);
    setRedoStack([]);

    if (!filePath) return;
    if (!coreApi.isAvailable()) {
      // فاز ۴، بخش ۳: بدونِ Electron، دیتابیس در دسترس نیست؛ فقط از
      // پشتیبانِ localStorage بخوان تا حاشیه‌نویسی‌ها با بستنِ برنامه
      // از بین نروند.
      setAnnotationsByPage(annotationLocalBackup.restoreBackupsAsPages(filePath));
      return;
    }

    coreApi
      .dbAction({
        action: 'GET_ANNOTATIONS',
        payload: { filePath },
      })
      .then((res) => {
        if (!isMounted) return;
        const dbPages = res?.annotations && typeof res.annotations === 'object' ? res.annotations : {};
        // فاز ۴، بخش ۳: آینهٔ localStorage فقط جاهای خالیِ دیتابیس را پر
        // می‌کند (دیتابیس، حتی با آرایهٔ خالی، برنده است).
        const merged = annotationLocalBackup.mergeBackupsIntoPages(filePath, dbPages);
        setAnnotationsByPage(merged.pages);
        // ترمیم: صفحه‌هایی که فقط در پشتیبان بودند، به دیتابیس هم برگردند.
        if (coreApi.isAvailable()) {
          merged.healed.forEach((({ pageNum, items }) => {
            coreApi.savePageAnnotations(filePath, pageNum, items).catch(() => {});
          }));
        }
      })
      .catch(() => {});

    return () => {
      isMounted = false;
    };
  }, [filePath]);

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

      if (filePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(filePath, pageNum, nextPageItems)
          .catch(() => {});
      }
      // فاز ۴، بخش ۳: آینهٔ localStorage — هرگز throw نمی‌کند و روی
      // مسیرِ دیتابیس اثر نمی‌گذارد.
      annotationLocalBackup.writePageBackup(filePath, pageNum, nextPageItems);
    },
    [filePath]
  );

  const handleUndoAnnotation = useCallback(() => {
    setUndoStack((prevUndo) => {
      if (prevUndo.length === 0) return prevUndo;
      const lastAction = prevUndo[prevUndo.length - 1];
      const pageKey = String(lastAction.pageNum);

      setAnnotationsByPage((prevMap) => ({
        ...prevMap,
        [pageKey]: lastAction.prevItems,
      }));
      setRedoStack((r) => [...r, lastAction]);

      if (filePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(filePath, lastAction.pageNum, lastAction.prevItems)
          .catch(() => {});
      }
      annotationLocalBackup.writePageBackup(filePath, lastAction.pageNum, lastAction.prevItems);
      return prevUndo.slice(0, -1);
    });
  }, [filePath]);

  const handleRedoAnnotation = useCallback(() => {
    setRedoStack((prevRedo) => {
      if (prevRedo.length === 0) return prevRedo;
      const nextAction = prevRedo[prevRedo.length - 1];
      const pageKey = String(nextAction.pageNum);

      setAnnotationsByPage((prevMap) => ({
        ...prevMap,
        [pageKey]: nextAction.nextItems,
      }));
      setUndoStack((u) => [...u, nextAction]);

      if (filePath && coreApi.isAvailable()) {
        coreApi
          .savePageAnnotations(filePath, nextAction.pageNum, nextAction.nextItems)
          .catch(() => {});
      }
      annotationLocalBackup.writePageBackup(filePath, nextAction.pageNum, nextAction.nextItems);
      return prevRedo.slice(0, -1);
    });
  }, [filePath]);

  const handleClearCurrentPageAnnotations = useCallback(() => {
    const pageNum = activePageRef.current || 1;
    handleCommitPageAnnotations(pageNum, []);
    showToast(`یادداشت‌های صفحه ${pageNum} پاک شد`, { type: 'info' });
  }, [handleCommitPageAnnotations, showToast]);

  // Refinement Final: مالکیتِ Ctrl+Z/Y وارونه شد تا Undoی مضاعف
  // رفع شود. قبلاً این شنونده فقط وقتی استودیو روشن بود ثبت می‌شد
  // و هم‌زمان با شنوندهٔ تولبار، هر دو handleUndoAnnotation را صدا
  // می‌زدند (تولبار هم از طریقِ prop، همان تابع را صدا می‌زد).
  // حالا: وقتی استودیو روشن است، مدیریتِ Undo منحصراً با تولبار است
  // (که در Capture با stopImmediatePropagation جلوی بقیه را هم
  // می‌گیرد) و این شنونده اصلاً ثبت نمی‌شود؛ وقتی استودیو خاموش
  // است، این شنونده ثبت می‌شود تا کاربر بعد از بستنِ استودیو هم
  // بتواند با Ctrl+Z/Y، آخرین حاشیه‌نویسی را برگرداند/جلو ببرد.
  // پس در هیچ حالتی، دو شنونده هم‌زمان برای Ctrl+Z/Y فعال نیستند.
  useEffect(() => {
    if (isAnnotationActive) return;
    const onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          handleRedoAnnotation();
        } else {
          e.preventDefault();
          handleUndoAnnotation();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedoAnnotation();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAnnotationActive, handleUndoAnnotation, handleRedoAnnotation]);

  // مرحله ۴ — Ctrl+F در ریدرِ PDF، جستجوی درون‌متنی را باز می‌کند.
  // توجه به ترتیبِ شنونده‌ها: useKeyboard (در App) شنوندهٔ capture دارد و
  // زودتر ثبت شده، پس اگر شاخهٔ focusSearch آن در ریدرِ PDF تسلیم نشود،
  // این شنونده هرگز به Ctrl+F نمی‌رسد (مراجعه: useKeyboard.js، مرحله ۴).
  // وقتی فوکوس داخلِ یک کادرِ متنی است، هیچ‌کدام دخالت نمی‌کنند.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || (e.key || '').toLowerCase() !== 'f') return;
      const t = e.target;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      setSearchOpen(true);
      setTimeout(() => {
        if (searchInputRef.current) searchInputRef.current.focus();
      }, 0);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ۲. بارگذاری سند PDF
  useEffect(() => {
    ensurePdfJsEnvironmentReady();

    let isMounted = true;
    hasResumedRef.current = false;
    isResumingRef.current = true;
    pendingResumePageRef.current = null;
    customRatiosRef.current.clear();
    clearAllCachedPageBlobs();
    hiDpiRenderService.clearFileCache(filePath);
    setErrorMsg(null);
    setIsLoading(true);
    setPdfDoc(null);
    setNumPages(0);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let activeDoc = null;
    let loadingTask = null;

    const loadPdfData = async () => {
      try {
        const sanitizedPath = String(filePath || '').trim().replace(/^[\\/]+/, '');
        const comicUrl = `comic://media/?path=${encodeURIComponent(sanitizedPath)}`;

        // مرحله ۲ ـ بخش الف: بارگذاریِ Range/Streaming به‌جای دانلودِ
        // کامل. pdf.js با url و پشتیبانیِ Range سرور (هدرهای
        // Accept-Ranges/Content-Range + Preflight در main.js)، فقط
        // چانک‌های لازم را می‌خواند؛ برای PDF صد مگابایتی، دیگر یک
        // کپیِ کامل در رمِ رندرر ساخته نمی‌شود. اگر بارگذاریِ URL به
        // هر دلیلی شکست خورد، به‌صورت خودکار به روشِ قبلیِ arrayBuffer
        // برمی‌گردد تا هیچ فایلی از باز شدن باز نماند.
        const loadPdfDocument = async () => {
          try {
            const rangeTask = pdfjsLib.getDocument({
              url: comicUrl,
              cMapPacked: true,
              isEvalSupported: false,
              enableXfa: true,
              disableAutoFetch: true,
              disableStream: false,
              disableRange: false,
              rangeChunkSize: 65536,
              stopAtErrors: false,
            });
            loadingTask = rangeTask;
            return await rangeTask.promise;
          } catch (rangeErr) {
            if (!isMounted) return null;
            try {
              if (typeof loadingTask?.destroy === 'function') await loadingTask.destroy();
            } catch (_) {}
            loadingTask = null;
          }

          if (!isMounted) return null;
          const response = await fetch(comicUrl, { signal: abortController.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);

          const arrayBuffer = await response.arrayBuffer();
          if (!isMounted) return null;

          const fallbackTask = pdfjsLib.getDocument({
            data: new Uint8Array(arrayBuffer),
            cMapPacked: true,
            isEvalSupported: false,
            enableXfa: true,
            disableAutoFetch: true,
            stopAtErrors: false,
          });
          loadingTask = fallbackTask;
          return await fallbackTask.promise;
        };

        const doc = await loadPdfDocument();
        if (!doc) return;
        activeDoc = doc;

        if (!isMounted) {
          if (typeof doc?.destroy === 'function') await doc.destroy();
          return;
        }

        let initialRatio = 1.4142;
        let firstPageObj = null;
        try {
          firstPageObj = await doc.getPage(1);
          const vp = firstPageObj.getViewport({ scale: 1.0 });
          if (vp.width > 0 && vp.height > 0) {
            initialRatio = Number((vp.height / vp.width).toFixed(5));
            customRatiosRef.current.set(0, initialRatio);
          }
        } catch (_) {}

        if (!isMounted) {
          if (typeof doc?.destroy === 'function') await doc.destroy();
          return;
        }

        if (firstPageObj && !thumbnailService.peekCover?.(filePath)) {
          setTimeout(async () => {
            if (!isMounted) return;
            let thumbCanvas = null;
            try {
              const baseVp = firstPageObj.getViewport({ scale: 1.0 });
              const thumbScale =
                baseVp.width > 0 ? Math.min(1.0, 320 / baseVp.width) : 0.45;
              const thumbVp = firstPageObj.getViewport({ scale: thumbScale });

              thumbCanvas = document.createElement('canvas');
              thumbCanvas.width = Math.max(1, Math.floor(thumbVp.width));
              thumbCanvas.height = Math.max(1, Math.floor(thumbVp.height));
              const ctx = thumbCanvas.getContext('2d', { alpha: false });
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, thumbCanvas.width, thumbCanvas.height);

              await firstPageObj.render({ canvasContext: ctx, viewport: thumbVp }).promise;
              if (isMounted) {
                const coverDataUrl = thumbCanvas.toDataURL('image/jpeg', 0.84);
                thumbnailService.seedCover?.(filePath, coverDataUrl);
              }
            } catch (_) {
            } finally {
              if (thumbCanvas) {
                thumbCanvas.width = 0;
                thumbCanvas.height = 0;
              }
            }
          }, 250);
        }

        const storeState = useReaderStore.getState();
        const currentComic = storeState.comicData;
        let savedPage =
          currentComic?.savedResumePage || storeState.currentPage || 1;

        if (savedPage <= 1) {
          const normTarget = filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase();
          const inRecents = (useLibraryStore.getState().recentItems || []).find(
            (r) =>
              (r.path || r.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
              normTarget
          );
          if (inRecents?.lastPage > 1) {
            savedPage = Number(inRecents.lastPage);
          }
        }

        if (savedPage <= 1) {
          try {
            const timeoutGuard = new Promise((r) => setTimeout(() => r(null), 300));
            const progRes = await Promise.race([
              coreApi.dbAction({
                action: 'GET_PROGRESS',
                payload: { filePath },
              }),
              timeoutGuard,
            ]);
            if (progRes?.progress?.currentPage) {
              savedPage = Number(progRes.progress.currentPage) || 1;
            }
          } catch (_) {}
        }

        savedPage = Math.max(1, Math.min(savedPage, doc.numPages));

        if (currentComic && (!currentComic.items || currentComic.items.length !== doc.numPages)) {
          const virtualItems = Array.from({ length: doc.numPages }, (_, i) => ({
            index: i,
            name: `صفحه ${i + 1}`,
            fileName: `Page ${i + 1}`,
            path: `${filePath}#page=${i + 1}`,
            aspectRatio: initialRatio,
            isPdf: true,
          }));
          useReaderStore.getState().setComicData({
            ...currentComic,
            savedResumePage: savedPage,
            savedTotalPages: doc.numPages,
            items: virtualItems,
          });
          useReaderStore.getState().setCurrentPage(savedPage);
        }

        updateReadingProgress(filePath, savedPage, doc.numPages);

        pendingResumePageRef.current = savedPage;
        setDefaultRatio(initialRatio);
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setActivePage(savedPage);
        activePageRef.current = savedPage;
        setIsLoading(false);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        console.error('PDF Load Error:', err);
        if (isMounted) {
          setErrorMsg('بارگذاری فایل PDF با خطا مواجه شد: ' + (err?.message || 'خطای ناشناخته'));
          setIsLoading(false);
          isResumingRef.current = false;
        }
      }
    };

    if (filePath) {
      loadPdfData();
    }

    return () => {
      isMounted = false;
      abortController.abort();
      clearAllCachedPageBlobs();
      hiDpiRenderService.clearFileCache(filePath);
      if (activeDoc) {
        try {
          if (typeof activeDoc.cleanup === 'function') activeDoc.cleanup();
          if (typeof activeDoc.destroy === 'function') activeDoc.destroy();
        } catch (_) {}
      }
      if (loadingTask) {
        try {
          if (typeof loadingTask.destroy === 'function') loadingTask.destroy();
        } catch (_) {}
      }
    };
  }, [filePath, clearAllCachedPageBlobs, updateReadingProgress]);

  // ۳. محاسبه ارتفاع دقیق صفحات و آفست‌ها
  const { pageHeights, pageOffsets, totalHeight } = useMemo(() => {
    if (numPages <= 0) return { pageHeights: [], pageOffsets: [], totalHeight: 0 };
    const zoomPercentFactor = Math.round(safeZoom * 100) / 100;
    const effectiveWidth = Math.max(280, containerWidth * zoomPercentFactor);
    const heights = new Array(numPages);
    const offsets = new Array(numPages);
    let currentTop = 0;

    for (let i = 0; i < numPages; i++) {
      offsets[i] = currentTop;
      const ratio = customRatiosRef.current.get(i) || defaultRatio;
      const h = Math.max(300, Math.round(effectiveWidth * ratio));
      heights[i] = h;
      currentTop += h + (i < numPages - 1 ? safePageGap : 0);
    }
    return { pageHeights: heights, pageOffsets: offsets, totalHeight: currentTop };
  }, [numPages, containerWidth, safeZoom, safePageGap, defaultRatio, ratioTick]);

  const pageOffsetsRef = useRef(pageOffsets);
  pageOffsetsRef.current = pageOffsets;
  const pageHeightsRef = useRef(pageHeights);
  pageHeightsRef.current = pageHeights;

  // =========================================================================
  // مرحله ۴ — موتورِ جستجوی درون‌متنیِ PDF (غیرمسدودکننده)
  // =========================================================================
  // اصولِ طراحی (اثباتِ عدمِ تداخل در بخشِ ۱ گزارش آمده است):
  // ۱) سندِ دومی باز نمی‌شود: همه‌چیز روی همان pdfDocRef (آینهٔ state) است.
  // ۲) فقط متن خوانده می‌شود (getTextContent)؛ هیچ رندری، هیچ canvas و
  //    هیچ تماسی با کشِ Blobِ صفحات (pageBlobCacheRef) وجود ندارد.
  // ۳) استخراج، تکه‌تکه (۴ صفحه در هر تکه) و با واگذاریِ فریم (rAF) انجام
  //    می‌شود تا اسکرول و رندرِ صفحهٔ فعلی هرگز قفل نشوند؛ هر تایپِ تازه یا
  //    بستنِ نوار، با searchRunIdRef حلقهٔ قبلی را بی‌درنگ متوقف می‌کند.
  // ۴) مختصاتِ هایلایت درصدی‌اند (نسبت به کادرِ صفحه)، پس با زوم و چرخش
  //    (اورلی داخلِ همان wrapperِ چرخان است) هم‌تراز می‌مانند.
  // ۵) متنِ نرمال‌شده با نگاشتِ ۱:۱ ساخته می‌شود و تطابق روی نسخهٔ
  //    بدونِ فاصله/نیم‌فاصله انجام می‌شود؛ نگاشتِ موقعیتی
  //    (strippedToOriginal) آفست‌ها را دقیق به آیتم‌های اصلی برمی‌گرداند.
  //    پس «نام کتاب» با «نامکتاب» (جداییِ آیتم‌های pdf.js) و «می‌شود» با
  //    «می شود» هم می‌خورد؛ متنِ عمودیِ داخلِ صفحه فقط تقریبی است.
  const extractPageText = useCallback(async (pageNum) => {
    const cached = pageTextCacheRef.current.get(pageNum);
    if (cached) return cached;
    const doc = pdfDocRef.current;
    if (!doc) return { text: '', normalized: '', stripped: '', strippedToOriginal: [], items: [] };
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const items = [];
    let text = '';
    for (const item of textContent.items || []) {
      const str = item.str || '';
      const start = text.length;
      text += str;
      const end = text.length;
      if (!str) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      const scaleX = Math.hypot(tx[0], tx[1]);
      const scaleY = Math.hypot(tx[2], tx[3]);
      const fontHeight = scaleY;
      const advance = (item.width || 0) * scaleX;
      const vertical = Math.abs(tx[1]) > Math.abs(tx[0]);
      let rect;
      if (vertical) {
        // متنِ عمودی: تقریبِ ابعادی (جعبهٔ بلند)؛ برای متنِ افقی دقیق است.
        rect = {
          left: (tx[4] / viewport.width) * 100,
          top: ((tx[5] - advance) / viewport.height) * 100,
          width: (fontHeight / viewport.width) * 100,
          height: (advance / viewport.height) * 100,
        };
      } else {
        rect = {
          left: (tx[4] / viewport.width) * 100,
          top: ((tx[5] - fontHeight) / viewport.height) * 100,
          width: (advance / viewport.width) * 100,
          height: (fontHeight / viewport.height) * 100,
        };
      }
      items.push({ start, end, rect, vertical });
    }
    const normalized = normalizeSearchText(text);
    const strippedChars = [];
    const strippedToOriginal = [];
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t' || ch === '\u200C' || ch === '\u200D') continue;
      strippedChars.push(ch);
      strippedToOriginal.push(i);
    }
    const entry = {
      text,
      normalized,
      stripped: strippedChars.join(''),
      strippedToOriginal,
      items,
    };
    pageTextCacheRef.current.set(pageNum, entry);
    return entry;
  }, []);

  // نگاشتِ یک تطابق روی آیتم‌ها به مستطیل‌های درصدی.
  const findMatchesInPage = useCallback((entry, normQuery) => {
    const out = [];
    if (!entry || !entry.stripped || !normQuery) return out;
    const sq = normQuery.replace(/[\s\u200C\u200D]+/g, '');
    if (!sq) return out;
    let from = 0;
    while (true) {
      const sStart = entry.stripped.indexOf(sq, from);
      if (sStart === -1) break;
      const sEnd = sStart + sq.length;
      const start = entry.strippedToOriginal[sStart];
      const end = entry.strippedToOriginal[sEnd - 1] + 1;
      const rects = [];
      for (const item of entry.items) {
        if (item.end <= start || item.start >= end) continue;
        const overlapStart = Math.max(start, item.start);
        const overlapEnd = Math.min(end, item.end);
        const itemLen = Math.max(1, item.end - item.start);
        if (overlapStart === item.start && overlapEnd === item.end) {
          rects.push(item.rect);
        } else {
          const f0 = (overlapStart - item.start) / itemLen;
          const f1 = (overlapEnd - item.start) / itemLen;
          if (item.vertical) {
            rects.push({
              left: item.rect.left,
              width: item.rect.width,
              top: item.rect.top + item.rect.height * f0,
              height: item.rect.height * (f1 - f0),
            });
          } else {
            rects.push({
              top: item.rect.top,
              height: item.rect.height,
              left: item.rect.left + item.rect.width * f0,
              width: item.rect.width * (f1 - f0),
            });
          }
        }
      }
      if (rects.length > 0) out.push({ start, end, rects });
      from = sEnd;
    }
    return out;
  }, []);

  // اجرای جستجو: از صفحهٔ فعلی، یکی در میان به بیرون (نزدیک‌ترین اول).
  const runSearch = useCallback(async (query) => {
    const runId = ++searchRunIdRef.current;
    const normQuery = normalizeSearchText(query || '');
    if (!normQuery.trim()) {
      setSearchResults([]);
      setSearchCurrentKey(null);
      setSearchScanning(false);
      setSearchScannedCount(0);
      return;
    }
    const doc = pdfDocRef.current;
    if (!doc) return;
    const total = doc.numPages || 0;
    if (total <= 0) return;
    const startPage = Math.max(1, Math.min(total, activePageRef.current || 1));
    const order = [];
    for (let d = 0; d < total; d++) {
      if (startPage + d <= total) order.push(startPage + d);
      if (d > 0 && startPage - d >= 1) order.push(startPage - d);
    }
    setSearchScanning(true);
    setSearchScannedCount(0);
    const found = [];
    let scanned = 0;
    const CHUNK_PAGES = 4;
    for (let i = 0; i < order.length; i += CHUNK_PAGES) {
      if (searchRunIdRef.current !== runId) return;
      const chunk = order.slice(i, i + CHUNK_PAGES);
      for (const pageNum of chunk) {
        if (searchRunIdRef.current !== runId) return;
        let entry;
        try {
          entry = await extractPageText(pageNum);
        } catch (_) {
          entry = null;
        }
        if (searchRunIdRef.current !== runId) return;
        scanned += 1;
        setSearchScannedCount(scanned);
        if (!entry) continue;
        const matches = findMatchesInPage(entry, normQuery);
        if (matches.length > 0) {
          for (const m of matches) found.push({ page: pageNum, ...m });
          found.sort((a, b) => a.page - b.page || a.start - b.start);
          setSearchResults([...found]);
        }
      }
      if (i + CHUNK_PAGES < order.length) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
    }
    if (searchRunIdRef.current === runId) setSearchScanning(false);
  }, [extractPageText, findMatchesInPage]);

  const scrollToSearchResult = useCallback((target) => {
    const container = containerRef.current;
    if (!container || !target) return;
    const pageTop = pageOffsetsRef.current[target.page - 1] || 0;
    const pageH = pageHeightsRef.current[target.page - 1] || 800;
    const firstRect = target.rects && target.rects[0];
    const rectTopPx = firstRect ? (firstRect.top / 100) * pageH : 0;
    const top = Math.max(
      0,
      pageTop + rectTopPx - (container.clientHeight || 800) * 0.35
    );
    container.scrollTo({ top, behavior: 'smooth' });
  }, []);

  const goToSearchResult = useCallback(
    (dir) => {
      if (searchResults.length === 0) return;
      let idx = searchResults.findIndex(
        (r) => `${r.page}:${r.start}` === searchCurrentKey
      );
      if (idx === -1) idx = dir > 0 ? -1 : 0;
      const next = (idx + dir + searchResults.length) % searchResults.length;
      const target = searchResults[next];
      setSearchCurrentKey(`${target.page}:${target.start}`);
      scrollToSearchResult(target);
    },
    [searchResults, searchCurrentKey, scrollToSearchResult]
  );

  const closeSearch = useCallback(() => {
    searchRunIdRef.current += 1;
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchCurrentKey(null);
    setSearchScanning(false);
    setSearchScannedCount(0);
    // کشِ متن عمداً پاک نمی‌شود: باز کردنِ دوبارهٔ جستجو روی همان سند،
    // بدونِ هیچ درخواستِ تازه‌ای انجام می‌شود.
  }, []);

  // هایلایت‌های هر صفحه (کلیدِ نتیجهٔ جاری، رنگِ فعال را تعیین می‌کند).
  // رندرِ مجددِ صفحه‌هایِ در دید، فقط JSX است (افکت‌های رندرِ تصویر،
  // به searchHighlights وابسته نیستند و دوباره اجرا نمی‌شوند).
  const searchHighlightsByPage = useMemo(() => {
    const map = new Map();
    for (const r of searchResults) {
      const key = `${r.page}:${r.start}`;
      const arr = map.get(r.page) || [];
      arr.push({ rects: r.rects, isActive: key === searchCurrentKey });
      map.set(r.page, arr);
    }
    return map;
  }, [searchResults, searchCurrentKey]);

  // متنِ شمارنده (ارقامِ فارسی).
  const searchCounterText = (() => {
    const fa = (n) => Number(n || 0).toLocaleString('fa-IR');
    if (!searchQuery.trim()) return '';
    if (searchResults.length === 0) {
      return searchScanning
        ? `در حال اسکن… ${fa(searchScannedCount)} از ${fa(numPages)} صفحه`
        : 'یافت نشد';
    }
    const idx = searchResults.findIndex(
      (r) => `${r.page}:${r.start}` === searchCurrentKey
    );
    if (idx === -1) {
      return searchScanning
        ? `${fa(searchResults.length)} نتیجه — در حال اسکن…`
        : `${fa(searchResults.length)} نتیجه`;
    }
    return searchScanning
      ? `${fa(idx + 1)} از ${fa(searchResults.length)} — در حال اسکن…`
      : `${fa(idx + 1)} از ${fa(searchResults.length)}`;
  })();

  // دیبانسِ ۲۵۰ میلی‌ثانیه‌ایِ تایپ + پاک‌سازیِ فوری با خالی شدنِ عبارت.
  useEffect(() => {
    if (!searchOpen) return;
    if (!searchQuery.trim()) {
      searchRunIdRef.current += 1;
      setSearchResults([]);
      setSearchCurrentKey(null);
      setSearchScanning(false);
      setSearchScannedCount(0);
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
      return;
    }
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      runSearch(searchQuery);
    }, 250);
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }
    };
  }, [searchQuery, searchOpen, runSearch]);

  // تعویضِ فایل یا آنمانت: لغوِ اسکنِ جاری + پاک‌سازیِ کشِ متنِ سندِ قبلی.
  useEffect(() => {
    searchRunIdRef.current += 1;
    pageTextCacheRef.current.clear();
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchCurrentKey(null);
    setSearchScanning(false);
    setSearchScannedCount(0);
    return () => {
      searchRunIdRef.current += 1;
      pageTextCacheRef.current.clear();
    };
  }, [filePath]);


  // ۴. پرش ادامه مطالعه
  useEffect(() => {
    if (
      isLoading ||
      numPages <= 0 ||
      pageOffsets.length !== numPages ||
      pendingResumePageRef.current === null
    ) {
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const measuredW = Math.round(container.clientWidth || 900);
    if (Math.abs(measuredW - containerWidth) > 2) {
      setContainerWidth(measuredW);
      return;
    }

    const targetResumePage = Math.max(
      1,
      Math.min(numPages, pendingResumePageRef.current)
    );
    pendingResumePageRef.current = null;

    if (targetResumePage > 1) {
      const targetTop = pageOffsets[targetResumePage - 1] || 0;
      setActivePage(targetResumePage);
      activePageRef.current = targetResumePage;
      setCurrentPage(targetResumePage);
      container.scrollTop = targetTop;

      const timer = setTimeout(() => {
        if (containerRef.current) {
          const finalTop = pageOffsetsRef.current[targetResumePage - 1] || 0;
          containerRef.current.scrollTop = finalTop;
        }
        hasResumedRef.current = true;
        isResumingRef.current = false;
      }, 110);

      return () => clearTimeout(timer);
    } else {
      container.scrollTop = 0;
      hasResumedRef.current = true;
      isResumingRef.current = false;
    }
  }, [isLoading, numPages, pageOffsets, containerWidth, setCurrentPage]);

  // ۵. قفل دقیق اسکرول افقی و عمودی هنگام استفاده از «زوم باکسی» (AreaZoomOverlay)
  useEffect(() => {
    if (!areaZoomTarget || !containerRef.current || pageOffsets.length === 0) return;

    const container = containerRef.current;
    prevZoomRef.current = zoomLevel;

    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      const c = containerRef.current;
      const { normCenterX = 0.5, normCenterY = 0.5, rect } = areaZoomTarget;

      let targetScrollTop = 0;
      if (rect?.pageNumber && rect.pageNumber >= 1 && rect.pageNumber <= numPages) {
        const idx = rect.pageNumber - 1;
        const pTop = pageOffsetsRef.current[idx] || 0;
        const pHeight = pageHeightsRef.current[idx] || 800;
        const relY = typeof rect.pageRelativeY === 'number' ? rect.pageRelativeY : 0.5;
        targetScrollTop = pTop + pHeight * relY - c.clientHeight / 2;
      } else {
        targetScrollTop = normCenterY * c.scrollHeight - c.clientHeight / 2;
      }

      const targetScrollLeft = normCenterX * c.scrollWidth - c.clientWidth / 2;

      c.scrollTop = Math.max(0, targetScrollTop);
      c.scrollLeft = Math.max(0, targetScrollLeft);
      clearAreaZoomTarget();
    });
  }, [areaZoomTarget, zoomLevel, numPages, pageOffsets.length, clearAreaZoomTarget]);

  // ۶. حفظ کانون دید هنگام تغییر زوم عادی
  useEffect(() => {
    if (areaZoomTarget) return;
    const container = containerRef.current;
    const prev = prevZoomRef.current;

    if (!container || prev === zoomLevel || prev <= 0) {
      prevZoomRef.current = zoomLevel;
      return;
    }

    const factor = zoomLevel / prev;
    const ch = container.clientHeight || 800;
    const center = container.scrollTop + ch / 2;
    container.scrollTop = Math.max(0, center * factor - ch / 2);
    prevZoomRef.current = zoomLevel;
  }, [zoomLevel, areaZoomTarget]);

  // ۷. محاسبه پنجره مجازی DOM
  const { visiblePageNumbers, paddingTop, paddingBottom } = useMemo(() => {
    if (numPages <= 0 || pageOffsets.length === 0) {
      return { visiblePageNumbers: [], paddingTop: 0, paddingBottom: 0 };
    }

    const centerIndex = Math.max(0, Math.min(numPages - 1, activePage - 1));
    const startIdx = Math.max(0, centerIndex - DOM_OVERSCAN);
    const endIdx = Math.min(numPages - 1, centerIndex + DOM_OVERSCAN);

    const pages = [];
    for (let i = startIdx; i <= endIdx; i++) {
      pages.push(i + 1);
    }

    const pTop = pageOffsets[startIdx] || 0;
    const endBottom =
      (pageOffsets[endIdx] || 0) +
      (pageHeights[endIdx] || 0) +
      (endIdx < numPages - 1 ? safePageGap : 0);
    const pBottom = Math.max(0, totalHeight - endBottom);

    return {
      visiblePageNumbers: pages,
      paddingTop: pTop,
      paddingBottom: pBottom,
    };
  }, [numPages, activePage, pageOffsets, pageHeights, totalHeight, safePageGap]);

  // فاز ۳: صفحه‌های در دید را برای تخلیهٔ کش، در ref نگه دار.
  visiblePageNumbersRef.current = visiblePageNumbers;

  const handlePageRatioMeasured = useCallback(
    (pageIndex, measuredRatio) => {
      if (!measuredRatio || measuredRatio <= 0) return;
      const existing = customRatiosRef.current.get(pageIndex) || defaultRatio;
      if (Math.abs(existing - measuredRatio) > 0.015) {
        customRatiosRef.current.set(pageIndex, measuredRatio);
        setRatioTick((t) => (t + 1) % 10000);
      }
    },
    [defaultRatio]
  );

  // ۸. رصد اسکرول Passive + فراخوانی ری‌رندر HiDPI پس از توقف اسکرول
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isLoading || numPages <= 0) return;

    setContainerWidth(Math.round(container.clientWidth || 900));

    let rafId = null;

    const updateActivePageFromScroll = () => {
      if (isJumpingRef.current || isResumingRef.current || !hasResumedRef.current) {
        return;
      }
      const offs = pageOffsetsRef.current;
      const hts = pageHeightsRef.current;
      if (!offs || offs.length === 0) return;

      const viewportCenter = container.scrollTop + (container.clientHeight || 800) / 2;

      let low = 0;
      let high = numPages - 1;
      let foundIdx = 0;

      while (low <= high) {
        const mid = (low + high) >>> 1;
        const top = offs[mid] || 0;
        const bottom = top + (hts[mid] || 800) + safePageGap;
        if (viewportCenter < top) {
          high = mid - 1;
        } else if (viewportCenter > bottom) {
          low = mid + 1;
          foundIdx = mid;
        } else {
          foundIdx = mid;
          break;
        }
      }

      const nextPage = Math.max(1, Math.min(numPages, foundIdx + 1));
      if (nextPage !== activePageRef.current) {
        activePageRef.current = nextPage;
        setActivePage(nextPage);
        setCurrentPage(nextPage);

        if (filePath) {
          updateReadingProgress(filePath, nextPage, numPages);
        }
      }
    };

    const handleScroll = () => {
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          updateActivePageFromScroll();
        });
      }

      if (scrollIdleTimerRef.current) {
        clearTimeout(scrollIdleTimerRef.current);
      }
      scrollIdleTimerRef.current = setTimeout(() => {
        triggerHiDpiRender?.();
      }, 220);
    };

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = Math.round(entry.contentRect.width || container.clientWidth || 900);
          setContainerWidth((prev) => (Math.abs(prev - w) > 2 ? w : prev));
        }
      });
      resizeObserver.observe(container);
    }

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      if (scrollIdleTimerRef.current) clearTimeout(scrollIdleTimerRef.current);
      if (resizeObserver) resizeObserver.disconnect();
      container.removeEventListener('scroll', handleScroll);
    };
  }, [
    isLoading,
    numPages,
    filePath,
    safePageGap,
    setCurrentPage,
    updateReadingProgress,
    triggerHiDpiRender,
  ]);

  // ۹. زوم کانونی با چرخ ماوس (Ctrl + Wheel تا سقف 3.5x)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isLoading) return;

    let isWheelListenerAttached = false;

    const handleWheelZoom = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();

      const delta = e.deltaY < 0 ? 0.1 : -0.1;
      const currentZoom = useReaderStore.getState().zoomLevel || 1.0;
      const nextZoom = Math.min(
        3.5,
        Math.max(0.4, parseFloat((currentZoom + delta).toFixed(2)))
      );

      if (nextZoom !== currentZoom) {
        const rect = container.getBoundingClientRect();
        const mouseY = e.clientY - rect.top;
        const scrollY = container.scrollTop;
        const factor = nextZoom / currentZoom;

        prevZoomRef.current = nextZoom;
        setZoomLevel(nextZoom);

        requestAnimationFrame(() => {
          container.scrollTop = (scrollY + mouseY) * factor - mouseY;
        });
      }
    };

    const attachNonPassiveWheel = () => {
      if (!isWheelListenerAttached && containerRef.current) {
        containerRef.current.addEventListener('wheel', handleWheelZoom, {
          passive: false,
        });
        isWheelListenerAttached = true;
      }
    };

    const detachNonPassiveWheel = () => {
      if (isWheelListenerAttached && containerRef.current) {
        containerRef.current.removeEventListener('wheel', handleWheelZoom);
        isWheelListenerAttached = false;
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Control' || e.key === 'Meta' || e.ctrlKey || e.metaKey) {
        attachNonPassiveWheel();
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Control' || e.key === 'Meta' || (!e.ctrlKey && !e.metaKey)) {
        detachNonPassiveWheel();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: true });
    window.addEventListener('keyup', handleKeyUp, { passive: true });
    window.addEventListener('blur', detachNonPassiveWheel, { passive: true });

    return () => {
      detachNonPassiveWheel();
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', detachNonPassiveWheel);
    };
  }, [isLoading, setZoomLevel]);

  // ۱۰. پرش مستقیم به صفحه هدف انتخاب‌شده توسط کاربر
  useEffect(() => {
    if (
      targetPage !== null &&
      targetPage >= 1 &&
      targetPage <= numPages &&
      containerRef.current
    ) {
      isJumpingRef.current = true;
      const targetIdx = targetPage - 1;
      setActivePage(targetPage);
      activePageRef.current = targetPage;

      const targetOffset = pageOffsetsRef.current[targetIdx];
      if (targetOffset !== undefined) {
        containerRef.current.scrollTo({
          top: targetOffset,
          behavior: 'smooth',
        });
      }

      clearTargetPage();
      if (filePath) {
        updateReadingProgress(filePath, targetPage, numPages);
      }

      setTimeout(() => {
        isJumpingRef.current = false;
      }, 550);
    }
  }, [targetPage, numPages, filePath, clearTargetPage, updateReadingProgress]);

  const handleContainerContextMenu = useCallback(
    (e) => {
      if (!e.target.closest('.comic-page-item')) {
        handleContextMenu(e, {
          pageIndex: Math.max(0, activePageRef.current - 1),
          imagePath: null,
          comic: useReaderStore.getState().comicData,
        });
      }
    },
    [handleContextMenu]
  );

  const handlePageContextMenu = useCallback(
    (e, pageIndex, imageSrc) => {
      handleContextMenu(e, {
        pageIndex,
        imagePath: imageSrc,
        dataUrl: imageSrc,
        comic: useReaderStore.getState().comicData,
      });
    },
    [handleContextMenu]
  );

  if (errorMsg) {
    return (
      <div style={styles.errorBox}>
        <Icons.AlertTriangle size={28} />
        <span>{errorMsg}</span>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.spinnerBox}>
          <Icons.Loader size={32} />
        </div>
        <div>در حال آماده‌سازی سند PDF...</div>
      </div>
    );
  }

  const currentActivePageAnnotations =
    annotationsByPage[String(activePage)] || [];

  return (
    <div style={styles.outerWrapper}>
      {/* نوار ابزار استودیو ویرایش (فقط هنگام فعال شدن از TopBar نمایش داده می‌شود) */}
      <AnnotationToolbar
        activePage={activePage}
        pageItemCount={currentActivePageAnnotations.length}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        onUndo={handleUndoAnnotation}
        onRedo={handleRedoAnnotation}
        onClearPage={handleClearCurrentPageAnnotations}
      />

      {/* مرحله ۴ — نوارِ شناورِ جستجوی درون‌متنی PDF (بالای اسکرول، زیر TopBar) */}
      {searchOpen && (
        <div style={styles.searchBar} dir="rtl">
          <span style={{ color: 'var(--muted)', display: 'flex' }}>
            <Icons.Search size={16} />
          </span>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                goToSearchResult(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeSearch();
              }
            }}
            placeholder="جستجو در این PDF…"
            dir="auto"
            style={styles.searchInput}
          />
          {searchCounterText && (
            <span style={styles.searchCounter}>{searchCounterText}</span>
          )}
          <button
            type="button"
            title="نتیجهٔ قبلی (Shift+Enter)"
            onClick={() => goToSearchResult(-1)}
            style={styles.searchIconBtn}
          >
            <Icons.ChevronUp size={16} />
          </button>
          <button
            type="button"
            title="نتیجهٔ بعدی (Enter)"
            onClick={() => goToSearchResult(1)}
            style={styles.searchIconBtn}
          >
            <Icons.ChevronDown size={16} />
          </button>
          <button
            type="button"
            title="بستن (Escape)"
            onClick={closeSearch}
            style={styles.searchIconBtn}
          >
            <Icons.X size={16} />
          </button>
        </div>
      )}
      {!searchOpen && !isLoading && !isSnippingActive && !isAreaZoomActive && (
        <button
          type="button"
          title="جستجو در PDF (Ctrl+F)"
          onClick={() => {
            setSearchOpen(true);
            setTimeout(() => {
              if (searchInputRef.current) searchInputRef.current.focus();
            }, 0);
          }}
          style={styles.searchFab}
        >
          <Icons.Search size={17} />
        </button>
      )}

      <div
        ref={containerRef}
        data-reader-scroll-container="true"
        style={{
          ...styles.scrollContainer,
          pointerEvents: isSnippingActive || isAreaZoomActive ? 'none' : 'auto',
        }}
        onContextMenu={handleContainerContextMenu}
      >
        <div
          style={{
            ...styles.zoomWrapper,
            width: `${Math.round(safeZoom * 100)}%`,
          }}
        >
          <div style={{ height: `${paddingTop}px`, width: '100%', flexShrink: 0 }} />

          {pdfDoc &&
            visiblePageNumbers.map((pageNum) => {
              const index = pageNum - 1;
              const distance = Math.abs(pageNum - activePage);
              const shouldRender = distance <= RENDER_RADIUS;
              const cachedUrl = pageBlobCacheRef.current.get(pageNum) || null;
              const pageAnnots = annotationsByPage[String(pageNum)] || [];

              return (
                <PdfPageItem
                  key={pageNum}
                  filePath={filePath}
                  pageNumber={pageNum}
                  isLastPage={pageNum === numPages}
                  pageGap={safePageGap}
                  pdfDoc={pdfDoc}
                  zoomLevel={safeZoom}
                  hiDpiRenderTick={hiDpiRenderTick}
                  distanceFromActive={distance}
                  shouldRender={shouldRender}
                  cachedBlobUrl={cachedUrl}
                  onStorePageBlob={storePageBlobInCache}
                  expectedHeight={pageHeights[index]}
                  pageWidth={containerWidth * (Math.round(safeZoom * 100) / 100)}
                  rotation={rotation}
                  pageAnnotations={pageAnnots}
                  searchHighlights={searchHighlightsByPage.get(pageNum) || null}
                  onCommitPageAnnotations={handleCommitPageAnnotations}
                  onPageRatioMeasured={handlePageRatioMeasured}
                  onContextMenu={handlePageContextMenu}
                />
              );
            })}

          <div style={{ height: `${paddingBottom}px`, width: '100%', flexShrink: 0 }} />
        </div>
      </div>
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
  searchBar: {
    position: 'absolute',
    top: '64px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 10px',
    backgroundColor: 'rgba(13, 20, 26, 0.97)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: '12px',
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.55)',
    direction: 'rtl',
    maxWidth: 'calc(100% - 32px)',
  },
  searchInput: {
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    minWidth: '200px',
    flex: 1,
  },
  searchCounter: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    color: 'var(--muted)',
    whiteSpace: 'nowrap',
  },
  searchIconBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: 'var(--muted)',
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '8px',
  },
  searchFab: {
    position: 'absolute',
    top: '64px',
    right: '16px',
    zIndex: 55,
    width: '34px',
    height: '34px',
    borderRadius: '50%',
    backgroundColor: 'rgba(13, 20, 26, 0.92)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 22px rgba(0, 0, 0, 0.45)',
  },
  scrollContainer: {
    width: '100%',
    height: '100%',
    overflowY: 'auto',
    overflowX: 'auto',
    padding: '10px 0',
    position: 'relative',
    userSelect: 'none',
    direction: 'ltr',
    overflowAnchor: 'none',
  },
  zoomWrapper: {
    margin: '0 auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  pageWrapper: {
    width: '100%',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: '0',
    marginLeft: '0',
    marginRight: '0',
    padding: '0',
    backgroundColor: 'transparent',
    lineHeight: 0,
    fontSize: 0,
    position: 'relative',
    contain: 'layout paint',
    boxSizing: 'border-box',
  },
  pageImage: {
    width: '100%',
    height: 'auto',
    display: 'block',
    margin: '0',
    padding: '0',
    borderRadius: '4px',
    boxShadow: '0 4px 18px rgba(0, 0, 0, 0.45)',
    userSelect: 'none',
    WebkitUserDrag: 'none',
    imageRendering: 'high-quality',
  },
  pagePlaceholder: {
    width: '100%',
    height: '100%',
    minHeight: '450px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    boxSizing: 'border-box',
  },
  spinnerBox: {
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontFamily: 'var(--font-fa)',
    color: 'var(--muted)',
    fontSize: '12px',
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
  loadingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '14px',
    fontFamily: 'var(--font-fa)',
    color: 'var(--muted)',
    direction: 'rtl',
  },
  errorBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    height: '100%',
    fontFamily: 'var(--font-fa)',
    color: 'var(--danger)',
    fontSize: '14px',
    fontWeight: '600',
    direction: 'rtl',
  },
};