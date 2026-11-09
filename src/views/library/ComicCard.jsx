import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import useLibraryStore, {
  REORDER_GRAB_MOVE_PX,
} from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import { coreApi } from '../../services/coreApi';
import thumbnailService, { resolveCoverUrl } from '../../services/thumbnailService';
import Icons from '../../components/common/Icons';

// مرحلهٔ ۵۴ — ادغام (m2) لایهٔ ۲: توابعِ پرچمِ درگِ داخلیِ کارت،
// از ComicCard می‌آیند تا هر دو مسیرِ درگ (جابه‌جایی و کشیدن به تب)
// همان پرچم و همان شمارندهٔ نسل را ببینند.
// مرحلهٔ ۵۴ — مأموریت ۲ (m2) لایهٔ ۲: پرچمِ سراسریِ درگِ داخلیِ کارت.
// window.__isInternalCardDragActive از لحظهٔ شروعِ درگِ کارت با اشاره‌گر
// (نه درگِ بومیِ HTML5) true می‌شود و تا ۱۰۰ میلی‌ثانیه پس از pointerup
// true می‌ماند تا کلیکِ پس از رها کردن، پیش از پاک‌شدنِ پرچم برسد و
// بلعیده شود. الگو دقیقاً مثلِ window.__isAnnotationGestureActive است:
// پرچم را کارِ درگ می‌گذارد و App.jsx فقط آن را می‌خواند. شمارندهٔ نسل،
// پاک‌شدنِ معلقِ درگِ قبلی را از درگِ تازه‌ای که در همان ۱۰۰ میلی‌ثانیه
// شروع شده جدا می‌کند.
let internalCardDragClearTimer = null;
let internalCardDragGeneration = 0;

export function isInternalCardDragActive() {
  return typeof window !== 'undefined' && window.__isInternalCardDragActive === true;
}

export function setInternalCardDragActive() {
  if (typeof window === 'undefined') return;
  internalCardDragGeneration += 1;
  if (internalCardDragClearTimer) {
    clearTimeout(internalCardDragClearTimer);
    internalCardDragClearTimer = null;
  }
  window.__isInternalCardDragActive = true;
}

export function scheduleClearInternalCardDragActive() {
  if (typeof window === 'undefined') return;
  const generation = internalCardDragGeneration;
  if (internalCardDragClearTimer) clearTimeout(internalCardDragClearTimer);
  internalCardDragClearTimer = setTimeout(() => {
    internalCardDragClearTimer = null;
    if (generation === internalCardDragGeneration) {
      window.__isInternalCardDragActive = false;
    }
  }, 100);
}

// گاردِ کلیکِ پس از درگ: وقتی پرچمِ درگِ داخلی روشن است، کلیکِ کارت
// باید کامل بلعیده شود تا رها کردنِ کارت هرگز کتاب را باز نکند.
export function shouldSuppressCardClick() {
  return isInternalCardDragActive();
}


const COVER_GRADIENTS = [
  'linear-gradient(145deg, #0f171c 0%, #141d23 50%, #1d2a31 100%)',
  'linear-gradient(145deg, #121824 0%, #1e293b 50%, #0f172a 100%)',
  'linear-gradient(145deg, #132226 0%, #1b3a4b 50%, #0a0f13 100%)',
];

// مرحله ۴۸: نقشهٔ سطحِ ماژولِ کاورهایِ حل‌شده. هر کاوری که یک‌بار روی
// هر نمونهٔ کارت نمایش داده شد، با کلیدِ مسیرِ نرمال‌شده اینجا
// می‌ماند تا نمونهٔ بعدیِ همان مسیر — پس از آنمانت/ریمانت در
// مرتب‌سازیِ دوباره پس از پین، جابه‌جاییِ پوشه یا رندرِ دوبارهٔ
// اسلایدر — آن را همگام (sync) و بدونِ حتی یک میلی‌ثانیه خالی بودن
// برگرداند؛ حتی وقتی کشِ رم و کشِ استور پاک شده باشند یا درخواستِ
// در حالِ پرواز لغو شده باشد. فقط کاورِ نمایش‌داده‌شده ذخیره
// می‌شود، نه وعدهٔ در انتظار؛ سقف ۳۰۰ ورودی مثلِ کشِ رمِ کاور است.
const cardResolvedCoverMap = new Map();
const CARD_RESOLVED_COVER_MAX = 300;

function normalizeCardCoverKey(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  return filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase();
}

function readResolvedCover(filePath) {
  const key = normalizeCardCoverKey(filePath);
  if (!key || !cardResolvedCoverMap.has(key)) return null;
  const value = cardResolvedCoverMap.get(key);
  cardResolvedCoverMap.delete(key);
  cardResolvedCoverMap.set(key, value);
  return value;
}

function recordResolvedCover(filePath, coverUrl) {
  const key = normalizeCardCoverKey(filePath);
  if (!key || !coverUrl) return;
  if (cardResolvedCoverMap.has(key)) cardResolvedCoverMap.delete(key);
  cardResolvedCoverMap.set(key, coverUrl);
  while (cardResolvedCoverMap.size > CARD_RESOLVED_COVER_MAX) {
    const oldest = cardResolvedCoverMap.keys().next().value;
    if (oldest === undefined) break;
    cardResolvedCoverMap.delete(oldest);
  }
}

function forgetResolvedCover(filePath, coverUrl) {
  const key = normalizeCardCoverKey(filePath);
  if (!key) return;
  if (cardResolvedCoverMap.get(key) === coverUrl) cardResolvedCoverMap.delete(key);
}

