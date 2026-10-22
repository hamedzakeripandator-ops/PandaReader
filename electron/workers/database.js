const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

// المسار الثابت لقاعدة البيانات المحلية في مجلد المستخدم
const DB_DIR = path.join(os.homedir(), '.comic-reader');
const DB_FILE = path.join(DB_DIR, 'db.json');
const DB_BAK_FILE = path.join(DB_DIR, 'db.json.bak');

const MAX_COVER_CACHE_ENTRIES = 300;

const defaultDB = {
  history: {},
  library: [],
  libraryFolders: [],
  favorites: [],
  annotations: {},
  profile: {
    username: 'Haamed',
    subtitle: 'توسعه‌دهنده و کمیک‌خوان حرفه‌ای',
    avatar: null,
    avatarGradient: 'linear-gradient(135deg, #22d3ee 0%, #0f171c 100%)',
    dailyGoalPages: 50,
    updatedAt: new Date().toISOString()
  },
  coverCache: {},
  shortcuts: {},
  settings: {
    defaultZoom: 1,
    zoomStep: 0.1,
    comicPageGap: 0,
    pdfPageGap: 12,
    autoZenOnOpen: true,
    screenshotFormat: 'png',
    jpgQuality: 0.94,
    showSidebarCounts: true
  }
};

function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  return p.trim().replace(/[\\/]+/g, '\\').toLowerCase();
}

function isPermanentCover(str) {
  if (!str || typeof str !== 'string') return false;
  const s = str.trim();
  if (
    s.startsWith('data:image/') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('blob:')
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
}

// ترتيب عناصر المكتبة بحيث تظهر العناصر المثبتة في الأعلى دائمًا
function sortLibraryItems(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    const aPinned = a?.isPinned ? 1 : 0;
    const bPinned = b?.isPinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;
    if (aPinned && bPinned) {
      const pTimeA = a?.pinnedAt || '';
      const pTimeB = b?.pinnedAt || '';
      if (pTimeA !== pTimeB) return pTimeB.localeCompare(pTimeA);
    }
    const addedA = a?.addedAt || '';
    const addedB = b?.addedAt || '';
    return addedB.localeCompare(addedA);
  });
}

function migrateSchema(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return JSON.parse(JSON.stringify(defaultDB));
  }

  const rawCoverCache =
    parsed.coverCache && typeof parsed.coverCache === 'object' ? parsed.coverCache : {};
  const cleanCoverCache = {};

  Object.entries(rawCoverCache).forEach(([k, v]) => {
    const normKey = normalizePath(k) || k;
    const dataUrl = typeof v === 'string' ? v : v?.dataUrl;
    if (isPermanentCover(dataUrl)) {
      cleanCoverCache[normKey] = {
        dataUrl,
        isCustom: Boolean(v?.isCustom),
        updatedAt: v?.updatedAt || new Date().toISOString()
      };
    }
  });

  const libraryFolders = Array.isArray(parsed.libraryFolders)
    ? parsed.libraryFolders.filter((f) => f && f.id && f.name)
    : [];
  const validFolderIds = new Set(libraryFolders.map((f) => f.id));

  const library = Array.isArray(parsed.library) ? parsed.library : [];
  const favorites = Array.isArray(parsed.favorites) ? parsed.favorites : [];
  const history = parsed.history && typeof parsed.history === 'object' ? parsed.history : {};
  const annotations =
    parsed.annotations && typeof parsed.annotations === 'object' ? parsed.annotations : {};

  library.forEach((item) => {
    const norm = normalizePath(item.path || item.filePath);
    item.normPath = norm;
    item.isPinned = Boolean(item.isPinned);
    item.pinnedAt = item.isPinned ? item.pinnedAt || item.addedAt || new Date().toISOString() : null;
    item.folderId = item.folderId && validFolderIds.has(item.folderId) ? item.folderId : null;
    if (cleanCoverCache[norm]?.isCustom && isPermanentCover(cleanCoverCache[norm]?.dataUrl)) {
      item.cover = cleanCoverCache[norm].dataUrl;
      item.hasCustomCover = true;
    } else if (!isPermanentCover(item.cover)) {
      item.cover = cleanCoverCache[norm]?.dataUrl || null;
    }
  });

  favorites.forEach((item) => {
    const norm = normalizePath(item.path || item.filePath);
    if (cleanCoverCache[norm]?.isCustom && isPermanentCover(cleanCoverCache[norm]?.dataUrl)) {
      item.cover = cleanCoverCache[norm].dataUrl;
    } else if (!isPermanentCover(item.cover)) {
      item.cover = cleanCoverCache[norm]?.dataUrl || null;
    }
  });

  Object.keys(history).forEach((normKey) => {
    if (cleanCoverCache[normKey]?.isCustom && isPermanentCover(cleanCoverCache[normKey]?.dataUrl)) {
      history[normKey].cover = cleanCoverCache[normKey].dataUrl;
    } else if (!isPermanentCover(history[normKey].cover)) {
      history[normKey].cover = cleanCoverCache[normKey]?.dataUrl || null;
    }
  });

  return {
    history,
    library: sortLibraryItems(library),
    libraryFolders,
    favorites,
    annotations,
    profile: {
      ...defaultDB.profile,
      ...(parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : {})
    },
    coverCache: cleanCoverCache,
    shortcuts: parsed.shortcuts && typeof parsed.shortcuts === 'object' ? parsed.shortcuts : {},
    settings: {
      ...defaultDB.settings,
      ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {})
    }
  };
}

