import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import useReaderStore from '../../store/useReaderStore';
import useAppStore from '../../store/useAppStore';
import useLibraryStore from '../../store/useLibraryStore';
import useContextMenu from '../../hooks/useContextMenu';
import useDragPan from '../../hooks/useDragPan';
import { isTextInputElement } from '../../hooks/useKeyboard';
import { coreApi } from '../../services/coreApi';
import { getPdfSessionPassword, setPdfSessionPassword } from '../../services/pdfPasswordSession';
import { rebuildEditablePdfFromPdfJs, rebuildPdfBytesToBase64 } from '../../services/pdfRebuildService';
import annotationLocalBackup from '../../services/annotationLocalBackup';
import thumbnailService from '../../services/thumbnailService';
import renderQueue, { registerBasePngUrl, revokeBasePngUrl, registerDeepPngUrl, revokeDeepPngUrl } from '../../services/hiDpiRenderService';
import { encodeCanvasToLightweightPngUrl, encodeCanvasToWebpUrl } from '../../utils/gpuImageEnhancer';
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

const DOM_OVERSCAN = 3;
const RENDER_RADIUS = 3;

// مرحله ۴ ـ بخش ب: سقفِ کشِ متنِ جستجو + شعاعِ cleanup. شعاعِ ۶، یک
// صفحه حاشیه فراتر از پنجرهٔ رندر (DOM_OVERSCAN=۳) نگه می‌دارد.
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
  // مرحلهٔ ۲۹ — بازگشت به نسخهٔ <img>ای: تصویرِ همان تگِ <img>ِ
  // صفحه، برایِ منویِ راست‌کلیک (تصویرِ بوک‌مارک) خوانده می‌شود.
  // نشانیِ blob:ِ خودمان same-origin است و بوم را آلوده نمی‌کند.
  // این فراخوانی فقط با اقدامِ دستیِ کاربر رخ می‌دهد، نه در مسیرِ
  // زندهٔ اسکرول/زوم؛ پس toDataURL این‌جا ممنوعیتی ندارد.
  try {
    if (!imgEl || !imgEl.complete || !imgEl.naturalWidth || !imgEl.naturalHeight) return null;
    const tmp = document.createElement('canvas');
    tmp.width = imgEl.naturalWidth;
    tmp.height = imgEl.naturalHeight;
    const ctx = tmp.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(imgEl, 0, 0);
    const url = tmp.toDataURL('image/png');
    tmp.width = 0;
    tmp.height = 0;
    return url;
  } catch (_) {
    return null;
  }
}

// ============================================================================
// ۲. کامپوننت ایزوله هر صفحه PDF مجهز به رندر دو مرحله‌ای (Direct Canvas + Tile)
// ============================================================================
// مرحله ۱۲: آرایهٔ مشترکِ «صفحه بدونِ حاشیه‌نویسی» — پیش از این،
 // در رندرِ والد، برای هر صفحهٔ بدونِ حاشیه‌نویسی، یک آرایهٔ
 // تازه (`|| []`) ساخته می‌شد و مقایسهٔ سطحیِ React.memo را
 // برای PdfPageItem و لایهٔ Konvaی درونِ آن، در هر رندرِ والد،
// شکست می‌داد. این آرایه، فریز شده و در همهٔ صفحه‌ها مشترک است.
const EMPTY_PAGE_ANNOTATIONS = Object.freeze([]);
const EMPTY_PAGE_BOOKMARKS = Object.freeze([]);

// مرحلهٔ ۱۹ — کوانتیزهٔ زوم برایِ امضایِ دیپ: زوم به گام‌هایِ
// ۰٫۲۵ گرد می‌شود تا تغییرهایِ جزئیِ زوم، دیپِ آماده را از نو
// صف نکنند. کفِ ۰٫۵ این تابع برایِ دیپ بی‌اثر است، چون
// targetScale همیشه کفِ ۳٫۰ دارد.
function quantizeZoom(zoom) {
  const z = Math.min(3.5, Math.max(0.5, Number(zoom) || 1));
  return Math.round(z * 4) / 4;
}

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

// مرحلهٔ ۲۷ — عرضِ محتواییِ کانتینر (بدونِ پدینگ): تنها معیارِ
// درستِ عرضِ کارت است. کانتینر، پدینگِ افقیِ ۸۰ پیکسل در هر سمت
// دارد؛ پس clientWidth همیشه ۱۶۰ پیکسل از عرضِ واقعیِ محتوا
// بزرگ‌تر است و همین، در مرحلهٔ ۲۶ با نوشتنِ متناوبِ هر دو مقدار
// در containerWidth، ارتفاعِ کارت را ~۱۶۰×زوم×نسبت بلندتر از تصویر
// می‌کرد و زیرِ هر صفحه، مستطیلِ سفیدِ خالی می‌ساخت. این تابع،
// همیشه همان عرضِ content-box را برمی‌گرداند که ResizeObserver
// هم با contentRect می‌دهد؛ پس هر دو نویسنده، یک عدد می‌نویسند.
function measureContentWidth(el) {
  if (!el) return 900;
  try {
    const cs = window.getComputedStyle(el);
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    return Math.max(1, Math.round(el.clientWidth - pad));
  } catch (_) {
    return Math.round(el.clientWidth || 900);
  }
}

