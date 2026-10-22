import React, { useState, useCallback } from 'react';
import useAppStore from '../../store/useAppStore';
import useSettingsStore from '../../store/useSettingsStore';
import Icons from '../../components/common/Icons';

export default function QuickActionCards({ onSelectFile, onSelectFolder }) {
  const setCurrentView = useAppStore((state) => state.setCurrentView);
  const shortcuts = useSettingsStore((state) => state.shortcuts);
  const [hoveredCard, setHoveredCard] = useState(null);

  const actions = [
    {
      id: 'open-file',
      Icon: Icons.FolderOpen,
      title: 'باز کردن فایل کمیک',
      desc: 'پشتیبانی از CBZ, ZIP, CBR, RAR, 7Z و PDF',
      badge: shortcuts?.openFile?.label || 'Ctrl + O',
      onClick: onSelectFile,
      accent: 'var(--accent)',
    },
    {
      id: 'open-folder',
      Icon: Icons.Folder,
      title: 'باز کردن پوشه مانهوا',
      desc: 'اسکن خودکار فصول و تصاویر متوالی پوشه',
      badge: shortcuts?.openFolder?.label || 'Ctrl + Shift + O',
      onClick: onSelectFolder,
      accent: '#38bdf8',
    },
    {
      id: 'go-library',
      Icon: Icons.Library,
      title: 'ویترین کتابخانه',
      desc: 'اسلایدر اخیر، آرشیو کاورها و علاقه‌مندی‌ها',
      badge: 'Library',
      onClick: () => setCurrentView('library'),
      accent: 'var(--purple)',
    },
    {
      id: 'go-settings',
      Icon: Icons.Keyboard,
      title: 'شخصی‌سازی شورت‌کات‌ها',
      desc: 'تنظیم کلیدهای میانبر ترکیبی و زوم پیش‌فرض',
      badge: shortcuts?.openSettings?.label || 'Ctrl + ,',
      onClick: () => setCurrentView('settings'),
      accent: '#10b981',
    },
  ];

  // هندلر کیبورد برای دسترسی‌پذیری کامل با کلیدهای Enter و Space
  const handleKeyDown = useCallback((e, actionFn) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (typeof actionFn === 'function') {
        actionFn();
      }
    }
  }, []);

  return (
    <div style={styles.grid}>
      {actions.map((act) => {
        const isHovered = hoveredCard === act.id;
        const ActionIcon = act.Icon;

        return (
          <div
            key={act.id}
            role="button"
            tabIndex={0}
            onClick={act.onClick}
            onKeyDown={(e) => handleKeyDown(e, act.onClick)}
            onMouseEnter={() => setHoveredCard(act.id)}
            onMouseLeave={() => setHoveredCard(null)}
            style={{
              ...styles.card,
              transform: isHovered ? 'translateY(-3px)' : 'translateY(0)',
              borderColor: isHovered ? 'var(--accent)' : 'var(--border)',
              boxShadow: isHovered
                ? '0 12px 28px rgba(0, 0, 0, 0.5), 0 0 16px rgba(34, 211, 238, 0.12)'
                : '0 4px 14px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div style={styles.topRow}>
              <div
                style={{
                  ...styles.iconBox,
                  color: act.accent,
                  borderColor: isHovered ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: isHovered ? 'rgba(34, 211, 238, 0.08)' : 'var(--panel2)',
                }}
              >
                <ActionIcon size={20} />
              </div>
              <span style={styles.shortcutBadge}>{act.badge}</span>
            </div>

            <div style={styles.title}>{act.title}</div>
            <div style={styles.desc}>{act.desc}</div>
          </div>
        );
      })}
    </div>
  );
}

const styles = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))',
    gap: '14px',
    width: '100%',
  },
  card: {
    backgroundColor: 'var(--panel)',
    borderRadius: '16px',
    padding: '18px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
    direction: 'rtl',
    userSelect: 'none',
    outline: 'none',
  },
  topRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  iconBox: {
    width: '38px',
    height: '38px',
    borderRadius: '11px',
    backgroundColor: 'var(--panel2)',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
  },
  shortcutBadge: {
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    fontSize: '10.5px',
    direction: 'ltr',
    color: 'var(--accent)',
    backgroundColor: 'rgba(34, 211, 238, 0.1)',
    padding: '3px 8px',
    borderRadius: '6px',
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: 'rgba(34, 211, 238, 0.28)',
  },
  title: {
    fontFamily: 'var(--font-fa)',
    fontSize: '15.5px',
    fontWeight: 700,
    color: 'var(--text)',
    marginTop: '4px',
  },
  desc: {
    fontFamily: 'var(--font-fa)',
    fontSize: '12.5px',
    fontWeight: 400,
    color: 'var(--muted)',
    lineHeight: '1.6',
  },
};