// مرحلهٔ ۵۲ §۱: پیام و تشخیصِ فایلِ حذف‌شده — تابعِ خالص تا
// گاردِ کلیک و تست‌ها از همان منطق بخوانند.
export const MISSING_FILE_TOAST = 'این فایل از روی سیستم شما حذف یا جابه‌جا شده است.';
export function isMissingFileItem(item) {
  return Boolean(item && item.isMissing === true);
}

export default function ComicCard({
  item,
  onOpenComic,
  onRemove,
  showRemoveBtn = true,
  folderScope = 'library',
  // مرحلهٔ ۵۴ — مأموریت ۱: جابه‌جاییِ فوری با گرفتن و کشیدن
  // (بدونِ نگه‌داشتن).
  // reorderable: این نما اجازهٔ شروعِ جابه‌جایی از رویِ این کارت را
  // می‌دهد (فقط LibraryView و FavoritesView، و فقط true می‌فرستند).
  // isGrabbedForReorder: کارت در حالتِ جیگل/گرفته‌شده است (نما، پس
  // از جابه‌جاییِ ۶ پیکسلیِ نشانگر، آن را true می‌کند).
  // onReorderActivate: وقتی نشانگر، با دکمهٔ چپِ پایین، ۶ پیکسل
  // جابه‌جا شد، بی‌درنگ با (item, clientX, clientY) صدا زده
  // می‌شود تا نما، اندازه‌گیریِ گرید و شنونده‌هایِ پنجره را شروع کند.
  reorderable = false,
  isGrabbedForReorder = false,
  onReorderActivate = null,
}) {
  // مرحله ۴۹ (C): حوزهٔ پوشهٔ این کارت — 'library' (پیش‌فرض، رفتارِ
  // قبلی برایِ LibraryView) یا 'favorites' (نمایِ علاقه‌مندی‌ها:
  // منویِ سریع و بج، پوشه‌هایِ علاقه‌مندی را نشان می‌دهند).
  const isFavoritesScope = folderScope === 'favorites';
  const filePath = item?.path || item?.filePath || '';
  const normPath = useMemo(
    () => (filePath ? filePath.trim().replace(/[\\/]+/g, '\\').toLowerCase() : ''),
    [filePath]
  );

  const isFav = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return false;
        return (state.favorites || []).some(
          (f) =>
            (f.path || f.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
            normPath
        );
      },
      [normPath]
    )
  );

  const isPinned = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return Boolean(item?.isPinned);
        const found = (state.library || []).find(
          (i) =>
            (i.path || i.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
            normPath
        );
        return found ? Boolean(found.isPinned) : Boolean(item?.isPinned);
      },
      [normPath, item?.isPinned]
    )
  );

  const assignedFolderObj = useLibraryStore(
    useCallback(
      (state) => {
        if (isFavoritesScope) {
          const fId = item?.favoriteFolderId;
          if (!fId) return null;
          return (state.favoriteFolders || []).find((f) => f.id === fId) || null;
        }
        const fId = item?.folderId;
        if (!fId) return null;
        return (state.libraryFolders || []).find((f) => f.id === fId) || null;
      },
      [item?.folderId, item?.favoriteFolderId, isFavoritesScope]
    )
  );

  const cachedCoverInStore = useLibraryStore(
    useCallback(
      (state) => (normPath ? state.cachedCovers?.[normPath] || null : null),
      [normPath]
    )
  );

  const libraryFolders = useLibraryStore((state) => state.libraryFolders || []);
  const favoriteFolders = useLibraryStore((state) => state.favoriteFolders || []);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const togglePin = useLibraryStore((state) => state.togglePin);
  // مرحلهٔ ۵۰ §۵ — عضویتِ این کتاب در فهرستِ دستیِ اسلایدرِ هیرو.
  const heroSliderSource = useLibraryStore((state) => state.heroSliderSource || 'auto');
  const toggleBookInHeroSlider = useLibraryStore((state) => state.toggleBookInHeroSlider);
  const inHeroSlider = useLibraryStore(
    useCallback(
      (state) => {
        if (!normPath) return false;
        return (state.customSliderBookPaths || []).includes(normPath);
      },
      [normPath]
    )
  );
  const selectAndSetCustomCover = useLibraryStore(
    (state) => state.selectAndSetCustomCover
  );
  const assignToFolder = useLibraryStore((state) => state.assignToFolder);
  const assignToFavoriteFolder = useLibraryStore((state) => state.assignToFavoriteFolder);

  // مرحله ۴۹ (C): فهرست و اکشنِ فعالِ پوشه، بر اساسِ حوزهٔ کارت.
  const activeFolders = isFavoritesScope ? favoriteFolders : libraryFolders;
  const currentFolderId = isFavoritesScope
    ? item?.favoriteFolderId || null
    : item?.folderId || null;
  const assignFolderAction = isFavoritesScope ? assignToFavoriteFolder : assignToFolder;

  const showToast = useAppStore((state) => state.showToast);
  const openContextMenu = useAppStore((state) => state.openContextMenu);

  const title =
    item?.name || item?.fileName || filePath.split(/[\\/]/).pop() || 'Untitled';

  const [isHovered, setIsHovered] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);

  // مرحلهٔ ۵۴ — مأموریت ۱: گرفتنِ فوریِ کارت (grab-and-drag، بدونِ
