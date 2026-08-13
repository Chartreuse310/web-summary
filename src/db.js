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
const { t } = require('./i18n');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DB_DIR, 'clippings.db');

// 确保数据目录存在
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // 提升并发写性能
db.pragma('foreign_keys = ON'); // 启用外键级联（删剪藏时联动删高亮）

// ===== 建表（幂等）=====
db.exec(`
  CREATE TABLE IF NOT EXISTS clippings (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    url               TEXT NOT NULL,
    title             TEXT NOT NULL,
    author            TEXT,        -- JSON 字符串数组
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
    lang              TEXT DEFAULT 'zh',  -- 摘要生成时的界面语言（zh/en），用于分区筛选
    saved_at          TEXT NOT NULL  -- ISO 时间字符串
  );
  CREATE INDEX IF NOT EXISTS idx_saved_at ON clippings(saved_at);
  CREATE INDEX IF NOT EXISTS idx_tags ON clippings(tags);
  -- idx_lang 在下方迁移块中创建（旧库需先 ALTER 加列再建索引）
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

// ===== 幻移：author 从单字符串迁移为 JSON 数组（幂等，可反复重启）=====
// 统一走 normalizeAuthors：兼容旧裸字符串、JSON 数组、含纯空格的合著等所有形态。
// 只在规范化结果与当前存储不一致时写回，减少无谓写与 WAL 膨胀。
{
  const rows = db.prepare("SELECT id, author FROM clippings WHERE author IS NOT NULL").all();
  const upd = db.prepare("UPDATE clippings SET author = ? WHERE id = ?");
  for (const r of rows) {
    const canonical = JSON.stringify(normalizeAuthors(r.author));
    if (r.author !== canonical) upd.run(canonical, r.id);
  }
}

// ===== 幻移：为旧库补 lang 列 + 回填历史数据为 zh（幂等，可反复重启）=====
// 中英文分区存储：每条剪藏记录摘要生成时的界面语言。
// 历史数据全部为中文生成，统一标记 lang='zh'；新生成的按当前语言写入。
{
  const cols = db.prepare("PRAGMA table_info(clippings)").all().map((c) => c.name);
  if (!cols.includes('lang')) {
    db.exec("ALTER TABLE clippings ADD COLUMN lang TEXT DEFAULT 'zh'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_lang ON clippings(lang)");
  }
  // 历史无 lang 的全部回填为 zh（幂等：已有值的不会被覆盖）
  db.prepare("UPDATE clippings SET lang = 'zh' WHERE lang IS NULL").run();
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

// ===== 幻移：高亮评论表（幂等，可反复重启）=====
// 每条高亮关联一篇剪藏；定位用 exact_text + prefix + suffix 三段文本上下文，
// 不依赖 DOM 偏移（文章被编辑后偏移会失效），还原时前端按三段拼接做子串匹配。
{
  db.exec(`
    CREATE TABLE IF NOT EXISTS highlights (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      clipping_id INTEGER NOT NULL,
      exact_text  TEXT NOT NULL,
      prefix      TEXT NOT NULL,
      suffix      TEXT NOT NULL,
      comment     TEXT,
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      FOREIGN KEY (clipping_id) REFERENCES clippings(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_highlights_clipping ON highlights(clipping_id);
  `);
}

// 幂等加 color 列：多颜色高亮（yellow/blue/red），旧数据默认 yellow
{
  const cols = db.prepare('PRAGMA table_info(highlights)').all().map((c) => c.name);
  if (!cols.includes('color')) {
    db.exec("ALTER TABLE highlights ADD COLUMN color TEXT NOT NULL DEFAULT 'yellow'");
  }
}

// ===== 行 → 对象（解析 JSON 字段）=====
function rowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    author: normalizeAuthors(row.author),
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
    lang: row.lang || 'zh',
    savedAt: row.saved_at,
    highlightCount: row.highlight_count != null ? row.highlight_count : 0
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

/**
 * 把任意形态的 author 值归一化成字符串数组（去空、去重）。
 * 入参可以是：
 *   - 数组（来自 extract/PUT 的标准形态）
 *   - JSON 字符串数组（DB 列里的标准存储）
 *   - 裸字符串（旧数据，如 "张三" / "张三、李四" / "张三 李四"）
 *   - JSON 标量（"123" / "null" / "\"张三\""）
 *   - null/undefined/空字符串 → []
 * 统一按分隔符（逗号/顿号/分号/&/and/和/与/纯空格）拆分，trim 后去空。
 * 这是 API 出口的唯一护栏：保证 items[].author 永远是字符串数组。
 */

// 「张三 等」「Zhang et al.」这类省略标记不是真实作者名，
// 这里统一过滤掉，避免污染作者排行与统计。
// 匹配：中文「等」；英文 et al / et.al / et al. （大小写不敏感）。
// 用 function 声明（会提升），保证文件顶部迁移块调用 normalizeAuthors 时可用。
function isAuthorStop(name) {
  if (!name) return true;
  const n = name.trim();
  if (!n) return true;
  if (n === '等') return true;
  if (/^et\.?\s*al\.?$/i.test(n)) return true;
  return false;
}

function normalizeAuthors(raw) {
  // 先把入参规整到一个"字符串候选列表"
  let list;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string') {
    // 优先按 JSON 解析（DB 标准存储是 JSON 数组字符串）
    let parsed;
    try { parsed = JSON.parse(raw); } catch { /* 裸字符串，落到下面 */ }
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed === null || parsed === undefined) {
      return [];
    } else if (typeof parsed === 'string') {
      list = [parsed];
    } else {
      list = [String(parsed)];
    }
  } else if (raw === null || raw === undefined) {
    return [];
  } else {
    list = [String(raw)];
  }
  // 拆分 + trim + 去空 + 去重（保留顺序）
  const out = [];
  const seen = new Set();
  for (const item of list) {
    if (item === null || item === undefined) continue;
    const s = typeof item === 'string' ? item : String(item);
    // 先剥离「et al.」省略尾缀：把 "Smith et al." 这类替换成 "Smith,"，
    // 使其按逗号分隔后留下真实作者名 "Smith"（而非整串 "Smith et al."）。
    const normalized = s.replace(/\bet\.?\s*al\.?/gi, ',');
    // 按非空格分隔符拆分（逗号/顿号/分号/&/and/和/与）
    const parts = normalized.split(/[,，、;；&]|\s+and\s+|\s+和\s+|\s+与\s+/i);
    for (const p of parts) {
      // 含中文：人名内部不含空格，空格是多作者分隔符，再按空格拆（如"乔钰 魏青"→两人）；
      // 不含中文（拉丁等）：空格是「名 姓」内部，保留（如"John Smith"）。
      const names = /[\u4e00-\u9fff]/.test(p) ? p.trim().split(/\s+/) : [p];
      for (const name of names) {
        const n = name.trim();
        // 过滤空值与「等 / et al.」类省略标记，再去重
        if (!isAuthorStop(n) && !seen.has(n)) {
          seen.add(n);
          out.push(n);
        }
      }
    }
  }
  return out;
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
       model, prompt_tokens, completion_tokens, total_tokens, cost, content_text, content_html, lang, saved_at)
    VALUES
      (@url, @title, @author, @platform, @publishedAt, @outline, @summary, @oneliner, @tags,
       @model, @promptTokens, @completionTokens, @totalTokens, @cost, @contentText, @contentHtml, @lang, @savedAt)
  `);
  const result = stmt.run({
    url: d.url,
    title: d.title,
    author: JSON.stringify(normalizeAuthors(d.author)),
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
    lang: d.lang === 'en' ? 'en' : 'zh',
    savedAt: now
  });
  return result.lastInsertRowid;
}

/**
 * 列表查询（带搜索、tag 筛选、分页）
 */
function listClippings({ q, tag, sort = 'recent', limit = 50, offset = 0, from, to, lang } = {}) {
  const where = [];
  const params = {};

  // 按语言分区筛选：仅返回当前界面语言下生成的剪藏
  if (lang) {
    where.push('lang = @lang');
    params.lang = lang;
  }
  if (q) {
    where.push('(title LIKE @q OR summary LIKE @q OR author LIKE @q)');
    params.q = `%${q}%`;
  }
  if (tag) {
    // tags 字段是 JSON 数组字符串，用 LIKE 粗略匹配（个人库量级够用）
    where.push('tags LIKE @tag');
    params.tag = `%"${tag.replace(/"/g, '\\"')}"%`;
  }
  if (from) {
    where.push('saved_at >= @from');
    params.from = from;
  }
  if (to) {
    where.push('saved_at < @to');
    params.to = to;
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
      `SELECT c.*,
              (SELECT COUNT(*) FROM highlights h WHERE h.clipping_id = c.id) AS highlight_count
       FROM clippings c ${whereSql} ${orderSql} LIMIT @limit OFFSET @offset`
    )
    .all({ ...params, limit, offset });

  const total = db
    .prepare(`SELECT COUNT(*) AS n FROM clippings ${whereSql}`)
    .get(params).n;

  return { items: rows.map(rowToObj), total };
}

function getClipping(id) {
  return rowToObj(
    db
      .prepare(
        `SELECT c.*,
                (SELECT COUNT(*) FROM highlights h WHERE h.clipping_id = c.id) AS highlight_count
         FROM clippings c WHERE c.id = ?`
      )
      .get(id)
  );
}

/**
 * 更新（支持 tags / author / title / summary / oneliner / contentHtml / contentText / outline）
 */
function updateClipping(id, { title, summary, oneliner, tags, author, contentHtml, contentText, outline } = {}) {
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
  if (author !== undefined) {
    sets.push('author = @author');
    params.author = JSON.stringify(normalizeAuthors(author));
  }
  if (sets.length === 0) return getClipping(id);
  db.prepare(`UPDATE clippings SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return getClipping(id);
}

function deleteClipping(id) {
  // 外键级联已开（ON DELETE CASCADE），这里兜底手动删，兼容旧库未启用 foreign_keys 的情况
  db.prepare('DELETE FROM highlights WHERE clipping_id = ?').run(id);
  db.prepare('DELETE FROM clippings WHERE id = ?').run(id);
}

// ===== 高亮评论 =====

/** 高亮行 → 对象 */
function highlightRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    clippingId: row.clipping_id,
    exactText: row.exact_text,
    prefix: row.prefix,
    suffix: row.suffix,
    comment: row.comment,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * 新增高亮
 * @param {object} h { clippingId, exactText, prefix, suffix, comment? }
 * @returns {object} 新建的高亮对象
 */
function insertHighlight({ clippingId, exactText, prefix, suffix, comment, color }) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO highlights (clipping_id, exact_text, prefix, suffix, comment, color, created_at, updated_at)
       VALUES (@clippingId, @exactText, @prefix, @suffix, @comment, @color, @now, @now)`
    )
    .run({
      clippingId,
      exactText,
      prefix: prefix || '',
      suffix: suffix || '',
      comment: comment || null,
      color: color || 'yellow',
      now: now
    });
  return getHighlight(result.lastInsertRowid);
}

/** 取单条高亮 */
function getHighlight(id) {
  return highlightRowToObj(db.prepare('SELECT * FROM highlights WHERE id = ?').get(id));
}

/** 列出某篇剪藏的全部高亮（按创建时间升序，与文中出现顺序一致）*/
function listHighlights(clippingId) {
  return db
    .prepare('SELECT * FROM highlights WHERE clipping_id = ? ORDER BY created_at ASC, id ASC')
    .all(clippingId)
    .map(highlightRowToObj);
}

/** 更新高亮评论 */
function updateHighlight(id, { comment, color }) {
  const now = new Date().toISOString();
  // comment 与 color 可独立更新（仅更新实际传入的字段）
  if (comment !== undefined) {
    db.prepare('UPDATE highlights SET comment = @comment, updated_at = @now WHERE id = @id').run({
      id,
      comment: comment || null,
      now
    });
  }
  if (color !== undefined) {
    db.prepare('UPDATE highlights SET color = @color, updated_at = @now WHERE id = @id').run({
      id,
      color,
      now
    });
  }
  return getHighlight(id);
}

/** 删除单条高亮 */
function deleteHighlight(id) {
  db.prepare('DELETE FROM highlights WHERE id = ?').run(id);
}

// ===== 统计 =====

/**
 * 汇总统计：总数、累计 token、累计费用、按模型/平台分布
 * @param {object} opt { lang } 仅统计指定语言的剪藏（中英文分区）
 */
function getStats({ lang } = {}) {
  // 统一用命名参数：WHERE 条件用 @lang，平台兜底用 @unknown
  const langClause = lang ? 'WHERE lang = @lang' : '';
  const params = lang ? { lang } : {};

  const totals = db
    .prepare(
      `SELECT
         COUNT(*)                    AS count,
         COALESCE(SUM(total_tokens), 0)  AS totalTokens,
         COALESCE(SUM(cost), 0)          AS totalCost
       FROM clippings ${langClause}`
    )
    .get(params);

  const byModel = db
    .prepare(
      `SELECT model,
              COUNT(*)                    AS count,
              COALESCE(SUM(total_tokens),0) AS totalTokens,
              COALESCE(SUM(cost),0)         AS totalCost
       FROM clippings ${langClause} GROUP BY model ORDER BY totalTokens DESC`
    )
    .all(params);

  const unknownLabel = t(lang || 'zh', 'stats.unknown');
  const byPlatform = db
    .prepare(
      `SELECT COALESCE(NULLIF(platform,''), @unknown) AS platform, COUNT(*) AS count
       FROM clippings ${langClause} GROUP BY platform ORDER BY count DESC LIMIT 10`
    )
    .all({ ...params, unknown: unknownLabel });

  // 按作者分布（从 JSON 数组展开，每个作者独立计数 + 累计 token/费用）
  const allAuthorRows = db.prepare(`SELECT author, total_tokens, cost FROM clippings ${langClause}`).all(params);
  const authorStat = {};
  for (const row of allAuthorRows) {
    const names = normalizeAuthors(row.author);
    const keys = names.length ? names : [unknownLabel];
    for (const k of keys) {
      if (!authorStat[k]) authorStat[k] = { count: 0, totalTokens: 0, totalCost: 0 };
      authorStat[k].count += 1;
      authorStat[k].totalTokens += row.total_tokens || 0;
      authorStat[k].totalCost += row.cost || 0;
    }
  }
  const byAuthor = Object.entries(authorStat)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([author, v]) => ({ author, count: v.count, totalTokens: v.totalTokens, totalCost: v.totalCost }));

  // 所有 tag 频次（从 JSON 字段解析）
  const allTags = db.prepare(`SELECT tags FROM clippings ${langClause}`).all(params);
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
    byAuthor,
    topTags,
    distinctTags: Object.keys(tagCount).length // 去重标签总数（供首页「标签量」卡片）
  };
}

