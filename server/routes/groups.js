const express = require('express');
const { pool } = require('../db/index');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

let _io = null;
function setIO(io) { _io = io; }

function emitGroupLeft(userId, groupId, reason = 'leave', group = null) {
  if (!_io) return;
  _io.sockets.sockets.forEach(socket => {
    if (String(socket.userId) === String(userId)) {
      socket.leave(`group:${groupId}`);
      socket.emit('group:left', { groupId: Number(groupId), reason, group });
    }
  });
}

function emitGroupLeftToUsers(userIds, groupId, reason = 'dissolved', group = null) {
  if (!_io) return;
  const targets = new Set((userIds || []).map(id => String(id)));
  _io.sockets.sockets.forEach(socket => {
    if (!targets.has(String(socket.userId))) return;
    socket.leave(`group:${groupId}`);
    socket.emit('group:left', { groupId: Number(groupId), reason, group });
  });
}

async function getMemberRole(groupId, userId) {
  const result = await pool.query(
    'SELECT role FROM group_members WHERE group_id=$1 AND user_id=$2',
    [groupId, userId]
  );
  return result.rows[0]?.role;
}

router.get('/', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT g.*, gm.role,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = $1
       ORDER BY g.name`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[groups:list]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { name, memberIds, avatar_url, groupId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Group name is required' });
  if (groupId && !groupId.trim()) return res.status(400).json({ error: '群号不能为空' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (groupId?.trim()) {
      const dup = await client.query('SELECT id FROM groups WHERE group_id = $1', [groupId.trim()]);
      if (dup.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: '群号已存在' });
      }
    }

    const groupResult = await client.query(
      'INSERT INTO groups (name, owner_id, avatar_url, group_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [name.trim(), req.userId, avatar_url || '', groupId?.trim() || null]
    );
    const group = groupResult.rows[0];

    await client.query(
      'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 2)',
      [group.id, req.userId]
    );

    const members = [...new Set((memberIds || []).map(Number))].filter(id => id !== Number(req.userId));
    for (const memberId of members) {
      await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING',
        [group.id, memberId]
      );
    }

    await client.query('COMMIT');

    const ownerRes = await pool.query('SELECT nickname FROM users WHERE id=$1', [req.userId]);
    const ownerName = ownerRes.rows[0]?.nickname || 'Unknown';
    const allMemberIds = [Number(req.userId), ...members];

    if (_io) {
      allMemberIds.forEach(uid => {
        _io.sockets.sockets.forEach(socket => {
          if (String(socket.userId) === String(uid)) {
            socket.join(`group:${group.id}`);
            socket.emit('group:created', {
              group: { ...group, member_count: allMemberIds.length, role: uid === Number(req.userId) ? 2 : 0 },
              by: ownerName,
            });
          }
        });
      });
    }

    res.json(group);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[groups:create]', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.get('/search', authMiddleware, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const result = await pool.query(
      `SELECT g.*, (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) AS member_count,
        EXISTS(SELECT 1 FROM group_members WHERE group_id = g.id AND user_id = $2) AS is_member
       FROM groups g
       WHERE g.group_id ILIKE $1
       ORDER BY g.name
       LIMIT 20`,
      [`%${q}%`, req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[groups:search]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/join-requests', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT jr.id, jr.group_id, jr.user_id, jr.status, jr.created_at,
              u.username, u.nickname, u.avatar_url,
              g.name AS group_name, g.group_id AS group_code
       FROM group_join_requests jr
       JOIN users u ON u.id = jr.user_id
       JOIN groups g ON g.id = jr.group_id
       WHERE g.owner_id = $1 AND jr.status = 0
       ORDER BY jr.created_at DESC`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[groups:join-requests]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/join-requests/:requestId', authMiddleware, async (req, res) => {
  const { action } = req.body;
  if (!['accept', 'reject'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const reqResult = await client.query(
      `SELECT jr.*, g.owner_id, g.name
       FROM group_join_requests jr
       JOIN groups g ON g.id = jr.group_id
       WHERE jr.id = $1 AND jr.status = 0`,
      [req.params.requestId]
    );
    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found' });
    }
    const jr = reqResult.rows[0];
    if (Number(jr.owner_id) !== Number(req.userId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Permission denied' });
    }

    if (action === 'accept') {
      await client.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 0) ON CONFLICT DO NOTHING',
        [jr.group_id, jr.user_id]
      );
      await client.query(
        `INSERT INTO conversations (user_id, target_id, type, group_state)
         VALUES ($1, $2, 1, 'active')
         ON CONFLICT (user_id, target_id, type) DO UPDATE SET group_state = 'active'`,
        [jr.user_id, jr.group_id]
      );
      if (_io) {
        const countRes = await client.query('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [jr.group_id]);
        _io.sockets.sockets.forEach(socket => {
          if (String(socket.userId) === String(jr.user_id)) {
            socket.join(`group:${jr.group_id}`);
            socket.emit('group:created', {
              group: { id: jr.group_id, name: jr.name, member_count: Number(countRes.rows[0].count), role: 0 },
              by: 'admin',
            });
          }
        });
      }
    }

    await client.query('UPDATE group_join_requests SET status = $1 WHERE id = $2',
      [action === 'accept' ? 1 : 2, req.params.requestId]);

    const remaining = await client.query(
      'SELECT COUNT(*) FROM group_join_requests WHERE group_id = $1 AND status = 0',
      [jr.group_id]
    );

    await client.query('COMMIT');
    res.json({ message: 'ok', groupId: jr.group_id, pendingCount: Number(remaining.rows[0].count) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[groups:handle-join-request]', err);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const memberRole = await getMemberRole(req.params.id, req.userId);
    if (memberRole == null) return res.status(403).json({ error: 'Not a group member' });

    const groupResult = await pool.query('SELECT * FROM groups WHERE id = $1', [req.params.id]);
    if (!groupResult.rows.length) return res.status(404).json({ error: 'Group not found' });

    const membersResult = await pool.query(
      `SELECT u.id, u.username, u.nickname, u.avatar_url, u.status, gm.role, gm.join_time
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY gm.role DESC, u.nickname`,
      [req.params.id]
    );
    res.json({ ...groupResult.rows[0], members: membersResult.rows });
  } catch (err) {
    console.error('[groups:get]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/join-request', authMiddleware, async (req, res) => {
  try {
    const isMember = await pool.query(
      'SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (isMember.rows.length > 0) return res.status(400).json({ error: '你已在该群中' });

    const existing = await pool.query(
      'SELECT id, status FROM group_join_requests WHERE group_id = $1 AND user_id = $2',
      [req.params.id, req.userId]
    );
    if (existing.rows.length > 0) {
      if (existing.rows[0].status === 0) return res.status(400).json({ error: '已发送过申请' });
      await pool.query('UPDATE group_join_requests SET status = 0, created_at = NOW() WHERE id = $1', [existing.rows[0].id]);
    } else {
      await pool.query(
        'INSERT INTO group_join_requests (group_id, user_id) VALUES ($1, $2)',
        [req.params.id, req.userId]
      );
    }

    const groupRes = await pool.query('SELECT id, name, owner_id FROM groups WHERE id = $1', [req.params.id]);
    const group = groupRes.rows[0];

    if (_io && group) {
      _io.sockets.sockets.forEach(socket => {
        if (String(socket.userId) === String(group.owner_id)) {
          socket.emit('group:join-request', { groupId: Number(req.params.id), groupName: group.name });
        }
      });
    }

    res.json({ message: '申请已发送' });
  } catch (err) {
    console.error('[groups:join-request]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/:id/join-requests', authMiddleware, async (req, res) => {
  try {
    const group = await pool.query('SELECT owner_id FROM groups WHERE id = $1', [req.params.id]);
    if (!group.rows.length) return res.status(404).json({ error: 'Group not found' });
    if (Number(group.rows[0].owner_id) !== Number(req.userId)) return res.status(403).json({ error: 'Permission denied' });

    const result = await pool.query(
      `SELECT jr.id, jr.user_id, jr.status, jr.created_at, u.username, u.nickname, u.avatar_url
       FROM group_join_requests jr
       JOIN users u ON u.id = jr.user_id
       WHERE jr.group_id = $1 AND jr.status = 0
       ORDER BY jr.created_at DESC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[groups:group-join-requests]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/invite', authMiddleware, async (req, res) => {
  const { userIds } = req.body;
  try {
    const myRole = await getMemberRole(req.params.id, req.userId);
    if (myRole == null || myRole < 1) return res.status(403).json({ error: 'Permission denied' });

    const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
    for (const uid of ids) {
      await pool.query(
        'INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [req.params.id, uid]
      );
      await pool.query(
        `UPDATE conversations
         SET group_state='active'
         WHERE user_id=$1 AND target_id=$2 AND type=1`,
        [uid, req.params.id]
      );
    }

    if (_io && ids.length) {
      const groupRes = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
      const group = groupRes.rows[0];
      const countRes = await pool.query('SELECT COUNT(*) FROM group_members WHERE group_id=$1', [req.params.id]);
      ids.forEach(uid => {
        _io.sockets.sockets.forEach(socket => {
          if (String(socket.userId) === String(uid)) {
            socket.join(`group:${group.id}`);
            socket.emit('group:created', {
              group: { ...group, member_count: Number(countRes.rows[0].count), role: 0 },
              by: 'admin',
            });
          }
        });
      });
    }

    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[groups:invite]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id/members/:userId', authMiddleware, async (req, res) => {
  try {
    const myRole = await getMemberRole(req.params.id, req.userId);
    const targetRole = await getMemberRole(req.params.id, req.params.userId);
    const groupRes = await pool.query('SELECT id, name, avatar_url FROM groups WHERE id=$1', [req.params.id]);
    const group = groupRes.rows[0] || null;
    if (myRole == null || myRole < 1) return res.status(403).json({ error: 'Permission denied' });
    if (targetRole == null) return res.json({ message: 'ok' });
    if (Number(req.params.userId) === Number(req.userId)) return res.status(400).json({ error: 'Use leave group' });
    if (targetRole >= myRole) return res.status(403).json({ error: 'Permission denied' });

    await pool.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [req.params.id, req.params.userId]);
    await pool.query(
      `UPDATE conversations
       SET group_state='kicked',
           target_name_snapshot=COALESCE($3, target_name_snapshot, ''),
           target_avatar_snapshot=COALESCE($4, target_avatar_snapshot, ''),
           updated_at=NOW()
       WHERE user_id=$1 AND target_id=$2 AND type=1`,
      [req.params.userId, req.params.id, group?.name || '', group?.avatar_url || '']
    );
    emitGroupLeft(req.params.userId, req.params.id, 'kicked', group);

    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[groups:kick]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/:id/leave', authMiddleware, async (req, res) => {
  try {
    const group = await pool.query('SELECT owner_id FROM groups WHERE id=$1', [req.params.id]);
    if (!group.rows.length) return res.status(404).json({ error: 'Group not found' });
    if (Number(group.rows[0].owner_id) === Number(req.userId)) {
      return res.status(400).json({ error: 'Owner must dissolve the group' });
    }

    await pool.query('DELETE FROM group_members WHERE group_id=$1 AND user_id=$2', [req.params.id, req.userId]);
    await pool.query('DELETE FROM conversations WHERE user_id=$1 AND target_id=$2 AND type=1', [req.userId, req.params.id]);
    emitGroupLeft(req.userId, req.params.id, 'leave');

    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[groups:leave]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const group = await pool.query('SELECT id, name, avatar_url, owner_id FROM groups WHERE id=$1', [req.params.id]);
    if (!group.rows.length) return res.status(404).json({ error: 'Group not found' });
    const groupInfo = group.rows[0];
    if (Number(groupInfo.owner_id) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Only owner can dissolve the group' });
    }
    const memberRes = await pool.query('SELECT user_id FROM group_members WHERE group_id=$1', [req.params.id]);
    const memberIds = memberRes.rows.map(row => row.user_id);

    await pool.query(
      `UPDATE conversations
       SET group_state='dissolved',
           target_name_snapshot=COALESCE($2, target_name_snapshot, ''),
           target_avatar_snapshot=COALESCE($3, target_avatar_snapshot, ''),
           updated_at=NOW()
       WHERE target_id=$1 AND type=1`,
      [req.params.id, groupInfo.name || '', groupInfo.avatar_url || '']
    );
    await pool.query('DELETE FROM groups WHERE id=$1', [req.params.id]);
    emitGroupLeftToUsers(memberIds, req.params.id, 'dissolved', groupInfo);

    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[groups:dissolve]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/admin/:userId', authMiddleware, async (req, res) => {
  const { action } = req.body;
  try {
    const group = await pool.query('SELECT owner_id FROM groups WHERE id=$1', [req.params.id]);
    if (!group.rows.length || Number(group.rows[0].owner_id) !== Number(req.userId)) {
      return res.status(403).json({ error: 'Permission denied' });
    }
    await pool.query(
      'UPDATE group_members SET role=$1 WHERE group_id=$2 AND user_id=$3',
      [action === 'set' ? 1 : 0, req.params.id, req.params.userId]
    );
    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[groups:admin]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/info', authMiddleware, async (req, res) => {
  const { name, avatar_url } = req.body;
  try {
    const myRole = await getMemberRole(req.params.id, req.userId);
    if (myRole == null || myRole < 1) return res.status(403).json({ error: 'Permission denied' });

    const updates = [];
    const values = [];
    if (name?.trim()) {
      updates.push(`name = $${updates.length + 1}`);
      values.push(name.trim());
    }
    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${updates.length + 1}`);
      values.push(avatar_url);
    }
    if (!updates.length) return res.status(400).json({ error: 'No update data' });

    values.push(req.params.id);
    await pool.query(`UPDATE groups SET ${updates.join(', ')} WHERE id = $${values.length}`, values);
    const groupRes = await pool.query('SELECT * FROM groups WHERE id = $1', [req.params.id]);
    const updatedGroup = groupRes.rows[0];
    if (_io && updatedGroup) _io.to(`group:${req.params.id}`).emit('group:profile_updated', updatedGroup);

    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[groups:info]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/:id/announcement', authMiddleware, async (req, res) => {
  const { announcement } = req.body;
  try {
    const myRole = await getMemberRole(req.params.id, req.userId);
    if (myRole == null || myRole < 1) return res.status(403).json({ error: 'Permission denied' });

    await pool.query('UPDATE groups SET announcement=$1 WHERE id=$2', [announcement || '', req.params.id]);
    res.json({ message: 'ok' });
  } catch (err) {
    console.error('[groups:announcement]', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.setIO = setIO;
