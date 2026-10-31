import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useContextMenu from '../../hooks/useContextMenu';
import useDragPan from '../../hooks/useDragPan';
import { coreApi } from '../../services/coreApi';
import { getPdfSessionPassword, setPdfSessionPassword } from '../../services/pdfPasswordSession';
import { rebuildEditablePdfFromPdfJs, rebuildPdfBytesToBase64 } from '../../services/pdfRebuildService';
import annotationLocalBackup from '../../services/annotationLocalBackup';
import thumbnailService from '../../services/thumbnailService';
import hiDpiRenderService from '../../services/hiDpiRenderService';
import Icons from '../common/Icons';
import { normalizeSearchText } from '../../utils/persianSearch';
import { prepareAnnotatedPdfExport } from '../../utils/annotationPdfExport';
import useSettingsStore from '../../store/useSettingsStore';
import useBookmarkStore, { normalizeBookKey } from '../../store/useBookmarkStore';
import BookmarkMarker from './BookmarkMarker';
import { clampYRatio, resolveBookmarkImage } from './bookmarkTemplates';
import readingActivity from '../../services/readingActivity';
import { extractPdfOutline } from '../../utils/pdfOutline';
import { getReadingThemeFilter } from '../../utils/readingTheme';
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

const DOM_OVERSCAN = 5;
const RENDER_RADIUS = 4;
const MAX_CACHED_BLOBS = 30;

// مرحله ۴ ـ بخش ب: سقفِ کشِ متنِ جستجو + شعاعِ cleanup. شعاعِ ۶، یک
// صفحه حاشیه فراتر از پنجرهٔ رندر (DOM_OVERSCAN=۵) نگه می‌دارد.
const MAX_SEARCH_TEXT_CACHE_PAGES = 500;
const SEARCH_CLEANUP_RADIUS = 6;

// مرحله ۴ ـ بخش ب: جهتِ آیتمِ متنیِ pdf.js. در pdf.js، برای یک آیتمِ
// خالصِ فارسی/عبری، رشتهٔ item.str به ترتیبِ منطقی برمی‌گردد و
// item.dir برابرِ 'rtl' است، در حالی که tx[4] لبهٔ چپِ کادرِ بصری است؛
// پس کاراکترِ منطقیِ اول، سمتِ راستِ کادر است و برشِ افقیِ جزئی باید
// قرینه شود (اثباتِ تجربی در گزارشِ بخش ب). اگر dir نباشد، اولین
// کاراکترِ دارای جهتِ قوی تصمیم می‌گیرد.
const RTL_STRONG_RE = /[\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LTR_STRONG_RE = /[A-Za-z\u00C0-\u024F\u1E00-\u1EFF]/;
function isRtlSearchItem(item, str) {
  if (item && typeof item.dir === 'string') {
    if (item.dir === 'rtl') return true;
    if (item.dir === 'ltr') return false;
  }
  const text = str || '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (RTL_STRONG_RE.test(ch)) return true;
    if (LTR_STRONG_RE.test(ch)) return false;
  }
  return false;
}

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
// مرحله ۱۲: آرایهٔ مشترکِ «صفحه بدونِ حاشیه‌نویسی» — پیش از این،
 // در رندرِ والد، برای هر صفحهٔ بدونِ حاشیه‌نویسی، یک آرایهٔ
 // تازه (`|| []`) ساخته می‌شد و مقایسهٔ سطحیِ React.memo را
 // برای PdfPageItem و لایهٔ Konvaی درونِ آن، در هر رندرِ والد،
// شکست می‌داد. این آرایه، فریز شده و در همهٔ صفحه‌ها مشترک است.
const EMPTY_PAGE_ANNOTATIONS = Object.freeze([]);
const EMPTY_PAGE_BOOKMARKS = Object.freeze([]);

// مرحله ۱۲: مقایسه‌گرِ دقیقِ PdfPageItem — تنها تفاوتش با
// مقایسهٔ پیش‌فرض، نادیده گرفتنِ `distanceFromActive` است: این
// مقدار، در هر تغییرِ صفحهٔ فعال، برای همهٔ آیتم‌های مانت‌شده
// عوض می‌شود، ولی فقط برای تأخیرِ اولویت‌دارِ رندرِ پایه و گیتِ
// HiDPI لازم است که هر دو، حالا از راهِ `isNearViewport` /
// `isActivePage` (بولین‌های مرزی) و `distanceRef` دنبال
// می‌شوند. بقیهٔ پراپ‌ها، دقیقاً با `===` مقایسه می‌شوند (از
// جمله `zoomLevel` و `expectedHeight` که در زوم، واقعاً عوض
// می‌شوند و چیدمان، به‌روزرسانی‌شان را لازم دارد).

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

function arePdfPagePropsEqual(prev, next) {
  const { distanceFromActive: _prevDistance, ...prevRest } = prev;
  const { distanceFromActive: _nextDistance, ...nextRest } = next;
  const prevKeys = Object.keys(prevRest);
  const nextKeys = Object.keys(nextRest);
  if (prevKeys.length !== nextKeys.length) return false;
  for (const key of prevKeys) {
    if (prevRest[key] !== nextRest[key]) return false;
  }
  return true;
}

