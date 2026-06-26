import React, { useEffect, useState, useRef } from 'react';
import { useChatStore, useAuthStore } from '../store';
import { friendAPI, messageAPI, groupAPI } from '../utils/api';
import { getSocket } from '../hooks/useSocket';
import SearchUserDialog from './SearchUserDialog';
import CreateGroupDialog from './CreateGroupDialog';
import ProfileModal from './ProfileModal';
import { fallbackAvatar, handleAvatarError, useAvatarSrc } from '../utils/avatar';
import { localMessageCache } from '../utils/localMessageCache';
import { alertDialog, confirmDialog } from '../utils/appDialog';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const STATUS_COLOR = { 0: '#c0c8e0', 1: '#44cc77', 2: '#f5a623', 3: '#aab', 4: '#e74c3c' };
const LOCAL_MESSAGE_LIMIT = 20;

function Avatar({ src, name, size = 40, status }) {
  const fb = fallbackAvatar(name);
  const displaySrc = useAvatarSrc(src, name);
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <img src={displaySrc || fb} alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block', background: '#eef' }}
        onError={e => handleAvatarError(e, name)}
      />
      {status !== undefined && (
        <span style={{
          position: 'absolute', bottom: 1, right: 1,
          width: 10, height: 10, borderRadius: '50%',
          background: STATUS_COLOR[status] || '#ccc',
          border: '2px solid #fff',
        }} />
      )}
    </div>
  );
}

function msgPreview(conv) {
  if (conv.is_recalled) return '[消息被撤回]';
  if (conv.last_msg_type === 1 || conv.last_msg_type === 2) return '[文件]';
  const text = String(conv.last_content || '');
  return text.length > 18 ? `${text.slice(0, 14)}...` : text;
}

function timeStr(t) {
  if (!t) return '';
  const d = dayjs(t);
  const now = dayjs();
  if (now.diff(d, 'hour') < 24) return d.format('HH:mm');
  if (now.diff(d, 'day') < 7) return d.format('ddd');
  return d.format('MM/DD');
}

