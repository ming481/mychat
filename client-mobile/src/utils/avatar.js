import { useEffect, useMemo, useRef, useState } from 'react';
import { withAssetVersion } from './api';

const blobCache = new Map();

export function fallbackAvatar(name) {
  const text = String(name || '?').trim().slice(0, 1).toUpperCase() || '?';
  const seed = Array.from(String(name || '?')).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const colors = ['#4a7af5', '#27b894', '#f59e42', '#a855f7', '#ef5b5b', '#14a3b8'];
  const bg = colors[seed % colors.length];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
      <rect width="128" height="128" rx="64" fill="${bg}"/>
      <text x="64" y="74" text-anchor="middle" font-family="Arial, sans-serif" font-size="56" font-weight="700" fill="#fff">${escapeSvg(text)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

export function useAvatarSrc(src, name) {
  const fallback = useMemo(() => fallbackAvatar(name), [name]);
  const normalized = useMemo(() => {
    if (!src) return '';
    return withAssetVersion(src, 'avatar');
  }, [src]);
  const [displaySrc, setDisplaySrc] = useState(normalized || fallback);
  const blobUrlRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    if (!normalized) {
      setDisplaySrc(fallback);
      return () => { cancelled = true; };
    }

    if (!normalized.includes('/uploads/')) {
      setDisplaySrc(normalized);
      return () => { cancelled = true; };
    }

    const cached = blobCache.get(normalized);
    if (cached) {
      setDisplaySrc(cached);
      return () => { cancelled = true; };
    }

    setDisplaySrc(fallback);
    fetch(normalized)
      .then(res => {
        if (!res.ok) throw new Error(`avatar ${res.status}`);
        return res.blob();
      })
      .then(blob => {
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        // cap cache size to prevent unbounded memory growth
        if (blobCache.size > 50) {
          const oldest = blobCache.keys().next().value;
          const oldBlob = blobCache.get(oldest);
          URL.revokeObjectURL(oldBlob);
          blobCache.delete(oldest);
        }
        blobCache.set(normalized, objectUrl);
        // revoke previous blob URL before replacing
        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = objectUrl;
        setDisplaySrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setDisplaySrc(fallback);
      });

    return () => {
      cancelled = true;
      // revoke blob URL on unmount
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [normalized, fallback]);

  return displaySrc;
}

export function handleAvatarError(event, name) {
  const fallback = fallbackAvatar(name);
  if (event.currentTarget.src !== fallback) {
    event.currentTarget.src = fallback;
  }
}

function escapeSvg(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