// نگه‌داشتن و بدونِ هیچ تایمری). pointerdown فقط نقطهٔ شروع را
// ثبت می‌کند و هنوز درگ نیست، پس کلیکِ بدونِ حرکت، بی‌درنگ کتاب
// را باز می‌کند. به‌محضِ اینکه نشانگر، با دکمهٔ چپِ پایین، ۶
// پیکسل جابه‌جا شود، درگ بی‌درنگ فعال می‌شود (جیگل + قابِ نئونی
// + دافعه، دستِ هوک است). dragActivatedRef همگام است تا پس از
// فعال‌شدن، حرکت/رها کردنِ دوباره، فعال‌سازیِ تکراری نسازد.
const pendingDragRef = useRef(null);
const dragActivatedRef = useRef(false);

const cancelPendingDrag = useCallback(() => {
  pendingDragRef.current = null;
}, []);

const handleCardPointerDown = (e) => {
  if (!reorderable || isGrabbedForReorder) return;
  if (e.button !== 0) return;
  if (isMissingFileItem(item)) return;
  // دکمه‌هایِ کوچکِ کارت (حذف، پین، علاقه‌مندی، پوشه، تغییرِ کاور،
  // اسلایدر) و منویِ سریعِ پوشه، هرگز درگ را شروع نمی‌کنند.
  if (
    e.target &&
    typeof e.target.closest === 'function' &&
    e.target.closest('button, [data-cr-no-reorder]')
  ) {
    return;
  }
  dragActivatedRef.current = false;
  pendingDragRef.current = { x: e.clientX, y: e.clientY };
};

const handleCardPointerMove = (e) => {
  const pending = pendingDragRef.current;
  if (!pending || dragActivatedRef.current) return;
  // ادغام (m2): بدونِ دکمهٔ پایین، حرکتِ ماوس درگ نیست — وگرنه رها
  // کردنِ بیرونِ کارت و برگشتنِ ماوس، درگِ خیالی می‌ساخت.
  if (e.buttons === 0) return;
  const moved = Math.hypot(e.clientX - pending.x, e.clientY - pending.y);
  if (moved < REORDER_GRAB_MOVE_PX) return;
  dragActivatedRef.current = true;
  pendingDragRef.current = null;
  // ادغام (m2) لایهٔ ۲: با فعال‌شدنِ درگ، پرچمِ درگِ داخلی هم روشن
  // می‌شود تا رها کردنِ کارت، نه کتاب را باز کند و نه دراپِ خارجیِ
  // App.jsx را تحریک کند.
  setInternalCardDragActive();
  if (typeof onReorderActivate === 'function') {
    onReorderActivate(item, pending.x, pending.y);
  }
};

const handleCardPointerUp = () => {
  // پس از فعال‌شدن، رها کردن دستِ نماست (pointerupِ پنجره و
  // گاردِ wasReorderingRef)؛ اینجا فقط شروعِ هنوز-فعال‌نشده پاک
  // می‌شود تا کلیکِ عادی، کتاب را باز کند.
  if (!dragActivatedRef.current) pendingDragRef.current = null;
};