function ConvItem({ conv, active, onClick, onRemove }) {
  const inactive = (conv.type === 1 && ['kicked', 'dissolved'].includes(conv.group_state))
    || (conv.type === 0 && conv.group_state === 'unfriended');
  const inactiveText = conv.group_state === 'kicked'
    ? '您已被移出群聊'
    : conv.group_state === 'dissolved'
      ? '该群聊已被解散'
      : '您和对方已解除好友关系';
  return (
    <div
      className={`conv-item${active ? ' active' : ''}${inactive ? ' inactive' : ''}`}
      onClick={onClick}
      onContextMenu={(event) => {
        if (!inactive) return;
        event.preventDefault();
        onRemove?.(conv);
      }}
    >
      <Avatar src={conv.target_avatar} name={conv.target_name}
        status={conv.type === 0 ? (conv.target_status ?? 0) : undefined} size={44} />
      <div className="conv-info">
        <div className="conv-row">
          <span className="conv-name">{conv.target_name || '未知'}</span>
          <span className="conv-time">{timeStr(conv.last_msg_time)}</span>
        </div>
        <div className="conv-row">
          <span className="conv-preview">{inactive ? inactiveText : msgPreview(conv)}</span>
          {conv.unread_count > 0 && (
            <span className="conv-badge">{conv.unread_count > 99 ? '99+' : conv.unread_count}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendItem({ friend, status, onClick, onDelete }) {
  return (
    <div className="friend-item" onClick={onClick}>
      <Avatar src={friend.avatar_url} name={friend.nickname} status={status ?? 0} size={40} />
      <div className="friend-info">
        <div className="friend-name">{friend.remark || friend.nickname}</div>
        {friend.signature && <div className="friend-sig">{friend.signature}</div>}
      </div>
      <button
        className="friend-delete-btn"
        title="删除好友"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(friend);
        }}
      >
        删除
      </button>
    </div>
  );
}

function JoinedGroupItem({ group, onClick }) {
  return (
    <div className="friend-item" onClick={onClick}>
      <Avatar src={group.avatar_url} name={group.name} size={40} />
      <div className="friend-info">
        <div className="friend-name">{group.name}</div>
        {group.role === 1 && <div className="friend-sig">管理员</div>}
      </div>
    </div>
  );
}

function OwnerGroupItem({ group, expanded, pendingCount, onToggle, onClick, children }) {
  return (
    <div>
      <div className="friend-item owner-group-row" onClick={onClick}>
        <Avatar src={group.avatar_url} name={group.name} size={40} />
        <div className="friend-info">
          <div className="friend-name">{group.name}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {pendingCount > 0 && <span className="group-pending-badge">{pendingCount > 99 ? '99+' : pendingCount}</span>}
          <button className="group-expand-btn" onClick={e => { e.stopPropagation(); onToggle(); }}>
            {expanded ? '折叠' : '展开'}
          </button>
        </div>
      </div>
      {expanded && <div className="group-requests-panel">{children}</div>}
    </div>
  );
}

export default function Sidebar() {
  const { user } = useAuthStore();
  const {
    sidebarTab, setSidebarTab,
    conversations, setConversations,
    friends, setFriends,
    groups, setGroups,
    activeChat, setActiveChat,
    setMessages,
    markFriendInactive,
    friendRequests, setFriendRequests, removeFriendRequest,
    clearUnread, onlineUsers,
    groupJoinRequests, setGroupJoinRequests,
  } = useChatStore();

  const [showSearchUser, setShowSearchUser] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showReqs, setShowReqs] = useState(true);
  const [reqLoading, setReqLoading] = useState({});
  const [groupsSubTab, setGroupsSubTab] = useState('joined');
  const [expandedGroups, setExpandedGroups] = useState({});
  const [processingRequest, setProcessingRequest] = useState({});

  async function syncConversationToLocal(conv) {
    if (!conv?.last_message_id) return;
    const chatType = Number(conv.type);
    const chatId = Number(conv.target_id);
    const latestLocalId = Number(await localMessageCache.getLatestMessageId(chatType, chatId).catch(() => 0));
    const serverLastId = Number(conv.last_message_id || 0);
    const clearedAfterId = Number(localMessageCache.getClearedAfterId(chatType, chatId) || 0);
    const needsRecallRefresh = Boolean(conv.is_recalled) && latestLocalId === serverLastId;
    if (!serverLastId || (!needsRecallRefresh && latestLocalId >= serverLastId) || serverLastId <= clearedAfterId) return;

    const syncAfterId = needsRecallRefresh ? Math.max(0, serverLastId - 1) : Math.max(latestLocalId, clearedAfterId);
    const missing = syncAfterId
      ? (chatType === 0 ? await messageAPI.syncPrivate(chatId, syncAfterId, 0) : await messageAPI.syncGroup(chatId, syncAfterId, 0))
      : Number(conv.unread_count || 0) > 0
        ? (chatType === 0 ? await messageAPI.unreadPrivate(chatId, 0) : await messageAPI.unreadGroup(chatId, 0))
        : [];
    await localMessageCache.saveMessages(chatType, chatId, missing);
  }

  async function applyLocalLatestToConversations(list) {
    return Promise.all((list || []).map(async conv => {
      const latest = (await localMessageCache.getLatestMessages(conv.type, conv.target_id, 1).catch(() => []))[0];
      if (!latest) return conv;
      return {
        ...conv,
        last_content: latest.content,
        last_msg_type: latest.type,
        last_message_id: latest.id,
        last_msg_time: latest.created_at,
        updated_at: latest.created_at || conv.updated_at,
        is_recalled: Boolean(latest.is_recalled),
      };
    }));
  }

  // 用 ref 避免 loadAll 在 useEffect 中因依赖变化重复创建
  const loadAllRef = useRef(null);
  loadAllRef.current = async () => {
    try {
      const [convData, friendData, groupData, reqData] = await Promise.all([
        messageAPI.conversations(),
        friendAPI.list(),
        groupAPI.list(),
        friendAPI.requests(),
      ]);
      setFriends(friendData);
      setGroups(groupData);
      setFriendRequests(reqData);
      await Promise.allSettled(convData.map(syncConversationToLocal));
      setConversations(await applyLocalLatestToConversations(convData));
    } catch (e) {
      console.error('loadAll error', e);
    }
  };

  // 首次加载
  useEffect(() => {
    loadAllRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleSocketConnected = () => loadAllRef.current();
    window.addEventListener('chatapp:socket-connected', handleSocketConnected);
    return () => window.removeEventListener('chatapp:socket-connected', handleSocketConnected);
  }, []);

  // 定期刷新会话列表（兜底）
  useEffect(() => {
    const timer = setInterval(() => {
      messageAPI.conversations().then(async data => {
        await Promise.allSettled(data.map(syncConversationToLocal));
        setConversations(await applyLocalLatestToConversations(data));
      }).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh join requests when switching to "我创建的群聊" sub-tab
  // Real-time updates are handled by useSocket.js (group:join-request listener)
  useEffect(() => {
    if (sidebarTab !== 'groups' || groupsSubTab !== 'created') return;
    groupAPI.joinRequests().then(data => {
      const map = {};
      (Array.isArray(data) ? data : []).forEach(req => {
        const gid = String(req.group_id);
        if (!map[gid]) map[gid] = [];
        map[gid].push(req);
      });
      setGroupJoinRequests(map);
    }).catch(() => {});
  }, [sidebarTab, groupsSubTab, setGroupJoinRequests]);

  async function toggleGroupExpand(groupId) {
    const key = String(groupId);
    const isExpanded = expandedGroups[key];
    if (isExpanded) {
      setExpandedGroups(prev => { const next = { ...prev }; delete next[key]; return next; });
    } else {
      setExpandedGroups(prev => ({ ...prev, [key]: true }));
    }
  }

  async function handleJoinRequest(requestId, groupId, action) {
    setProcessingRequest(prev => ({ ...prev, [requestId]: true }));
    try {
      await groupAPI.handleJoinRequest(requestId, action);
      setGroupJoinRequests(prev => {
        const next = { ...prev };
        const key = String(groupId);
        if (next[key]) next[key] = next[key].filter(r => String(r.id) !== String(requestId));
        if (!next[key]?.length) delete next[key];
        return next;
      });
      if (action === 'accept') await loadAllRef.current();
    } catch { /* ignore */ }
    setProcessingRequest(prev => { const next = { ...prev }; delete next[requestId]; return next; });
  }

  const totalPending = Object.values(groupJoinRequests).reduce((s, list) => s + (Array.isArray(list) ? list.length : 0), 0);
  const ownedGroups = groups.filter(g => Number(g.role) === 2);
  const joinedGroups = groups.filter(g => Number(g.role) !== 2);

  async function prepareLocalMessages(chatType, chatId, conversation) {
    let targetConversation = conversation;
    if (!targetConversation) {
      try {
        const latestConversations = await messageAPI.conversations();
        await Promise.allSettled(latestConversations.map(syncConversationToLocal));
        setConversations(await applyLocalLatestToConversations(latestConversations));
        targetConversation = latestConversations.find(c => Number(c.type) === chatType && String(c.target_id) === String(chatId));
      } catch (err) {
        console.error('refresh conversations before open failed', err);
      }
    }
    const cached = await localMessageCache.getLatestMessages(chatType, chatId, LOCAL_MESSAGE_LIMIT).catch(() => []);
    const latestLocalId = Number(cached[cached.length - 1]?.id || 0);
    const serverLastId = Number(targetConversation?.last_message_id || 0);

    if (serverLastId && latestLocalId < serverLastId) {
      try {
        await syncConversationToLocal({ type: chatType, target_id: chatId, last_message_id: serverLastId });
        return localMessageCache.getLatestMessages(chatType, chatId, LOCAL_MESSAGE_LIMIT).catch(() => cached);
      } catch (err) {
        console.error('prepare local messages failed', err);
      }
    }

    return cached;
  }

  async function openChat(id, type, name, avatar, conversation = null) {
    const chatId = Number(id);
    const chatType = Number(type);
    const key = `${chatType}_${chatId}`;
    const sourceConversation = conversation || conversations.find(c => c.type === chatType && String(c.target_id) === String(chatId));
    const cached = await prepareLocalMessages(chatType, chatId, sourceConversation);
    setMessages(key, cached);
    setActiveChat({
      id: chatId,
      type: chatType,
      name,
      avatar,
      groupState: sourceConversation?.group_state || 'active',
      lastMessageId: sourceConversation?.last_message_id || null,
      lastIsRecalled: Boolean(sourceConversation?.is_recalled),
    });
    clearUnread(id, type);
    messageAPI.markRead(id, type).catch(() => {});
  }

  async function removeConversationHistory(conv) {
    if (!await confirmDialog('删除这一条本地聊天记录吗？', { title: '删除聊天记录' })) return;
    const key = `${conv.type}_${conv.target_id}`;
    useChatStore.getState().removeMessages(key);
    useChatStore.getState().removeConversation(conv.target_id, conv.type);
    await localMessageCache.clearConversations([{ type: conv.type, id: conv.target_id, lastMessageId: conv.last_message_id }]).catch(() => {});
    if (activeChat && String(activeChat.id) === String(conv.target_id) && activeChat.type === conv.type) {
      setActiveChat(null);
    }
  }

  async function handleRequest(req, action) {
    setReqLoading(p => ({ ...p, [req.id]: true }));
    try {
      await friendAPI.handleRequest(req.id, action);
      removeFriendRequest(req.id);
      if (action === 'accept') {
        // 通知对方刷新好友列表
        const socket = getSocket();
        if (socket) socket.emit('friend:accepted', { toId: req.user_id });
        // 自己也刷新
        const [friendData, groupData] = await Promise.all([friendAPI.list(), groupAPI.list()]);
        setFriends(friendData);
        setGroups(groupData);
        await loadAllRef.current();
      }
    } catch (e) { console.error(e); }
    setReqLoading(p => ({ ...p, [req.id]: false }));
  }

  async function handleDeleteFriend(friend) {
    const name = friend.remark || friend.nickname || friend.username || '该好友';
    if (!await confirmDialog(`确定删除 ${name} 吗？聊天记录会保留，可之后在聊天记录管理中清理。`, { title: '删除好友', confirmText: '删除', tone: 'danger' })) return;
    markFriendInactive(friend.id, friend);
    try {
      await friendAPI.delete(friend.id);
    } catch (e) {
      console.error(e);
      alertDialog('删除失败，已重新刷新好友列表', { title: '提示' });
      loadAllRef.current();
    }
  }

  const totalUnread = conversations.reduce((s, c) => s + (c.unread_count || 0), 0);

  const friendGroups = friends.reduce((acc, f) => {
    const g = f.group_name || '我的好友';
    if (!acc[g]) acc[g] = [];
    acc[g].push(f);
    return acc;
  }, {});

  return (
    <div className="sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <button className="sidebar-avatar-btn" onClick={() => setShowProfile(true)} aria-label="打开个人资料">
          <Avatar src={user?.avatar_url} name={user?.nickname} size={34} status={user?.status ?? 1} />
        </button>
        <span className="sidebar-username">{user?.nickname || user?.username}</span>
        <button className="sidebar-search-btn" onClick={() => setShowSearchUser(true)} title="搜索/添加好友">🔍</button>
      </div>

      {/* Tabs */}
      <div className="sidebar-tabs">
        <button className={`sidebar-tab${sidebarTab === 'chats' ? ' active' : ''}`}
          onClick={() => setSidebarTab('chats')} title="消息">
          💬
          {totalUnread > 0 && <span className="tab-badge">{totalUnread > 99 ? '99+' : totalUnread}</span>}
        </button>
        <button className={`sidebar-tab${sidebarTab === 'friends' ? ' active' : ''}`}
          onClick={() => setSidebarTab('friends')} title="好友">
          👥
          {friendRequests.length > 0 && <span className="tab-badge">{friendRequests.length}</span>}
        </button>
        <button className={`sidebar-tab${sidebarTab === 'groups' ? ' active' : ''}`}
          onClick={() => setSidebarTab('groups')} title="群聊">
          🏠
          {totalPending > 0 && <span className="tab-badge">{totalPending > 99 ? '99+' : totalPending}</span>}
        </button>
      </div>

      {/* Content */}
      <div className="sidebar-content">

        {/* ── 消息列表 ── */}
        {sidebarTab === 'chats' && (
          conversations.length === 0
            ? <div className="sidebar-empty">暂无对话<br /><small>去好友列表开始聊天吧</small></div>
            : conversations.map(c => (
              <ConvItem key={`${c.type}_${c.target_id}`} conv={c}
                active={activeChat && String(activeChat.id) === String(c.target_id) && activeChat.type === c.type}
                onClick={() => openChat(c.target_id, c.type, c.target_name, c.target_avatar, c)}
                onRemove={removeConversationHistory}
              />
            ))
        )}

        {/* ── 好友列表 ── */}
        {sidebarTab === 'friends' && (
          <>
            {friendRequests.length > 0 && (
              <div className="req-section">
                <div className="sidebar-section-title"
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                  onClick={() => setShowReqs(v => !v)}>
                  新好友申请
                  <span className="req-count">{friendRequests.length}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12 }}>{showReqs ? '▲' : '▼'}</span>
                </div>
                {showReqs && friendRequests.map(req => (
                  <div key={req.id} className="friend-req-item">
                    <Avatar src={req.avatar_url} name={req.nickname || req.username} size={36} />
                    <div className="friend-req-info">
                      <span className="friend-req-name">{req.nickname || req.username}</span>
                      <span className="friend-req-id">@{req.username}</span>
                    </div>
                    <div className="friend-req-btns">
                      <button className="btn-sm btn-primary"
                        disabled={reqLoading[req.id]}
                        onClick={() => handleRequest(req, 'accept')}>同意</button>
                      <button className="btn-sm btn-ghost"
                        disabled={reqLoading[req.id]}
                        onClick={() => handleRequest(req, 'reject')}>拒绝</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {friends.length === 0
              ? <div className="sidebar-empty">还没有好友<br /><small>点击 🔍 搜索添加</small></div>
              : Object.entries(friendGroups).map(([gname, list]) => (
                <div key={gname}>
                  <div className="sidebar-section-title">{gname}（{list.length}）</div>
                  {list.map(f => (
                    <FriendItem key={f.id} friend={f}
                      status={f.status ?? (onlineUsers.has(String(f.id)) ? 1 : 0)}
                      onClick={() => openChat(f.id, 0, f.remark || f.nickname, f.avatar_url)}
                      onDelete={handleDeleteFriend}
                    />
                  ))}
                </div>
              ))
            }
          </>
        )}

        {/* ── 群聊列表 ── */}
        {sidebarTab === 'groups' && (
          <>
            <div className="groups-sub-tabs">
              <button className={`groups-sub-tab${groupsSubTab === 'joined' ? ' active' : ''}`}
                onClick={() => setGroupsSubTab('joined')}>我加入的群聊</button>
              <button className={`groups-sub-tab${groupsSubTab === 'created' ? ' active' : ''}`}
                onClick={() => setGroupsSubTab('created')}>
                我创建的群聊
                {totalPending > 0 && <span className="group-tab-badge">{totalPending > 99 ? '99+' : totalPending}</span>}
              </button>
            </div>

            {groupsSubTab === 'joined' && (
              joinedGroups.length === 0
                ? <div className="sidebar-empty">没有加入的群聊</div>
                : joinedGroups.map(g => (
                  <JoinedGroupItem key={g.id} group={g}
                    onClick={() => openChat(g.id, 1, g.name, g.avatar_url)}
                  />
                ))
            )}

            {groupsSubTab === 'created' && (
              <>
                <button className="create-group-btn" onClick={() => setShowCreateGroup(true)}>＋ 创建群聊</button>
                {ownedGroups.length === 0
                  ? <div className="sidebar-empty">还没有创建的群聊<br /><small>点击上方按钮创建</small></div>
                  : ownedGroups.map(g => {
                    const key = String(g.id);
                    const pendingList = groupJoinRequests[key] || [];
                    const pendingCount = pendingList.length;
                    return (
                      <OwnerGroupItem key={g.id} group={g}
                        expanded={expandedGroups[key]}
                        pendingCount={pendingCount}
                        onToggle={() => toggleGroupExpand(g.id)}
                        onClick={() => openChat(g.id, 1, g.name, g.avatar_url)}
                      >
                        {pendingList.length === 0
                          ? <div className="group-requests-empty">暂无加入申请</div>
                          : pendingList.map(req => (
                            <div key={req.id} className="group-request-item">
                              <Avatar src={req.avatar_url} name={req.nickname} size={28} />
                              <div className="group-request-info">
                                <div className="group-request-name">{req.nickname}</div>
                                <div className="group-request-un">@{req.username}</div>
                              </div>
                              <div className="group-request-btns">
                                <button className="btn-sm btn-primary"
                                  disabled={processingRequest[req.id]}
                                  onClick={() => handleJoinRequest(req.id, g.id, 'accept')}>同意</button>
                                <button className="btn-sm btn-ghost"
                                  disabled={processingRequest[req.id]}
                                  onClick={() => handleJoinRequest(req.id, g.id, 'reject')}>拒绝</button>
                              </div>
                            </div>
                          ))
                        }
                      </OwnerGroupItem>
                    );
                  })
                }
              </>
            )}
          </>
        )}
      </div>

      {showSearchUser && (
        <SearchUserDialog onClose={() => setShowSearchUser(false)} friends={friends}
          onRefresh={() => loadAllRef.current()} />
      )}
      {showCreateGroup && (
        <CreateGroupDialog onClose={() => setShowCreateGroup(false)} friends={friends}
          onRefresh={() => loadAllRef.current()} />
      )}
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
    </div>
  );
}
