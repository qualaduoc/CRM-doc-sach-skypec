/**
 * Zalo crew mapping helpers
 * - Store full person names (prefer diacritics): "Nguyễn Đình Hùng"
 * - Match via normalizeMapKey (strip diacritics + upper)
 * - Manual mappings always win over auto
 */

function stripDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Canonical lookup key: "NGUYEN DINH HUNG" */
function normalizeMapKey(name) {
  return stripDiacritics(name)
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasDiacritics(name) {
  const s = String(name || '');
  return s !== stripDiacritics(s) || /[đĐ]/.test(s);
}

function collapseSpaces(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

/**
 * Full name only — reject nicknames / abbreviations:
 * HÙNG, TUẤN, TRỪNG, N.LONG, D.HỘI, B.HIỆP, V.TUẤN, GẤM KAMI (2 short tokens edge)
 */
function isFullPersonName(name) {
  const display = collapseSpaces(name);
  if (!display) return false;

  const key = normalizeMapKey(display);
  if (!key) return false;

  const parts = key.split(' ').filter(Boolean);
  // Need at least 2 tokens (họ + tên)
  if (parts.length < 2) return false;

  // Reject "N LONG", "D HOI", "B HIEP", "V TUAN", "L KIEN" (initial + short)
  if (parts.length === 2 && parts[0].length <= 2) return false;

  // Reject very short total (e.g. "HA LA")
  const compact = parts.join('');
  if (compact.length < 8) return false;

  // Each significant token at least 2 chars (except middle initials rare — we reject short first token already)
  if (parts.some((p) => p.length < 2)) return false;

  return true;
}

function scoreDisplayName(name) {
  let score = 0;
  const s = collapseSpaces(name);
  if (hasDiacritics(s)) score += 100;
  score += s.length;
  // Prefer mixed case / original VN form over ALL CAPS ASCII
  if (/[a-zăâêôơưđ]/i.test(s) && s !== s.toUpperCase()) score += 10;
  return score;
}

/** Build Map name_key -> best mapping row (manual > auto, then better display name) */
function buildMappingLookup(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const key = row.name_key || normalizeMapKey(row.schedule_name);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, row);
      continue;
    }
    const existManual = (existing.source || '') === 'manual' ? 1 : 0;
    const rowManual = (row.source || '') === 'manual' ? 1 : 0;
    if (rowManual > existManual) {
      map.set(key, row);
      continue;
    }
    if (rowManual === existManual && scoreDisplayName(row.schedule_name) > scoreDisplayName(existing.schedule_name)) {
      map.set(key, row);
    }
  }
  return map;
}

function resolveMapping(lookup, personName) {
  if (!personName || !lookup) return null;
  const key = normalizeMapKey(personName);
  if (!key) return null;
  return lookup.get(key) || null;
}

function resolveUid(lookup, personName) {
  const m = resolveMapping(lookup, personName);
  return m ? String(m.zalo_uid).trim() : '';
}

/**
 * Upsert mapping by name_key.
 * source: 'manual' | 'auto'
 * Manual always overwrites auto; auto never overwrites manual (unless same uid refresh display).
 */