const PdfPageItem = React.memo(function PdfPageItem({
  filePath,
  pageNumber,
  isLastPage,
  pageGap,
  pdfDoc,
  zoomLevel,
  hiDpiRenderTick,
  distanceFromActive,
  isNearViewport,
  isActivePage,
  renderZoomLevel,
  shouldRender,
  cachedBlobUrl,
  onStorePageBlob,
  revokedBlobUrls,
  revokedTick,
  onDropPageBlob,
  expectedHeight,
  rotation,
  pageWidth,
  pageAnnotations,
  onCommitPageAnnotations,
  onPageRatioMeasured,
  onContextMenu,
  onHiDpiSettled,
  onRenameBookmark,
  onMoveBookmark,
  pageBookmarks,
  onOpenBookmark,
  onDeleteBookmark,
  searchHighlights,
  pageFilter,
  clipRect,
  deepSuspended,
}) {
  const [blobUrl, setBlobUrl] = useState(cachedBlobUrl || null);
  // مرحله ۲۰ — لایهٔ دیپ، drawable است (ImageBitmap یا بومِ جایگزین)،
  // نه URL؛ پس دیگر نه toBlobای هست، نه دیکدِ <img>ای برایِ آن.
  const [hiDpiDrawable, setHiDpiDrawable] = useState(() =>
    hiDpiRenderService.peekHiDpiPage(filePath, pageNumber, renderZoomLevel, null)
  );
  const [renderFailed, setRenderFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);


  const imgRef = useRef(null);
  const renderTaskRef = useRef(null);
  const erroredUrlsRef = useRef(new Set());
  const imgErrorCountRef = useRef(0);
  // مرحله ۱۳: تنظیماتِ بوک‌مارک (اشتراکِ داخلی؛ تغییرش نادر است و
  // memoیِ صفحه را نمی‌شکند، چون prop نیست).
  const bookmarkPreferences = useBookmarkStore((state) => state.preferences);
  // مرحله ۱۲: فاصلهٔ زنده از صفحهٔ فعال، برای تأخیرِ اولویت‌دار،
  // بدونِ اینکه وابستگیِ effectِ رندرِ پایه باشد (وگرنه، هر
  // تغییرِ صفحهٔ فعال، effectِ همهٔ صفحه‌ها را از نو راه
  // می‌انداخت).
  const distanceRef = useRef(distanceFromActive);
  distanceRef.current = distanceFromActive;

  // Stage 8 Part A: a cached/blob URL that was revoked by eviction is
  // treated as absent everywhere below; otherwise the render effect
  // would trust the dead string and the page would stay blank forever.
  const effectiveCachedBlobUrl =
    cachedBlobUrl && revokedBlobUrls && revokedBlobUrls.has(cachedBlobUrl) ? null : cachedBlobUrl;
  const effectiveBlobUrl =
    blobUrl && revokedBlobUrls && revokedBlobUrls.has(blobUrl) ? null : blobUrl;

  useEffect(() => {
    if (cachedBlobUrl && revokedBlobUrls && revokedBlobUrls.has(cachedBlobUrl)) {
      if (blobUrl === cachedBlobUrl) setBlobUrl(null);
      setRenderFailed(false);
      return;
    }
    if (cachedBlobUrl && cachedBlobUrl !== blobUrl) {
      setBlobUrl(cachedBlobUrl);
      setRenderFailed(false);
    }
  }, [cachedBlobUrl, blobUrl, revokedBlobUrls, revokedTick]);

  // الف: پاس اول (Fast Base Render) برای اسکرول بدون لگ
  useEffect(() => {
    if (!shouldRender || !pdfDoc || effectiveCachedBlobUrl || effectiveBlobUrl) return;

    let isCancelled = false;
    let tempCanvas = null;
    let activePageObj = null;

    // مرحله ۷ ـ نهاییِ دوم: صفحهٔ فعال، بدونِ هیچ تأخیری (۰
    // میلی‌ثانیه) در همان فریم رندر می‌شود؛ صفحه‌های مجاور، مثلِ
    // قبل با تأخیرِ اولویت‌دار.
    // مرحله ۱۲: فاصله از distanceRef خوانده می‌شود، نه از پراپ —
    // effect، دیگر به distanceFromActive وابسته نیست.
    const distanceNow = distanceRef.current;
    const priorityDelay =
      distanceNow === 0 ? 0 : distanceNow === 1 ? 40 : 100;

    // Stage 8 Part B: the Part A settle loop (up to 25 x 60ms re-arms
    // driven by a motion ref) is REMOVED. It delayed every non-active
    // page by up to 1.5s during a fast scroll and added fragile
    // cross-component motion state for no proven gain: pages already
    // cancel in-flight renders on cleanup, and the active page is
    // updated every animation frame by handleScroll. Every page in
    // the virtual window now renders on its plain priority delay.
    const runRender = async () => {
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

        // مرحله ۲۰ — لایهٔ پایهٔ فوق‌سبک: مقیاس، dpr با کفِ ۱٫۵ و
        // سقفِ ۱٫۸۵ است و ضلعِ بوم از ۲۲۰۰ پیکسل نمی‌گذرد تا اسکرول
        // سبک بماند؛ تیزیِ نهایی با لایهٔ دیپ (بومِ مستقیم) می‌آید،
        // نه با سنگین‌کردنِ پایه. (مرحلهٔ ۱۹ پایه را PNG و مقیاسِ
        // max(dpr, 2.0) کرده بود که همان کندیِ گزارش‌شده را ساخت.)
        let optimalScale = Math.min(Math.max(window.devicePixelRatio || 1, 1.5), 1.85);
        let viewport = page.getViewport({ scale: optimalScale });
        const maxBaseSide = Math.max(viewport.width, viewport.height);
        if (maxBaseSide > 2200) {
          optimalScale = Number((optimalScale * (2200 / maxBaseSide)).toFixed(3));
          viewport = page.getViewport({ scale: optimalScale });
        }

        tempCanvas = document.createElement('canvas');
        tempCanvas.width = Math.max(1, Math.floor(viewport.width));
        tempCanvas.height = Math.max(1, Math.floor(viewport.height));
        // مرحله ۱۷: بومِ استاندارد (بدونِ alpha:false که بافرِ
        // اولیه را سیاه می‌کند) و پر کردنِ سفید، پیش از هر کاری.
        const context = tempCanvas.getContext('2d');
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        // مرحله ۱۶: هموارسازیِ باکیفیتِ صریح برایِ پاسِ پایه (پیش‌فرضِ
        // مرورگر، کیفیتِ پایین است و بافتِ آناتومی را زبر می‌کند؛
        // پاسِ HiDPI در سرویس، از قبل همین را داشت).
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';

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
          0.90
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
    };

    const timerId = setTimeout(async () => {
      if (isCancelled) return;
      await runRender();
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
    effectiveCachedBlobUrl,
    effectiveBlobUrl,
    retryTick,
    revokedTick,
    onPageRatioMeasured,
    onStorePageBlob,
  ]);

  // ب: پاس دوم (Crystal-Clear HiDPI Re-render) پس از تثبیت زوم یا توقف روی صفحه
  // مرحله ۱۲: این effect، دیگر به زومِ زنده (`zoomLevel`) وابسته
  // نیست — رندرِ سنگینِ HiDPI، فقط با زومِ تثبیت‌شده
  // (`renderZoomLevel`، ۱۵۰ میلی‌ثانیه پس از آخرین تیکِ زوم)
  // انجام می‌شود و تصویرِ موجود، تا آن لحظه با ابعادِ جدیدِ
  // کادر، مقیاس می‌گیرد (چیدمانِ فوری، رسترایزِ دیبانس‌شده).
  // گیتِ نزدیکی هم از `isNearViewport`ی مرزی می‌آید، نه از
  // `distanceFromActive` که در هر قدمِ اسکرول عوض می‌شود.
  useEffect(() => {
    // مرحله ۲۰ — لایهٔ دیپ، دیگر URL نیست: یک drawable است که رویِ
    // بومِ دیپ می‌نشیند. خروج از نزدیکی، drawable را فوراً خالی
    // می‌کند تا بومِ دیپ پاک شود و تصویرِ پایه دیده شود؛ ورودِ
    // دوباره، از کشِ سرویس (اگر مانده) بی‌درنگ، وگرنه با رندرِ
    // تازه، برمی‌گردد.
    if (!pdfDoc || !isNearViewport) {
      if (hiDpiDrawable) setHiDpiDrawable(null);
      return;
    }

    const clipKey = clipRect
      ? `${Math.round(clipRect.x || 0)},${Math.round(clipRect.y || 0)},${Math.round(clipRect.width)},${Math.round(clipRect.height)}`
      : '';
    // مرحله ۲۰ — تغییرِ برش، drawableیِ کهنه را فوراً خالی می‌کند تا
    // تایلِ قدیمی، لحظه‌ای در باکسِ برشِ تازه دیده نشود؛ تا رسیدنِ
    // تایلِ تازه، لایهٔ پایه دیده می‌شود.
    const clipChanged = clipKey !== lastClipKeyRef.current;
    if (clipChanged && hiDpiDrawable) setHiDpiDrawable(null);

    const cachedDrawable = hiDpiRenderService.peekHiDpiPage(filePath, pageNumber, renderZoomLevel, clipRect);
    if (cachedDrawable) {
      if (cachedDrawable !== hiDpiDrawable) setHiDpiDrawable(cachedDrawable);
      lastClipKeyRef.current = clipKey;
      if (typeof onHiDpiSettled === 'function') onHiDpiSettled(pageNumber);
      return;
    }

    let isCancelled = false;
    // مرحله ۲۰ — تغییرِ برش (پس از توقفِ اسکرول در زومِ بالا) بدونِ
    // دیبانس رندر می‌شود، چون توقفِ ۱۲۰ میلی‌ثانیه‌ایِ والد از قبل،
    // ازدحام را مهار کرده است؛ بقیهٔ حالت‌ها همان ۱۷۰/۳۲۰ قبلی‌اند.
    const debounceMs = clipChanged ? 0 : (isActivePage ? 170 : 320);

    const timer = setTimeout(async () => {
      if (isCancelled) return;
      const drawable = await hiDpiRenderService.renderPdfPageHiDpi({
        pdfDoc,
        filePath,
        pageNumber,
        zoomLevel: renderZoomLevel,
        // مرحله ۱۹ — عرضِ نمایشیِ صفحه در DOM (pageWidth = عرضِ
        // کانتینر × زوم) تا سرویس، مقیاس را از رویِ پیکسلِ واقعیِ
        // نمایش حساب کند، نه فقط ضریبِ زوم.
        displayWidthPx: pageWidth,
        clipRect: clipRect || null,
      });
      if (isCancelled) return;
      if (drawable) {
        setHiDpiDrawable(drawable);
        lastClipKeyRef.current = clipKey;
      }
      // نشستِ وعده، چه موفق چه ناموفق: صفحه دیگر هدفِ معلق نیست.
      if (typeof onHiDpiSettled === 'function') onHiDpiSettled(pageNumber);
    }, debounceMs);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [pdfDoc, filePath, pageNumber, renderZoomLevel, hiDpiRenderTick, isNearViewport, isActivePage, onHiDpiSettled, pageWidth, clipRect, hiDpiDrawable]);

  // مرحله ۲۰ — بومِ دیپ رندر و نشاندنِ drawable رویِ آن: بوم، دقیقاً
  // به اندازهٔ drawable (پیکسلِ دستگاه) ساخته می‌شود و CSS آن را به
  // اندازهٔ باکسِ خودش (برش یا کلِ صفحه) می‌رساند؛ پس تراکم،
  // یک‌به‌یک حفظ می‌شود. هنگامِ تعلیقِ اسکرول یا نبودِ drawable،
  // بوم پاک می‌شود تا لایهٔ پایه دیده شود. توجه: drawable متعلق به
  // کشِ سرویس است و این‌جا هرگز close نمی‌شود؛ بستن، فقط هنگامِ
  // تخلیه از کش انجام می‌شود.
  const deepCanvasRef = useRef(null);
  const lastClipKeyRef = useRef('');
  useEffect(() => {
    const c = deepCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (!hiDpiDrawable || deepSuspended) {
      if (c.width > 0 && c.height > 0) ctx.clearRect(0, 0, c.width, c.height);
      return;
    }
    const dw = hiDpiDrawable.width || 0;
    const dh = hiDpiDrawable.height || 0;
    if (!dw || !dh) return;
    if (c.width !== dw || c.height !== dh) {
      c.width = dw;
      c.height = dh;
    }
    ctx.clearRect(0, 0, c.width, c.height);
    try {
      ctx.drawImage(hiDpiDrawable, 0, 0);
    } catch (_) {}
  }, [hiDpiDrawable, deepSuspended]);

  const handleFrameContextMenu = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const dataUrl = extractDataUrlFromImgElement(imgRef.current);
      // مرحله ۱۳: مختصاتِ عمودیِ کلیک نسبت به بالایِ همین صفحه
      // (نه کلِ سند) تا بوک‌مارک دقیقاً کنارِ همان سکانس بنشیند.
      let yRatio = 0;
      try {
        const rect = e.currentTarget ? e.currentTarget.getBoundingClientRect() : null;
        if (rect && rect.height > 0) {
          yRatio = clampYRatio((e.clientY - rect.top) / rect.height);
        }
      } catch (_) {}
      onContextMenu?.(e, pageNumber - 1, dataUrl, yRatio);
    },
    [onContextMenu, pageNumber]
  );

  // تصویر HiDPI در صورت آماده بودن بدون هیچ پرشی جایگزین تصویر پایه می‌شود
  // مرحله ۲۰ — activeSrc فقط لایهٔ پایه است؛ لایهٔ دیپ، دیگر از راهِ
  // <img> نمی‌گذرد و رویِ بومِ خودش می‌نشیند.
  const activeSrc = effectiveCachedBlobUrl || effectiveBlobUrl;

  // مرحله ۱۱ — تعویضِ بدونِ چشمکِ زوم (Zero-Flash Zoom Swap):
  // <img>، همیشه displayedSrc را نشان می‌دهد؛ وقتی activeSrc
  // عوض می‌شود (زوم یا پاسِ HiDPI)، تصویرِ قبلی تا لحظه‌ای که
  // Blobِ جدید کامل دیکد شود، روی صفحه می‌ماند و سپس، یک‌جا
  // جابه‌جا می‌شود. پس صفحه، هرگز چشمکِ سفید نمی‌زند. اولین
  // نمایش و خالی شدنِ منبع (تخلیهٔ کش)، بی‌درنگ انجام می‌شود.
  const [displayedSrc, setDisplayedSrc] = useState(null);
  const swapGenerationRef = useRef(0);
  useEffect(() => {
    const next = activeSrc || null;
    if (!next) {
      swapGenerationRef.current += 1;
      if (displayedSrc !== null) setDisplayedSrc(null);
      return;
    }
    if (next === displayedSrc) return;
    // مرحله ۱۷: displayedSrcِ خالی یا باطل‌شده، بدونِ هیچ تأخیرِ
    // decode، بی‌درنگ جایگزین می‌شود؛ decode فقط وقتی است که یک
    // تصویرِ سالمِ قبلی روی صفحه است و می‌خواهیم زومِ تازه را
    // جایِ آن بنشانیم (بدونِ چشمک).
    if (!displayedSrc || (revokedBlobUrls && revokedBlobUrls.has(displayedSrc))) {
      setDisplayedSrc(next);
      return;
    }
    const generation = (swapGenerationRef.current += 1);
    let settled = false;
    const finish = () => {
      if (settled || swapGenerationRef.current !== generation) return;
      settled = true;
      setDisplayedSrc(next);
    };
    const timerId = setTimeout(finish, 400);
    const probe = new Image();
    probe.onload = () => { clearTimeout(timerId); finish(); };
    probe.onerror = () => { clearTimeout(timerId); finish(); };
    probe.src = next;
    if (typeof probe.decode === 'function') {
      try {
        probe.decode().then(() => { clearTimeout(timerId); finish(); }).catch(() => { clearTimeout(timerId); finish(); });
      } catch (_) {}
    }
    return () => {
      settled = true;
      clearTimeout(timerId);
    };
  }, [activeSrc, displayedSrc]);

  // Stage 8 Part B (CRITICAL TDZ FIX): Part A declared handleImgError
  // ABOVE this const, so its useCallback dependency array evaluated
  // `activeSrc` before initialization and threw a ReferenceError on
  // every PdfPageItem render; ChunkErrorBoundary then swallowed the
  // whole reader with «بارگذاریِ بخشی از برنامه ناموفق بود» and no
  // PDF could open. activeSrc is now declared FIRST, and the handler
  // reads the failed URL from the <img> error event (activeSrc only
  // as a fallback), so it can never again depend on a later const.
  // A revoked/corrupt image URL recovers instead of leaving a blank
  // page: the dead entry is dropped (parent cache) and the page
  // re-renders. After 3 consecutive failures the retry UI takes over
  // instead of looping.
  const handleImgError = useCallback((e) => {
    const badSrc = (e && e.currentTarget && e.currentTarget.src) || activeSrc;
    if (!badSrc) return;
    imgErrorCountRef.current += 1;
    if (imgErrorCountRef.current >= 3) {
      setRenderFailed(true);
      return;
    }
    if (!erroredUrlsRef.current.has(badSrc)) {
      erroredUrlsRef.current.add(badSrc);
      if (erroredUrlsRef.current.size > 50) erroredUrlsRef.current.clear();
      // مرحله ۲۰ — خطایِ <img> فقط به لایهٔ پایه مربوط می‌شود؛ لایهٔ
      // دیپ، URL ندارد که باطل شود.
      if (onDropPageBlob) onDropPageBlob(pageNumber, badSrc);
      setBlobUrl(null);
    } else {
      setBlobUrl(null);
    }
    setRenderFailed(false);
  }, [activeSrc, onDropPageBlob, pageNumber]);

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
          (بیرونِ RENDER_RADIUS=۴ ولی داخلِ پنجرهٔ DOM_OVERSCAN=۵) و
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
        {displayedSrc ? (
          <img
            ref={imgRef}
            src={displayedSrc}
            onError={handleImgError}
            onLoad={() => {
              imgErrorCountRef.current = 0;
            }}
            alt={`صفحه ${pageNumber}`}
            loading="eager"
            decoding="async"
            draggable={false}
            style={{
              ...styles.pageImage,
              // مرحله ۶ ـ بخش الف: تمِ مطالعه فقط روی خودِ تصویرِ
              // صفحه اعمال می‌شود؛ لایهٔ حاشیه‌نویسی، خواهرِ این
              // عنصر است و فیلتر روی آن اثر نمی‌گذارد (نه رنگِ
              // ابزارها عوض می‌شود، نه مختصاتِ بوم).
              filter: pageFilter || 'none',
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

        {/* مرحله ۲۰ — بومِ دیپ رندر: بالایِ تصویرِ پایه، زیرِ هایلایت
            و لایهٔ حاشیه‌نویسی؛ pointerEvents none تا هیچ تعاملی را
            نگیرد. وقتی clipRect هست، بوم دقیقاً همان مستطیلِ
            قابل‌مشاهده است، وگرنه کلِ صفحه. */}
        <canvas
          ref={deepCanvasRef}
          className="deep-render-canvas"
          style={{
            position: 'absolute',
            left: clipRect ? `${clipRect.x}px` : '0px',
            top: clipRect ? `${clipRect.y}px` : '0px',
            width: clipRect ? `${clipRect.width}px` : '100%',
            height: clipRect ? `${clipRect.height}px` : '100%',
            pointerEvents: 'none',
            display: !deepSuspended && hiDpiDrawable ? 'block' : 'none',
          }}
        />

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
      {/* مرحله ۱۴: بوک‌مارک‌ها رویِ لبهٔ حاشیهٔ خودِ صفحه
          می‌نشینند (مطابقِ تصویرِ مرجعِ کاربر): ۱۴ پیکسل از لبه،
          با zIndex 45 که بالایِ لایهٔ غیرفعالِ حاشیه‌نویسی (۱۸)
          است ولی زیرِ حالتِ فعالِ ویرایش (۱۰۰) می‌ماند؛ بالایِ
          صفحه، top صفر است وگرنه ۱۲ پیکسل بالاتر از نقطه. */}
      {(pageBookmarks || []).map((bm) => (
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
            onOpen={onOpenBookmark}
            onDelete={onDeleteBookmark}
            onRename={onRenameBookmark}
            onMove={onMoveBookmark}
          />
        </div>
      ))}
    </div>
  );
}, arePdfPagePropsEqual);

// ============================================================================
// ۳. کامپوننت اصلی PdfViewer (مجهز به Dual-Pass HiDPI و Area Box Zoom)
// ============================================================================
export default function PdfViewer({ filePath }) {
  const zoomLevel = useReaderStore((state) => state.zoomLevel);
  const setZoomLevel = useReaderStore((state) => state.setZoomLevel);
  const setPdfOutline = useReaderStore((state) => state.setPdfOutline);
  // مرحله ۶ ـ بخش الف: تمِ مطالعه از تنظیماتِ سراسری خوانده می‌شود
  // (در QuickSettingsModal ذخیره می‌شود)؛ تغییرِ آن، فقط همین رشتهٔ
  // فیلتر را عوض می‌کند و هیچ محاسبهٔ هندسی‌ای را لمس نمی‌کند.
  const readingTheme = useSettingsStore((state) => state.preferences?.readingTheme || 'default');
  const readingBrightness = useSettingsStore((state) => state.preferences?.readingBrightness ?? 1);
  const readingWarmth = useSettingsStore((state) => state.preferences?.readingWarmth ?? 0);
  const pageFilter = useMemo(
    () => getReadingThemeFilter(readingTheme, readingBrightness, readingWarmth),
    [readingTheme, readingBrightness, readingWarmth]
  );
  const areaZoomTarget = useReaderStore((state) => state.areaZoomTarget);
  const clearAreaZoomTarget = useReaderStore((state) => state.clearAreaZoomTarget);
  const hiDpiRenderTick = useReaderStore((state) => state.hiDpiRenderTick);
  const triggerHiDpiRender = useReaderStore((state) => state.triggerHiDpiRender);
  const pdfPageGap = useReaderStore((state) => state.pdfPageGap ?? 12);
  const rotation = useReaderStore((state) => state.rotation);
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const setCurrentPage = useReaderStore((state) => state.setCurrentPage);
  const targetPage = useReaderStore((state) => state.targetPage);
  const clearTargetPage = useReaderStore((state) => state.clearTargetPage);
  const jumpToPage = useReaderStore((state) => state.jumpToPage);

  // مرحله ۱۳: بوک‌مارک‌هایِ دیجیتالِ فایلِ جاری.
  const pageBookmarkList = useBookmarkStore((state) => state.bookmarksByFile[normalizeBookKey(filePath)] || EMPTY_PAGE_BOOKMARKS);
  const loadBookmarksForFile = useBookmarkStore((state) => state.loadBookmarksForFile);
  const loadBookmarkPreferences = useBookmarkStore((state) => state.loadPreferences);
  const deleteBookmark = useBookmarkStore((state) => state.deleteBookmark);
  const updateBookmark = useBookmarkStore((state) => state.updateBookmark);
  const openBookmarkStudio = useBookmarkStore((state) => state.openStudio);
  const bookmarkJumpTarget = useBookmarkStore((state) => state.jumpTarget);
  const clearBookmarkJumpTarget = useBookmarkStore((state) => state.clearJumpTarget);
  const pendingBookmarkJumpRef = useRef(null);

  // مرحله ۱۷: بارگذاریِ بوک‌مارک‌ها و تنظیماتشان، ۴۰۰ میلی‌ثانیه
  // پس از باز شدنِ فایل انجام می‌شود تا لحظهٔ باز شدن، فقط صرفِ
  // صفحهٔ اول شود (بوتِ برنامه در App.jsx، تنظیمات را از قبل دارد).
  useEffect(() => {
    if (!filePath) return;
    const timerId = setTimeout(() => {
      loadBookmarksForFile(filePath);
      loadBookmarkPreferences();
    }, 400);
    return () => clearTimeout(timerId);
  }, [filePath, loadBookmarksForFile, loadBookmarkPreferences]);

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
    openBookmarkStudio({ filePath, page: bm.page, yRatio: bm.yRatio, bookmarkId: bm.id });
  }, [openBookmarkStudio, filePath]);

  const handleDeleteBookmark = useCallback((bm) => {
    if (!bm) return;
    deleteBookmark(filePath, bm.id);
  }, [deleteBookmark, filePath]);

  const handleRenameBookmark = useCallback((bm, newName) => {
    if (!bm) return;
    updateBookmark(filePath, bm.id, { name: newName });
  }, [updateBookmark, filePath]);

  // مرحله ۱۸ — ثبتِ مکانِ تازهٔ بوک‌مارک پس از پایانِ درگ (فقط یک
  // ذخیره در pointerup؛ در حینِ حرکت، هیچ IPCای صدا زده نمی‌شود).
  const handleMoveBookmark = useCallback((bm, patch) => {
    if (!bm || !patch) return;
    updateBookmark(filePath, bm.id, patch);
  }, [updateBookmark, filePath]);

  // پرشِ نقطه‌ای به بوک‌مارک: اول jumpToPage تا پنجرهٔ مجازی رویِ
  // صفحهٔ هدف بنشیند، بعد که targetPage پاک شد، اسکرولِ دقیق به
  // pageOffsetTop + pageHeight*yRatio با مختصاتِ واقعیِ DOM.
  // اسکرولِ دقیق، آنی (auto) است تا با اسکرولِ نرمِ پرشِ صفحه،
  // حرکتِ دوتایی و لرزش نسازد.
  useEffect(() => {
    if (!bookmarkJumpTarget || bookmarkJumpTarget.filePath !== filePath) return;
    pendingBookmarkJumpRef.current = bookmarkJumpTarget;
    jumpToPage(bookmarkJumpTarget.page);
    clearBookmarkJumpTarget();
  }, [bookmarkJumpTarget, filePath, jumpToPage, clearBookmarkJumpTarget]);

  useEffect(() => {
    const pending = pendingBookmarkJumpRef.current;
    if (!pending || targetPage !== null) return;
    const container = containerRef.current;
    const el = document.getElementById(`comic-page-${pending.page}`);
    const scrollToBookmarkPoint = (targetEl, targetContainer) => {
      const cRect = targetContainer.getBoundingClientRect();
      const eRect = targetEl.getBoundingClientRect();
      const padTop = parseFloat(window.getComputedStyle(targetContainer).paddingTop) || 0;
      targetContainer.scrollTo({
        top: targetContainer.scrollTop + (eRect.top - cRect.top) - padTop + eRect.height * pending.yRatio,
        behavior: 'auto',
      });
    };
    if (!container || !el) {
      const timer = setTimeout(() => {
        const retryEl = document.getElementById(`comic-page-${pending.page}`);
        const retryContainer = containerRef.current;
        if (retryEl && retryContainer) scrollToBookmarkPoint(retryEl, retryContainer);
        pendingBookmarkJumpRef.current = null;
      }, 350);
      return () => clearTimeout(timer);
    }
    scrollToBookmarkPoint(el, container);
    pendingBookmarkJumpRef.current = null;
  }, [targetPage]);

  const isSnippingActive = useAppStore((state) => state.isSnippingActive);
  const isAreaZoomActive = useAppStore((state) => Boolean(state.isAreaZoomActive));
  const isAnnotationActive = useAppStore((state) => Boolean(state.isAnnotationActive));
  const showToast = useAppStore((state) => state.showToast);
  const updateReadingProgress = useLibraryStore((state) => state.updateReadingProgress);
  const { handleContextMenu } = useContextMenu();

  const [numPages, setNumPages] = useState(0);
  const numPagesRef = useRef(numPages);
  numPagesRef.current = numPages;
  const [pdfDoc, setPdfDoc] = useState(null);
  // مرحله ۵ ـ بخش الف: وضعیتِ «در حالِ ساختِ خروجیِ PDF» برای غیرفعال
  // کردنِ دکمهٔ خروجیِ تولبار در طولِ پردازش.
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  // مرحله ۷ ـ نهایی: وضعیتِ نمایانِ ذخیرهٔ PDF — بنرِ شناورِ وضعیت + حالتِ دکمه‌های تولبار.
  const [pdfSaveState, setPdfSaveState] = useState('idle');
  const [pdfSaveMessage, setPdfSaveMessage] = useState('');
  const saveStateTimerRef = useRef(null);
  const showSaveStatus = useCallback((state, message, ms) => {
    if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current);
    setPdfSaveState(state);
    setPdfSaveMessage(message || '');
    if (ms > 0) {
      saveStateTimerRef.current = setTimeout(() => {
        setPdfSaveState('idle');
        setPdfSaveMessage('');
        saveStateTimerRef.current = null;
      }, ms);
    }
  }, []);
  useEffect(() => () => {
    if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current);
  }, []);
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
  // مرحله ۱۸ — نگهبانِ قفلِ اسکرولِ باز شدن/پرش + علامتِ اسکرولِ برنامه‌ای:
  // resumeTimerRef، تایمرِ همگام‌سازیِ نهاییِ باز شدن است که عمداً به
  // cleanupِ افکتِ ازسرگیری وصل نیست (وگرنه هر بازمحاسبهٔ آفست، آن را
  // می‌کشت و قفل برایِ همیشه می‌ماند — همان باگِ گزارش‌شده)؛ فقط در
  // شروعِ باز شدنِ فایلِ تازه پاک می‌شود. lockWatchdogRef، سقفِ
  // ۲۵۰ میلی‌ثانیه‌ایِ قفل‌هاست. programmaticScrollAtRef، زمانِ آخرین
  // اسکرولِ برنامه‌ای (باز شدن، پرش، زومِ ناحیه‌ای) را نگه می‌دارد تا
  // هندلرِ اسکرول، اسکرولِ دستیِ کاربر را از آن تشخیص بدهد.
  const resumeTimerRef = useRef(null);
  const lockWatchdogRef = useRef(null);
  const programmaticScrollAtRef = useRef(0);
  const markProgrammaticScroll = () => {
    programmaticScrollAtRef.current = Date.now();
  };
  const releaseScrollLocks = () => {
    isResumingRef.current = false;
    isJumpingRef.current = false;
  };
  const armScrollLockWatchdog = () => {
    if (lockWatchdogRef.current) clearTimeout(lockWatchdogRef.current);
    lockWatchdogRef.current = setTimeout(() => {
      lockWatchdogRef.current = null;
      isResumingRef.current = false;
      isJumpingRef.current = false;
      // اگر همگام‌سازیِ اولیه هرگز کامل نشد، دنبال‌کردنِ اسکرولِ واقعیِ
      // کاربر از قفلِ ابدی مهم‌تر است: hasResumed هم آزاد می‌شود تا
      // صفحهٔ فعال، از رویِ scrollTopِ واقعی محاسبه شود.
      hasResumedRef.current = true;
    }, 250);
  };
  const abortControllerRef = useRef(null);
  const customRatiosRef = useRef(new Map());
  const pageBlobCacheRef = useRef(new Map());
  // فاز ۳: صفحه‌های در دید، برای تخلیهٔ هوشمندِ کش (مراجعهٔ زیر).
  const visiblePageNumbersRef = useRef([]);
  // Stage 8 Part A: URLs whose object URL was revoked while a page
  // item still holds it (eviction race). The set is append-only and
  // capped; a revoked URL is never trusted again as a cached image.
  const revokedBlobUrlsRef = useRef(new Set());
  // مرحله ۱۷: شمارندهٔ باطل‌شدنِ Blobها — هر تخلیه، آن را عوض
  // می‌کند تا افکتِ رندرِ پایهٔ صفحه‌ها، باطل‌شدن را ببیند (Set
  // خودش، با جهشِ درجا، هیچ propای را عوض نمی‌کند).
  const [revokedTick, setRevokedTick] = useState(0);
  const prevZoomRef = useRef(zoomLevel);
  const scrollIdleTimerRef = useRef(null);
  const activePageRef = useRef(1);
  activePageRef.current = activePage;
  // مرحله ۱۱: ایندکسِ جستجویِ کناریِ فایلِ بازسازی‌شده (در صورتِ
  // وجود)، برای جستجو روی صفحه‌هایِ رستریِ بدونِ لایهٔ متن.
  const searchIndexRef = useRef(null);

  // مرحله ۴ — جستجوی درون‌متنی PDF (غیرمسدودکننده):
  // pdfDocRef آینهٔ همان سندِ state است (سندِ دومی باز نمی‌شود)؛
  // pageTextCacheRef فقط متن + مستطیل‌های درصدی را نگه می‌دارد (نه تصویر)،
  // پس با کشِ Blobِ صفحات (pageBlobCacheRef) هیچ تماسی ندارد.
  const pdfDocRef = useRef(null);
  const outlineRunRef = useRef(0);
  pdfDocRef.current = pdfDoc;
  const rebuildCopyInFlightRef = useRef(false);
  // مرحله ۵ ـ بخش الف: آینهٔ annotationsByPage برای هندلرِ خروجیِ PDF تا
  // تازه‌ترین کامیت‌ها (نه closureی قدیمی) خوانده شوند.
  const annotationsByPageRef = useRef({});
  annotationsByPageRef.current = annotationsByPage;
  const pageTextCacheRef = useRef(new Map());
  const searchRunIdRef = useRef(0);
  const searchInputRef = useRef(null);
  const searchDebounceRef = useRef(null);
  // مرحله ۴ ـ بخش ب: باز بودنِ نوارِ جستجو در استورِ ریدر زندگی
  // می‌کند تا شنوندهٔ سراسریِ Escape در useKeyboard هم آن را ببیند و
  // Escape، پیش از بستنِ کمیک، اول نوار را ببندد. بقیهٔ منطقِ جستجو
  // (closeSearch و همهٔ call siteها) با همین نام‌ها دست‌نخورده ماند.
  const searchOpen = useReaderStore((state) => Boolean(state.pdfSearchOpen));
  const setSearchOpen = useReaderStore((state) => state.setPdfSearchOpen);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  // مرحله ۹: رمزِ عبورِ فایل‌های محافظت‌شده (لایهٔ ۳) و بارگذاریِ
  // دوباره با مسیرِ آماده‌شده (لایهٔ ۱). رمز، فقط در حافظهٔ نشست
  // است و هرگز روی دیسک یا در استور ذخیره نمی‌شود.
  const [passwordModal, setPasswordModal] = useState(null);
  const [passwordValue, setPasswordValue] = useState('');
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [loadNonce, setLoadNonce] = useState(0);
  const loadOverrideRef = useRef(null);
  const passwordAttemptRef = useRef('');
  const passwordFlowRef = useRef(null);
  const prepareInFlightRef = useRef(false);
  const pdfSearchQueryFromStore = useReaderStore((state) => state.pdfSearchQuery || '');
  const pdfSearchRequestId = useReaderStore((state) => state.pdfSearchRequestId || 0);
  const [searchCurrentKey, setSearchCurrentKey] = useState(null);
  const [searchScanning, setSearchScanning] = useState(false);
  const [searchScannedCount, setSearchScannedCount] = useState(0);

  const safeZoom = Math.min(3.5, Math.max(0.4, Number(zoomLevel) || 1));
  const safeZoomRef = useRef(safeZoom);
  safeZoomRef.current = safeZoom;
  const safePageGap = Math.max(0, Math.min(48, Math.round(Number(pdfPageGap) ?? 12)));

  // مرحله ۱۲: زومِ «تثبیت‌شده» برای رسترایزِ سنگین — در حینِ
  // زومِ پیوسته (ترک‌پد/اسلایدر)، فقط چیدمان (ارتفاع‌ها/عرض‌ها)
  // با زومِ زنده به‌روز می‌شود و تصویرِ موجود، مقیاس می‌گیرد؛
  // رندرِ مجددِ pdf.js، فقط ۱۵۰ میلی‌ثانیه پس از آخرین تیکِ
  // زوم انجام می‌شود. `rasterZoomRef`، جلوی ست‌شدنِ دوبارهٔ
  // همان مقدار را می‌گیرد تا حلقهٔ effect/state نسازد. تیکِ
  // `hiDpiRenderTick` در استور (مرحله ۶-ب) دست‌نخورده می‌ماند:
  // همان ماشهٔ «توقفِ اسکرول» برای شارپ شدنِ صفحه‌هاست.
  const [rasterZoomLevel, setRasterZoomLevel] = useState(safeZoom);
  const rasterZoomRef = useRef(safeZoom);

  // مرحله ۲۰ — برش‌هایِ دیپ رندر و تعلیقِ هنگامِ حرکت.
  const [deepClipRects, setDeepClipRects] = useState({});
  const deepClipRectsRef = useRef({});
  const [deepSuspended, setDeepSuspended] = useState(false);
  const deepSuspendedRef = useRef(false);
  const deepStopTimerRef = useRef(null);
  useEffect(() => {
    if (rasterZoomRef.current === safeZoom) return;
    const timer = setTimeout(() => {
      rasterZoomRef.current = safeZoom;
      setRasterZoomLevel(safeZoom);
    }, 150);
    return () => clearTimeout(timer);
  }, [safeZoom]);

  // مرحله ۱۶ — HUDِ ری‌رندر، فقط هنگامِ تغییرِ زوم (نه اسکرول و
  // نه باز شدنِ کتاب): نشست، با تغییرِ زومِ تثبیت‌شده شروع
  // می‌شود؛ هدف‌ها دقیقاً همان صفحه‌هایی‌اند که پاسِ HiDPI
  // برایشان شروع می‌شود (نزدیکِ صفحهٔ فعال + گیتِ needsHiDpi)؛
  // تکمیل، با نشستِ وعدهٔ HiDPI (کش، موفقیت یا شکست) علامت
  // می‌خورد؛ و تایمرِ محافظِ ۱۲۰۰ میلی‌ثانیه، هرگز اجازهٔ گیر
  // کردن رویِ هیچ عددی را نمی‌دهد.
  const zoomHudSessionRef = useRef(null);
  const zoomHudSafetyRef = useRef(null);
  const zoomHudGreenRef = useRef(null);
  const prevSettledZoomRef = useRef(null);
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

  const handleHiDpiSettled = useCallback((pageNumber) => {
    const session = zoomHudSessionRef.current;
    if (!session || typeof pageNumber !== 'number') return;
    if (!session.targets.has(pageNumber)) return;
    session.done.add(pageNumber);
    setZoomHud((prev) => ({ ...prev, done: session.done.size }));
    if (session.done.size >= session.targets.size) completeZoomHud();
  }, [completeZoomHud]);

  useEffect(() => {
    if (!filePath) return undefined;
    const prev = prevSettledZoomRef.current;
    if (prev && prev.file === filePath && prev.zoom === rasterZoomLevel) return undefined;
    const changedFile = !prev || prev.file !== filePath;
    prevSettledZoomRef.current = { file: filePath, zoom: rasterZoomLevel };
    if (changedFile) {
      if (zoomHudSafetyRef.current) clearTimeout(zoomHudSafetyRef.current);
      if (zoomHudGreenRef.current) clearTimeout(zoomHudGreenRef.current);
      zoomHudSessionRef.current = null;
      setZoomHud({ visible: false, done: 0, total: 0, isDone: false });
      return undefined;
    }
    // تغییرِ واقعیِ زوم در همان فایل: نشستِ تازه. صفحه‌هایِ هدف،
    // همان‌هایی‌اند که افکتِ HiDPI برایشان اجرا می‌شود.
    // مرحله ۱۹: هدف‌هایِ HUD، همان صفحه‌هایِ نزدیک‌اند — بدونِ گیتِ
    // needsHiDpi، چون پاسِ HiDPI حالا در تمامِ سطوحِ زوم اجرا می‌شود.
    const active = activePageRef.current || 1;
    const targets = new Set(
      (visiblePageNumbers || []).filter(
        (p) => Math.abs(p - active) <= 1
      )
    );
    if (targets.size === 0) return undefined;
    if (zoomHudSafetyRef.current) clearTimeout(zoomHudSafetyRef.current);
    if (zoomHudGreenRef.current) clearTimeout(zoomHudGreenRef.current);
    zoomHudSessionRef.current = { targets, done: new Set() };
    setZoomHud({ visible: true, done: 0, total: targets.size, isDone: false });
    zoomHudSafetyRef.current = setTimeout(() => { completeZoomHud(); }, 1200);
    return () => {
      if (zoomHudSafetyRef.current) clearTimeout(zoomHudSafetyRef.current);
    };
  }, [filePath, rasterZoomLevel, completeZoomHud]);

  // مرحله ۱۵ — درگِ چهارجهته با ماوس (دکمهٔ چپ در مطالعهٔ عادی،
  // دکمهٔ وسط در هر حالتی؛ جزئیاتِ کامل در useDragPan).
  const { handlePanMouseDown, isPanning } = useDragPan({
    containerRef,
    isAnnotationActive,
    isAreaZoomActive,
  });

  const clearAllCachedPageBlobs = useCallback(() => {
    for (const [, url] of pageBlobCacheRef.current.entries()) {
      if (url) {
        revokedBlobUrlsRef.current.add(url);
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
    // تا سقف، همیشه برقرار بماند. مرحله ۱۷: سقف ۳۰ صفحه و حاشیهٔ
    // امن ۱۰ صفحه است تا بازگشت به بالا، بی‌درنگ از کش خوانده شود.
    // Stage 8 Part B: eviction keeps a margin around the active page
    // (activePage +/- 10, stage 17) because
    // visiblePageNumbersRef updates only
    // during render and can lag behind a fast scroll; evicting a page
    // the user is flying toward produced permanently blank pages.
    while (cache.size >= MAX_CACHED_BLOBS) {
      const visible = visiblePageNumbersRef.current || [];
      const guarded = new Set(visible);
      const center = activePageRef.current || 1;
      for (let pn = center - 10; pn <= center + 10; pn++) guarded.add(pn);
      let evictKey = null;
      for (const key of cache.keys()) {
        if (!guarded.has(key)) { evictKey = key; break; }
      }
      if (evictKey == null) evictKey = cache.keys().next().value;
      const evictUrl = cache.get(evictKey);
      if (evictUrl) {
        revokedBlobUrlsRef.current.add(evictUrl);
        setRevokedTick((tick) => tick + 1);
        try {
          URL.revokeObjectURL(evictUrl);
        } catch (_) {}
      }
      cache.delete(evictKey);
    }

    cache.set(pageNum, blobUrl);
  }, []);

  // Stage 8 Part A: a page item reports that its <img> failed on a
  // revoked URL. The entry is dropped from the cache and the URL is
  // registered as revoked, so the item re-renders from scratch instead
  // of trusting the dead URL forever (the previous blank-page stall).
  const handleDropPageBlob = useCallback((pageNum, blobUrl) => {
    if (!pageNum || !blobUrl) return;
    revokedBlobUrlsRef.current.add(blobUrl);
    setRevokedTick((tick) => tick + 1);
    if (revokedBlobUrlsRef.current.size > 500) revokedBlobUrlsRef.current.clear();
    const cache = pageBlobCacheRef.current;
    if (cache.get(pageNum) === blobUrl) cache.delete(pageNum);
    try {
      URL.revokeObjectURL(blobUrl);
    } catch (_) {}
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

  // مرحله ۱۰: ذخیرهٔ «بازسازی‌شده» — مسیرِ آخر برای فایل‌هایی که
  // pdf-lib نمی‌تواند رمزگشایی کند (AES-256/ObjStm) ولی pdf.js
  // آن‌ها را باز کرده است. overlayها با قابِ طبیعی (cssRotation: 0)
  // ساخته می‌شوند تا با viewportِ طبیعیِ بازسازی هم‌تراز شوند؛
  // مسیرِ معمولیِ ذخیره، دست نمی‌خورد.
  const handleRebuildSave = useCallback(async (saveMode, pagesMap) => {
    const doc = pdfDocRef.current;
    if (!doc) {
      showSaveStatus('error', 'سندِ PDF هنوز کامل بارگذاری نشده است.', 6000);
      showToast('سندِ PDF هنوز کامل بارگذاری نشده است.', { type: 'warning' });
      return;
    }
    const itemsMap = pagesMap || {};
    const annotatedCount = Object.values(itemsMap).reduce(
      (n, items) => n + (Array.isArray(items) ? items.length : 0),
      0
    );
    setIsExportingPdf(true);
    showSaveStatus(saveMode === 'in-place' ? 'saving-inplace' : 'saving-as', 'در حالِ بازسازیِ صفحاتِ بدونِ قفل…', 0);
    showToast('ذخیرهٔ معمولی ممکن نیست؛ نسخهٔ تمیزِ بدونِ قفل بازسازی می‌شود…', { type: 'info' });
    try {
      const prepared = annotatedCount > 0
        ? await prepareAnnotatedPdfExport({
            annotationsByPage: itemsMap,
            getPageViewport: async (pageNum) => {
              const pg = await doc.getPage(pageNum);
              const vp = pg.getViewport({ scale: 1 });
              return {
                width: vp.width,
                height: vp.height,
                transform: vp.transform,
                rotate: pg.rotate,
                view: pg.view,
              };
            },
            cssRotation: 0,
          })
        : { pages: {}, totalItems: 0, annotatedPages: 0 };
      if (annotatedCount > 0 && prepared.annotatedPages === 0) {
        showSaveStatus('info', 'آیتمِ قابلِ خروجی پیدا نشد.', 4500);
        showToast('آیتمِ قابلِ خروجی پیدا نشد.', { type: 'info' });
        return;
      }
      const rebuilt = await rebuildEditablePdfFromPdfJs({
        pdfDoc: doc,
        preparedPages: prepared.pages,
        onProgress: (pageNum, totalPages) => {
          showSaveStatus(saveMode === 'in-place' ? 'saving-inplace' : 'saving-as', `در حالِ بازسازیِ صفحهٔ ${pageNum} از ${totalPages}…`, 0);
        },
      });
      const base64 = rebuildPdfBytesToBase64(rebuilt.bytes);
      const result = await coreApi.saveRebuiltPdf({
        pdfPath: filePath,
        base64,
        mode: saveMode,
        expectedPageCount: rebuilt.pageCount,
        // مرحله ۱۱: ایندکسِ جستجویِ کناری، کنارِ فایلِ خروجی
        // ذخیره می‌شود تا Ctrl+F روی فایلِ رستری هم کار کند.
        searchIndex: rebuilt.searchIndex || undefined,
      });
      if (result && result.canceled) {
        showSaveStatus('info', 'ذخیرهٔ فایل لغو شد.', 4500);
        showToast('ذخیرهٔ فایل لغو شد.', { type: 'info' });
        return;
      }
      if (result && result.success) {
        const savedName = String((result && result.outputPath) || filePath || '').split(/[\\/]/).pop() || '';
        const savedTime = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const savedSuffix = savedName ? ' (' + savedName + '، ' + savedTime + ')' : '';
        if (saveMode === 'in-place') {
          showSaveStatus('saved-inplace', '✓ فایلِ بازسازی‌شدهٔ بدونِ قفل روی همین فایل ذخیره شد!' + savedSuffix, 4500);
          showToast(`نسخهٔ تمیزِ بدونِ قفل روی همین فایل ذخیره شد: ${prepared.totalItems} حاشیه‌نویسی در ${prepared.annotatedPages} صفحه.`, { type: 'success' });
        } else {
          showSaveStatus('saved-as', '✓ فایلِ PDFِ بازسازی‌شدهٔ بدونِ قفل ذخیره شد!' + savedSuffix, 4500);
          showToast(`فایلِ PDFِ بازسازی‌شده با ${prepared.totalItems} حاشیه‌نویسی در ${prepared.annotatedPages} صفحه ذخیره شد.`, { type: 'success' });
        }
      } else if (result && result.locked) {
        showSaveStatus('error', 'فایل در برنامهٔ دیگری باز است؛ آن را ببندید و دوباره ذخیره کنید. فایلِ اصلی دست نخورده باقی ماند.', 6000);
        showToast('فایل در برنامهٔ دیگری باز است؛ آن را ببندید و دوباره ذخیره کنید. فایلِ اصلی دست نخورده باقی ماند.', { type: 'error' });
      } else {
        showSaveStatus('error', (result && result.error) || 'ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.', 6000);
        showToast((result && result.error) || 'ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      showSaveStatus('error', 'خطا در بازسازیِ فایل: ' + (err && err.message ? err.message : String(err)), 6000);
      showToast('خطا در بازسازیِ فایل: ' + (err && err.message ? err.message : String(err)), { type: 'error' });
    } finally {
      setIsExportingPdf(false);
    }
  }, [filePath, showToast, showSaveStatus]);

  // مرحله ۱۰: شنوندهٔ «ساختِ نسخهٔ کپیِ قابل‌ویرایش با بازسازی» که
  // TopBar، وقتی پروب گفت pdf-lib نمی‌تواند فایل را رمزگشایی کند،
  // می‌فرستد. کپی، پایهٔ تمیز است و حاشیه‌نویسی‌ای رویش پخته
  // نمی‌شود (آیتم‌ها در دیتابیس، زیرِ مسیرِ اصلی می‌مانند — همان
  // قراردادِ کپیِ مرحلهٔ ۸). پس از ساخت، رویدادِ
  // app:editable-copy-ready به TopBar می‌گوید تا جابه‌جایی و فعال‌سازیِ
  // استودیو را انجام دهد.
  useEffect(() => {
    const onRebuildCopy = async (e) => {
      const detail = e && e.detail ? e.detail : {};
      if (!detail.filePath || detail.filePath !== filePath) return;
      if (rebuildCopyInFlightRef.current) return;
      const doc = pdfDocRef.current;
      if (!doc) {
        showToast('سندِ PDF هنوز کامل بارگذاری نشده است.', { type: 'warning' });
        return;
      }
      rebuildCopyInFlightRef.current = true;
      showSaveStatus('saving-as', 'در حالِ ساختِ نسخهٔ قابل‌ویرایشِ بدونِ قفل…', 0);
      try {
        const rebuilt = await rebuildEditablePdfFromPdfJs({
          pdfDoc: doc,
          preparedPages: {},
          onProgress: (pageNum, totalPages) => {
            showSaveStatus('saving-as', `در حالِ بازسازیِ صفحهٔ ${pageNum} از ${totalPages}…`, 0);
          },
        });
        const base64 = rebuildPdfBytesToBase64(rebuilt.bytes);
        const result = await coreApi.saveRebuiltPdf({
          pdfPath: filePath,
          base64,
          mode: 'copy',
          expectedPageCount: rebuilt.pageCount,
          // مرحله ۱۱: نام/مسیرِ دلخواهِ کاربر از مودالِ محافظت.
          desiredName: detail.desiredName || undefined,
          desiredPath: detail.desiredPath || undefined,
          searchIndex: rebuilt.searchIndex || undefined,
        });
        if (result && result.success) {
          showSaveStatus('saved-as', 'نسخهٔ قابل‌ویرایش ساخته شد؛ در حالِ باز کردنِ آن…', 4500);
          window.dispatchEvent(new CustomEvent('app:editable-copy-ready', {
            detail: { copyPath: result.outputPath, preservedPage: detail.preservedPage || 1, pageCount: rebuilt.pageCount },
          }));
        } else if (result && result.canceled) {
          showSaveStatus('info', 'ساختِ نسخهٔ کپی لغو شد.', 4500);
        } else {
          showSaveStatus('error', (result && result.error) || 'ساختِ نسخهٔ کپی انجام نشد.', 6000);
          showToast((result && result.error) || 'ساختِ نسخهٔ کپی انجام نشد.', { type: 'error' });
        }
      } catch (err) {
        showSaveStatus('error', 'خطا در بازسازیِ فایل: ' + (err && err.message ? err.message : String(err)), 6000);
        showToast('خطا در بازسازیِ فایل: ' + (err && err.message ? err.message : String(err)), { type: 'error' });
      } finally {
        rebuildCopyInFlightRef.current = false;
      }
    };
    window.addEventListener('app:rebuild-editable-copy', onRebuildCopy);
    return () => window.removeEventListener('app:rebuild-editable-copy', onRebuildCopy);
  }, [filePath, showToast, showSaveStatus]);

  // مرحله ۵ ـ بخش الف: خروجیِ PDFِ حاشیه‌نویسی‌شده.
  //  • فقط حاشیه‌نویسی‌های «ثبت‌شده» (کامیت‌شده) صادر می‌شوند؛ طرحِ
  //    نیمه‌کارهٔ در حالِ ترسیم، هنوز در دیتابیس/استیت نیست.
  //  • هندسه و رندرِ overlay روی «همان سندِ» pdfDocRef انجام می‌شود
  //    (سندِ دومی باز نمی‌شود) و کشِ Blobِ صفحات دست نمی‌خورد.
  //  • پیام‌ها از سیستمِ Toast برنامه می‌آیند؛ درصدِ ساختگی نشان داده
  //    نمی‌شود، فقط دو فازِ «آماده‌سازی» و «نوشتن» گزارش می‌شود.
  // مرحله ۵ ـ بخش ب: handleExportAnnotatedPdf حالا mode می‌گیرد
  // ('in-place' | 'save-as') و تولبار، همان تابع را با همان mode
  // صدا می‌زند؛ mountِ تولبار عوض نشده است.
  const handleExportAnnotatedPdf = useCallback(async (mode = 'save-as') => {
    if (isExportingPdf) return;
    if (!coreApi.isAvailable()) {
      // مرحله ۷ ـ نهاییِ دوم: حتی در این شاخهٔ برگشتِ زودهنگام هم
      // بنر، بلافاصله در همان میلی‌ثانیهٔ کلیک دیده می‌شود.
      showSaveStatus('error', 'خروجیِ PDF فقط در نسخهٔ دسکتاپ (Electron) در دسترس است.', 6000);
      showToast('خروجیِ PDF فقط در نسخهٔ دسکتاپ (Electron) در دسترس است.', { type: 'warning' });
      return;
    }
    const saveMode = mode === 'in-place' ? 'in-place' : 'save-as';
    const pages = annotationsByPageRef.current || {};
    const annotatedCount = Object.values(pages).reduce(
      (n, items) => n + (Array.isArray(items) ? items.length : 0),
      0
    );
    // صفر آیتم، فقط در حالتِ درجا معنا دارد: برگرداندنِ فایل به
    // پایهٔ تمیز. در Save As، مثلِ قبل فقط پیام داده می‌شود.
    if (annotatedCount === 0 && saveMode !== 'in-place') {
      // مرحله ۷ ـ نهاییِ دوم: کلیکِ ذخیره بدونِ حاشیه‌نویسی، دیگر
      // «هیچ اتفاقی» نیست — بنرِ خنثی (info) پیام می‌دهد و دکمه‌ها
      // را عوض نمی‌کند.
      showSaveStatus('info', 'هنوز حاشیه‌نویسی‌ای روی این فایل نیست.', 4500);
      showToast('هنوز حاشیه‌نویسی‌ای روی این فایل نیست.', { type: 'info' });
      return;
    }
    const doc = pdfDocRef.current;
    if (!doc) {
      showSaveStatus('error', 'سندِ PDF هنوز کامل بارگذاری نشده است.', 6000);
      showToast('سندِ PDF هنوز کامل بارگذاری نشده است.', { type: 'warning' });
      return;
    }
    setIsExportingPdf(true);
    showSaveStatus(saveMode === 'in-place' ? 'saving-inplace' : 'saving-as', saveMode === 'in-place' ? 'در حال ذخیرهٔ حاشیه‌نویسی‌ها روی فایل PDF…' : 'در حال نوشتنِ فایلِ PDF…', 0);
    showToast('در حال آماده‌سازیِ خروجیِ PDF…', { type: 'info' });
    try {
      const prepared = annotatedCount > 0
        ? await prepareAnnotatedPdfExport({
            annotationsByPage: pages,
            getPageViewport: async (pageNum) => {
              const pg = await doc.getPage(pageNum);
              const vp = pg.getViewport({ scale: 1 });
              return {
                width: vp.width,
                height: vp.height,
                transform: vp.transform,
                rotate: pg.rotate,
                view: pg.view,
              };
            },
            cssRotation: rotation,
          })
        : { pages: {}, totalItems: 0, annotatedPages: 0 };
      if (annotatedCount > 0 && prepared.annotatedPages === 0) {
        showSaveStatus('info', 'آیتمِ قابلِ خروجی پیدا نشد.', 4500);
        showToast('آیتمِ قابلِ خروجی پیدا نشد.', { type: 'info' });
        return;
      }
      showToast(saveMode === 'in-place' ? 'در حال ذخیره روی همین فایل…' : 'در حال نوشتنِ فایلِ PDF…', { type: 'info' });
      const result = await coreApi.exportAnnotatedPdf({
        pdfPath: filePath,
        pages: prepared.pages,
        mode: saveMode,
        // مرحله ۹: رمزِ نشستِ همین فایل، تا ذخیره روی فایلِ
        // محافظت‌شده هم با «رمزگشایی-اول» انجام شود.
        password: getPdfSessionPassword(filePath) || '',
      });
      if (result && result.canceled) {
        showSaveStatus('info', 'ذخیرهٔ فایل لغو شد.', 4500);
        showToast('ذخیرهٔ فایل لغو شد.', { type: 'info' });
        return;
      }
      if (result && result.success) {
        // مرحله ۷ ـ نهاییِ دوم: پیامِ موفقیت، نامِ فایلِ ذخیره‌شده
        // و زمانِ ذخیره را هم دارد تا کاربر ۱۰۰٪ مطمئن شود فایلِ
        // واقعی روی دیسک آپدیت شده است؛ اگر مسیرِ افزایشی
        // (incremental) استفاده شد، همان‌جا نوشته می‌شود.
        const savedName = String((result && result.outputPath) || filePath || '').split(/[\\/]/).pop() || '';
        const savedTime = new Date().toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const savedSuffix = savedName ? ' (' + savedName + '، ' + savedTime + (result.incremental ? '، ذخیرهٔ افزایشی' : '') + ')' : '';
        if (result.restoredClean) {
          showSaveStatus('saved-inplace', 'فایل به نسخهٔ تمیزِ بدونِ حاشیه‌نویسی برگردانده شد.' + savedSuffix, 4500);
          showToast('فایل به نسخهٔ تمیزِ بدونِ حاشیه‌نویسی برگردانده شد.', { type: 'success' });
        } else if (saveMode === 'in-place') {
          showSaveStatus('saved-inplace', '✓ تغییرات با موفقیت روی همین فایل PDF ذخیره شد!' + savedSuffix, 4500);
          showToast(
            `روی همین فایل ذخیره شد: ${prepared.totalItems} حاشیه‌نویسی در ${prepared.annotatedPages} صفحه.`,
            { type: 'success' }
          );
        } else {
          showSaveStatus('saved-as', '✓ فایل PDF جدید با موفقیت ذخیره شد!' + savedSuffix, 4500);
          showToast(
            `فایلِ PDF با ${prepared.totalItems} حاشیه‌نویسی در ${prepared.annotatedPages} صفحه ذخیره شد.`,
            { type: 'success' }
          );
        }
      } else if (result && result.locked) {
        // هات‌فیکسِ مرحله ۶: پیامِ دقیقِ قفل، به‌جای خطای عمومی.
        showSaveStatus('error', 'فایل در برنامهٔ دیگری باز است؛ آن را ببندید و دوباره ذخیره کنید. فایلِ اصلی دست نخورده باقی ماند.', 6000);
        showToast('فایل در برنامهٔ دیگری باز است؛ آن را ببندید و دوباره ذخیره کنید. فایلِ اصلی دست نخورده باقی ماند.', { type: 'error' });
      } else if (result && result.rebuildNeeded) {
        // مرحله ۱۰: ذخیرهٔ معمولی رد شد چون pdf-lib نمی‌تواند فایل
        // را رمزگشایی کند (AES-256/ObjStm) — ولی سند همین حالا در
        // pdf.js باز است؛ از صفحاتِ بازشده، نسخهٔ تمیزِ بدونِ قفل
        // بازسازی و با همان mode ذخیره می‌شود.
        await handleRebuildSave(saveMode, pages);
        return;
      } else if (result && (result.errorCode === 'PDF_COPY_PASSWORD_REQUIRED' || result.errorCode === 'PDF_COPY_UNSUPPORTED_ENCRYPTION')) {
        // مرحله ۱۱: فایل، همین حالا در pdf.js باز است ولی ذخیرهٔ
        // معمولی، رمز می‌خواهد یا رمزگذاری‌اش پشتیبانی نمی‌شود.
        // به‌جای بنرِ قرمزِ بن‌بستِ «بدونِ رمزِ عبور، قابلِ
        // ذخیره‌سازی نیست»، مودالِ ساختِ نسخهٔ کپی در TopBar باز
        // می‌شود تا کاربر، همان‌جا کپیِ قابل‌ویرایش (بی‌اتلافِ
        // qpdf یا بازسازی) بسازد. حاشیه‌نویسی‌ها در دیتابیس
        // می‌مانند و از دست نمی‌روند.
        showSaveStatus('info', 'این فایل محافظت‌شده است؛ برای ذخیره، نسخهٔ کپیِ قابل‌ویرایش ساخته می‌شود…', 6000);
        showToast('این فایل محافظت‌شده است؛ مودالِ ساختِ نسخهٔ کپی باز می‌شود.', { type: 'info' });
        window.dispatchEvent(new CustomEvent('app:open-protection-modal', { detail: { filePath } }));
      } else {
        showSaveStatus('error', (result && result.error) || 'ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.', 6000);
        showToast((result && result.error) || 'ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      showSaveStatus('error', 'خطا در آماده‌سازیِ خروجی: ' + (err && err.message ? err.message : String(err)), 6000);
      showToast('خطا در آماده‌سازیِ خروجی: ' + (err && err.message ? err.message : String(err)), { type: 'error' });
    } finally {
      setIsExportingPdf(false);
    }
  }, [filePath, rotation, showToast, isExportingPdf, showSaveStatus, handleRebuildSave]);

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

  // مرحله ۴ — Ctrl+F در ریدرِ PDF، جستجوی درون‌متنی را باز می‌کند.
  // توجه به ترتیبِ شنونده‌ها: useKeyboard (در App) شنوندهٔ capture دارد و
  // زودتر ثبت شده، پس اگر شاخهٔ focusSearch آن در ریدرِ PDF تسلیم نشود،
  // این شنونده هرگز به Ctrl+F نمی‌رسد (مراجعه: useKeyboard.js، مرحله ۴).
  // وقتی فوکوس داخلِ یک کادرِ متنی است، هیچ‌کدام دخالت نمی‌کنند.
  useEffect(() => {
    const onKeyDown = (e) => {
      // مرحله ۱۲: در حالِ ضبطِ شورت‌کات در تنظیمات، هیچ‌کاری نکن.
      if (window.__isRecordingShortcut ||
        (typeof document !== 'undefined' &&
          document.body?.dataset?.recordingShortcut === 'true')) return;
      // مرحله ۷ ـ بخش الف: فقط از مرجعِ واحد (findInPdf). پیش از
      // این، Ctrl+F هاردکدشده بود و تغییرِ میانبرِ جستجو در
      // تنظیمات، روی ریدرِ PDF اثری نداشت.
      let settingsState = null;
      try {
        settingsState = typeof useSettingsStore.getState === 'function'
          ? useSettingsStore.getState()
          : null;
      } catch (_) { /* ignore */ }
      if (!settingsState?.matchesShortcut?.('findInPdf', e)) return;
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
    // مرحله ۱۸: تایمرِ همگام‌سازیِ فایلِ قبلی، با فایلِ تازه می‌میرد تا
    // نتواند رویِ حالتِ فایلِ تازه بنویسد؛ نگهبانِ ۲۵۰ میلی‌ثانیه‌ای
    // هم از همین‌جا مسلح می‌شود.
    if (resumeTimerRef.current) { clearTimeout(resumeTimerRef.current); resumeTimerRef.current = null; }
    armScrollLockWatchdog();
    customRatiosRef.current.clear();
    clearAllCachedPageBlobs();
    hiDpiRenderService.clearFileCache(filePath);
    // مرحله ۱۷: پاک‌سازیِ کاملِ حالتِ فایلِ قبلی — مجموعهٔ
    // باطل‌شده‌ها و نشستِ زومِ HUD هم با فایلِ تازه شروع می‌شوند.
    revokedBlobUrlsRef.current.clear();
    if (zoomHudSafetyRef.current) { clearTimeout(zoomHudSafetyRef.current); zoomHudSafetyRef.current = null; }
    if (zoomHudGreenRef.current) { clearTimeout(zoomHudGreenRef.current); zoomHudGreenRef.current = null; }
    zoomHudSessionRef.current = null;
    prevSettledZoomRef.current = null;
    setZoomHud({ visible: false, done: 0, total: 0, isDone: false });
    setErrorMsg(null);
    setIsLoading(true);
    setPdfDoc(null);
    setNumPages(0);
    // مرحله ۹: هر بارگذاری، با رمزِ نشستِ همین فایل شروع می‌شود؛
    // مسیرِ آماده‌شدهٔ فایلِ قبلی، برای فایلِ تازه معتبر نیست.
    passwordAttemptRef.current = getPdfSessionPassword(filePath) || '';
    passwordFlowRef.current = null;
    if (loadOverrideRef.current && loadOverrideRef.current.filePath !== filePath) {
      loadOverrideRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let activeDoc = null;
    let loadingTask = null;
    let outlineTimerId = null;
    let searchIndexTimerId = null;

    // مرحله ۹ — لایهٔ ۱ و ۳ در کنارِ هم: pdf.js وقتی رمز لازم دارد،
    // این هندلر را صدا می‌زند. کد ۱ (NEED_PASSWORD) یعنی رمزِ
    // اولیه هنوز امتحان نشده: رمزِ نشست (یا خالی) داده می‌شود.
    // کد ۲ (INCORRECT_PASSWORD) یعنی رمزِ نشست/خالی رد شد: به‌جای
    // نمایشِ فوریِ خطا، لایهٔ ۱ (prepare) اجرا می‌شود؛ اگر مسیرِ
    // آماده‌ای نبود، مودالِ رمز باز می‌شود. در هر دو حالتِ کد ۲،
    // وظیفهٔ فعلی با خطایِ نشانه‌دار رها می‌شود تا بارگذاریِ دوباره
    // (با URL یا رمزِ تازه) انجام شود؛ catchِ بیرونی، این خطا را
    // ساکت رد می‌کند و پیامِ خطا نشان نمی‌دهد.
    const handlePasswordRequest = (updatePassword, code) => {
      if (code === 1) {
        try { updatePassword(passwordAttemptRef.current || ''); } catch (_) {}
        return;
      }
      if (passwordFlowRef.current || prepareInFlightRef.current) {
        try { updatePassword(new Error('__pdf_password_flow__')); } catch (_) {}
        return;
      }
      passwordFlowRef.current = 'preparing';
      prepareInFlightRef.current = true;
      void (async () => {
        try {
          const sessionPw = getPdfSessionPassword(filePath) || '';
          const prepared = await coreApi.prepareProtectedPdfForReading(filePath, { password: sessionPw });
          if (!isMounted) return;
          if (prepared && (prepared.status === 'ghost-neutralized' || prepared.status === 'unlocked-copy') && prepared.path) {
            const sanitized = String(prepared.path).trim().replace(/^[\\/]+/, '');
            loadOverrideRef.current = { filePath, url: `comic://media/?path=${encodeURIComponent(sanitized)}` };
            passwordFlowRef.current = null;
            setLoadNonce((n) => n + 1);
          } else {
            passwordFlowRef.current = 'modal';
            setIsLoading(false);
            setPasswordModal({ filePath, error: '' });
          }
        } catch (_) {
          if (isMounted) {
            passwordFlowRef.current = 'modal';
            setIsLoading(false);
            setPasswordModal({ filePath, error: '' });
          }
        } finally {
          prepareInFlightRef.current = false;
        }
      })();
      try { updatePassword(new Error('__pdf_password_flow__')); } catch (_) {}
    };

    const loadPdfData = async () => {
      try {
        const sanitizedPath = String(filePath || '').trim().replace(/^[\\/]+/, '');
        // مرحله ۹: اگر لایهٔ ۱ مسیرِ آماده‌ای برگرداند، بارگذاری از
        // همان فایلِ کش انجام می‌شود؛ هویتِ فایل (filePath) و همهٔ
        // وضعیت‌های کتابخانه/پیشرفت، روی فایلِ اصلی می‌مانند.
        const comicUrl = loadOverrideRef.current && loadOverrideRef.current.filePath === filePath
          ? loadOverrideRef.current.url
          : `comic://media/?path=${encodeURIComponent(sanitizedPath)}`;

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
              password: passwordAttemptRef.current || '',
              onPassword: handlePasswordRequest,
            });
            loadingTask = rangeTask;
            return await rangeTask.promise;
          } catch (rangeErr) {
            // مرحله ۹: اگر جریانِ رمز در حالِ اجراست، مسیرِ پشتیبانِ
            // دانلودِ کامل، بیهوده است (همان خطا را می‌دهد)؛ خطا را
            // بالا بفرست تا catchِ بیرونی، ساکت ردش کند.
            if (passwordFlowRef.current) throw rangeErr;
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
            password: passwordAttemptRef.current || '',
            onPassword: handlePasswordRequest,
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
        // مرحله ۱۱: ایندکسِ جستجویِ کناریِ فایلِ بازسازی‌شده (در
        // صورتِ وجود) به‌صورتِ غیرمسدودکننده خوانده می‌شود تا
        // extractPageText روی صفحه‌هایِ رستری هم متن داشته باشد.
        // نبودنِ ایندکس، خطا نیست و مسیرِ عادیِ جستجو را عوض
        // نمی‌کند.
        // مرحله ۱۷: ایندکسِ جستجو، ۴۰۰ میلی‌ثانیه پس از آماده‌شدنِ
        // سند خوانده می‌شود تا لحظهٔ باز شدن، فقط صرفِ صفحهٔ اول شود.
        try {
          searchIndexTimerId = setTimeout(() => {
            coreApi.getSearchIndex(filePath).then((res) => {
              if (!isMounted) return;
              if (res && res.found && res.index && res.index.pages) {
                searchIndexRef.current = res.index;
              }
            }).catch(() => {});
          }, 400);
        } catch (_) {}
        setNumPages(doc.numPages);
        setActivePage(savedPage);
        activePageRef.current = savedPage;
        setIsLoading(false);
        // مرحله ۶ ـ بخش الف: (الف) نشستِ آمارِ مطالعه برای این فایل
        // شروع می‌شود و صفحهٔ ازسرگیری، اولین بازدیدِ نشست است؛
        // (ب) فهرستِ PDF، غیرمسدودکننده و پس از آماده‌شدنِ سند
        // استخراج می‌شود تا رندرِ صفحه‌ها معطلِ آن نماند.
        readingActivity.begin(filePath);
        readingActivity.visitPage(savedPage);
        {
          const outlineRunId = (outlineRunRef.current += 1);
          setPdfOutline([], filePath, 'loading');
          // مرحله ۷ ـ نهاییِ دوم (مرحله ۱۷: ۴۰۰ میلی‌ثانیه):
          // استخراجِ فهرست به تعویق می‌افتد تا در لحظهٔ باز شدنِ کتاب، صفِ ورکرِ
          // pdf.js و پایپ‌لاینِ Range، ۱۰۰٪ صرفِ نمایشِ فوریِ
          // صفحهٔ اول شوند (ده‌ها getDestination/getPageIndex،
          // دیگر با رندرِ صفحهٔ اول رقابت نمی‌کنند). محافظِ runId
          // و isMounted، مثلِ قبل، از setStateِ کهنه جلوگیری
          // می‌کنند؛ تایمر هم در cleanupِ همین افکت پاک می‌شود.
          outlineTimerId = setTimeout(() => {
            if (!isMounted) return;
            extractPdfOutline(doc).then((outline) => {
              if (isMounted && outlineRunRef.current === outlineRunId) {
                setPdfOutline(outline, filePath, 'done');
              }
            }).catch(() => {
              if (isMounted && outlineRunRef.current === outlineRunId) {
                setPdfOutline([], filePath, 'done');
              }
            });
          }, 400);
        }
      } catch (err) {
        if (err?.name === 'AbortError') return;
        // مرحله ۹: خطایِ نشانه‌دارِ جریانِ رمز، یعنی بارگذاریِ
        // دوباره یا مودال در راه است؛ پیامِ خطا نشان نده.
        if (err && err.message === '__pdf_password_flow__') return;
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
      if (outlineTimerId) clearTimeout(outlineTimerId);
      if (searchIndexTimerId) clearTimeout(searchIndexTimerId);
      readingActivity.end();
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
  }, [filePath, loadNonce, clearAllCachedPageBlobs, updateReadingProgress, setPdfOutline]);

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
  // مرحله ۴ ـ بخش ب: تخلیهٔ کشِ متنِ جستجو. وقتی کش از سقف گذشت،
  // دورترین صفحه‌ها از صفحهٔ فعلی (به‌جز صفحهٔ تازه‌اضافه‌شده و شعاعِ
  // امنِ ±۵) حذف می‌شوند تا حافظهٔ کتاب‌های چند هزار صفحه‌ای کران‌دار
  // بماند؛ استخراجِ دوبارهٔ یک صفحهٔ حذف‌شده، فقط متنی و ارزان است.
  const pruneSearchTextCache = useCallback((justAddedPage) => {
    const cache = pageTextCacheRef.current;
    if (cache.size <= MAX_SEARCH_TEXT_CACHE_PAGES) return;
    const center = activePageRef.current || 1;
    const candidates = [...cache.keys()]
      .filter(
        (p) => p !== justAddedPage && Math.abs(p - center) > SEARCH_CLEANUP_RADIUS
      )
      .sort((a, b) => Math.abs(b - center) - Math.abs(a - center));
    for (const p of candidates) {
      if (cache.size <= MAX_SEARCH_TEXT_CACHE_PAGES) break;
      cache.delete(p);
    }
  }, []);

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
      const scaleY = Math.hypot(tx[2], tx[3]);
      const fontHeight = scaleY;
      const vertical = Math.abs(tx[1]) > Math.abs(tx[0]);
      // مرحله ۴ ـ بخش ب — اصلاحِ بحرانیِ بزرگیِ مستطیل (یافتهٔ تستِ
      // سرتاسری با PDF واقعی): item.width و item.height در pdf.js از
      // قبل در واحدِ فضای کاربر (پوینت) هستند، چون worker هنگامِ
      // ساختِ آیتم، textAdvanceScale (شاملِ اندازهٔ فونت) را اعمال
      // کرده است. ضربِ دوباره در scaleX، عرض را به‌اندازهٔ فونت
      // (مثلاً ۲۴ برابر) باد می‌کرد و هر هایلایت عملاً کلِ عرضِ صفحه
      // را می‌پوشاند. برای متنِ افقی، امتدادِ along برابرِ item.width
      // و برای متنِ عمودی، برابرِ item.height است.
      const advance = vertical ? (item.height || 0) : (item.width || 0);
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
      items.push({ start, end, rect, vertical, rtl: isRtlSearchItem(item, str) });
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
    let entry = {
      text,
      normalized,
      stripped: strippedChars.join(''),
      strippedToOriginal,
      items,
    };
    // مرحله ۱۱: اگر خودِ PDF هیچ آیتمِ متنی نداشت (صفحهٔ رستریِ
    // بازسازی‌شده) ولی ایندکسِ کناری برای این صفحه، متن و مختصات
    // دارد، از ایندکس خوانده می‌شود تا Ctrl+F با هایلایتِ دقیق،
    // روی فایلِ بازسازی‌شده هم کار کند. متنِ زندهٔ خودِ PDF،
    // همیشه اولویت دارد.
    const sidecarPages = searchIndexRef.current && searchIndexRef.current.pages;
    const sidecarEntry = sidecarPages ? (sidecarPages[pageNum] || sidecarPages[String(pageNum)]) : null;
    if ((!entry.items || entry.items.length === 0) && (!entry.stripped || entry.stripped.length === 0) && sidecarEntry && sidecarEntry.text) {
      entry = {
        text: sidecarEntry.text,
        normalized: sidecarEntry.normalized || normalizeSearchText(sidecarEntry.text),
        stripped: sidecarEntry.stripped || '',
        strippedToOriginal: Array.isArray(sidecarEntry.strippedToOriginal) ? sidecarEntry.strippedToOriginal : [],
        items: Array.isArray(sidecarEntry.items) ? sidecarEntry.items : [],
      };
    }
    pageTextCacheRef.current.set(pageNum, entry);
    pruneSearchTextCache(pageNum);
    // مرحله ۴ ـ بخش ب: صفحه‌های دور از شعاعِ رندر، پس از استخراجِ متن
    // cleanup می‌شوند تا وضعیتِ intentِ رندرِ pdf.js انباشته نشود.
    // خودِ pdf.js جلوی cleanupِ رندرِ در حالِ اجرا را می‌گیرد
    // (renderTasks فعال یا operatorList ناقص → no-op) و همین الگو
    // (cleanup پس از رندرِ تصویر) از قبل در همین فایل برقرار است؛
    // استخراجِ متن، در سمتِ worker انجام می‌شود و به intent state
    // وابسته نیست، پس cleanup هیچ رندرِ در دیدی را خراب نمی‌کند.
    if (Math.abs(pageNum - (activePageRef.current || 1)) > SEARCH_CLEANUP_RADIUS) {
      try {
        if (typeof page.cleanup === 'function') page.cleanup();
      } catch (_) {}
    }
    return entry;
  }, [pruneSearchTextCache]);

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
          } else if (item.rtl) {
            // مرحله ۴ ـ بخش ب: آیتمِ RTLِ منطقی — کادرِ جزئی قرینه
            // می‌شود: بازهٔ منطقیِ [f0,f1) روی کادرِ بصری، در بازهٔ
            // [1-f1,1-f0) می‌نشیند. تطابقِ کاملِ آیتم (شاخهٔ بالا)
            // بدونِ برش می‌ماند و همین‌طور متنِ عمودی دست نمی‌خورد.
            rects.push({
              top: item.rect.top,
              height: item.rect.height,
              left: item.rect.left + item.rect.width * (1 - f1),
              width: item.rect.width * (f1 - f0),
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

  // مرحله ۹ — لایهٔ ۳: ارسالِ رمزِ مودال و بارگذاریِ دوبارهٔ سند با
  // همان رمز (در حافظهٔ نشست). مسیرِ آماده‌شدهٔ قبلی پاک می‌شود تا
  // بارگذاری، از فایلِ اصلی با رمزِ تازه انجام شود.
  const handlePasswordSubmit = useCallback(() => {
    if (!passwordModal || passwordBusy) return;
    const pw = passwordValue;
    // مرحله ۹: رمزِ خالی، دوباره همان مسیرِ prepare را می‌چرخاند و
    // مودال را بی‌فایده باز می‌کند؛ ارسال، فقط با رمزِ غیرخالی.
    if (!pw) return;
    setPasswordBusy(true);
    setPdfSessionPassword(passwordModal.filePath, pw);
    loadOverrideRef.current = null;
    passwordFlowRef.current = null;
    setPasswordModal(null);
    setPasswordValue('');
    setPasswordBusy(false);
    setErrorMsg(null);
    setIsLoading(true);
    setLoadNonce((n) => n + 1);
  }, [passwordModal, passwordBusy, passwordValue]);

  const handlePasswordCancel = useCallback(() => {
    setPasswordModal(null);
    setPasswordValue('');
    passwordFlowRef.current = null;
    setErrorMsg('این فایل PDF با رمزِ عبور محافظت شده است و بدونِ رمز باز نمی‌شود.');
    setIsLoading(false);
  }, []);

  // مرحله ۴ ـ بخش ب: بستنِ بیرونی (Escape در useKeyboard) فقط پرچمِ
  // استور را خاموش می‌کند؛ این افکت همان پاک‌سازیِ closeSearch را
  // برای آن مسیر هم اجرا می‌کند تا نتیجه‌ها و پرسمانِ کهنه، با باز
  // شدنِ دوبارهٔ نوار برنگردند. کشِ متن دست نمی‌خورد.
  useEffect(() => {
    if (searchOpen) return;
    searchRunIdRef.current += 1;
    setSearchResults([]);
    setSearchCurrentKey(null);
    setSearchQuery('');
    setSearchScanning(false);
    setSearchScannedCount(0);
  }, [searchOpen]);

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

  // مرحله ۹: درخواستِ «جستجو در فایلِ کنونی» از TopBar یا
  // ContextMenu — نوار باز می‌شود، عبارت گذاشته می‌شود و فوکوس
  // می‌گیرد؛ خودِ افکتِ دیبانسِ بالا، جستجو را اجرا می‌کند. عبارتِ
  // خالی = فقط باز کردنِ نوار و فوکوس.
  useEffect(() => {
    if (!pdfSearchRequestId) return;
    setSearchOpen(true);
    setSearchQuery(pdfSearchQueryFromStore || '');
    setTimeout(() => {
      if (searchInputRef.current) searchInputRef.current.focus();
    }, 0);
  }, [pdfSearchRequestId, pdfSearchQueryFromStore]);

  // تعویضِ فایل یا آنمانت: لغوِ اسکنِ جاری + پاک‌سازیِ کشِ متنِ سندِ قبلی.
  useEffect(() => {
    searchRunIdRef.current += 1;
    pageTextCacheRef.current.clear();
    searchIndexRef.current = null;
    setSearchOpen(false);
    setSearchQuery('');
    setSearchResults([]);
    setSearchCurrentKey(null);
    setSearchScanning(false);
    setSearchScannedCount(0);
    return () => {
      searchRunIdRef.current += 1;
      pageTextCacheRef.current.clear();
      searchIndexRef.current = null;
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
      // مرحله ۱۸ — همگام‌سازیِ تضمین‌شدهٔ ویوپورتِ اولیه (Guaranteed
      // Initial Viewport Sync): به‌جایِ یک اسکرولِ تک‌مرحله‌ایِ کورکورانه،
      // سه مرحله: (۱) آنی، (۲) پس از دو فریمِ انیمیشن — وقتی paddingTop و
      // صفحاتِ پنجره واقعاً در DOM نشسته‌اند و scrollHeight از ویوپورت
      // بزرگ‌تر شده — و (۳) پس از ۱۱۰ میلی‌ثانیه با آفستِ زندهٔ
      // pageOffsetsRef. اگر باز هم بیش از یک صفحه فاصله بود، یک بازبینیِ
      // ۱۰۰ میلی‌ثانیه‌ای، دوباره اسکرول می‌کند؛ و اگر باز هم ننشست،
      // صفحهٔ فعال از رویِ scrollTopِ واقعیِ فعلی همگام می‌شود — پس
      // حالت، هرگز با چیزی که کاربر می‌بیند دروغ نمی‌گوید.
      markProgrammaticScroll();
      container.scrollTop = targetTop;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const c = containerRef.current;
          if (!c) return;
          if (c.scrollHeight > c.clientHeight) {
            markProgrammaticScroll();
            c.scrollTop = pageOffsetsRef.current[targetResumePage - 1] || targetTop;
          }
        });
      });
      // توجه: این تایمر عمداً به cleanupِ این افکت وصل نیست. در نسخهٔ
      // قبل، هر بازاجرایِ افکت (مثلاً با تغییرِ containerWidth یا
      // pageOffsets پس از اندازه‌گیریِ نسبتِ واقعیِ صفحه) تایمرِ
      // ۱۱۰ میلی‌ثانیه‌ای را پاک می‌کرد، اما pendingResumePage از قبل
      // null شده بود؛ پس hasResumed هرگز true و isResuming هرگز false
      // نمی‌شد و اسکرول برایِ همیشه «قفل» می‌ماند. تایمر، فقط در شروعِ
      // باز شدنِ فایلِ تازه پاک می‌شود.
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null;
        const c = containerRef.current;
        if (c) {
          const finalTop = pageOffsetsRef.current[targetResumePage - 1] || 0;
          markProgrammaticScroll();
          c.scrollTop = finalTop;
          setTimeout(() => {
            const c2 = containerRef.current;
            if (!c2) return;
            const offs = pageOffsetsRef.current;
            const avgH = offs.length > 0 ? c2.scrollHeight / offs.length : 800;
            const finalTop2 = offs[targetResumePage - 1] || 0;
            if (Math.abs(c2.scrollTop - finalTop2) > avgH) {
              markProgrammaticScroll();
              c2.scrollTop = finalTop2;
              setTimeout(() => {
                const c3 = containerRef.current;
                if (!c3) return;
                if (Math.abs(c3.scrollTop - finalTop2) > avgH) {
                  const offs3 = pageOffsetsRef.current;
                  const hts3 = pageHeightsRef.current;
                  if (!offs3 || offs3.length === 0) return;
                  const center = c3.scrollTop + (c3.clientHeight || 800) / 2;
                  let lo = 0;
                  let hi = offs3.length - 1;
                  let found = 0;
                  while (lo <= hi) {
                    const mid = (lo + hi) >>> 1;
                    const top = offs3[mid] || 0;
                    const bottom = top + (hts3[mid] || 800) + safePageGap;
                    if (center < top) hi = mid - 1;
                    else if (center >= bottom) lo = mid + 1;
                    else { found = mid; break; }
                    if (lo > hi) found = Math.max(0, Math.min(offs3.length - 1, lo - 1));
                  }
                  const syncPage = Math.max(1, Math.min(numPages, found + 1));
                  if (syncPage !== activePageRef.current) {
                    activePageRef.current = syncPage;
                    setActivePage(syncPage);
                    setCurrentPage(syncPage);
                  }
                }
              }, 100);
            }
          }, 100);
        }
        hasResumedRef.current = true;
        isResumingRef.current = false;
      }, 110);
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

      markProgrammaticScroll();
      c.scrollTop = Math.max(0, targetScrollTop);
      c.scrollLeft = Math.max(0, targetScrollLeft);
      if (rect?.pageNumber && rect.pageNumber >= 1 && rect.pageNumber <= numPages) {
        // مرحله ۱۸ — صفحهٔ مقصدِ زومِ ناحیه‌ای، همان صفحهٔ فعال می‌شود تا
        // در مرکزِ isNearViewport بنشیند و پاسِ HiDPI برایش اجرا شود؛
        // پیش از این، صفحهٔ فعالِ قبلی می‌ماند و صفحهٔ زوم‌شده، اگر بیش
        // از یک صفحه فاصله داشت، هرگز شارپ نمی‌شد.
        setActivePage(rect.pageNumber);
        activePageRef.current = rect.pageNumber;
        setCurrentPage(rect.pageNumber);
      }
      // مرحله ۱۸ — ری‌رندرِ HiDPI، بدونِ انتظارِ ۱۵۰ میلی‌ثانیه‌ایِ زومِ
      // تثبیت‌شده: زومِ ناحیه‌ای یک پرشِ گسسته است، نه درگِ لغزنده؛ پس
      // rasterZoomLevel همان‌جا با زومِ تازه (سقف‌دار با safeZoom)
      // همگام می‌شود و افکتِ HiDPI، بی‌درنگ با ضریبِ تازه اجرا می‌شود.
      rasterZoomRef.current = safeZoom;
      setRasterZoomLevel(safeZoom);
      clearAreaZoomTarget();
    });
  }, [areaZoomTarget, zoomLevel, numPages, pageOffsets.length, clearAreaZoomTarget, setCurrentPage]);

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
    // مرحله ۱۷: پنجرهٔ DOM، کاملاً متقارن و پایدار است — همیشه
    // DOM_OVERSCAN صفحه از بالا و همان‌قدر از پایین مانت‌اند؛
    // نوسانِ جهتِ اسکرول (آستانهٔ ۲ پیکسلیِ مرحلهٔ ۱۱) دیگر
    // صفحه‌ها را از DOM حذف و اضافه نمی‌کند.
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

  // مرحله ۲۰ — محاسبهٔ برشِ قابل‌مشاهدهٔ هر صفحهٔ در DOM.
  // مختصات، پیکسلِ CSS نسبت به گوشهٔ بالایِ چپِ خودِ صفحه‌اند و
  // با فرمولِ خودِ ویوور هم‌ترازند: چون spacerیِ paddingTop + چیدمانِ
  // جریانیِ صفحه‌ها، آفستِ مطلقِ pageOffsets را بازسازی می‌کند،
  // بالایِ صفحه در مختصاتِ اسکرول، همان pageOffsets[i] است.
  // فقط وقتی زوم بالایِ ۱٫۶ و چرخش صفر است، برش ساخته می‌شود؛ در
  // غیرِ این صورت null یعنی «صفحهٔ کامل». برش، ۳۰٪ حاشیهٔ امن در
  // هر چهار طرف دارد و به مرزهایِ صفحه کلمپ می‌شود. صفحه‌ای که
  // اصلاً دیده نمی‌شود هم null می‌گیرد (صفحهٔ کامل) تا بومِ خالی
  // ساخته نشود. فقط وقتی مقادیر واقعاً عوض شده باشند، state
  // به‌روز می‌شود و هویتِ آبجکتِ clipRect برایِ ممو پایدار می‌ماند
  // (برایِ صفحه‌هایِ بی‌تغییر، همان آبجکتِ قبلی بازمی‌گردد).
  const computeDeepClips = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const pages = visiblePageNumbersRef.current || [];
    if (pages.length === 0) return;
    const scrollTop = container.scrollTop || 0;
    const scrollLeft = container.scrollLeft || 0;
    const clientW = container.clientWidth || 0;
    const clientH = container.clientHeight || 0;
    if (!clientW || !clientH) return;
    const zoom = safeZoomRef.current || 1;
    const rot = rotationRef.current || 0;
    const offs = pageOffsetsRef.current || [];
    const hts = pageHeightsRef.current || [];
    const next = {};
    let changed = false;
    const prev = deepClipRectsRef.current || {};
    for (const pageNum of pages) {
      const idx = pageNum - 1;
      const pageTop = offs[idx] || 0;
      const pageH = hts[idx] || 0;
      // عرضِ صفحه در نمایش: همان فرمولِ پراپِ pageWidth، ولی با
      // clientWidthِ زندهٔ DOM (دقیق‌تر از state که با آستانهٔ
      // ۲ پیکسل به‌روز می‌شود؛ اختلافِ حداکثر ۲ پیکسل، زیرِ حاشیهٔ
      // ۳۰٪ گم می‌شود).
      const pageW = Math.max(1, Math.round(clientW * (Math.round(zoom * 100) / 100)));
      let rect = null;
      if (zoom > 1.6 && rot === 0 && pageH > 0) {
        const pageLeft = pageW <= clientW ? (clientW - pageW) / 2 : 0;
        const visX0 = Math.max(0, scrollLeft - pageLeft);
        const visX1 = Math.min(pageW, scrollLeft + clientW - pageLeft);
        const visY0 = Math.max(0, scrollTop - pageTop);
        const visY1 = Math.min(pageH, scrollTop + clientH - pageTop);
        if (visX1 > visX0 && visY1 > visY0) {
          const visW = visX1 - visX0;
          const visH = visY1 - visY0;
          const mx = visW * 0.3;
          const my = visH * 0.3;
          const x0 = Math.max(0, Math.round(visX0 - mx));
          const y0 = Math.max(0, Math.round(visY0 - my));
          const x1 = Math.min(pageW, Math.round(visX1 + mx));
          const y1 = Math.min(pageH, Math.round(visY1 + my));
          if (x1 > x0 && y1 > y0) {
            rect = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
          }
        }
      }
      const p = prev[pageNum];
      const same = (!p && !rect) || (p && rect && p.x === rect.x && p.y === rect.y && p.width === rect.width && p.height === rect.height);
      next[pageNum] = same ? (p || null) : rect;
      if (!same) changed = true;
    }
    if (changed) {
      deepClipRectsRef.current = next;
      setDeepClipRects(next);
    }
  }, []);

  // مرحله ۲۰ — بازمحاسبهٔ برش‌ها پس از تغییرِ زوم، اندازه، چرخش،
  // فایل یا آفست‌ها (با کمی تأخیر تا آفست‌هایِ تازه در ref بنشینند).
  useEffect(() => {
    const timerId = setTimeout(() => { computeDeepClips(); }, 60);
    return () => clearTimeout(timerId);
  }, [rasterZoomLevel, containerWidth, rotation, numPages, pageOffsets, filePath, computeDeepClips]);

  // ۸. رصد اسکرول Passive + فراخوانی ری‌رندر HiDPI پس از توقف اسکرول
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isLoading || numPages <= 0) return;

    setContainerWidth(Math.round(container.clientWidth || 900));

    let rafId = null;

    const updateActivePageFromScroll = () => {
      // مرحله ۱۸ — اسکرولِ دستیِ کاربر، قفل‌ها را فوری آزاد می‌کند:
      // چرخِ ماوس، نوارِ اسکرول و درگ، هیچ علامتِ برنامه‌ای ندارند؛
      // اسکرول‌هایِ برنامه‌ای (باز شدن، پرش، زومِ ناحیه‌ای) تا
      // ۱۵۰ میلی‌ثانیه پس از علامت‌گذاری، «برنامه‌ای» حساب می‌شوند.
      if (Date.now() - (programmaticScrollAtRef.current || 0) > 150) {
        releaseScrollLocks();
      }
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
          readingActivity.visitPage(nextPage);
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

      // مرحله ۲۰ — هنگامِ حرکت، بومِ دیپ پنهان می‌شود تا فقط لایهٔ
      // پایهٔ سبک دیده شود؛ ۱۲۰ میلی‌ثانیه پس از توقف، برشِ تازه
      // حساب و بومِ دیپ دوباره نشان داده می‌شود.
      if (!deepSuspendedRef.current) {
        deepSuspendedRef.current = true;
        setDeepSuspended(true);
      }
      if (deepStopTimerRef.current) clearTimeout(deepStopTimerRef.current);
      deepStopTimerRef.current = setTimeout(() => {
        deepSuspendedRef.current = false;
        setDeepSuspended(false);
        computeDeepClips();
      }, 120);
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
      if (deepStopTimerRef.current) clearTimeout(deepStopTimerRef.current);
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

  // ۹. زوم کانونی با چرخ ماوس (Ctrl + Wheel تا سقف 3.5x) — مرحله ۶:
  // نسخهٔ قبلی، شنوندهٔ wheel را فقط وقتی Ctrl نگه داشته شده بود
  // (keydown) وصل می‌کرد؛ ژستِ Pinchِ ترک‌پد، keydownِ Controlِ
  // جداگانه نمی‌فرستد و چرخِ ماوس وقتی Ctrl از قبل نگه داشته شده
  // بود هم شنونده را نداشت. حالا شنونده همیشه وصل است و فقط داخلِ
  // هندلر، ctrlKey/metaKey بررسی می‌شود؛ پس زومِ پیش‌فرضِ پنجرهٔ
  // مرورگر، همیشه با preventDefault خنثی می‌شود. زوم، ضربی و نرم
  // است (exp) تا هم ناچ‌های چرخِ ماوس و هم ژستِ پیوستهٔ دو انگشتی،
  // روان حس شوند؛ deltaModeِ خطی هم به پیکسل تبدیل می‌شود.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isLoading) return;

    // مرحله ۶ ـ بخش ب: تجمیعِ رویدادهای wheel در یک فریم با
    // requestAnimationFrame — ترک‌پد تا ۱۲۰ رویداد در ثانیه
    // می‌فرستد؛ به‌جای یک setZoomLevel (و یک به‌روزرسانیِ استیت)
    // در هر رویداد، دلتاها در یک فریم جمع و فقط یک بار اعمال
    // می‌شوند. ذخیرهٔ ماندگارِ زوم، از قبل در setZoomLevel با
    // Debounceِ ۳۵۰ میلی‌ثانیه‌ای انجام می‌شد و دست نخورده است.
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
          Math.max(0.4, parseFloat((currentZoom * factor).toFixed(2)))
        );

        if (nextZoom !== currentZoom) {
          const rect = container.getBoundingClientRect();
          const mouseY = pending.clientY - rect.top;
          const scrollY = container.scrollTop;
          const scrollFactor = nextZoom / currentZoom;

          prevZoomRef.current = nextZoom;
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
      armScrollLockWatchdog();
      const targetIdx = targetPage - 1;
      setActivePage(targetPage);
      activePageRef.current = targetPage;

      const targetOffset = pageOffsetsRef.current[targetIdx];
      if (targetOffset !== undefined) {
        markProgrammaticScroll();
        containerRef.current.scrollTo({
          top: targetOffset,
          behavior: 'smooth',
        });
      }

      clearTargetPage();
      if (filePath) {
        updateReadingProgress(filePath, targetPage, numPages);
      }

      // مرحله ۱۸: آزادسازیِ قفلِ پرش، دیگر با تایمرِ ۵۵۰ میلی‌ثانیه‌ای
      // نیست؛ نگهبانِ ۲۵۰ میلی‌ثانیه‌ای (armScrollLockWatchdog) و
      // اسکرولِ دستیِ کاربر، آن را آزاد می‌کنند.
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
    (e, pageIndex, imageSrc, yRatio) => {
      handleContextMenu(e, {
        pageIndex,
        imagePath: imageSrc,
        dataUrl: imageSrc,
        yRatio: typeof yRatio === 'number' ? yRatio : undefined,
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
        onExportAnnotatedPdf={handleExportAnnotatedPdf}
        isExportingPdf={isExportingPdf}
        pdfSaveState={pdfSaveState}
      />

      {/* مرحله ۷ ـ نهایی: بنرِ شناورِ وضعیتِ ذخیرهٔ PDF — مستقل از ToastHUD سراسری، همیشه روی همهٔ لایه‌ها. */}
      {pdfSaveState !== 'idle' && (
        <div
          dir="rtl"
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            top: '72px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 20px',
            borderRadius: '999px',
            backgroundColor: pdfSaveState === 'error' ? '#dc2626' : pdfSaveState === 'info' ? '#334155' : (pdfSaveState === 'saving-inplace' || pdfSaveState === 'saving-as') ? '#d97706' : '#059669',
            color: '#ffffff',
            fontSize: '13px',
            fontWeight: 700,
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
            maxWidth: 'min(92vw, 680px)',
            textAlign: 'center',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {(pdfSaveState === 'saving-inplace' || pdfSaveState === 'saving-as') && <Icons.Loader size={18} />}
          <span>{pdfSaveMessage}</span>
        </div>
      )}

      {/* مرحله ۹ — لایهٔ ۳: مودالِ ورودِ رمزِ عبورِ فایلِ PDF. فقط
          وقتی pdf.js رمزِ واقعی بخواهد نشان داده می‌شود؛ رمز، فقط در
          حافظهٔ نشست می‌ماند و ساختِ کپیِ بدونِ قفل هم از همان رمز
          استفاده می‌کند. */}
      {passwordModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ورود رمز عبور فایل PDF"
          data-modal-overlay="pdf-password"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handlePasswordCancel();
          }}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100000,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            pointerEvents: 'auto',
          }}
        >
          <div
            style={{
              width: 'min(400px, calc(100vw - 32px))',
              backgroundColor: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: '16px',
              boxShadow: '0 24px 64px rgba(0, 0, 0, 0.45)',
              padding: '22px',
              fontFamily: 'var(--font-fa)',
              color: 'var(--text)',
              pointerEvents: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <span
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(245, 158, 11, 0.15)',
                  color: '#f59e0b',
                  flexShrink: 0,
                }}
              >
                <Icons.AlertTriangle size={20} />
              </span>
              <div style={{ fontSize: '15px', fontWeight: 800, lineHeight: 1.5 }}>
                این فایل PDF رمزِ عبور دارد
              </div>
            </div>
            <div style={{ fontSize: '13px', lineHeight: 1.9, color: 'var(--muted)', marginBottom: '16px' }}>
              برای باز شدنِ این فایل، رمزِ عبورِ آن را وارد کنید. رمز، فقط تا بسته شدنِ برنامه در حافظه می‌ماند و هیچ‌جا ذخیره نمی‌شود.
            </div>
            <input
              type="password"
              autoFocus
              value={passwordValue}
              onChange={(e) => setPasswordValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handlePasswordSubmit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  handlePasswordCancel();
                }
              }}
              placeholder="رمزِ عبورِ فایل…"
              dir="auto"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '10px 12px',
                borderRadius: '10px',
                border: '1px solid var(--border)',
                backgroundColor: 'var(--panel2)',
                color: 'var(--text)',
                fontFamily: 'var(--font-fa)',
                fontSize: '13px',
                outline: 'none',
                marginBottom: '18px',
              }}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={handlePasswordSubmit}
                disabled={passwordBusy || !passwordValue}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--accent)',
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                  fontFamily: 'var(--font-fa)',
                  fontSize: '13px',
                  fontWeight: 700,
                  cursor: passwordBusy || !passwordValue ? 'wait' : 'pointer',
                  opacity: passwordBusy || !passwordValue ? 0.6 : 1,
                  pointerEvents: 'auto',
                }}
              >
                باز کردنِ فایل
              </button>
              <button
                type="button"
                onClick={handlePasswordCancel}
                disabled={passwordBusy}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  backgroundColor: 'var(--panel2)',
                  color: 'var(--text)',
                  fontFamily: 'var(--font-fa)',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                }}
              >
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* مرحله ۴ — نوارِ شناورِ جستجوی درون‌متنی PDF (بالای اسکرول، زیر TopBar) — بخش ب: وقتی استودیو فعال است، نوار پایین‌تر می‌نشیند تا روی داکِ پیش‌فرضِ افقیِ تولبار (بالا وسط) نیفتد. */}
      {searchOpen && (
        <div
          style={{ ...styles.searchBar, top: isAnnotationActive ? '132px' : '64px' }}
          dir="rtl"
        >
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

      <div
        ref={containerRef}
        data-reader-scroll-container="true"
        style={{
          ...styles.scrollContainer,
          pointerEvents: isSnippingActive || isAreaZoomActive ? 'none' : 'auto',
          cursor: isPanning ? 'grabbing' : undefined,
          userSelect: isPanning ? 'none' : undefined,
        }}
        onMouseDown={handlePanMouseDown}
        onWheel={() => {
          // مرحله ۱۸ — چرخِ ماوس، همیشه یعنی کاربر: قفل‌هایِ باز شدن
          // و پرش، فوری آزاد می‌شوند تا اسکرول از ثانیهٔ اول آزاد باشد.
          releaseScrollLocks();
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
              // مرحله ۱۷: شعاعِ رندر، متقارن و پایدار است
              // (RENDER_RADIUS در هر دو جهت). فاصلهٔ مطلق،
              // همچنان برای اولویتِ رندر (distanceFromActive)
              // به PdfPageItem می‌رود.
              const signedDistance = pageNum - activePage;
              // مرحله ۱۷: شعاعِ رندرِ پایه، متقارن است — همیشه
              // RENDER_RADIUS صفحه از بالا و همان‌قدر از پایین.
              const shouldRender = signedDistance >= -RENDER_RADIUS && signedDistance <= RENDER_RADIUS;
              const cachedUrl = pageBlobCacheRef.current.get(pageNum) || null;
              const pageAnnots = annotationsByPage[String(pageNum)] || EMPTY_PAGE_ANNOTATIONS;

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
                  isNearViewport={distance <= 1}
                  isActivePage={pageNum === activePage}
                  renderZoomLevel={rasterZoomLevel}
                  shouldRender={shouldRender}
                  cachedBlobUrl={cachedUrl}
                  onStorePageBlob={storePageBlobInCache}
                  revokedBlobUrls={revokedBlobUrlsRef.current}
                  revokedTick={revokedTick}
                  onDropPageBlob={handleDropPageBlob}
                  expectedHeight={(pageHeights || [])[index]}
                  pageWidth={containerWidth * (Math.round(safeZoom * 100) / 100)}
                  rotation={rotation}
                  pageAnnotations={pageAnnots}
                  searchHighlights={searchHighlightsByPage.get(pageNum) || null}
                  pageFilter={pageFilter}
                  onCommitPageAnnotations={handleCommitPageAnnotations}
                  onPageRatioMeasured={handlePageRatioMeasured}
                  onContextMenu={handlePageContextMenu}
                  pageBookmarks={pageBookmarkMap[pageNum] || EMPTY_PAGE_BOOKMARKS}
                  onOpenBookmark={handleOpenBookmark}
                  onDeleteBookmark={handleDeleteBookmark}
                  onRenameBookmark={handleRenameBookmark}
                  onHiDpiSettled={handleHiDpiSettled}
                  clipRect={deepClipRects[pageNum] || null}
                  deepSuspended={deepSuspended}
                />
              );
            })}

          <div style={{ height: `${paddingBottom}px`, width: '100%', flexShrink: 0 }} />
        </div>
      </div>
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
  scrollContainer: {
    width: '100%',
    height: '100%',
    overflowY: 'auto',
    overflowX: 'auto',
    // مرحله ۱۹ — بازگشتِ پس‌زمینهٔ پشتِ صفحات به سیاهِ مایل به
    // خاکستریِ پیش از مرحلهٔ ۱۸: عددِ پیشین، --bg خودِ برنامه
    // (#0a0f13) است که کانتینرِ شفاف، پیش از مرحلهٔ ۱۸ همان را نشان
    // می‌داد؛ نه #05070b و نه #000000ِ پرامپت، چون کاربر سیاهِ
    // خاکستری‌مایه خواست و عددِ پیشین هم دقیقاً همین است. فقط خودِ
    // برگهٔ کاغذ (pageWrapper) سفید می‌ماند. پدینگِ افقیِ ۸۰ = جایِ
    // مارکرِ ۶۸ + پلِ اتصالِ ۱۰ پیکسل + حاشیهٔ امن.
    backgroundColor: '#0a0f13',
    padding: '10px 80px',
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
    // مرحله ۱۷: کاغذِ صفحه همیشه سفید است تا پیش از آماده‌شدنِ
    // تصویر هم، کاغذِ سفید با اسکلتِ ملایم دیده شود، نه صفحهٔ سیاه.
    backgroundColor: '#ffffff',
    lineHeight: 0,
    fontSize: 0,
    position: 'relative',
    // مرحله ۱۶: contain: paint، بیرون‌زدگیِ مارکر را می‌بُرید؛ با
    // layout style، مارکرِ بیرونِ کادر دیده می‌شود.
    contain: 'layout style',
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
    imageRendering: 'auto',
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