/**
 * 时间聚类：按年/月/周/日聚合篇数（供剪藏库左侧时间筛选）
 * @param {object} opt { lang }
 */
function getTimeClusters({ lang } = {}) {
  const langWhere = lang ? 'WHERE lang = ?' : '';
  const langArg = lang ? [lang] : [];
  const byYear = db
    .prepare(`SELECT substr(saved_at,1,4) AS key, COUNT(*) AS count FROM clippings ${langWhere} GROUP BY key ORDER BY key DESC`)
    .all(...langArg);
  const byMonth = db
    .prepare(`SELECT substr(saved_at,1,7) AS key, COUNT(*) AS count FROM clippings ${langWhere} GROUP BY key ORDER BY key DESC`)
    .all(...langArg);
  const byWeek = db
    // 以「所在周周一」日期为 key（dow: 0=周日 → 折算为距周一天数），便于前端换算 from/to
    .prepare(`SELECT date(saved_at, '-' || ((CAST(strftime('%w', saved_at) AS INTEGER) + 6) % 7) || ' days') AS key, COUNT(*) AS count FROM clippings ${langWhere} GROUP BY key ORDER BY key DESC LIMIT 40`)
    .all(...langArg);
  const byDay = db
    .prepare(`SELECT substr(saved_at,1,10) AS key, COUNT(*) AS count FROM clippings ${langWhere} GROUP BY key ORDER BY key DESC LIMIT 60`)
    .all(...langArg);
  return { byYear, byMonth, byWeek, byDay };
}

/**
 * 时间趋势：最近 N 天每天的 token / cost / count
 * @param {number} days 默认 30
 * @param {object} opt { lang }
 */
function getTokenTrend(days = 30, { lang } = {}) {
  // SQLite 用 substr 取 saved_at 的 YYYY-MM-DD
  const langClause = lang ? 'AND lang = @lang' : '';
  const rows = db
    .prepare(
      `SELECT
         substr(saved_at, 1, 10)                    AS date,
         COALESCE(SUM(total_tokens), 0)             AS tokens,
         COALESCE(SUM(cost), 0)                     AS cost,
         COUNT(*)                                   AS count
       FROM clippings
       WHERE saved_at >= date('now', @offset) ${langClause}
       GROUP BY substr(saved_at, 1, 10)
       ORDER BY date ASC`
    )
    .all({ offset: `-${days} day`, ...(lang ? { lang } : {}) });

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
  insertHighlight,
  getHighlight,
  listHighlights,
  updateHighlight,
  deleteHighlight,
  getStats,
  getTimeClusters,
  getTokenTrend
};
