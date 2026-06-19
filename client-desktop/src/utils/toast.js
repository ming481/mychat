// Simple toast notification
export function toast(message, options = {}) {
  const el = document.createElement('div');
  el.className = `app-toast app-toast--${options.type || 'default'}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.classList.add('app-toast--out');
    setTimeout(() => el.remove(), 300);
  }, options.duration || 3000);
}
