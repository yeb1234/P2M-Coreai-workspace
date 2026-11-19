import React from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'danger',
}) => {
  const buttonColors = {
    danger: 'bg-[var(--danger)] hover:bg-[#c82333]',
    warning: 'bg-[var(--accent)] hover:bg-[var(--accent-hover)]',
    info: 'bg-[#7c3aed] hover:bg-[#6d28d9]',
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-sm">
      <p className="text-[var(--text-secondary)] mb-6">{message}</p>
      <div className="flex justify-end gap-3">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] bg-[var(--bg-base)] rounded-lg hover:bg-[var(--border-light)] transition-colors"
        >
          {cancelText}
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${buttonColors[variant]}`}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
};
