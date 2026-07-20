/**
 * Xây dựng / đồng bộ kế hoạch tra nạp từ FMS Skypec Flights.
 * - Ca ngày: 07:30–19:29
 * - Ca tối: 19:30–23:59 D + 00:00–07:30 D+1
 * - unit_code SKYPEC | NAFC: import song song 2 bản lịch (cùng chuyến, tách giao diện)
 * - Không cần roster NAFC — chỉ ghi nhãn unit_code = NAFC
 */
const https = require('https');
const querystring = require('querystring');
const { getDb } = require('./db');

const HOST = 'fms.skypec.com.vn';

function getVietnamDbDateStr() {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getVietnamDateTimeStr() {
  const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear();
  const m = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const d = String(vn.getUTCDate()).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const mm = String(vn.getUTCMinutes()).padStart(2, '0');
  const ss = String(vn.getUTCSeconds()).padStart(2, '0');
  return `${d}/${m}/${y} ${hh}:${mm}:${ss}`;
}

function normalizeFlightNo(fn) {
  return String(fn || '').toUpperCase().replace(/[\s\-_.]/g, '');
}

function parseTimeToMinutes(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (Number.isNaN(h) || Number.isNaN(min)) return null;
  return h * 60 + min;
}

function isOvernightShiftValue(shift) {
  const s = String(shift || '').trim().toLowerCase();
  return s === 'evening' || s === 'night';
}

/**
 * @param {string} timeStr HH:mm
 * @param {'day'|'evening'|'all'} shift
 * @param {0|1} dayOffset 0 = calendar day D, 1 = D+1
 */
function inShiftWindow(timeStr, shift, dayOffset = 0) {
  const t = parseTimeToMinutes(timeStr);
  if (t == null) return false;
  const s = String(shift || 'all').toLowerCase();
  if (s === 'all') return true;

  if (s === 'day') {
    // 07:30–19:29 same calendar day only
    if (dayOffset !== 0) return false;
    return t >= 7 * 60 + 30 && t <= 19 * 60 + 29;
  }

  // evening: D >= 19:30 OR D+1 <= 07:30
  if (dayOffset === 0) return t >= 19 * 60 + 30;
  if (dayOffset === 1) return t <= 7 * 60 + 30;
  return false;
}

function detectCurrentShift(now = new Date()) {
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const mins = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  if (mins >= 7 * 60 + 30 && mins <= 19 * 60 + 29) return 'day';
  return 'evening';
}

function addDaysYmd(ymd, days) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function ymdToDmyRange(ymd) {
  const [y, m, d] = ymd.split('-');
  const dmy = `${d}/${m}/${y}`;
  return `${dmy} 00:00-${dmy} 23:59`;
}

function decodeHtmlEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ');
}

function calculateFmsDate(dateStr, timeStr, isOvernightShift = false) {
  if (!timeStr || timeStr === '-') return dateStr;
  try {
    const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return dateStr;
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const early = hour < 7 || (hour === 7 && minute <= 30);
    if (early && isOvernightShift) return addDaysYmd(dateStr, 1);
    return dateStr;
  } catch (_) {
    return dateStr;
  }
}

function mergeCookies(oldCookie, setCookieHeaders) {
  const map = {};
  String(oldCookie || '').split(';').map(s => s.trim()).filter(Boolean).forEach(pair => {
    const i = pair.indexOf('=');
    if (i > 0) map[pair.slice(0, i)] = pair.slice(i + 1);
  });
  (setCookieHeaders || []).forEach(c => {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) map[pair.slice(0, i)] = pair.slice(i + 1);
  });
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join('; ');
}

