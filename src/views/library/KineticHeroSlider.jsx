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

export default function KineticHeroSlider({ items = [], onOpenComic }) {
  const favorites = useLibraryStore((state) => state.favorites);
  const cachedCovers = useLibraryStore((state) => state.cachedCovers);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const togglePin = useLibraryStore((state) => state.togglePin);
  const selectAndSetCustomCover = useLibraryStore((state) => state.selectAndSetCustomCover);
  const showToast = useAppStore((state) => state.showToast);
  const heroSliderVariant = useSettingsStore((state) => state.preferences?.heroSliderVariant || 'mirror');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [resolvedCovers, setResolvedCovers] = useState({});

  const dragStartXRef = useRef(0);
  const dragCurrentXRef = useRef(0);
  const hasDraggedRef = useRef(false);

  const slides = useMemo(() => (Array.isArray(items) ? items.slice(0, 7) : []), [items]);
  const totalSlides = slides.length;

  useEffect(() => {
    if (currentIndex >= totalSlides && totalSlides > 0) {
      setCurrentIndex(0);
    }
  }, [totalSlides, currentIndex]);

  // استخراج و همگام‌سازی زنده کاورها برای تمام اسلایدها
  useEffect(() => {
    let isMounted = true;

    slides.forEach((item) => {
      const rawPath = item?.path || item?.filePath;
      if (!rawPath) return;
      const norm = rawPath.trim().replace(/[\\/]+/g, '\\').toLowerCase();

      const fromStoreCache = resolveCoverUrl(cachedCovers?.[norm]);
      if (fromStoreCache) {
        setResolvedCovers((prev) =>
          prev[norm] === fromStoreCache ? prev : { ...prev, [norm]: fromStoreCache }
        );
        return;
      }

      const directCover =
        resolveCoverUrl(item?.cover) || thumbnailService.peekCover(rawPath);
      if (directCover) {
        setResolvedCovers((prev) =>
          prev[norm] === directCover ? prev : { ...prev, [norm]: directCover }
        );
        return;
      }

      thumbnailService.getThumbnail(rawPath).then((thumb) => {
        if (isMounted && thumb) {
          setResolvedCovers((prev) => ({ ...prev, [norm]: thumb }));
        }
      });
    });

    return () => {
      isMounted = false;
    };
  }, [slides, cachedCovers]);

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

  if (totalSlides === 0) return null;


  return (
    <>
      <style>{`
        .kinetic-slider-wrapper {
          width: 100%;
          margin: 0 auto;
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
            const isActive = idx === currentIndex;
            const rawPath = item?.path || item?.filePath || '';
            const norm = rawPath.trim().replace(/[\\/]+/g, '\\').toLowerCase();
            const title =
              item?.name || item?.fileName || rawPath.split(/[\\/]/).pop() || 'Untitled';
            const coverSrc =
              resolvedCovers[norm] || resolveCoverUrl(item?.cover) || null;
            const fallbackBg =
              FALLBACK_SLIDE_BACKGROUNDS[idx % FALLBACK_SLIDE_BACKGROUNDS.length];

            const isFav = (favorites || []).some(
              (f) =>
                (f.path || f.filePath || '').trim().replace(/[\\/]+/g, '\\').toLowerCase() ===
                norm
            );
            const isPinned = Boolean(item?.isPinned);
            const lastPage = item?.lastPage || item?.currentPage || 1;
            const totalPages = item?.totalPages || 1;

            return (
              <div
                key={rawPath || idx}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasDraggedRef.current) return;
                        onOpenComic?.(item);
                      }}
                    >
                      <Icons.BookOpen size={15} />
                      <span>ادامه مطالعه این عنوان</span>
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

                    <button
                      type="button"
                      className="btn-morph btn-morph-subtle"
                      onClick={(e) => handleCustomCoverClick(e, item)}
                      title="انتخاب تصویر کاور دلخواه برای این عنوان"
                    >
                      <Icons.Camera size={14} />
                      <span>تغییر کاور</span>
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
                    <img src={coverSrc} alt={title} draggable={false} />
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
                currentIndex={currentIndex}
                total={totalSlides}
                onPrev={() => moveSlider(1)}
                onNext={() => moveSlider(-1)}
                onSelect={goToSlide}
                variant={heroSliderVariant}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}