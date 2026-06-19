const handlers = [];

export function registerBackHandler(handler) {
  if (typeof handler !== 'function') return () => {};
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

export function runBackHandler() {
  for (let index = handlers.length - 1; index >= 0; index -= 1) {
    try {
      if (handlers[index]()) return true;
    } catch (err) {
      console.error('back handler failed', err);
    }
  }
  return false;
}