function httpsGet(path, cookie = '') {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: HOST, port: 443, path,
      headers: { Cookie: cookie, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

function httpsPost(path, data, cookie = '') {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify(data);
    const req = https.request({
      hostname: HOST, port: 443, path, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function loginSkypecFms() {
  const page = await httpsGet('/Account/Login');
  let cookie = mergeCookies('', page.headers['set-cookie']);
  const tokenMatch = page.body.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i);
  if (!tokenMatch) throw new Error('No CSRF token on FMS Skypec login');
  const res = await httpsPost('/Account/Login', {
    __RequestVerificationToken: tokenMatch[1],
    UserName: 'noibai.han',
    Password: '12345678',
    RememberMe: 'false'
  }, cookie);
  cookie = mergeCookies(cookie, res.headers['set-cookie']);
  return cookie;
}

/** Parse parent rows from Flights HTML tbody */
function parseFlightsHtml(html) {
  const tbodyStart = html.indexOf('<tbody');
  const tbodyEnd = html.indexOf('</tbody>');
  if (tbodyStart === -1 || tbodyEnd === -1) return [];

  const tbodyHtml = html.substring(tbodyStart, tbodyEnd + 8);
  const rows = [];
  let pos = 0;
  while (true) {
    const trStart = tbodyHtml.indexOf('<tr', pos);
    if (trStart === -1) break;
    const trEnd = tbodyHtml.indexOf('</tr>', trStart);
    if (trEnd === -1) break;
    rows.push(tbodyHtml.substring(trStart, trEnd + 5));
    pos = trEnd + 5;
  }

  const flights = [];
  for (const rowHtml of rows) {
    if (!rowHtml.includes('parent')) continue;

    const codeMatch = rowHtml.match(/id="Code"[^>]*>([\s\S]*?)<\/span>/i);
    const flightNoRaw = codeMatch ? codeMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const flightNo = normalizeFlightNo(flightNoRaw);
    if (!flightNo) continue;

    const idMatch = rowHtml.match(/value="(\d+)"/);
    const idFms = idMatch ? idMatch[1] : '';

    const acTypeMatch = rowHtml.match(/id="AircraftType"[^>]*>([\s\S]*?)<\/span>/i);
    let acType = acTypeMatch ? acTypeMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const acRegMatch = rowHtml.match(/id="AircraftCode"[^>]*>([\s\S]*?)<\/span>/i);
    const acReg = acRegMatch ? acRegMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const routeMatch = rowHtml.match(/id="RouteName"[^>]*>([\s\S]*?)<\/span>/i);
    const route = routeMatch ? routeMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const depTimeMatch = rowHtml.match(/id="DepartureScheduledTime"[^>]*>([\s\S]*?)<\/span>/i);
    const timeDep = depTimeMatch ? depTimeMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const arrTimeMatch = rowHtml.match(/id="ArrivalScheduledTime"[^>]*>([\s\S]*?)<\/span>/i);
    const timeArr = arrTimeMatch ? arrTimeMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    const refuelHoursMatch = rowHtml.match(/id="RefuelScheduledHours"[^>]*>([\s\S]*?)<\/span>/i);
    const timeFuel = refuelHoursMatch ? refuelHoursMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const parkingMatch = rowHtml.match(/id="Parking"[^>]*>([\s\S]*?)<\/span>/i);
    const gate = parkingMatch ? parkingMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    // ---- Xe / Lái xe / NV tra nạp ----
    // 1) Hàng đang phân công: <select class="...driverId..."> option selected
    // 2) Hàng đã tra nạp (xanh): không còn select → text thuần trong td sau ô xe
    let truckNo = '';
    let driverName = '';
    let operatorName = '';

    const pickSelected = (selectInner) => {
      if (!selectInner) return '';
      const m = selectInner.match(/<option[^>]*selected[^>]*>([\s\S]*?)<\/option>/i)
        || selectInner.match(/<option[^>]*selected=["']?selected["']?[^>]*>([\s\S]*?)<\/option>/i);
      return m ? decodeHtmlEntities(m[1].replace(/<[^>]+>/g, '').trim()) : '';
    };

    const truckSelect = rowHtml.match(/<select[^>]*class="[^"]*truckId[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
    if (truckSelect) truckNo = pickSelected(truckSelect[1]);

    const driverSelectMatch = rowHtml.match(/<select[^>]*class="[^"]*driverId[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
    if (driverSelectMatch) driverName = pickSelected(driverSelectMatch[1]);

    const operatorSelectMatch = rowHtml.match(/<select[^>]*class="[^"]*operatorId[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
    if (operatorSelectMatch) operatorName = pickSelected(operatorSelectMatch[1]);

    // Plain-text tds (chuyến đã nạp: td xe → td lái → td NV)
    if (!truckNo || !driverName || !operatorName) {
      const tds = [...rowHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(td =>
        decodeHtmlEntities(
          td[1]
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<select[\s\S]*?<\/select>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
        )
      );
      const truckIdx = tds.findIndex(t => /HAN3-20-\d{4}/i.test(t));
      if (truckIdx >= 0) {
        if (!truckNo) {
          const tm = tds[truckIdx].match(/HAN3-20-\d{4}/i);
          if (tm) truckNo = tm[0];
        }
        if (!driverName && tds[truckIdx + 1]) driverName = tds[truckIdx + 1];
        if (!operatorName && tds[truckIdx + 2]) operatorName = tds[truckIdx + 2];
      }
    }
    if (!truckNo) {
      const tm = rowHtml.match(/HAN3-20-\d{4}/i);
      if (tm) truckNo = tm[0];
    }

    // Clean placeholders (NAFSC = chưa gán người thật trên FMS)
    const cleanName = (n) => {
      const s = String(n || '').trim();
      if (!s || s === '---' || s === '-' || s === '…' || s === '...') return '';
      if (/^NAFSC$/i.test(s)) return '';
      return s;
    };
    driverName = cleanName(driverName);
    operatorName = cleanName(operatorName);

    const crewParts = [driverName, operatorName].filter(Boolean);
    const crewInfo = crewParts.length ? crewParts.join(' - ') : '-';

    flights.push({
      id_fms: idFms,
      flight_no: flightNo,
      flight_no_display: flightNoRaw.replace(/\s+/g, '').toUpperCase() || flightNo,
      ac_type: acType,
      ac_reg: acReg,
      route,
      time_arr: timeArr,
      time_dep: timeDep,
      time_fuel: timeFuel,
      gate,
      truck_no: truckNo,
      driver_name: driverName,
      operator_name: operatorName,
      crew_info: crewInfo
    });
  }
  return flights;
}

async function fetchFlightsForDate(cookie, ymd) {
  const range = ymdToDmyRange(ymd);
  const path = `/Flights?daterange=${encodeURIComponent(range)}`;
  const page = await httpsGet(path, cookie);
  if (page.status !== 200) throw new Error(`Flights HTTP ${page.status} for ${ymd}`);
  return parseFlightsHtml(page.body);
}

/**
 * Build schedule candidates for a duty date + shift.
 * @param {string} dutyDate YYYY-MM-DD day ca starts
 * @param {string} shift day|evening|all
 */
async function buildScheduleCandidatesFromFlights(dutyDate, shift = 'day') {
  const cookie = await loginSkypecFms();
  const isOvernight = isOvernightShiftValue(shift) || shift === 'all';
  const calendarDays = [{ ymd: dutyDate, offset: 0 }];
  if (shift === 'evening' || shift === 'night' || shift === 'all') {
    calendarDays.push({ ymd: addDaysYmd(dutyDate, 1), offset: 1 });
  }

  const byFlight = new Map();
  for (const { ymd, offset } of calendarDays) {
    // For day shift only fetch D
    if (shift === 'day' && offset === 1) continue;
    // For evening, fetch both
    const list = await fetchFlightsForDate(cookie, ymd);
    for (const f of list) {
      const timeKey = f.time_fuel || f.time_dep || f.time_arr;
      if (shift !== 'all' && !inShiftWindow(timeKey, shift, offset)) continue;
      // day shift: only offset 0 already
      if (shift === 'day' && !inShiftWindow(timeKey, 'day', 0)) continue;

      const fmsDate = calculateFmsDate(dutyDate, timeKey, isOvernightShiftValue(shift));
      // For all shift, include if in day OR evening windows
      if (shift === 'all') {
        const inDay = offset === 0 && inShiftWindow(timeKey, 'day', 0);
        const inEve = inShiftWindow(timeKey, 'evening', offset);
        if (!inDay && !inEve) continue;
      }

      const key = normalizeFlightNo(f.flight_no);
      // Prefer row with more complete crew/truck if duplicate
      const prev = byFlight.get(key);
      const score = (x) => (x.truck_no ? 2 : 0) + (x.driver_name && x.driver_name !== 'NAFSC' ? 2 : 0) + (x.operator_name && x.operator_name !== 'NAFSC' ? 2 : 0) + (x.gate ? 1 : 0);
      const candidate = {
        ...f,
        date: dutyDate,
        fms_date: fmsDate,
        schedule_source: 'flights'
      };
      if (!prev || score(candidate) >= score(prev)) byFlight.set(key, candidate);
    }
  }

  return Array.from(byFlight.values()).sort((a, b) => {
    const ta = parseTimeToMinutes(a.time_fuel || a.time_dep || a.time_arr) ?? 9999;
    const tb = parseTimeToMinutes(b.time_fuel || b.time_dep || b.time_arr) ?? 9999;
    return ta - tb;
  });
}

async function resolveZaloUids(db, driverName, operatorName) {
  // Map TỪNG người (Lái / NV) theo họ tên đầy đủ — không map cả chuỗi cặp
  const strip = (s) => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase().replace(/\s+/g, ' ').trim();

  let allMaps = [];
  try {
    allMaps = await db.all('SELECT schedule_name, zalo_uid FROM zalo_user_mappings');
  } catch (_) {
    return '';
  }
  const byKey = {};
  allMaps.forEach(m => {
    const k = strip(m.schedule_name);
    if (k) byKey[k] = m.zalo_uid;
  });

  const uids = [];
  for (const name of [driverName, operatorName]) {
    if (!name || /^NAFSC$/i.test(name) || name === '-') continue;
    const key = strip(name);
    // Chỉ exact key — không soft-match includes (tránh gán nhầm Zalo)
    if (byKey[key]) uids.push(byKey[key]);
  }
  return [...new Set(uids)].join(',');
}

/**
 * Apply candidates to fms_schedules.
 * @param {'merge'|'replace'} mode
 */
async function enrichCrewFromLive(db, item, dutyDate) {
  // Bổ sung tên từ fms_flights_live (JRefuelInfo) nếu HTML Flights thiếu
  if (item.driver_name && item.operator_name) return item;
  try {
    const live = await db.get(
      `SELECT driver_name, operator_name, truck_no FROM fms_flights_live
       WHERE REPLACE(REPLACE(UPPER(flight_no),' ',''),'-','') = ?
         AND date IN (?, ?)
       ORDER BY
         CASE WHEN driver_name IS NOT NULL AND driver_name != '' AND UPPER(driver_name) != 'NAFSC' THEN 0 ELSE 1 END,
         created_at DESC
       LIMIT 1`,
      normalizeFlightNo(item.flight_no),
      dutyDate,
      item.fms_date || dutyDate
    );
    if (!live) return item;
    const clean = (n) => {
      const s = String(n || '').trim();
      if (!s || s === '-' || s === '---' || /^NAFSC$/i.test(s)) return '';
      // live may be "A, B" multi-refuel — take first segment pair later
      return s;
    };
    let d = clean(live.driver_name);
    let o = clean(live.operator_name);
    // Nếu "A, B" gộp nhiều mẻ: lấy phần đầu trước dấu phẩy cho mỗi field
    if (d.includes(',')) d = d.split(',')[0].trim();
    if (o.includes(',')) o = o.split(',')[0].trim();
    // JRefuelInfo đôi khi gộp "Lái NV" trong một span — driver_name có thể là "Lái - NV"
    if (d && !o && d.includes(' - ')) {
      const parts = d.split(/\s+-\s+/);
      d = parts[0] || d;
      o = parts[1] || o;
    }
    if (!item.driver_name && d) item.driver_name = d;
    if (!item.operator_name && o) item.operator_name = o;
    if (!item.truck_no && live.truck_no) {
      const t = String(live.truck_no).split(',')[0].trim();
      if (t) item.truck_no = t;
    }
    const parts = [item.driver_name, item.operator_name].filter(Boolean);
    item.crew_info = parts.length ? parts.join(' - ') : (item.crew_info || '-');
  } catch (_) { /* ignore */ }
  return item;
}

/**
 * Phân loại đơn vị — không cần roster NV NAFC.
 * Heuristic (theo thực tế FMS Nội Bài / ảnh vận hành):
 * - Có tên lái/NV thật (không NAFSC) → SKYPEC
 * - Không có tên thật + xe HAN3-20-74xx → NAFC (đội xe đối tác)
 * - Còn lại → SKYPEC
 */
function classifyUnitCode(item) {
  const clean = (n) => {
    const s = String(n || '').trim();
    if (!s || s === '-' || s === '---' || /^NAFSC$/i.test(s)) return '';
    return s;
  };
  const hasCrew = !!(clean(item.driver_name) || clean(item.operator_name));
  if (hasCrew) return 'SKYPEC';

  const truck = String(item.truck_no || '').toUpperCase().replace(/\s+/g, '');
  // Xe NAFC: HAN3-20-7400 … 7499 (hoặc chỉ 74xx)
  if (/HAN3-20-74\d{2}/.test(truck) || /(?:^|[^0-9])74\d{2}(?:[^0-9]|$)/.test(truck)) {
    return 'NAFC';
  }
  return 'SKYPEC';
}

/**
 * Upsert 1 dòng lịch cho đúng unit_code (SKYPEC | NAFC)
 */
async function upsertOneUnitSchedule(db, item, dutyDate, unitCode, nowStr) {
  const flightNo = normalizeFlightNo(item.flight_no);
  const unit = String(unitCode || 'SKYPEC').toUpperCase();

  const existing = await db.get(
    `SELECT id, schedule_source, notify_type, crew_zalo_uids, driver_name, operator_name, crew_info
     FROM fms_schedules
     WHERE UPPER(REPLACE(REPLACE(flight_no,' ',''),'-','')) = ?
       AND date = ?
       AND UPPER(COALESCE(NULLIF(unit_code,''),'SKYPEC')) = ?`,
    flightNo, dutyDate, unit
  );

  let driverName = item.driver_name || '';
  let operatorName = item.operator_name || '';
  if (existing) {
    const exD = String(existing.driver_name || '').trim();
    const exO = String(existing.operator_name || '').trim();
    if (!driverName && exD && !/^NAFSC$/i.test(exD)) driverName = exD;
    if (!operatorName && exO && !/^NAFSC$/i.test(exO)) operatorName = exO;
  }
  const crewParts = [driverName, operatorName].filter(Boolean);
  const crewInfo = crewParts.length ? crewParts.join(' - ') : '-';

  const crewZalo = existing && existing.crew_zalo_uids
    ? existing.crew_zalo_uids
    : await resolveZaloUids(db, driverName, operatorName);

  const notifyType = existing ? (existing.notify_type || 1) : 1;
  const displayFn = item.flight_no_display || flightNo;

  if (existing) {
    await db.run(
      `UPDATE fms_schedules SET
        flight_no = ?, ac_type = ?, ac_reg = ?, route = ?,
        time_arr = ?, time_dep = ?, time_fuel = ?, gate = ?,
        truck_no = COALESCE(NULLIF(?, ''), truck_no),
        driver_name = ?, operator_name = ?, crew_info = ?,
        crew_zalo_uids = COALESCE(NULLIF(?, ''), crew_zalo_uids),
        fms_date = ?, unit_code = ?, schedule_source = 'flights',
        id_fms = ?, updated_from_flights_at = ?
       WHERE id = ?`,
      displayFn,
      item.ac_type || '',
      item.ac_reg || '',
      item.route || '',
      item.time_arr || '',
      item.time_dep || '',
      item.time_fuel || '',
      item.gate || '',
      item.truck_no || '',
      driverName,
      operatorName,
      crewInfo,
      crewZalo,
      item.fms_date || dutyDate,
      unit,
      item.id_fms || '',
      nowStr,
      existing.id
    );
    return 'updated';
  }

  await db.run(
    `INSERT INTO fms_schedules (
      flight_no, ac_type, ac_reg, route, time_arr, time_dep, time_fuel,
      gate, truck_no, driver_name, operator_name, crew_info, crew_zalo_uids,
      notify_type, date, fms_date, unit_code, schedule_source, id_fms, updated_from_flights_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'flights', ?, ?)`,
    displayFn,
    item.ac_type || '',
    item.ac_reg || '',
    item.route || '',
    item.time_arr || '',
    item.time_dep || '',
    item.time_fuel || '',
    item.gate || '',
    item.truck_no || '',
    driverName,
    operatorName,
    crewInfo,
    crewZalo,
    notifyType,
    dutyDate,
    item.fms_date || dutyDate,
    unit,
    item.id_fms || '',
    nowStr
  );
  return 'added';
}

async function applyScheduleFromFlights(dutyDate, shift, mode = 'merge') {
  const db = await getDb();
  const candidates = await buildScheduleCandidatesFromFlights(dutyDate, shift);
  const nowStr = getVietnamDateTimeStr();

  // Chuẩn hóa legacy BOTH → sẽ phân loại lại bên dưới
  try {
    await db.run(
      `UPDATE fms_schedules SET unit_code = 'SKYPEC'
       WHERE date = ? AND UPPER(COALESCE(unit_code,'')) IN ('BOTH','')`,
      dutyDate
    );
  } catch (_) { /* ignore */ }

  if (mode === 'replace') {
    await db.run(
      `DELETE FROM fms_schedules WHERE date = ? AND COALESCE(schedule_source,'manual') = 'flights'`,
      dutyDate
    );
  }

  let added = 0;
  let updated = 0;
  let skipped = 0;
  let named = 0;
  let nSkypec = 0;
  let nNafc = 0;

  for (let item of candidates) {
    item = await enrichCrewFromLive(db, item, dutyDate);
    if (item.driver_name || item.operator_name) named++;

    // Mỗi chuyến CHỈ thuộc 1 unit — không còn nhân bản full sang cả 2 tab
    const unit = classifyUnitCode(item);
    if (unit === 'NAFC') nNafc++;
    else nSkypec++;

    const r = await upsertOneUnitSchedule(db, item, dutyDate, unit, nowStr);
    if (r === 'added') added++;
    else if (r === 'updated') updated++;
    else skipped++;

    // Dọn bản ghi trùng unit kia (lỗi dual-write trước đây)
    const flightNo = normalizeFlightNo(item.flight_no);
    const other = unit === 'NAFC' ? 'SKYPEC' : 'NAFC';
    try {
      await db.run(
        `DELETE FROM fms_schedules
         WHERE date = ?
           AND REPLACE(REPLACE(UPPER(flight_no),' ',''),'-','') = ?
           AND COALESCE(schedule_source,'manual') = 'flights'
           AND UPPER(COALESCE(NULLIF(unit_code,''),'SKYPEC')) = ?`,
        dutyDate, flightNo, other
      );
    } catch (_) { /* ignore */ }
  }

  console.log(`[ScheduleFlights] date=${dutyDate} shift=${shift} mode=${mode} added=${added} updated=${updated} named=${named}/${candidates.length} skypec=${nSkypec} nafc=${nNafc}`);
  return {
    added, updated, skipped, named,
    total: candidates.length,
    skypec: nSkypec,
    nafc: nNafc,
    candidates
  };
}

/**
 * Auto merge for current shift (called from worker). Only today duty context.
 */
async function autoSyncScheduleFromFlightsIfEnabled() {
  try {
    const db = await getDb();
    const flag = await db.get("SELECT value FROM settings WHERE key = 'fms_schedule_from_flights'");
    if (flag && flag.value === 'false') return null;

    const shift = detectCurrentShift();
    const today = getVietnamDbDateStr();
    // Night segment after midnight: duty date is yesterday
    let dutyDate = today;
    if (shift === 'evening') {
      const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const mins = vn.getUTCHours() * 60 + vn.getUTCMinutes();
      if (mins <= 7 * 60 + 30) {
        dutyDate = addDaysYmd(today, -1);
      }
    }

    const result = await applyScheduleFromFlights(dutyDate, shift, 'merge');
    return { dutyDate, shift, ...result };
  } catch (err) {
    console.error('[ScheduleFlights] Auto sync error:', err.message);
    return null;
  }
}

/** unit filter for schedules API — tách hẳn Skypec / NAFC, mặc định SKYPEC */
function unitFilterSql(unit) {
  const u = String(unit || 'SKYPEC').toUpperCase();
  if (u === 'ALL') return { clause: '1=1', params: [] };
  if (u === 'NAFC') {
    return {
      clause: `UPPER(COALESCE(NULLIF(s.unit_code,''),'SKYPEC')) = 'NAFC'`,
      params: []
    };
  }
  // SKYPEC only (không lẫn NAFC)
  return {
    clause: `UPPER(COALESCE(NULLIF(s.unit_code,''),'SKYPEC')) = 'SKYPEC'`,
    params: []
  };
}

module.exports = {
  normalizeFlightNo,
  parseTimeToMinutes,
  inShiftWindow,
  detectCurrentShift,
  isOvernightShiftValue,
  calculateFmsDate,
  addDaysYmd,
  buildScheduleCandidatesFromFlights,
  applyScheduleFromFlights,
  autoSyncScheduleFromFlightsIfEnabled,
  unitFilterSql,
  classifyUnitCode,
  parseFlightsHtml
};
