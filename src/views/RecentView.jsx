import React from 'react';
import useLibraryStore from '../store/useLibraryStore';

export default function RecentView({ onOpenComic }) {
  const recentItems = useLibraryStore(state => state.recentItems);

  return (
    <div style={styles.container}>
      <h2 style={{ fontSize: '20px', marginBottom: '20px' }}>🕒 اخیراً خوانده شده</h2>

      {recentItems.length === 0 ? (
        <div style={styles.empty}>تاریخچه مطالعه‌ای ثبت نشده است.</div>
      ) : (
        <div style={styles.list}>
          {recentItems.map((item, index) => (
            <div key={index} style={styles.row} onClick={() => onOpenComic && onOpenComic(item)}>
              <div style={styles.badge}>صفحه {item.lastPage || 1}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '14px', fontWeight: '500' }}>{item.name}</div>
                <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{item.path}</div>
              </div>
              <button className="btn-icon">▶</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { flex: 1, padding: '24px', overflowY: 'auto' },
  empty: { textAlign: 'center', color: 'var(--text-secondary)', marginTop: '60px' },
  list: { display: 'flex', flexDirection: 'column', gap: '10px' },
  row: { display: 'flex', alignItems: 'center', gap: '16px', backgroundColor: 'var(--bg-secondary)', padding: '12px 18px', borderRadius: '14px', cursor: 'pointer' },
  badge: { backgroundColor: 'var(--bg-active)', padding: '6px 12px', borderRadius: '8px', fontSize: '12px' }
};