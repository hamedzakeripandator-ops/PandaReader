import React, { useState, useMemo } from 'react';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import ComicCard from '../library/ComicCard';
import Icons from '../../components/common/Icons';

// مرحله ۴۸ (B): رنگ‌های پوشه، دقیقاً همان فهرستِ LibraryView تا
// پوشه‌ها در هر دو نما یک رنگ داشته باشند.
const FOLDER_COLORS = [
  '#22d3ee',
  '#f72585',
  '#a78bfa',
  '#4ade80',
  '#facc15',
  '#fb923c',
];

export default function FavoritesView({ onOpenComic }) {
  const favorites = useLibraryStore((state) => state.favorites || []);
  const removeFromFavorites = useLibraryStore((state) => state.removeFromFavorites);
  const library = useLibraryStore((state) => state.library || []);
  const favoriteFolders = useLibraryStore((state) => state.favoriteFolders || []);
  const activeFavoriteFolderId = useLibraryStore(
    (state) => state.activeFavoriteFolderId || 'ALL'
  );
  const setActiveFavoriteFolder = useLibraryStore(
    (state) => state.setActiveFavoriteFolder
  );
  const createFavoriteFolder = useLibraryStore((state) => state.createFavoriteFolder);
  const renameFavoriteFolder = useLibraryStore((state) => state.renameFavoriteFolder);
  const deleteFavoriteFolder = useLibraryStore((state) => state.deleteFavoriteFolder);
  const assignToFavoriteFolder = useLibraryStore((state) => state.assignToFavoriteFolder);
  const { searchQuery, setCurrentView, showToast } = useAppStore();

  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'name' | 'progress'

  // استیت‌های مودال ساخت / ویرایش پوشه در علاقه‌مندی‌ها
  const [folderModal, setFolderModal] = useState(null); // { mode: 'create'|'edit', id, name, color }
  const [dragOverFolderId, setDragOverFolderId] = useState(null);

  // مرحله ۴۹ (C): غنی‌سازیِ علاقه‌مندی‌ها فقط با پین از کتابخانه.
  // پوشهٔ هر کارت، فقط favoriteFolderIdِ خودِ ردیفِ علاقه‌مندی است و
  // پوشهٔ کتاب در کتابخانه (favoriteFolderId) هیچ اثری رویِ این نما ندارد؛
  // پس بجِ پوشهٔ ComicCard، منویِ سریعِ پوشه و فیلترِ پوشه، فقط با
  // سیستمِ مستقلِ علاقه‌مندی‌ها کار می‌کنند. پین همچنان از کتابخانه
  // خوانده می‌شود، چون پین مفهومِ کتابخانه است، نه پوشه‌بندی.
  const enrichedFavorites = useMemo(() => {
    const libByNorm = new Map();
    (library || []).forEach((item) => {
      const rawP = item?.path || item?.filePath;
      const norm = rawP ? rawP.trim().replace(/[\\/]+/g, '\\').toLowerCase() : '';
      if (norm && !libByNorm.has(norm)) libByNorm.set(norm, item);
    });
    return (favorites || []).map((fav) => {
      const rawP = fav?.path || fav?.filePath;
      const norm = rawP ? rawP.trim().replace(/[\\/]+/g, '\\').toLowerCase() : '';
      const libMatch = norm ? libByNorm.get(norm) : null;
      return {
        ...fav,
        favoriteFolderId: fav.favoriteFolderId || null,
        isPinned: libMatch ? Boolean(libMatch.isPinned) : Boolean(fav.isPinned),
        // مرحلهٔ ۵۲ §۱: پرچمِ فایلِ حذف‌شده از ردیفِ علاقه‌مندی یا
        // ردیفِ کتابخانه (هر کدام که باشد) تا بجِ ComicCard در
        // نمایِ علاقه‌مندی‌ها هم دیده شود.
        isMissing: Boolean(fav.isMissing) || Boolean(libMatch?.isMissing),
      };
    });
  }, [favorites, library]);

  // محاسبه تعداد آیتم‌های هر پوشه در علاقه‌مندی‌ها
  const folderCounts = useMemo(() => {
    const counts = {
      ALL: enrichedFavorites.length,
      PINNED: 0,
      UNFOLDERED: 0,
    };
    favoriteFolders.forEach((f) => {
      counts[f.id] = 0;
    });

    enrichedFavorites.forEach((item) => {
      if (item.isPinned) counts.PINNED++;
      if (item.favoriteFolderId && counts[item.favoriteFolderId] !== undefined) {
        counts[item.favoriteFolderId]++;
      } else {
        counts.UNFOLDERED++;
      }
    });

    return counts;
  }, [enrichedFavorites, favoriteFolders]);

  const displayedFavorites = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    const list = (enrichedFavorites || []).filter((item) => {
      if (q) {
        const name = (item.name || item.fileName || '').toLowerCase();
        const path = (item.path || item.filePath || '').toLowerCase();
        if (!name.includes(q) && !path.includes(q)) return false;
      }

      // فیلتر بر اساس پوشه انتخاب‌شده
      if (activeFavoriteFolderId === 'PINNED' && !item.isPinned) return false;
      if (activeFavoriteFolderId === 'UNFOLDERED' && item.favoriteFolderId) return false;
      if (
        activeFavoriteFolderId &&
        !['ALL', 'PINNED', 'UNFOLDERED'].includes(activeFavoriteFolderId) &&
        item.favoriteFolderId !== activeFavoriteFolderId
      ) {
        return false;
      }
      return true;
    });

    return [...list].sort((a, b) => {
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '', 'fa');
      if (sortBy === 'progress') {
        const pA = a.percentage ?? a.progress ?? 0;
        const pB = b.percentage ?? b.progress ?? 0;
        return pB - pA;
      }
      return new Date(b.favoritedAt || 0) - new Date(a.favoritedAt || 0);
    });
  }, [enrichedFavorites, searchQuery, sortBy, activeFavoriteFolderId]);

  const activeFolderObject = useMemo(
    () => favoriteFolders.find((f) => f.id === activeFavoriteFolderId) || null,
    [favoriteFolders, activeFavoriteFolderId]
  );

  const handleRemoveFav = (path, title) => {
    removeFromFavorites(path);
    showToast(`«${title || 'کمیک'}» از علاقه‌مندی‌ها حذف شد`, { type: 'info' });
  };

  // ذخیره پوشه جدید یا ویرایش‌شده در دیتابیس
  const handleSaveFolderModal = async () => {
    if (!folderModal) return;
    const cleanName = (folderModal.name || '').trim();
    if (!cleanName) {
      showToast('لطفاً نام پوشه را وارد کنید', { type: 'warning' });
      return;
    }

    if (folderModal.mode === 'edit' && folderModal.id) {
      await renameFavoriteFolder(folderModal.id, cleanName, folderModal.color);
      showToast(`پوشه «${cleanName}» ویرایش شد`, { type: 'success' });
    } else {
      const created = await createFavoriteFolder(cleanName, folderModal.color);
      if (created?.id) {
        setActiveFavoriteFolder(created.id);
      }
      showToast(`پوشه «${cleanName}» ساخته و در دیتابیس ذخیره شد`, { type: 'success' });
    }
    setFolderModal(null);
  };

  const handleDeleteActiveFolder = async (folder) => {
    if (!folder?.id) return;
    await deleteFavoriteFolder(folder.id);
    showToast(`پوشه «${folder.name}» حذف شد`, { type: 'info' });
  };

  // رها کردن کارت کشیده‌شده روی تب پوشه (Drag & Drop to Folder)
  const handleDropCardOnFolder = async (e, targetFolderId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverFolderId(null);

    const draggedPath = e.dataTransfer.getData('text/comic-path');
    if (!draggedPath) return;

    const realFolderId =
      targetFolderId === 'ALL' || targetFolderId === 'UNFOLDERED'
        ? null
        : targetFolderId;

    await assignToFavoriteFolder(draggedPath, realFolderId);
    const targetFolderObj = favoriteFolders.find((f) => f.id === realFolderId);
    showToast(
      targetFolderObj
        ? `به پوشه «${targetFolderObj.name}» منتقل شد`
        : 'به نمای کلی علاقه‌مندی‌ها منتقل شد',
      { type: 'success' }
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.containerInner}>
      {/* هدر بخش علاقه‌مندی‌ها */}
      <div style={styles.header}>
        <div style={styles.titleWrap}>
          <div style={styles.headerIcon}>
            <Icons.Heart size={22} filled />
          </div>
          <div>
            <h2 style={styles.title}>علاقه‌مندی‌ها (Favorites)</h2>
            <span style={styles.subtitle}>
              {displayedFavorites.length} مانهوا / مانگا در لیست برگزیده‌ها
            </span>
          </div>
        </div>

        <div style={styles.controlsWrap}>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={styles.sortSelect}
          >
            <option value="newest">مرتب‌سازی: جدیدترین</option>
            <option value="name">مرتب‌سازی: نام (الفبا)</option>
            <option value="progress">مرتب‌سازی: بیشترین پیشرفت</option>
          </select>
        </div>
      </div>

      {/* ================================================================
          نوار پوشه‌بندی علاقه‌مندی‌ها (مرحله ۴۹ C) — همان ظاهر و
          رفتارِ کتابخانه، ولی با فهرستِ کاملاً مستقلِ favoriteFolders:
          ساختِ پوشه اینجا، در کتابخانه دیده نمی‌شود و برعکس.
          شمارندهٔ هر پوشه، ساخت/ویرایش/حذف پوشه و درگ‌ودراپِ کارت
          روی تب. پوشهٔ فعالِ این نما، از پوشهٔ فعالِ کتابخانه جداست.
      ================================================================ */}
      <div style={styles.foldersBarWrap}>
        <div style={styles.foldersScrollRow}>
          {/* تب همه علاقه‌مندی‌ها */}
          <button
            type="button"
            onClick={() => setActiveFavoriteFolder('ALL')}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverFolderId('ALL');
            }}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => handleDropCardOnFolder(e, 'ALL')}
            style={{
              ...styles.folderTabBtn,
              backgroundColor:
                activeFavoriteFolderId === 'ALL'
                  ? 'rgba(34, 211, 238, 0.16)'
                  : 'var(--panel2)',
              borderColor:
                dragOverFolderId === 'ALL'
                  ? '#f72585'
                  : activeFavoriteFolderId === 'ALL'
                  ? 'var(--accent)'
                  : 'var(--border)',
              color: activeFavoriteFolderId === 'ALL' ? 'var(--accent)' : 'var(--text)',
            }}
          >
            <Icons.Layers size={14} />
            <span>همه علاقه‌مندی‌ها</span>
            <span style={styles.folderTabCount}>{folderCounts.ALL}</span>
          </button>

          {/* تب پین‌شده‌ها */}
          <button
            type="button"
            onClick={() => setActiveFavoriteFolder('PINNED')}
            style={{
              ...styles.folderTabBtn,
              backgroundColor:
                activeFavoriteFolderId === 'PINNED'
                  ? 'rgba(34, 211, 238, 0.16)'
                  : 'var(--panel2)',
              borderColor:
                activeFavoriteFolderId === 'PINNED' ? 'var(--accent)' : 'var(--border)',
              color: activeFavoriteFolderId === 'PINNED' ? 'var(--accent)' : 'var(--text)',
            }}
          >
            <Icons.Pin size={14} filled={activeFavoriteFolderId === 'PINNED'} />
            <span>پین‌شده‌ها</span>
            <span style={styles.folderTabCount}>{folderCounts.PINNED}</span>
          </button>

          {/* تب بدون پوشه */}
          <button
            type="button"
            onClick={() => setActiveFavoriteFolder('UNFOLDERED')}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverFolderId('UNFOLDERED');
            }}
            onDragLeave={() => setDragOverFolderId(null)}
            onDrop={(e) => handleDropCardOnFolder(e, 'UNFOLDERED')}
            style={{
              ...styles.folderTabBtn,
              backgroundColor:
                activeFavoriteFolderId === 'UNFOLDERED'
                  ? 'rgba(34, 211, 238, 0.16)'
                  : 'var(--panel2)',
              borderColor:
                dragOverFolderId === 'UNFOLDERED'
                  ? '#f72585'
                  : activeFavoriteFolderId === 'UNFOLDERED'
                  ? 'var(--accent)'
                  : 'var(--border)',
              color:
                activeFavoriteFolderId === 'UNFOLDERED' ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            <Icons.Folder size={14} />
            <span>بدون پوشه</span>
            <span style={styles.folderTabCount}>{folderCounts.UNFOLDERED}</span>
          </button>

          {/* تب پوشه‌های سفارشی کاربر */}
          {favoriteFolders.map((folder) => {
            const isSelected = activeFavoriteFolderId === folder.id;
            const isDragTarget = dragOverFolderId === folder.id;
            const fColor = folder.color || '#22d3ee';

            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => setActiveFavoriteFolder(folder.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverFolderId(folder.id);
                }}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={(e) => handleDropCardOnFolder(e, folder.id)}
                style={{
                  ...styles.folderTabBtn,
                  backgroundColor: isSelected
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'var(--panel2)',
                  borderColor: isDragTarget
                    ? '#f72585'
                    : isSelected
                    ? fColor
                    : 'var(--border)',
                  color: isSelected ? '#ffffff' : 'var(--text)',
                  transform: isDragTarget ? 'scale(1.05)' : 'scale(1)',
                }}
                title="کلیک برای مشاهده پوشه (یا کارت کمیک را بکشید و اینجا رها کنید)"
              >
                <span
                  style={{
                    width: '9px',
                    height: '9px',
                    borderRadius: '50%',
                    backgroundColor: fColor,
                    boxShadow: isSelected ? `0 0 8px ${fColor}` : 'none',
                  }}
                />
                <span>{folder.name}</span>
                <span style={styles.folderTabCount}>
                  {folderCounts[folder.id] || 0}
                </span>
              </button>
            );
          })}

          {/* دکمه ساخت پوشه جدید */}
          <button
            type="button"
            onClick={() =>
              setFolderModal({
                mode: 'create',
                id: null,
                name: '',
                color: '#22d3ee',
              })
            }
            style={styles.newFolderBtn}
            title="ساخت پوشه جدید در علاقه‌مندی‌ها"
          >
            <Icons.FolderPlus size={14} />
            <span>+ پوشه جدید</span>
          </button>
        </div>

        {/* نوار مدیریت پوشه فعال (ویرایش نام / حذف پوشه) */}
        {activeFolderObject && (
          <div style={styles.activeFolderActionsBar}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icons.Folder
                size={15}
                filled
                fillColor={activeFolderObject.color || '#22d3ee'}
              />
              <span style={styles.activeFolderTitle}>
                پوشه فعال: <strong>{activeFolderObject.name}</strong>
              </span>
              <span style={styles.dragToFolderHint}>
                (می‌توانید کارت‌ها را روی پوشه‌های بالا بکشید و رها کنید)
              </span>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() =>
                  setFolderModal({
                    mode: 'edit',
                    id: activeFolderObject.id,
                    name: activeFolderObject.name,
                    color: activeFolderObject.color || '#22d3ee',
                  })
                }
                style={styles.folderManageBtn}
              >
                <Icons.Edit3 size={13} />
                <span>ویرایش پوشه</span>
              </button>
              <button
                type="button"
                onClick={() => handleDeleteActiveFolder(activeFolderObject)}
                style={{ ...styles.folderManageBtn, color: 'var(--danger)' }}
              >
                <Icons.Trash size={13} />
                <span>حذف پوشه</span>
              </button>
            </div>
          </div>
        )}

        {/* فرم بازشوی ساخت / ویرایش پوشه */}
        {folderModal && (
          <div style={styles.folderEditorCard}>
            <div style={styles.folderEditorRow}>
              <Icons.FolderPlus size={16} />
              <input
                type="text"
                autoFocus
                value={folderModal.name}
                onChange={(e) =>
                  setFolderModal((prev) => ({ ...prev, name: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSaveFolderModal();
                  if (e.key === 'Escape') setFolderModal(null);
                }}
                placeholder="نام پوشه (مثلاً: آناتومی، فیزیولوژی، مانهواهای اکشن)..."
                style={styles.folderNameInput}
              />

              <div style={styles.folderColorPicker}>
                {FOLDER_COLORS.map((col) => (
                  <button
                    key={col}
                    type="button"
                    onClick={() =>
                      setFolderModal((prev) => ({ ...prev, color: col }))
                    }
                    style={{
                      ...styles.folderColorDot,
                      backgroundColor: col,
                      transform:
                        folderModal.color === col ? 'scale(1.25)' : 'scale(1)',
                      borderColor:
                        folderModal.color === col ? '#ffffff' : 'transparent',
                    }}
                  />
                ))}
              </div>

              <button
                type="button"
                onClick={handleSaveFolderModal}
                style={styles.folderSaveBtn}
              >
                {folderModal.mode === 'edit' ? 'ذخیره تغییرات' : 'ساخت پوشه'}
              </button>
              <button
                type="button"
                onClick={() => setFolderModal(null)}
                style={styles.folderCancelBtn}
              >
                انصراف
              </button>
            </div>
          </div>
        )}
      </div>

      {/* نمایش گرید کارت‌ها یا پیام خالی بودن */}
      {favorites.length === 0 ? (
        <div style={styles.emptyBox}>
          <div style={styles.emptyIconCircle}>
            <Icons.Heart size={36} />
          </div>
          <p style={styles.emptyTitle}>
            {searchQuery
              ? `هیچ مانهوای مورد علاقه‌ای با عبارت «${searchQuery}» پیدا نشد.`
              : 'لیست علاقه‌مندی‌های شما خالی است.'}
          </p>
          <span style={styles.emptySub}>
            هنگام مطالعه یا در بخش ویترین کتابخانه، با زدن آیکون قلب یا فشردن کلید{' '}
            <code style={styles.codeBadge}>Ctrl + D</code> کمیک‌ها را به این بخش اضافه کنید.
          </span>
          <button
            type="button"
            onClick={() => setCurrentView('library')}
            style={styles.exploreBtn}
          >
            <Icons.Library size={15} />
            <span>رفتن به ویترین کتابخانه</span>
          </button>
        </div>
      ) : displayedFavorites.length === 0 ? (
        <div style={styles.emptyBox}>
          <div style={{ color: 'var(--muted)', marginBottom: '8px' }}>
            <Icons.FolderOpen size={40} />
          </div>
          <p style={styles.emptyText}>
            {searchQuery
              ? `هیچ مانهوای مورد علاقه‌ای با عبارت «${searchQuery}» در این بخش پیدا نشد.`
              : activeFolderObject
              ? `پوشه «${activeFolderObject.name}» خالی است. با دکمه پوشه روی کارت‌ها یا کشیدن کارت‌ها، کتاب‌ها را به این پوشه اضافه کنید.`
              : activeFavoriteFolderId === 'PINNED'
              ? 'هنوز هیچ کتابی را در علاقه‌مندی‌ها پین نکرده‌اید. با زدن آیکون پین روی کارت‌ها، آن‌ها را در صدر کتابخانه ثابت کنید.'
              : activeFavoriteFolderId === 'UNFOLDERED'
              ? 'همه علاقه‌مندی‌های شما در پوشه هستند و کتابی بدون پوشه نیست.'
              : 'در این بخش، علاقه‌مندی‌ای نیست.'}
          </p>
        </div>
      ) : (
        <div style={styles.cardsGrid}>
          {displayedFavorites.map((item) => (
            <ComicCard
              key={item.path || item.filePath || item.name}
              item={item}
              onOpenComic={onOpenComic}
              onRemove={handleRemoveFav}
              showRemoveBtn={true}
              folderScope="favorites"
            />
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    padding: '18px 22px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    overflowY: 'auto',
    direction: 'ltr',
    userSelect: 'none',
  },
  // مرحله ۴۴: قفلِ جهت — پوسته ltr، محتوایِ درونی rtl تا نوارِ اسکرول در سمتِ راست بماند
  containerInner: {
    display: 'flex',
    flexDirection: 'column',
    gap: '18px',
    direction: 'rtl',
    flex: 1,
    minWidth: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: '14px',
    borderBottom: '1px solid var(--border)',
    flexWrap: 'wrap',
    gap: '12px',
  },
  titleWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  headerIcon: {
    width: '42px',
    height: '42px',
    backgroundColor: 'rgba(248, 81, 73, 0.12)',
    borderRadius: '12px',
    border: '1px solid rgba(248, 81, 73, 0.3)',
    color: 'var(--danger)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'var(--font-fa)',
    fontSize: '20px',
    fontWeight: 800,
    color: 'var(--text)',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  controlsWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  sortSelect: {
    backgroundColor: 'var(--panel)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '7px 12px',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    outline: 'none',
    cursor: 'pointer',
  },
  // مرحله ۴۸ (B): استایل‌های نوار پوشه، دقیقاً هم‌ارزِ LibraryView
  foldersBarWrap: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  foldersScrollRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  },
  folderTabBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '7px',
    padding: '7px 13px',
    borderRadius: '11px',
    borderWidth: '1px',
    borderStyle: 'solid',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.18s ease',
    outline: 'none',
  },
  folderTabCount: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10.5px',
    fontWeight: 700,
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    padding: '1px 6px',
    borderRadius: '7px',
    direction: 'ltr',
  },
  newFolderBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 13px',
    borderRadius: '11px',
    borderWidth: '1px',
    borderStyle: 'dashed',
    borderColor: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.06)',
    color: 'var(--accent)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
    outline: 'none',
  },
  activeFolderActionsBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '8px',
    padding: '8px 14px',
    borderRadius: '12px',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
  },
  activeFolderTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--text)',
  },
  dragToFolderHint: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    color: 'var(--muted)',
  },
  folderManageBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 10px',
    borderRadius: '8px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    backgroundColor: 'var(--panel)',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  folderEditorCard: {
    padding: '10px 14px',
    borderRadius: '12px',
    backgroundColor: 'rgba(34, 211, 238, 0.08)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
  },
  folderEditorRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
    color: 'var(--accent)',
  },
  folderNameInput: {
    flex: 1,
    minWidth: '210px',
    backgroundColor: 'var(--panel)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: '9px',
    padding: '7px 12px',
    color: 'var(--text)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    outline: 'none',
    userSelect: 'text',
  },
  folderColorPicker: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  folderColorDot: {
    width: '18px',
    height: '18px',
    borderRadius: '50%',
    borderWidth: '2px',
    borderStyle: 'solid',
    cursor: 'pointer',
    padding: 0,
    transition: 'transform 0.15s ease',
  },
  folderSaveBtn: {
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    border: 'none',
    borderRadius: '9px',
    padding: '7px 14px',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    fontWeight: 700,
    cursor: 'pointer',
  },
  folderCancelBtn: {
    backgroundColor: 'var(--panel)',
    color: 'var(--muted)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: '9px',
    padding: '7px 12px',
    fontFamily: 'var(--font-fa)',
    fontSize: '12px',
    cursor: 'pointer',
  },
  cardsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
    gap: '16px',
  },
  emptyBox: {
    flex: 1,
    padding: '54px 16px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    gap: '10px',
  },
  emptyIconCircle: {
    width: '68px',
    height: '68px',
    borderRadius: '20px',
    backgroundColor: 'var(--panel)',
    border: '1px solid var(--border)',
    color: 'var(--danger)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: '6px',
  },
  emptyTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--text)',
    margin: 0,
  },
  emptySub: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    color: 'var(--muted)',
    maxWidth: '440px',
    lineHeight: 1.7,
  },
  emptyText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 600,
    color: 'var(--muted)',
  },
  codeBadge: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--accent)',
    backgroundColor: 'var(--panel2)',
    border: '1px solid var(--border)',
    padding: '1px 6px',
    borderRadius: '6px',
    direction: 'ltr',
    display: 'inline-block',
  },
  exploreBtn: {
    marginTop: '10px',
    padding: '9px 18px',
    borderRadius: '11px',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    border: '1px solid var(--accent)',
    color: 'var(--accent)',
    fontFamily: 'var(--font-fa)',
    fontSize: '13px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
};
