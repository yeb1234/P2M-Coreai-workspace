import React, { useEffect, useRef, useState } from 'react';
import { Modal } from '../shared/Modal';

interface SubtitleEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (text: string) => void | Promise<void>;
  initialText: string;
}

export function SubtitleEditDialog({ isOpen, onClose, onConfirm, initialText }: SubtitleEditDialogProps) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setText(initialText);
      setError('');
      setSaving(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [isOpen, initialText]);

  const handleConfirm = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      setError('字幕内容不能为空');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onConfirm(trimmed);
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleConfirm();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="编辑字幕" maxWidth="max-w-md">
      <div className="space-y-4">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => { setText(e.target.value); setError(''); }}
          onKeyDown={handleKeyDown}
          rows={3}
          className="w-full rounded-lg border border-[#e5e2dd] bg-white px-3 py-2 text-sm text-[#1a1a1a] focus:border-[var(--accent)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] resize-none"
          placeholder="输入字幕内容..."
        />
        {error && <p className="text-xs text-[#dc3545]">{error}</p>}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-[#6b7280] bg-[#f3f2ef] rounded-lg hover:bg-[#e5e2dd] transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors bg-[var(--accent)] hover:bg-[var(--accent-hover)] disabled:opacity-50"
          >
            {saving ? '保存中...' : '确认'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
