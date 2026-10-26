import { create } from 'zustand';
import { coreApi } from '../services/coreApi';

let saveZoomTimer = null;
let saveGapTimer = null;

const MIN_ZOOM = 0.4;
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

const useReaderStore = create((set, get) => ({
  comicData: null,
  currentPage: 1,
  targetPage: null,
  zoomLevel: getInitialZoom(),
  preAreaZoomLevel: null,
  areaZoomTarget: null, // { id, targetZoom, normCenterX, normCenterY, rect }
  hiDpiRenderTick: 0,
  comicPageGap: getInitialComicGap(),
  pdfPageGap: getInitialPdfGap(),
  rotation: 0,
  isLoading: false,
  loadingProgress: 0,

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

  setComicData: (data) => {
    if (!data) {
      set({
        comicData: null,
        currentPage: 1,
        targetPage: null,
        preAreaZoomLevel: null,
        areaZoomTarget: null,
        rotation: 0,
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

    set({
      comicData: data,
      currentPage: resumePage,
      targetPage: null,
      preAreaZoomLevel: null,
      areaZoomTarget: null,
      rotation: 0,
    });
  },

  setCurrentPage: (page) => {
    const validPage = typeof page === 'number' && page > 0 ? page : 1;
    if (get().currentPage === validPage) return;
    set({ currentPage: validPage });
  },

  setTargetPage: (pageNumber) => set({ targetPage: pageNumber }),

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

    if (saveGapTimer) clearTimeout(saveGapTimer);
    saveGapTimer = setTimeout(() => {
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
      saveGapTimer = null;
    }, 300);
  },

  setPdfPageGap: (gap) => {
    const clamped = Math.max(0, Math.min(48, Math.round(Number(gap) || 0)));
    if (get().pdfPageGap === clamped) return;

    set({ pdfPageGap: clamped });

    if (saveGapTimer) clearTimeout(saveGapTimer);
    saveGapTimer = setTimeout(() => {
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
      saveGapTimer = null;
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
            payload: { key: 'defaultZoom', value: Math.min(2.5, clamped) },
          })
          .catch(() => {});
      }
      saveZoomTimer = null;
    }, 350);
  },

  // اعمال زوم ناحیه‌ای با کشیدن باکس و ثبت مختصات مرکز باکس
  applyAreaZoom: ({ targetZoom, normCenterX = 0.5, normCenterY = 0.5, rect = null }) => {
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

    set((state) => ({
      preAreaZoomLevel: savedPreZoom,
      zoomLevel: clampedTarget,
      areaZoomTarget: {
        id: Date.now(),
        targetZoom: clampedTarget,
         prevZoom: currentZoom,
        normCenterX,
        normCenterY,
        rect,
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

  zoomIn: () => {
    const current = get().zoomLevel;
    get().setZoomLevel(current + 0.12);
  },

  zoomOut: () => {
    const current = get().zoomLevel;
    get().setZoomLevel(current - 0.12);
  },

  resetZoom: async () => {
    let target = 1.0;
    try {
      if (coreApi.isAvailable()) {
        const res = await coreApi.dbAction({ action: 'GET_SETTINGS' });
        if (res?.settings?.defaultZoom) {
          const parsed = parseFloat(res.settings.defaultZoom);
          if (!isNaN(parsed) && parsed >= MIN_ZOOM && parsed <= 2.5) {
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

  setIsLoading: (status) => set({ isLoading: Boolean(status) }),
  setLoadingProgress: (progress) =>
    set({ loadingProgress: typeof progress === 'number' ? progress : 0 }),

  closeComic: () => {
    if (saveZoomTimer) {
      clearTimeout(saveZoomTimer);
      saveZoomTimer = null;
    }
    if (saveGapTimer) {
      clearTimeout(saveGapTimer);
      saveGapTimer = null;
    }
    set({
      comicData: null,
      currentPage: 1,
      targetPage: null,
      preAreaZoomLevel: null,
      areaZoomTarget: null,
      rotation: 0,
    });
  },
}));

export default useReaderStore;