function pruneCoverCache(db) {
  if (!db.coverCache) return;
  const entries = Object.entries(db.coverCache);
  if (entries.length <= MAX_COVER_CACHE_ENTRIES) return;

  const pinnedPaths = new Set([
    ...(db.library || []).map((i) => normalizePath(i.path || i.filePath)),
    ...(db.favorites || []).map((i) => normalizePath(i.path || i.filePath))
  ]);

  entries.sort((a, b) => {
    const aCustom = a[1]?.isCustom ? 1 : 0;
    const bCustom = b[1]?.isCustom ? 1 : 0;
    if (aCustom !== bCustom) return bCustom - aCustom;

    const aPinned = pinnedPaths.has(a[0]) ? 1 : 0;
    const bPinned = pinnedPaths.has(b[0]) ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;

    const strA = a[1]?.updatedAt || '';
    const strB = b[1]?.updatedAt || '';
    return strB.localeCompare(strA);
  });

  const pruned = {};
  entries.slice(0, MAX_COVER_CACHE_ENTRIES).forEach(([key, val]) => {
    pruned[key] = val;
  });
  db.coverCache = pruned;
}

let cachedDbInstance = null;
let diskWriteTimer = null;
let isWritingDisk = false;
let needsAnotherWrite = false;

function initDB() {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      const initialJson = JSON.stringify(defaultDB, null, 2);
      fs.writeFileSync(DB_FILE, initialJson, 'utf8');
      fs.writeFileSync(DB_BAK_FILE, initialJson, 'utf8');
      cachedDbInstance = JSON.parse(initialJson);
    } else {
      try {
        fs.copyFileSync(DB_FILE, DB_BAK_FILE);
      } catch (_) {}
    }
  } catch (error) {
    console.error('Database Init Critical Error:', error);
  }
}

function readDB() {
  if (cachedDbInstance) {
    return cachedDbInstance;
  }

  try {
    if (!fs.existsSync(DB_FILE)) {
      cachedDbInstance = JSON.parse(JSON.stringify(defaultDB));
      return cachedDbInstance;
    }
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    if (!raw || raw.trim().length === 0) throw new Error('Empty DB file');
    const parsed = JSON.parse(raw);
    cachedDbInstance = migrateSchema(parsed);
    return cachedDbInstance;
  } catch (primaryError) {
    console.warn('Primary DB read failed, attempting backup recovery...', primaryError.message);
    try {
      if (fs.existsSync(DB_BAK_FILE)) {
        const rawBak = fs.readFileSync(DB_BAK_FILE, 'utf8');
        const parsedBak = JSON.parse(rawBak);
        cachedDbInstance = migrateSchema(parsedBak);
        writeDB(cachedDbInstance, true);
        return cachedDbInstance;
      }
    } catch (_) {}
    cachedDbInstance = JSON.parse(JSON.stringify(defaultDB));
    return cachedDbInstance;
  }
}

