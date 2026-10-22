import React from 'react';

export default function HomeView({ onSelectFile }) {
  return (
    <div style={styles.container} onClick={onSelectFile}>
      <div style={styles.glowCard}>
        <div style={{ fontSize: '56px', marginBottom: '16px' }}>✨</div>
        <h1 style={{ fontSize: '28px', fontWeight: '500', marginBottom: '8px' }}>ComicReader</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '360px', lineHeight: '1.6' }}>
          فایل‌های CBZ، ZIP یا PDF خود را به اینجا بکشید یا برای باز کردن کلیک کنید
        </p>
        <div style={styles.badge}>Webtoon & Vertical Scroll Ready</div>
      </div>
    </div>
  );
}

const styles = {
  container: {
    flex: 1,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    userSelect: 'none'
  },
  glowCard: {
    backgroundColor: 'var(--bg-panel)',
    border: '1px solid rgba(255, 255, 255, 0.05)',
    borderRadius: '24px',
    padding: '48px 60px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    boxShadow: '0 20px 40px rgba(0,0,0,0.35)'
  },
  badge: {
    marginTop: '24px',
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--accent)',
    fontSize: '12px',
    padding: '6px 14px',
    borderRadius: '20px',
    fontWeight: '500'
  }
};