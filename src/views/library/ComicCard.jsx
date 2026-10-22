import React, { useState, useEffect, useMemo, useCallback } from 'react';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import { coreApi } from '../../services/coreApi';
import thumbnailService, { resolveCoverUrl } from '../../services/thumbnailService';
import Icons from '../../components/common/Icons';

const COVER_GRADIENTS = [
  'linear-gradient(145deg, #0f171c 0%, #141d23 50%, #1d2a31 100%)',
  'linear-gradient(145deg, #121824 0%, #1e293b 50%, #0f172a 100%)',
  'linear-gradient(145deg, #132226 0%, #1b3a4b 50%, #0a0f13 100%)',
];

export default function ComicCard({
  item,
  onOpenComic,
  onRemove,
  showRemoveBtn = true,
}) {
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
        const fId = item?.folderId;
        if (!fId) return null;
        return (state.libraryFolders || []).find((f) => f.id === fId) || null;
      },
      [item?.folderId]
    )
  );

  const cachedCoverInStore = useLibraryStore(
    useCallback(
      (state) => (normPath ? state.cachedCovers?.[normPath] || null : null),
      [normPath]
    )
  );

  const libraryFolders = useLibraryStore((state) => state.libraryFolders || []);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const togglePin = useLibraryStore((state) => state.togglePin);
  const selectAndSetCustomCover = useLibraryStore(
    (state) => state.selectAndSetCustomCover
  );
  const assignToFolder = useLibraryStore((state) => state.assignToFolder);

  const showToast = useAppStore((state) => state.showToast);
  const openContextMenu = useAppStore((state) => state.openContextMenu);

  const title =
    item?.name || item?.fileName || filePath.split(/[\\/]/).pop() || 'Untitled';

  const [isHovered, setIsHovered] = useState(false);
  const [showFolderMenu, setShowFolderMenu] = useState(false);
  const [coverUrl, setCoverUrl] = useState(() => {
    return (
      resolveCoverUrl(cachedCoverInStore) ||
      resolveCoverUrl(item?.cover) ||
      thumbnailService.peekCover(filePath)
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

    const fromStore = resolveCoverUrl(cachedCoverInStore);
    if (fromStore) {
      setCoverUrl(fromStore);
      return;
    }

    const existing =
      resolveCoverUrl(item?.cover) || thumbnailService.peekCover(filePath);
    if (existing) {
      setCoverUrl(existing);
      return;
    }

    thumbnailService.getThumbnail(filePath).then((res) => {
      if (isMounted && res) {
        setCoverUrl(res);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [filePath, item?.cover, cachedCoverInStore]);

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
      cover: coverUrl,
    });
    showToast(
      pinnedNow
        ? `«${title}» در صدر کتابخانه پین شد`
        : `«${title}» از حالت پین خارج شد`,
      { type: pinnedNow ? 'success' : 'info' }
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
    await assignToFolder(
      { ...item, path: filePath, name: title, cover: coverUrl },
      folderId
    );
    const fObj = libraryFolders.find((f) => f.id === folderId);
    showToast(
      fObj ? `به پوشه «${fObj.name}» منتقل شد` : 'از پوشه خارج شد',
      { type: 'success' }
    );
  };

  const handleShowFolder = (e) => {
    e.stopPropagation();
    if (filePath) coreApi.showItemInFolder(filePath);
  };

  const handleRemoveClick = (e) => {
    e.stopPropagation();
    if (onRemove) onRemove(filePath, title);
  };

  const handleCardContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    openContextMenu?.(
      { x: e.clientX, y: e.clientY },
      {
        comic: {
          ...item,
          path: filePath,
          name: title,
          cover: coverUrl,
        },
      }
    );
  };

  const handleDragStart = (e) => {
    if (filePath) {
      e.dataTransfer.setData('text/comic-path', filePath);
      e.dataTransfer.effectAllowed = 'move';
    }
  };

  const lastPageNum = item?.lastPage || item?.currentPage || null;

  return (
    <div
      draggable={Boolean(filePath)}
      onDragStart={handleDragStart}
      onClick={() => onOpenComic && onOpenComic(item)}
      onContextMenu={handleCardContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowFolderMenu(false);
      }}
      style={{
        ...styles.card,
        transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
        borderColor: isHovered
          ? 'var(--accent)'
          : isPinned
          ? 'rgba(34, 211, 238, 0.55)'
          : isFav
          ? 'rgba(248, 81, 73, 0.4)'
          : 'var(--border)',
        boxShadow: isHovered
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
            onError={() => setCoverUrl(null)}
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
              title="انتقال به پوشه کتابخانه"
            >
              <Icons.FolderPlus size={13} />
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
            style={styles.folderQuickMenu}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={styles.folderQuickMenuHeader}>انتقال به پوشه:</div>
            <div
              onClick={(e) => handleAssignFolder(e, null)}
              style={{
                ...styles.folderQuickItem,
                color: !item?.folderId ? 'var(--accent)' : 'var(--text)',
              }}
            >
              <span>بدون پوشه (نمای کلی)</span>
              {!item?.folderId && <Icons.Check size={12} />}
            </div>
            {libraryFolders.map((f) => {
              const isCurr = item?.folderId === f.id;
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