import React, { useEffect, useCallback } from 'react';

export default function ImageViewer({ url, onClose }) {
  const handleKey = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (!url) return;
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [url, handleKey]);

  if (!url) return null;

  return (
    <div className="image-viewer-overlay" onClick={onClose}>
      <div className="image-viewer-container" onClick={e => e.stopPropagation()}>
        <img src={url} alt="" className="image-viewer-img" draggable={false} />
      </div>
      <button className="image-viewer-close" type="button" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>
    </div>
  );
}
