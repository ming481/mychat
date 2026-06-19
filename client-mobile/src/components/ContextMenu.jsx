import React, { useEffect, useRef } from 'react';

export default function ContextMenu({ x, y, msg, currentUserId, onRecall, onReply, onClose }) {
  const ref = useRef(null);

  // Adjust position so menu doesn't overflow viewport
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (rect.right > vw) el.style.left = `${vw - rect.width - 8}px`;
    if (rect.bottom > vh) el.style.top = `${vh - rect.height - 8}px`;
  }, []);

  const isMe = String(msg.sender_id) === String(currentUserId);
  const isRecallNotice = msg.is_recalled || msg.system_notice;
  // Within 3 minutes?
  const canRecall = !isRecallNotice && isMe && (Date.now() - new Date(msg.created_at).getTime()) < 3 * 60 * 1000;

  const items = isRecallNotice ? [] : [
    { label: '📝 回复', action: () => { onReply(msg); onClose(); } },
    ...(canRecall ? [{ label: '↩️ 撤回', action: () => { onRecall(msg); onClose(); }, danger: true }] : []),
    {
      label: '📋 复制', action: () => {
        if (msg.content) navigator.clipboard?.writeText(msg.content).catch(() => {});
        onClose();
      }
    },
  ];

  if (items.length === 0) return null;

  return (
    <div
      ref={ref}
      className="context-menu"
      style={{ left: x, top: y }}
      onClick={e => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          className={`context-menu-item${item.danger ? ' danger' : ''}`}
          onClick={item.action}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
