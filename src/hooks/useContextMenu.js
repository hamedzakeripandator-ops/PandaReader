import { useEffect, useCallback, useRef } from 'react';
import useAppStore from '../store/useAppStore';

const MENU_WIDTH = 246;
const MENU_HEIGHT = 410;
const SCREEN_MARGIN = 12;

export default function useContextMenu() {
  const { 
    isContextMenuOpen, 
    isSnippingActive,
    openContextMenu, 
    closeContextMenu 
  } = useAppStore();

  const accumulatedScrollRef = useRef(0);

  // محاسبه ارگونومیک موقعیت منو و جلوگیری از خروج از کادر صفحه
  const handleContextMenu = useCallback((e, targetData = null) => {
    e.preventDefault();
    e.stopPropagation();

    // در حین ابزار برش اسکرین‌شات منو باز نمی‌شود
    if (isSnippingActive) return;

    accumulatedScrollRef.current = 0;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // بررسی فراخوانی از طریق کیبورد (AppsKey / Shift+F10)
    const isKeyboard = e.clientX === 0 && e.clientY === 0;
    const clickX = isKeyboard ? Math.round(screenW / 2) : Math.round(e.clientX);
    const clickY = isKeyboard ? Math.round(screenH / 2) : Math.round(e.clientY);

    let safeX = clickX + 2;
    let safeY = clickY + 2;

    // لبه راست مانیتور
    if (safeX + MENU_WIDTH > screenW - SCREEN_MARGIN) {
      safeX = Math.max(SCREEN_MARGIN, clickX - MENU_WIDTH - 4);
    }

    // لبه پایین مانیتور
    if (safeY + MENU_HEIGHT > screenH - SCREEN_MARGIN) {
      safeY = Math.max(SCREEN_MARGIN, clickY - MENU_HEIGHT - 4);
    }

    openContextMenu({ x: safeX, y: safeY }, targetData);
  }, [isSnippingActive, openContextMenu]);

  useEffect(() => {
    if (!isContextMenuOpen) return;

    const handlePointerDown = (e) => {
      if (!e.target.closest('#custom-context-menu')) {
        closeContextMenu();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeContextMenu();
      }
    };

    const handleWheel = (e) => {
      accumulatedScrollRef.current += Math.hypot(e.deltaX, e.deltaY);
      if (accumulatedScrollRef.current > 40) {
        closeContextMenu();
      }
    };

    const handleDismiss = () => {
      closeContextMenu();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('wheel', handleWheel, { passive: true });
    window.addEventListener('resize', handleDismiss);
    window.addEventListener('blur', handleDismiss);

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('resize', handleDismiss);
      window.removeEventListener('blur', handleDismiss);
    };
  }, [isContextMenuOpen, closeContextMenu]);

  return {
    handleContextMenu,
    closeContextMenu
  };
}