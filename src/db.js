/**
 * SQLite 持久化层
 *
 * 单表 clippings，存储网页剪藏的全部信息。
 * 文件位置：data/clippings.db（运行时自动创建目录）。
 *
 * 使用 better-sqlite3 的同步 API —— 个人工具无需异步开销，
 * 代码更简单，性能也更好。
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'clippings.db');

// 确保数据目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // 提升并发写性能

// ===== 建表（幂等）=====
db.exec(`
  CREATE TABLE IF NOT EXISTS clippings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    url               TEXT NOT NULL,
    title             TEXT NOT NULL,
    author            TEXT,
    platform          TEXT,
    published_at      TEXT,
    outline           TEXT,        -- JSON 数组 [{level,text}]
    summary           TEXT NOT NULL,
    oneliner          TEXT,        -- 一句话核心概括（≤30 字）
    tags              TEXT,        -- JSON 字符串数组
    model             TEXT NOT NULL,
    prompt_tokens     INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens      INTEGER DEFAULT 0,
    cost              REAL DEFAULT 0,
    content_text      TEXT,
    content_html      TEXT,        -- 清洗后的结构化全文 HTML
    saved_at          TEXT NOT NULL  -- ISO 时间字符串
  );
  CREATE INDEX IF NOT EXISTS idx_saved_at ON clippings(saved_at);
  CREATE INDEX IF NOT EXISTS idx_tags ON clippings(tags);
`);

// ===== 幻移：为旧库补 oneliner 列（幂等，可反复重启）=====
// 兼容已有数据库：若 clippings 表缺少 oneliner 字段则补上。
{
  const cols = db.prepare("PRAGMA table_info(clippings)").all().map((c) => c.name);
  if (!cols.includes('oneliner')) {
    db.exec('ALTER TABLE clippings ADD COLUMN oneliner TEXT');
  }
}

// ===== 幻移：为旧库补 content_html 列（幂等）=====
{
  const cols = db.prepare("PRAGMA table_info(clippings)").all().map((c) => c.name);
  if (!cols.includes('content_html')) {
    db.exec('ALTER TABLE clippings ADD COLUMN content_html TEXT');
  }
}

// ===== 回填：给 oneliner 为空的旧数据补一句话总结 =====
// 从 summary 的首行提取（prompt 让首行就是核心概括），保证历史数据体验一致。
{
  const rows = db.prepare("SELECT id, summary FROM clippings WHERE oneliner IS NULL").all();
  const upd = db.prepare("UPDATE clippings SET oneliner = ? WHERE id = ?");
  for (const r of rows) {
    const firstLine = (r.summary || '').split('\n').map((s) => s.trim()).find((s) => s.length > 0) || '';
    // 去掉要点符号 "• "，截断到 60 字内（兼容旧 summary 各种格式）
    const oneliner = firstLine.replace(/^[•·\-]\s*/, '').slice(0, 60);
    upd.run(oneliner || null, r.id);
  }
}

// ===== 行 → 对象（解析 JSON 字段）=====
function rowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    author: row.author,
    platform: row.platform,
    publishedAt: row.published_at,
    outline: safeParse(row.outline, []),
    summary: row.summary,
    oneliner: row.oneliner,
    tags: safeParse(row.tags, []),
    model: row.model,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    totalTokens: row.total_tokens,
    cost: row.cost,
    contentText: row.content_text,
    contentHtml: row.content_html,
    savedAt: row.saved_at
  };
}

function safeParse(s, fallback) {
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// ===== CRUD =====

/**
 * 插入一条剪藏
 * @param {object} d 剪藏数据（见 rowToObj 反向字段）
 * @returns {number} 新插入的 id
 */
function insertClipping(d) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO clippings
      (url, title, author, platform, published_at, outline, summary, oneliner, tags,
       model, prompt_tokens, completion_tokens, total_tokens, cost, content_text, content_html, saved_at)
    VALUES
      (@url, @title, @author, @platform, @publishedAt, @outline, @summary, @oneliner, @tags,
       @model, @promptTokens, @completionTokens, @totalTokens, @cost, @contentText, @contentHtml, @savedAt)
  `);
  const result = stmt.run({
    url: d.url,
    title: d.title,
    author: d.author || null,
    platform: d.platform || null,
    publishedAt: d.publishedAt || null,
    outline: JSON.stringify(d.outline || []),
    summary: d.summary,
    oneliner: d.oneliner || null,
    tags: JSON.stringify(d.tags || []),
    model: d.model,
    promptTokens: d.promptTokens || 0,
    completionTokens: d.completionTokens || 0,
    totalTokens: d.totalTokens || 0,
    cost: d.cost || 0,
    contentText: d.contentText || null,
    contentHtml: d.contentHtml || null,
    savedAt: now
  });
  return result.lastInsertRowid;
}

/**
 * 列表查询（带搜索、tag 筛选、分页）
 */
function listClippings({ q, tag, sort = 'recent', limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = {};

  if (q) {
    where.push('(title LIKE @q OR summary LIKE @q OR author LIKE @q)');
    params.q = `%${q}%`;
  }
  if (tag) {
    // tags 字段是 JSON 数组字符串，用 LIKE 粗略匹配（个人库量级够用）
    where.push('tags LIKE @tag');
    params.tag = `%"${tag.replace(/"/g, '\\"')}"%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql =
    sort === 'tokens'
      ? 'ORDER BY total_tokens DESC'
      : sort === 'cost'
        ? 'ORDER BY cost DESC'
        : 'ORDER BY saved_at DESC';

  const rows = db
    .prepare(
      `SELECT * FROM clippings ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM clippings ${whereSql}`)
    .get(params).n;

  return { items: rows.map(rowToObj), total };
}

