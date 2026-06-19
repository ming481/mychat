import React, { useEffect, useRef, useState } from 'react';
import { setAppDialogHandler } from '../utils/appDialog';

export default function AppDialogHost() {
  const [dialog, setDialog] = useState(null);
  const resolverRef = useRef(null);
  const inputRef = useRef(null);
  const [inputValue, setInputValue] = useState('');

  useEffect(() => {
    return setAppDialogHandler(options => new Promise(resolve => {
      resolverRef.current = resolve;
      setInputValue(options.defaultValue || '');
      setDialog(options);
    }));
  }, []);

  useEffect(() => {
    if (dialog?.type === 'prompt') {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [dialog]);

  if (!dialog) return null;

  const isDanger = dialog.tone === 'danger';
  const icon = dialog.type === 'confirm' ? '?' : dialog.type === 'prompt' ? 'i' : '!';

  function close(value) {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    if (resolve) resolve(value);
  }

  function submit(event) {
    event?.preventDefault();
    if (dialog.type === 'prompt') {
      close(inputValue);
      return;
    }
    close(true);
  }

  return (
    <div className="app-dialog-overlay" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && dialog.type !== 'alert') close(dialog.type === 'prompt' ? null : false);
    }}>
      <form className={`app-dialog app-dialog--${dialog.tone || 'info'}`} onSubmit={submit}>
        <div className="app-dialog-head">
          <div className={`app-dialog-icon${isDanger ? ' danger' : ''}`}>{icon}</div>
          <div>
            <h3>{dialog.title}</h3>
            {dialog.message && <p>{dialog.message}</p>}
          </div>
        </div>

        {dialog.type === 'prompt' && (
          <input
            ref={inputRef}
            className="app-dialog-input"
            type={dialog.inputType || 'text'}
            value={inputValue}
            placeholder={dialog.placeholder}
            onChange={event => setInputValue(event.target.value)}
          />
        )}

        <div className="app-dialog-actions">
          {dialog.type !== 'alert' && (
            <button type="button" className="app-dialog-btn ghost" onClick={() => close(dialog.type === 'prompt' ? null : false)}>
              {dialog.cancelText || '取消'}
            </button>
          )}
          <button type="submit" className={`app-dialog-btn primary${isDanger ? ' danger' : ''}`}>
            {dialog.confirmText || '确认'}
          </button>
        </div>
      </form>
    </div>
  );
}
