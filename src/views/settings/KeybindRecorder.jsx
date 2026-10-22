import React, { useState, useEffect, useRef } from 'react';
import Icons from '../../components/common/Icons';

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta']);

export default function KeybindRecorder({
  actionId,
  currentBinding,
  onSave,
}) {
  const [isRecording, setIsRecording] = useState(false);
  const [livePreview, setLivePreview] = useState('');
  const recorderRef = useRef(null);

  useEffect(() => {
    if (!isRecording) return;

    const handleClickOutside = (e) => {
      if (recorderRef.current && !recorderRef.current.contains(e.target)) {
        setIsRecording(false);
        setLivePreview('');
      }
    };

    const handleKeyDown = (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setIsRecording(false);
        setLivePreview('');
        return;
      }

      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');

      if (MODIFIER_KEYS.has(e.key)) {
        setLivePreview(parts.join(' + ') + ' + ...');
        return;
      }

      let mainKey = e.key;
      if (mainKey === ' ') mainKey = 'Space';
      else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
      else if (mainKey === 'ArrowRight') mainKey = 'Right';
      else if (mainKey === 'ArrowLeft') mainKey = 'Left';
      else if (mainKey === 'ArrowUp') mainKey = 'Up';
      else if (mainKey === 'ArrowDown') mainKey = 'Down';

      const finalLabel = [...parts, mainKey].join(' + ');

      onSave(actionId, {
        key: e.key,
        code: e.code,
        ctrl: Boolean(e.ctrlKey || e.metaKey),
        shift: Boolean(e.shiftKey),
        alt: Boolean(e.altKey),
        label: finalLabel,
      });

      setIsRecording(false);
      setLivePreview('');
    };

    window.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isRecording, actionId, onSave]);

  return (
    <div ref={recorderRef} style={styles.wrapper}>
      <button
        type="button"
        onClick={() => {
          setIsRecording(true);
          setLivePreview('کلید دلخواه را بفشارید...');
        }}
        style={{
          ...styles.recordBtn,
          borderColor: isRecording ? 'var(--accent)' : 'var(--border)',
          backgroundColor: isRecording ? 'rgba(34, 211, 238, 0.14)' : 'var(--panel)',
          color: isRecording ? 'var(--accent)' : 'var(--text)',
          boxShadow: isRecording ? '0 0 14px rgba(34, 211, 238, 0.25)' : 'none',
        }}
        title="برای تغییر کلید میانبر کلیک کنید"
      >
        {isRecording ? (
          <span style={styles.recordingText}>{livePreview}</span>
        ) : (
          <>
            <Icons.Keyboard size={13} />
            <span style={styles.keyLabel}>{currentBinding?.label || 'Unbound'}</span>
          </>
        )}
      </button>
    </div>
  );
}

const styles = {
  wrapper: {
    display: 'inline-flex',
    alignItems: 'center',
  },
  recordBtn: {
    minWidth: '135px',
    padding: '6px 12px',
    borderRadius: '9px',
    border: '1px solid',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '7px',
    transition: 'all 0.18s ease',
    outline: 'none',
  },
  keyLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11.5px',
    fontWeight: 600,
    direction: 'ltr',
  },
  recordingText: {
    fontFamily: 'var(--font-fa)',
    fontSize: '11px',
    fontWeight: 600,
    color: 'var(--accent)',
  },
};