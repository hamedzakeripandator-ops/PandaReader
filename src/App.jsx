import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import './index.css';

// ۱. چیدمان اصلی و ساختار پنجره
import TopBar from './components/layout/TopBar';
import Sidebar from './components/layout/Sidebar';
import RightPanel from './components/layout/RightPanel';

// ۲. استورها، هوک‌ها، سرویس هسته و آیکون‌های وکتور لوکال
import useKeyboard from './hooks/useKeyboard';
import useReaderStore from './store/useReaderStore';
import useLibraryStore from './store/useLibraryStore';
import useAppStore from './store/useAppStore';
import useSettingsStore from './store/useSettingsStore';
import useBookmarkStore, { resolveActiveBookKey } from './store/useBookmarkStore';
import { coreApi } from './services/coreApi';
import { beginAppSession } from './services/readingActivity';
import Icons from './components/common/Icons';

// ۳. کامپوننت‌های رندر کمیک و PDF
// مرحله ۳ ـ بخش الف: هر دو ویوورِ سنگین (شاملِ pdfjs-dist و konva)
// lazy شدند تا در بوتِ اولیه بارگذاری نشوند؛ فقط با ورود به حالتِ
// خواندن، چانکِ مربوطه خوانده می‌شود.
const VerticalViewer = lazy(() => import('./components/reader/VerticalViewer'));
const PdfViewer = lazy(() => import('./components/reader/PdfViewer'));
const EpubViewer = lazy(() => import('./components/reader/EpubViewer'));
import BottomControls from './components/reader/BottomControls';

// ۴. لایه‌های تعاملی، مودال‌ها و ابزارهای شناور شیشه‌ای
import ContextMenu from './components/common/ContextMenu';
// مرحله ۳ ـ بخش الف: مودال‌های غیرفوری lazy شدند؛ چون در حالتِ
// غیرفعال null رندر می‌کنند، fallback آن‌ها null است تا بارگذاریِ
// چانک، هیچ‌چیزِ مرئی را مسدود نکند.
const ScreenshotWidget = lazy(() => import('./components/modals/ScreenshotWidget'));
const SnippingOverlay = lazy(() => import('./components/modals/SnippingOverlay'));
const AreaZoomOverlay = lazy(() => import('./components/modals/AreaZoomOverlay'));
const QuickSettingsModal = lazy(() => import('./components/modals/QuickSettingsModal'));
// مرحله ۱۳: استودیوی بوک‌مارک — فقط با باز شدنِ مودال بارگذاری می‌شود.
const BookmarkStudioModal = lazy(() => import('./components/modals/BookmarkStudioModal'));
// مرحله ۱۴: نمایِ سراسریِ بوک‌مارک‌ها (زیرِ مواردِ اخیر در سایدبار).
const BookmarksView = lazy(() => import('./views/bookmarks/BookmarksView'));
import ToastHUD from './components/common/ToastHUD';

// ۵. صفحات ماژولار برنامه
// مرحله ۳ ـ بخش الف: HomeView عمداً eager می‌ماند (نمای فرودِ بوت)؛
// باقیِ نماها lazy هستند تا هر نما فقط با رفتن به آن، بارگذاری شود.
import HomeView from './views/home/HomeView';
const LibraryView = lazy(() => import('./views/library/LibraryView'));
const RecentView = lazy(() => import('./views/recent/RecentView'));
const FavoritesView = lazy(() => import('./views/favorites/FavoritesView'));
const DownloadsView = lazy(() => import('./views/downloads/DownloadsView'));
const SettingsView = lazy(() => import('./views/settings/SettingsView'));
const ProfileView = lazy(() => import('./views/profile/ProfileView'));

// مرحله ۳ ـ بخش ب: مرزِ خطای چانک. اگر بارگذاریِ یکی از چانک‌های
// React.lazy در زمانِ اجرا شکست بخورد (مثلاً چانکِ قدیمی بعد از
// به‌روزرسانی، یا قطعیِ لحظه‌ای)، به‌جای صفحهٔ سفید و کرشِ کاملِ
// ری‌اکت، پیامِ فارسی با دکمهٔ تلاشِ مجدد (بارگذاریِ دوبارهٔ صفحه)
// نشان داده می‌شود. کلاس است، چون مرزِ خطا فقط با کامپوننتِ کلاسی
// ممکن است. styles در زمانِ رندر خوانده می‌شود، پس تعریفِ دیرترِ آن
// در انتهای فایل مشکلی ندارد.
// مرحله ۱۱: مرزِ خطا، دو نوع خطا را از هم جدا می‌کند. پیش‌تر،
// هر خطایِ زمانِ اجرایِ کد (مثلاً TDZ در RecentView) هم با پیامِ
// «بارگذاریِ بخشی از برنامه ناموفق بود» و دکمهٔ reloadِ کورکورانه
// نشان داده می‌شد و پس از reload هم، همان خطا دوباره رخ می‌داد.
// حالا: شکستِ واقعیِ دانلودِ چانک → reload؛ خطایِ زمانِ اجرا →
// ثبتِ دقیقِ خطا، بازنشانیِ استیتِ مرز و بازگشت به نمایِ امن
// (بدونِ reload)، با نمایشِ پیامِ خطا برای تشخیص.
function isChunkLoadError(error) {
  const text = String((error && (error.message || error.name)) || error || '');
  return /ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|Failed to load module script/i.test(text);
}

class ChunkErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, isChunkError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error, isChunkError: isChunkLoadError(error) };
  }

  componentDidCatch(error, info) {
    try {
      const label = isChunkLoadError(error) ? 'Chunk load failed' : 'Render error caught by boundary';
      console.error(label + ':', error, info && info.componentStack ? info.componentStack : '');
    } catch (_) {}
  }

  handleReset = () => {
    const { isChunkError } = this.state;
    if (isChunkError) {
      window.location.reload();
      return;
    }
    this.setState({ hasError: false, error: null, isChunkError: false });
    try {
      if (typeof this.props.onReset === 'function') this.props.onReset();
    } catch (_) {}
  };

  handleRetrySection = () => {
    this.setState({ hasError: false, error: null, isChunkError: false });
  };

  render() {
    if (this.state.hasError) {
      const { isChunkError, error } = this.state;
      const detail = error && error.message ? String(error.message).slice(0, 300) : '';
      return (
        <div style={styles.chunkErrorOverlay}>
          <div style={styles.chunkErrorCard}>
            <div style={styles.chunkErrorTitle}>
              {isChunkError ? 'بارگذاریِ بخشی از برنامه ناموفق بود' : 'خطایی در نمایشِ این بخش رخ داد'}
            </div>
            <div style={styles.chunkErrorText}>
              {isChunkError
                ? 'به نظر می‌رسد فایلِ موردنیاز یافت نشد یا قدیمی است. با تلاشِ مجدد، برنامه دوباره بارگذاری می‌شود.'
                : 'این خطا از خرابیِ دانلودِ فایل نیست و جزئیاتِ آن برای بررسی ثبت شد. با بازگشت به صفحهٔ خانه، بخشِ سالمِ برنامه دوباره نمایش داده می‌شود.'}
            </div>
            {detail ? (
              <div style={{ ...styles.chunkErrorText, direction: 'ltr', textAlign: 'left', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                {detail}
              </div>
            ) : null}
            <button
              type="button"
              style={styles.chunkErrorButton}
              onClick={this.handleReset}
            >
              {isChunkError ? 'تلاش مجدد' : 'بازگشت به صفحهٔ خانه'}
            </button>
            {!isChunkError && (
              <button
                type="button"
                style={{ ...styles.chunkErrorButton, marginTop: 8, background: 'transparent', color: 'var(--text)' }}
                onClick={this.handleRetrySection}
              >
                تلاشِ دوبارهٔ همین بخش
              </button>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const comicData = useReaderStore((state) => state.comicData);
  const setComicData = useReaderStore((state) => state.setComicData);
  const isLoading = useReaderStore((state) => state.isLoading);
  const setIsLoading = useReaderStore((state) => state.setIsLoading);
  const loadingProgress = useReaderStore((state) => state.loadingProgress);
  const setLoadingProgress = useReaderStore((state) => state.setLoadingProgress);

  const currentView = useAppStore((state) => state.currentView);
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const isLeftSidebarOpen = useAppStore((state) => state.isLeftSidebarOpen);
  const setIsLeftSidebarOpen = useAppStore((state) => state.setIsLeftSidebarOpen);
  const isRightSidebarOpen = useAppStore((state) => state.isRightSidebarOpen);
  const setIsRightSidebarOpen = useAppStore((state) => state.setIsRightSidebarOpen);
  const showToast = useAppStore((state) => state.showToast);
  const isSnippingActive = useAppStore((state) => state.isSnippingActive);
  const isAreaZoomActive = useAppStore((state) => Boolean(state.isAreaZoomActive));
  const isQuickSettingsOpen = useAppStore((state) => state.isQuickSettingsOpen);
  const isScreenshotModalOpen = useAppStore((state) => state.isScreenshotModalOpen);
  const setIsAnnotationActive = useAppStore((state) => state.setIsAnnotationActive);
  const setIsAreaZoomActive = useAppStore((state) => state.setIsAreaZoomActive);
  // مرحلهٔ ۴۱ §۴: رنگِ پس‌زمینهٔ ناحیهٔ خواندن در حالتِ مطالعه
  // (از تنظیمات؛ تا وقتی فیلد در استور نیامده، همان پیش‌فرضِ '#2b3038').
  const readerBackdropColor = useSettingsStore((state) => state.readerBackdropColor || '#2b3038');

  // مرحلهٔ ۵۲ §۳: گرادیانِ اسکرول‌بارِ صفحات (از تنظیمات؛ تا وقتی
  // فیلد در استور نیامده، همان پیش‌فرضِ مرحلهٔ ۴۵). رنگِ پس‌زمینهٔ
  // ریدر با استایلِ خطی اعمال می‌شود، ولی گرادیانِ اسکرول‌بار در
  // index.css با var(--cr-sb-start) و var(--cr-sb-end) خوانده
  // می‌شود؛ پس تنها مسیرِ درست، همین useEffect است که آن دو متغیر
  // را رویِ documentElement می‌گذارد. مکانیزمِ رقابتیِ دیگری نیست:
  // :root در index.css فقط مقدارِ پیش‌فرض را می‌دهد.
  const scrollbarColorStart = useSettingsStore((state) => state.scrollbarColorStart || '#22d3ee');
  const scrollbarColorEnd = useSettingsStore((state) => state.scrollbarColorEnd || '#a78bfa');

  // مرحلهٔ ۵۲ §۳: اعمالِ زندهٔ گرادیانِ اسکرول‌بار رویِ همهٔ
  // اسکرول‌بارهایِ برنامه؛ با هر تغییرِ رنگ در تنظیمات، همین افکت
  // دوباره اجرا می‌شود (initSettings هم که از دیتابیس بخواند، استور
  // عوض می‌شود و افکت دوباره می‌دود). نگهبانِ برابری، از
  // setPropertyِ تکراری جلوگیری می‌کند.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    if (!root || !root.style || typeof root.style.setProperty !== 'function') return undefined;
    if (root.style.getPropertyValue('--cr-sb-start').trim() !== scrollbarColorStart) {
      root.style.setProperty('--cr-sb-start', scrollbarColorStart);
    }
    if (root.style.getPropertyValue('--cr-sb-end').trim() !== scrollbarColorEnd) {
      root.style.setProperty('--cr-sb-end', scrollbarColorEnd);
    }
    return undefined;
  }, [scrollbarColorStart, scrollbarColorEnd]);


  const [isDragging, setIsDragging] = useState(false);
  const [loadingFileName, setLoadingFileName] = useState('');

  const isLeftPinnedByClickRef = useRef(false);
  const isRightPinnedByClickRef = useRef(false);

  const autoZenTimerRef = useRef(null);
  const leftCloseTimerRef = useRef(null);
  const rightCloseTimerRef = useRef(null);
  const isCanceledRef = useRef(false);
  // مرحله ۴۲: شمارنده نسل بارگذاری؛ هر شروع جدید، نسل را یک واحد جلو می‌برد.
  const loadSeqRef = useRef(0);
  const isProcessingRef = useRef(false);
  // مرحلهٔ ۳۹ §۱: فهرستِ فایل‌هایِ پوشهٔ بازشده (برایِ نمایش در پنلِ
  // راست و ناوبریِ قبلی/بعدی در همان پوشه)؛ تا وقتی فایلی خارج از
  // همین پوشه باز نشود، زنده می‌ماند.
  const folderFilesRef = useRef(null);
  const transitionTimerRef = useRef(null);
  const postLoadTimerRef = useRef(null);
  const isDraggingRef = useRef(false);

  const isReadingMode = Boolean(comicData && currentView === 'reader');
  const isAnyModalActive = Boolean(
    isSnippingActive || isAreaZoomActive || isQuickSettingsOpen || isScreenshotModalOpen
  );

  const isReadingModeRef = useRef(isReadingMode);
  isReadingModeRef.current = isReadingMode;

  // مرحله ۴۹ §۱: بستنِ خودکارِ استودیو با خروج از ریدر (کمربندِ دوم).
  // لایهٔ اول، خودِ setCurrentView در useAppStore است که با هر
  // view متفاوت از reader مقدارِ isAnnotationActive را false
  // می‌کند؛ این افکت فقط مسیری را پوشش می‌دهد که currentView بدونِ
  // setCurrentView عوض شده باشد. رویِ اولین مونت اجرا نمی‌شود، با
  // ورود به ریدر کاری نمی‌کند و با هر خروج، حداکثر یک بار صدا می‌زند.
  const prevViewRef = useRef(currentView);
  const isFirstViewEffectRef = useRef(true);
  useEffect(() => {
    if (isFirstViewEffectRef.current) {
      isFirstViewEffectRef.current = false;
      prevViewRef.current = currentView;
      return;
    }
    const prevView = prevViewRef.current;
    prevViewRef.current = currentView;
    if (prevView === 'reader' && currentView !== 'reader') {
      if (useAppStore.getState().isAnnotationActive) {
        useAppStore.getState().setIsAnnotationActive(false);
      }
    }
  }, [currentView]);

  // مرحلهٔ ۵۲ §۱: ورود به تب‌هایِ کتابخانه/اخیر/علاقه‌مندی‌ها —
  // یک همگام‌سازیِ دسته‌ایِ فایل‌هایِ رفته (بهترین تلاش؛ استور،
  // فراخوان‌هایِ پشتِ سرِ هم را تا ۵ ثانیه یکی می‌کند).
  useEffect(() => {
    if (currentView === 'library' || currentView === 'recent' || currentView === 'favorites') {
      try {
        const syncRes = useLibraryStore.getState().syncMissingFiles?.();
        if (syncRes && typeof syncRes.catch === 'function') syncRes.catch(() => {});
      } catch (_) {}
    }
  }, [currentView]);

  // مرحله ۴۹ §۲: نگهبانِ ژستِ حاشیه‌نویسی. پرچمِ
  // window.__isAnnotationGestureActive را کارگرِ A در
  // AnnotationLayer.jsx می‌گذارد (true از شروعِ درگِ باکس/لسو/جابه‌جایی،
  // false با pointerup)؛ اینجا فقط خوانده می‌شود و هرگز گذاشته نمی‌شود.
  // تا وقتی ژست فعال است، هات‌اسپات‌هایِ لبه نباید باز شوند و
  // pointerEvents آن‌ها none می‌شود.
  const [isAnnotationGestureActive, setIsAnnotationGestureActive] = useState(false);
  const isAnnotationGestureActiveRef = useRef(false);
  const lastPointerPosRef = useRef({ x: -1, y: -1 });
  const leftHotspotRef = useRef(null);
  const rightHotspotRef = useRef(null);
  const gestureSyncTimerRef = useRef(null);
  const gesturePollTimerRef = useRef(null);

  const syncAnnotationGestureFlag = useCallback(() => {
    const active = typeof window !== 'undefined' && window.__isAnnotationGestureActive === true;
    if (active !== isAnnotationGestureActiveRef.current) {
      isAnnotationGestureActiveRef.current = active;
      setIsAnnotationGestureActive(active);
    }
  }, []);

  // مرحله ۴۹ §۲: تا وقتی ژست فعال است، هر ۱۵۰ میلی‌ثانیه پرچم
  // دوباره خوانده می‌شود تا اگر رویدادِ pointerup از دست رفت،
  // pointerEvents برایِ همیشه رویِ none نماند.
  useEffect(() => {
    if (!isAnnotationGestureActive) return undefined;
    gesturePollTimerRef.current = setInterval(syncAnnotationGestureFlag, 150);
    return () => {
      if (gesturePollTimerRef.current) {
        clearInterval(gesturePollTimerRef.current);
        gesturePollTimerRef.current = null;
      }
    };
  }, [isAnnotationGestureActive, syncAnnotationGestureFlag]);

  const cancelAutoZen = useCallback(() => {
    if (autoZenTimerRef.current) {
      clearTimeout(autoZenTimerRef.current);
      autoZenTimerRef.current = null;
    }
  }, []);

  // باز شدن موقت پنل راست در ابتدای ورود به کمیک و بسته شدن خودکار
  const triggerAutoZen = useCallback(() => {
    cancelAutoZen();
    const prefs = useSettingsStore.getState().preferences;
    const autoZenEnabled = prefs?.autoZenOnOpen !== false;
    const autoZenDelay = prefs?.autoZenDelay || 2800;

    setIsRightSidebarOpen(true);

    if (autoZenEnabled) {
      autoZenTimerRef.current = setTimeout(() => {
        if (!isRightPinnedByClickRef.current) {
          setIsRightSidebarOpen(false);
        }
        autoZenTimerRef.current = null;
      }, autoZenDelay);
    }
  }, [cancelAutoZen, setIsRightSidebarOpen]);

  // مرحله ۱۴: موتورِ زمان‌سنجِ سراسریِ برنامه، از لحظهٔ باز
  // شدنِ برنامه شروع می‌شود و تا بسته شدن، ادامه دارد.
  useEffect(() => {
    beginAppSession();
  }, []);

  // ۱. شنونده زنده پیشرفت استخراج فایل
  useEffect(() => {
    const unsubscribe = coreApi.onProgress((percent) => {
      if (typeof percent === 'number') {
        setLoadingProgress(Math.min(99, Math.max(5, percent)));
      }
    });
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [setLoadingProgress]);

  // ۲. لغو فوری عملیات بارگذاری توسط کاربر
  const handleCancelLoading = useCallback(async () => {
    isCanceledRef.current = true;
    // مرحله ۴۲: نسل بارگذاری را هم جلو ببر تا ادامه بارگذاری در حال اجرا رها شود.
    ++loadSeqRef.current;
    isProcessingRef.current = false;
    if (transitionTimerRef.current) {
      clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }

    try {
      if (coreApi.cancelExtraction) {
        await coreApi.cancelExtraction();
      }
    } catch (_) {}

    setIsLoading(false);
    setLoadingProgress(0);
    setLoadingFileName('');
    showToast('بارگذاری فایل متوقف شد', { type: 'info' });
  }, [setIsLoading, setLoadingProgress, showToast]);

  // ۳. کلید میانبر Escape برای لغو لودینگ در حالت انتظار
  useEffect(() => {
    if (!isLoading) return;
    const handleEscCancel = (e) => {
      // مرحله ۱۲: در حالِ ضبطِ شورت‌کات در تنظیمات، هیچ‌کاری نکن.
      if (window.__isRecordingShortcut ||
        (typeof document !== 'undefined' &&
          document.body?.dataset?.recordingShortcut === 'true')) return;
      if (e.key === 'Escape' || e.code === 'Escape') {
        e.preventDefault();
        handleCancelLoading();
      }
    };
    window.addEventListener('keydown', handleEscCancel);
    return () => window.removeEventListener('keydown', handleEscCancel);
  }, [isLoading, handleCancelLoading]);

  // ۴. بستن کامل کمیک، ذخیره پیشرفت معلق و آزادسازی حافظه رم و دیسک
  const handleCloseCurrentComic = useCallback(async () => {
    cancelAutoZen();
    isRightPinnedByClickRef.current = false;
    setIsAnnotationActive(false);
    setIsAreaZoomActive(false);

    try {
      useLibraryStore.getState().flushPendingProgress?.();
    } catch (_) {}

    setComicData(null);
    setCurrentView('home');
    try {
      if (coreApi.cleanupComicCache) {
        await coreApi.cleanupComicCache();
      }
    } catch (_) {}
  }, [
    setComicData,
    setCurrentView,
    cancelAutoZen,
    setIsAnnotationActive,
    setIsAreaZoomActive,
  ]);

  useEffect(() => {
    const onCloseComicEvent = () => {
      handleCloseCurrentComic();
    };
    window.addEventListener('app:close-comic', onCloseComicEvent);
    return () => window.removeEventListener('app:close-comic', onCloseComicEvent);
  }, [handleCloseCurrentComic]);

  // ۵. پردازش باز کردن فایل‌ها (کمیک، پوشه مانهوا و PDF)
  // مرحلهٔ ۳۹ §۱: اگر فایلِ بازشده داخلِ پوشهٔ فعال است، فهرستِ
  // پوشه + قبلی/بعدیِ همان فهرست + موقعیتِ «X از N» را رویِ بارِ
  // فایل سوار می‌کند؛ اگر خارج از پوشه است، فهرستِ پوشه پاک می‌شود.
  const attachFolderFiles = (payload, filePath) => {
    const folder = folderFilesRef.current;
    if (!folder || !Array.isArray(folder.files) || folder.files.length === 0) return payload;
    const norm = (p) => String(p || '').trim().replace(/[\\/]+/g, '\\').toLowerCase();
    const normFile = norm(filePath);
    const normFolder = norm(folder.folderPath);
    // مرحلهٔ ۴۰ §۵: خودِ پوشه باز شده (نه فایلی داخلِ آن) — فهرست،
    // همان فایل‌هایِ پوشه است و موقعیت، ۱ از N.
    if (normFile && normFolder && normFile === normFolder) {
      return {
        ...payload,
        folderFiles: folder.files,
        folderPath: folder.folderPath,
        nextComic: folder.files[1] || null,
        prevComic: null,
        dirInfo: {
          name: String(folder.folderPath || '').split(/[\\/]/).filter(Boolean).pop() || '',
          current: 1,
          total: folder.files.length,
          sortBy: 'name_asc',
        },
      };
    }
    if (!normFile || !normFolder || !normFile.startsWith(normFolder + '\\')) {
      folderFilesRef.current = null;
      return payload;
    }
    const idx = folder.files.findIndex((f) => norm(f.path) === normFile);
    if (idx === -1) {
      folderFilesRef.current = null;
      return payload;
    }
    return {
      ...payload,
      folderFiles: folder.files,
      folderPath: folder.folderPath,
      nextComic: folder.files[idx + 1] || null,
      prevComic: folder.files[idx - 1] || null,
      dirInfo: {
        name: String(folder.folderPath || '').split(/[\\/]/).filter(Boolean).pop() || '',
        current: idx + 1,
        total: folder.files.length,
        sortBy: 'name_asc',
      },
    };
  };

  const processFiles = useCallback(
    async (inputFiles) => {
      if (!inputFiles) return;

      const rawList = Array.isArray(inputFiles) ? inputFiles : [inputFiles];
      const filePaths = rawList
        .map((item) => (typeof item === 'string' ? item : item?.path || item?.filePath))
        .filter((p) => p && typeof p === 'string' && p.trim().length > 0);

      if (filePaths.length === 0) return;

      try {
        useLibraryStore.getState().flushPendingProgress?.();
      } catch (_) {}

      if (isProcessingRef.current) {
        try {
          await coreApi.cancelExtraction();
        } catch (_) {}
      }

      isProcessingRef.current = true;
      isCanceledRef.current = false;
      // مرحله ۴۲: شناسه نسل این بارگذاری؛ اگر بارگذاری جدیدتر شروع شود یا لغو شود، ادامه این نسل رها می‌شود.
      const mySeq = ++loadSeqRef.current;
      setIsAnnotationActive(false);
      setIsAreaZoomActive(false);

      const targetName = filePaths[0].split(/[\\/]/).pop() || '';
      setLoadingFileName(targetName);
      setIsLoading(true);
      setLoadingProgress(8);

      // مرحلهٔ ۳۵ §۲: فایلِ EPUB پیش از مسیرِ handleDrop جدا می‌شود
      // (EPUB آرشیوِ ZIP است ولی صفحهٔ تصویری ندارد و نباید واردِ
      // استخراجِ کمیک شود).
      if (filePaths[0].toLowerCase().endsWith('.epub')) {
        try {
          const epub = await coreApi.loadEpubBook(filePaths[0]);
          if (loadSeqRef.current !== mySeq || isCanceledRef.current) return;
          if (!epub || !epub.success) {
            throw new Error((epub && epub.message) || 'خواندنِ فایلِ EPUB ناموفق بود.');
          }
          const chapters = Array.isArray(epub.chapters) ? epub.chapters : [];
          if (chapters.length === 0) throw new Error('در این فایلِ EPUB هیچ فصلی یافت نشد.');
          let savedPage = 1;
          try {
            const normTarget = filePaths[0].trim().replace(/[\\/]+/g, '\\').toLowerCase();
            const existingRecent = (useLibraryStore.getState().recentItems || []).find(
              (r) =>
                (r.path || r.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
                normTarget
            );
            if (existingRecent && existingRecent.lastPage > 1) savedPage = Number(existingRecent.lastPage);
            const timeoutGuard = new Promise((resolve) => setTimeout(() => resolve(null), 300));
            const progRes = await Promise.race([
              coreApi.dbAction({
                action: 'GET_PROGRESS',
                payload: { filePath: filePaths[0] },
              }),
              timeoutGuard,
            ]);
            if (loadSeqRef.current !== mySeq || isCanceledRef.current) return;
            if (progRes?.progress) {
              const dbPage = Number(progRes.progress.currentPage) || 1;
              savedPage = Math.max(1, Math.min(dbPage, chapters.length));
            }
          } catch (_) {}
          const comicPayload = attachFolderFiles({
            type: 'epub',
            items: [],
            fileName: epub.fileName || targetName,
            fileSize: epub.fileSize || '',
            filePath: filePaths[0],
            cover: epub.coverUrl || null,
            savedResumePage: savedPage,
            savedTotalPages: chapters.length,
            dirInfo: null,
            nextComic: null,
            prevComic: null,
          }, filePaths[0]);
          setComicData(comicPayload);
          useReaderStore.getState().setCurrentPage(savedPage);
          setCurrentView('reader');
          triggerAutoZen();
          if (postLoadTimerRef.current) clearTimeout(postLoadTimerRef.current);
          postLoadTimerRef.current = setTimeout(() => {
            postLoadTimerRef.current = null;
            const libState = useLibraryStore.getState();
            if (epub.coverUrl && typeof libState.cacheCover === 'function') {
              try {
                libState.cacheCover(filePaths[0], epub.coverUrl);
              } catch (_) {}
            }
            if (typeof libState.addToRecent === 'function') {
              try {
                libState.addToRecent({
                  path: filePaths[0],
                  name: epub.fileName || targetName,
                  type: 'epub',
                  fileSize: epub.fileSize || '',
                  cover: epub.coverUrl || null,
                  totalPages: chapters.length,
                  lastPage: savedPage,
                });
              } catch (_) {}
            }
          }, 300);
        } catch (epubErr) {
          console.error('EPUB open error:', epubErr);
          showToast(epubErr?.message || 'خطا در باز کردنِ فایلِ EPUB', { type: 'error' });
        } finally {
          setIsLoading(false);
          setLoadingProgress(0);
          setLoadingFileName('');
          isProcessingRef.current = false;
        }
        return;
      }

      try {
        const result = await coreApi.handleDrop(filePaths);
        if (loadSeqRef.current !== mySeq || isCanceledRef.current) return;

        if (isCanceledRef.current || result?.canceled) {
          setIsLoading(false);
          setLoadingProgress(0);
          setLoadingFileName('');
          isProcessingRef.current = false;
          return;
        }

        // مرحلهٔ ۳۹ §۱: پوشهٔ دارایِ فایل‌هایِ قابلِ مطالعه — فهرست را
        // نگه دار و اولین فایلِ لیست (به ترتیبِ پنلِ راست) را خودبه‌خود
        // باز کن (PDF در PdfViewer، EPUB در EpubViewer، آرشیو/پوشه در
        // VerticalViewer).
        if (result && result.success && result.type === 'folder-files') {
          const files = Array.isArray(result.files) ? result.files : [];
          if (files.length === 0) {
            setIsLoading(false);
            setLoadingProgress(0);
            setLoadingFileName('');
            isProcessingRef.current = false;
            showToast('در این پوشه فایلِ قابلِ مطالعه‌ای یافت نشد.', { type: 'error' });
            return;
          }
          folderFilesRef.current = { folderPath: result.filePath, files };
          await processFiles([files[0].path]);
          if (loadSeqRef.current !== mySeq || isCanceledRef.current) return;
          return;
        }

        if (result && result.success) {
          setLoadingProgress(100);

          if (result.type !== 'pdf' && (!result.items || result.items.length === 0)) {
            setIsLoading(false);
            setLoadingProgress(0);
            setLoadingFileName('');
            isProcessingRef.current = false;
            showToast('هیچ تصویر معتبری در این کمیک یافت نشد.', { type: 'error' });
            return;
          }

          let savedPage = 1;
          let savedTotalPages = result.items?.length || 1;

          try {
            const normTarget = result.filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase();
            const existingRecent = (useLibraryStore.getState().recentItems || []).find(
              (r) =>
                (r.path || r.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
                normTarget
            );

            if (existingRecent) {
              if (existingRecent.lastPage > 1) savedPage = Number(existingRecent.lastPage);
              if (existingRecent.totalPages > 1) savedTotalPages = Number(existingRecent.totalPages);
            }

            const timeoutGuard = new Promise((resolve) => setTimeout(() => resolve(null), 300));
            const progRes = await Promise.race([
              coreApi.dbAction({
                action: 'GET_PROGRESS',
                payload: { filePath: result.filePath },
              }),
              timeoutGuard,
            ]);
            if (loadSeqRef.current !== mySeq || isCanceledRef.current) return;

            if (progRes?.progress) {
              const dbPage = Number(progRes.progress.currentPage) || 1;
              const dbTotal = Number(progRes.progress.totalPages) || 1;
              if (dbTotal > 1) savedTotalPages = dbTotal;

              if (result.type === 'pdf') {
                savedPage = Math.max(1, dbPage);
              } else {
                const maxPages = result.items?.length || 1;
                savedTotalPages = maxPages;
                savedPage = Math.max(1, Math.min(dbPage, maxPages));
              }
            }
          } catch (_) {}

          if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);

          transitionTimerRef.current = setTimeout(() => {
            try {
              if (isCanceledRef.current) return;

              // مرحلهٔ ۴۰ §۵: ورود به زیرپوشه از داخلِ لیستِ پوشه —
              // فهرستِ پنلِ راست را با محتوایِ آن زیرپوشه به روز کن
              // (تصویرهایِ آن، با pageIndex برایِ پرشِ مستقیم).
              const openFolder = folderFilesRef.current;
              if (openFolder && Array.isArray(openFolder.files) && result.type === 'folder' && Array.isArray(result.items) && result.items.length > 0) {
                const normKey = (p) => String(p || '').trim().replace(/[\\/]+/g, '\\').toLowerCase();
                const subEntry = openFolder.files.find((f) => f.kind === 'folder' && normKey(f.path) === normKey(result.filePath));
                if (subEntry) {
                  folderFilesRef.current = {
                    folderPath: result.filePath,
                    files: result.items.map((it, i) => ({
                      name: it.name || String(it.path || '').split(/[\\/]/).filter(Boolean).pop() || '',
                      path: it.path,
                      kind: 'image',
                      isDir: false,
                      pageIndex: i + 1,
                    })),
                  };
                }
              }
              const comicPayload = attachFolderFiles({
                type: result.type,
                items: result.items || [],
                fileName: result.fileName,
                fileSize: result.fileSize,
                filePath: result.filePath,
                cover: result.cover || null,
                savedResumePage: savedPage,
                savedTotalPages: savedTotalPages,
                dirInfo: result.dirInfo,
                nextComic: result.nextComic,
                prevComic: result.prevComic,
              }, result.filePath);

              setComicData(comicPayload);
              useReaderStore.getState().setCurrentPage(savedPage);
              setCurrentView('reader');
              triggerAutoZen();

              if (postLoadTimerRef.current) clearTimeout(postLoadTimerRef.current);
              postLoadTimerRef.current = setTimeout(() => {
                postLoadTimerRef.current = null;
                const libState = useLibraryStore.getState();

                if (result.cover && typeof libState.cacheCover === 'function') {
                  try {
                    libState.cacheCover(result.filePath, result.cover);
                  } catch (_) {}
                }

                if (typeof libState.addToRecent === 'function') {
                  try {
                    libState.addToRecent({
                      path: result.filePath,
                      name: result.fileName,
                      type: result.type,
                      fileSize: result.fileSize,
                      cover: result.cover || null,
                      totalPages:
                        result.type === 'pdf' ? savedTotalPages : result.items?.length || 1,
                      lastPage: savedPage,
                    });
                  } catch (_) {}
                }
              }, 300);
            } catch (viewTransitionErr) {
              console.error('View transition error:', viewTransitionErr);
              showToast('خطا در ورود به نمای مطالعه', { type: 'error' });
            } finally {
              setIsLoading(false);
              setLoadingProgress(0);
              setLoadingFileName('');
              isLeftPinnedByClickRef.current = false;
              setIsLeftSidebarOpen(false);
              isProcessingRef.current = false;
              transitionTimerRef.current = null;
            }
          }, 30);
        } else {
          setIsLoading(false);
          setLoadingProgress(0);
          setLoadingFileName('');
          isProcessingRef.current = false;
          if (!result?.canceled) {
            showToast(result?.error || 'خطا در بارگذاری کمیک یا سند نامعتبر', {
              type: 'error',
            });
          }
          // مرحلهٔ ۵۲ §۱: باز نشدنِ فایل می‌تواند یعنی فایل از
          // دیسک رفته است؛ فقط همان مسیرها دسته‌ای بررسی می‌شوند.
          try {
            const syncRes = useLibraryStore.getState().syncMissingFiles?.(filePaths);
            if (syncRes && typeof syncRes.catch === 'function') syncRes.catch(() => {});
          } catch (_) {}
        }
      } catch (error) {
        console.error('File process error:', error);
        setIsLoading(false);
        setLoadingProgress(0);
        setLoadingFileName('');
        isProcessingRef.current = false;
        showToast('خطای سیستمی در خواندن فایل از دیسک', { type: 'error' });
        // مرحلهٔ ۵۲ §۱: خطایِ خواندن از دیسک هم می‌تواند یعنی
        // فایل رفته است؛ فقط همان مسیرها دسته‌ای بررسی می‌شوند.
        try {
          const syncRes = useLibraryStore.getState().syncMissingFiles?.(filePaths);
          if (syncRes && typeof syncRes.catch === 'function') syncRes.catch(() => {});
        } catch (_) {}
      }
    },
    [
      setComicData,
      setIsLoading,
      setLoadingProgress,
      setIsLeftSidebarOpen,
      setCurrentView,
      setIsAnnotationActive,
      setIsAreaZoomActive,
      showToast,
      triggerAutoZen,
    ]
  );

  useKeyboard({
    onOpenComic: processFiles,
  });

  useEffect(() => {
    useReaderStore.getState().initZoomSettings?.();
    useLibraryStore.getState().initLibrary?.();
    useSettingsStore.getState().initSettings?.();
    // مرحلهٔ ۳۹ §۳: اگر localStorage خالی است، سیستمِ رنگ را از دیتابیس بخوان.
    useAppStore.getState().loadCustomColorSystemFromDb?.();
    // مرحلهٔ ۴۰ §۵: پیش بارگذاریِ تنبلِ pica و minisearch پس از بوت،
    // تا اولین جستجو/کاور، بی‌معطلی انجام شود.
    try {
      const preloadHeavySearchDeps = () => {
        import('pica').catch(() => {});
        import('minisearch').catch(() => {});
      };
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(preloadHeavySearchDeps, { timeout: 5000 });
      } else {
        setTimeout(preloadHeavySearchDeps, 2000);
      }
    } catch (_) {}
    // مرحله ۱۶: هیدراتِ بوک‌مارک در بوت، تا سایدبار و منو از همان
    // اول پریست‌ها را داشته باشند و هیچ ذخیره‌ای پیش از بارگذاری
    // رخ ندهد.
    useBookmarkStore.getState().loadPreferences?.();

    const handleBeforeUnload = () => {
      try {
        useLibraryStore.getState().flushPendingProgress?.();
      } catch (_) {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // مرحلهٔ ۴۵ §۱: محوِ اسپلشِ بوت پس از اولین نقاشی.
  // اسپلش، لایهٔ خواهرِ #root در index.html است (نه فرزندِ آن)، پس
  // مانتِ ری‌اکت آن را پاک نمی‌کند و این افکت آن را نرم محو می‌کند:
  // دو requestAnimationFrame یعنی «اولین نقاشی» انجام شده، بعد
  // opacity در ۲۵۰ میلی‌ثانیه به صفر می‌رسد و لایه از DOM حذف می‌شود.
  // اگر اسپلش از قبل در DOM نباشد، هیچ خطایی نمی‌دهد.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const splash = document.getElementById('app-boot-splash');
    if (!splash) return undefined;
    let rafSecond = 0;
    let removeTimer = 0;
    const removeSplash = () => {
      try {
        splash.style.transition = 'opacity 250ms ease';
        splash.style.opacity = '0';
        splash.style.pointerEvents = 'none';
      } catch (_) {}
      removeTimer = window.setTimeout(() => {
        try {
          if (splash.parentNode) splash.parentNode.removeChild(splash);
        } catch (_) {}
      }, 250);
    };
    const rafFirst = window.requestAnimationFrame(() => {
      rafSecond = window.requestAnimationFrame(removeSplash);
    });
    return () => {
      window.cancelAnimationFrame(rafFirst);
      if (rafSecond) window.cancelAnimationFrame(rafSecond);
      if (removeTimer) window.clearTimeout(removeTimer);
    };
  }, []);

  useEffect(() => {
    const handleNavEvent = (e) => {
      if (e.detail) processFiles(e.detail);
    };
    window.addEventListener('app:navigate-comic', handleNavEvent);
    return () => window.removeEventListener('app:navigate-comic', handleNavEvent);
  }, [processFiles]);

  useEffect(() => {
    return () => {
      if (autoZenTimerRef.current) clearTimeout(autoZenTimerRef.current);
      if (leftCloseTimerRef.current) clearTimeout(leftCloseTimerRef.current);
      if (rightCloseTimerRef.current) clearTimeout(rightCloseTimerRef.current);
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      if (postLoadTimerRef.current) clearTimeout(postLoadTimerRef.current);
    };
  }, []);

  const handleSelectFile = useCallback(async () => {
    try {
      const result = await coreApi.openFile();
      if (result && result.success && result.filePath) {
        processFiles(result.filePath);
      } else if (result?.error && !result?.canceled) {
        showToast(result.error, { type: 'error' });
      }
    } catch (e) {
      console.error('Open file dialog error:', e);
    }
  }, [processFiles, showToast]);

  const handleSelectFolder = useCallback(async () => {
    try {
      const result = await coreApi.openFolder();
      if (result && result.success && result.filePath) {
        processFiles(result.filePath);
      } else if (result?.error && !result?.canceled) {
        showToast(result.error, { type: 'error' });
      }
    } catch (e) {
      console.error('Open folder dialog error:', e);
    }
  }, [processFiles, showToast]);

  // مدیریت هاور سایدبارهای چپ و راست
  const handleLeftMouseEnter = useCallback(() => {
    // مرحله ۴۹ §۲: وسطِ ژستِ حاشیه‌نویسی، هات‌اسپات باز نمی‌شود.
    // خوانشِ مستقیمِ پرچم، ورودِ وسطِ درگ را هم می‌گیرد، حتی اگر
    // state هنوز همگام نشده باشد.
    if (typeof window !== 'undefined' && window.__isAnnotationGestureActive === true) return;
    cancelAutoZen();
    if (leftCloseTimerRef.current) {
      clearTimeout(leftCloseTimerRef.current);
      leftCloseTimerRef.current = null;
    }
    setIsLeftSidebarOpen(true);
  }, [cancelAutoZen, setIsLeftSidebarOpen]);

  const handleLeftMouseLeave = useCallback(() => {
    if (leftCloseTimerRef.current) clearTimeout(leftCloseTimerRef.current);
    leftCloseTimerRef.current = setTimeout(() => {
      if (!isLeftPinnedByClickRef.current) {
        setIsLeftSidebarOpen(false);
      }
    }, 520);
  }, [setIsLeftSidebarOpen]);

  const handleToggleLeftByButton = useCallback(
    (e) => {
      e.stopPropagation();
      if (leftCloseTimerRef.current) {
        clearTimeout(leftCloseTimerRef.current);
        leftCloseTimerRef.current = null;
      }
      const nextState = !useAppStore.getState().isLeftSidebarOpen;
      isLeftPinnedByClickRef.current = nextState;
      setIsLeftSidebarOpen(nextState);
    },
    [setIsLeftSidebarOpen]
  );

  const handleRightMouseEnter = useCallback(() => {
    // مرحله ۴۹ §۲: وسطِ ژستِ حاشیه‌نویسی، هات‌اسپات باز نمی‌شود.
    if (typeof window !== 'undefined' && window.__isAnnotationGestureActive === true) return;
    cancelAutoZen();
    if (rightCloseTimerRef.current) {
      clearTimeout(rightCloseTimerRef.current);
      rightCloseTimerRef.current = null;
    }
    setIsRightSidebarOpen(true);
  }, [cancelAutoZen, setIsRightSidebarOpen]);

  const handleRightMouseLeave = useCallback(() => {
    if (rightCloseTimerRef.current) clearTimeout(rightCloseTimerRef.current);
    if (isReadingModeRef.current) {
      rightCloseTimerRef.current = setTimeout(() => {
        if (!isRightPinnedByClickRef.current) {
          setIsRightSidebarOpen(false);
        }
      }, 520);
    }
  }, [setIsRightSidebarOpen]);

  const handleToggleRightByButton = useCallback(
    (e) => {
      e.stopPropagation();
      if (rightCloseTimerRef.current) {
        clearTimeout(rightCloseTimerRef.current);
        rightCloseTimerRef.current = null;
      }
      const nextState = !useAppStore.getState().isRightSidebarOpen;
      isRightPinnedByClickRef.current = nextState;
      setIsRightSidebarOpen(nextState);
    },
    [setIsRightSidebarOpen]
  );

  // مرحله ۴۹ §۲: همگام‌سازیِ پرچمِ ژست با تأخیرِ صفر — هندلرِ
  // کارگرِ A اول پرچم را می‌گذارد/پاک می‌کند، بعد این خوانش انجام
  // می‌شود (خوانشِ مستقیم در هندلر، مقدارِ کهنه را می‌خواند چون
  // ترتیبِ ثبتِ شنونده‌ها تضمین‌شده نیست). آخرین موقعیتِ نشانگر هم
  // برایِ حالتِ لبهٔ پایین ذخیره می‌شود.
  useEffect(() => {
    const recordPos = (e) => {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    };
    const scheduleSync = (e) => {
      recordPos(e);
      if (gestureSyncTimerRef.current) clearTimeout(gestureSyncTimerRef.current);
      gestureSyncTimerRef.current = setTimeout(syncAnnotationGestureFlag, 0);
    };
    window.addEventListener('pointerdown', scheduleSync, { passive: true });
    window.addEventListener('pointerup', scheduleSync, { passive: true });
    window.addEventListener('pointercancel', scheduleSync, { passive: true });
    window.addEventListener('mousemove', recordPos, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', scheduleSync);
      window.removeEventListener('pointerup', scheduleSync);
      window.removeEventListener('pointercancel', scheduleSync);
      window.removeEventListener('mousemove', recordPos);
      if (gestureSyncTimerRef.current) {
        clearTimeout(gestureSyncTimerRef.current);
        gestureSyncTimerRef.current = null;
      }
    };
  }, [syncAnnotationGestureFlag]);

  // مرحله ۴۹ §۲: اگر پرچم وقتی پاک شد که نشانگر از قبل داخلِ
  // هات‌اسپات بود، با برگشتنِ pointerEvents به auto هیچ mouseenter
  // تازه‌ای نمی‌آید؛ پس هات‌اسپاتِ زیرِ نشانگر را با آخرین موقعیتِ
  // ذخیره‌شده، صریح باز می‌کنیم.
  const prevGestureActiveRef = useRef(false);
  useEffect(() => {
    const wasActive = prevGestureActiveRef.current;
    prevGestureActiveRef.current = isAnnotationGestureActive;
    if (!wasActive || isAnnotationGestureActive) return;
    const pos = lastPointerPosRef.current;
    if (pos.x < 0) return;
    const leftRect = leftHotspotRef.current?.getBoundingClientRect();
    if (leftRect && pos.x >= leftRect.left && pos.x <= leftRect.right && pos.y >= leftRect.top && pos.y <= leftRect.bottom) {
      handleLeftMouseEnter();
      return;
    }
    if (!isReadingModeRef.current) return;
    const rightRect = rightHotspotRef.current?.getBoundingClientRect();
    if (rightRect && pos.x >= rightRect.left && pos.x <= rightRect.right && pos.y >= rightRect.top && pos.y <= rightRect.bottom) {
      handleRightMouseEnter();
    }
  }, [isAnnotationGestureActive, handleLeftMouseEnter, handleRightMouseEnter]);

  // مدیریت کشیدن و رها کردن فایل‌ها (Drag & Drop)
  useEffect(() => {
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (
        e.clientX <= 0 ||
        e.clientY <= 0 ||
        e.clientX >= window.innerWidth ||
        e.clientY >= window.innerHeight
      ) {
        if (isDraggingRef.current) {
          isDraggingRef.current = false;
          setIsDragging(false);
        }
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isDraggingRef.current = false;
      setIsDragging(false);

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const files = Array.from(e.dataTransfer.files)
          .map((file) => coreApi.getFilePath(file))
          .filter(Boolean);

        if (files.length > 0) processFiles(files);
      }
    };

    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragleave', handleDragLeave);

    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragleave', handleDragLeave);
    };
  }, [processFiles]);

  if (isLoading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingCard}>
          <div style={styles.spinnerBox}>
            <Icons.Loader size={38} />
          </div>

          <h2 style={styles.loadingTitle}>در حال آماده‌سازی و استخراج کمیک...</h2>

          {loadingFileName && (
            <div style={styles.loadingFileBadge} title={loadingFileName}>
              {loadingFileName}
            </div>
          )}

          <div style={styles.progressWrap}>
            <div style={styles.progressHeader}>
              <span style={styles.progressLabel}>پیشرفت پردازش</span>
              <span style={styles.progressPercent}>{loadingProgress}%</span>
            </div>
            <div style={styles.progressBarBg}>
              <div
                style={{
                  ...styles.progressBarFill,
                  transform: `scaleX(${Math.max(0, Math.min(100, loadingProgress)) / 100})`,
                }}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleCancelLoading}
            style={styles.cancelBtn}
            title="توقف بارگذاری فایل (Escape)"
          >
            <Icons.X size={15} />
            <span>لغو عملیات بارگذاری</span>
            <span style={styles.escBadge}>Esc</span>
          </button>
        </div>
      </div>
    );
  }

  const renderCenterContent = () => {
    if (isReadingMode) {
      return (
        <div style={styles.readerInnerBox}>
          {comicData.type === 'epub' ? (
            <EpubViewer filePath={resolveActiveBookKey(comicData, null)} />
          ) : comicData.type === 'pdf' ? (
            <PdfViewer filePath={resolveActiveBookKey(comicData, null)} />
          ) : (
            <VerticalViewer />
          )}
        </div>
      );
    }

    switch (currentView) {
      case 'library':
        return <LibraryView onOpenComic={processFiles} />;
      case 'recent':
        return <RecentView onOpenComic={processFiles} />;
      case 'bookmarks':
        return <BookmarksView onOpenComic={processFiles} />;
      case 'favorites':
        return <FavoritesView onOpenComic={processFiles} />;
      case 'downloads':
        return <DownloadsView />;
      case 'settings':
        return <SettingsView />;
      case 'profile':
        return <ProfileView />;
      case 'home':
      default:
        return (
          <HomeView
            onSelectFile={handleSelectFile}
            onSelectFolder={handleSelectFolder}
            onOpenComic={processFiles}
          />
        );
    }
  };

  return (
    <div
      style={{
        ...styles.appContainer,
        backgroundColor: isDragging ? '#141d23' : 'var(--bg)',
      }}
    >
      {/* تاپ‌بار سراسری با اتوهاید هوشمند، زوم باکسی و دکمه انحصاری استودیو ویرایش */}
      <TopBar
        onOpenClick={handleSelectFile}
        onOpenComic={processFiles}
        isReaderActive={isReadingMode}
      />

      <div style={styles.mainLayout}>
        {!isLeftSidebarOpen && (
          <div
            ref={leftHotspotRef}
            onMouseEnter={handleLeftMouseEnter}
            style={{
              ...styles.leftHotspot,
              pointerEvents: isAnnotationGestureActive ? 'none' : 'auto',
            }}
          />
        )}

        <div
          onMouseEnter={handleLeftMouseEnter}
          onMouseLeave={handleLeftMouseLeave}
          style={{
            ...styles.sidebarWrapper,
            pointerEvents: isLeftSidebarOpen ? 'auto' : 'none',
          }}
        >
          <Sidebar onMouseEnter={handleLeftMouseEnter} onMouseLeave={handleLeftMouseLeave} />
        </div>

        <main
          className="panel"
          style={{
            ...styles.centerReader,
            width: '100%',
            padding: isReadingMode ? '0' : '10px',
            backgroundColor: isReadingMode ? readerBackdropColor : 'var(--panel)',
          }}
        >
          <button
            type="button"
            onClick={handleToggleLeftByButton}
            style={{
              ...styles.circleHandleBase,
              left: isLeftSidebarOpen ? '236px' : '10px',
              transform: isLeftSidebarOpen
                ? 'translateY(-50%) rotate(180deg)'
                : 'translateY(-50%) rotate(0deg)',
              pointerEvents: isAnyModalActive ? 'none' : 'auto',
              opacity: isAnyModalActive ? 0 : 1,
            }}
            title={isLeftSidebarOpen ? 'بستن منو' : 'باز کردن منو'}
          >
            <div style={styles.iconCenterWrapper}>
              <Icons.ChevronRight size={18} />
            </div>
          </button>

          {/* مرحله ۳ ـ بخش الف: prop تکراریِ style (ممیزی §۲.۱۱) ادغام شد؛
              نسخهٔ اول مرده بود (pointerEvents/opacity نداشت) و نسخهٔ
              کاملِ دوم نگه داشته شد. */}
          {isReadingMode && (
            <button
              type="button"
              onClick={handleToggleRightByButton}
              style={{
                ...styles.circleHandleBase,
                right: isRightSidebarOpen ? '326px' : '10px',
                transform: isRightSidebarOpen
                  ? 'translateY(-50%) rotate(180deg)'
                  : 'translateY(-50%) rotate(0deg)',
                pointerEvents: isAnyModalActive ? 'none' : 'auto',
                opacity: isAnyModalActive ? 0 : 1,
              }}
              title={isRightSidebarOpen ? 'بستن پنل صفحات' : 'باز کردن پنل صفحات'}
            >
              <div style={styles.iconCenterWrapper}>
                <Icons.ChevronLeft size={18} />
              </div>
            </button>
          )}

          <ChunkErrorBoundary onReset={() => setCurrentView('home')}>
            <Suspense fallback={<div style={styles.centerLoadingFallback}><span style={styles.centerLoadingSpinner} aria-hidden="true" /><span>در حال بارگذاری…</span></div>}>
              {renderCenterContent()}
            </Suspense>
          </ChunkErrorBoundary>

          {isReadingMode && <BottomControls />}
        </main>

        {isReadingMode && (
          <div
            onMouseEnter={handleRightMouseEnter}
            onMouseLeave={handleRightMouseLeave}
            style={{
              ...styles.rightPanelWrapper,
              pointerEvents: isRightSidebarOpen ? 'auto' : 'none',
            }}
          >
            <RightPanel
              onLoadComic={processFiles}
              onOpenFolder={handleSelectFolder}
              onMouseEnter={handleRightMouseEnter}
              onMouseLeave={handleRightMouseLeave}
            />
          </div>
        )}

        {isReadingMode && !isRightSidebarOpen && (
          <div
            ref={rightHotspotRef}
            onMouseEnter={handleRightMouseEnter}
            style={{
              ...styles.rightHotspot,
              pointerEvents: isAnnotationGestureActive ? 'none' : 'auto',
            }}
          />
        )}
      </div>

      {isDragging && (
        <div style={styles.dragOverlay}>
          <div style={styles.dragDropModal}>
            <div style={styles.dragIconWrap}>
              <Icons.FolderOpen size={46} />
            </div>
            <h3 style={styles.dragTitle}>فایل کمیک را اینجا رها کنید</h3>
            <span style={styles.dragSub}>
              پشتیبانی از CBZ, ZIP, CBR, RAR, PDF و پوشه‌های عکس
            </span>
          </div>
        </div>
      )}

      <ContextMenu onOpenComic={processFiles} onOpenFile={handleSelectFile} />
      <ChunkErrorBoundary>
        <Suspense fallback={null}>
          <ScreenshotWidget />
          <SnippingOverlay />
          <AreaZoomOverlay />
          <QuickSettingsModal />
          <BookmarkStudioModal />
        </Suspense>
      </ChunkErrorBoundary>
      <ToastHUD />
    </div>
  );
}

const styles = {
  appContainer: {
    height: '100vh',
    width: '100vw',
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 16px 14px',
    gap: '8px',
    boxSizing: 'border-box',
    position: 'relative',
    overflow: 'hidden',
    userSelect: 'none',
  },
  mainLayout: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  centerReader: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
    isolation: 'isolate',
    zIndex: 1,
    borderRadius: 'var(--radius-lg)',
  },
  // مرحله ۳ ـ بخش الف: Fallback سبکِ Suspense برای محتوای مرکزی؛
  // با تمِ تاریک هماهنگ است و چون داخلِ main با flex:1 می‌نشیند،
  // پرشِ چیدمان ندارد.
  centerLoadingFallback: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    color: 'var(--muted)',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
  },
  // مرحلهٔ ۴۵ §۱: حلقهٔ چرخانِ سبک برای fallback مرکزی؛ انیمیشنِ آن
  // (cr-spin) در index.html تعریف شده تا پیش از لودِ جاوااسکریپت هم
  // در دسترس باشد و سوییچِ تب در ۰ میلی‌ثانیه بازخورد بدهد.
  centerLoadingSpinner: {
    width: '18px',
    height: '18px',
    flexShrink: 0,
    borderRadius: '50%',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'rgba(148, 163, 184, 0.25)',
    borderTopColor: '#22d3ee',
    animation: 'cr-spin 0.9s linear infinite',
  },
  // مرحله ۳ ـ بخش ب: Fallback مرزِ خطای چانک؛ fixed است تا از هر دو
  // جایِ مرز (مرکز و مودال‌ها) دیده شود، وگرنه در جایگاهِ مودال‌ها
  // زیرِ main با overflow:hidden نامرئی می‌ماند.
  chunkErrorOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 15, 19, 0.96)',
    padding: '16px',
  },
  chunkErrorCard: {
    maxWidth: '420px',
    width: '100%',
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: '16px',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    textAlign: 'center',
  },
  chunkErrorTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '15px',
    fontWeight: 800,
    color: 'var(--text)',
  },
  chunkErrorText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
    lineHeight: 2,
  },
  chunkErrorButton: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 700,
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    border: 'none',
    borderRadius: '10px',
    padding: '8px 22px',
    cursor: 'pointer',
    outline: 'none',
  },
  sidebarWrapper: {
    display: 'flex',
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 42,
  },
  rightPanelWrapper: {
    display: 'flex',
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 42,
    flexShrink: 0,
  },
  leftHotspot: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '12px',
    zIndex: 38,
  },
  rightHotspot: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: '12px',
    zIndex: 38,
  },
  circleHandleBase: {
    position: 'absolute',
    top: '50%',
    width: '38px',
    height: '38px',
    borderRadius: '50%',
    backgroundColor: 'var(--panel2)',
    borderWidth: '2px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    zIndex: 46,
    boxShadow: '0 4px 14px rgba(0,0,0,0.55)',
    transition:
      'left 0.3s cubic-bezier(0.16, 1, 0.3, 1), right 0.3s cubic-bezier(0.16, 1, 0.3, 1), transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease',
    outline: 'none',
    padding: 0,
  },
  iconCenterWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  readerInnerBox: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  loadingContainer: {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    height: '100vh',
    width: '100vw',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    direction: 'rtl',
    userSelect: 'none',
  },
  loadingCard: {
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: '20px',
    padding: '32px 36px',
    width: '380px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    boxShadow: '0 20px 50px rgba(0, 0, 0, 0.65)',
  },
  spinnerBox: {
    width: '64px',
    height: '64px',
    borderRadius: '18px',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.3)',
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingTitle: {
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '16px',
    color: 'var(--text)',
    margin: 0,
  },
  loadingFileBadge: {
    fontFamily: 'var(--font-latin)',
    fontWeight: 700,
    fontSize: '12.5px',
    color: 'var(--muted)',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    padding: '4px 12px',
    borderRadius: '8px',
    maxWidth: '100%',
    direction: 'ltr',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  progressWrap: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  progressHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 500,
    color: 'var(--muted)',
  },
  progressPercent: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11.5px',
    fontWeight: 700,
    color: 'var(--accent)',
    direction: 'ltr',
  },
  progressBarBg: {
    width: '100%',
    height: '6px',
    backgroundColor: 'var(--panel2)',
    borderRadius: '4px',
    overflow: 'hidden',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    position: 'relative',
  },
  progressBarFill: {
    height: '100%',
    width: '100%',
    transformOrigin: 'left center',
    backgroundColor: 'var(--accent)',
    boxShadow: '0 0 10px var(--accent)',
    transition: 'transform 0.15s ease-out',
  },
  cancelBtn: {
    marginTop: '6px',
    width: '100%',
    padding: '10px 16px',
    borderRadius: '12px',
    backgroundColor: 'rgba(248, 81, 73, 0.12)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(248, 81, 73, 0.35)',
    color: 'var(--danger)',
    fontFamily: 'var(--font-fa)',
    fontWeight: 700,
    fontSize: '13px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
    outline: 'none',
  },
  escBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    fontWeight: 600,
    backgroundColor: 'rgba(248, 81, 73, 0.18)',
    padding: '2px 6px',
    borderRadius: '5px',
    direction: 'ltr',
  },
  dragOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(10, 15, 19, 0.82)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    zIndex: 9999,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  dragDropModal: {
    padding: '36px 48px',
    borderRadius: '24px',
    backgroundColor: 'var(--panel)',
    borderWidth: '2px',
    borderStyle: 'dashed',
    borderColor: 'var(--accent)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.75)',
  },
  dragIconWrap: {
    color: 'var(--accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dragTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '18px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  dragSub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
    margin: 0,
  },
};