import { useState, useRef, useEffect } from "react";
import { Trash2, RotateCcw, Download } from "lucide-react";

interface MessageContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onDelete: () => void;
  onRevoke?: () => void;
  onDownload?: () => void;
  isOwnMessage: boolean;
  hasFile: boolean;
}

export const MessageContextMenu = ({
  isOpen,
  position,
  onClose,
  onDelete,
  onRevoke,
  onDownload,
  isOwnMessage,
  hasFile,
}: MessageContextMenuProps) => {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 bg-card border border-border rounded-lg shadow-xl py-1 min-w-[160px] animate-fade-in"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      {hasFile && onDownload && (
        <button
          onClick={() => {
            onDownload();
            onClose();
          }}
          className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-2"
        >
          <Download className="w-4 h-4" />
          Tải về
        </button>
      )}
      {isOwnMessage && onRevoke && (
        <button
          onClick={() => {
            onRevoke();
            onClose();
          }}
          className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-muted flex items-center gap-2"
        >
          <RotateCcw className="w-4 h-4" />
          Thu hồi
        </button>
      )}
      <button
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="w-full px-4 py-2 text-left text-sm text-destructive hover:bg-destructive/10 flex items-center gap-2"
      >
        <Trash2 className="w-4 h-4" />
        Xóa tin nhắn
      </button>
    </div>
  );
};
