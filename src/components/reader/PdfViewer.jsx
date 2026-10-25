import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useContextMenu from '../../hooks/useContextMenu';
import { coreApi } from '../../services/coreApi';
import thumbnailService from '../../services/thumbnailService';
import hiDpiRenderService from '../../services/hiDpiRenderService';
import Icons from '../common/Icons';
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
  pageAnnotations,
  onCommitPageAnnotations,
  onPageRatioMeasured,
  onContextMenu,
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
      {activeSrc ? (
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            transform: rotation ? `rotate(${rotation}deg)` : 'none',
          }}
        >
          <img
            ref={imgRef}
            src={activeSrc}
            alt={`صفحه ${pageNumber}`}
            loading="eager"
            decoding="async"
            draggable={false}
            style={{
              ...styles.pageImage,
              height: expectedHeight ? `${expectedHeight}px` : '100%',
            }}
          />

          {/* لایه تعاملی استودیو ویرایش روی صفحه */}
          <AnnotationLayer
            pageNumber={pageNumber}
            items={pageAnnotations}
            onCommitPageItems={onCommitPageAnnotations}
            rotation={rotation}
          />
        </div>
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
  const isJumpingRef = useRef(false);
  const isResumingRef = useRef(false);
  const hasResumedRef = useRef(false);
  const pendingResumePageRef = useRef(null);
  const abortControllerRef = useRef(null);
  const customRatiosRef = useRef(new Map());
  const pageBlobCacheRef = useRef(new Map());
  const prevZoomRef = useRef(zoomLevel);
  const scrollIdleTimerRef = useRef(null);
  const activePageRef = useRef(1);
  activePageRef.current = activePage;

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

    while (cache.size >= MAX_CACHED_BLOBS) {
      const oldestKey = cache.keys().next().value;
      const oldestUrl = cache.get(oldestKey);
      if (oldestUrl) {
        try {
          URL.revokeObjectURL(oldestUrl);
        } catch (_) {}
      }
      cache.delete(oldestKey);
    }

    cache.set(pageNum, blobUrl);
  }, []);

  // ۱. واکشی یادداشت‌ها و هایلایت‌های ذخیره‌شده از دیتابیس
  useEffect(() => {
    let isMounted = true;
    setAnnotationsByPage({});
    setUndoStack([]);
    setRedoStack([]);

    if (!filePath || !coreApi.isAvailable()) return;

    coreApi
      .dbAction({
        action: 'GET_ANNOTATIONS',
        payload: { filePath },
      })
      .then((res) => {
        if (isMounted && res?.annotations && typeof res.annotations === 'object') {
          setAnnotationsByPage(res.annotations);
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
        const response = await fetch(
          `comic://media/?path=${encodeURIComponent(sanitizedPath)}`,
          { signal: abortController.signal }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const arrayBuffer = await response.arrayBuffer();
        if (!isMounted) return;

        loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(arrayBuffer),
          cMapPacked: true,
          isEvalSupported: false,
          enableXfa: true,
          disableAutoFetch: true,
          stopAtErrors: false,
        });

        const doc = await loadingTask.promise;
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
                  rotation={rotation}
                  pageAnnotations={pageAnnots}
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