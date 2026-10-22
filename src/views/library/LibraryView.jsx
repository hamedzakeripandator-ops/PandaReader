import React, { useState, useMemo, useCallback } from 'react';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import ComicCard from './ComicCard';
import KineticHeroSlider from './KineticHeroSlider';
import { coreApi } from '../../services/coreApi';
import Icons from '../../components/common/Icons';

const FOLDER_COLORS = [
  '#22d3ee',
  '#f72585',
  '#a78bfa',
  '#4ade80',
  '#facc15',
  '#fb923c',
];

export default function LibraryView({ onOpenComic }) {
  const library = useLibraryStore((state) => state.library);
  const libraryItems = useLibraryStore((state) => state.libraryItems);
  const libraryFolders = useLibraryStore((state) => state.libraryFolders || []);
  const activeFolderId = useLibraryStore((state) => state.activeFolderId || 'ALL');
  const setActiveFolder = useLibraryStore((state) => state.setActiveFolder);
  const createFolder = useLibraryStore((state) => state.createFolder);
  const renameFolder = useLibraryStore((state) => state.renameFolder);
  const deleteFolder = useLibraryStore((state) => state.deleteFolder);
  const assignToFolder = useLibraryStore((state) => state.assignToFolder);

  const recentItems = useLibraryStore((state) => state.recentItems);
  const favorites = useLibraryStore((state) => state.favorites);
  const addToLibrary = useLibraryStore((state) => state.addToLibrary);
  const removeFromLibrary = useLibraryStore((state) => state.removeFromLibrary);

  const searchQuery = useAppStore((state) => state.searchQuery);
  const showToast = useAppStore((state) => state.showToast);

  const effectiveLibrary = useMemo(
    () => library || libraryItems || [],
    [library, libraryItems]
  );

  const [filterMode, setFilterMode] = useState('all');
  const [sortBy, setSortBy] = useState('newest');

  // استیت‌های مودال ساخت / ویرایش پوشه در کتابخانه
  const [folderModal, setFolderModal] = useState(null); // { mode: 'create'|'edit', id, name, color }
  const [dragOverFolderId, setDragOverFolderId] = useState(null);

  // ۱. آیتم‌های اسلایدر Kinetic (اولویت با آیتم‌های پین‌شده و اخیراً خوانده‌شده)
  const sliderItems = useMemo(() => {
    const pinnedList = effectiveLibrary.filter((i) => Boolean(i.isPinned));
    const recentList = Array.isArray(recentItems) ? recentItems : [];
    const combinedMap = new Map();

    [...pinnedList, ...recentList, ...effectiveLibrary].forEach((item) => {
      const rawP = item?.path || item?.filePath;
      if (!rawP) return;
      const norm = rawP.trim().replace(/[\\/]+/g, '\\').toLowerCase();
      if (!combinedMap.has(norm)) {
        combinedMap.set(norm, item);
      }
    });

    return Array.from(combinedMap.values()).slice(0, 7);
  }, [effectiveLibrary, recentItems]);

  // ۲. محاسبه تعداد آیتم‌های هر پوشه
  const folderCounts = useMemo(() => {
    const counts = {
      ALL: effectiveLibrary.length,
      PINNED: 0,
      UNFOLDERED: 0,
    };
    libraryFolders.forEach((f) => {
      counts[f.id] = 0;
    });

    effectiveLibrary.forEach((item) => {
      if (item.isPinned) counts.PINNED++;
      if (item.folderId && counts[item.folderId] !== undefined) {
        counts[item.folderId]++;
      } else {
        counts.UNFOLDERED++;
      }
    });

    return counts;
  }, [effectiveLibrary, libraryFolders]);

  // ۳. فیلتر و مرتب‌سازی گرید کتابخانه (با حفظ اولویت ۱۰۰٪ آیتم‌های پین‌شده در صدر)
  const displayedLibrary = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();

    const filtered = effectiveLibrary.filter((item) => {
      const name = (item.name || item.fileName || '').toLowerCase();
      const path = (item.path || item.filePath || '').toLowerCase();
      const matchesSearch = !q || name.includes(q) || path.includes(q);
      if (!matchesSearch) return false;

      // فیلتر بر اساس پوشه انتخاب‌شده
      if (activeFolderId === 'PINNED' && !item.isPinned) return false;
      if (activeFolderId === 'UNFOLDERED' && item.folderId) return false;
      if (
        activeFolderId &&
        !['ALL', 'PINNED', 'UNFOLDERED'].includes(activeFolderId) &&
        item.folderId !== activeFolderId
      ) {
        return false;
      }

      // فیلتر بر اساس وضعیت علاقه‌مندی / در حال مطالعه
      if (filterMode === 'favorites') {
        const norm = path.replace(/[\\/]+/g, '\\').toLowerCase();
        return (favorites || []).some(
          (f) =>
            (f.path || f.filePath || '').toLowerCase().replace(/[\\/]+/g, '\\') === norm
        );
      }
      if (filterMode === 'reading') {
        const prog = item.percentage ?? item.progress ?? 0;
        return (item.lastPage && item.lastPage > 1) || prog > 0;
      }
      return true;
    });

    return [...filtered].sort((a, b) => {
      // آیتم‌های پین‌شده همیشه در بالای لیست قرار می‌گیرند
      const aPin = a?.isPinned ? 1 : 0;
      const bPin = b?.isPinned ? 1 : 0;
      if (aPin !== bPin) return bPin - aPin;

      if (sortBy === 'name') {
        return (a.name || '').localeCompare(b.name || '', 'fa');
      }
      if (sortBy === 'progress') {
        const pA = a.percentage ?? a.progress ?? 0;
        const pB = b.percentage ?? b.progress ?? 0;
        return pB - pA;
      }
      return new Date(b.addedAt || 0) - new Date(a.addedAt || 0);
    });
  }, [effectiveLibrary, favorites, searchQuery, activeFolderId, filterMode, sortBy]);

  const handleAddNewToLibrary = async () => {
    const res = await coreApi.openFile();
    if (res?.success && res.filePath) {
      const targetFolder = !['ALL', 'PINNED', 'UNFOLDERED'].includes(activeFolderId)
        ? activeFolderId
        : null;
      await addToLibrary({
        path: res.filePath,
        name: res.fileName || res.filePath.split(/[\\/]/).pop(),
        cover: res.cover || null,
        fileSize: res.fileSize,
        folderId: targetFolder,
      });
      showToast('عنوان جدید با موفقیت به کتابخانه اضافه شد', { type: 'success' });
    }
  };

  const handleRemoveFromLib = useCallback(
    async (filePath, title) => {
      await removeFromLibrary(filePath);
      showToast(`«${title}» از کتابخانه حذف شد`, { type: 'info' });
    },
    [removeFromLibrary, showToast]
  );

  // ذخیره پوشه جدید یا ویرایش‌شده در دیتابیس
  const handleSaveFolderModal = async () => {
    if (!folderModal) return;
    const cleanName = (folderModal.name || '').trim();
    if (!cleanName) {
      showToast('لطفاً نام پوشه را وارد کنید', { type: 'warning' });
      return;
    }

    if (folderModal.mode === 'edit' && folderModal.id) {
      await renameFolder(folderModal.id, cleanName, folderModal.color);
      showToast(`پوشه «${cleanName}» ویرایش شد`, { type: 'success' });
    } else {
      const created = await createFolder(cleanName, folderModal.color);
      if (created?.id) {
        setActiveFolder(created.id);
      }
      showToast(`پوشه «${cleanName}» ساخته و در دیتابیس ذخیره شد`, { type: 'success' });
    }
    setFolderModal(null);
  };

  const handleDeleteActiveFolder = async (folder) => {
    if (!folder?.id) return;
    await deleteFolder(folder.id);
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

    await assignToFolder(draggedPath, realFolderId);
    const targetFolderObj = libraryFolders.find((f) => f.id === realFolderId);
    showToast(
      targetFolderObj
        ? `به پوشه «${targetFolderObj.name}» منتقل شد`
        : 'به نمای کلی کتابخانه منتقل شد',
      { type: 'success' }
    );
  };

  const activeFolderObject = useMemo(
    () => libraryFolders.find((f) => f.id === activeFolderId) || null,
    [libraryFolders, activeFolderId]
  );

  return (
    <div style={styles.container}>
      {/* =====================================================================
          ۱. اسلایدر Kinetic Typography + Split Navigation
      ===================================================================== */}
      {sliderItems.length > 0 && (
        <KineticHeroSlider items={sliderItems} onOpenComic={onOpenComic} />
      )}

      {/* =====================================================================
          ۲. بخش آرشیو، نوار پوشه‌بندی و گرید کارت‌های کتابخانه
      ===================================================================== */}
      <section style={styles.gridSection}>
        {/* هدر اصلی کتابخانه */}
        <div style={styles.toolbarHeader}>
          <div style={styles.headerTitleBox}>
            <span style={{ color: 'var(--accent)', display: 'flex' }}>
              <Icons.Library size={21} />
            </span>
            <h3 style={styles.sectionTitle}>آرشیو مانهوا، کمیک و کتابخانه</h3>
            <span style={styles.countBadge}>{displayedLibrary.length} عنوان</span>
          </div>

          <div style={styles.controlsGroup}>
            <div style={styles.filterPills}>
              {[
                { id: 'all', label: 'همه عناوین' },
                { id: 'favorites', label: 'مورد علاقه‌ها' },
                { id: 'reading', label: 'در حال مطالعه' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilterMode(f.id)}
                  style={{
                    ...styles.filterBtn,
                    ...(filterMode === f.id ? styles.filterBtnActive : {}),
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              style={styles.sortSelect}
            >
              <option value="newest">مرتب‌سازی: جدیدترین (پین‌ها در صدر)</option>
              <option value="name">مرتب‌سازی: نام الفبا (پین‌ها در صدر)</option>
              <option value="progress">مرتب‌سازی: بیشترین پیشرفت</option>
            </select>

            <button
              type="button"
              onClick={handleAddNewToLibrary}
              style={styles.addComicBtn}
            >
              <Icons.Plus size={14} />
              <span>افزودن فایل به کتابخانه</span>
            </button>
          </div>
        </div>

        {/* =================================================================
            نوار پوشه‌بندی کتابخانه (Library Folders Bar) متصل به دیتابیس
        ================================================================= */}
        <div style={styles.foldersBarWrap}>
          <div style={styles.foldersScrollRow}>
            {/* تب همه عناوین */}
            <button
              type="button"
              onClick={() => setActiveFolder('ALL')}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverFolderId('ALL');
              }}
              onDragLeave={() => setDragOverFolderId(null)}
              onDrop={(e) => handleDropCardOnFolder(e, 'ALL')}
              style={{
                ...styles.folderTabBtn,
                backgroundColor:
                  activeFolderId === 'ALL'
                    ? 'rgba(34, 211, 238, 0.16)'
                    : 'var(--panel2)',
                borderColor:
                  dragOverFolderId === 'ALL'
                    ? '#f72585'
                    : activeFolderId === 'ALL'
                    ? 'var(--accent)'
                    : 'var(--border)',
                color: activeFolderId === 'ALL' ? 'var(--accent)' : 'var(--text)',
              }}
            >
              <Icons.Layers size={14} />
              <span>همه کتاب‌ها</span>
              <span style={styles.folderTabCount}>{folderCounts.ALL}</span>
            </button>

            {/* تب پین‌شده‌ها */}
            <button
              type="button"
              onClick={() => setActiveFolder('PINNED')}
              style={{
                ...styles.folderTabBtn,
                backgroundColor:
                  activeFolderId === 'PINNED'
                    ? 'rgba(34, 211, 238, 0.16)'
                    : 'var(--panel2)',
                borderColor:
                  activeFolderId === 'PINNED' ? 'var(--accent)' : 'var(--border)',
                color: activeFolderId === 'PINNED' ? 'var(--accent)' : 'var(--text)',
              }}
            >
              <Icons.Pin size={14} filled={activeFolderId === 'PINNED'} />
              <span>پین‌شده‌ها</span>
              <span style={styles.folderTabCount}>{folderCounts.PINNED}</span>
            </button>

            {/* تب بدون پوشه */}
            <button
              type="button"
              onClick={() => setActiveFolder('UNFOLDERED')}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverFolderId('UNFOLDERED');
              }}
              onDragLeave={() => setDragOverFolderId(null)}
              onDrop={(e) => handleDropCardOnFolder(e, 'UNFOLDERED')}
              style={{
                ...styles.folderTabBtn,
                backgroundColor:
                  activeFolderId === 'UNFOLDERED'
                    ? 'rgba(34, 211, 238, 0.16)'
                    : 'var(--panel2)',
                borderColor:
                  dragOverFolderId === 'UNFOLDERED'
                    ? '#f72585'
                    : activeFolderId === 'UNFOLDERED'
                    ? 'var(--accent)'
                    : 'var(--border)',
                color:
                  activeFolderId === 'UNFOLDERED' ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              <Icons.Folder size={14} />
              <span>بدون پوشه</span>
              <span style={styles.folderTabCount}>{folderCounts.UNFOLDERED}</span>
            </button>

            {/* تب پوشه‌های سفارشی کاربر */}
            {libraryFolders.map((folder) => {
              const isSelected = activeFolderId === folder.id;
              const isDragTarget = dragOverFolderId === folder.id;
              const fColor = folder.color || '#22d3ee';

              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => setActiveFolder(folder.id)}
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
              title="ساخت پوشه جدید در کتابخانه"
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

        {/* گرید کارت‌های کتابخانه */}
        {displayedLibrary.length === 0 ? (
          <div style={styles.emptyBox}>
            <div style={{ color: 'var(--muted)', marginBottom: '8px' }}>
              <Icons.FolderOpen size={40} />
            </div>
            <p style={styles.emptyText}>
              {searchQuery
                ? `هیچ عنوانی با عبارت «${searchQuery}» در این بخش یافت نشد.`
                : activeFolderObject
                ? `پوشه «${activeFolderObject.name}» خالی است. با دکمه پوشه روی کارت‌ها یا کشیدن کارت‌ها، کتاب‌ها را به این پوشه اضافه کنید.`
                : activeFolderId === 'PINNED'
                ? 'هنوز هیچ کتابی را پین نکرده‌اید. با زدن آیکون پین روی کارت‌ها، آن‌ها را در صدر کتابخانه ثابت کنید.'
                : 'کتابخانه شما خالی است. با دکمه «+ افزودن فایل به کتابخانه» اولین عنوان را اضافه کنید.'}
            </p>
          </div>
        ) : (
          <div style={styles.cardsGrid}>
            {displayedLibrary.map((item) => (
              <ComicCard
                key={item.path || item.filePath || item.name}
                item={item}
                onOpenComic={onOpenComic}
                onRemove={handleRemoveFromLib}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    padding: '14px 18px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    overflowY: 'auto',
    direction: 'rtl',
    userSelect: 'none',
  },
  gridSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
    backgroundColor: 'var(--panel)',
    borderRadius: '20px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    padding: '18px 20px',
  },
  toolbarHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '12px',
    paddingBottom: '12px',
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: 'var(--border)',
  },
  headerTitleBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  sectionTitle: {
    fontFamily: 'var(--font-fa)',
    fontSize: '19px',
    fontWeight: 800,
    margin: 0,
    color: 'var(--text)',
  },
  countBadge: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    padding: '3px 10px',
    borderRadius: '10px',
    fontVariantNumeric: 'tabular-nums',
  },
  controlsGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  filterPills: {
    display: 'flex',
    gap: '6px',
    backgroundColor: 'var(--panel2)',
    padding: '4px',
    borderRadius: '12px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
  },
  filterBtn: {
    padding: '6px 12px',
    borderRadius: '9px',
    border: 'none',
    backgroundColor: 'transparent',
    color: 'var(--muted)',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  filterBtnActive: {
    backgroundColor: 'var(--accent)',
    color: '#0a0f13',
    fontWeight: 700,
  },
  sortSelect: {
    backgroundColor: 'var(--panel2)',
    color: 'var(--text)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    borderRadius: '10px',
    padding: '7px 12px',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 600,
    outline: 'none',
    cursor: 'pointer',
  },
  addComicBtn: {
    backgroundColor: 'rgba(34, 211, 238, 0.12)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
    padding: '7px 14px',
    borderRadius: '10px',
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
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
    gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))',
    gap: '16px',
  },
  emptyBox: {
    padding: '48px 20px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
  },
  emptyText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '13.5px',
    fontWeight: 600,
    color: 'var(--muted)',
  },
};