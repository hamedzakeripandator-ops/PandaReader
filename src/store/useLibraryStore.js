import { create } from 'zustand';
import { coreApi } from '../services/coreApi';

const STORAGE_KEYS = {
  LIBRARY: 'comic_reader_library_v4',
  FOLDERS: 'comic_reader_folders_v4',
  FAVORITES: 'comic_reader_favorites_v4',
  RECENTS: 'comic_reader_recents_v4',
  DOWNLOADS: 'comic_reader_downloads_v4',
  DOWNLOADS_DIR: 'comic_reader_downloads_dir_v4',
};

// متغیرهای مدیریت تایمر دی‌بانس و ذخیره اضطراری پیشرفت مطالعه
let progressDebounceTimer = null;
let pendingProgressPayload = null;

// استانداردسازی مسیر فایل برای سیستم‌عامل‌های مختلف
const normalizePath = (p) => {
  if (!p || typeof p !== 'string') return '';
  return p.trim().replace(/[\\/]+/g, '\\').toLowerCase();
};

// فیلتر اصالت کاور جهت مسدودسازی فایل‌های موقت
const isPermanentCover = (str) => {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (
    s.startsWith('data:image/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('blob:') ||
    // مرحله ۲ ـ بخش الف: مرجعِ کاورِ روی دیسک هم دائمی است.
    s.startsWith('comic://')
  ) {
    return true;
  }
  if (
    s.includes('ComicReaderCache') ||
    s.includes('Temp') ||
    s.includes('AppData') ||
    s.startsWith('file:')
  ) {
    return false;
  }
  return false;
};

// مرتب‌سازی هوشمند کتابخانه: آیتم‌های پین‌شده همیشه در صدر قرار می‌گیرند
const sortLibraryItems = (list) => {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const aPinned = a?.isPinned ? 1 : 0;
    const bPinned = b?.isPinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    if (aPinned && bPinned) {
      const pA = a?.pinnedAt || '';
      const pB = b?.pinnedAt || '';
      if (pA !== pB) return pB.localeCompare(pA);
    }
    const addA = a?.addedAt || '';
    const addB = b?.addedAt || '';
    return addB.localeCompare(addA);
  });
};

// خواندن ایمن از لوکال‌استوریج
const readLocal = (key, fallback = []) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
};

// نگارش ایمن در لوکال‌استوریج بدون Base64 جهت جلوگیری از قفل شدن ترد اصلی
const writeLocal = (key, data) => {
  try {
    const lightweightData = Array.isArray(data)
      ? data.map(({ cover, ...rest }) => rest)
      : data;

    localStorage.setItem(key, JSON.stringify(lightweightData));
  } catch (e) {
    console.warn('LocalStorage quota or write warning:', e?.message);
  }
};