const handleCardPointerCancel = () => {
  pendingDragRef.current = null;
};

  // مرحلهٔ ۵۴ — مأموریت ۲ (m2) لایهٔ ۲ + ادغام: تورِ امنِ پاک‌شدنِ پرچم.
  // pointerup ممکن است بیرونِ کارت (مثلاً رویِ تبِ پوشه) رخ دهد و
  // هندلرِ رویِ کارت اصلاً صدا زده نشود؛ پس شنوندهٔ پنجره با هر
  // pointerup/pointercancel، پاک‌شدنِ ۱۰۰ میلی‌ثانیه‌ای را زمان‌بندی
  // می‌کند و شروعِ هنوز-فعال‌نشده را هم پاک می‌کند تا حرکتِ بعدیِ
  // ماوس بدونِ دکمه، درگِ خیالی نسازد.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onPointerEnd = () => {
      pendingDragRef.current = null;
      if (isInternalCardDragActive()) scheduleClearInternalCardDragActive();
    };
    window.addEventListener('pointerup', onPointerEnd);
    window.addEventListener('pointercancel', onPointerEnd);
    return () => {
      window.removeEventListener('pointerup', onPointerEnd);
      window.removeEventListener('pointercancel', onPointerEnd);
    };
  }, []);

  // مرحله ۴۷ §۲: فهرستِ کاورهایِ خراب و شمارشِ تلاش‌هایِ بازیابی، تا
  // خطایِ گذرایِ تصویر یا لغوِ درخواستِ تنبل، کارت را برای همیشه
  // خالی نکند. coverRetryRef فقط یک‌بار استخراجِ دوباره را مجاز
  // می‌کند تا چرخهٔ خطا و درخواستِ بی‌پایان ساخته نشود.
  // مرحله ۴۸: این refها پیش از مقداردهیِ اولیهٔ coverUrl می‌آیند تا
  // مقداردهیِ همگام بتواند نشانیِ خراب را از نقشهٔ سطحِ ماژول کنار
  // بگذارد.
  const coverRetryRef = useRef(0);
  const coverRequestPendingRef = useRef(false);
  const failedCoverUrlsRef = useRef(new Set());

  // مرحله ۴۸: مقداردهیِ همگامِ کاور. ترتیبِ مرجع‌ها از تازه‌ترین به
  // قدیمی‌ترین است: استور، بعد کاورِ آیتم، بعد نقشهٔ سطحِ ماژولِ
  // کاورهایِ حل‌شده، بعد peek همگامِ کش. نقشهٔ ماژول آخرین سنگر است:
  // وقتی کشِ رم و استور پاک شده‌اند، باز هم کاورِ قبلاً نمایش‌داده‌شده
  // را بی‌درنگ برمی‌گرداند و کارت حتی یک میلی‌ثانیه خالی نمی‌ماند.
  const [coverUrl, setCoverUrl] = useState(() => {
    const fromMap = readResolvedCover(filePath);
    const mapCover =
      fromMap && !failedCoverUrlsRef.current.has(fromMap)
        ? resolveCoverUrl(fromMap)
        : null;
    return (
      resolveCoverUrl(cachedCoverInStore) ||
      resolveCoverUrl(item?.cover) ||
      mapCover ||
      thumbnailService.peekCachedCover(filePath)
    );
  });

  // بج فرمت فایل
  const extBadge = useMemo(() => {
    if (item?.type === 'folder') return 'DIR';
    const parts = filePath.split('.');
    if (parts.length > 1) {
      const ext = parts.pop().toUpperCase();
      if (ext.length <= 5) return ext;
    }
    return (item?.type || 'ZIP').toUpperCase();
  }, [filePath, item?.type]);

  // درصد پیشرفت مطالعه
  const progress = useMemo(() => {
    if (typeof item?.percentage === 'number') {
      return Math.min(100, Math.max(0, item.percentage));
    }
    if (typeof item?.progress === 'number') {
      return Math.min(100, Math.max(0, item.progress));
    }
    const lp = item?.lastPage || item?.currentPage;
    if (lp && item?.totalPages) {
      return Math.min(100, Math.round((lp / Math.max(1, item.totalPages)) * 100));
    }
    return 0;
  }, [item]);

  const fallbackGradient = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < title.length; i++) {
      hash = title.charCodeAt(i) + ((hash << 5) - hash);
    }
    return COVER_GRADIENTS[Math.abs(hash) % COVER_GRADIENTS.length];
  }, [title]);

  // بروزرسانی آنی تصویر کاور در صورت تغییر کاور سفارشی یا استخراج از سرویس
  useEffect(() => {
    let isMounted = true;
    if (!filePath) return;

    // با رسیدنِ اطلاعاتِ تازهٔ کاور، بودجهٔ یک تلاشِ دوباره تازه می‌شود.
    coverRetryRef.current = 0;

    const fromStore = resolveCoverUrl(cachedCoverInStore);
    if (fromStore && !failedCoverUrlsRef.current.has(fromStore)) {
      setCoverUrl(fromStore);
      return;
    }

    const fromMap = readResolvedCover(filePath);
    const mapCover =
      fromMap && !failedCoverUrlsRef.current.has(fromMap)
        ? resolveCoverUrl(fromMap)
        : null;
    const existing =
      resolveCoverUrl(item?.cover) ||
      mapCover ||
      thumbnailService.peekCachedCover(filePath);
    if (existing && !failedCoverUrlsRef.current.has(existing)) {
      setCoverUrl(existing);
      return;
    }

    coverRequestPendingRef.current = true;
    thumbnailService.getThumbnail(filePath).then((res) => {
      coverRequestPendingRef.current = false;
      if (isMounted && res && !failedCoverUrlsRef.current.has(res)) {
        setCoverUrl(res);
      }
    });

    return () => {
      isMounted = false;
      // مرحله ۴۷ §۲: فقط وقتی درخواستِ همین کارت هنوز در صف است لغو
      // می‌شود. لغوِ بی‌قید در پاک‌سازی، درخواستِ مشترکِ همان مسیر را
      // برای کارت‌هایِ دیگر (مثلاً اسلایدر) هم می‌کشت و آن‌ها را خالی
      // می‌گذاشت.
      if (coverRequestPendingRef.current) {
        thumbnailService.cancelThumbnailRequest?.(filePath);
      }
    };
  }, [filePath, item?.cover, cachedCoverInStore]);

  // مرحله ۴۷ §۲ — بازیابیِ کاور پس از خالی شدنِ آن: اگر coverUrl
  // خالی شد ولی استور هنوز کاورِ سالم دارد، همان برگردانده می‌شود؛
  // وگرنه فقط یک‌بار استخراجِ دوباره امتحان می‌شود. بدونِ این افکت،
  // یک خطایِ گذرایِ تصویر تا ریمانتِ کارت، آن را خالی نگه می‌داشت.
  useEffect(() => {
    if (coverUrl || !filePath) return;
    const failed = failedCoverUrlsRef.current;
    const storeCover = resolveCoverUrl(cachedCoverInStore);
    const itemCover = resolveCoverUrl(item?.cover);
    const fromMap = readResolvedCover(filePath);
    const mapCover =
      fromMap && !failed.has(fromMap) ? resolveCoverUrl(fromMap) : null;
    const peeked = thumbnailService.peekCachedCover(filePath);
    const recovered =
      (storeCover && !failed.has(storeCover) ? storeCover : null) ||
      (itemCover && !failed.has(itemCover) ? itemCover : null) ||
      (mapCover && !failed.has(mapCover) ? mapCover : null) ||
      (peeked && !failed.has(peeked) ? peeked : null);
    if (recovered) {
      setCoverUrl(recovered);
      return;
    }
    if (coverRetryRef.current >= 1) return;
    coverRetryRef.current += 1;
    let isMounted = true;
    thumbnailService.getThumbnail(filePath).then((res) => {
      if (isMounted && res && !failed.has(res)) {
        setCoverUrl(res);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [coverUrl, filePath, item?.cover, cachedCoverInStore]);

  // مرحله ۴۸: هر کاورِ نمایش‌داده‌شده در نقشهٔ سطحِ ماژول ثبت
  // می‌شود تا نمونهٔ بعدیِ همان مسیر آن را همگام برگرداند. نشانیِ
  // خراب ثبت نمی‌شود.
  useEffect(() => {
    if (!coverUrl || !filePath) return;
    if (failedCoverUrlsRef.current.has(coverUrl)) return;
    recordResolvedCover(filePath, coverUrl);
  }, [coverUrl, filePath]);

  // مرحله ۴۷ §۲ — خطایِ تصویر، کاور را برای همیشه پاک نمی‌کند: اول
  // کاورِ سالمِ استور یا کش برگردانده می‌شود؛ فقط وقتی هیچ مرجعِ
  // سالمی نیست، جای‌خالی می‌ماند تا افکتِ بازیابی، استخراجِ دوباره
  // را امتحان کند. نشانیِ خراب در فهرستِ خراب‌ها می‌ماند تا دوباره
  // همان نشانیِ خراب، چرخهٔ خطا نسازد.
  const handleCoverError = useCallback(() => {
    if (coverUrl) {
      failedCoverUrlsRef.current.add(coverUrl);
      // مرحله ۴۸: نشانیِ خراب از نقشهٔ سطحِ ماژول هم پاک می‌شود تا
      // ریمانتِ بعدی دوباره همان نشانیِ خراب را سرو نکند.
      forgetResolvedCover(filePath, coverUrl);
    }
    const failed = failedCoverUrlsRef.current;
    const storeCover = resolveCoverUrl(cachedCoverInStore);
    const itemCover = resolveCoverUrl(item?.cover);
    const fromMap = readResolvedCover(filePath);
    const mapCover =
      fromMap && !failed.has(fromMap) ? resolveCoverUrl(fromMap) : null;
    const peeked = thumbnailService.peekCachedCover(filePath);
    const recovered =
      (storeCover && !failed.has(storeCover) ? storeCover : null) ||
      (itemCover && !failed.has(itemCover) ? itemCover : null) ||
      (mapCover && !failed.has(mapCover) ? mapCover : null) ||
      (peeked && !failed.has(peeked) ? peeked : null);
    if (recovered && recovered !== coverUrl) {
      setCoverUrl(recovered);
      return;
    }
    setCoverUrl(null);
  }, [coverUrl, cachedCoverInStore, item?.cover, filePath]);

  const handleToggleFav = (e) => {
    e.stopPropagation();
    const payload = {
      ...item,
      path: filePath,
      name: title,
      cover: coverUrl,
      lastPage: item?.lastPage || item?.currentPage || 1,
      totalPages: item?.totalPages || 1,
    };
    const added = toggleFavorite(payload);
    showToast(
      added
        ? `«${title}» به علاقه‌مندی‌ها اضافه شد`
        : `«${title}» از علاقه‌مندی‌ها حذف شد`,
      { type: added ? 'success' : 'info' }
    );
  };

  const handleTogglePin = async (e) => {
    e.stopPropagation();
    const pinnedNow = await togglePin({
      ...item,
      path: filePath,
      name: title,
      cover: coverUrl || item?.cover || null,
    });
    showToast(
      pinnedNow
        ? `«${title}» در صدر کتابخانه پین شد`
        : `«${title}» از حالت پین خارج شد`,
      { type: pinnedNow ? 'success' : 'info' }
    );
  };

  const handleToggleHeroSlider = (e) => {
    e.stopPropagation();
    if (!filePath) return;
    const added = toggleBookInHeroSlider({
      ...item,
      path: filePath,
      name: title,
      cover: coverUrl || item?.cover || null,
    });
    // تیک‌زدن فقط فهرستِ دستی را عوض می‌کند؛ اگر منبعِ اسلایدر
    // رویِ «انتخاب دستی» نیست، کاربر باید منبع را هم عوض کند.
    showToast(
      added
        ? heroSliderSource === 'custom'
          ? `«${title}» به اسلایدر اضافه شد`
          : `«${title}» به فهرستِ اسلایدر اضافه شد — برایِ نمایش، منبعِ اسلایدر را رویِ «انتخاب دستی» بگذار`
        : `«${title}» از اسلایدر حذف شد`,
      { type: added ? 'success' : 'info' }
    );
  };

  const handleChangeCustomCover = async (e) => {
    e.stopPropagation();
    if (!filePath) return;
    const res = await selectAndSetCustomCover(filePath);
    if (res?.success && res?.cover) {
      setCoverUrl(res.cover);
      thumbnailService.seedCover?.(filePath, res.cover);
      showToast(`کاور سفارشی برای «${title}» ذخیره شد`, { type: 'success' });
    }
  };

  const handleAssignFolder = async (e, folderId) => {
    e.stopPropagation();
    setShowFolderMenu(false);
    await assignFolderAction(
      { ...item, path: filePath, name: title, cover: coverUrl },
      folderId
    );
    const fObj = activeFolders.find((f) => f.id === folderId);
    showToast(
      fObj ? `به پوشه «${fObj.name}» منتقل شد` : 'از پوشه خارج شد',
      { type: 'success' }
    );
  };

  const handleShowFolder = (e) => {
    e.stopPropagation();
    if (filePath) coreApi.showItemInFolder(filePath);
  };

  // مرحلهٔ ۵۲ §۱: گاردِ کلیکِ کارتِ حذف‌شده — فقط Toast نشان
  // می‌دهد و هرگز onOpenComic را صدا نمی‌زند (پس باز کردنِ فایلِ
  // رفته، کرش نمی‌کند). دکمهٔ سطل، جداست و همچنان کار می‌کند.
  const handleCardClick = () => {
    // مرحلهٔ ۵۴ — مأموریت ۲ (m2) لایهٔ ۲: کلیکِ پس از درگِ داخلی،
    // بی‌صدا بلعیده می‌شود؛ پیش از گاردِ فایلِ حذف‌شده، تا رها کردنِ
    // کارت رویِ فایلِ رفته هم Toastِ اشتباه نشان ندهد.
    if (shouldSuppressCardClick()) return;
    if (isMissingFileItem(item)) {
      showToast(MISSING_FILE_TOAST, { type: 'warning' });
      return;
    }
    if (onOpenComic) onOpenComic(item);
  };

  const handleRemoveClick = (e) => {
    e.stopPropagation();
    if (onRemove) onRemove(filePath, title);
  };

  const handleCardContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    cancelPendingDrag();
    openContextMenu?.(
      { x: e.clientX, y: e.clientY },
      {
        comic: {
          ...item,
          path: filePath,
          name: title,
          cover: coverUrl,
          // مرحله ۴۹ (C): حوزهٔ پوشه همراهِ کارت فرستاده می‌شود تا
          // منویِ راست‌کلیک، در نمایِ علاقه‌مندی‌ها پوشه‌هایِ
          // علاقه‌مندی و در کتابخانه پوشه‌هایِ کتابخانه را نشان دهد.
          folderScope,
        },
      }
    );
  };

  // مرحلهٔ ۵۴ — مأموریت ۲ (m2) لایهٔ ۱ + ادغام: تابعِ درگِ بومی
  // کامل حذف شد؛ با draggable={false}یِ همیشه، درگِ بومیِ HTML5
  // دیگر هرگز از کارت شروع نمی‌شود و جابه‌جایی/انتقالِ پوشه ۱۰۰٪
  // با Pointer Events انجام می‌شوند.

  const lastPageNum = item?.lastPage || item?.currentPage || null;

  return (
    <div
      draggable={false}
      onDragStart={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={handleCardClick}
      onContextMenu={handleCardContextMenu}
      onPointerDown={handleCardPointerDown}
      onPointerMove={handleCardPointerMove}
      onPointerUp={handleCardPointerUp}
      onPointerCancel={handleCardPointerCancel}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowFolderMenu(false);
        if (!dragActivatedRef.current) pendingDragRef.current = null;
      }}
      className={isGrabbedForReorder ? 'cr-card-jiggle' : undefined}
      style={{
        ...styles.card,
        position: 'relative',
        // مرحلهٔ ۵۳ — مأموریت ۳: کارتِ گرفته‌شده، بلندشده با قابِ
        // نئونی است؛ transform را انیمیشنِ جیگل می‌دهد، پس inline
        // خالی می‌ماند تا با آن نجنگد. border و boxShadow هم inline
        // گذاشته می‌شوند، چون استایلِ پایهٔ کارت inline است.
        transform: isGrabbedForReorder
          ? undefined
          : isHovered
          ? 'translateY(-4px)'
          : 'translateY(0)',
        borderWidth: isGrabbedForReorder ? '2px' : undefined,
        borderColor: isGrabbedForReorder
          ? '#22d3ee'
          : isHovered
          ? 'var(--accent)'
          : isPinned
          ? 'rgba(34, 211, 238, 0.55)'
          : isFav
          ? 'rgba(248, 81, 73, 0.4)'
          : 'var(--border)',
        boxShadow: isGrabbedForReorder
          ? '0 18px 42px rgba(0, 0, 0, 0.65), 0 0 20px rgba(34, 211, 238, 0.45)'
          : isHovered
          ? '0 14px 28px rgba(0, 0, 0, 0.65), 0 0 14px rgba(34, 211, 238, 0.15)'
          : '0 6px 16px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* کادر کاور با نسبت استاندارد 3:4 */}
      <div style={{ ...styles.coverBox, background: fallbackGradient }}>
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={title}
            onError={handleCoverError}
            onDragStart={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            draggable={false}
            style={{
              ...styles.coverImg,
              transform: isHovered ? 'scale(1.04)' : 'scale(1)',
            }}
          />
        ) : (
          <div style={styles.placeholderArt}>
            <span style={{ color: 'var(--accent)', opacity: 0.7 }}>
              <Icons.BookOpen size={32} />
            </span>
            <span style={styles.placeholderInitial}>
              {title.slice(0, 2).toUpperCase()}
            </span>
          </div>
        )}

        {/* بج فرمت بالا-چپ */}
        <span style={styles.formatBadge}>{extBadge}</span>

        {/* مرحلهٔ ۵۲ §۱: بجِ «فایل حذف شده» رویِ کاور */}
        {isMissingFileItem(item) && (
          <span style={styles.missingBadgeOnCover}>
            <Icons.AlertTriangle size={12} />
            <span>فایل حذف شده</span>
          </span>
        )}

        {/* دکمه‌های شناور بالا-راست: قلب علاقه‌مندی + دکمه پین در صدر کتابخانه */}
        <div style={styles.topFloatingActions}>
          <button
            type="button"
            onClick={handleToggleFav}
            title={isFav ? 'حذف از علاقه‌مندی‌ها' : 'افزودن به علاقه‌مندی‌ها'}
            style={{
              ...styles.floatingCircleBtn,
              backgroundColor: isFav
                ? 'rgba(248, 81, 73, 0.22)'
                : 'rgba(10, 15, 19, 0.82)',
              borderColor: isFav ? 'var(--danger)' : 'var(--border)',
              color: isFav ? 'var(--danger)' : 'var(--text)',
            }}
          >
            <Icons.Heart size={13} filled={isFav} />
          </button>

          {(isPinned || isHovered) && (
            <button
              type="button"
              onClick={handleTogglePin}
              title={
                isPinned
                  ? 'برداشتن پین از صدر کتابخانه'
                  : 'پین کردن در صدر کتابخانه'
              }
              style={{
                ...styles.floatingCircleBtn,
                backgroundColor: isPinned
                  ? 'rgba(34, 211, 238, 0.22)'
                  : 'rgba(10, 15, 19, 0.82)',
                borderColor: isPinned ? 'var(--accent)' : 'var(--border)',
                color: isPinned ? 'var(--accent)' : 'var(--text)',
              }}
            >
              <Icons.Pin size={13} filled={isPinned} />
            </button>
          )}
        </div>

        {/* دکمه‌های سریع در وضعیت هاور: تغییر کاور، انتقال به پوشه، نمایش در ویندوز و حذف */}
        {isHovered && (
          <div style={styles.hoverOverlay}>
            <button
              type="button"
              onClick={handleChangeCustomCover}
              style={{ ...styles.miniActionBtn, color: 'var(--accent)' }}
              title="انتخاب تصویر کاور سفارشی"
            >
              <Icons.Camera size={13} />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowFolderMenu((prev) => !prev);
              }}
              style={{
                ...styles.miniActionBtn,
                borderColor: showFolderMenu ? 'var(--accent)' : 'var(--border)',
              }}
              title={isFavoritesScope ? 'انتقال به پوشه علاقه‌مندی‌ها' : 'انتقال به پوشه کتابخانه'}
            >
              <Icons.FolderPlus size={13} />
            </button>

            <button
              type="button"
              onClick={handleToggleHeroSlider}
              style={{
                ...styles.miniActionBtn,
                // مرحلهٔ ۵۲ §۲ — پس‌زمینه همیشه تیره است تا آیکون سفید خوانا بماند؛ هرگز سفید یا فیروزه‌ای روشن نمی‌شود.
                color: inHeroSlider ? '#34d399' : '#ffffff',
                borderColor: inHeroSlider ? 'rgba(52, 211, 153, 0.45)' : 'rgba(255, 255, 255, 0.14)',
                backgroundColor: inHeroSlider ? 'rgba(12, 16, 23, 0.92)' : 'rgba(12, 16, 23, 0.88)',
              }}
              title={inHeroSlider ? 'حذف از اسلایدر بالا' : 'نمایش در اسلایدر بالا'}
            >
              <Icons.Layers size={13} />
            </button>

            <button
              type="button"
              onClick={handleShowFolder}
              style={styles.miniActionBtn}
              title="نمایش فایل در ویندوز اکسپلورر"
            >
              <Icons.Folder size={13} />
            </button>

            {showRemoveBtn && onRemove && (
              <button
                type="button"
                onClick={handleRemoveClick}
                style={{ ...styles.miniActionBtn, color: 'var(--danger)' }}
                title="حذف از کتابخانه"
              >
                <Icons.Trash size={13} />
              </button>
            )}
          </div>
        )}

        {/* منوی سریع انتخاب پوشه روی خود کارت */}
        {showFolderMenu && (
          <div
            data-cr-no-reorder="true"
            style={styles.folderQuickMenu}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.folderQuickMenuHeader}>انتقال به پوشه:</div>
            <div
              onClick={(e) => handleAssignFolder(e, null)}
              style={{
                ...styles.folderQuickItem,
                color: !currentFolderId ? 'var(--accent)' : 'var(--text)',
              }}
            >
              <span>بدون پوشه (نمای کلی)</span>
              {!currentFolderId && <Icons.Check size={12} />}
            </div>
            {activeFolders.map((f) => {
              const isCurr = currentFolderId === f.id;
              return (
                <div
                  key={f.id}
                  onClick={(e) => handleAssignFolder(e, f.id)}
                  style={{
                    ...styles.folderQuickItem,
                    color: isCurr ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        backgroundColor: f.color || '#22d3ee',
                      }}
                    />
                    <span>{f.name}</span>
                  </div>
                  {isCurr && <Icons.Check size={12} />}
                </div>
              );
            })}
          </div>
        )}

        {/* نوار باریک درصد پیشرفت مطالعه */}
        {progress > 0 && (
          <div style={styles.progressTrack}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
        )}
      </div>

      {/* بخش توضیحات کارت */}
      <div style={styles.metaBox}>
        <div style={styles.title} title={title}>
          {title}
        </div>

        <div style={styles.subInfoRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', overflow: 'hidden' }}>
            {isPinned ? (
              <span style={styles.pinnedTag}>پین‌شده</span>
            ) : assignedFolderObj ? (
              <span
                style={{
                  ...styles.folderBadgeTag,
                  borderColor: assignedFolderObj.color || 'var(--accent)',
                  color: assignedFolderObj.color || 'var(--accent)',
                }}
              >
                {assignedFolderObj.name}
              </span>
            ) : (
              <span
                style={{
                  ...styles.favStatusTag,
                  color: isFav ? 'var(--danger)' : 'var(--muted)',
                  backgroundColor: isFav
                    ? 'rgba(248, 81, 73, 0.12)'
                    : 'var(--panel2)',
                }}
              >
                {isFav ? 'مورد علاقه' : 'عادی'}
              </span>
            )}
            {inHeroSlider && <span style={styles.sliderTag}>در اسلایدر</span>}
            {/* مرحلهٔ ۵۲ §۱: بجِ «فایل حذف شده» در فوترِ کارت */}
            {isMissingFileItem(item) && (
              <span style={styles.missingBadge}>
                <Icons.AlertTriangle size={11} />
                <span>فایل حذف شده</span>
              </span>
            )}
          </div>

          {lastPageNum ? (
            <span style={styles.pageTag}>
              P.{lastPageNum}
              {item?.totalPages ? `/${item.totalPages}` : ''}
            </span>
          ) : item?.fileSize ? (
            <span style={styles.pageTag}>{item.fileSize}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const styles = {
  card: {
    backgroundColor: 'var(--panel)',
    borderRadius: '16px',
    padding: '10px',
    cursor: 'pointer',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
    userSelect: 'none',
    direction: 'rtl',
  },
  coverBox: {
    width: '100%',
    aspectRatio: '3 / 4',
    borderRadius: '12px',
    position: 'relative',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
  },
  coverImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: 'transform 0.3s ease',
  },
  placeholderArt: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
  },
  placeholderInitial: {
    fontFamily: 'var(--font-latin)',
    fontSize: '13px',
    fontWeight: 800,
    color: 'var(--muted)',
    letterSpacing: '2px',
    direction: 'ltr',
  },
  formatBadge: {
    position: 'absolute',
    top: '8px',
    left: '8px',
    backgroundColor: 'rgba(10, 15, 19, 0.88)',
    backdropFilter: 'blur(6px)',
    color: 'var(--accent)',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    fontWeight: 700,
    padding: '3px 7px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.35)',
    direction: 'ltr',
    zIndex: 2,
  },
  topFloatingActions: {
    position: 'absolute',
    top: '8px',
    right: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    zIndex: 3,
  },
  floatingCircleBtn: {
    width: '29px',
    height: '29px',
    borderRadius: '50%',
    borderWidth: '1px',
    borderStyle: 'solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backdropFilter: 'blur(8px)',
    transition: 'all 0.15s ease',
    padding: 0,
    outline: 'none',
  },
  hoverOverlay: {
    position: 'absolute',
    bottom: '10px',
    left: '8px',
    right: '8px',
    display: 'flex',
    justifyContent: 'center',
    gap: '5px',
    zIndex: 4,
  },
  miniActionBtn: {
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    backgroundColor: 'rgba(10, 15, 19, 0.92)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    outline: 'none',
  },
  folderQuickMenu: {
    position: 'absolute',
    inset: '8px',
    backgroundColor: 'rgba(10, 15, 19, 0.96)',
    backdropFilter: 'blur(12px)',
    borderRadius: '10px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
    padding: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    overflowY: 'auto',
    zIndex: 6,
  },
  folderQuickMenuHeader: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    fontWeight: 700,
    color: 'var(--accent)',
    marginBottom: '2px',
  },
  folderQuickItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '5px 7px',
    borderRadius: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  progressTrack: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '4px',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'var(--accent)',
    boxShadow: '0 0 8px var(--accent)',
  },
  metaBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '0 2px',
  },
  title: {
    fontFamily: 'var(--font-latin)',
    fontSize: '13.5px',
    fontWeight: 700,
    color: 'var(--text)',
    lineHeight: '1.35',
    height: '37px',
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    wordBreak: 'break-word',
    direction: 'ltr',
    textAlign: 'center',
  },
  subInfoRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '6px',
  },
  favStatusTag: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10.5px',
    fontWeight: 600,
    padding: '2px 8px',
    borderRadius: '6px',
  },
  pinnedTag: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10px',
    fontWeight: 700,
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.14)',
    padding: '2px 7px',
    borderRadius: '6px',
  },
  // مرحلهٔ ۵۲ §۱: بجِ «فایل حذف شده» — همین استایلِ دقیق، هم
  // رویِ کاور (با موقعیتِ مطلق) و هم در فوترِ کارت استفاده می‌شود.
  missingBadge: {
    fontFamily: 'var(--font-fa)',
    background: 'rgba(239, 68, 68, 0.92)',
    border: '1px solid #fca5a5',
    color: '#ffffff',
    padding: '3px 8px',
    borderRadius: '6px',
    fontSize: '10.5px',
    fontWeight: 800,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    whiteSpace: 'nowrap',
  },
  missingBadgeOnCover: {
    fontFamily: 'var(--font-fa)',
    background: 'rgba(239, 68, 68, 0.92)',
    border: '1px solid #fca5a5',
    color: '#ffffff',
    padding: '3px 8px',
    borderRadius: '6px',
    fontSize: '10.5px',
    fontWeight: 800,
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    whiteSpace: 'nowrap',
    position: 'absolute',
    top: '36px',
    left: '8px',
    zIndex: 2,
  },
  // مرحلهٔ ۵۰ §۵ — برچسبِ «در اسلایدر» برایِ کتاب‌هایِ فهرستِ دستی.
  sliderTag: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10px',
    fontWeight: 700,
    color: '#22d3ee',
    backgroundColor: 'rgba(34, 211, 238, 0.14)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.35)',
    padding: '2px 7px',
    borderRadius: '6px',
    whiteSpace: 'nowrap',
  },
  folderBadgeTag: {
    fontFamily: 'var(--font-fa)',
    fontSize: '10px',
    fontWeight: 600,
    borderWidth: '1px',
    borderStyle: 'solid',
    padding: '1px 7px',
    borderRadius: '6px',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '90px',
  },
  pageTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    fontWeight: 600,
    color: 'var(--muted)',
    direction: 'ltr',
    fontVariantNumeric: 'tabular-nums',
  },
};