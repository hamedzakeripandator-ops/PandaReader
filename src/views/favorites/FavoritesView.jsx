import React, { useState, useMemo } from 'react';
import useLibraryStore from '../../store/useLibraryStore';
import useAppStore from '../../store/useAppStore';
import ComicCard from '../library/ComicCard';
import Icons from '../../components/common/Icons';

export default function FavoritesView({ onOpenComic }) {
  const { favorites, removeFromFavorites } = useLibraryStore();
  const { searchQuery, setCurrentView, showToast } = useAppStore();

  const [sortBy, setSortBy] = useState('newest'); // 'newest' | 'name' | 'progress'

  const displayedFavorites = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    const list = (favorites || []).filter((item) => {
      if (!q) return true;
      const name = (item.name || item.fileName || '').toLowerCase();
      const path = (item.path || item.filePath || '').toLowerCase();
      return name.includes(q) || path.includes(q);
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
  }, [favorites, searchQuery, sortBy]);

  const handleRemoveFav = (path, title) => {
    removeFromFavorites(path);
    showToast(`«${title || 'کمیک'}» از علاقه‌مندی‌ها حذف شد`, { type: 'info' });
  };

  return (
    <div style={styles.container}>
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

      {/* نمایش گرید کارت‌ها یا پیام خالی بودن */}
      {displayedFavorites.length === 0 ? (
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
      ) : (
        <div style={styles.cardsGrid}>
          {displayedFavorites.map((item) => (
            <ComicCard
              key={item.path || item.filePath || item.name}
              item={item}
              onOpenComic={onOpenComic}
              onRemove={handleRemoveFav}
              showRemoveBtn={true}
            />
          ))}
        </div>
      )}
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
    direction: 'rtl',
    userSelect: 'none',
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