async function performAsyncDiskWrite() {
  if (isWritingDisk || !cachedDbInstance) {
    needsAnotherWrite = true;
    return;
  }

  isWritingDisk = true;
  needsAnotherWrite = false;

  try {
    pruneCoverCache(cachedDbInstance);
    const jsonString = JSON.stringify(cachedDbInstance, null, 2);
    await fs.promises.writeFile(DB_FILE, jsonString, 'utf8');
  } catch (error) {
    needsAnotherWrite = true;
  } finally {
    isWritingDisk = false;
    if (needsAnotherWrite) {
      writeDB(cachedDbInstance);
    }
  }
}

function writeDB(data, immediate = false) {
  cachedDbInstance = data;

  if (immediate) {
    if (diskWriteTimer) {
      clearTimeout(diskWriteTimer);
      diskWriteTimer = null;
    }
    try {
      pruneCoverCache(cachedDbInstance);
      const jsonString = JSON.stringify(cachedDbInstance, null, 2);
      fs.writeFileSync(DB_FILE, jsonString, 'utf8');
      fs.writeFileSync(DB_BAK_FILE, jsonString, 'utf8');
      return true;
    } catch (_) {
      return false;
    }
  }

  if (diskWriteTimer) clearTimeout(diskWriteTimer);
  diskWriteTimer = setTimeout(() => {
    diskWriteTimer = null;
    performAsyncDiskWrite();
  }, 900);

  return true;
}

function syncCoverAcrossTables(db, normPath, dataUrl, forceCustom = false) {
  if (!normPath || !isPermanentCover(dataUrl)) return;

  // عدم استبدال الغلاف المخصص الذي عينه المستخدم إلا إذا كان التحديث مخصصًا
  const existingCache = db.coverCache[normPath];
  if (existingCache?.isCustom && !forceCustom) {
    return;
  }

  const isCustomFlag = forceCustom ? true : Boolean(existingCache?.isCustom);

  db.coverCache[normPath] = {
    dataUrl,
    isCustom: isCustomFlag,
    updatedAt: new Date().toISOString()
  };

  if (db.history[normPath]) {
    db.history[normPath].cover = dataUrl;
  }

  const libItem = db.library.find((item) => normalizePath(item.path || item.filePath) === normPath);
  if (libItem) {
    libItem.cover = dataUrl;
    if (isCustomFlag) libItem.hasCustomCover = true;
  }

  const favItem = db.favorites.find((item) => normalizePath(item.path || item.filePath) === normPath);
  if (favItem) {
    favItem.cover = dataUrl;
  }
}

initDB();
readDB();

