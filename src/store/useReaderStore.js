import { create } from 'zustand';
import { coreApi } from '../services/coreApi';
import useSettingsStore from './useSettingsStore';

let saveZoomTimer = null;
let saveComicGapTimer = null;
let savePdfGapTimer = null;

// Minimum zoom lowered from 40% to 10% (0.1) per user requirement
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3.5;

const getInitialZoom = () => {
  try {
    const cached = localStorage.getItem('comic_reader_zoom_level');
    if (cached) {
      const val = parseFloat(cached);
      if (!isNaN(val) && val >= MIN_ZOOM && val <= MAX_ZOOM) {
        return Number(val.toFixed(2));
      }
    }
  } catch (_) {}
  return 1.0;
};

const getInitialComicGap = () => {
  try {
    const cached = localStorage.getItem('comic_reader_comic_gap');
    if (cached !== null && cached !== undefined) {
      const val = parseInt(cached, 10);
      if (!isNaN(val) && val >= 0 && val <= 48) {
        return val;
      }
    }
  } catch (_) {}
  return 0;
};

const getInitialPdfGap = () => {
  try {
    const cached = localStorage.getItem('comic_reader_pdf_gap');
    if (cached !== null && cached !== undefined) {
      const val = parseInt(cached, 10);
      if (!isNaN(val) && val >= 0 && val <= 48) {
        return val;
      }
    }
  } catch (_) {}
  return 12;
};

const normalizeStorePath = (p) => {
  if (!p || typeof p !== 'string') return '';
  return p.trim().replace(/[\\/]+/g, '\\').toLowerCase();
};

// مرحلهٔ ۴۱ §۱: کلیدِ پایدارِ فصلِ EPUB برایِ مقایسهٔ فهرست‌ها
// (فصل‌ها شکلِ { id, title } دارند و عنوان در پنلِ راست نمایش داده
// می‌شود؛ پس کلید، id و title را با هم می‌سنجد تا عنوانِ عوض‌شده
// هم به‌روز شود؛ id اگر نبود، title وگرنه ایندکس).
const epubChapterKey = (chapter, index) => {
  if (chapter && typeof chapter === 'object') {
    if (chapter.id !== undefined && chapter.id !== null && chapter.id !== '') return `id:${chapter.id}|title:${typeof chapter.title === 'string' ? chapter.title : ''}`;
    if (typeof chapter.title === 'string' && chapter.title) return `title:${chapter.title}`;
  }
  return `index:${index}`;
};
const sameEpubChapters = (prev, next) => {
  if (prev === next) return true;
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false;
  return next.every((chapter, index) => epubChapterKey(chapter, index) === epubChapterKey(prev[index], index));
};

