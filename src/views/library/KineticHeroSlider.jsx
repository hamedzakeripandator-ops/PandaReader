import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import useSettingsStore from '../../store/useSettingsStore';
import SliderControls from '../../components/library/SliderControls';
import thumbnailService, { resolveCoverUrl } from '../../services/thumbnailService';
import Icons from '../../components/common/Icons';

const FALLBACK_SLIDE_BACKGROUNDS = [
  'linear-gradient(135deg, #1a1025 0%, #0f172a 50%, #0a0a0f 100%)',
  'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #0a0a0f 100%)',
  'linear-gradient(135deg, #200122 0%, #6f0000 50%, #0a0a0f 100%)',
  'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #0a0a0f 100%)',
  'linear-gradient(135deg, #141e30 0%, #243b55 50%, #0a0a0f 100%)',
];

const AUTO_PLAY_MS = 6000;

export default function KineticHeroSlider({ items = [], onOpenComic, capSlides = true }) {
  const favorites = useLibraryStore((state) => state.favorites);
  const cachedCovers = useLibraryStore((state) => state.cachedCovers);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const togglePin = useLibraryStore((state) => state.togglePin);
  const selectAndSetCustomCover = useLibraryStore((state) => state.selectAndSetCustomCover);
  const showToast = useAppStore((state) => state.showToast);
  const heroSliderVariant = useSettingsStore((state) => state.preferences?.heroSliderVariant || 'mirror');

  // مرحلهٔ ۵۰ §۵ — پیکربندیِ منبعِ اسلایدر (مدلِ دادهٔ استور).
  const heroSliderSource = useLibraryStore((state) => state.heroSliderSource || 'auto');
  const heroSliderFolderId = useLibraryStore((state) => state.heroSliderFolderId || null);
  const customSliderBookPaths = useLibraryStore((state) => state.customSliderBookPaths || []);
  const library = useLibraryStore((state) => state.library || []);
  const recentItems = useLibraryStore((state) => state.recentItems || []);
  const libraryFolders = useLibraryStore((state) => state.libraryFolders || []);
  const favoriteFolders = useLibraryStore((state) => state.favoriteFolders || []);
  const setHeroSliderSource = useLibraryStore((state) => state.setHeroSliderSource);
  const toggleBookInHeroSlider = useLibraryStore((state) => state.toggleBookInHeroSlider);
  const setCustomSliderBookPaths = useLibraryStore((state) => state.setCustomSliderBookPaths);

  const [currentIndex, setCurrentIndex] = useState(0);
  // مرحلهٔ ۵۰ §۵ — منویِ منبع و پنجرهٔ انتخابِ دستیِ کتاب‌ها.
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [resolvedCovers, setResolvedCovers] = useState({});
  // مرحله ۴۷ §۲: نشانی‌هایِ خرابِ کاور و اسلایدهایی که یک‌بار
  // استخراجِ دوباره برایشان امتحان شده؛ تا خطایِ تصویر، چرخهٔ
  // درخواستِ بی‌پایان نسازد.
  const [coverRetryTick, setCoverRetryTick] = useState(0);
  const failedCoverUrlsRef = useRef(new Set());
  const retriedNormsRef = useRef(new Set());

  const dragStartXRef = useRef(0);
  const dragCurrentXRef = useRef(0);
  const hasDraggedRef = useRef(false);

  // مرحلهٔ ۵۰ §۵ — تعدادِ پویا: برشِ ثابتِ ۷تایی فقط برایِ حالتِ
  // خودکار می‌ماند (capSlides)؛ در حالت‌هایِ پوشه و دستی، لیستِ
  // اسلایدها دقیقاً به‌اندازهٔ کتاب‌هایِ واقعیِ منبع است (پوشهٔ
  // ۳ کتابی = ۳ اسلاید، ۲۰ کتابی = ۲۰ اسلاید).
  const slides = useMemo(() => {
    if (!Array.isArray(items)) return [];
    return capSlides ? items.slice(0, 7) : items;
  }, [items, capSlides]);
  const totalSlides = slides.length;
  // مرحلهٔ ۵۰ §۵ — پیشگیریِ ۱: تقسیم بر صفر هرگز رخ نمی‌دهد؛
  // safeIndex همیشه در بازهٔ معتبر است و به‌جایِ currentIndexِ خام
  // برایِ اسلایدِ فعال و کنترلِ موج استفاده می‌شود.
  const safeIndex = totalSlides > 0 ? currentIndex % totalSlides : 0;

  useEffect(() => {
    if (currentIndex >= totalSlides && totalSlides > 0) {
      setCurrentIndex(0);
    }
  }, [totalSlides, currentIndex]);

  // مرحلهٔ ۵۰ §۵ — پیشگیریِ ۲: با تغییرِ منبعِ اسلایدر (نوع، پوشه
  // یا فهرستِ دستی)، اندیس فوراً صفر می‌شود تا slides[currentIndex]
  // هرگز undefined نشود. گاردِ currentIndex !== 0 از رندرِ اضافه
  // جلوگیری می‌کند؛ currentIndex عمداً در وابستگی‌ها نیست تا فقط
  // تغییرِ منبع، ریست را بسازد.
  const heroSourceSignature = useMemo(
    () =>
      `${heroSliderSource || 'auto'}|${heroSliderFolderId || ''}|${(customSliderBookPaths || []).join(',')}`,
    [heroSliderSource, heroSliderFolderId, customSliderBookPaths]
  );
  useEffect(() => {
    if (currentIndex !== 0) setCurrentIndex(0);
  }, [heroSourceSignature]); // eslint-disable-line react-hooks/exhaustive-deps


  // مرحلهٔ ۵۰ §۵ — برچسبِ دکمهٔ «منبع اسلایدر» و شمارِ کتاب‌هایِ
  // هر پوشه برایِ منو.
  const sourceLabel = useMemo(() => {
    if (heroSliderSource === 'custom') return 'انتخاب دستی';
    if (heroSliderSource === 'library-folder') {
      const f = (libraryFolders || []).find((x) => x.id === heroSliderFolderId);
      return f ? `پوشه: ${f.name}` : 'پوشهٔ حذف‌شده';
    }
    if (heroSliderSource === 'favorite-folder') {
      const f = (favoriteFolders || []).find((x) => x.id === heroSliderFolderId);
      return f ? `پوشه علاقه‌مندی: ${f.name}` : 'پوشهٔ حذف‌شده';
    }
    return 'خودکار';
  }, [heroSliderSource, heroSliderFolderId, libraryFolders, favoriteFolders]);

  const libraryFolderCount = useMemo(() => {
    const counts = new Map();
    (library || []).forEach((item) => {
      if (!item?.folderId) return;
      counts.set(item.folderId, (counts.get(item.folderId) || 0) + 1);
    });
    return counts;
  }, [library]);

  const favoriteFolderCount = useMemo(() => {
    const counts = new Map();
    (favorites || []).forEach((item) => {
      if (!item?.favoriteFolderId) return;
      counts.set(item.favoriteFolderId, (counts.get(item.favoriteFolderId) || 0) + 1);
    });
    return counts;
  }, [favorites]);

  // مرحلهٔ ۵۰ §۵ — فهرستِ پنجرهٔ انتخابِ دستی: همهٔ کتاب‌هایِ
  // کتابخانه + مواردِ Recent که در کتابخانه نیستند، یکتا و با
  // جستجویِ سادهٔ نام/مسیر.
  const pickerBooks = useMemo(() => {
    const map = new Map();
    [...(library || []), ...(recentItems || [])].forEach((item) => {
      const rawP = item?.path || item?.filePath;
      if (!rawP) return;
      const norm = rawP.trim().replace(/[\\/]+/g, '\\').toLowerCase();
      if (norm && !map.has(norm)) map.set(norm, item);
    });
    const q = (pickerQuery || '').trim().toLowerCase();
    const all = Array.from(map.values());
    if (!q) return all;
    return all.filter((item) => {
      const name = (item?.name || item?.fileName || '').toLowerCase();
      const p = (item?.path || item?.filePath || '').toLowerCase();
      return name.includes(q) || p.includes(q);
    });
  }, [library, recentItems, pickerQuery]);

  const customPathSet = useMemo(
    () => new Set(customSliderBookPaths || []),
    [customSliderBookPaths]
  );

  const handlePickSource = useCallback(
    (sourceType, folderId = null) => {
      setHeroSliderSource(sourceType, folderId);
      setCurrentIndex(0);
      setSourceMenuOpen(false);
      setPickerOpen(false);
    },
    [setHeroSliderSource]
  );

  // باز کردنِ پنجرهٔ انتخابِ دستی، منبع را هم رویِ «انتخاب دستی»
  // می‌گذارد تا تیک‌زدن بی‌درنگ در اسلایدر دیده شود.
  const handleOpenPicker = useCallback(() => {
    if (heroSliderSource !== 'custom') setHeroSliderSource('custom');
    setCurrentIndex(0);
    setSourceMenuOpen(false);
    setPickerOpen(true);
  }, [heroSliderSource, setHeroSliderSource]);

  const handleTogglePickerBook = useCallback(
    (item) => {
      if (heroSliderSource !== 'custom') setHeroSliderSource('custom');
      toggleBookInHeroSlider(item);
    },
    [heroSliderSource, setHeroSliderSource, toggleBookInHeroSlider]
  );

  const emptyHint =
    heroSliderSource === 'custom'
      ? 'هنوز کتابی برایِ اسلایدر انتخاب نکرده‌ای؛ از دکمهٔ «منبع اسلایدر» کتاب‌ها را تیک بزن.'
      : 'این پوشه کتابی ندارد یا کتاب‌هایِ آن حذف شده‌اند؛ پوشهٔ دیگری را انتخاب کن یا به حالتِ خودکار برگرد.';

  // استخراج و همگام‌سازی زنده کاورها برای تمام اسلایدها
  useEffect(() => {
    let isMounted = true;

    slides.forEach((item) => {
      const rawPath = item?.path || item?.filePath;
      if (!rawPath) return;
      const norm = rawPath.trim().replace(/[\\/]+/g, '\\').toLowerCase();
      const failed = failedCoverUrlsRef.current;

      const fromStoreCache = resolveCoverUrl(cachedCovers?.[norm]);
      if (fromStoreCache && !failed.has(fromStoreCache)) {
        setResolvedCovers((prev) =>
          prev[norm] === fromStoreCache ? prev : { ...prev, [norm]: fromStoreCache }
        );
        return;
      }

      const directCover =
        resolveCoverUrl(item?.cover) || thumbnailService.peekCover(rawPath);
      if (directCover && !failed.has(directCover)) {
        setResolvedCovers((prev) =>
          prev[norm] === directCover ? prev : { ...prev, [norm]: directCover }
        );
        return;
      }

      // مرحله ۴۷ §۲: استخراجِ دوباره فقط یک‌بار برایِ هر مسیر
      // امتحان می‌شود تا خطایِ تصویر، حلقهٔ درخواست نسازد.
      if (retriedNormsRef.current.has(norm)) return;
      retriedNormsRef.current.add(norm);
      thumbnailService.getThumbnail(rawPath).then((thumb) => {
        if (isMounted && thumb && !failed.has(thumb)) {
          setResolvedCovers((prev) => ({ ...prev, [norm]: thumb }));
        }
      });
    });

    return () => {
      isMounted = false;
    };
  }, [slides, cachedCovers, coverRetryTick]);

  // مرحله ۴۷ §۲ — خطایِ پوستر، اسلاید را خالی نمی‌گذارد: نشانیِ
  // خراب کنار گذاشته می‌شود تا کاورِ سالمِ آیتم (یا استخراجِ دوباره)
  // جایش بنشیند؛ اگر هیچ مرجعی نبود، پس‌زمینهٔ جایگزین می‌ماند.
  const handlePosterError = useCallback((norm, badSrc) => {
    if (badSrc) failedCoverUrlsRef.current.add(badSrc);
    if (!norm) return;
    setResolvedCovers((prev) => {
      if (!(norm in prev)) return prev;
      const next = { ...prev };
      delete next[norm];
      return next;
    });
    setCoverRetryTick((t) => t + 1);
  }, []);

  const moveSlider = useCallback(
    (dir) => {
      if (totalSlides <= 1) return;
      setCurrentIndex((prev) => (prev - dir + totalSlides) % totalSlides);
    },
    [totalSlides]
  );

  const goToSlide = useCallback(
    (index) => {
      if (index === currentIndex || index < 0 || index >= totalSlides) return;
      setCurrentIndex(index);
    },
    [currentIndex, totalSlides]
  );

  // تایمر پخش خودکار ۶ ثانیه‌ای با توقف در زمان هاور یا درگ
  useEffect(() => {
    if (totalSlides <= 1 || isHovered || isDragging) return;
    const timer = setInterval(() => {
      moveSlider(-1);
    }, AUTO_PLAY_MS);
    return () => clearInterval(timer);
  }, [totalSlides, isHovered, isDragging, moveSlider]);

  // ناوبری با کلیدهای چپ و راست کیبورد (فقط زمانی که فوکوس در اینپوت نباشد)
  useEffect(() => {
    if (totalSlides <= 1) return;
    const handleKeyDown = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowLeft') moveSlider(1);
      if (e.key === 'ArrowRight') moveSlider(-1);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [totalSlides, moveSlider]);

  // مدیریت کشیدن اسلایدر با ماوس (Drag)
  const handleMouseDown = (e) => {
    if (totalSlides <= 1) return;
    if (e.target.closest('button') || e.target.closest('.eq-controls')) return;
    setIsDragging(true);
    hasDraggedRef.current = false;
    dragStartXRef.current = e.clientX;
    dragCurrentXRef.current = e.clientX;
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    dragCurrentXRef.current = e.clientX;
    if (Math.abs(dragCurrentXRef.current - dragStartXRef.current) > 6) {
      hasDraggedRef.current = true;
    }
  };

  const handleMouseUp = () => {
    if (!isDragging) return;
    setIsDragging(false);
    const diff = dragCurrentXRef.current - dragStartXRef.current;
    if (hasDraggedRef.current && Math.abs(diff) > 70) {
      if (diff > 0) moveSlider(-1);
      else moveSlider(1);
    }
  };

  // مدیریت لمس (Touch)
  const touchStartXRef = useRef(0);
  const touchCurrentXRef = useRef(0);

  const handleTouchStart = (e) => {
    if (totalSlides <= 1) return;
    if (e.target.closest && e.target.closest('.eq-controls')) return;
    touchStartXRef.current = e.changedTouches[0].screenX;
    touchCurrentXRef.current = touchStartXRef.current;
  };

  const handleTouchMove = (e) => {
    touchCurrentXRef.current = e.changedTouches[0].screenX;
  };

  const handleTouchEnd = () => {
    const diff = touchCurrentXRef.current - touchStartXRef.current;
    if (Math.abs(diff) > 70) {
      if (diff > 0) moveSlider(-1);
      else moveSlider(1);
    }
  };

  const handleCustomCoverClick = async (e, slideItem) => {
    e.stopPropagation();
    if (hasDraggedRef.current) return;
    const rawPath = slideItem?.path || slideItem?.filePath;
    if (!rawPath) return;

    const res = await selectAndSetCustomCover(rawPath);
    if (res?.success && res?.cover) {
      thumbnailService.seedCover?.(rawPath, res.cover);
      showToast('کاور سفارشی اسلاید با موفقیت بروزرسانی شد', { type: 'success' });
    }
  };

  // مرحلهٔ ۵۰ §۵ — پیشگیریِ ۱: منبعِ خالی هرگز کرش نمی‌کند؛ در
  // حالتِ خودکار رفتارِ قبلی (رندر نشدن) حفظ می‌شود و در حالت‌هایِ
  // دستی/پوشه، بنرِ راهنما با دکمهٔ بازگشت به خودکار نشان داده می‌شود.
  if (totalSlides === 0 && heroSliderSource === 'auto') return null;

  // مرحلهٔ ۵۱ §۲ — منویِ منبعِ اسلایدر (بدونِ نوارِ بیرونی):
  // دکمهٔ «منبع» به داخلِ کارت منتقل شد (ردیفِ دکمه‌هایِ عملیاتِ
  // اسلاید + بنرِ خالی) و فقط منویِ شیشه‌ایِ انتخابِ منبع و پنجرهٔ
  // تیک‌زدنِ کتاب‌ها اینجا رندر می‌شوند؛ منو رویِ کارت باز می‌شود
  // (zIndex 80) و با بک‌دراپ بسته می‌شود. تابعِ سادهٔ JSX است،
  // نه کامپوننتِ جدا — هوک ندارد.
  const renderSourceMenu = () => (
    <>
      {sourceMenuOpen && (
        <div
          className="kinetic-source-menu"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={`kinetic-source-item${heroSliderSource === 'auto' ? ' active' : ''}`}
            onClick={() => handlePickSource('auto')}
          >
            <span>خودکار (پین‌شده‌ها و اخیر)</span>
            {heroSliderSource === 'auto' && <Icons.Check size={13} />}
          </button>
          <button
            type="button"
            className={`kinetic-source-item${heroSliderSource === 'custom' ? ' active' : ''}`}
            onClick={handleOpenPicker}
          >
            <span>انتخاب دستی کتاب‌ها ({customSliderBookPaths.length} کتاب)</span>
            {heroSliderSource === 'custom' && <Icons.Check size={13} />}
          </button>
          <div className="kinetic-source-sep">پوشه‌های کتابخانه</div>
          {(libraryFolders || []).length === 0 && (
            <div className="kinetic-source-sep">پوشه‌ای نیست</div>
          )}
          {(libraryFolders || []).map((f) => (
            <button
              key={f.id}
              type="button"
              className={`kinetic-source-item${heroSliderSource === 'library-folder' && heroSliderFolderId === f.id ? ' active' : ''}`}
              onClick={() => handlePickSource('library-folder', f.id)}
            >
              <span>
                پوشه: {f.name} ({libraryFolderCount.get(f.id) || 0} کتاب)
              </span>
              {heroSliderSource === 'library-folder' && heroSliderFolderId === f.id && (
                <Icons.Check size={13} />
              )}
            </button>
          ))}
          <div className="kinetic-source-sep">پوشه‌های علاقه‌مندی</div>
          {(favoriteFolders || []).length === 0 && (
            <div className="kinetic-source-sep">پوشه‌ای نیست</div>
          )}
          {(favoriteFolders || []).map((f) => (
            <button
              key={f.id}
              type="button"
              className={`kinetic-source-item${heroSliderSource === 'favorite-folder' && heroSliderFolderId === f.id ? ' active' : ''}`}
              onClick={() => handlePickSource('favorite-folder', f.id)}
            >
              <span>
                پوشه علاقه‌مندی: {f.name} ({favoriteFolderCount.get(f.id) || 0} کتاب)
              </span>
              {heroSliderSource === 'favorite-folder' && heroSliderFolderId === f.id && (
                <Icons.Check size={13} />
              )}
            </button>
          ))}
        </div>
      )}
      {pickerOpen && (
        <div
          className="kinetic-picker"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="kinetic-picker-head">
            <span className="kinetic-picker-title">
              انتخاب دستی کتاب‌ها ({customSliderBookPaths.length} انتخاب‌شده)
            </span>
            <button
              type="button"
              className="kinetic-picker-clear"
              onClick={() => setCustomSliderBookPaths([])}
            >
              پاک کردن همه
            </button>
            <button
              type="button"
              className="kinetic-picker-close"
              onClick={() => setPickerOpen(false)}
              title="بستن"
            >
              <Icons.X size={14} />
            </button>
          </div>
          <input
            type="text"
            className="kinetic-picker-search"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="جستجویِ نام یا مسیر کتاب..."
          />
          <div className="kinetic-picker-list">
            {pickerBooks.length === 0 && (
              <div className="kinetic-source-sep">کتابی پیدا نشد</div>
            )}
            {pickerBooks.map((book) => {
              const rawP = book?.path || book?.filePath || '';
              const norm = rawP.trim().replace(/[\\/]+/g, '\\').toLowerCase();
              const checked = customPathSet.has(norm);
              const title =
                book?.name || book?.fileName || rawP.split(/[\\/]/).pop() || 'Untitled';
              return (
                <div
                  key={rawP || title}
                  className="kinetic-picker-row"
                  onClick={() => handleTogglePickerBook(book)}
                >
                  <button
                    type="button"
                    className={`kinetic-picker-check${checked ? ' on' : ''}`}
                    aria-label={checked ? 'حذف از اسلایدر' : 'افزودن به اسلایدر'}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePickerBook(book);
                    }}
                  >
                    {checked && <Icons.Check size={13} />}
                  </button>
                  <span className="kinetic-picker-name" title={rawP}>
                    {title}
                  </span>
                  <span className="kinetic-picker-path" title={rawP}>
                    {rawP}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );


  return (
    <>
      <style>{`
        .kinetic-slider-wrapper {
          width: 100%;
          margin: 0 auto;
          position: relative;
        }
        .kinetic-source-backdrop {
          position: fixed;
          inset: 0;
          z-index: 39;
          background: transparent;
        }
        /* مرحلهٔ ۵۱ §۲ — منو و پنجره نسبت به رپرِ اسلایدر (بالایِ کارت)
           باز می‌شوند؛ zIndex 80 بالاتر از بک‌دراپ (39) است. */
        .kinetic-source-menu {
          position: absolute;
          top: 8px;
          right: 0;
          min-width: 290px;
          max-width: 360px;
          max-height: 330px;
          overflow-y: auto;
          background: rgba(16, 20, 28, 0.97);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 14px;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.65);
          padding: 6px;
          z-index: 80;
        }
        .kinetic-source-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          text-align: right;
          background: transparent;
          border: 0;
          color: #ffffff;
          font-family: var(--font-fa);
          font-size: 12.5px;
          font-weight: 600;
          padding: 9px 10px;
          border-radius: 9px;
          cursor: pointer;
        }
        .kinetic-source-item:hover {
          background: rgba(34, 211, 238, 0.12);
        }
        .kinetic-source-item.active {
          background: rgba(34, 211, 238, 0.16);
          color: #22d3ee;
        }
        .kinetic-source-sep {
          font-family: var(--font-fa);
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          padding: 8px 10px 4px;
        }
        .kinetic-picker {
          position: absolute;
          top: 8px;
          right: 0;
          left: 0;
          max-height: 360px;
          display: flex;
          flex-direction: column;
          background: rgba(16, 20, 28, 0.97);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 14px;
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.65);
          padding: 10px;
          z-index: 80;
        }
        .kinetic-picker-head {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .kinetic-picker-title {
          flex: 1;
          font-family: var(--font-fa);
          font-size: 13px;
          font-weight: 700;
          color: #ffffff;
        }
        .kinetic-picker-clear {
          background: transparent;
          border: 0;
          color: #f72585;
          font-family: var(--font-fa);
          font-size: 11.5px;
          font-weight: 700;
          cursor: pointer;
          padding: 4px 6px;
        }
        .kinetic-picker-close {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 8px;
          color: #ffffff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 26px;
          height: 26px;
          padding: 0;
        }
        .kinetic-picker-search {
          margin-top: 8px;
          width: 100%;
          box-sizing: border-box;
          padding: 8px 10px;
          border-radius: 9px;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.06);
          color: #ffffff;
          font-family: var(--font-fa);
          font-size: 12px;
          outline: none;
        }
        .kinetic-picker-list {
          margin-top: 8px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .kinetic-picker-row {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 8px;
          border-radius: 9px;
          cursor: pointer;
          min-width: 0;
        }
        .kinetic-picker-row:hover {
          background: rgba(255, 255, 255, 0.06);
        }
        .kinetic-picker-check {
          width: 22px;
          height: 22px;
          border-radius: 7px;
          border: 2px solid rgba(255, 255, 255, 0.35);
          background: transparent;
          color: #ffffff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          flex-shrink: 0;
        }
        .kinetic-picker-check.on {
          background: #22d3ee;
          border-color: #22d3ee;
        }
        .kinetic-picker-name {
          font-family: var(--font-fa);
          font-size: 12.5px;
          font-weight: 700;
          color: #ffffff;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 42%;
        }
        .kinetic-picker-path {
          font-family: var(--font-mono);
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          direction: ltr;
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          flex: 1;
        }
        .kinetic-empty {
          border: 1px dashed rgba(34, 211, 238, 0.45);
          border-radius: 20px;
          background: rgba(34, 211, 238, 0.06);
          padding: 30px 24px;
          text-align: center;
          font-family: var(--font-fa);
        }
        .kinetic-empty-title {
          font-size: 15px;
          font-weight: 800;
          color: #ffffff;
          margin-bottom: 8px;
        }
        .kinetic-empty-text {
          font-size: 12.5px;
          line-height: 1.9;
          color: rgba(255, 255, 255, 0.75);
          margin: 0 0 16px;
        }
        .kinetic-empty-actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          flex-wrap: wrap;
        }
        .kinetic-slider-container {
          position: relative;
          border-radius: 20px;
          overflow: hidden;
          height: 350px;
          cursor: grab;
          user-select: none;
          touch-action: pan-y;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: #0a0a0f;
          box-shadow: 0 18px 44px rgba(0, 0, 0, 0.65);
        }
        .kinetic-slider-container.is-dragging {
          cursor: grabbing;
        }
        .kinetic-slider-container.is-dragging .kinetic-slide {
          transition: none !important;
        }
        .kinetic-slide {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 28px 38px 110px;
          gap: 28px;
          opacity: 0;
          pointer-events: none;
          z-index: 1;
        }
        .kinetic-slide.active {
          opacity: 1;
          pointer-events: all;
          z-index: 2;
        }
        .kinetic-slide.exit {
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .kinetic-slide.active .kinetic-slide-title {
          animation: kinetic-title-anim 0.8s cubic-bezier(0.22, 1, 0.36, 1) 0.1s both;
        }
        @keyframes kinetic-title-anim {
          0% {
            transform: translateX(80px);
            opacity: 0;
            filter: blur(8px);
          }
          60% {
            transform: translateX(-8px);
          }
          100% {
            transform: translateX(0);
            opacity: 1;
            filter: blur(0);
          }
        }
        .kinetic-slide.active .kinetic-slide-path {
          animation: kinetic-path-anim 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.2s both;
        }
        @keyframes kinetic-path-anim {
          0% {
            transform: translateX(40px);
            opacity: 0;
          }
          100% {
            transform: translateX(0);
            opacity: 1;
          }
        }
        .kinetic-slide.active .kinetic-slide-tags {
          animation: kinetic-tags-anim 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.3s both;
        }
        @keyframes kinetic-tags-anim {
          0% {
            transform: translateY(15px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .kinetic-slide.active .kinetic-slide-actions {
          animation: kinetic-btns-anim 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.4s both;
        }
        @keyframes kinetic-btns-anim {
          0% {
            transform: translateY(20px);
            opacity: 0;
          }
          100% {
            transform: translateY(0);
            opacity: 1;
          }
        }
        .kinetic-slide-bg {
          position: absolute;
          inset: 0;
          background-size: cover;
          background-position: center;
          z-index: 0;
          transition: transform 1.2s ease;
          filter: saturate(1.15);
        }
        .kinetic-slide.active .kinetic-slide-bg {
          transform: scale(1.06);
        }
        .kinetic-slide-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(
            to left,
            rgba(10, 10, 15, 0.96) 0%,
            rgba(10, 10, 15, 0.88) 40%,
            rgba(10, 10, 15, 0.62) 70%,
            rgba(10, 10, 15, 0.32) 100%
          );
          z-index: 1;
        }
        .kinetic-slide-overlay::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 55%;
          background: linear-gradient(to top, rgba(10, 10, 15, 0.96), transparent);
        }
        .kinetic-slide-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 12px;
          z-index: 2;
          max-width: 74%;
          overflow: hidden;
        }
        .kinetic-slide-tags {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          align-items: center;
        }
        .kinetic-slide-tag {
          padding: 4px 12px;
          border-radius: 16px;
          font-family: var(--font-fa);
          font-size: 11px;
          font-weight: 600;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .kinetic-tag-slide {
          background: rgba(247, 37, 133, 0.14);
          color: #f72585;
          border: 1px solid rgba(247, 37, 133, 0.28);
        }
        .kinetic-tag-drag {
          background: rgba(255, 255, 255, 0.06);
          color: rgba(255, 255, 255, 0.65);
          border: 1px solid rgba(255, 255, 255, 0.12);
        }
        .kinetic-tag-fav {
          background: rgba(167, 139, 250, 0.14);
          color: #a78bfa;
          border: 1px solid rgba(167, 139, 250, 0.28);
        }
        .kinetic-tag-pin {
          background: rgba(34, 211, 238, 0.14);
          color: #22d3ee;
          border: 1px solid rgba(34, 211, 238, 0.28);
        }
        .kinetic-slide-title {
          font-family: var(--font-latin), var(--font-fa);
          font-size: 23px;
          font-weight: 800;
          line-height: 1.35;
          color: #ffffff;
          margin: 0;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          direction: ltr;
          text-align: right;
        }
        .kinetic-slide-path {
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: rgba(247, 37, 133, 0.68);
          direction: ltr;
          text-align: right;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          margin: 0;
        }
        .kinetic-slide-actions {
          display: flex;
          gap: 10px;
          align-items: center;
          margin-top: 6px;
          flex-wrap: wrap;
        }
        .btn-morph {
          padding: 10px 20px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.18);
          background: rgba(255, 255, 255, 0.07);
          backdrop-filter: blur(15px);
          -webkit-backdrop-filter: blur(15px);
          color: #ffffff;
          font-family: var(--font-fa);
          font-weight: 700;
          font-size: 12.5px;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          display: inline-flex;
          align-items: center;
          gap: 8px;
          position: relative;
          overflow: hidden;
          outline: none;
        }
        .btn-morph:hover {
          background: rgba(255, 255, 255, 0.14);
          border-color: rgba(255, 255, 255, 0.32);
          transform: translateY(-2px);
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        }
        .btn-morph:active {
          transform: translateY(0);
        }
        .btn-morph-fav {
          background: rgba(247, 37, 133, 0.1);
          border-color: rgba(247, 37, 133, 0.25);
          color: #f72585;
        }
        .btn-morph-fav:hover {
          background: rgba(247, 37, 133, 0.18);
          border-color: rgba(247, 37, 133, 0.42);
        }
        .btn-morph-subtle {
          padding: 10px 14px;
          background: rgba(34, 211, 238, 0.08);
          border-color: rgba(34, 211, 238, 0.24);
          color: #22d3ee;
        }
        .btn-morph-subtle:hover {
          background: rgba(34, 211, 238, 0.16);
          border-color: rgba(34, 211, 238, 0.4);
        }
        .kinetic-poster-card {
          width: 146px;
          aspect-ratio: 3 / 4;
          border-radius: 14px;
          overflow: hidden;
          z-index: 2;
          flex-shrink: 0;
          border: 1px solid rgba(255, 255, 255, 0.16);
          box-shadow: 0 14px 34px rgba(0, 0, 0, 0.75);
          background: rgba(15, 23, 28, 0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .kinetic-poster-card img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
      `}</style>

      <div className="kinetic-slider-wrapper">
        {(sourceMenuOpen || pickerOpen) && (
          <div
            className="kinetic-source-backdrop"
            onClick={() => {
              setSourceMenuOpen(false);
              setPickerOpen(false);
            }}
          />
        )}
        {totalSlides === 0 ? (
          <div className="kinetic-empty">
            <div className="kinetic-empty-title">اسلایدر خالی است</div>
            <p className="kinetic-empty-text">{emptyHint}</p>
            <div className="kinetic-empty-actions">
              <button type="button" className="btn-morph" onClick={handleOpenPicker}>
                انتخاب کتاب‌ها
              </button>
              <button
                type="button"
                className="btn-morph btn-morph-subtle"
                onClick={() => handlePickSource('auto')}
              >
                بازگشت به حالت خودکار
              </button>
              {/* مرحلهٔ ۵۱ §۲ — در حالتِ خالی کارتی نیست؛ دکمهٔ منبع
                  اینجا می‌ماند تا راهنمایِ بنر («از دکمهٔ منبع
                  اسلایدر...») به دکمه‌ای واقعی اشاره کند. */}
              <button
                type="button"
                className="btn-morph btn-morph-subtle"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setPickerOpen(false);
                  setSourceMenuOpen((prev) => !prev);
                }}
                title="تغییرِ منبعِ کتاب‌هایِ اسلایدر"
              >
                <Icons.Sliders size={14} />
                <span>منبع: {sourceLabel}</span>
              </button>
            </div>
          </div>
        ) : (
        <div
          className={`kinetic-slider-container ${isDragging ? 'is-dragging' : ''}`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            setIsHovered(false);
            if (isDragging) setIsDragging(false);
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {slides.map((item, idx) => {
            const isActive = idx === safeIndex;
            const rawPath = item?.path || item?.filePath || '';
            // مرحله ۴۷ §۲: اسلایدِ بدونِ مسیر، هویتِ یکتا ندارد و با
            // کلیدِ اندیسی، پس از جابه‌جاییِ پین، محتوایِ اسلایدِ
            // دیگری را می‌گرفت؛ رندر نمی‌شود.
            if (!rawPath) return null;
            const norm = rawPath.trim().replace(/[\\/]+/g, '\\').toLowerCase();
            const title =
              item?.name || item?.fileName || rawPath.split(/[\\/]/).pop() || 'Untitled';
            // مرحله ۴۷ §۲: نشانیِ خرابِ کاور کنار گذاشته می‌شود تا
            // پوستر، تصویرِ شکسته نشان ندهد و پس‌زمینهٔ جایگزین بیاید.
            const rawCover =
              resolvedCovers[norm] || resolveCoverUrl(item?.cover) || null;
            const coverSrc =
              rawCover && !failedCoverUrlsRef.current.has(rawCover) ? rawCover : null;
            const fallbackBg =
              FALLBACK_SLIDE_BACKGROUNDS[idx % FALLBACK_SLIDE_BACKGROUNDS.length];

            const isFav = (favorites || []).some(
              (f) =>
                (f.path || f.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
                norm
            );
            const isPinned = Boolean(item?.isPinned);
            // مرحلهٔ ۵۲ §۱: اسلایدِ فایلِ حذف‌شده (پرچم از استور).
            const isMissing = Boolean(item?.isMissing);
            const lastPage = item?.lastPage || item?.currentPage || 1;
            const totalPages = item?.totalPages || 1;

            return (
              <div
                key={rawPath}
                className={`kinetic-slide ${isActive ? 'active' : 'exit'}`}
                data-index={idx}
              >
                <div
                  className="kinetic-slide-bg"
                  style={{
                    backgroundImage: coverSrc ? `url("${coverSrc}")` : fallbackBg,
                  }}
                />
                <div className="kinetic-slide-overlay" />

                <div className="kinetic-slide-main">
                  <div className="kinetic-slide-tags">
                    <span className="kinetic-slide-tag kinetic-tag-slide">
                      <Icons.Layers size={12} />
                      <span>
                        اسلاید {idx + 1} از {totalSlides}
                      </span>
                    </span>

                    <span className="kinetic-slide-tag kinetic-tag-drag">
                      <Icons.MoveHorizontal size={12} />
                      <span>قابلیت کشیدن با موس</span>
                    </span>

                    {isPinned && (
                      <span className="kinetic-slide-tag kinetic-tag-pin">
                        <Icons.Pin size={12} filled />
                        <span>پین‌شده</span>
                      </span>
                    )}

                    {isFav && (
                      <span className="kinetic-slide-tag kinetic-tag-fav">
                        <Icons.Heart size={12} filled fillColor="#a78bfa" />
                        <span>مورد علاقه</span>
                      </span>
                    )}

                    {/* مرحلهٔ ۵۲ §۱: چیپِ هشدارِ فایلِ حذف‌شده در ردیفِ چیپ‌هایِ بالا */}
                    {isMissing && (
                      <span
                        className="kinetic-slide-tag"
                        style={{
                          background: 'rgba(239, 68, 68, 0.92)',
                          border: '1px solid #fca5a5',
                          color: '#ffffff',
                          fontWeight: 800,
                        }}
                      >
                        <Icons.AlertTriangle size={12} />
                        <span>هشدار: فایل از سیستم حذف شده است</span>
                      </span>
                    )}

                    {totalPages > 1 && (
                      <span className="kinetic-slide-tag kinetic-tag-drag">
                        <span>
                          صفحه {lastPage} از {totalPages}
                        </span>
                      </span>
                    )}
                  </div>

                  <h2 className="kinetic-slide-title" title={title}>
                    {title}
                  </h2>

                  <p className="kinetic-slide-path" title={rawPath}>
                    {rawPath}
                  </p>

                  <div className="kinetic-slide-actions">
                    <button
                      type="button"
                      className="btn-morph"
                      disabled={isMissing}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasDraggedRef.current) return;
                        // مرحلهٔ ۵۲ §۱: اسلایدِ حذف‌شده هرگز ریدر را
                        // باز نمی‌کند (دکمه هم disabled است؛ این
                        // گارد، لایهٔ دوم است).
                        if (isMissing) return;
                        onOpenComic?.(item);
                      }}
                      style={
                        isMissing
                          ? { opacity: 0.55, cursor: 'not-allowed' }
                          : undefined
                      }
                      title={isMissing ? 'فایل در سیستم موجود نیست' : undefined}
                    >
                      <Icons.BookOpen size={15} />
                      <span>{isMissing ? 'فایل در سیستم موجود نیست' : 'ادامه مطالعه این عنوان'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-morph btn-morph-fav"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasDraggedRef.current) return;
                        const added = toggleFavorite(item);
                        showToast(
                          added
                            ? 'به علاقه‌مندی‌ها اضافه شد'
                            : 'از علاقه‌مندی‌ها حذف شد',
                          { type: added ? 'success' : 'info' }
                        );
                      }}
                    >
                      <Icons.Heart size={15} filled={isFav} fillColor="#f72585" />
                      <span>{isFav ? 'مورد علاقه' : 'علاقه‌مندی'}</span>
                    </button>

                    <button
                      type="button"
                      className="btn-morph btn-morph-subtle"
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (hasDraggedRef.current) return;
                        const pinnedNow = await togglePin(item);
                        showToast(
                          pinnedNow
                            ? 'در صدر کتابخانه پین شد'
                            : 'از حالت پین خارج شد',
                          { type: pinnedNow ? 'success' : 'info' }
                        );
                      }}
                      title="پین کردن در صدر کتابخانه"
                      style={isPinned ? {
                        background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.32), rgba(5, 150, 105, 0.22))',
                        border: '1px solid #10b981',
                        color: '#34d399',
                        boxShadow: '0 0 16px rgba(16, 185, 129, 0.35)',
                      } : undefined}
                    >
                      <Icons.Pin size={14} filled={isPinned} fillColor="currentColor" />
                      <span>{isPinned ? 'پین‌شده' : 'پین'}</span>
                    </button>

                    {heroSliderSource === 'custom' && (
                      <button
                        type="button"
                        className="btn-morph btn-morph-subtle"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (hasDraggedRef.current) return;
                          toggleBookInHeroSlider(item);
                          showToast('از اسلایدر حذف شد', { type: 'info' });
                        }}
                        title="حذف این کتاب از اسلایدر"
                      >
                        <Icons.Layers size={14} />
                        <span>حذف از اسلایدر</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-morph btn-morph-subtle"
                      onClick={(e) => handleCustomCoverClick(e, item)}
                      title="انتخاب تصویر کاور دلخواه برای این عنوان"
                    >
                      <Icons.Camera size={14} />
                      <span>تغییر کاور</span>
                    </button>

                    {/* مرحلهٔ ۵۱ §۲ — دکمهٔ منبعِ اسلایدر داخلِ کارت،
                        کنارِ دکمه‌هایِ عملیات؛ onMouseDown و onClick
                        انتشار را می‌گیرند تا کلیک نه اسلاید را بکشد
                        و نه کتاب را باز کند. */}
                    <button
                      type="button"
                      className="btn-morph btn-morph-subtle"
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasDraggedRef.current) return;
                        setPickerOpen(false);
                        setSourceMenuOpen((prev) => !prev);
                      }}
                      title="تغییرِ منبعِ کتاب‌هایِ اسلایدر"
                    >
                      <Icons.Sliders size={14} />
                      <span>منبع: {sourceLabel}</span>
                    </button>
                  </div>
                </div>

                {/* پوستر شفاف سمت چپ اسلاید */}
                <div
                  className="kinetic-poster-card"
                  onClick={(e) => handleCustomCoverClick(e, item)}
                  title="کلیک برای تغییر تصویر کاور"
                  style={{ cursor: 'pointer' }}
                >
                  {coverSrc ? (
                    <img
                      src={coverSrc}
                      alt={title}
                      draggable={false}
                      onError={() => handlePosterError(norm, coverSrc)}
                    />
                  ) : (
                    <span style={{ color: '#f72585', display: 'flex' }}>
                      <Icons.BookOpen size={38} />
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* مرحلهٔ ۳۸ §۱: کنترلِ موجِ صوتی بالاتر، بلافاصله زیرِ
              دکمه‌هایِ عملیات (ادامه مطالعه / علاقه‌مندی / پین /
              تغییر کاور) — مطلق در پایینِ داخلِ کانتینر با bottom
              22px (نه 12px مرحلهٔ ۳۷)؛ پدینگِ پایینیِ اسلاید 110px
              است تا دکمه‌ها 18px بالایِ لبهٔ بالاییِ موج بنشینند و
              موج کاملاً درونِ قاب دیده شود. */}
          {totalSlides >= 1 && (
            <div
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ position: 'absolute', bottom: '22px', left: '50%', transform: 'translateX(-50%)', zIndex: 35, pointerEvents: 'auto', overflow: 'visible', marginTop: '18px', marginBottom: '6px' }}
            >
              <SliderControls
                currentIndex={safeIndex}
                total={totalSlides}
                onPrev={() => moveSlider(1)}
                onNext={() => moveSlider(-1)}
                onSelect={goToSlide}
                variant={heroSliderVariant}
              />
            </div>
          )}
        </div>
        )}
        {renderSourceMenu()}
      </div>
    </>
  );
}