parentPort.on('message', (request) => {
  const { reqId, action, payload = {} } = request || {};
  let db = readDB();

  const sendReply = (msgObj) => {
    parentPort.postMessage(reqId !== undefined ? { ...msgObj, reqId } : msgObj);
  };

  try {
    switch (action) {
      case 'FLUSH_SYNC': {
        writeDB(db, true);
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'SAVE_PROGRESS': {
        const { filePath, currentPage, totalPages = 1, fileName = '', cover = null } = payload;
        if (!filePath) {
          sendReply({ type: 'error', action, message: 'آدرس فایل ارسال نشده است.' });
          return;
        }

        const norm = normalizePath(filePath);
        const existingHist = db.history[norm];

        // الحفاظ على إجمالي صفحات PDF الحقيقي إذا تم إرسال القيمة المؤقتة 1 عند بدء التشغيل
        const incomingTotal = Number(totalPages) || 1;
        const validTotal =
          incomingTotal <= 1 && existingHist?.totalPages > 1
            ? existingHist.totalPages
            : Math.max(1, incomingTotal);

        const validPage = Math.max(1, Math.min(Number(currentPage) || 1, validTotal));
        const percentage = Math.round((validPage / validTotal) * 100);
        const now = new Date().toISOString();

        let resolvedCover = db.coverCache[norm]?.isCustom
          ? db.coverCache[norm].dataUrl
          : isPermanentCover(cover)
          ? cover
          : db.coverCache[norm]?.dataUrl || existingHist?.cover || null;

        if (resolvedCover && isPermanentCover(resolvedCover)) {
          syncCoverAcrossTables(db, norm, resolvedCover, false);
        } else {
          resolvedCover = null;
        }

        const historyEntry = {
          filePath,
          normPath: norm,
          fileName: fileName || existingHist?.fileName || path.basename(filePath),
          cover: resolvedCover,
          currentPage: validPage,
          totalPages: validTotal,
          percentage,
          updatedAt: now
        };

        db.history[norm] = historyEntry;

        const libItem = db.library.find((item) => normalizePath(item.path || item.filePath) === norm);
        if (libItem) {
          libItem.lastPage = validPage;
          libItem.totalPages = validTotal;
          libItem.percentage = percentage;
          libItem.lastReadAt = now;
          if (resolvedCover && !libItem.hasCustomCover) libItem.cover = resolvedCover;
        }

        const favItem = db.favorites.find((item) => normalizePath(item.path || item.filePath) === norm);
        if (favItem) {
          favItem.lastPage = validPage;
          favItem.totalPages = validTotal;
          favItem.percentage = percentage;
          favItem.lastReadAt = now;
          if (resolvedCover) favItem.cover = resolvedCover;
        }

        writeDB(db);
        sendReply({ type: 'done', action, success: true, progress: historyEntry });
        break;
      }

      case 'GET_PROGRESS': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        const progress = db.history[norm] || {
          filePath,
          currentPage: 1,
          totalPages: 1,
          percentage: 0,
          updatedAt: null
        };
        sendReply({ type: 'done', action, progress });
        break;
      }

      case 'GET_RECENTS': {
        const recents = Object.values(db.history)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
          .slice(0, 100);
        sendReply({ type: 'done', action, recents });
        break;
      }

      case 'REMOVE_FROM_RECENTS': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        if (db.history[norm]) {
          delete db.history[norm];
          writeDB(db);
        }
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'CLEAR_RECENTS': {
        db.history = {};
        writeDB(db);
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'ADD_TO_LIBRARY': {
        const { filePath, name, coverPath, folderId = null, isPinned = false } = payload;
        if (!filePath) {
          sendReply({ type: 'error', action, message: 'آدرس فایل کمیک ارسال نشده است.' });
          return;
        }

        const norm = normalizePath(filePath);
        const existingIndex = db.library.findIndex(
          (item) => normalizePath(item.path || item.filePath) === norm
        );
        const existingItem = existingIndex >= 0 ? db.library[existingIndex] : null;
        const historyData = db.history[norm];

        let cachedCover = db.coverCache[norm]?.isCustom
          ? db.coverCache[norm].dataUrl
          : isPermanentCover(coverPath)
          ? coverPath
          : db.coverCache[norm]?.dataUrl || existingItem?.cover || null;

        if (!isPermanentCover(cachedCover)) cachedCover = null;

        if (cachedCover) {
          syncCoverAcrossTables(db, norm, cachedCover, false);
        }

        const pinnedState = existingItem ? Boolean(existingItem.isPinned) : Boolean(isPinned);

        const itemData = {
          path: filePath,
          normPath: norm,
          name: name || existingItem?.name || path.basename(filePath),
          cover: cachedCover,
          hasCustomCover: Boolean(db.coverCache[norm]?.isCustom || existingItem?.hasCustomCover),
          folderId: folderId !== undefined ? folderId : existingItem?.folderId || null,
          isPinned: pinnedState,
          pinnedAt: pinnedState
            ? existingItem?.pinnedAt || new Date().toISOString()
            : null,
          addedAt: existingItem ? existingItem.addedAt : new Date().toISOString(),
          lastPage: historyData?.currentPage || existingItem?.lastPage || 1,
          totalPages: historyData?.totalPages || existingItem?.totalPages || 1,
          percentage: historyData?.percentage || existingItem?.percentage || 0,
          lastReadAt: historyData?.updatedAt || existingItem?.lastReadAt || null
        };

        if (existingIndex >= 0) {
          db.library[existingIndex] = itemData;
        } else {
          db.library.unshift(itemData);
        }

        db.library = sortLibraryItems(db.library);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          library: db.library,
          folders: db.libraryFolders || []
        });
        break;
      }

      case 'REMOVE_FROM_LIBRARY': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        db.library = db.library.filter((item) => normalizePath(item.path || item.filePath) !== norm);
        writeDB(db);
        sendReply({ type: 'done', action, library: db.library });
        break;
      }

      case 'GET_LIBRARY': {
        db.library = sortLibraryItems(db.library);
        sendReply({
          type: 'done',
          action,
          library: db.library,
          folders: db.libraryFolders || []
        });
        break;
      }

      // =====================================================================
      // إدارة التثبيت (Pin) والمجلدات (Folders) والغلاف المخصص في المكتبة
      // =====================================================================
      case 'TOGGLE_PIN_LIBRARY': {
        const { filePath, comic = {} } = payload;
        const targetPath = filePath || comic.path || comic.filePath;
        if (!targetPath) {
          sendReply({ type: 'error', action, message: 'مسیر فایل مشخص نیست.' });
          return;
        }

        const norm = normalizePath(targetPath);
        let idx = db.library.findIndex(
          (item) => normalizePath(item.path || item.filePath) === norm
        );

        let nextPinned = true;
        const now = new Date().toISOString();

        if (idx >= 0) {
          nextPinned = !db.library[idx].isPinned;
          db.library[idx] = {
            ...db.library[idx],
            isPinned: nextPinned,
            pinnedAt: nextPinned ? now : null
          };
        } else {
          const hist = db.history[norm];
          const cachedCov = db.coverCache[norm]?.dataUrl || hist?.cover || null;
          db.library.unshift({
            path: targetPath,
            normPath: norm,
            name: comic.name || comic.fileName || hist?.fileName || path.basename(targetPath),
            cover: isPermanentCover(cachedCov) ? cachedCov : null,
            folderId: comic.folderId || null,
            isPinned: true,
            pinnedAt: now,
            addedAt: now,
            lastPage: hist?.currentPage || 1,
            totalPages: hist?.totalPages || 1,
            percentage: hist?.percentage || 0,
            lastReadAt: hist?.updatedAt || null
          });
        }

        db.library = sortLibraryItems(db.library);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          isPinned: nextPinned,
          library: db.library
        });
        break;
      }

      case 'GET_LIBRARY_FOLDERS': {
        sendReply({
          type: 'done',
          action,
          folders: db.libraryFolders || []
        });
        break;
      }

      case 'CREATE_LIBRARY_FOLDER': {
        const { name, color = '#22d3ee', icon = 'Folder' } = payload;
        const cleanName = (name || '').trim();
        if (!cleanName) {
          sendReply({ type: 'error', action, message: 'نام پوشه نمی‌تواند خالی باشد.' });
          return;
        }

        db.libraryFolders = Array.isArray(db.libraryFolders) ? db.libraryFolders : [];
        const newFolder = {
          id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: cleanName,
          color,
          icon,
          createdAt: new Date().toISOString()
        };

        db.libraryFolders.push(newFolder);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          folder: newFolder,
          folders: db.libraryFolders
        });
        break;
      }

      case 'RENAME_LIBRARY_FOLDER': {
        const { folderId, name, color } = payload;
        db.libraryFolders = Array.isArray(db.libraryFolders) ? db.libraryFolders : [];
        const target = db.libraryFolders.find((f) => f.id === folderId);
        if (target) {
          if (name && name.trim()) target.name = name.trim();
          if (color) target.color = color;
          target.updatedAt = new Date().toISOString();
          writeDB(db);
        }
        sendReply({
          type: 'done',
          action,
          success: Boolean(target),
          folders: db.libraryFolders
        });
        break;
      }

      case 'DELETE_LIBRARY_FOLDER': {
        const { folderId } = payload;
        db.libraryFolders = (db.libraryFolders || []).filter((f) => f.id !== folderId);
        db.library.forEach((item) => {
          if (item.folderId === folderId) {
            item.folderId = null;
          }
        });
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          folders: db.libraryFolders,
          library: db.library
        });
        break;
      }

      case 'ASSIGN_TO_LIBRARY_FOLDER': {
        const { filePath, filePaths, folderId = null, comic = {} } = payload;
        const targets = Array.isArray(filePaths)
          ? filePaths
          : filePath
          ? [filePath]
          : [];

        targets.forEach((rawP) => {
          const norm = normalizePath(rawP);
          if (!norm) return;
          const idx = db.library.findIndex(
            (item) => normalizePath(item.path || item.filePath) === norm
          );
          if (idx >= 0) {
            db.library[idx].folderId = folderId || null;
          } else {
            const hist = db.history[norm];
            const cachedCov = db.coverCache[norm]?.dataUrl || hist?.cover || null;
            db.library.unshift({
              path: rawP,
              normPath: norm,
              name: comic.name || comic.fileName || hist?.fileName || path.basename(rawP),
              cover: isPermanentCover(cachedCov) ? cachedCov : null,
              folderId: folderId || null,
              isPinned: false,
              pinnedAt: null,
              addedAt: new Date().toISOString(),
              lastPage: hist?.currentPage || 1,
              totalPages: hist?.totalPages || 1,
              percentage: hist?.percentage || 0,
              lastReadAt: hist?.updatedAt || null
            });
          }
        });

        db.library = sortLibraryItems(db.library);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          library: db.library
        });
        break;
      }

      case 'SET_CUSTOM_COVER': {
        const { filePath, dataUrl } = payload;
        if (!filePath || !isPermanentCover(dataUrl)) {
          sendReply({ type: 'error', action, message: 'تصویر کاور معتبر نیست.' });
          return;
        }
        const norm = normalizePath(filePath);
        syncCoverAcrossTables(db, norm, dataUrl, true);
        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          cover: dataUrl,
          library: db.library
        });
        break;
      }

      // =====================================================================
      // إدارة التعليقات التوضيحية والتظليل والأشكال (Page Annotations)
      // =====================================================================
      case 'GET_ANNOTATIONS': {
        const { filePath, pageNumber } = payload;
        const norm = normalizePath(filePath);
        db.annotations = db.annotations || {};
        const docAnnots = db.annotations[norm] || {};
        if (pageNumber !== undefined && pageNumber !== null) {
          sendReply({
            type: 'done',
            action,
            items: docAnnots[String(pageNumber)] || []
          });
        } else {
          sendReply({
            type: 'done',
            action,
            annotations: docAnnots
          });
        }
        break;
      }

      case 'SAVE_ANNOTATIONS': {
        const { filePath, pageNumber, items = [] } = payload;
        const norm = normalizePath(filePath);
        if (!norm || pageNumber === undefined || pageNumber === null) {
          sendReply({ type: 'error', action, message: 'اطلاعات صفحه نامعتبر است.' });
          return;
        }
        db.annotations = db.annotations || {};
        if (!db.annotations[norm]) {
          db.annotations[norm] = {};
        }

        const pageKey = String(pageNumber);
        if (!Array.isArray(items) || items.length === 0) {
          delete db.annotations[norm][pageKey];
        } else {
          db.annotations[norm][pageKey] = items;
        }

        writeDB(db);
        sendReply({
          type: 'done',
          action,
          success: true,
          items: db.annotations[norm][pageKey] || []
        });
        break;
      }

      case 'CLEAR_ANNOTATIONS': {
        const { filePath, pageNumber } = payload;
        const norm = normalizePath(filePath);
        if (norm && db.annotations && db.annotations[norm]) {
          if (pageNumber !== undefined && pageNumber !== null) {
            delete db.annotations[norm][String(pageNumber)];
          } else {
            delete db.annotations[norm];
          }
          writeDB(db);
        }
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'TOGGLE_FAVORITE': {
        const { comic } = payload;
        const filePath = comic?.path || comic?.filePath;
        if (!filePath) {
          sendReply({ type: 'error', action, message: 'آدرس فایل برای لایک مشخص نیست.' });
          return;
        }

        const norm = normalizePath(filePath);
        const existingIdx = db.favorites.findIndex(
          (item) => normalizePath(item.path || item.filePath) === norm
        );
        let isFav = false;

        if (existingIdx >= 0) {
          db.favorites.splice(existingIdx, 1);
          isFav = false;
        } else {
          const hist = db.history[norm];
          let cachedCover = isPermanentCover(comic.cover)
            ? comic.cover
            : db.coverCache[norm]?.dataUrl || hist?.cover || null;

          if (!isPermanentCover(cachedCover)) cachedCover = null;

          const favEntry = {
            path: filePath,
            normPath: norm,
            name: comic.name || comic.fileName || path.basename(filePath),
            cover: cachedCover,
            lastPage: hist?.currentPage || comic.lastPage || 1,
            totalPages: hist?.totalPages || comic.totalPages || 1,
            percentage: hist?.percentage || 0,
            favoritedAt: new Date().toISOString()
          };
          db.favorites.unshift(favEntry);
          isFav = true;
        }

        writeDB(db);
        sendReply({ type: 'done', action, isFavorite: isFav, favorites: db.favorites });
        break;
      }

      case 'GET_FAVORITES': {
        sendReply({ type: 'done', action, favorites: db.favorites });
        break;
      }

      case 'REMOVE_FROM_FAVORITES': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        db.favorites = db.favorites.filter(
          (item) => normalizePath(item.path || item.filePath) !== norm
        );
        writeDB(db);
        sendReply({ type: 'done', action, favorites: db.favorites });
        break;
      }

      case 'SAVE_PROFILE': {
        const { username, subtitle, dailyGoalPages, avatarGradient } = payload;
        db.profile = {
          ...db.profile,
          ...(username ? { username: username.trim() } : {}),
          ...(subtitle !== undefined ? { subtitle: subtitle.trim() } : {}),
          ...(dailyGoalPages ? { dailyGoalPages: Number(dailyGoalPages) } : {}),
          ...(avatarGradient ? { avatarGradient } : {}),
          updatedAt: new Date().toISOString()
        };
        writeDB(db);
        sendReply({ type: 'done', action, profile: db.profile });
        break;
      }

      case 'SAVE_PROFILE_AVATAR': {
        const { avatar, avatarGradient } = payload;
        db.profile.avatar = avatar || null;
        if (avatarGradient) {
          db.profile.avatarGradient = avatarGradient;
        }
        db.profile.updatedAt = new Date().toISOString();
        writeDB(db);
        sendReply({ type: 'done', action, success: true, profile: db.profile });
        break;
      }

      case 'GET_PROFILE': {
        sendReply({ type: 'done', action, profile: db.profile || defaultDB.profile });
        break;
      }

      case 'CACHE_COVER': {
        const { filePath, dataUrl, isCustom = false } = payload;
        if (filePath && isPermanentCover(dataUrl)) {
          const norm = normalizePath(filePath);
          syncCoverAcrossTables(db, norm, dataUrl, Boolean(isCustom));
          writeDB(db);
        }
        sendReply({ type: 'done', action, success: true });
        break;
      }

      case 'GET_CACHED_COVER': {
        const { filePath } = payload;
        const norm = normalizePath(filePath);
        const cached = db.coverCache[norm] || null;
        const validCover = isPermanentCover(cached?.dataUrl) ? cached.dataUrl : null;
        sendReply({
          type: 'done',
          action,
          cover: validCover,
          isCustom: Boolean(cached?.isCustom)
        });
        break;
      }

      case 'GET_ALL_COVER_CACHES': {
        const simplified = {};
        Object.entries(db.coverCache || {}).forEach(([k, v]) => {
          const dUrl = typeof v === 'string' ? v : v?.dataUrl;
          if (isPermanentCover(dUrl)) {
            simplified[k] = dUrl;
          }
        });
        sendReply({ type: 'done', action, covers: simplified });
        break;
      }

      case 'SAVE_SETTING': {
        const { key, value } = payload;
        if (key) {
          db.settings = db.settings || {};
          db.settings[key] = value;
          writeDB(db);
          sendReply({ type: 'done', action, success: true, settings: db.settings });
        }
        break;
      }

      case 'GET_SETTINGS': {
        sendReply({ type: 'done', action, settings: db.settings || defaultDB.settings });
        break;
      }

      case 'SAVE_SHORTCUTS': {
        const { shortcuts } = payload;
        if (shortcuts && typeof shortcuts === 'object') {
          db.shortcuts = shortcuts;
          writeDB(db);
          sendReply({ type: 'done', action, success: true, shortcuts: db.shortcuts });
        }
        break;
      }

      case 'GET_SHORTCUTS': {
        sendReply({ type: 'done', action, shortcuts: db.shortcuts || {} });
        break;
      }

      default:
        sendReply({
          type: 'error',
          action,
          message: `دستور ${action} در ورکر دیتابیس پشتیبانی نمی‌شود.`
        });
    }
  } catch (error) {
    sendReply({ type: 'error', action, message: 'خطای سیستمی دیتابیس: ' + error.message });
  }
});