const useLibraryStore = create((set, get) => ({
  library: sortLibraryItems(readLocal(STORAGE_KEYS.LIBRARY, [])),
  libraryItems: sortLibraryItems(readLocal(STORAGE_KEYS.LIBRARY, [])),
  libraryFolders: readLocal(STORAGE_KEYS.FOLDERS, []),
  activeFolderId: 'ALL', // 'ALL' | 'PINNED' | 'UNFOLDERED' | folder.id
  favorites: readLocal(STORAGE_KEYS.FAVORITES, []),
  recentItems: readLocal(STORAGE_KEYS.RECENTS, []),
  downloads: readLocal(STORAGE_KEYS.DOWNLOADS, []),
  downloadsFolderPath: readLocal(STORAGE_KEYS.DOWNLOADS_DIR, ''),
  cachedCovers: {},
  customCoverPaths: {},

  // ۱. راه‌اندازی و ادغام کامل استور با تمام جداول دیتابیس لوکال
  initLibrary: async () => {
    try {
      const localLib = sortLibraryItems(readLocal(STORAGE_KEYS.LIBRARY, []));
      const localFolders = readLocal(STORAGE_KEYS.FOLDERS, []);
      const localFavs = readLocal(STORAGE_KEYS.FAVORITES, []);
      const localRecents = readLocal(STORAGE_KEYS.RECENTS, []);
      const localDownloads = readLocal(STORAGE_KEYS.DOWNLOADS, []);
      const localDlDir = readLocal(STORAGE_KEYS.DOWNLOADS_DIR, '');

      set({
        library: localLib,
        libraryItems: localLib,
        libraryFolders: localFolders,
        favorites: localFavs,
        recentItems: localRecents,
        downloads: localDownloads,
        downloadsFolderPath: localDlDir,
      });

      if (coreApi.isAvailable()) {
        let dbCovers = {};
        try {
          const coversRes = await coreApi.dbAction({ action: 'GET_ALL_COVER_CACHES' });
          if (coversRes?.covers && typeof coversRes.covers === 'object') {
            dbCovers = coversRes.covers;
            set({ cachedCovers: dbCovers });
          }
        } catch (_) {}

        const libRes = await coreApi.dbAction({ action: 'GET_LIBRARY' });
        if (Array.isArray(libRes?.folders)) {
          set({ libraryFolders: libRes.folders });
          writeLocal(STORAGE_KEYS.FOLDERS, libRes.folders);
        }

        if (Array.isArray(libRes?.library)) {
          const mergedMap = new Map();
          const customMap = {};

          [...libRes.library, ...localLib].forEach((item) => {
            const rawP = item.path || item.filePath;
            const norm = normalizePath(rawP);
            if (norm && !mergedMap.has(norm)) {
              const validCover = isPermanentCover(item.cover)
                ? item.cover
                : dbCovers[norm] || null;
              const isCustom = Boolean(item.hasCustomCover);
              if (isCustom) customMap[norm] = true;

              mergedMap.set(norm, {
                ...item,
                path: rawP,
                cover: validCover,
                hasCustomCover: isCustom,
                isPinned: Boolean(item.isPinned),
                pinnedAt: item.pinnedAt || null,
                folderId: item.folderId || null,
              });
            }
          });

          const mergedLib = sortLibraryItems(Array.from(mergedMap.values()));
          set({
            library: mergedLib,
            libraryItems: mergedLib,
            customCoverPaths: customMap,
          });
          writeLocal(STORAGE_KEYS.LIBRARY, mergedLib);
        }

        const recentRes = await coreApi.dbAction({ action: 'GET_RECENTS' });
        if (Array.isArray(recentRes?.recents)) {
          const mergedRecentsMap = new Map();
          [...recentRes.recents, ...localRecents].forEach((item) => {
            const rawP = item.filePath || item.path;
            const norm = normalizePath(rawP);
            if (norm && !mergedRecentsMap.has(norm)) {
              const validCover = isPermanentCover(item.cover)
                ? item.cover
                : dbCovers[norm] || null;
              const totalP = Math.max(1, Number(item.totalPages) || 1);
              const lastP = Math.max(1, Number(item.currentPage || item.lastPage) || 1);
              mergedRecentsMap.set(norm, {
                ...item,
                path: rawP,
                name: item.fileName || item.name,
                cover: validCover,
                totalPages: totalP,
                lastPage: lastP,
                progress:
                  item.percentage ||
                  item.progress ||
                  Math.min(100, Math.round((lastP / totalP) * 100)),
                lastReadAt: item.updatedAt || item.lastReadAt,
              });
            }
          });
          const mergedRecents = Array.from(mergedRecentsMap.values()).slice(0, 100);
          set({ recentItems: mergedRecents });
          writeLocal(STORAGE_KEYS.RECENTS, mergedRecents);
        }

        const favRes = await coreApi.dbAction({ action: 'GET_FAVORITES' });
        if (Array.isArray(favRes?.favorites)) {
          const mergedFavsMap = new Map();
          [...favRes.favorites, ...localFavs].forEach((item) => {
            const rawP = item.path || item.filePath;
            const norm = normalizePath(rawP);
            if (norm && !mergedFavsMap.has(norm)) {
              const validCover = isPermanentCover(item.cover)
                ? item.cover
                : dbCovers[norm] || null;
              mergedFavsMap.set(norm, {
                ...item,
                path: rawP,
                cover: validCover,
              });
            }
          });
          const mergedFavs = Array.from(mergedFavsMap.values());
          set({ favorites: mergedFavs });
          writeLocal(STORAGE_KEYS.FAVORITES, mergedFavs);
        }
      }
    } catch (e) {
      console.error('Failed to init library store with native DB:', e);
    }
  },

  // ۲. کش کردن کاور با محافظت از کاورهای سفارشی انتخاب‌شده توسط کاربر
  cacheCover: (filePath, dataUrl, isCustom = false) => {
    if (!filePath || !isPermanentCover(dataUrl)) return;
    const norm = normalizePath(filePath);

    // اگر کاربر قبلاً کاور سفارشی تنظیم کرده باشد، اجازه نده تامبنیل خودکار آن را بازنویسی کند
    if (get().customCoverPaths[norm] && !isCustom) {
      return;
    }

    const updateCoverInList = (list) =>
      list.map((item) =>
        normalizePath(item.path || item.filePath) === norm
          ? { ...item, cover: dataUrl, ...(isCustom ? { hasCustomCover: true } : {}) }
          : item
      );

    set((state) => {
      const nextLib = updateCoverInList(state.library);
      const nextFavs = updateCoverInList(state.favorites);
      const nextRecents = updateCoverInList(state.recentItems);
      return {
        cachedCovers: { ...state.cachedCovers, [norm]: dataUrl },
        customCoverPaths: isCustom
          ? { ...state.customCoverPaths, [norm]: true }
          : state.customCoverPaths,
        library: nextLib,
        libraryItems: nextLib,
        favorites: nextFavs,
        recentItems: nextRecents,
      };
    });

    coreApi
      .dbAction({
        action: isCustom ? 'SET_CUSTOM_COVER' : 'CACHE_COVER',
        payload: { filePath, dataUrl, isCustom: Boolean(isCustom) },
      })
      .catch(() => {});
  },

  // تنظیم مستقیم کاور سفارشی
  setCustomCover: async (filePath, dataUrl) => {
    if (!filePath || !isPermanentCover(dataUrl)) return false;
    get().cacheCover(filePath, dataUrl, true);
    return true;
  },

  // باز کردن دیالوگ انتخاب عکس از سیستم و اعمال فوری به عنوان کاور کتاب/کمیک
  selectAndSetCustomCover: async (comicOrPath) => {
    const rawPath =
      typeof comicOrPath === 'string'
        ? comicOrPath
        : comicOrPath?.path || comicOrPath?.filePath;
    if (!rawPath) return { success: false, error: 'مسیر فایل مشخص نیست.' };

    const res = await coreApi.selectCustomCover(rawPath);
    if (res && res.success && isPermanentCover(res.cover)) {
      get().cacheCover(rawPath, res.cover, true);
      return { success: true, cover: res.cover };
    }
    return res || { success: false };
  },

  getCover: (filePath) => {
    if (!filePath) return null;
    const norm = normalizePath(filePath);

    const inCache = get().cachedCovers[norm];
    if (isPermanentCover(inCache)) return inCache;

    const inLib = get().library.find((i) => normalizePath(i.path || i.filePath) === norm);
    if (isPermanentCover(inLib?.cover)) return inLib.cover;

    const inFav = get().favorites.find((i) => normalizePath(i.path || i.filePath) === norm);
    if (isPermanentCover(inFav?.cover)) return inFav.cover;

    const inRec = get().recentItems.find((i) => normalizePath(i.path || i.filePath) === norm);
    if (isPermanentCover(inRec?.cover)) return inRec.cover;

    return null;
  },

  // =========================================================================
  // ۳. مدیریت کتابخانه، پین کردن (Pin) و پوشه‌بندی (Folders)
  // =========================================================================
  addToLibrary: async (comic) => {
    if (!comic) return;
    const rawPath = comic.path || comic.filePath;
    const norm = normalizePath(rawPath);
    if (!norm) return;

    const list = get().library;
    if (list.some((item) => normalizePath(item.path || item.filePath) === norm)) return;

    const validCover = isPermanentCover(comic.cover)
      ? comic.cover
      : get().cachedCovers[norm] || null;

    const activeFolder = get().activeFolderId;
    const defaultFolderId =
      comic.folderId !== undefined
        ? comic.folderId
        : activeFolder && !['ALL', 'PINNED', 'UNFOLDERED'].includes(activeFolder)
        ? activeFolder
        : null;

    const newItem = {
      path: rawPath,
      name: comic.name || comic.fileName || rawPath.split(/[\\/]/).pop() || 'بدون نام',
      cover: validCover,
      fileSize: comic.fileSize || '',
      totalPages: comic.totalPages || comic.items?.length || 1,
      lastPage: comic.lastPage || 1,
      folderId: defaultFolderId,
      isPinned: Boolean(comic.isPinned),
      pinnedAt: comic.isPinned ? new Date().toISOString() : null,
      addedAt: new Date().toISOString(),
    };

    const updated = sortLibraryItems([newItem, ...list]);
    set({ library: updated, libraryItems: updated });
    writeLocal(STORAGE_KEYS.LIBRARY, updated);

    await coreApi.dbAction({
      action: 'ADD_TO_LIBRARY',
      payload: {
        filePath: rawPath,
        name: newItem.name,
        coverPath: newItem.cover,
        folderId: newItem.folderId,
        isPinned: newItem.isPinned,
      },
    });
  },

  removeFromLibrary: async (filePath) => {
    const norm = normalizePath(filePath);
    if (!norm) return;

    const updated = get().library.filter(
      (item) => normalizePath(item.path || item.filePath) !== norm
    );
    set({ library: updated, libraryItems: updated });
    writeLocal(STORAGE_KEYS.LIBRARY, updated);

    await coreApi.dbAction({
      action: 'REMOVE_FROM_LIBRARY',
      payload: { filePath },
    });
  },

  clearLibrary: () => {
    set({ library: [], libraryItems: [] });
    writeLocal(STORAGE_KEYS.LIBRARY, []);
  },

  // بررسی وضعیت پین بودن آیتم در کتابخانه
  isPinned: (filePath) => {
    const norm = normalizePath(filePath);
    if (!norm) return false;
    return get().library.some(
      (item) => normalizePath(item.path || item.filePath) === norm && Boolean(item.isPinned)
    );
  },

  // پین / آن‌پین کردن آیتم در صدر کتابخانه و ذخیره در دیتابیس
  togglePin: async (comicOrPath) => {
    if (!comicOrPath) return false;
    const isObj = typeof comicOrPath === 'object';
    const rawPath = isObj ? comicOrPath.path || comicOrPath.filePath : comicOrPath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;

    const now = new Date().toISOString();
    const currentLib = get().library;
    const existingIdx = currentLib.findIndex(
      (item) => normalizePath(item.path || item.filePath) === norm
    );

    let nextPinned = true;
    let nextList = [];

    if (existingIdx >= 0) {
      nextPinned = !currentLib[existingIdx].isPinned;
      nextList = currentLib.map((item, idx) =>
        idx === existingIdx
          ? {
              ...item,
              isPinned: nextPinned,
              pinnedAt: nextPinned ? now : null,
            }
          : item
      );
    } else {
      const validCover =
        (isObj && isPermanentCover(comicOrPath.cover) ? comicOrPath.cover : null) ||
        get().cachedCovers[norm] ||
        null;

      const newEntry = {
        path: rawPath,
        name:
          (isObj && (comicOrPath.name || comicOrPath.fileName)) ||
          rawPath.split(/[\\/]/).pop() ||
          'بدون نام',
        cover: validCover,
        fileSize: (isObj && comicOrPath.fileSize) || '',
        totalPages: (isObj && (comicOrPath.totalPages || comicOrPath.items?.length)) || 1,
        lastPage: (isObj && comicOrPath.lastPage) || 1,
        folderId: (isObj && comicOrPath.folderId) || null,
        isPinned: true,
        pinnedAt: now,
        addedAt: now,
      };
      nextList = [newEntry, ...currentLib];
    }

    const sorted = sortLibraryItems(nextList);
    set({ library: sorted, libraryItems: sorted });
    writeLocal(STORAGE_KEYS.LIBRARY, sorted);

    coreApi
      .dbAction({
        action: 'TOGGLE_PIN_LIBRARY',
        payload: {
          filePath: rawPath,
          comic: isObj ? comicOrPath : { path: rawPath },
        },
      })
      .catch(() => {});

    return nextPinned;
  },

  // تغییر پوشه فعال در نمای کتابخانه
  setActiveFolder: (folderId) => {
    set({ activeFolderId: folderId || 'ALL' });
  },

  // ساخت پوشه جدید در کتابخانه و ذخیره در دیتابیس
  createFolder: async (name, color = '#22d3ee', icon = 'Folder') => {
    const cleanName = (name || '').trim();
    if (!cleanName) return null;

    const tempFolder = {
      id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: cleanName,
      color,
      icon,
      createdAt: new Date().toISOString(),
    };

    const nextFolders = [...get().libraryFolders, tempFolder];
    set({ libraryFolders: nextFolders });
    writeLocal(STORAGE_KEYS.FOLDERS, nextFolders);

    try {
      const res = await coreApi.dbAction({
        action: 'CREATE_LIBRARY_FOLDER',
        payload: { name: cleanName, color, icon },
      });
      if (Array.isArray(res?.folders)) {
        set({ libraryFolders: res.folders });
        writeLocal(STORAGE_KEYS.FOLDERS, res.folders);
        return res.folder || tempFolder;
      }
    } catch (_) {}

    return tempFolder;
  },

  // ویرایش نام و رنگ پوشه
  renameFolder: async (folderId, name, color) => {
    if (!folderId) return false;
    const cleanName = (name || '').trim();

    const updatedFolders = get().libraryFolders.map((f) =>
      f.id === folderId
        ? {
            ...f,
            ...(cleanName ? { name: cleanName } : {}),
            ...(color ? { color } : {}),
          }
        : f
    );

    set({ libraryFolders: updatedFolders });
    writeLocal(STORAGE_KEYS.FOLDERS, updatedFolders);

    await coreApi
      .dbAction({
        action: 'RENAME_LIBRARY_FOLDER',
        payload: { folderId, name: cleanName, color },
      })
      .catch(() => {});

    return true;
  },

  // حذف پوشه از کتابخانه (آیتم‌های داخل آن حذف نمی‌شوند و به حالت بدون پوشه برمی‌گردند)
  deleteFolder: async (folderId) => {
    if (!folderId) return;
    const updatedFolders = get().libraryFolders.filter((f) => f.id !== folderId);
    const updatedLib = get().library.map((item) =>
      item.folderId === folderId ? { ...item, folderId: null } : item
    );

    set((state) => ({
      libraryFolders: updatedFolders,
      library: updatedLib,
      libraryItems: updatedLib,
      activeFolderId: state.activeFolderId === folderId ? 'ALL' : state.activeFolderId,
    }));

    writeLocal(STORAGE_KEYS.FOLDERS, updatedFolders);
    writeLocal(STORAGE_KEYS.LIBRARY, updatedLib);

    await coreApi
      .dbAction({
        action: 'DELETE_LIBRARY_FOLDER',
        payload: { folderId },
      })
      .catch(() => {});
  },

  // اختصاص دادن یا انتقال کمیک/کتاب به یک پوشه خاص
  assignToFolder: async (comicOrPath, folderId = null) => {
    if (!comicOrPath) return false;
    const isObj = typeof comicOrPath === 'object';
    const rawPath = isObj ? comicOrPath.path || comicOrPath.filePath : comicOrPath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;

    const currentLib = get().library;
    const exists = currentLib.some(
      (item) => normalizePath(item.path || item.filePath) === norm
    );

    let nextLib;
    if (exists) {
      nextLib = currentLib.map((item) =>
        normalizePath(item.path || item.filePath) === norm
          ? { ...item, folderId: folderId || null }
          : item
      );
    } else {
      const validCover =
        (isObj && isPermanentCover(comicOrPath.cover) ? comicOrPath.cover : null) ||
        get().cachedCovers[norm] ||
        null;

      const newItem = {
        path: rawPath,
        name:
          (isObj && (comicOrPath.name || comicOrPath.fileName)) ||
          rawPath.split(/[\\/]/).pop() ||
          'بدون نام',
        cover: validCover,
        fileSize: (isObj && comicOrPath.fileSize) || '',
        totalPages: (isObj && (comicOrPath.totalPages || comicOrPath.items?.length)) || 1,
        lastPage: (isObj && comicOrPath.lastPage) || 1,
        folderId: folderId || null,
        isPinned: false,
        pinnedAt: null,
        addedAt: new Date().toISOString(),
      };
      nextLib = [newItem, ...currentLib];
    }

    const sorted = sortLibraryItems(nextLib);
    set({ library: sorted, libraryItems: sorted });
    writeLocal(STORAGE_KEYS.LIBRARY, sorted);

    await coreApi
      .dbAction({
        action: 'ASSIGN_TO_LIBRARY_FOLDER',
        payload: {
          filePath: rawPath,
          folderId: folderId || null,
          comic: isObj ? comicOrPath : { path: rawPath },
        },
      })
      .catch(() => {});

    return true;
  },

  // ۴. مدیریت علاقه‌مندی‌ها (Favorites)
  isFavorite: (filePath) => {
    const norm = normalizePath(filePath);
    if (!norm) return false;
    return get().favorites.some((item) => normalizePath(item.path || item.filePath) === norm);
  },

  toggleFavorite: (comic) => {
    if (!comic) return false;
    const rawPath = comic.path || comic.filePath;
    const norm = normalizePath(rawPath);
    if (!norm) return false;

    const currentFavs = get().favorites;
    const exists = currentFavs.some((item) => normalizePath(item.path || item.filePath) === norm);
    let updated;

    if (exists) {
      updated = currentFavs.filter((item) => normalizePath(item.path || item.filePath) !== norm);
    } else {
      const validCover = isPermanentCover(comic.cover)
        ? comic.cover
        : get().cachedCovers[norm] || null;

      const favItem = {
        path: rawPath,
        name: comic.name || comic.fileName || rawPath.split(/[\\/]/).pop() || 'بدون نام',
        cover: validCover,
        fileSize: comic.fileSize || '',
        totalPages: comic.totalPages || comic.items?.length || 1,
        lastPage: comic.lastPage || 1,
        favoritedAt: new Date().toISOString(),
      };
      updated = [favItem, ...currentFavs];
    }

    set({ favorites: updated });
    writeLocal(STORAGE_KEYS.FAVORITES, updated);

    coreApi
      .dbAction({
        action: 'TOGGLE_FAVORITE',
        payload: { comic: { ...comic, path: rawPath } },
      })
      .catch((err) => console.error('DB toggle favorite error:', err));

    return !exists;
  },

  removeFromFavorites: (filePath) => {
    const norm = normalizePath(filePath);
    const updated = get().favorites.filter(
      (item) => normalizePath(item.path || item.filePath) !== norm
    );
    set({ favorites: updated });
    writeLocal(STORAGE_KEYS.FAVORITES, updated);

    coreApi
      .dbAction({
        action: 'REMOVE_FROM_FAVORITES',
        payload: { filePath },
      })
      .catch(() => {});
  },

  // ۵. مدیریت تاریخچه مطالعه و موقعیت صفحه (با محافظت ویژه از ادامه مطالعه در PDFهای چانک‌بندی‌شده)
  addToRecent: async (comic) => {
    if (!comic) return;
    const rawPath = comic.path || comic.filePath;
    const norm = normalizePath(rawPath);
    if (!norm) return;

    const currentRecents = get().recentItems;
    const existing = currentRecents.find(
      (item) => normalizePath(item.path || item.filePath) === norm
    );

    const incomingTotal = Number(comic.totalPages || comic.items?.length) || 0;
    const totalPages =
      incomingTotal <= 1 && existing?.totalPages > 1
        ? existing.totalPages
        : Math.max(1, incomingTotal || existing?.totalPages || 1);

    const incomingLast = Number(comic.lastPage) || 0;
    const lastPage = Math.max(
      1,
      Math.min(
        totalPages,
        incomingLast > 1 ? incomingLast : existing?.lastPage || 1
      )
    );

    const validCover = isPermanentCover(comic.cover)
      ? comic.cover
      : get().cachedCovers[norm] || existing?.cover || null;

    const recentEntry = {
      path: rawPath,
      name:
        comic.name ||
        comic.fileName ||
        existing?.name ||
        rawPath.split(/[\\/]/).pop(),
      type: comic.type || existing?.type || (norm.endsWith('.pdf') ? 'pdf' : 'zip'),
      fileSize: comic.fileSize || existing?.fileSize || '',
      cover: validCover,
      totalPages,
      lastPage,
      progress: Math.min(100, Math.round((lastPage / Math.max(1, totalPages)) * 100)),
      lastReadAt: new Date().toISOString(),
    };

    const filtered = currentRecents.filter(
      (item) => normalizePath(item.path || item.filePath) !== norm
    );
    const updated = [recentEntry, ...filtered].slice(0, 100);

    set({ recentItems: updated });
    writeLocal(STORAGE_KEYS.RECENTS, updated);

    await coreApi.dbAction({
      action: 'SAVE_PROGRESS',
      payload: {
        filePath: rawPath,
        currentPage: lastPage,
        totalPages,
        fileName: recentEntry.name,
        cover: validCover,
      },
    });
  },

  // دی‌بانس کامل و ایزوله پیشرفت مطالعه (ثبت دقیق شماره صفحه و کل صفحات برای کمیک و PDF)
  updateReadingProgress: (filePath, currentPage, totalPagesCount) => {
    const norm = normalizePath(filePath);
    if (!norm || !currentPage) return;

    pendingProgressPayload = { filePath, norm, currentPage, totalPagesCount };
    if (progressDebounceTimer) clearTimeout(progressDebounceTimer);

    progressDebounceTimer = setTimeout(() => {
      if (!pendingProgressPayload) return;
      const {
        filePath: targetPath,
        norm: targetNorm,
        currentPage: targetPage,
        totalPagesCount: targetTotal,
      } = pendingProgressPayload;

      const updateItemProgress = (item) => {
        if (normalizePath(item.path || item.filePath) !== targetNorm) return item;
        const total =
          targetTotal && targetTotal > 1 ? targetTotal : item.totalPages || 1;
        const safePage = Math.max(1, Math.min(targetPage, total));
        return {
          ...item,
          lastPage: safePage,
          totalPages: total,
          progress: Math.min(100, Math.round((safePage / Math.max(1, total)) * 100)),
          lastReadAt: new Date().toISOString(),
        };
      };

      const updatedRecents = get().recentItems.map(updateItemProgress);
      const updatedLib = get().library.map(updateItemProgress);

      set({
        recentItems: updatedRecents,
        library: updatedLib,
        libraryItems: updatedLib,
      });
      writeLocal(STORAGE_KEYS.RECENTS, updatedRecents);
      writeLocal(STORAGE_KEYS.LIBRARY, updatedLib);

      coreApi
        .dbAction({
          action: 'SAVE_PROGRESS',
          payload: {
            filePath: targetPath,
            currentPage: targetPage,
            totalPages: targetTotal || 1,
          },
        })
        .catch(() => {});

      pendingProgressPayload = null;
      progressDebounceTimer = null;
    }, 450);
  },

  // متد ذخیره فوری در صورت بستن ناگهانی یا جابه‌جایی کمیک/PDF
  flushPendingProgress: () => {
    if (progressDebounceTimer) {
      clearTimeout(progressDebounceTimer);
      progressDebounceTimer = null;
    }
    if (!pendingProgressPayload) return;

    const { filePath, norm, currentPage, totalPagesCount } = pendingProgressPayload;

    const updateItemProgress = (item) => {
      if (normalizePath(item.path || item.filePath) !== norm) return item;
      const total =
        totalPagesCount && totalPagesCount > 1 ? totalPagesCount : item.totalPages || 1;
      const safePage = Math.max(1, Math.min(currentPage, total));
      return {
        ...item,
        lastPage: safePage,
        totalPages: total,
        progress: Math.min(100, Math.round((safePage / Math.max(1, total)) * 100)),
        lastReadAt: new Date().toISOString(),
      };
    };

    const updatedRecents = get().recentItems.map(updateItemProgress);
    const updatedLib = get().library.map(updateItemProgress);

    set({
      recentItems: updatedRecents,
      library: updatedLib,
      libraryItems: updatedLib,
    });
    writeLocal(STORAGE_KEYS.RECENTS, updatedRecents);
    writeLocal(STORAGE_KEYS.LIBRARY, updatedLib);

    coreApi
      .dbAction({
        action: 'SAVE_PROGRESS',
        payload: {
          filePath,
          currentPage,
          totalPages: totalPagesCount || 1,
        },
      })
      .catch(() => {});

    pendingProgressPayload = null;
  },

  removeFromRecent: (filePath) => {
    const norm = normalizePath(filePath);
    const updated = get().recentItems.filter(
      (item) => normalizePath(item.path || item.filePath) !== norm
    );
    set({ recentItems: updated });
    writeLocal(STORAGE_KEYS.RECENTS, updated);

    coreApi
      .dbAction({
        action: 'REMOVE_FROM_RECENTS',
        payload: { filePath },
      })
      .catch(() => {});
  },

  clearRecents: () => {
    set({ recentItems: [] });
    writeLocal(STORAGE_KEYS.RECENTS, []);
    coreApi.dbAction({ action: 'CLEAR_RECENTS' }).catch(() => {});
  },

  // ۶. مدیریت دانلودها
  setDownloadsFolder: (folderPath) => {
    const norm = normalizePath(folderPath);
    set({ downloadsFolderPath: norm });
    writeLocal(STORAGE_KEYS.DOWNLOADS_DIR, norm);
  },

  setDownloadsList: (items) => {
    const safe = Array.isArray(items) ? items : [];
    set({ downloads: safe });
    writeLocal(STORAGE_KEYS.DOWNLOADS, safe);
  },
}));

export default useLibraryStore;