const useReaderStore = create((set, get) => ({
  comicData: null,
  currentPage: 1,
  targetPage: null,
  // مرحلهٔ ۴۲: شمارِ کلِ صفحه‌هایِ EPUBِ جاری (قرارداد با EpubViewer؛ با عوض‌شدنِ فایل صفر می‌شود).
  totalPages: 0,
  zoomLevel: getInitialZoom(),
  preAreaZoomLevel: null,
  areaZoomTarget: null, // { id, targetZoom, pageNumber, pageRatioX, pageRatioY, normCenterX, normCenterY, rect, timestamp }
  hiDpiRenderTick: 0,
  deepRefreshTick: 0, // مرحلهٔ ۳۰ — نسلِ اجباریِ دیپ پس از ذخیرهٔ درجا
  detailRenderTick: 0, // مرحله ۲۴ — نسلِ رندرِ تایلِ جزئیات (هر اسکرول، حتی برنامه‌ای)
  comicPageGap: getInitialComicGap(),
  pdfPageGap: getInitialPdfGap(),
  rotation: 0,
  isLoading: false,
  loadingProgress: 0,
  pdfSearchOpen: false,
  pdfSearchQuery: '',
  pdfSearchRequestId: 0,
  pdfOutline: [],
  pdfOutlineFile: '',
  pdfOutlineStatus: 'idle',
  // مرحلهٔ ۳۵ §۲: فهرستِ فصل‌هایِ EPUBِ جاری (برای پنلِ راست).
  epubChapters: [],
  // مرحلهٔ ۴۰ §۴: حالتِ نمایشِ کمیک — عمودی (طوماری) یا افقیِ صفحه‌ای
  // (مخصوصِ CBZ/مانگایِ landscape).
  comicViewMode: 'vertical',
  // مرحلهٔ ۴۱ §۱: حالتِ نمایشِ EPUB — عمودی (طوماری) یا افقیِ صفحه‌ای.
  epubViewMode: 'vertical',
  // مرحلهٔ ۴۰ §۵: سیگنالِ جستجویِ EPUB از TopBar (آینهٔ PDF).
  epubSearchRequestId: 0,
  epubSearchQuery: '',

  initZoomSettings: async () => {
    try {
      if (coreApi.isAvailable()) {
        const res = await coreApi.dbAction({ action: 'GET_SETTINGS' });
        const settings = res?.settings || {};
        const updates = {};

        if (settings.defaultZoom !== undefined) {
          const savedZoom = parseFloat(settings.defaultZoom);
          if (!isNaN(savedZoom) && savedZoom >= MIN_ZOOM && savedZoom <= MAX_ZOOM) {
            const formatted = Number(savedZoom.toFixed(2));
            updates.zoomLevel = formatted;
            try {
              localStorage.setItem('comic_reader_zoom_level', String(formatted));
            } catch (_) {}
          }
        }

        if (settings.comicPageGap !== undefined) {
          const cGap = parseInt(settings.comicPageGap, 10);
          if (!isNaN(cGap) && cGap >= 0 && cGap <= 48) {
            updates.comicPageGap = cGap;
            try {
              localStorage.setItem('comic_reader_comic_gap', String(cGap));
            } catch (_) {}
          }
        }

        if (settings.pdfPageGap !== undefined) {
          const pGap = parseInt(settings.pdfPageGap, 10);
          if (!isNaN(pGap) && pGap >= 0 && pGap <= 48) {
            updates.pdfPageGap = pGap;
            try {
              localStorage.setItem('comic_reader_pdf_gap', String(pGap));
            } catch (_) {}
          }
        }

        if (Object.keys(updates).length > 0) {
          set(updates);
        }
      }
    } catch (err) {
      console.error('Error fetching reader settings:', err);
    }
  },

  // مرحلهٔ ۴۱ §۱: گاردِ حلقهٔ بی‌نهایتِ EPUB — اگر فهرستِ تازه با
  // فهرستِ جاری (طول و کلیدِ پایدارِ هر فصل) برابر بود، اصلاً set
  // نمی‌زنیم تا افکتِ [filePath, setEpubChapters] در EpubViewer
  // با آرایهٔ تازه‌ساخته‌شدهٔ هم‌مقدار، دوباره شلیک نشود.
  setEpubChapters: (chapters) => {
    const next = Array.isArray(chapters) ? chapters : [];
    if (sameEpubChapters(get().epubChapters, next)) return;
    set({ epubChapters: next });
  },

  setComicData: (data) => {
    if (!data) {
      set({
        comicData: null,
        currentPage: 1,
        targetPage: null,
        totalPages: 0,
        preAreaZoomLevel: null,
        areaZoomTarget: null,
        rotation: 0,
        pdfSearchOpen: false,
        pdfSearchQuery: '',
        pdfSearchRequestId: 0,
        pdfOutline: [],
        pdfOutlineFile: '',
        pdfOutlineStatus: 'idle',
        epubChapters: [],
        comicViewMode: 'vertical',
        epubViewMode: 'vertical',
        epubSearchRequestId: 0,
        epubSearchQuery: '',
      });
      return;
    }

    const prevComic = get().comicData;
    const prevNorm = normalizeStorePath(prevComic?.filePath || prevComic?.path);
    const nextNorm = normalizeStorePath(data?.filePath || data?.path);
    const isSameFile = Boolean(prevNorm && nextNorm && prevNorm === nextNorm);

    if (isSameFile) {
      set({ comicData: data });
      return;
    }

    const resumePage =
      typeof data.savedResumePage === 'number' && data.savedResumePage > 1
        ? data.savedResumePage
        : 1;

    // مرحلهٔ ۴۰ §۴ (از مرحلهٔ ۴۱ §۳: از تنظیمات خوانده می‌شود):
    // فایلِ .cbz با زوم و حالتِ پیش‌فرضِ CBZ باز می‌شود؛ بقیهٔ
    // فایل‌ها، عمودی می‌مانند.
    const openedPath = data?.filePath || data?.path || '';
    const isCbzFile = typeof openedPath === 'string' && /\.cbz$/i.test(openedPath);
    const isEpubFile = typeof openedPath === 'string' && /\.epub$/i.test(openedPath);
    // مرحلهٔ ۴۱ §۳: تنظیماتِ وابسته به فرمت، خودکار اعمال می‌شود —
    // فایلِ .cbz با زوم و حالتِ پیش‌فرضِ CBZ، فایلِ .epub با زوم و
    // حالتِ پیش‌فرضِ EPUB (زومِ EPUB همان zoomLevel است؛ EpubViewer
    // هم از همین فیلد می‌خواند و فیلدِ جدایِ زومِ EPUB ندارد).
    // پیش‌فرض‌هایِ تنظیمات (۱۶۵٪ / افقی برایِ CBZ) همان رفتارِ
    // مرحلهٔ ۴۰ است، پس تا وقتی کاربر چیزی عوض نکرده، هیچ چیز
    // عوض نمی‌شود؛ PDF و بقیهٔ فرمت‌ها دقیقاً مثلِ قبل‌اند.
    const formatSettings = useSettingsStore.getState();
    const cbzZoom = Math.min(3.5, Math.max(0.1, (Number(formatSettings.cbzDefaultZoom) || 165) / 100));
    const cbzMode = formatSettings.cbzDefaultViewMode === 'vertical' ? 'vertical' : 'horizontal-paged';
    const epubZoom = Math.min(3.5, Math.max(0.1, (Number(formatSettings.epubDefaultZoom) || 100) / 100));
    const epubMode = formatSettings.epubDefaultViewMode === 'horizontal-paged' ? 'horizontal-paged' : 'vertical';

    set({
      comicData: data,
      currentPage: resumePage,
      targetPage: null,
      totalPages: 0,
      preAreaZoomLevel: null,
      areaZoomTarget: null,
      rotation: 0,
      pdfOutline: [],
      pdfOutlineFile: '',
      pdfOutlineStatus: 'idle',
      epubChapters: [],
      comicViewMode: isCbzFile ? cbzMode : 'vertical',
      epubViewMode: isEpubFile ? epubMode : 'vertical',
      ...(isCbzFile ? { zoomLevel: cbzZoom } : {}),
      ...(isEpubFile ? { zoomLevel: epubZoom } : {}),
      epubSearchRequestId: 0,
      epubSearchQuery: '',
    });
  },

  setCurrentPage: (page) => {
    const validPage = typeof page === 'number' && page > 0 ? page : 1;
    if (get().currentPage === validPage) return;
    set({ currentPage: validPage });
  },

  setTargetPage: (pageNumber) => set({ targetPage: pageNumber }),

  // مرحلهٔ ۴۲: ثبتِ شمارِ کلِ صفحه‌ها از EpubViewer (فقط عددِ صحیحِ مثبت؛ بقیه صفر).
  setTotalPages: (n) => { const v = Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0; if (get().totalPages === v) return; set({ totalPages: v }); },

  // مرحله ۶ ـ بخش الف: فهرستِ PDF (Outline). فقط برای سندِ جاری
  // معتبر است؛ با عوض‌شدنِ فایل، در setComicData پاک می‌شود.
  setPdfOutline: (items, filePath, status = 'done') => {
    set({
      pdfOutline: Array.isArray(items) ? items : [],
      pdfOutlineFile: typeof filePath === 'string' ? filePath : '',
      pdfOutlineStatus: status,
    });
  },

  clearPdfOutline: () => set({ pdfOutline: [], pdfOutlineFile: '', pdfOutlineStatus: 'idle' }),

  jumpToPage: (pageNumber) => {
    const valid = typeof pageNumber === 'number' &&  pageNumber  > 0 ? pageNumber : 1;
    set({ targetPage: valid, currentPage: valid });
  },

  clearTargetPage: () => set({ targetPage: null }),

  // مدیریت فاصله صفحات
  setComicPageGap: (gap) => {
    const clamped = Math.max(0, Math.min(48, Math.round(Number(gap) || 0)));
    if (get().comicPageGap === clamped) return;

    set({ comicPageGap: clamped });

    if (saveComicGapTimer) clearTimeout(saveComicGapTimer);
    saveComicGapTimer = setTimeout(() => {
      try {
        localStorage.setItem('comic_reader_comic_gap', String(clamped));
      } catch (_) {}
      if (coreApi.isAvailable()) {
        coreApi
          .dbAction({
            action: 'SAVE_SETTING',
            payload: { key: 'comicPageGap', value: clamped },
          })
          .catch(() => {});
      }
      saveComicGapTimer = null;
    }, 300);
  },

  setPdfPageGap: (gap) => {
    const clamped = Math.max(0, Math.min(48, Math.round(Number(gap) || 0)));
    if (get().pdfPageGap === clamped) return;

    set({ pdfPageGap: clamped });

    if (savePdfGapTimer) clearTimeout(savePdfGapTimer);
    savePdfGapTimer = setTimeout(() => {
      try {
        localStorage.setItem('comic_reader_pdf_gap', String(clamped));
      } catch (_) {}
      if (coreApi.isAvailable()) {
        coreApi
          .dbAction({
            action: 'SAVE_SETTING',
            payload: { key: 'pdfPageGap', value: clamped },
          })
          .catch(() => {});
      }
      savePdfGapTimer = null;
    }, 300);
  },

  setActivePageGap: (gap) => {
    if (get().comicData?.type === 'pdf') {
      get().setPdfPageGap(gap);
    } else {
      get().setComicPageGap(gap);
    }
  },

  resetActivePageGap: () => {
    if (get().comicData?.type === 'pdf') {
      get().setPdfPageGap(12);
    } else {
      get().setComicPageGap(0);
    }
  },

  // مدیریت زوم استاندارد، زوم باکسی و ری‌رندر باکیفیت (HiDPI)
  triggerHiDpiRender: () =>
    set((state) => ({ hiDpiRenderTick: (state.hiDpiRenderTick + 1) % 100000 })),

  // مرحلهٔ ۳۰ — پس از ذخیرهٔ درجا، دیپِ صفحه‌هایِ نزدیک، با همان
    // زوم هم از نو رندر می‌شود (امضایِ قبلی در آیتم پاک می‌شود).
  requestDeepRefresh: () =>
    set((state) => ({ deepRefreshTick: (state.deepRefreshTick + 1) % 100000 })),

  // مرحله ۲۴ — شلیکِ رندرِ تایلِ جزئیات پس از توقفِ اسکرول.
  triggerDetailRender: () =>
    set((state) => ({ detailRenderTick: (state.detailRenderTick + 1) % 100000 })),

  setZoomLevel: (zoom, options = {}) => {
    // مرحله ۳ ـ بخش الف (ممیزی §۲.۵): محافظِ NaN. بدونِ این نگهبان،
    // ورودیِ نامعتبر از Math.min/Max به‌صورتِ NaN بیرون می‌آمد و کلِ
    // محاسباتِ ابعادِ صفحه را NaN می‌کرد. مقادیرِ نامتناهی هم نامعتبرند.
    const numericZoom = Number(zoom);
    if (!Number.isFinite(numericZoom)) return;
    const clamped = Math.max(MIN_ZOOM, Math.min(Number(Number(zoom).toFixed(2)), MAX_ZOOM));
    if (Math.abs(get().zoomLevel - clamped) < 0.005 && !options.force) return;

    set((state) => ({
      zoomLevel: clamped,
      ...(options.clearPreZoom ? { preAreaZoomLevel: null, areaZoomTarget: null } : {}),
      hiDpiRenderTick: (state.hiDpiRenderTick + 1) % 100000,
    }));

    if (saveZoomTimer) clearTimeout(saveZoomTimer);
    saveZoomTimer = setTimeout(() => {
      try {
        localStorage.setItem('comic_reader_zoom_level', String(clamped));
      } catch (_) {}

      if (coreApi.isAvailable()) {
        coreApi
          .dbAction({
            action: 'SAVE_SETTING',
            payload: { key: 'defaultZoom', value: Math.min(3.5, clamped) },
          })
          .catch(() => {});
      }
      saveZoomTimer = null;
    }, 350);
  },

  // اعمال زوم ناحیه‌ای با کشیدن باکس و ثبت مختصات مرکز باکس
  applyAreaZoom: ({ targetZoom, pageNumber = null, pageRatioX = null, pageRatioY = null, normCenterX = 0.5, normCenterY = 0.5, rect = null }) => {
    // مرحله ۳ ـ بخش الف (ممیزی §۲.۵): همان محافظِ NaN برای مسیرِ زومِ
    // ناحیه‌ای؛ وگرنه targetZoom نامعتبر هم zoomLevel و هم
    // areaZoomTarget.targetZoom را NaN می‌کرد.
    const numericZoom = Number(targetZoom);
    if (!Number.isFinite(numericZoom)) return;
    const currentZoom = get().zoomLevel || 1.0;
    const savedPreZoom = get().preAreaZoomLevel ?? currentZoom;
    const clampedTarget = Math.max(
      MIN_ZOOM,
      Math.min(Number(Number(targetZoom).toFixed(2)), MAX_ZOOM)
    );

    // مرحله ۲۴ — فیلدهایِ درجه‌اول: اگر فراخواننده، pageNumber و
    // نسبت‌ها را صراحتاً نداد (فراخواننده‌هایِ قدیمی)، از rect
    // خوانده می‌شوند تا رفتارِ قبلی حفظ شود. timestamp، نسلِ هدف
    // را یکتا می‌کند.
    const resolvedPageNumber = pageNumber ?? rect?.pageNumber ?? null;
    const resolvedRatioX = pageRatioX ?? rect?.pageRatioX ?? normCenterX;
    const resolvedRatioY = pageRatioY ?? rect?.pageRelativeY ?? normCenterY;
    set((state) => ({
      preAreaZoomLevel: savedPreZoom,
      zoomLevel: clampedTarget,
      areaZoomTarget: {
        id: Date.now(),
        targetZoom: clampedTarget,
        prevZoom: currentZoom,
        pageNumber: resolvedPageNumber,
        pageRatioX: resolvedRatioX,
        pageRatioY: resolvedRatioY,
        normCenterX,
        normCenterY,
        rect,
        timestamp: Date.now(),
      },
      hiDpiRenderTick: (state.hiDpiRenderTick + 1) % 100000,
    }));
  },

  clearAreaZoomTarget: () => set({ areaZoomTarget: null }),

  restorePreAreaZoom: () => {
    const prev = get().preAreaZoomLevel || 1.0;
    set((state) => ({
      zoomLevel: prev,
      preAreaZoomLevel: null,
      areaZoomTarget: null,
      hiDpiRenderTick: (state.hiDpiRenderTick + 1) % 100000,
    }));
  },

  // Minimum zoom lowered from 40% to 10% (0.1) per user requirement
  zoomIn: () => {
    const current = get().zoomLevel;
    const step = current < 0.5 ? 0.1 : 0.12;
    get().setZoomLevel(current + step);
  },

  zoomOut: () => {
    const current = get().zoomLevel;
    const step = current < 0.5 ? 0.1 : 0.12;
    get().setZoomLevel(current - step);
  },

  resetZoom: async () => {
    let target = 1.0;
    try {
      if (coreApi.isAvailable()) {
        const res = await coreApi.dbAction({ action: 'GET_SETTINGS' });
        if (res?.settings?.defaultZoom) {
          const parsed = parseFloat(res.settings.defaultZoom);
          if (!isNaN(parsed) && parsed >= MIN_ZOOM && parsed <= MAX_ZOOM) {
            target = parsed;
          }
        }
      }
    } catch (_) {}
    get().setZoomLevel(target, { clearPreZoom: true, force: true });
  },

  rotateClockwise: () => set((state) => ({ rotation: (state.rotation + 90) % 360 })),
  rotateCounterClockwise: () => set((state) => ({ rotation: (state.rotation + 270) % 360 })),
  resetRotation: () => set({ rotation: 0 }),

  // مرحله ۴ ـ بخش ب: باز بودنِ نوارِ جستجوی PDF، برای هماهنگیِ Escape
  // (useKeyboard باید آن را ببیند). با بستنِ کمیک در closeComic (و
  // با null شدنِ comicData در setComicData) صفر می‌شود؛ با عوض شدنِ
  // فایل، افکتِ [filePath] در PdfViewer آن را خاموش می‌کند.
  setPdfSearchOpen: (open) => set({ pdfSearchOpen: Boolean(open) }),

  // مرحله ۹: آغازِ جستجو در PDFِ فعلی از هر کامپوننتی (TopBar،
  // ContextMenu). pdfSearchRequestId، شناسهٔ یکتای هر درخواست است
  // تا همان عبارتِ قبلی هم دوباره اجرا شود؛ PdfViewer با دیدنِ
  // شناسهٔ تازه، نوار را باز می‌کند، عبارت را می‌گذارد و فوکوس
  // می‌کند. عبارتِ خالی = فقط باز کردنِ نوار و فوکوس.
  triggerPdfSearch: (query) =>
    set((state) => ({
      pdfSearchOpen: true,
      pdfSearchQuery: typeof query === 'string' ? query : '',
      pdfSearchRequestId: (state.pdfSearchRequestId || 0) + 1,
    })),

  // مرحلهٔ ۴۰ §۴: سوییچِ حالتِ نمایشِ کمیک (عمودی/افقیِ صفحه‌ای).
  setComicViewMode: (mode) =>
    set({ comicViewMode: mode === 'horizontal-paged' ? 'horizontal-paged' : 'vertical' }),

  // مرحلهٔ ۴۱ §۱: سوییچِ حالتِ نمایشِ EPUB (عمودی/افقیِ صفحه‌ای).
  setEpubViewMode: (mode) =>
    set({ epubViewMode: mode === 'horizontal-paged' ? 'horizontal-paged' : 'vertical' }),

  // مرحلهٔ ۴۰ §۵: آغازِ جستجو در EPUBِ فعلی از TopBar (آینهٔ PDF).
  triggerEpubSearch: (query) =>
    set((state) => ({
      epubSearchQuery: typeof query === 'string' ? query : '',
      epubSearchRequestId: (state.epubSearchRequestId || 0) + 1,
    })),

  setIsLoading: (status) => set({ isLoading: Boolean(status) }),
  setLoadingProgress: (progress) =>
    set({ loadingProgress: typeof progress === 'number' ? progress : 0 }),

  closeComic: () => {
    // مرحلهٔ ۴۲: مقدارهایِ در انتظارِ ذخیره (زوم و گپ‌ها) پیش از
    // بستن، فوراً نوشته می‌شوند تا با clearTimeout گم نشوند.
    if (saveZoomTimer) {
      try {
        localStorage.setItem('comic_reader_zoom_level', String(get().zoomLevel));
      } catch (_) {}
      if (coreApi.isAvailable()) {
        coreApi
          .dbAction({
            action: 'SAVE_SETTING',
            payload: { key: 'defaultZoom', value: Math.min(3.5, get().zoomLevel) },
          })
          .catch(() => {});
      }
    }
    if (saveComicGapTimer) {
      try {
        localStorage.setItem('comic_reader_comic_gap', String(get().comicPageGap));
      } catch (_) {}
      if (coreApi.isAvailable()) {
        coreApi
          .dbAction({
            action: 'SAVE_SETTING',
            payload: { key: 'comicPageGap', value: get().comicPageGap },
          })
          .catch(() => {});
      }
    }
    if (savePdfGapTimer) {
      try {
        localStorage.setItem('comic_reader_pdf_gap', String(get().pdfPageGap));
      } catch (_) {}
      if (coreApi.isAvailable()) {
        coreApi
          .dbAction({
            action: 'SAVE_SETTING',
            payload: { key: 'pdfPageGap', value: get().pdfPageGap },
          })
          .catch(() => {});
      }
    }
    if (saveZoomTimer) {
      clearTimeout(saveZoomTimer);
      saveZoomTimer = null;
    }
    if (saveComicGapTimer) {
      clearTimeout(saveComicGapTimer);
      saveComicGapTimer = null;
    }
    if (savePdfGapTimer) {
      clearTimeout(savePdfGapTimer);
      savePdfGapTimer = null;
    }
    set({
      comicData: null,
      currentPage: 1,
      targetPage: null,
      totalPages: 0,
      preAreaZoomLevel: null,
      areaZoomTarget: null,
      rotation: 0,
      pdfSearchOpen: false,
      pdfSearchQuery: '',
      pdfSearchRequestId: 0,
      comicViewMode: 'vertical',
      epubViewMode: 'vertical',
      epubSearchRequestId: 0,
      epubSearchQuery: '',
    });
  },
}));

export default useReaderStore;