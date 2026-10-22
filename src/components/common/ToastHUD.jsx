import React from 'react';
import useAppStore from '../../store/useAppStore';

export default function ToastHUD() {
  const toast = useAppStore((state) => state.toast);
  const hideToast = useAppStore((state) => state.hideToast);

  if (!toast.visible && !toast.message) return null;

  // انتخاب استایل‌های نوری بر اساس نوع پیام
  const getThemeColors = () => {
    switch (toast.type) {
      case 'success':
        return {
          border: 'rgba(0, 188, 212, 0.45)',
          shadow: '0 10px 30px rgba(0, 188, 212, 0.25)',
          textColor: '#00BCD4',
        };
      case 'error':
        return {
          border: 'rgba(255, 71, 87, 0.5)',
          shadow: '0 10px 30px rgba(255, 71, 87, 0.25)',
          textColor: '#ff4757',
        };
      case 'warning':
        return {
          border: 'rgba(255, 165, 2, 0.5)',
          shadow: '0 10px 30px rgba(255, 165, 2, 0.25)',
          textColor: '#ffa502',
        };
      case 'info':
      default:
        return {
          border: 'rgba(255, 255, 255, 0.15)',
          shadow: '0 10px 30px rgba(0, 0, 0, 0.6)',
          textColor: '#e6edf3',
        };
    }
  };

  const theme = getThemeColors();

  return (
    <div style={styles.hudContainer}>
      <div
        key={toast.id}
        onClick={hideToast}
        style={{
          ...styles.hudPill,
          borderColor: theme.border,
          boxShadow: `${theme.shadow}, 0 4px 12px rgba(0, 0, 0, 0.75)`,
          opacity: toast.visible ? 1 : 0,
          transform: toast.visible ? 'translateY(0) scale(1)' : 'translateY(-14px) scale(0.96)',
        }}
        title="کلیک برای بستن سریع"
      >
        {toast.icon && <span style={styles.icon}>{toast.icon}</span>}
        <span style={{ ...styles.message, color: theme.textColor }}>
          {toast.message}
        </span>
      </div>
    </div>
  );
}

const styles = {
  hudContainer: {
    position: 'fixed',
    top: '26px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 100005,
    pointerEvents: 'none', // عدم مداخله با کلیک‌های صفحه زیرین
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    direction: 'rtl',
    userSelect: 'none',
  },
  hudPill: {
    pointerEvents: 'auto', // امکان کلیک مستقیم روی خود اعلان جهت بستن سریع
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 18px',
    backgroundColor: 'rgba(15, 20, 26, 0.94)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    borderRadius: '24px',
    border: '1px solid',
    transition: 'all 0.22s cubic-bezier(0.16, 1, 0.3, 1)',
  },
  icon: {
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: {
    fontSize: '12px',
    fontWeight: '600',
    whiteSpace: 'nowrap',
    letterSpacing: '0.2px',
  },
};