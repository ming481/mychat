import React, { useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../store';
import { messageAPI } from '../utils/api';
import { localMessageCache } from '../utils/localMessageCache';
import {
  getChatSettings,
  getDefaultDownloadPath,
  getDefaultMessagePath,
} from '../utils/chatSettings';
import { alertDialog, confirmDialog, promptDialog } from '../utils/appDialog';

export default function ChatSettingsPanel({ onMessage }) {
  const { conversations, messages, removeMessages, removeConversation, setMessages, activeChat } = useChatStore();
  const [downloadPath, setDownloadPath] = useState('');
  const [messagePath, setMessagePath] = useState('');
  const [showManager, setShowManager] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [cachedConversations, setCachedConversations] = useState([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([getChatSettings(), getDefaultDownloadPath(), getDefaultMessagePath()])
      .then(([settings, defaultDownload, defaultMessage]) => {
        if (!alive) return;
        setDownloadPath(defaultDownload);
        setMessagePath(settings.messagePath || defaultMessage);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!showManager) return undefined;
    let alive = true;
    localMessageCache.listConversations()
      .then(rows => { if (alive) setCachedConversations(rows); })
      .catch(() => { if (alive) setCachedConversations([]); });
    return () => { alive = false; };
  }, [showManager]);

  const selectable = useMemo(() => {
    const byKey = new Map();
    cachedConversations.forEach(item => {
      byKey.set(`${item.type}_${item.id}`, item);
    });
    conversations.forEach(c => {
      const key = `${c.type}_${c.target_id}`;
      const cached = byKey.get(key);
      byKey.set(key, {
        id: c.target_id,
        type: c.type,
        lastMessageId: Math.max(Number(c.last_message_id || 0), Number(cached?.lastMessageId || 0)),
        latestTime: cached?.latestTime || new Date(c.updated_at || 0).getTime(),
        name: c.target_name || cached?.name || (c.type === 1 ? `群聊 ${c.target_id}` : `用户 ${c.target_id}`),
      });
    });
    return Array.from(byKey.values()).sort((a, b) => Number(b.latestTime || 0) - Number(a.latestTime || 0));
  }, [conversations, cachedConversations]);

  function toggle(item) {
    const key = `${item.type}_${item.id}`;
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function clearSelected() {
    const items = selectable.filter(item => selected.has(`${item.type}_${item.id}`));
    if (!items.length) return;

    await localMessageCache.clearConversations(items);

    const nextMessages = { ...messages };
    items.forEach(item => {
      const key = `${item.type}_${item.id}`;
      delete nextMessages[key];
      removeMessages(key);
      removeConversation(item.id, item.type);
    });
    useChatStore.setState({ messages: nextMessages });
    setCachedConversations(prev => prev.filter(item => !selected.has(`${item.type}_${item.id}`)));
    setSelected(new Set());
    setShowManager(false);
    onMessage?.('已清理选中的本地聊天记录');
  }

  async function syncHistory() {
    if (syncing) return;
    const confirmed = await confirmDialog(
      '同步会用服务器聊天记录覆盖当前本地好友/群聊记录，继续吗？',
      { title: '同步聊天记录', confirmText: '继续同步' }
    );
    if (!confirmed) return;

    const password = await promptDialog(
      '请输入当前账号密码以确认同步',
      { title: '密码确认', inputType: 'password', placeholder: '当前账号密码', confirmText: '开始同步' }
    );
    if (!password) return;

    setSyncing(true);
    try {
      const result = await messageAPI.historySync(password);
      const rows = Array.isArray(result?.conversations) ? result.conversations : [];

      for (const conv of rows) {
        const convMessages = Array.isArray(conv.messages) ? conv.messages : [];
        await localMessageCache.replaceMessages(conv.type, conv.target_id, convMessages);
        const latest = convMessages[convMessages.length - 1] || null;
        useChatStore.getState().upsertConversation({
          ...conv,
          messages: undefined,
          last_message_id: latest?.id || null,
          last_content: latest?.content || null,
          last_msg_type: latest?.type ?? null,
          last_msg_time: latest?.created_at || null,
          updated_at: latest?.created_at || conv.updated_at,
          unread_count: 0,
          is_recalled: Boolean(latest?.is_recalled),
        });
        if (activeChat && Number(activeChat.type) === Number(conv.type) && String(activeChat.id) === String(conv.target_id)) {
          setMessages(`${conv.type}_${conv.target_id}`, convMessages.slice(-20));
        }
      }

      setCachedConversations(await localMessageCache.listConversations().catch(() => []));
      alertDialog(`聊天记录同步完成，共同步 ${rows.length} 个会话`, { title: '同步完成' });
    } catch (err) {
      console.error(err);
      await alertDialog(err?.error || '聊天记录同步失败', { title: '同步失败', tone: 'danger' });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="profile-form chat-settings-panel">
      <div className="settings-row">
        <div>
          <div className="settings-title">文件下载位置</div>
          <div className="settings-path">{downloadPath || '默认下载目录'}</div>
        </div>
      </div>

      <div className="settings-row">
        <div>
          <div className="settings-title">聊天记录存储位置</div>
          <div className="settings-path">{messagePath || '默认记录目录'}</div>
        </div>
      </div>

      <button className="auth-btn" type="button" onClick={syncHistory} disabled={syncing}>
        {syncing ? '正在同步聊天记录...' : '同步聊天记录'}
      </button>
      <button className="auth-btn" type="button" onClick={() => setShowManager(true)}>聊天记录管理</button>

      {showManager && (
        <div className="settings-manager">
          <div className="settings-manager-box">
            <div className="settings-manager-head">
              <strong>清理本地聊天记录</strong>
              <button type="button" onClick={() => setShowManager(false)}>x</button>
            </div>
            <div className="settings-conversation-list">
              {selectable.length === 0 ? <div className="settings-empty">暂无会话</div> : selectable.map(item => (
                <label key={`${item.type}_${item.id}`} className="settings-conversation-item">
                  <input type="checkbox" checked={selected.has(`${item.type}_${item.id}`)} onChange={() => toggle(item)} />
                  <span>{item.type === 1 ? '群聊' : '好友'}</span>
                  <strong>{item.name}</strong>
                </label>
              ))}
            </div>
            <div className="settings-manager-actions">
              <button type="button" onClick={() => setShowManager(false)}>取消</button>
              <button type="button" className="danger" disabled={selected.size === 0} onClick={clearSelected}>删除本地记录</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