// مرحلهٔ ۲۷ — کشِ ابعادِ صفحات در localStorage (جایگزینِ پیش‌خوانیِ
// پس‌زمینهٔ کلِ کتاب در مرحلهٔ ۲۶ که ورکرِ pdf.js را با صدها
// getPage خفه می‌کرد): با باز شدنِ هر فایل، نسبت‌هایِ ذخیره‌شدهٔ
// همان فایل خوانده می‌شوند تا از همان رندرِ اول دقیق باشند؛
// هر نسبتِ تازه‌ای که هنگامِ رندرِ طبیعیِ صفحه ثبت شود، با
// ۱۰۰۰ میلی‌ثانیه تأخیر ذخیره می‌شود. خرابیِ localStorage، هرگز
// رندر را متوقف نمی‌کند.
function loadCachedPageRatios(filePath, numPages) {
  try {
    if (!filePath || !numPages || typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(`comicReader.pageRatios.v1:${filePath}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.n !== numPages || !Array.isArray(parsed.r) || parsed.r.length !== numPages) return null;
    const out = new Map();
    for (let i = 0; i < parsed.r.length; i++) {
      if (typeof parsed.r[i] === 'number' && parsed.r[i] > 0) out.set(i, parsed.r[i]);
    }
    return out.size > 0 ? out : null;
  } catch (_) {
    return null;
  }
}

function saveCachedPageRatios(filePath, numPages, ratiosMap) {
  try {
    if (!filePath || !numPages || typeof localStorage === 'undefined' || !ratiosMap) return;
    const arr = new Array(numPages).fill(null);
    for (const [idx, r] of ratiosMap.entries()) {
      if (idx >= 0 && idx < numPages && typeof r === 'number' && r > 0) arr[idx] = r;
    }
    localStorage.setItem(`comicReader.pageRatios.v1:${filePath}`, JSON.stringify({ n: numPages, r: arr }));
  } catch (_) {}
}

let lsRatiosSaveTimer = null;
function scheduleSaveCachedPageRatios(filePath, numPages, ratiosMap) {
  try {
    if (lsRatiosSaveTimer) clearTimeout(lsRatiosSaveTimer);
  } catch (_) {}
  lsRatiosSaveTimer = setTimeout(() => {
    lsRatiosSaveTimer = null;
    saveCachedPageRatios(filePath, numPages, ratiosMap);
  }, 1000);
}


const PdfPageItem = React.memo(function PdfPageItem({
  filePath,
  pageNumber,
  isLastPage,
  pageGap,
  pdfDoc,
  zoomLevel,
  hiDpiRenderTick,
  deepRefreshTick,
  distanceFromActive,
  isNearViewport,
  isActivePage,
  renderZoomLevel,
  shouldRender,
  expectedHeight,
  pageWidth,
  rotation,
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
  scrollContainerRef,
}) {
  const [renderFailed, setRenderFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [baseReady, setBaseReady] = useState(false);
  // مرحلهٔ ۲۹ — معماریِ تک‌تصویریِ <img> (بازگشت به موتورِ PNGِ
  // مرحلهٔ ۱۹): بوم‌هایِ مرحلهٔ ۲۷/۲۸ و لایهٔ PNGِ ۳ صفحه‌ای حذف
  // شدند؛ هر صفحه فقط یک نشانیِ پایه (WebP) و یک نشانیِ دیپ
  // (PNG) دارد که در یک تگِ <img> نمایش داده می‌شوند
  // (deepUrl || baseUrl). آینه‌هایِ ref برایِ آزادسازیِ همگام‌اند؛
  // ثبت و آزادسازیِ نهایی در کشِ LRUِ سرویس انجام می‌شود
  // (پایه ۱۲ ورودی، دیپ ۳ ورودی).
  const [baseUrl, setBaseUrl] = useState(null);
  const baseUrlRef = useRef(null);
  const [deepUrl, setDeepUrl] = useState(null);
  const deepUrlRef = useRef(null);
  const deepDoneRef = useRef(null);
  // مرحلهٔ ۳۰ — شمارندهٔ رندرهایِ فعالِ همین صفحه (پایه + دیپ):
  // page.cleanup() فقط وقتی صدا زده می‌شود که هیچ رندری رویِ
  // این صفحه در حالِ اجرا نباشد (شرطِ پرامپت)، تا رندرِ هم‌زمانِ
  // دیگر خراب نشود. lastDeepRefreshRef هم نسلِ دیده‌شدهٔ
  // deepRefreshTick را نگه می‌دارد.
  const pageRenderFlightRef = useRef(0);
  const lastDeepRefreshRef = useRef(0);
  const imgRef = useRef(null);
  const displayedSrc = deepUrl || baseUrl;
  // مرحلهٔ ۱۳: تنظیماتِ بوک‌مارک (اشتراکِ داخلی؛ تغییرش نادر است و
  // memoیِ صفحه را نمی‌شکند، چون prop نیست).
  const bookmarkPreferences = useBookmarkStore((state) => state.preferences);
  // مرحلهٔ ۱۲: فاصلهٔ زنده از صفحهٔ فعال، برایِ اولویتِ صفِ رندر،
  // بدونِ اینکه وابستگیِ effectِ رندرِ پایه باشد (وگرنه، هر
  // تغییرِ صفحهٔ فعال، effectِ همهٔ صفحه‌ها را از نو راه
  // می‌انداخت).
  const distanceRef = useRef(distanceFromActive);
  distanceRef.current = distanceFromActive;
  // مرحلهٔ ۲۹ — آینهٔ زندهٔ گیتِ دیپ برایِ اثرِ پایه (تا ندایِ
  // «نشست»ِ HUD، وقتی دیپ برایِ این صفحه در راه است، زود شلیک
  // نشود).
  const deepGateRef = useRef({ deepRuns: false });
  deepGateRef.current = { deepRuns: !!(shouldRender && (distanceRef.current ?? 99) <= 1) };

  // مرحلهٔ ۲۹ — پاسِ اول: لایهٔ پایهٔ سریع (WebP) رویِ بومِ موقت،
  // سپس نشانیِ blob: در یک تگِ <img> (بازگشت به موتورِ مرحلهٔ ۱۹):
  // مقیاسِ پایه = max(dpr, 2.0) با سقفِ یکنواختِ ضلعِ ۲۵۶۰ پیکسل،
  // پس‌زمینهٔ سفید، smoothing high، فرمتِ WebP با کیفیتِ ۰٫۹۵.
  // نسبتِ صفحه فقط در همین پاس اندازه‌گیری می‌شود.
  useEffect(() => {
    if (!shouldRender || !pdfDoc) return undefined;
    const key = `base:${filePath}:${pageNumber}`;
    const distance = distanceRef.current ?? 99;
    const priority = distance === 0 ? 1 : distance === 1 ? 2 : 3;
    renderQueue.enqueue({
      key,
      filePath,
      kind: 'base',
      priority,
      delayMs: priority === 3 ? 120 : 0,
      run: async (hooks) => {
        try {
          let renderTask = null;
          hooks.onCancel(() => {
            try { renderTask?.cancel(); } catch (_) {}
          });
          // مرحلهٔ ۳۰ — no-opِ پیش‌فرض تا اگر getPage خودش خطا
          // داد، catch به TDZ نخورد (تابع، بعداً جایگزین می‌شود).
          let markPageRenderDone = () => {};
          const page = await pdfDoc.getPage(pageNumber);
          if (hooks.isCancelled()) return;
          // مرحلهٔ ۳۰ — شمارشِ رندرِ فعال + آزادسازیِ pdf.js:
          let renderFlightCounted = false;
          markPageRenderDone = () => {
            if (!renderFlightCounted) return;
            renderFlightCounted = false;
            pageRenderFlightRef.current = Math.max(0, pageRenderFlightRef.current - 1);
            if (pageRenderFlightRef.current === 0) {
              try { if (typeof page.cleanup === 'function') page.cleanup(); } catch (_) {}
            }
          };
          pageRenderFlightRef.current += 1;
          renderFlightCounted = true;
          const baseViewport = page.getViewport({ scale: 1.0 });
          if (baseViewport.width > 0 && baseViewport.height > 0) {
            onPageRatioMeasured?.(pageNumber - 1, baseViewport.height / baseViewport.width);
          }
          // مقیاسِ پایه = max(dpr, 2.0) با سقفِ یکنواختِ ضلعِ ۲۵۶۰.
          const dpr = Math.max(window.devicePixelRatio || 1, 2.0);
          let scale = dpr;
          const maxSide = Math.max(baseViewport.width, baseViewport.height) * scale;
          if (maxSide > 2560) scale = 2560 / Math.max(baseViewport.width, baseViewport.height);
          const viewport = page.getViewport({ scale });
          const tmp = document.createElement('canvas');
          tmp.width = Math.max(1, Math.floor(viewport.width));
          tmp.height = Math.max(1, Math.floor(viewport.height));
          const context = tmp.getContext('2d');
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, tmp.width, tmp.height);
          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';
          renderTask = page.render({ canvasContext: context, viewport });
          await renderTask.promise;
          markPageRenderDone();
          if (hooks.isCancelled()) {
            tmp.width = 0;
            tmp.height = 0;
            return;
          }
          const url = await encodeCanvasToWebpUrl(tmp);
          tmp.width = 0;
          tmp.height = 0;
          if (hooks.isCancelled()) {
            if (url) { try { URL.revokeObjectURL(url); } catch (_) {} }
            return;
          }
          if (!url) return;
          baseUrlRef.current = url;
          setBaseUrl(url);
          registerBasePngUrl(`${filePath}:${pageNumber}`, url);
          setBaseReady(true);
          setRenderFailed(false);
          // ندایِ «نشست» برایِ HUD: اگر دیپ برایِ این صفحه در راه
          // است، نشست را دیپ اعلام می‌کند، نه پایه.
          const gate = deepGateRef.current || {};
          if (!gate.deepRuns && typeof onHiDpiSettled === 'function') onHiDpiSettled(pageNumber);
        } catch (err) {
          markPageRenderDone();
          if (hooks.isCancelled() || err?.name === 'RenderingCancelledException') return;
          setRenderFailed(true);
          throw err;
        }
      },
    });
    return () => {
      renderQueue.cancel(key);
    };
  }, [shouldRender, pdfDoc, filePath, pageNumber, retryTick, onPageRatioMeasured, onHiDpiSettled]);

  // مرحلهٔ ۲۹ — با عوض شدنِ سند/فایل/صفحه، هر دو نشانی صفر
  // می‌شود (آزادسازی از طریقِ کشِ LRUِ سرویس) و کارهایِ صف لغو
  // می‌شوند.
  useEffect(() => {
    setBaseReady(false);
    revokeBasePngUrl(`${filePath}:${pageNumber}`);
    baseUrlRef.current = null;
    revokeDeepPngUrl(`${filePath}:${pageNumber}`);
    deepUrlRef.current = null;
    deepDoneRef.current = null;
    setBaseUrl(null);
    setDeepUrl(null);
    return () => {
      renderQueue.cancel(`base:${filePath}:${pageNumber}`);
      renderQueue.cancel(`deep:${filePath}:${pageNumber}`);
      revokeBasePngUrl(`${filePath}:${pageNumber}`);
      revokeDeepPngUrl(`${filePath}:${pageNumber}`);
      baseUrlRef.current = null;
      deepUrlRef.current = null;
    };
  }, [pdfDoc, filePath, pageNumber]);

  // مرحلهٔ ۳۰ — تخلیهٔ نشانیِ پایه وقتی صفحه از فاصلهٔ ۶ دورتر
  // شد (سقفِ پرامپت): پنجرهٔ DOM فقط ‎±۳‎ صفحه مانت می‌کند و
  // unmount هم نشانی را آزاد می‌کند، پس این اثر، شبکهٔ امنِ
  // واگراییِ مرکزِ اسکرول و صفحهٔ فعال است، نه مسیرِ اصلی.
  useEffect(() => {
    const dist = distanceRef.current ?? 99;
    if (dist > 6 && baseUrlRef.current) {
      revokeBasePngUrl(`${filePath}:${pageNumber}`);
      baseUrlRef.current = null;
      setBaseUrl(null);
      setBaseReady(false);
    }
  }, [distanceFromActive, shouldRender, filePath, pageNumber]);

  // مرحلهٔ ۲۹ — تعریفِ pageBoxRef سرِ جایش می‌ماند: اثرِ تایل که
  // از آن می‌خواند حذف شد، ولی wrapper با ref={pageBoxRef} به
  // کارتِ صفحه وصل است و فرودِ زومِ باکسی، همچنان به همین ref
  // تکیه می‌کند.
  const pageBoxRef = useRef(null);


  // مرحلهٔ ۲۹ — پاسِ دوم: دیپ‌رندرِ سوپرسمپلِ PNG (موتورِ مرحلهٔ ۱۹)
  // برایِ صفحهٔ فعال و همسایه‌هایِ بلافصل (distance <= 1)، پس از
  // آماده شدنِ پایه و در توقفِ اسکرول (سیگنالِ hiDpiRenderTick).
  // فرمولِ دقیقِ مرحلهٔ ۱۹ با سقف‌هایِ یکنواختِ ۵۱۲۰ پیکسل /
  // ۲۰ مگاپیکسل؛ انکدِ PNG با Worker؛ تعویض پس از decode، بدونِ
  // چشمک. خروج از فاصلهٔ ۱، نشانیِ دیپ را همان‌جا آزاد می‌کند
  // (سقوط به پایهٔ کش‌شده) و کشِ LRUِ سرویس حداکثر ۶ ورودیِ PNG
  // را نگه می‌دارد. چرخش، گیت ندارد (رندرِ تمام‌صفحه است و CSS
  // می‌چرخاند). نشستِ HUD را همین پاس اعلام می‌کند.
  useEffect(() => {
    const dist = distanceRef.current ?? 99;
    const cacheKey = `${filePath}:${pageNumber}`;
    const key = `deep:${filePath}:${pageNumber}`;
    if (!shouldRender || !pdfDoc || dist > 1) {
      renderQueue.cancel(key);
      revokeDeepPngUrl(cacheKey);
      deepUrlRef.current = null;
      deepDoneRef.current = null;
      setDeepUrl(null);
      return undefined;
    }
    if (!baseReady) return undefined;
    if (!pageWidth || pageWidth <= 0) return undefined;
    // مرحلهٔ ۳۰ — نسلِ اجباریِ دیپ (پس از ذخیرهٔ درجا): اگر
    // deepRefreshTick عوض شده، امضایِ قبلی پاک می‌شود تا دیپ،
    // با همان زوم/عرض هم از نو رندر شود.
    if (deepRefreshTick !== lastDeepRefreshRef.current) {
      lastDeepRefreshRef.current = deepRefreshTick;
      deepDoneRef.current = null;
      if (deepUrlRef.current) {
        revokeDeepPngUrl(cacheKey);
        deepUrlRef.current = null;
        setDeepUrl(null);
      }
    }
    // مرحلهٔ ۳۰ — سقفِ تطبیقیِ دیپ بر اساسِ زومِ نشسته:
    // تا ۱۲۵٪ سقفِ ۳۶۰۰ پیکسل / ۹ مگاپیکسل، بالاتر از آن سقفِ
    // ۵۱۲۰ پیکسل / ۲۰ مگاپیکسلِ مرحلهٔ ۲۹. طبقه (tier) در امضا
    // هست تا عبور از مرزِ ۱۲۵٪ با همان زومِ کوانتیزه، دیپِ
    // کهنه را نگه ندارد.
    const deepTier = (renderZoomLevel || 0) > 1.25 ? 'hi' : 'lo';
    const deepSideCap = deepTier === 'hi' ? 5120 : 3600;
    const deepAreaCap = deepTier === 'hi' ? 20000000 : 9000000;
    const signature = `${filePath}|${pageNumber}|${quantizeZoom(renderZoomLevel)}|${pageWidth}|${deepTier}`;
    if (deepDoneRef.current === signature && deepUrlRef.current) {
      if (typeof onHiDpiSettled === 'function') onHiDpiSettled(pageNumber);
      return undefined;
    }
    const priority = dist === 0 ? 1 : 2;
    renderQueue.enqueue({
      key,
      filePath,
      kind: 'deep',
      priority,
      delayMs: dist === 0 ? 0 : 60,
      run: async (hooks) => {
        try {
          let renderTask = null;
          hooks.onCancel(() => {
            try { renderTask?.cancel(); } catch (_) {}
          });
          // مرحلهٔ ۳۰ — no-opِ پیش‌فرض (مثلِ پاسِ پایه).
          let markPageRenderDone = () => {};
          const page = await pdfDoc.getPage(pageNumber);
          if (hooks.isCancelled()) return;
          // مرحلهٔ ۳۰ — شمارشِ رندرِ فعال + آزادسازیِ pdf.js
          // (همان الگویِ پاسِ پایه؛ شمارنده، مشترکِ هر دو پاس است).
          let renderFlightCounted = false;
          markPageRenderDone = () => {
            if (!renderFlightCounted) return;
            renderFlightCounted = false;
            pageRenderFlightRef.current = Math.max(0, pageRenderFlightRef.current - 1);
            if (pageRenderFlightRef.current === 0) {
              try { if (typeof page.cleanup === 'function') page.cleanup(); } catch (_) {}
            }
          };
          pageRenderFlightRef.current += 1;
          renderFlightCounted = true;
          const baseViewport = page.getViewport({ scale: 1.0 });
          if (baseViewport.width <= 0 || baseViewport.height <= 0) return;
          const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2.0), 2.5);
          const requiredScale = pageWidth > 0
            ? (pageWidth * dpr * 1.25) / Math.max(1, baseViewport.width)
            : 0;
          let targetScale = Math.max(quantizeZoom(renderZoomLevel) * dpr * 1.2, requiredScale, 3.0);
          const rawW = baseViewport.width * targetScale;
          const rawH = baseViewport.height * targetScale;
          const sideScale = Math.max(rawW, rawH) > deepSideCap ? deepSideCap / Math.max(rawW, rawH) : 1;
          const areaScale = (rawW * rawH) > deepAreaCap ? Math.sqrt(deepAreaCap / (rawW * rawH)) : 1;
          targetScale = targetScale * Math.min(sideScale, areaScale);
          const viewport = page.getViewport({ scale: targetScale });
          const tmp = document.createElement('canvas');
          tmp.width = Math.max(1, Math.floor(viewport.width));
          tmp.height = Math.max(1, Math.floor(viewport.height));
          const tmpCtx = tmp.getContext('2d');
          tmpCtx.fillStyle = '#ffffff';
          tmpCtx.fillRect(0, 0, tmp.width, tmp.height);
          tmpCtx.imageSmoothingEnabled = true;
          tmpCtx.imageSmoothingQuality = 'high';
          renderTask = page.render({ canvasContext: tmpCtx, viewport });
          await renderTask.promise;
          markPageRenderDone();
          if (hooks.isCancelled()) {
            tmp.width = 0;
            tmp.height = 0;
            return;
          }
          const url = await encodeCanvasToLightweightPngUrl(tmp);
          tmp.width = 0;
          tmp.height = 0;
          if (hooks.isCancelled()) {
            if (url) { try { URL.revokeObjectURL(url); } catch (_) {} }
            return;
          }
          if (!url) return;
          try {
            const probe = new Image();
            probe.src = url;
            await probe.decode();
          } catch (_) {
            try { URL.revokeObjectURL(url); } catch (_) {}
            return;
          }
          if (hooks.isCancelled()) {
            try { URL.revokeObjectURL(url); } catch (_) {}
            return;
          }
          deepUrlRef.current = url;
          deepDoneRef.current = signature;
          setDeepUrl(url);
          registerDeepPngUrl(cacheKey, url);
          if (typeof onHiDpiSettled === 'function') onHiDpiSettled(pageNumber);
        } catch (err) {
          markPageRenderDone();
          if (hooks.isCancelled() || err?.name === 'RenderingCancelledException') return;
          throw err;
        }
      },
    });
    return undefined;
  }, [shouldRender, baseReady, pdfDoc, filePath, pageNumber, renderZoomLevel, pageWidth, hiDpiRenderTick, deepRefreshTick, onHiDpiSettled]);


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
  // مرحله ۲۲ — بازگشت به <img>: نشانیِ HiDPI (PNGِ سوپرسمپل‌شدهٔ
  // Worker) در اولویت است و لایهٔ پایه، پشتیبانِ آن است. تعویضِ
  // بدونِ چشمک (decode-gated) در ادامه، مثلِ قبل کار می‌کند.

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
      data-page-number={pageNumber}
      data-index={pageNumber - 1}
      className="comic-page-item pdf-page-container"
      style={{
        ...styles.pageWrapper,
        width: pageWidth ? `${pageWidth}px` : '100%',
        // مرحلهٔ ۲۶ — اسکلتِ تیره تا آماده شدنِ تصویر: به‌جایِ
        // کادرِ سفیدِ کورکنندهٔ #ffffff در محیطِ تیرهٔ #0a0f13،
        // تا لحظهٔ آماده شدنِ baseReady، خاکستریِ تیرهٔ #141c24
        // است و به محضِ آماده شدنِ تصویر، سفید می‌شود تا در
        // اسکرولِ سریع، هیچ چشمکِ سفیدی دیده نشود.
        backgroundColor: baseReady ? '#ffffff' : '#141c24',
        height: expectedHeight ? `${expectedHeight}px` : '650px',
        minHeight: expectedHeight ? `${expectedHeight}px` : '650px',
        marginBottom: isLastPage ? '0px' : `${pageGap}px`,
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
      onContextMenu={handleFrameContextMenu}
    >
      {/* مانتِ دائمیِ لایهٔ حاشیه‌نویسی (رفعِ صفحاتِ مردهٔ PDF، بخش ۱ تسک):
          قبلاً AnnotationLayer فقط وقتی activeSrc آماده بود مانت می‌شد؛
          پس صفحه‌های در حالِ رندر، صفحه‌های با فاصلهٔ ۴ از صفحهٔ فعال
          (بیرونِ RENDER_RADIUS=۳ ولی داخلِ پنجرهٔ DOM_OVERSCAN=۳) و
          صفحه‌های رندرِ ناموفق، اصلاً لایه نداشتند و هیچ ورودی‌ای
          نمی‌گرفتند (کرسر هم به حالتِ عادی برمی‌گشت). حالا لایه همیشه
          مانت است و تا وقتی تصویر آماده نیست، روی placeholder می‌نشیند.
          وقتی استودیو غیرفعال است، pointerEventsِ لایه none است، پس
          دکمهٔ «تلاش مجدد» روی placeholder همچنان کلیک‌پذیر می‌ماند؛
          وقتی فعال است، لایه با zIndex ۱۰۰ بالای تصویر/placeholder است
          و رویدادها را خودش می‌گیرد. لایه آخرین فرزندِ wrapperِ چرخان
          است تا روی تصویر رنگ شود و چرخشِ صفحه را هم به‌ارث ببرد. */}
      <div
        ref={pageBoxRef}
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
        <img
          ref={imgRef}
          src={displayedSrc || undefined}
          className="pdf-page-image"
          decoding="async"
          alt=""
          draggable={false}
          style={{
            ...styles.pageImage,
            filter: pageFilter || 'none',
            height: isSwappedRotation ? '100%' : 'auto',
          }}
          onError={() => {
            if (displayedSrc && displayedSrc === deepUrlRef.current) {
              revokeDeepPngUrl(`${filePath}:${pageNumber}`);
              deepUrlRef.current = null;
              deepDoneRef.current = null;
              setDeepUrl(null);
            } else {
              setRenderFailed(true);
            }
          }}
        />
        {!baseReady && !renderFailed && (
          <div style={{ ...styles.pagePlaceholder, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 3 }}>
            <div style={styles.spinnerBox}>
              <Icons.Loader size={24} />
            </div>
            <span style={styles.placeholderText}>صفحه {pageNumber}</span>
          </div>
        )}
        {renderFailed && (
          <div style={{ ...styles.pagePlaceholder, position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 4 }}>
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
          </div>
        )}


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
  // مرحلهٔ ۳۰ — نسلِ اجباریِ دیپ پس از ذخیرهٔ درجا.
  const deepRefreshTick = useReaderStore((state) => state.deepRefreshTick);
  const requestDeepRefresh = useReaderStore((state) => state.requestDeepRefresh);
  const pdfPageGap = useReaderStore((state) => state.pdfPageGap ?? 12);
  const rotation = useReaderStore((state) => state.rotation);
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
  // مرحلهٔ ۳۰ — کنترلِ لغوِ خروجی/بازسازی (AbortController):
  // لغو، در فازِ آماده‌سازی (overlay) و بازسازی (بینِ دسته‌هایِ
  // ۳ صفحه‌ای) اثر می‌کند؛ نوشتنِ نهاییِ main، تک‌مرحله‌ای و
  // اتمیک است و پس از شروع، قابلِ لغو نیست.
  const exportAbortRef = useRef(null);
  const handleCancelExport = useCallback(() => {
    try { exportAbortRef.current?.abort(); } catch (_) {}
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
      const w = measureContentWidth(c);
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
  // ۲۵۰ میلی‌ثانیه‌ایِ قفل‌هاست. programmaticScrollUntilRef، پایانِ
  // پنجرهٔ «برنامه‌ای» بودنِ اسکرول را نگه می‌دارد (پیش‌فرض ۱۵۰
  // میلی‌ثانیه؛ برایِ فرودِ زومِ باکسی در مرحلهٔ ۲۵، ۳۵۰ میلی‌ثانیه)
  // تا هندلرِ اسکرول، اسکرولِ دستیِ کاربر را از آن تشخیص بدهد.
  const resumeTimerRef = useRef(null);
  const lockWatchdogRef = useRef(null);
  const programmaticScrollUntilRef = useRef(0);
  const markProgrammaticScroll = (durationMs = 150) => {
    programmaticScrollUntilRef.current = Date.now() + durationMs;
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
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const numPagesRef = useRef(numPages);
  numPagesRef.current = numPages;
  const prevZoomRef = useRef(zoomLevel);
  // مرحله ۲۲ — نقطهٔ کانونیِ زوم: صفحهٔ فعال + نسبتِ درونِ صفحهٔ
  // مرکزِ دیدِ فعلی. در handleScroll (همگام) به‌روز می‌شود و اثرِ
  // قفلِ زوم، پیش از نقاشیِ فریم، scrollTop را رویِ همان نقطه
  // قفل می‌کند. prevAnchorZoomRef، جلویِ اجرایِ دوبارهٔ قفل را
  // وقتی زومِ ناحیه‌ای، هدفش را پاک می‌کند، می‌گیرد.
  const zoomAnchorRef = useRef({ page: 1, ratioInPage: 0 });
  const prevAnchorZoomRef = useRef(zoomLevel);
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

  // Minimum zoom lowered from 40% to 10% (0.1) per user requirement
  const safeZoom = Math.min(3.5, Math.max(0.1, Number(zoomLevel) || 1));
  // مرحله ۲۵ — بازگشت به چیدمانِ پایدار: تغییرِ داینامیکِ
  // alignItems در مرحلهٔ ۲۴، مبدأِ افقی را با عبور از آستانه
  // جابه‌جا می‌کرد و فرودِ زومِ باکسی را به‌هم می‌ریخت. حالا ستون
  // همیشه وسط‌چین است و کارت، margin: 0 auto دارد؛ چون کارت‌ها
  // عرضِ ۱۰۰٪ دارند، در حالتِ عادی هیچ سرریزِ منفی‌ای رخ
  // نمی‌دهد و مبدأ، در همهٔ زوم‌ها یکی می‌ماند.
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


  // Stage 8 Part A: a page item reports that its <img> failed on a
  // revoked URL. The entry is dropped from the cache and the URL is
  // registered as revoked, so the item re-renders from scratch instead
  // of trusting the dead URL forever (the previous blank-page stall).

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
    // مرحلهٔ ۳۰ — اگر از مسیرِ خروجی صدا زده شده، کنترلِ همان
    // عملیات استفاده می‌شود؛ وگرنه یک کنترلِ تازه ساخته می‌شود.
    if (!exportAbortRef.current) exportAbortRef.current = new AbortController();
    const exportSignal = exportAbortRef.current.signal;
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
            signal: exportSignal,
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
        signal: exportSignal,
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
          try { requestDeepRefresh?.(); } catch (_) {}
          showSaveStatus('saved-inplace', '✓ فایلِ بازسازی‌شدهٔ بدونِ قفل روی همین فایل ذخیره شد!' + savedSuffix, 4500);
          showToast(`نسخهٔ تمیزِ بدونِ قفل روی همین فایل ذخیره شد: ${prepared.totalItems} حاشیه‌نویسی در ${prepared.annotatedPages} صفحه. توجه: نسخهٔ بازسازی‌شده رستری است و متنِ برداری ندارد.`, { type: 'success' });
        } else {
          showSaveStatus('saved-as', '✓ فایلِ PDFِ بازسازی‌شدهٔ بدونِ قفل ذخیره شد!' + savedSuffix, 4500);
          showToast(`فایلِ PDFِ بازسازی‌شده با ${prepared.totalItems} حاشیه‌نویسی در ${prepared.annotatedPages} صفحه ذخیره شد. توجه: نسخهٔ بازسازی‌شده رستری است و متنِ برداری ندارد.`, { type: 'success' });
        }
      } else if (result && result.locked) {
        showSaveStatus('error', 'فایل در برنامهٔ دیگری باز است؛ آن را ببندید و دوباره ذخیره کنید. فایلِ اصلی دست نخورده باقی ماند.', 6000);
        showToast('فایل در برنامهٔ دیگری باز است؛ آن را ببندید و دوباره ذخیره کنید. فایلِ اصلی دست نخورده باقی ماند.', { type: 'error' });
      } else {
        showSaveStatus('error', (result && result.error) || 'ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.', 6000);
        showToast((result && result.error) || 'ساختِ PDFِ حاشیه‌نویسی‌شده انجام نشد.', { type: 'error' });
      }
    } catch (err) {
      if (exportSignal && exportSignal.aborted) {
        showSaveStatus('info', 'عملیاتِ بازسازی به درخواستِ شما لغو شد.', 4500);
        showToast('عملیاتِ بازسازی لغو شد.', { type: 'info' });
        exportAbortRef.current = null;
        return;
      }
      showSaveStatus('error', 'خطا در بازسازیِ فایل: ' + (err && err.message ? err.message : String(err)), 6000);
      showToast('خطا در بازسازیِ فایل: ' + (err && err.message ? err.message : String(err)), { type: 'error' });
    } finally {
      setIsExportingPdf(false);
      if (exportAbortRef.current && exportSignal && exportAbortRef.current.signal === exportSignal) exportAbortRef.current = null;
    }
  }, [filePath, showToast, showSaveStatus, requestDeepRefresh]);

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
      // مرحلهٔ ۳۰ — کنترلِ لغوِ کپیِ بازسازی (همان الگویِ خروجی).
      exportAbortRef.current = new AbortController();
      const rebuildCopySignal = exportAbortRef.current.signal;
      showSaveStatus('saving-as', 'در حالِ ساختِ نسخهٔ قابل‌ویرایشِ بدونِ قفل…', 0);
      try {
        const rebuilt = await rebuildEditablePdfFromPdfJs({
          pdfDoc: doc,
          preparedPages: {},
          signal: rebuildCopySignal,
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
        if (rebuildCopySignal && rebuildCopySignal.aborted) {
          showSaveStatus('info', 'ساختِ نسخهٔ کپی لغو شد.', 4500);
          showToast('ساختِ نسخهٔ کپی لغو شد.', { type: 'info' });
        } else {
          showSaveStatus('error', 'خطا در بازسازیِ فایل: ' + (err && err.message ? err.message : String(err)), 6000);
          showToast('خطا در بازسازیِ فایل: ' + (err && err.message ? err.message : String(err)), { type: 'error' });
        }
      } finally {
        rebuildCopyInFlightRef.current = false;
        exportAbortRef.current = null;
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
    exportAbortRef.current = new AbortController();
    const exportSignal = exportAbortRef.current.signal;
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
            signal: exportSignal,
          })
        : { pages: {}, totalItems: 0, annotatedPages: 0 };
      if (annotatedCount > 0 && prepared.annotatedPages === 0) {
        showSaveStatus('info', 'آیتمِ قابلِ خروجی پیدا نشد.', 4500);
        showToast('آیتمِ قابلِ خروجی پیدا نشد.', { type: 'info' });
        return;
      }
      if (exportSignal.aborted) {
        showSaveStatus('info', 'ذخیرهٔ فایل لغو شد.', 4500);
        showToast('ذخیرهٔ فایل لغو شد.', { type: 'info' });
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
          try { requestDeepRefresh?.(); } catch (_) {}
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
      if (exportSignal && exportSignal.aborted) {
        showSaveStatus('info', 'ذخیرهٔ فایل لغو شد.', 4500);
        showToast('ذخیرهٔ فایل لغو شد.', { type: 'info' });
      } else {
        showSaveStatus('error', 'خطا در آماده‌سازیِ خروجی: ' + (err && err.message ? err.message : String(err)), 6000);
        showToast('خطا در آماده‌سازیِ خروجی: ' + (err && err.message ? err.message : String(err)), { type: 'error' });
      }
    } finally {
      setIsExportingPdf(false);
      exportAbortRef.current = null;
    }
  }, [filePath, rotation, showToast, isExportingPdf, showSaveStatus, handleRebuildSave, requestDeepRefresh]);

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
      // مرحله ۲۲ — گیتِ دقیقِ ورودیِ متنی (مشترک با useKeyboard):
      // فقط TEXTAREA و SELECT و contentEditable و INPUTهایِ متنی،
      // شورت‌کات را می‌بلعند؛ اسلایدرِ range و دکمه، هرگز.
      if (isTextInputElement(t))
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
      // مرحله ۲۲ — گیتِ دقیقِ ورودیِ متنی (مشترک با useKeyboard):
      // فقط TEXTAREA و SELECT و contentEditable و INPUTهایِ متنی،
      // شورت‌کات را می‌بلعند؛ اسلایدرِ range و دکمه، هرگز.
      if (isTextInputElement(t))
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
    // مرحله ۲۳ — ریستِ نقطهٔ کانونیِ زوم با باز شدنِ هر فایل:
    // لنگرِ فایلِ قبلی، هرگز نباید زومِ فایلِ تازه را بچرخاند.
    // (اسکرولِ بازگشتِ به صفحهٔ ادامه، لنگر را با handleScroll
    // تازه می‌کند و فرودِ زومِ ناحیه‌ای هم آن را صراحتاً ست می‌کند.)
    zoomAnchorRef.current = { page: 1, ratioInPage: 0, ratioX: 0.5 };
    prevAnchorZoomRef.current = safeZoom;
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
    renderQueue.cancelFile(filePath);
    // مرحله ۱۷: پاک‌سازیِ کاملِ حالتِ فایلِ قبلی — مجموعهٔ
    // باطل‌شده‌ها و نشستِ زومِ HUD هم با فایلِ تازه شروع می‌شوند.
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
        // مرحلهٔ ۲۷ — بذرِ نسبت‌هایِ ذخیره‌شدهٔ همین فایل:
        // اگر ابعادِ این فایل قبلاً خوانده و در localStorage ذخیره
        // شده باشد، از همان رندرِ اول دقیق است و نیازی به
        // پیش‌خوانیِ پس‌زمینهٔ کلِ کتاب نیست.
        try {
          const cachedRatios = loadCachedPageRatios(filePath, doc.numPages);
          if (cachedRatios) {
            for (const [idx, r] of cachedRatios) customRatiosRef.current.set(idx, r);
          }
        } catch (_) {}
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
      renderQueue.cancelFile(filePath);
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
  }, [filePath, loadNonce, updateReadingProgress, setPdfOutline]);

  // ۳. محاسبه ارتفاع دقیق صفحات و آفست‌ها
  const { pageHeights, pageOffsets, totalHeight } = useMemo(() => {
    if (numPages <= 0) return { pageHeights: [], pageOffsets: [], totalHeight: 0 };
    const zoomPercentFactor = Math.round(safeZoom * 100) / 100;
    const effectiveWidth = containerWidth * zoomPercentFactor;
    const heights = new Array(numPages);
    const offsets = new Array(numPages);
    let currentTop = 0;

    for (let i = 0; i < numPages; i++) {
      offsets[i] = currentTop;
      const ratio = customRatiosRef.current.get(i) || defaultRatio;
      const h = Math.max(1, Math.round(effectiveWidth * ratio));
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

    const measuredW = measureContentWidth(container);
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


  // ۶. اثرِ یکپارچهٔ زوم و اسکرول (مرحلهٔ ۲۴) — جایگزینِ دو اثرِ
  // جداگانهٔ مرحلهٔ ۲۲/۲۳ (قفلِ زومِ عادی + فرودِ زومِ باکسی).
  // علتِ تداخلِ قبلی: فرودِ باکسی در useEffectِ پس از نقاشی با
  // rAF انجام می‌شد و پاک شدنِ هدف، اثرِ قفل را دوباره بیدار
  // می‌کرد. حالا هر دو شاخه در یک useLayoutEffectِ واحد، پیش از
  // نقاشیِ فریم، با هم اجرا می‌شوند و پس از فرود، لنگر دوباره با
  // موقعیتِ تازه همگام می‌شود تا هیچ اثری، حتی ۱ پیکسل، اسکرول
  // را جابه‌جا نکند.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || pageOffsets.length === 0) return;
    if (areaZoomTarget) {
      const targetPage = areaZoomTarget.pageNumber ?? areaZoomTarget.rect?.pageNumber ?? null;
      const pageRatioX = areaZoomTarget.pageRatioX ?? areaZoomTarget.rect?.pageRatioX ?? 0.5;
      const pageRatioY = areaZoomTarget.pageRatioY ?? areaZoomTarget.rect?.pageRelativeY ?? 0.5;
      // قفلِ فوریِ لنگر رویِ همان نقطه، در همان لحظهٔ ورودِ هدف.
      if (targetPage) {
        zoomAnchorRef.current = { page: targetPage, ratioInPage: pageRatioY, ratioX: pageRatioX };
      }
      prevZoomRef.current = zoomLevel;
      if (targetPage && targetPage >= 1 && targetPage <= numPages) {
        setActivePage(targetPage);
        activePageRef.current = targetPage;
        setCurrentPage(targetPage);
      }
      // گامِ ۱ (مرحلهٔ ۲۵): مانت کردنِ صفحهٔ هدف — اسکرول به
      // بالایِ صفحه (نه به نقطهٔ مرکزیِ تخمینی) تا عنصر در DOM
      // بیاید؛ فرودِ دقیق در گامِ ۲ با rectِ واقعی انجام می‌شود.
      // قفلِ برنامه‌ای، ۳۵۰ میلی‌ثانیه است تا در تمامِ مسیرِ فرود،
      // هیچ اثری اسکرول را پس نگیرد.
      if (targetPage && targetPage >= 1 && targetPage <= numPages) {
        const idx = targetPage - 1;
        markProgrammaticScroll(350);
        container.scrollTop = Math.max(0, pageOffsetsRef.current[idx] || 0);
      }
      prevAnchorZoomRef.current = safeZoom;
      // گامِ ۲: فرودِ دقیق با rectِ واقعیِ عنصر — هم در همین
      // اثر (اگر عنصر از قبل مانت است) و هم در rAFِ تکمیلیِ پس
      // از چیده شدنِ نهاییِ Flexbox (اگر تازه مانت شده است).
      const landPrecisely = () => {
        if (!containerRef.current) return false;
        const c = containerRef.current;
        const pageEl = targetPage ? c.querySelector(`[data-page-number="${targetPage}"]`) : null;
        if (!pageEl) return false;
        const pRect = pageEl.getBoundingClientRect();
        const cRect = c.getBoundingClientRect();
        // معادلهٔ ناوردا (مرحلهٔ ۲۵): موقعیتِ برگه در فضایِ اسکرول،
        // از رویِ rectِ واقعی حساب می‌شود و هیچ وابستگی‌ای به
        // paddingTop یا pageOffsets ندارد. (از نظرِ جبری با فرمولِ
        // اختلافِ دیدِ مرحلهٔ ۲۴ یکسان است؛ شکلِ ناوردا در برابرِ
        // جابه‌جاییِ مبدأِ فلکس پایدارتر است.)
        const pageTopInScroll = c.scrollTop + (pRect.top - cRect.top);
        const pageLeftInScroll = c.scrollLeft + (pRect.left - cRect.left);
        const targetScrollTop = pageTopInScroll + pageRatioY * pRect.height - c.clientHeight * 0.5;
        const targetScrollLeft = pageLeftInScroll + pageRatioX * pRect.width - c.clientWidth * 0.5;
        markProgrammaticScroll(350);
        c.scrollTop = Math.max(0, Math.round(targetScrollTop));
        c.scrollLeft = Math.max(0, Math.round(targetScrollLeft));
        // همگام‌سازیِ دوبارهٔ لنگر با موقعیتِ تازه، تا پس از پاک
        // شدنِ هدف، هیچ اثری اسکرول را جابه‌جا نکند.
        if (targetPage) {
          zoomAnchorRef.current = { page: targetPage, ratioInPage: pageRatioY, ratioX: pageRatioX };
        }
        rasterZoomRef.current = safeZoom;
        setRasterZoomLevel(safeZoom);
        return true;
      };
      if (landPrecisely()) {
        clearAreaZoomTarget();
      } else {
        let attempts = 0;
        const retry = () => {
          if (landPrecisely()) { clearAreaZoomTarget(); return; }
          attempts += 1;
          if (attempts < 3) {
            requestAnimationFrame(retry);
          } else {
            rasterZoomRef.current = safeZoom;
            setRasterZoomLevel(safeZoom);
            clearAreaZoomTarget();
          }
        };
        requestAnimationFrame(retry);
      }
      return;
    }
    // شاخهٔ زومِ عادی (منطقِ مرحلهٔ ۲۲، بدونِ تغییر):
    if (prevAnchorZoomRef.current === safeZoom) return;
    prevAnchorZoomRef.current = safeZoom;
    const anchor = zoomAnchorRef.current;
    if (!anchor) return;
    const tops = pageOffsetsRef.current || [];
    const heights = pageHeightsRef.current || [];
    const idx = (anchor.page || 1) - 1;
    if (idx < 0 || idx >= tops.length) return;
    const newTop = tops[idx] || 0;
    const newHeight = heights[idx] || 0;
    if (!newHeight) return;
    const ch = container.clientHeight || 800;
    const target = newTop + anchor.ratioInPage * newHeight - ch * 0.5;
    // مرحلهٔ ۲۹ — قفلِ کانونیِ افقی هم، تک‌مرحله‌ای با همان
    // markProgrammaticScroll: مرکزِ افقیِ دید (ratioX، سهمِ مرکزِ
    // دید از کلِ عرضِ قابلِ اسکرول) رویِ عرضِ تازه اعمال می‌شود
    // تا در زوم‌هایِ بالا، صفحه هم‌زمان در هر دو محور سرِ جایش
    // بماند و با شاخهٔ زومِ باکسی تداخل نکند (آن شاخه، همین اثر
    // را با prevAnchorZoomRef زود برمی‌گرداند).
    const cw = container.clientWidth || 800;
    const sw = container.scrollWidth || cw;
    const ratioX = typeof anchor.ratioX === 'number' ? anchor.ratioX : 0.5;
    const targetLeft = Math.min(Math.max(0, ratioX * sw - cw * 0.5), Math.max(0, sw - cw));
    const needTop = Math.abs(container.scrollTop - target) > 1;
    const needLeft = Math.abs(container.scrollLeft - targetLeft) > 1;
    if (needTop || needLeft) {
      markProgrammaticScroll();
      if (needTop) container.scrollTop = Math.max(0, target);
      if (needLeft) container.scrollLeft = targetLeft;
    }
  }, [safeZoom, areaZoomTarget, zoomLevel, numPages, pageOffsets.length, clearAreaZoomTarget, setCurrentPage, setActivePage]);

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


  const handlePageRatioMeasured = useCallback(
    (pageIndex, measuredRatio) => {
      if (!measuredRatio || measuredRatio <= 0) return;
      const existing = customRatiosRef.current.get(pageIndex) || defaultRatio;
      if (Math.abs(existing - measuredRatio) > 0.015) {
        customRatiosRef.current.set(pageIndex, measuredRatio);
        setRatioTick((t) => (t + 1) % 10000);
        scheduleSaveCachedPageRatios(filePathRef.current, numPagesRef.current, customRatiosRef.current);
      }
    },
    [defaultRatio]
  );


  // ۸. رصد اسکرول Passive + فراخوانی ری‌رندر HiDPI پس از توقف اسکرول
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isLoading || numPages <= 0) return;

    setContainerWidth(measureContentWidth(container));

    let rafId = null;

    const updateActivePageFromScroll = () => {
      // مرحله ۱۸ — اسکرولِ دستیِ کاربر، قفل‌ها را فوری آزاد می‌کند:
      // چرخِ ماوس، نوارِ اسکرول و درگ، هیچ علامتِ برنامه‌ای ندارند؛
      // اسکرول‌هایِ برنامه‌ای (باز شدن، پرش، زومِ ناحیه‌ای) تا
      // ۱۵۰ میلی‌ثانیه پس از علامت‌گذاری، «برنامه‌ای» حساب می‌شوند.
      if (Date.now() > (programmaticScrollUntilRef.current || 0)) {
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
      // مرحله ۲۴ — تایمرِ تایلِ جزئیات: در هر اسکرولی (حتی
      // برنامه‌ایِ ناشی از زومِ باکسی یا پرشِ صفحه) پس از ۱۲۰
      // میلی‌ثانیه توقف، شلیک می‌شود. این تایمر، پیش از هر گارد
      // و شاخهٔ دیگری ست می‌شود تا هیچ اسکرولی، تایل را جا
      // نگذارد. (تایمرِ ۲۲۰ میلی‌ثانیه‌ایِ HiDPI، جداگانه می‌ماند.)
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

      // مرحله ۲۲ — به‌روزرسانیِ نقطهٔ کانونیِ زوم در هر رویدادِ
      // اسکرول (همگام، نه با rAF) تا اثرِ قفل، همیشه تازه‌ترین
      // مرکزِ دید را داشته باشد.
      const anchorPage = activePageRef.current || 1;
      const anchorTops = pageOffsetsRef.current || [];
      const anchorHeights = pageHeightsRef.current || [];
      const anchorTop = anchorTops[anchorPage - 1] || 0;
      const anchorHeight = anchorHeights[anchorPage - 1] || 0;
      if (anchorHeight > 0) {
        const scrollW = container.scrollWidth || 1;
        zoomAnchorRef.current = {
          page: anchorPage,
          ratioInPage: Math.min(1, Math.max(0, (container.scrollTop + container.clientHeight * 0.5 - anchorTop) / anchorHeight)),
          ratioX: Math.min(1, Math.max(0, (container.scrollLeft + container.clientWidth * 0.5) / scrollW)),
        };
      }

    };

    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = Math.round(entry.contentRect.width || measureContentWidth(container) || 900);
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
        // Minimum zoom lowered from 40% to 10% (0.1) per user requirement
        const nextZoom = Math.min(
          3.5,
          Math.max(0.1, parseFloat((currentZoom * factor).toFixed(2)))
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
          {(pdfSaveState === 'saving-inplace' || pdfSaveState === 'saving-as') && exportAbortRef.current && (
            <button
              type="button"
              onClick={handleCancelExport}
              style={{
                pointerEvents: 'auto',
                cursor: 'pointer',
                padding: '4px 12px',
                borderRadius: '999px',
                border: '1px solid rgba(255,255,255,0.7)',
                backgroundColor: 'transparent',
                color: '#ffffff',
                fontFamily: 'var(--font-fa)',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              ✕ لغو عملیات
            </button>
          )}
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
            width: 'max-content',
            minWidth: '100%',
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
                  deepRefreshTick={deepRefreshTick}
                  distanceFromActive={distance}
                  isNearViewport={distance <= 1}
                  isActivePage={pageNum === activePage}
                  renderZoomLevel={rasterZoomLevel}
                  shouldRender={shouldRender}
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
                  onMoveBookmark={handleMoveBookmark}
                  onHiDpiSettled={handleHiDpiSettled}
                  scrollContainerRef={containerRef}
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
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    isolation: 'isolate',
    zIndex: 1,
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
    boxSizing: 'border-box',
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