import React from 'react';
import useLibraryStore from '../store/useLibraryStore';

export default function LibraryView({ onOpenComic }) {
  const libraryItems = useLibraryStore(state => state.libraryItems);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={{ fontSize: '20px', margin: 0 }}>📚 کتابخانه شما</h2>
        <span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
          {libraryItems.length} عنوان ذخیره شده
        </span>
      </div>

      {libraryItems.length === 0 ? (
        <div style={styles.empty}>
          <p>هنوز کمیکی به کتابخانه اضافه نشده است.</p>
          <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
            از پنل سمت راست روی "+ Add to Library" کلیک کنید.
          </span>
        </div>
      ) : (
        <div style={styles.grid}>
          {libraryItems.map((item, index) => (
            <div key={index} style={styles.card} onClick={() => onOpenComic && onOpenComic(item)}>
              <div style={styles.cover}>
                {item.cover ? <img src={item.cover} alt="" style={styles.coverImg} /> : '📖'}
              </div>
              <div style={styles.title}>{item.name || 'بدون نام'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { flex: 1, padding: '24px', display: 'flex', flexDirection: 'column', overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  empty: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', gap: '8px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '16px' },
  card: { backgroundColor: 'var(--bg-secondary)', borderRadius: '14px', padding: '10px', cursor: 'pointer', transition: 'transform 0.2s' },
  cover: { height: '170px', borderRadius: '8px', backgroundColor: 'var(--bg-panel)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '28px', overflow: 'hidden' },
  coverImg: { width: '100%', height: '100%', objectFit: 'cover' },
  title: { fontSize: '13px', marginTop: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
};