async function upsertZaloMapping(db, { scheduleName, zaloUid, zaloName, source = 'manual' }) {
  const displayIn = collapseSpaces(scheduleName);
  if (!displayIn || !zaloUid) {
    return { ok: false, error: 'Thiếu tên lịch trực hoặc Zalo UID' };
  }
  if (!isFullPersonName(displayIn)) {
    return {
      ok: false,
      error: `Chỉ nhận tên đầy đủ (vd: Nguyễn Đình Hùng). Không nhận tên viết tắt/1 từ: "${displayIn}"`
    };
  }

  const key = normalizeMapKey(displayIn);
  const uid = String(zaloUid).trim();
  const zName = zaloName ? collapseSpaces(zaloName) : '';
  const src = source === 'manual' ? 'manual' : 'auto';

  // All rows with same key (legacy may lack name_key)
  const all = await db.all('SELECT * FROM zalo_user_mappings');
  const same = all.filter((r) => (r.name_key || normalizeMapKey(r.schedule_name)) === key);

  if (src === 'auto') {
    const manual = same.find((r) => (r.source || '') === 'manual');
    if (manual) {
      // Auto never overwrites manual UID; keep manual
      return { ok: true, skipped: true, reason: 'manual_priority', mapping: manual };
    }
  }

  // Prefer best display name (diacritics first)
  let finalDisplay = displayIn;
  for (const r of same) {
    if (scoreDisplayName(r.schedule_name) > scoreDisplayName(finalDisplay)) {
      // Manual save with worse display still uses user input when source=manual
      if (src !== 'manual') finalDisplay = r.schedule_name;
    }
  }
  if (src === 'manual') {
    // Manual: prefer incoming if it has diacritics or is longer/better
    finalDisplay = scoreDisplayName(displayIn) >= scoreDisplayName(finalDisplay) ? displayIn : finalDisplay;
    // Always prefer user's exact typing when they type diacritics
    if (hasDiacritics(displayIn) || !hasDiacritics(finalDisplay)) {
      finalDisplay = displayIn;
    }
  }

  for (const r of same) {
    await db.run('DELETE FROM zalo_user_mappings WHERE id = ?', r.id);
  }

  // Also remove exact UNIQUE schedule_name conflict if any leftover
  await db.run('DELETE FROM zalo_user_mappings WHERE UPPER(TRIM(schedule_name)) = UPPER(?)', finalDisplay);

  await db.run(
    `INSERT INTO zalo_user_mappings (schedule_name, zalo_uid, zalo_name, name_key, source, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    finalDisplay,
    uid,
    zName,
    key,
    src
  );

  const saved = await db.get(
    'SELECT schedule_name, zalo_uid, zalo_name, name_key, source FROM zalo_user_mappings WHERE name_key = ?',
    key
  );
  return { ok: true, mapping: saved };
}

async function deleteZaloMapping(db, scheduleName) {
  const key = normalizeMapKey(scheduleName);
  if (!key) return { ok: false, error: 'Tên không hợp lệ' };

  const all = await db.all('SELECT id, schedule_name, name_key FROM zalo_user_mappings');
  const toDelete = all.filter((r) => (r.name_key || normalizeMapKey(r.schedule_name)) === key);
  for (const r of toDelete) {
    await db.run('DELETE FROM zalo_user_mappings WHERE id = ?', r.id);
  }
  // Fallback exact
  await db.run('DELETE FROM zalo_user_mappings WHERE UPPER(TRIM(schedule_name)) = UPPER(?)', collapseSpaces(scheduleName));
  return { ok: true, deleted: toDelete.length };
}

/** Remove short/abbrev mappings; merge duplicate keys keeping best row */
async function cleanupZaloMappings(db) {
  const rows = await db.all('SELECT * FROM zalo_user_mappings');
  let removedShort = 0;
  let merged = 0;

  // 1) Drop non-full names
  for (const r of rows) {
    if (!isFullPersonName(r.schedule_name)) {
      await db.run('DELETE FROM zalo_user_mappings WHERE id = ?', r.id);
      removedShort++;
    }
  }

  // 2) Backfill name_key + merge duplicates
  const remaining = await db.all('SELECT * FROM zalo_user_mappings');
  const byKey = new Map();
  for (const r of remaining) {
    const key = normalizeMapKey(r.schedule_name);
    if (!key) {
      await db.run('DELETE FROM zalo_user_mappings WHERE id = ?', r.id);
      removedShort++;
      continue;
    }
    // update name_key if missing/wrong
    if (r.name_key !== key) {
      await db.run('UPDATE zalo_user_mappings SET name_key = ? WHERE id = ?', key, r.id);
      r.name_key = key;
    }
    if (!r.source) {
      await db.run(`UPDATE zalo_user_mappings SET source = 'auto' WHERE id = ?`, r.id);
      r.source = 'auto';
    }

    if (!byKey.has(key)) {
      byKey.set(key, [r]);
    } else {
      byKey.get(key).push(r);
    }
  }

  for (const [key, group] of byKey.entries()) {
    if (group.length <= 1) continue;
    // Pick winner: manual > better display
    group.sort((a, b) => {
      const am = (a.source || '') === 'manual' ? 1 : 0;
      const bm = (b.source || '') === 'manual' ? 1 : 0;
      if (bm !== am) return bm - am;
      return scoreDisplayName(b.schedule_name) - scoreDisplayName(a.schedule_name);
    });
    const winner = group[0];
    for (let i = 1; i < group.length; i++) {
      await db.run('DELETE FROM zalo_user_mappings WHERE id = ?', group[i].id);
      merged++;
    }
    // Ensure winner has name_key
    await db.run(
      `UPDATE zalo_user_mappings SET name_key = ?, updated_at = datetime('now') WHERE id = ?`,
      key,
      winner.id
    );
  }

  return { removedShort, merged, remaining: (await db.get('SELECT COUNT(*) as c FROM zalo_user_mappings')).c };
}

/** Resolve driver+operator UIDs from mapping lookup (exact normalize only, no soft fuzzy) */
function resolveCrewUids(lookup, driverName, operatorName) {
  const uids = [];
  const dr = resolveUid(lookup, driverName);
  const op = resolveUid(lookup, operatorName);
  if (dr) uids.push(dr);
  if (op && op !== dr) uids.push(op);
  return uids;
}

/**
 * Nâng tên hiển thị mapping sang dạng có dấu từ lịch (nếu key khớp).
 * Không đổi UID / source=manual.
 */
async function upgradeDisplayNamesFromSchedules(db) {
  const maps = await db.all('SELECT * FROM zalo_user_mappings');
  const schedules = await db.all(
    `SELECT driver_name, operator_name FROM fms_schedules
     WHERE date >= date('now', '-3 day') OR fms_date >= date('now', '-3 day')`
  );
  const bestByKey = new Map();
  for (const s of schedules || []) {
    for (const raw of [s.driver_name, s.operator_name]) {
      const name = collapseSpaces(raw);
      if (!isFullPersonName(name)) continue;
      const key = normalizeMapKey(name);
      if (!bestByKey.has(key) || scoreDisplayName(name) > scoreDisplayName(bestByKey.get(key))) {
        bestByKey.set(key, name);
      }
    }
  }

  let upgraded = 0;
  for (const m of maps || []) {
    const key = m.name_key || normalizeMapKey(m.schedule_name);
    const preferred = bestByKey.get(key);
    if (!preferred) continue;
    if (scoreDisplayName(preferred) <= scoreDisplayName(m.schedule_name)) continue;
    // Đổi schedule_name (UNIQUE) cẩn thận: xóa+insert nếu cần
    try {
      await db.run('UPDATE zalo_user_mappings SET schedule_name = ?, name_key = ?, updated_at = datetime(\'now\') WHERE id = ?',
        preferred, key, m.id);
      upgraded++;
    } catch (e) {
      // conflict UNIQUE — skip
    }
  }
  return { upgraded };
}

/** Re-resolve crew_zalo_uids for recent schedules from mapping (fix stale UIDs) */
async function reResolveScheduleUids(db, daysBack = 1) {
  const maps = await db.all('SELECT schedule_name, zalo_uid, zalo_name, name_key, source FROM zalo_user_mappings');
  const lookup = buildMappingLookup(maps);
  const n = Math.max(0, parseInt(daysBack, 10) || 1);
  const rows = await db.all(
    `SELECT id, driver_name, operator_name, crew_zalo_uids FROM fms_schedules
     WHERE date >= date('now', '-${n} day') OR fms_date >= date('now', '-${n} day')`
  );
  let updated = 0;
  for (const row of rows || []) {
    const uids = resolveCrewUids(lookup, row.driver_name, row.operator_name);
    const next = uids.join(',');
    if (next && next !== String(row.crew_zalo_uids || '').trim()) {
      await db.run('UPDATE fms_schedules SET crew_zalo_uids = ? WHERE id = ?', next, row.id);
      updated++;
    }
  }
  return { scanned: (rows || []).length, updated };
}

module.exports = {
  stripDiacritics,
  normalizeMapKey,
  hasDiacritics,
  isFullPersonName,
  buildMappingLookup,
  resolveMapping,
  resolveUid,
  resolveCrewUids,
  upsertZaloMapping,
  deleteZaloMapping,
  cleanupZaloMappings,
  upgradeDisplayNamesFromSchedules,
  reResolveScheduleUids,
  scoreDisplayName,
  collapseSpaces
};