function getClipping(id) {
  return rowToObj(db.prepare('SELECT * FROM clippings WHERE id = ?').get(id));
}

/**
 * 更新（支持 tags / title / summary / oneliner / contentHtml / contentText / outline）
 */
function updateClipping(id, { title, summary, oneliner, tags, contentHtml, contentText, outline } = {}) {
  const sets = [];
  const params = { id };
  if (title !== undefined) {
    sets.push('title = @title');
    params.title = title;
  }
  if (summary !== undefined) {
    sets.push('summary = @summary');
    params.summary = summary;
  }
  if (oneliner !== undefined) {
    sets.push('oneliner = @oneliner');
    params.oneliner = oneliner;
  }
  if (tags !== undefined) {
    sets.push('tags = @tags');
    params.tags = JSON.stringify(tags);
  }
  if (contentHtml !== undefined) {
    sets.push('content_html = @contentHtml');
    params.contentHtml = contentHtml;
  }
  if (contentText !== undefined) {
    sets.push('content_text = @contentText');
    params.contentText = contentText;
  }
  if (outline !== undefined) {
    sets.push('outline = @outline');
    params.outline = JSON.stringify(outline);
  }
  if (sets.length === 0) return getClipping(id);
  db.prepare(`UPDATE clippings SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getClipping(id);
}

function deleteClipping(id) {
  db.prepare('DELETE FROM clippings WHERE id = ?').run(id);
}

// ===== 统计 =====

/**
 * 汇总统计：总数、累计 token、累计费用、按模型/平台分布
 */
function getStats() {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*)                    AS count,
         COALESCE(SUM(total_tokens), 0)  AS totalTokens,
         COALESCE(SUM(cost), 0)          AS totalCost
       FROM clippings`
    )
    .get();

  const byModel = db
    .prepare(
      `SELECT model,
              COUNT(*)                    AS count,
              COALESCE(SUM(total_tokens),0) AS totalTokens,
              COALESCE(SUM(cost),0)         AS totalCost
       FROM clippings GROUP BY model ORDER BY totalTokens DESC`
    )
    .all();

  const byPlatform = db
    .prepare(
      `SELECT COALESCE(platform,'未知') AS platform, COUNT(*) AS count
       FROM clippings GROUP BY platform ORDER BY count DESC LIMIT 10`
    )
    .all();

  // 所有 tag 频次（从 JSON 字段解析）
  const allTags = db.prepare('SELECT tags FROM clippings').all();
  const tagCount = {};
  for (const { tags } of allTags) {
    const arr = safeParse(tags, []);
    if (Array.isArray(arr)) {
      for (const t of arr) {
        if (typeof t === 'string') tagCount[t] = (tagCount[t] || 0) + 1;
      }
    }
  }
  const topTags = Object.entries(tagCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  return {
    count: totals.count,
    totalTokens: totals.totalTokens,
    totalCost: totals.totalCost,
    byModel,
    byPlatform,
    topTags,
    distinctTags: Object.keys(tagCount).length // 去重标签总数（供首页「标签量」卡片）
  };
}

/**
 * 时间趋势：最近 N 天每天的 token / cost / count
 * @param {number} days 默认 30
 */
function getTokenTrend(days = 30) {
  // SQLite 用 substr 取 saved_at 的 YYYY-MM-DD
  const rows = db
    .prepare(
      `SELECT
         substr(saved_at, 1, 10)                    AS date,
         COALESCE(SUM(total_tokens), 0)             AS tokens,
         COALESCE(SUM(cost), 0)                     AS cost,
         COUNT(*)                                   AS count
       FROM clippings
       WHERE saved_at >= date('now', @offset)
       GROUP BY substr(saved_at, 1, 10)
       ORDER BY date ASC`
    )
    .all({ offset: `-${days} day` });

  return rows.map((r) => ({
    date: r.date,
    tokens: r.tokens,
    cost: r.cost,
    count: r.count
  }));
}

module.exports = {
  db,
  insertClipping,
  listClippings,
  getClipping,
  updateClipping,
  deleteClipping,
  getStats,
  getTokenTrend
};
