const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'chatapp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'password',
});

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  nickname VARCHAR(100),
  avatar_url TEXT DEFAULT '',
  password_hash VARCHAR(255) NOT NULL,
  status INTEGER DEFAULT 0,
  desired_status INTEGER DEFAULT 1,
  signature TEXT DEFAULT '',
  gender VARCHAR(10) DEFAULT '',
  region VARCHAR(100) DEFAULT '',
  is_logged_in BOOLEAN DEFAULT FALSE,
  token_version INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS friendships (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  friend_id INTEGER NOT NULL REFERENCES users(id),
  group_name VARCHAR(50) DEFAULT '我的好友',
  remark VARCHAR(100) DEFAULT '',
  status INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, friend_id)
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  avatar_url TEXT DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id),
  group_id VARCHAR(50),
  announcement TEXT DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS group_join_requests (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role INTEGER DEFAULT 0,
  join_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id SERIAL PRIMARY KEY,
  sender_id INTEGER NOT NULL REFERENCES users(id),
  receiver_id INTEGER,
  group_id INTEGER,
  type INTEGER DEFAULT 0,
  content TEXT,
  file_name TEXT,
  file_size INTEGER,
  file_url TEXT,
  reply_to INTEGER,
  is_recalled BOOLEAN DEFAULT FALSE,
  status INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_deliveries (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  file_name VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  hash VARCHAR(64),
  storage_type VARCHAR(20) DEFAULT 'local',
  cloud_file_id TEXT,
  cloud_path TEXT,
  public_url TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  target_id INTEGER NOT NULL,
  type INTEGER DEFAULT 0,
  last_message_id INTEGER,
  unread_count INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  is_muted INTEGER DEFAULT 0,
  group_state VARCHAR(20) DEFAULT 'active',
  target_name_snapshot TEXT DEFAULT '',
  target_avatar_snapshot TEXT DEFAULT '',
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, target_id, type)
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_group ON messages(group_id);
CREATE INDEX IF NOT EXISTS idx_message_deliveries_user ON message_deliveries(user_id);
CREATE INDEX IF NOT EXISTS idx_message_deliveries_message ON message_deliveries(message_id);
CREATE INDEX IF NOT EXISTS idx_message_deliveries_pending ON message_deliveries(user_id, delivered_at);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
`;

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(schema);
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0');
    await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS desired_status INTEGER DEFAULT 1');
    await client.query('UPDATE users SET desired_status = 1 WHERE desired_status IS NULL OR desired_status < 1 OR desired_status > 4');
    await client.query("ALTER TABLE files ADD COLUMN IF NOT EXISTS storage_type VARCHAR(20) DEFAULT 'local'");
    await client.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS cloud_file_id TEXT');
    await client.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS cloud_path TEXT');
    await client.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS public_url TEXT');
    await client.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_state VARCHAR(20) DEFAULT 'active'");
    await client.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS target_name_snapshot TEXT DEFAULT ''");
    await client.query("ALTER TABLE conversations ADD COLUMN IF NOT EXISTS target_avatar_snapshot TEXT DEFAULT ''");
    await client.query("ALTER TABLE groups ADD COLUMN IF NOT EXISTS group_id VARCHAR(50)");
    await client.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_group_id ON groups(group_id)");
    await client.query("UPDATE conversations SET group_state = 'active' WHERE group_state IS NULL");
    await client.query(`
      INSERT INTO message_deliveries (message_id, user_id)
      SELECT id, user_id
      FROM (
        SELECT m.id,
               c.user_id,
               c.unread_count,
               ROW_NUMBER() OVER (
                 PARTITION BY c.user_id, c.target_id, c.type
                 ORDER BY m.id DESC
               ) AS rn
        FROM conversations c
        JOIN messages m ON m.group_id IS NULL
          AND m.sender_id = c.target_id
          AND m.receiver_id = c.user_id
        WHERE c.type = 0 AND c.unread_count > 0
      ) pending
      WHERE rn <= unread_count
      ON CONFLICT (message_id, user_id) DO NOTHING
    `);
    await client.query(`
      INSERT INTO message_deliveries (message_id, user_id)
      SELECT id, user_id
      FROM (
        SELECT m.id,
               c.user_id,
               c.unread_count,
               ROW_NUMBER() OVER (
                 PARTITION BY c.user_id, c.target_id, c.type
                 ORDER BY m.id DESC
               ) AS rn
        FROM conversations c
        JOIN messages m ON m.group_id = c.target_id
          AND m.sender_id <> c.user_id
        WHERE c.type = 1 AND c.unread_count > 0
      ) pending
      WHERE rn <= unread_count
      ON CONFLICT (message_id, user_id) DO NOTHING
    `);
    console.log('鉁?Database initialized');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };

