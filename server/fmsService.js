const http = require('http');
const https = require('https');
const querystring = require('querystring');
const { getDb } = require('./db');
const { sendSkyEyesMessage, sendSkyEyesPrivateMessage } = require('./zaloService');
const {
  evaluateAirlineMismatch,
  parseAirlineCodeFromFlightNo,
  getExpectedAirlineName,
  listAirlineMappings
} = require('./airlineCodes');

const HOST = 'fms.vietnamairlines.com';

function log(msg) {
  console.log(`[FMS Service] [${new Date().toISOString()}] ${msg}`);
}

// Gửi thông báo tải dầu qua Zalo Webhook API của ZaloCRM Bot
async function sendZaloNotification(message) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      name: "FMS Bot",
      phone: "0987654321",
      message: message,
      content: message,
      note: message,
      text: message,
      product: message,
      products: message,
      address: message,
      order_id: "FMS-" + Date.now(),
      total: "0",
      status: "Success"
    });

    const options = {
      hostname: 'zl2.aiphocap.vn',
      port: 443,
      path: '/api/public/webhook/order?key=whk_c51b17c25d3529584f9ee6f26ac7424909968546b31f9437',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-API-Key': 'whk_c51b17c25d3529584f9ee6f26ac7424909968546b31f9437'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          log('[Zalo Bot] Gửi thông báo thành công!');
          resolve(body);
        } else {
          console.error(`[Zalo Bot] Gửi thông báo thất bại, HTTP ${res.statusCode}:`, body);
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Zalo Bot] Lỗi kết nối gửi thông báo Zalo:', err.message);
      reject(err);
    });

    req.write(payload);
    req.end();
  });
}

// Lấy ngày hôm nay định dạng DD/MM/YYYY theo múi giờ Việt Nam (GMT+7)
function getVietnamDateStr() {
  const vnTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
  const day = String(vnTime.getUTCDate()).padStart(2, '0');
  const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const year = vnTime.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

// Lấy ngày hôm nay định dạng YYYY-MM-DD để lưu database SQLite
function getVietnamDbDateStr() {
  const vnTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
  const day = String(vnTime.getUTCDate()).padStart(2, '0');
  const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const year = vnTime.getUTCFullYear();
  return `${year}-${month}-${day}`;
}

/**
 * Mốc giám sát Tạm nhập / Tái xuất / Cancel / NKT:
 * chỉ tính từ 19/07/2026; không truy xuất / tạo monitor ngày cũ hơn.
 */
const MONITOR_EPOCH_DATE = '2026-07-19';

function isMonitorEpochDate(dateStr) {
  const d = String(dateStr || '').trim();
  return !!d && d >= MONITOR_EPOCH_DATE;
}

/** Được phép TẠO monitor: >= epoch và nằm trong cửa sổ ngày đang theo dõi (hôm nay / đuôi ca tối) */
function canCreateMonitorForDate(dateStr) {
  return isMonitorEpochDate(dateStr) && isCancelWatchDate(dateStr);
}

// Lấy ngày giờ hiện tại dạng HH:MM DD/MM/YYYY theo múi giờ Việt Nam (GMT+7)
function getVietnamDateTimeStr() {
  const vnTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
  const hour = String(vnTime.getUTCHours()).padStart(2, '0');
  const minute = String(vnTime.getUTCMinutes()).padStart(2, '0');
  const day = String(vnTime.getUTCDate()).padStart(2, '0');
  const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
  const year = vnTime.getUTCFullYear();
  return `${hour}:${minute} ${day}/${month}/${year}`;
}

/** Phút trong ngày VN + ymd (UTC+7 wall clock) */
function getVietnamNowParts() {
  const vn = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
  return {
    ymd: `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`,
    minutes: vn.getUTCHours() * 60 + vn.getUTCMinutes(),
    ms: vn.getTime()
  };
}

/**
 * Ops Cancel: chỉ theo dõi sát trong ngày.
 * - Nạp xong thường bay sau 40p–1h, tối đa ~2h (thời tiết).
 * - Trước 40p sau giờ nạp: chưa kết luận Cancel (tránh nhiễu FMS).
 * - Ngoài “hôm nay” (và nửa đêm ca tối): không quét Cancel rộng.
 */
const CANCEL_GRACE_MIN_AFTER_FUEL = 40;
const CANCEL_TYPICAL_MAX_HOURS = 2;

function addDaysYmdStr(ymd, days) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/** Ngày được phép quét Cancel / NKT trong ngày: hôm nay; nếu <07:30 còn giữ hôm qua (đuôi ca tối) */
function getCancelWatchDates() {
  const now = getVietnamNowParts();
  const dates = [now.ymd];
  if (now.minutes < 7 * 60 + 30) {
    const yest = addDaysYmdStr(now.ymd, -1);
    // Không kéo về trước mốc epoch
    if (isMonitorEpochDate(yest)) dates.push(yest);
  }
  return dates.filter(isMonitorEpochDate);
}

function isCancelWatchDate(targetDate) {
  return getCancelWatchDates().includes(String(targetDate || '').trim());
}

/**
 * Phút đã trôi từ (date + HH:MM giờ VN wall) đến hiện tại VN.
 * null nếu không parse được giờ nạp.
 */
function minutesSinceFuelEvent(dateYmd, timeFuelStr) {
  const tm = String(timeFuelStr || '').match(/^(\d{1,2}):(\d{2})/);
  const dm = String(dateYmd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!tm || !dm) return null;
  // So sánh trên cùng hệ “VN wall clock as UTC components” (chỉ hiệu phút)
  const fuelAsVnFakeUtc = Date.UTC(+dm[1], +dm[2] - 1, +dm[3], +tm[1], +tm[2], 0);
  const nowVn = getVietnamNowParts();
  const np = String(nowVn.ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!np) return null;
  const nowAsVnFakeUtc = Date.UTC(
    +np[1], +np[2] - 1, +np[3],
    Math.floor(nowVn.minutes / 60), nowVn.minutes % 60, 0
  );
  return Math.floor((nowAsVnFakeUtc - fuelAsVnFakeUtc) / 60000);
}

/**
 * Có được phép báo Cancel theo cửa sổ ops sau giờ nạp?
 * - Chưa đủ 40 phút sau nạp → chờ (chưa chắc hủy / đổi tàu)
 * - Trong ngày theo dõi + đã qua grace → được báo
 */
function canReportCancelAfterFuel(dateYmd, timeFuelStr) {
  const mins = minutesSinceFuelEvent(dateYmd, timeFuelStr);
  if (mins === null) {
    // Không có giờ nạp: chỉ cho báo nếu đang trong ngày theo dõi (tránh spam)
    return isCancelWatchDate(dateYmd);
  }
  if (mins < CANCEL_GRACE_MIN_AFTER_FUEL) {
    return false; // còn trong cửa sổ “sắp bay”
  }
  // Quá grace: cho Cancel (cùng ngày). Không giới hạn cứng 2h cho biến mất —
  // 2h là kỳ vọng bay; biến mất sau 2h trong ngày vẫn là Cancel hợp lệ.
  return true;
}

// Chuyển đổi giờ UTC (từ FMS gốc dạng HH:MM) sang giờ Việt Nam (GMT+7)
function convertUtcToVnTime(utcTimeStr) {
  if (!utcTimeStr || utcTimeStr === '-') return '-';
  const match = utcTimeStr.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return utcTimeStr;
  let hour = parseInt(match[1]);
  const minute = match[2];
  hour = (hour + 7) % 24;
  return `${String(hour).padStart(2, '0')}:${minute}`;
}

// Biến lưu cookie đăng nhập FMS trong bộ nhớ cache
let cachedFmsCookie = null;
let isFmsAlertSent = false;

// Đọc cookie FMS được lưu trong Database và kiểm tra hạn dùng 12 tiếng
async function getStoredFmsCookie(db) {
  try {
    const cookieRow = await db.get("SELECT value FROM settings WHERE key = 'fms_cookie'");
    const createdAtRow = await db.get("SELECT value FROM settings WHERE key = 'fms_cookie_created_at'");
    
    if (!cookieRow || !cookieRow.value || !createdAtRow || !createdAtRow.value) {
      return null;
    }
    
    const createdAt = new Date(createdAtRow.value);
    const now = new Date();
    const diffHours = (now - createdAt) / (1000 * 60 * 60);
    
    if (diffHours < 12) {
      log(`Tìm thấy cookie FMS hợp lệ trong Database (Thời gian tạo: ${createdAt.toISOString()}, Đã qua: ${diffHours.toFixed(1)} giờ)`);
      return cookieRow.value;
    } else {
      log(`Cookie FMS trong Database đã quá hạn 12 tiếng (Đã qua: ${diffHours.toFixed(1)} giờ). Tiến hành xóa bỏ.`);
      await db.run("DELETE FROM settings WHERE key = 'fms_cookie'");
      await db.run("DELETE FROM settings WHERE key = 'fms_cookie_created_at'");
      return null;
    }
  } catch (err) {
    console.error('[FMS Service] Lỗi đọc cookie từ Database:', err.message);
    return null;
  }
}

// Lưu cookie FMS và thời gian tạo mới vào Database
async function saveStoredFmsCookie(db, cookieStr) {
  try {
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_cookie', ?)", cookieStr);
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_cookie_created_at', ?)", new Date().toISOString());
  } catch (err) {
    console.error('[FMS Service] Lỗi lưu cookie vào Database:', err.message);
    throw err;
  }
}

// Gửi tin nhắn cảnh báo Zalo khi FMS bị lỗi đăng nhập (được chống spam)
async function sendFmsLoginAlert(db) {
  if (isFmsAlertSent) return; // Tránh spam, chỉ gửi 1 lần khi bắt đầu lỗi
  
  log('[Cảnh báo] Phát hiện lỗi đăng nhập FMS. Đang gửi tin nhắn cảnh báo Zalo...');
  const alertMsg = 'Hệ thống nghẽn đăng nhập, vui lòng chờ xử lý.';
  
  try {
    // 1. Gửi vào nhóm Zalo chung
    const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
    if (groupSetting && groupSetting.value) {
      const groupIds = String(groupSetting.value).split(',').map(id => id.trim()).filter(Boolean);
      for (const gid of groupIds) {
        await sendSkyEyesMessage(gid, alertMsg).catch(e => console.error(`[FMS Login Alert] Gửi tới nhóm ${gid} thất bại:`, e.message));
      }
    }

    // 2. Gửi inbox riêng cho Admin (nếu có cấu hình admin_zalo_uid)
    const adminUidSetting = await db.get("SELECT value FROM settings WHERE key = 'admin_zalo_uid'");
    if (adminUidSetting && adminUidSetting.value) {
      await sendSkyEyesPrivateMessage(adminUidSetting.value, alertMsg).catch(e => console.error('[FMS Login Alert] Gửi inbox riêng thất bại:', e.message));
    }
    
    // Gửi qua Webhook Bot Zalo cũ làm phương án dự phòng (fallback)
    await sendZaloNotification(alertMsg).catch(err => console.error('[FMS Login Alert] Fallback Zalo Bot cũ thất bại:', err.message));
    
    isFmsAlertSent = true; // Đặt cờ đã gửi
    log('Đã gửi tin nhắn cảnh báo Zalo thành công.');
  } catch (err) {
    console.error('[FMS Login Alert] Lỗi gửi cảnh báo:', err.message);
  }
}

// Thực hiện đăng nhập FMS bằng HTTP
async function loginFMS() {
  const db = await getDb();
  return new Promise((resolve, reject) => {
    log('Đang gửi yêu cầu đăng nhập FMS mới...');
    // 1. GET login page lấy CSRF Token & Cookie ban đầu
    http.get(`http://${HOST}/account/login`, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const cookies = res.headers['set-cookie'] || [];
        const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

        const tokenMatch = body.match(/input name="__RequestVerificationToken" type="hidden" value="([^"]+)"/i);
        if (!tokenMatch) {
          const err = new Error('Không tìm thấy __RequestVerificationToken trong HTML đăng nhập!');
          sendFmsLoginAlert(db).catch(e => console.error('[FMS Service] Lỗi gửi cảnh báo:', e.message));
          return reject(err);
        }
        const csrfToken = tokenMatch[1];

        // 2. POST login
        const postData = querystring.stringify({
          __RequestVerificationToken: csrfToken,
          UserName: 'Dont.vaeco',
          Password: 'VNA@1234',
          LoginMode: 'FIMSUser'
        });

        const req = http.request({
          hostname: HOST,
          port: 80,
          path: '/account/login',
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData),
            'Cookie': cookieStr
          }
        }, (postRes) => {
          postRes.on('data', () => {});
          postRes.on('end', () => {
            if (postRes.statusCode !== 302) {
              const err = new Error(`Đăng nhập FMS thất bại, HTTP Code: ${postRes.statusCode}`);
              sendFmsLoginAlert(db).catch(e => console.error('[FMS Service] Lỗi gửi cảnh báo:', e.message));
              return reject(err);
            }
            
            const postCookies = postRes.headers['set-cookie'] || [];
            let authCookieStr = cookieStr;
            if (postCookies.length > 0) {
              authCookieStr = postCookies.map(c => c.split(';')[0]).join('; ');
            }
            cachedFmsCookie = authCookieStr; // Lưu vào cache
            
            // Lưu cookie mới vào Database để tái sử dụng lâu dài
            saveStoredFmsCookie(db, authCookieStr)
              .then(() => log('Đã lưu cookie FMS mới vào Database thành công.'))
              .catch(dbErr => console.error('[FMS Service] Lỗi lưu cookie vào DB:', dbErr.message));
            
            // Reset cờ cảnh báo vì đã đăng nhập thành công
            isFmsAlertSent = false;
            
            resolve(authCookieStr);
          });
        });

        req.on('error', (err) => {
          sendFmsLoginAlert(db).catch(e => console.error('[FMS Service] Lỗi gửi cảnh báo:', e.message));
          reject(err);
        });
        
        req.write(postData);
        req.end();
      });
    }).on('error', (err) => {
      sendFmsLoginAlert(db).catch(e => console.error('[FMS Service] Lỗi gửi cảnh báo:', e.message));
      reject(err);
    });
  });
}

// Tải danh sách chuyến bay của một ngày nhất định
async function fetchFMSData(dateStr, authCookie) {
  return new Promise((resolve, reject) => {
    const params = querystring.stringify({
      FROMDATE: dateStr,
      TODATE: dateStr,
      advData: ''
    });

    http.get({
      hostname: HOST,
      port: 80,
      path: `/FuelOrder/FuelOrderEstPayload/GetData?${params}`,
      headers: {
        'Cookie': authCookie,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': 'http://fms.vietnamairlines.com/FuelOrder/FuelOrderEstPayload',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject({ statusCode: res.statusCode, message: `HTTP Code: ${res.statusCode}` });
        }
        try {
          const json = JSON.parse(body);
          resolve(json.data || []);
        } catch (e) {
          reject(new Error(`Lỗi parse JSON danh sách chuyến bay: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// Tải thông tin chi tiết một chuyến bay bằng LEG_NO và trích xuất số liệu tải dầu
async function fetchFlightDetail(legNo, authCookie) {
  return new Promise((resolve, reject) => {
    http.get({
      hostname: HOST,
      port: 80,
      path: `/FuelOrder/FuelOrderEstPayload/UpdateFuelOrder?LEGNO=${legNo}`,
      headers: {
        'Cookie': authCookie,
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Referer': 'http://fms.vietnamairlines.com/FuelOrder/FuelOrderEstPayload',
        'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Tải chi tiết chuyến bay ${legNo} thất bại, HTTP Code: ${res.statusCode}`));
        }

        try {
          const standbyFuelMatch = body.match(/id="BLOCK_FUEL"[^>]*value="([^"]*)"/i);
          const fuelOrderMatch = body.match(/id="PILOT_REQUEST"[^>]*value="([^"]*)"/i);
          const tripTimeMatch = body.match(/id="PILOT_TRIPTIME"[^>]*value="([^"]*)"/i);
          const taxiFuelMatch = body.match(/id="PILOT_TAXIFUEL"[^>]*value="([^"]*)"/i);
          const tripFuelMatch = body.match(/id="PILOT_TRIPFUEL"[^>]*value="([^"]*)"/i);
          const alternateMatch = body.match(/id="ALTERNATE_DATA"[^>]*value="([^"]*)"/i);

          resolve({
            standby_fuel: standbyFuelMatch ? standbyFuelMatch[1] : '0',
            fuel_order: fuelOrderMatch ? fuelOrderMatch[1] : '0',
            trip_time: tripTimeMatch ? tripTimeMatch[1] : '',
            taxi_fuel: taxiFuelMatch ? taxiFuelMatch[1] : '0',
            trip_fuel: tripFuelMatch ? tripFuelMatch[1] : '0',
            alternate: alternateMatch ? alternateMatch[1] : ''
          });
        } catch (e) {
          reject(new Error(`Lỗi bóc tách chi tiết chuyến bay ${legNo}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

// Chuyển đổi ngày từ YYYY-MM-DD sang DD/MM/YYYY
function convertDbDateToFmsDate(dbDateStr) {
  const parts = dbDateStr.split('-');
  if (parts.length !== 3) return dbDateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

const VN_DOMESTIC_AIRPORTS = ['HAN', 'SGN', 'DAD', 'CXR', 'HUI', 'PQC', 'VCA', 'HPH', 'VDO', 'BMV', 'UIH', 'PXU', 'VDH', 'DIN', 'TBB', 'THD', 'VCL', 'DLI', 'VCS', 'VKG', 'CAH'];

/** Alias sân bay (FMS Skypec hay ghi SAI thay vì SGN) */
const AIRPORT_CODE_ALIASES = {
  SAI: 'SGN', // Sài Gòn
  SGN: 'SGN',
  HAN: 'HAN',
  HAI: 'HPH' // đôi khi ghi nhầm
};

function normalizeAirportCode(code) {
  const c = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!c) return '';
  return AIRPORT_CODE_ALIASES[c] || c;
}

function isDomesticRoute(routeStr) {
  if (!routeStr) return false;
  const cleanRoute = routeStr.toUpperCase().replace(/\s+/g, '');
  const parts = cleanRoute.split('-');
  if (parts.length !== 2) return false;
  const origin = normalizeAirportCode(parts[0]);
  const dest = normalizeAirportCode(parts[1]);
  
  // HẠN-HAN hoặc bay thử nghiệm nội địa
  if (origin === dest && VN_DOMESTIC_AIRPORTS.includes(origin)) return true;
  
  return VN_DOMESTIC_AIRPORTS.includes(origin) && VN_DOMESTIC_AIRPORTS.includes(dest);
}

function isDepartingIntlRoute(routeStr) {
  if (!routeStr) return false;
  const cleanRoute = routeStr.toUpperCase().replace(/\s+/g, '');
  const parts = cleanRoute.split('-');
  if (parts.length !== 2) return false;
  const origin = normalizeAirportCode(parts[0]);
  const dest = normalizeAirportCode(parts[1]);
  
  // Đi từ Việt Nam ra quốc tế (Điểm đi thuộc Việt Nam và Điểm đến là nước ngoài)
  return VN_DOMESTIC_AIRPORTS.includes(origin) && !VN_DOMESTIC_AIRPORTS.includes(dest);
}

/** Chuẩn hóa số đăng ký tàu: "VNA 601" → "VNA601" */
function normalizeAcRegKey(ac) {
  return String(ac || '').toUpperCase().replace(/[\s\-_.]/g, '');
}

/**
 * Khớp tàu bay an toàn:
 * - VNA601 = VNA601
 * - VNA601 = A601 (bỏ prefix VN)
 * - KHÔNG: VNA601 = 601 (chỉ 3 số → quá lỏng, gán nhầm chuyến)
 */
function acRegsMatch(a, b) {
  const x = normalizeAcRegKey(a);
  const y = normalizeAcRegKey(b);
  if (!x || !y || x === '-' || y === '-') return false;
  if (x === y) return true;
  const stripVn = (s) => s.replace(/^VN/, '');
  if (stripVn(x) === stripVn(y)) return true;
  // Chỉ cho phép hậu tố nếu phần ngắn ≥ 4 ký tự (vd A601) và phần dài bắt đầu bằng chữ
  const [lo, hi] = x.length <= y.length ? [x, y] : [y, x];
  if (lo.length >= 4 && hi.endsWith(lo) && /^[A-Z]{2,}/.test(hi)) return true;
  return false;
}

/** Chuẩn hóa số hiệu chuyến để so khớp (bỏ khoảng, gạch) */
function normalizeFlightNoKey(fn) {
  return String(fn || '').toUpperCase().replace(/[\s\-_.]/g, '');
}

/**
 * Chỉ Vietnam Airlines (VN… / VN/BL…).
 * Loại: 9G, VU, và mọi hãng khác (KE, OZ, CX, …).
 */
function isVnAirlineFlightNo(fn) {
  const c = normalizeFlightNoKey(fn);
  if (!c) return false;
  if (c.startsWith('9G') || c.startsWith('VU')) return false;
  // VN1806, VNBL6081, VN/BL6081 → sau normalize còn VN/BL hoặc VNBL
  if (c.startsWith('VN/BL') || c.startsWith('VNBL')) return true;
  return c.startsWith('VN');
}

/**
 * Đủ điều kiện Cancel / bám sau Cancel:
 * - Chuyến VN (VNA)
 * - Chặng nội địa (không quốc tế)
 */
function isCancelScopeFlight(flightNo, routeStr) {
  if (!isVnAirlineFlightNo(flightNo)) return false;
  const route = String(routeStr || '').trim().toUpperCase();
  if (!route || route === '-') return true; // chưa có route → vẫn cho (sẽ lọc khi có)
  // Quốc tế (đi QT hoặc không phải 2 đầu nội địa) → không Cancel-track
  if (isDepartingIntlRoute(route)) return false;
  if (!isDomesticRoute(route) && route !== 'HAN-HAN') return false;
  return true;
}

function parseRouteEndpoints(routeStr) {
  const clean = String(routeStr || '').toUpperCase().replace(/\s+/g, '');
  const parts = clean.split('-').filter(Boolean);
  if (parts.length < 2) return { origin: '', dest: '' };
  return {
    origin: normalizeAirportCode(parts[0]),
    dest: normalizeAirportCode(parts[parts.length - 1])
  };
}

/**
 * Chặng về / không phải chặng đi từ HAN:
 * - DAD-HAN, KIX-HAN, KHH-HAN, SIN-HAN… (đích HAN)
 * - HAN-HAN (nạp kỹ thuật, không phải chặng bay mới để bám)
 * → Bỏ qua khi gán "Chặng bay mới"
 */
function isReturnLegToHan(routeStr) {
  const { origin, dest } = parseRouteEndpoints(routeStr);
  if (!dest) return false;
  if (dest === 'HAN') return true; // mọi chặng về HAN + HAN-HAN
  return false;
}

/** Chặng đi từ HAN ra sân khác: HAN-DIN, HAN-SIN, HAN-SGN… */
function isOutboundFromHan(routeStr) {
  const { origin, dest } = parseRouteEndpoints(routeStr);
  return origin === 'HAN' && dest && dest !== 'HAN';
}

function parseHhMmToMinutes(timeStr) {
  const m = String(timeStr || '').match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Giờ kế hoạch/ước lượng từ object FMS VNA (nhiều field có thể có) */
function extractFmsFlightTimeMinutes(f) {
  if (!f) return null;
  const keys = [
    'STD', 'ETD', 'ATD', 'DEP_TIME', 'SCHED_DEP', 'DEP_SCHED',
    'time_dep', 'TIME_DEP', 'ETD_SCHED', 'DEP'
  ];
  for (const k of keys) {
    const mins = parseHhMmToMinutes(f[k]);
    if (mins != null) return mins;
  }
  // đôi khi giờ nằm trong chuỗi
  for (const k of Object.keys(f)) {
    if (/time|etd|std|dep/i.test(k)) {
      const mins = parseHhMmToMinutes(f[k]);
      if (mins != null) return mins;
    }
  }
  return null;
}

/**
 * Điểm thời gian tuyệt đối để so “chặng gần nhất”:
 * date YYYY-MM-DD + phút trong ngày → 1 số. Không có giờ → cuối ngày (+1999).
 */
function flightAbsSortKey(fDate, ftMins) {
  const m = String(fDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ftMins != null ? ftMins : 9e12;
  const day = (+m[1]) * 372 + (+m[2]) * 31 + (+m[3]); // monotonic enough
  const t = ftMins != null ? ftMins : 1999; // chưa biết giờ → xếp sau mọi chuyến đã biết giờ cùng ngày
  return day * 2000 + t;
}

/**
 * Chặng bay TIẾP THEO duy nhất của tàu sau sự kiện (đổi tàu / Cancel / NKT):
 * 1) Cùng tàu, khác chuyến gốc
 * 2) Chỉ chặng ĐI từ HAN (bỏ về *-HAN, HAN-HAN)
 * 3) Cùng ngày monitor: giờ ≥ old_time; ngày sau: mọi giờ
 * 4) CHỌN ĐÚNG 1 chuyến: sớm nhất theo (ngày, giờ) — KHÔNG ưu tiên QT/ND
 *    → VD VNA326 sau cancel: VN661 00:30, không phải VN923 10:15
 */
function findNextMonitorFlight(fmsFlights, track, scanDate, opts = {}) {
  const requireAfterOldTime = opts.requireAfterOldTime !== false;
  const trackAc = normalizeAcRegKey(track.ac_reg);
  const oldFlt = String(track.old_flight_no || '').toUpperCase().replace(/\s+/g, '');
  const oldMins = parseHhMmToMinutes(track.old_time);
  const trackDate = String(track.date || '').trim();
  const defaultScan = String(scanDate || '').trim();

  const scored = [];
  for (const f of fmsFlights || []) {
    if (!f || !f.ACREG || !f.FLIGHTNO) continue;
    if (!acRegsMatch(f.ACREG, trackAc)) continue;

    const fltNo = String(f.FLIGHTNO).toUpperCase().replace(/\s+/g, '');
    if (!fltNo || fltNo === oldFlt) continue;
    if (/NKT|HANHAN/i.test(fltNo) || fltNo === 'VNNKT') continue;

    const dep = normalizeAirportCode(f.DEP_AP_SCHED || f.DEP || '');
    const arr = normalizeAirportCode(f.ARR_AP_SCHED || f.ARR || '');
    const route = dep && arr ? `${dep}-${arr}` : '';
    if (!route || route === '-' || route === 'HAN-HAN') continue;
    if (isReturnLegToHan(route)) continue;
    if (!isOutboundFromHan(route)) continue;

    const intl = isDepartingIntlRoute(route);
    const domesticOut = isDomesticRoute(route);
    if (!intl && !domesticOut) continue;

    const fDate = String(f._date || f.date || f.FMS_DATE || defaultScan || '').trim();
    if (trackDate && fDate && fDate < trackDate) continue;

    const ft = extractFmsFlightTimeMinutes(f);
    // Cùng ngày với monitor: bắt buộc sau giờ nạp
    if (requireAfterOldTime && trackDate && fDate && fDate === trackDate && oldMins != null) {
      if (ft == null) continue;
      if (ft < oldMins) continue;
    }

    scored.push({
      f,
      route,
      fltNo,
      ft,
      intl,
      fDate,
      abs: flightAbsSortKey(fDate, ft)
    });
  }

  if (!scored.length) return null;
  // Chỉ 1 tiêu chí: gần nhất theo thời gian thực tế
  scored.sort((a, b) => {
    if (a.abs !== b.abs) return a.abs - b.abs;
    return String(a.fltNo).localeCompare(String(b.fltNo));
  });
  const best = scored[0];
  return {
    flight: best.f,
    route: best.route,
    fltNo: best.fltNo,
    isIntl: best.intl,
    fDate: best.fDate,
    ft: best.ft
  };
}

/**
 * === MA TRẬN GIÁM SÁT (tách bạch, không lẫn) ===
 *
 * CANCELLED_FUELED  | Tạo: VN ND + kg>0 + mất VNA + ≥40p
 *                   | Bám: tàu bay QT sau cancel → CẢNH BÁO tái xuất
 *                   | Đóng: tàu bay ND đi sau → an toàn (dùng dầu ND)
 *
 * DOMESTIC_TO_INTL  | Tạo: đổi tàu sau nạp ND
 *                   | Bám: tàu CŨ bay QT sau nạp → CẢNH BÁO
 *                   | Đóng: tàu CŨ bay ND đi sau → an toàn
 *
 * INTL_TO_DOMESTIC  | Tạo: đổi tàu sau nạp QT
 *                   | Bám: tàu CŨ bay ND sau nạp → CẢNH BÁO
 *                   | Đóng: tàu CŨ bay QT tiếp → không phải case ND
 *
 * TECHNICAL_HAN     | Tạo: nạp HAN-HAN kg>0
 *                   | Bám: tàu bay ND hoặc QT sau nạp → CẢNH BÁO (cả hai)
 */
function decideMonitorAction(track, next) {
  if (!track || !next) return { action: 'wait' };
  const type = String(track.monitor_type || '');
  const route = String(next.route || '');
  const isIntl = !!(next.isIntl || isDepartingIntlRoute(route));
  const isDom =
    isDomesticRoute(route) && isOutboundFromHan(route) && !isReturnLegToHan(route);

  if (type === 'CANCELLED_FUELED') {
    if (isIntl) return { action: 'warn', kind: 'cancel_reexport_intl' };
    if (isDom) return { action: 'close', kind: 'cancel_used_domestic' };
    return { action: 'wait' };
  }
  if (type === 'DOMESTIC_TO_INTL') {
    if (isIntl) return { action: 'warn', kind: 'dom_to_intl' };
    if (isDom) return { action: 'close', kind: 'dom_change_used_domestic' };
    return { action: 'wait' };
  }
  if (type === 'INTL_TO_DOMESTIC') {
    if (isDom) return { action: 'warn', kind: 'intl_to_dom' };
    if (isIntl) return { action: 'close', kind: 'intl_still_intl' };
    return { action: 'wait' };
  }
  if (type === 'TECHNICAL_HAN') {
    if (isIntl) return { action: 'warn', kind: 'tech_intl' };
    if (isDom) return { action: 'warn', kind: 'tech_domestic' };
    return { action: 'wait' };
  }
  return { action: 'wait' };
}

function buildMonitorWarningMessage(track, next, kind) {
  const ac = String(track.ac_reg || '').trim().toUpperCase();
  const kg = parseInt(track.fuel_order, 10) || 0;
  const kgStr = kg.toLocaleString('vi-VN');
  const oldFlt = track.old_flight_no;
  const oldRoute = track.old_route;
  const oldTime = track.old_time;
  const newFlt = next.fltNo;
  const newRoute = next.route;
  const now = getVietnamDateTimeStr();

  if (kind === 'cancel_reexport_intl') {
    return `⚠️ [CẢNH BÁO TÁI XUẤT – SAU CANCEL]
Tàu ${ac} đã nạp ${kgStr} kg cho chuyến ${oldFlt} (${oldRoute} lúc ${oldTime}) — chuyến đã Cancel trên FMS VNA.
🔄 Hiện được phân công bay Quốc tế: ${newFlt} (${newRoute})
Yêu cầu Điều hành & thống kê kiểm tra ngay!
📢 Giờ cảnh báo: ${now}`;
  }
  if (kind === 'dom_to_intl') {
    return `⚠️ [CẢNH BÁO N.ĐỊA → Q.TẾ]
Tàu ${ac} đã nạp ${kgStr} kg dầu nội địa cho ${oldFlt} (${oldRoute} lúc ${oldTime}) nhưng đổi tàu.
🔄 Hiện tàu được phân công bay Quốc tế: ${newFlt} (${newRoute})
Yêu cầu Điều hành & thống kê kiểm tra ngay!
📢 Giờ cảnh báo: ${now}`;
  }
  if (kind === 'intl_to_dom') {
    return `⚠️ [CẢNH BÁO Q.TẾ → N.ĐỊA]
Tàu ${ac} đã nạp ${kgStr} kg dầu Quốc tế cho ${oldFlt} (${oldRoute} lúc ${oldTime}).
🔄 Hiện xếp bay Nội địa: ${newFlt} (${newRoute})
📢 Giờ cảnh báo: ${now}`;
  }
  if (kind === 'tech_intl') {
    return `⚠️ [CẢNH BÁO TẠM NHẬP - TÁI XUẤT]
Điều hành chú ý: Sử dụng tàu đã nạp kỹ thuật Han-Han cho chuyến bay Quốc Tế.
✈️ Tàu bay: ${ac}
⛽ Đã nạp kỹ thuật HAN-HAN: ${kgStr} kg (Chuyến cũ: ${oldFlt} lúc ${oldTime})
🔄 Quốc tế: ${newFlt} (${newRoute})
📢 Giờ cảnh báo: ${now}`;
  }
  if (kind === 'tech_domestic') {
    return `⚠️ [CẢNH BÁO SỬ DỤNG DẦU NẠP KỸ THUẬT]
Điều hành chú ý: Sử dụng tàu đã nạp kỹ thuật cho chuyến bay nội địa.
✈️ Tàu bay: ${ac}
⛽ Đã nạp kỹ thuật HAN-HAN: ${kgStr} kg (Chuyến cũ: ${oldFlt} lúc ${oldTime})
🔄 Nội địa: ${newFlt} (${newRoute})
📢 Giờ cảnh báo: ${now}`;
  }
  return '';
}

/** Gom ứng viên chặng mới: VNA payload + Skypec + presence (ngày monitor + ngày kế + ngày quét).
 *  Ưu tiên bản ghi CÓ GIỜ (ETD/STD) — presence không giờ không đè mất FMS.
 */
async function collectNextFlightCandidates(db, track, vnaFlights, scanDate) {
  const byKey = new Map();
  const push = (f) => {
    if (!f || !f.FLIGHTNO || !f.ACREG) return;
    const key = `${String(f._date || '')}|${String(f.FLIGHTNO).toUpperCase().replace(/\s+/g, '')}|${normalizeAcRegKey(f.ACREG)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, f);
      return;
    }
    // Giữ bản có giờ rõ hơn (không để presence không ETD che FMS có ETD)
    const prevT = extractFmsFlightTimeMinutes(prev);
    const nextT = extractFmsFlightTimeMinutes(f);
    if (prevT == null && nextT != null) byKey.set(key, f);
  };

  const trackDate = String(track.date || '').trim();
  const nextDate = trackDate ? addDaysYmdStr(trackDate, 1) : '';
  const today = getVietnamDbDateStr();
  const dates = [...new Set([trackDate, nextDate, scanDate, today].filter(Boolean))];

  // 1) FMS VNA payload (thường có ETD)
  for (const f of vnaFlights || []) {
    push({
      ...f,
      _date: f._date || f.date || scanDate
    });
  }

  for (const d of dates) {
    // 2) Skypec live (có time_dep / time_fuel)
    try {
      const lives = await db.all(
        `SELECT flight_no, ac_reg, route, time_dep, time_fuel FROM fms_flights_live WHERE date = ?`,
        d
      );
      for (const r of lives || []) {
        if (!acRegsMatch(r.ac_reg, track.ac_reg)) continue;
        const { origin, dest } = parseRouteEndpoints(r.route);
        if (!origin || !dest) continue;
        push({
          FLIGHTNO: r.flight_no,
          ACREG: r.ac_reg,
          DEP_AP_SCHED: origin,
          ARR_AP_SCHED: dest,
          STD: r.time_dep,
          ETD: r.time_dep,
          time_dep: r.time_dep,
          time_fuel: r.time_fuel,
          _date: d
        });
      }
    } catch (_) { /* ignore */ }

    // 3) Presence (+ last_etd nếu có) — bổ sung chuyến QT chưa có trên Skypec
    try {
      const pres = await db.all(
        `SELECT flight_no, ac_reg, route, last_etd FROM fms_vna_presence WHERE date = ?`,
        d
      ).catch(async () =>
        db.all(`SELECT flight_no, ac_reg, route FROM fms_vna_presence WHERE date = ?`, d)
      );
      for (const r of pres || []) {
        if (!acRegsMatch(r.ac_reg, track.ac_reg)) continue;
        const { origin, dest } = parseRouteEndpoints(r.route);
        if (!origin || !dest) continue;
        const etd = r.last_etd || null;
        push({
          FLIGHTNO: r.flight_no,
          ACREG: r.ac_reg,
          DEP_AP_SCHED: origin,
          ARR_AP_SCHED: dest,
          STD: etd,
          ETD: etd,
          _date: d
        });
      }
    } catch (_) { /* presence table optional */ }
  }

  return [...byKey.values()];
}

/** Alias Cancel */
function findNextFlightAfterCancel(fmsFlights, track, scanDate) {
  return findNextMonitorFlight(fmsFlights, track, scanDate, { requireAfterOldTime: true });
}

/**
 * Cảnh báo SAI TÊN HÃNG HÀNG KHÔNG:
 * - Lấy ký hiệu từ số chuyến (CA6116 → CA; CA 3 số / 4 số → tên khác nhau)
 * - Ưu tiên so "Hãng bay" trên FMS Skypec Flights với tên đúng
 * - Fallback: CARRIER FMS VNA nếu chưa có Hãng bay
 * - Gửi Zalo nhóm riêng (fallback nhóm FMS chung)
 *
 * matchedFlights: mảng object có FLIGHTNO, CARRIER?, AIRLINE_NAME?, ACREG?, GATE?,
 *   DRIVER_NAME?, OPERATOR_NAME?, TRUCK_NO?
 */
async function checkAirlineNameMismatchAlerts(db, targetDate, matchedFlights, scheduleByFlight) {
  try {
    const notifySetting = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_airline_mismatch'");
    const notifyEnabled = notifySetting ? (notifySetting.value === 'true') : true;
    if (!notifyEnabled) return;
    if (!matchedFlights || matchedFlights.length === 0) return;

    const zaloMaster = await db.get("SELECT value FROM settings WHERE key = 'zalo_notify_enabled'");
    const isZaloOn = zaloMaster ? (zaloMaster.value === 'true') : false;

    let groupIds = [];
    const airlineGroup = await db.get("SELECT value FROM settings WHERE key = 'fms_airline_alert_group_id'");
    if (airlineGroup && airlineGroup.value) {
      groupIds = String(airlineGroup.value).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (groupIds.length === 0) {
      const ieGroup = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_group_id'");
      if (ieGroup && ieGroup.value) {
        groupIds = String(ieGroup.value).split(',').map(s => s.trim()).filter(Boolean);
      }
    }
    if (groupIds.length === 0) {
      const mainGroup = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
      if (mainGroup && mainGroup.value) {
        groupIds = String(mainGroup.value).split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    // Map Hãng bay Skypec đã cào (bổ sung cho flight từ VNA nếu thiếu)
    const liveRows = await db.all(
      "SELECT flight_no, airline_name, driver_name, operator_name, truck_no, gate, ac_reg FROM fms_flights_live WHERE date = ?",
      targetDate
    ).catch(() => []);
    const liveByFlight = {};
    for (const row of liveRows || []) {
      if (!row.flight_no) continue;
      const key = String(row.flight_no).toUpperCase().replace(/\s+/g, '');
      liveByFlight[key] = row;
    }

    for (const flt of matchedFlights) {
      if (!flt.FLIGHTNO) continue;
      const cleanFltNo = String(flt.FLIGHTNO).toUpperCase().replace(/\s+/g, '');
      const carrier = flt.CARRIER != null ? String(flt.CARRIER).trim() : '';
      const live = liveByFlight[cleanFltNo];
      const actualAirlineName = (
        flt.AIRLINE_NAME ||
        flt.airline_name ||
        (live && live.airline_name) ||
        flt.CUSTOMER_NAME ||
        flt.CUSTOMER ||
        ''
      );

      const mismatch = evaluateAirlineMismatch({
        flightNo: cleanFltNo,
        carrierCode: carrier,
        actualAirlineName,
        selectedAirlineName: actualAirlineName
      });
      if (!mismatch) continue;

      // Chống spam: 1 cảnh báo / chuyến / ngày (is_warned >= 1)
      const exists = await db.get(
        "SELECT id, is_warned FROM fms_airline_alerts WHERE UPPER(flight_no) = UPPER(?) AND date = ?",
        cleanFltNo, targetDate
      );
      if (exists && exists.is_warned >= 1) continue;

      const sched = scheduleByFlight ? scheduleByFlight[cleanFltNo] : null;
      const crewFromLive = live
        ? [live.driver_name, live.operator_name].filter(Boolean).join(' - ')
        : '';
      const crewFromFlt = [flt.DRIVER_NAME || flt.driver_name, flt.OPERATOR_NAME || flt.operator_name]
        .filter(Boolean).join(' - ');
      const crewInfo = sched
        ? (sched.crew_info || [sched.driver_name, sched.operator_name].filter(Boolean).join(' - ') || '-')
        : (crewFromFlt || crewFromLive || '-');
      const truckNo = (sched && sched.truck_no)
        || flt.TRUCK_NO || flt.truck_no
        || (live && live.truck_no)
        || '-';
      const gate = (sched && sched.gate)
        || flt.GATE || flt.gate
        || (live && live.gate)
        || '-';
      const acReg = (flt.ACREG || flt.ac_reg || (live && live.ac_reg) || '-');
      const acRegStr = acReg ? String(acReg).trim() : '-';
      const displayActual = mismatch.actualAirlineName && mismatch.actualAirlineName !== '-'
        ? mismatch.actualAirlineName
        : mismatch.actualCarrier;

      const msg = `⚠️ [CẢNH BÁO SAI TÊN HÃNG HÀNG KHÔNG]
✈️ Chuyến bay: ${cleanFltNo}
📋 Ký hiệu đúng: ${mismatch.expectedCode}
🏢 Tên hãng đúng: ${mismatch.expectedName}
❌ Hãng bay trên Skypec/FMS: ${displayActual}
📝 Chi tiết: ${mismatch.reason}
👥 Cặp tra nạp: ${crewInfo}
🚛 Xe: ${truckNo} | 📍 Gate: ${gate} | 🛩️ Tàu: ${acRegStr}
📅 Ngày FMS: ${targetDate}
📢 Giờ cảnh báo: ${getVietnamDateTimeStr()}`;

      const actualNameStore = mismatch.actualAirlineName || mismatch.selectedAirlineName || '-';

      if (exists) {
        await db.run(
          `UPDATE fms_airline_alerts SET
            expected_code = ?, expected_name = ?, actual_carrier = ?, actual_name = ?,
            crew_info = ?, reason = ?, is_warned = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          mismatch.expectedCode, mismatch.expectedName, mismatch.actualCarrier,
          actualNameStore, crewInfo, mismatch.reason, exists.id
        );
      } else {
        await db.run(
          `INSERT INTO fms_airline_alerts
            (flight_no, date, expected_code, expected_name, actual_carrier, actual_name, crew_info, reason, is_warned)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          cleanFltNo, targetDate, mismatch.expectedCode, mismatch.expectedName,
          mismatch.actualCarrier, actualNameStore, crewInfo, mismatch.reason
        );
      }

      log(`[Airline Alert] ${cleanFltNo}: ${mismatch.reason}`);

      if (isZaloOn && groupIds.length > 0) {
        for (const gid of groupIds) {
          await sendSkyEyesMessage(gid, msg, []).catch(e =>
            console.error(`[Airline Alert Zalo] Group ${gid}:`, e.message)
          );
        }
      }
    }
  } catch (err) {
    console.error('[Airline Alert] Lỗi kiểm tra sai tên hãng:', err.message);
  }
}

/** Nhóm Zalo nhận cảnh báo Tạm nhập / Tái xuất / Cancel */
async function getImportExportNotifyTargets(db) {
  const notifySetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_notify_enabled'");
  const isSkyOneEnabled = notifySetting ? (notifySetting.value === 'true') : false;
  const ieGroupSetting = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_group_id'");
  let targetGroupId = ieGroupSetting ? ieGroupSetting.value : '';
  if (!targetGroupId) {
    const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
    targetGroupId = groupSetting ? groupSetting.value : '';
  }
  return { isSkyOneEnabled, targetGroupId };
}

function sendImportExportZalo(targetGroupId, isSkyOneEnabled, message, logTag) {
  if (!isSkyOneEnabled || !targetGroupId) return;
  const groupIds = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
  groupIds.forEach(id => {
    sendSkyEyesMessage(id, message, [])
      .then(() => log(`[SkyOne] ${logTag} → nhóm ${id} OK`))
      .catch(err => console.error(`[SkyOne] ${logTag} → nhóm ${id} lỗi:`, err.message));
  });
}

/** Lấy chuỗi giờ ETD/STD từ object FMS (HH:MM) */
function extractFmsFlightTimeStr(f) {
  if (!f) return null;
  const keys = [
    'ETD', 'STD', 'ATD', 'DEP_TIME', 'SCHED_DEP', 'DEP_SCHED',
    'time_dep', 'TIME_DEP', 'ETD_SCHED', 'DEP'
  ];
  for (const k of keys) {
    const m = String(f[k] || '').match(/(\d{1,2}):(\d{2})/);
    if (m) return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
  }
  for (const k of Object.keys(f)) {
    if (/time|etd|std|dep/i.test(k)) {
      const m = String(f[k] || '').match(/(\d{1,2}):(\d{2})/);
      if (m) return `${String(m[1]).padStart(2, '0')}:${m[2]}`;
    }
  }
  return null;
}

/**
 * Ghi nhận chuyến VN trên FMS VNA (snapshot).
 * - Lưu cả ND + QT + ETD (để bám ĐÚNG 1 chặng tiếp theo theo giờ)
 * - Cancel detect vẫn chỉ xét chuyến ND qua isCancelScopeFlight
 */
async function upsertVnaPresence(db, targetDate, vnaFmsFlights) {
  for (const f of vnaFmsFlights || []) {
    if (!f || !f.FLIGHTNO) continue;
    const fltNo = String(f.FLIGHTNO).toUpperCase().replace(/\s+/g, '');
    if (!isVnAirlineFlightNo(fltNo)) continue;
    const acReg = String(f.ACREG || f.ac_reg || '').trim().toUpperCase();
    if (!fltNo || !acReg || acReg === '-') continue;
    const dep = normalizeAirportCode(f.DEP_AP_SCHED || f.DEP || '');
    const arr = normalizeAirportCode(f.ARR_AP_SCHED || f.ARR || '');
    const route = dep && arr ? `${dep}-${arr}` : '-';
    const etd = extractFmsFlightTimeStr(f);
    try {
      await db.run(
        `INSERT INTO fms_vna_presence (flight_no, date, ac_reg, route, last_etd, last_seen_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(flight_no, date) DO UPDATE SET
           ac_reg = excluded.ac_reg,
           route = excluded.route,
           last_etd = COALESCE(excluded.last_etd, fms_vna_presence.last_etd),
           last_seen_at = CURRENT_TIMESTAMP`,
        fltNo, targetDate, acReg, route, etd
      );
    } catch (_) {
      // DB chưa có last_etd
      await db.run(
        `INSERT INTO fms_vna_presence (flight_no, date, ac_reg, route, last_seen_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(flight_no, date) DO UPDATE SET
           ac_reg = excluded.ac_reg,
           route = excluded.route,
           last_seen_at = CURRENT_TIMESTAMP`,
        fltNo, targetDate, acReg, route
      );
    }
  }
}

/**
 * CANCEL đã nạp (ops sát trong ngày):
 * 1) Chỉ ngày theo dõi: hôm nay (+ hôm qua nếu <07:30 ca tối) — không quét rộng
 * 2) VN nội địa, từng có trên FMS VNA (snapshot) + đúng tàu
 * 3) Skypec kg > 0
 * 4) Mất trên VNA
 * 5) Đã qua ≥40 phút sau giờ nạp (thường bay 40p–1h, tối đa ~2h → đổi tàu hoặc hủy)
 * → Zalo 1 lần + monitor CANCELLED_FUELED
 * Đổi tàu: nhánh riêng (Skypec ac_reg đổi khi còn chuyến).
 */
async function detectCancelledFueledFlights(db, targetDate, vnaFmsFlights) {
  try {
    // Chỉ quét sát trong ngày — không Cancel cho ngày xa
    if (!isCancelWatchDate(targetDate)) {
      log(`[Cancel] Bỏ qua ngày ${targetDate}: ngoài cửa sổ theo dõi trong ngày (${getCancelWatchDates().join(', ')}).`);
      return { checked: 0, cancelled: 0, skipped: 'out_of_day_window' };
    }

    // Dọn Cancel ngoài phạm vi + presence cũ
    try {
      const badRows = await db.all(
        `SELECT id, old_flight_no, old_route FROM fms_temp_import_exports
         WHERE monitor_type = 'CANCELLED_FUELED'`
      );
      let purgedBad = 0;
      for (const r of badRows || []) {
        if (!isCancelScopeFlight(r.old_flight_no, r.old_route)) {
          await db.run('DELETE FROM fms_temp_import_exports WHERE id = ?', r.id);
          purgedBad++;
        }
      }
      if (purgedBad > 0) {
        log(`[Cancel] Đã xóa ${purgedBad} bản ghi Cancel ngoài phạm vi (VN nội địa).`);
      }
      // Presence: chỉ giữ 2 ngày gần (hôm nay + hôm qua)
      const keepFrom = addDaysYmdStr(getVietnamDbDateStr(), -1);
      await db.run('DELETE FROM fms_vna_presence WHERE date < ?', keepFrom);
      await db.run(
        `DELETE FROM fms_vna_presence WHERE date = ?
           AND UPPER(REPLACE(REPLACE(flight_no,' ',''),'-','')) NOT LIKE 'VN%'`,
        targetDate
      );
    } catch (purgeErr) {
      console.error('[Cancel] Lỗi dọn ngoài phạm vi:', purgeErr.message);
    }

    if (!vnaFmsFlights || vnaFmsFlights.length === 0) {
      log(`[Cancel] Bỏ qua detect ngày ${targetDate}: FMS VNA 0 chuyến (tránh cảnh báo nhầm).`);
      return { checked: 0, cancelled: 0 };
    }

    // Cập nhật snapshot trước khi so “biến mất”
    await upsertVnaPresence(db, targetDate, vnaFmsFlights);

    // Bổ sung snapshot từ fms_fuel_orders (đã từng quét chi tiết trên VNA) — bắt case Cancel đã mất trước vòng hiện tại
    try {
      const orderRows = await db.all(
        `SELECT flight_no, ac_reg FROM fms_fuel_orders
         WHERE flight_no LIKE ?
           AND ac_reg IS NOT NULL AND TRIM(ac_reg) != '' AND TRIM(ac_reg) != '-'`,
        `%_${targetDate}`
      );
      for (const o of orderRows || []) {
        const raw = String(o.flight_no || '');
        const fltNo = raw.replace(new RegExp(`_${targetDate}$`), '').toUpperCase().replace(/\s+/g, '');
        const acReg = String(o.ac_reg || '').trim().toUpperCase();
        if (!fltNo || !acReg) continue;
        if (!isVnAirlineFlightNo(fltNo)) continue; // chỉ VN
        await db.run(
          `INSERT INTO fms_vna_presence (flight_no, date, ac_reg, route, last_seen_at)
           VALUES (?, ?, ?, '-', CURRENT_TIMESTAMP)
           ON CONFLICT(flight_no, date) DO UPDATE SET
             ac_reg = CASE WHEN fms_vna_presence.ac_reg IS NULL OR fms_vna_presence.ac_reg = '-' THEN excluded.ac_reg ELSE fms_vna_presence.ac_reg END`,
          fltNo, targetDate, acReg
        );
      }
    } catch (seedErr) {
      console.error('[Cancel] Seed presence từ fuel_orders:', seedErr.message);
    }

    const vnaSet = new Set();
    vnaFmsFlights.forEach(f => {
      if (!f || !f.FLIGHTNO) return;
      vnaSet.add(String(f.FLIGHTNO).toUpperCase().replace(/\s+/g, ''));
    });

    // Chỉ xét chuyến TỪNG thấy trên VNA, nay mất
    const presenceRows = await db.all(
      'SELECT flight_no, ac_reg, route FROM fms_vna_presence WHERE date = ?',
      targetDate
    );

    let cancelled = 0;
    let checked = 0;
    const { isSkyOneEnabled, targetGroupId } = await getImportExportNotifyTargets(db);

    for (const prev of presenceRows || []) {
      const fltNo = String(prev.flight_no || '').toUpperCase().replace(/\s+/g, '');
      const snapAc = String(prev.ac_reg || '').trim().toUpperCase();
      if (!fltNo || !snapAc || snapAc === '-') continue;

      // Chỉ VN nội địa — bỏ 9G, VU, quốc tế, hãng ngoài
      if (!isCancelScopeFlight(fltNo, prev.route)) continue;

      // Còn trên VNA → không Cancel
      if (vnaSet.has(fltNo)) continue;
      checked++;

      // Skypec: đã nạp kg > 0
      const skypec = await db.get(
        'SELECT flight_no, ac_reg, route, fuel_order, time_fuel, driver_name, operator_name FROM fms_flights_live WHERE date = ? AND UPPER(REPLACE(flight_no,\' \',\'\')) = ?',
        targetDate, fltNo
      );
      const kg = skypec
        ? (parseInt(String(skypec.fuel_order || '0').replace(/[^\d]/g, ''), 10) || 0)
        : 0;
      if (kg <= 0) continue;

      // Khớp tàu: ưu tiên Skypec ac_reg nếu có; phải trùng snapshot VNA
      const skypecAc = skypec && skypec.ac_reg
        ? String(skypec.ac_reg).trim().toUpperCase()
        : '';
      if (skypecAc && skypecAc !== '-' && skypecAc !== snapAc) {
        log(`[Cancel] Bỏ ${fltNo}: tàu Skypec ${skypecAc} ≠ VNA snapshot ${snapAc}`);
        continue;
      }
      const acReg = snapAc;

      const route = (skypec && skypec.route
        ? String(skypec.route).trim().toUpperCase()
        : String(prev.route || '-').trim().toUpperCase()) || '-';

      // Chặn quốc tế / không phải VN (route Skypec có thể rõ hơn snapshot)
      if (!isCancelScopeFlight(fltNo, route)) continue;

      // Đã báo 1 lần
      const exists = await db.get(
        `SELECT id FROM fms_temp_import_exports
         WHERE UPPER(TRIM(ac_reg)) = ? AND UPPER(REPLACE(old_flight_no,' ','')) = ?
           AND date = ? AND monitor_type = 'CANCELLED_FUELED'`,
        acReg, fltNo, targetDate
      );
      if (exists) continue;
      let timeFuel = skypec && skypec.time_fuel && skypec.time_fuel !== '-'
        ? String(skypec.time_fuel).trim()
        : '-';

      let driver = skypec ? String(skypec.driver_name || '').split(',')[0].trim() : '';
      let operator = skypec ? String(skypec.operator_name || '').split(',')[0].trim() : '';
      if (/^NAFSC$/i.test(driver)) driver = '';
      if (/^NAFSC$/i.test(operator)) operator = '';

      if (!driver && !operator) {
        const sched = await db.get(
          `SELECT driver_name, operator_name, crew_info, time_fuel FROM fms_schedules
           WHERE (date = ? OR fms_date = ?)
             AND REPLACE(REPLACE(UPPER(flight_no),' ',''),'-','') = ?
           LIMIT 1`,
          targetDate, targetDate, fltNo.replace(/-/g, '')
        );
        if (sched) {
          driver = String(sched.driver_name || '').trim();
          operator = String(sched.operator_name || '').trim();
          if ((!driver || !operator) && sched.crew_info) {
            const parts = String(sched.crew_info).split(/\s+-\s+/).map(p => p.trim());
            if (!driver && parts[0]) driver = parts[0];
            if (!operator && parts[1]) operator = parts[1];
          }
          if (timeFuel === '-' && sched.time_fuel) timeFuel = String(sched.time_fuel).trim();
        }
      }

      // Cửa sổ ops: sau nạp ≥40p mới kết luận Cancel (trước đó có thể sắp bay / nhiễu FMS)
      if (!canReportCancelAfterFuel(targetDate, timeFuel)) {
        const mins = minutesSinceFuelEvent(targetDate, timeFuel);
        log(`[Cancel] Chờ ${fltNo}: mới nạp ${mins != null ? mins + 'p' : '?'} (<${CANCEL_GRACE_MIN_AFTER_FUEL}p) — chưa báo.`);
        continue;
      }

      const crewPair = [driver, operator].filter(Boolean).join(' - ') || '-';
      const minsAfter = minutesSinceFuelEvent(targetDate, timeFuel);
      const windowNote = minsAfter != null
        ? ` (sau nạp ~${minsAfter}p; kỳ vọng bay 40p–${CANCEL_TYPICAL_MAX_HOURS}h)`
        : '';

      await db.run(
        `INSERT INTO fms_temp_import_exports
          (ac_reg, old_flight_no, old_route, fuel_order, date, monitor_type, old_time, is_warned)
         VALUES (?, ?, ?, ?, ?, 'CANCELLED_FUELED', ?, 0)`,
        acReg, fltNo, route, kg, targetDate, timeFuel
      );

      const msg = `⚠️ [CẢNH BÁO CANCEL CHUYẾN BAY]
Chuyến ${fltNo} (${route}) đã nạp ${kg.toLocaleString('vi-VN')} kg trên tàu ${acReg}
Cặp tra nạp: ${crewPair} vào lúc: ${timeFuel}${windowNote}
→ Phát hiện không tồn tại trên hệ thống FMS VNA
→ Khả năng cao đã hủy chuyến. Đề nghị Điều hành theo dõi.
Tàu ${acReg} đã được đưa vào theo dõi Tái xuất.
📢 Giờ cảnh báo: ${getVietnamDateTimeStr()}`;

      log(`[Cancel] ${fltNo} / ${acReg} / ${kg} kg — mất VNA sau nạp${windowNote} → báo 1 lần.`);
      sendImportExportZalo(targetGroupId, isSkyOneEnabled, msg, `Cancel ${fltNo}`);
      cancelled++;
    }

    if (cancelled > 0 || checked > 0) {
      log(`[Cancel] Ngày ${targetDate}: mất khỏi VNA (đã từng thấy)=${checked}, báo Cancel=${cancelled}.`);
    }
    return { checked, cancelled };
  } catch (err) {
    console.error('[Cancel] Lỗi detect:', err.message);
    return { checked: 0, cancelled: 0, error: err.message };
  }
}

// Kiểm tra cảnh báo Tạm nhập - Tái xuất tàu bay (logic tách theo loại — không lẫn)
async function checkTempImportExportAlerts(db, targetDate, fmsFlights) {
  try {
    const todayDb = getVietnamDbDateStr();
    const durationSetting = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_duration'");
    const durationVal = durationSetting ? durationSetting.value : '24h';

    // ── 0. Dọn gán "chặng mới" sai hình học / sai loại ──────────────────────
    try {
      // Chỉ dọn hình học sai trên bản ghi ĐÃ gán nhưng chưa “khóa” cảnh báo.
      // is_warned=1 (đã cảnh báo Zalo) → KHÔNG clear-loop (tránh spam).
      const dirty = await db.all(
        `SELECT id, monitor_type, new_route, new_flight_no, old_time, date, ac_reg, is_warned
         FROM fms_temp_import_exports
         WHERE is_warned = 0
           AND new_route IS NOT NULL AND TRIM(new_route) != '' AND TRIM(new_route) != '-'`
      );
      let cleared = 0;
      for (const r of dirty || []) {
        const nr = String(r.new_route || '').toUpperCase().replace(/\s+/g, '');
        let bad = isReturnLegToHan(nr) || !isOutboundFromHan(nr) || nr === 'HAN-HAN';
        if (!bad && r.monitor_type === 'DOMESTIC_TO_INTL' && isDomesticRoute(nr) && !isDepartingIntlRoute(nr)) {
          bad = true;
        }
        if (!bad && r.monitor_type === 'CANCELLED_FUELED' && nr && isDomesticRoute(nr) && !isDepartingIntlRoute(nr)) {
          bad = true;
        }
        if (bad) {
          await db.run(
            `UPDATE fms_temp_import_exports
             SET new_flight_no = NULL, new_route = NULL, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            r.id
          );
          cleared++;
        }
      }
      if (cleared > 0) log(`[Giám sát] Gỡ ${cleared} chặng mới sai hình học (is_warned=0).`);
    } catch (reErr) {
      console.error('[Giám sát] Lỗi dọn chặng mới:', reErr.message);
    }

    // ── 1. Auto-đóng monitor thương mại quá hạn (giữ Cancel + NKT mở đến khi resolve) ──
    if (durationVal !== 'always') {
      const closeBefore = addDaysYmdStr(todayDb, -1); // giữ hôm qua cho đổi tàu
      await db.run(
        `UPDATE fms_temp_import_exports SET is_warned = 2, updated_at = CURRENT_TIMESTAMP
         WHERE is_warned = 0 AND date < ?
           AND monitor_type NOT IN ('TECHNICAL_HAN', 'CANCELLED_FUELED')`,
        closeBefore
      );
      // Cancel / NKT mở quá 2 ngày → đóng
      const cancelExpire = addDaysYmdStr(todayDb, -2);
      await db.run(
        `UPDATE fms_temp_import_exports SET is_warned = 2, updated_at = CURRENT_TIMESTAMP
         WHERE is_warned = 0 AND date < ?
           AND monitor_type IN ('TECHNICAL_HAN', 'CANCELLED_FUELED')`,
        cancelExpire
      );
    }

    // ── 2. Cửa sổ bám: hôm nay + hôm qua (≥ epoch) — KHÔNG cắt Cancel sau 07:30 ──
    // (Lỗi cũ: date IN getCancelWatchDates() → mất VN1806 ngày 19 khi sang 20)
    let keepFrom = addDaysYmdStr(todayDb, -1);
    if (keepFrom < MONITOR_EPOCH_DATE) keepFrom = MONITOR_EPOCH_DATE;
    const trackingRows = await db.all(
      `SELECT * FROM fms_temp_import_exports
       WHERE is_warned = 0 AND date >= ? AND date >= ?
       ORDER BY id`,
      MONITOR_EPOCH_DATE,
      keepFrom
    );
    if (!trackingRows.length) return;

    const { isSkyOneEnabled, targetGroupId } = await getImportExportNotifyTargets(db);

    // Tập chuyến VNA hiện tại (để self-heal Cancel)
    const vnaFltSet = new Set();
    for (const f of fmsFlights || []) {
      if (f && f.FLIGHTNO) vnaFltSet.add(String(f.FLIGHTNO).toUpperCase().replace(/\s+/g, ''));
    }

    for (const track of trackingRows) {
      const trackAcReg = String(track.ac_reg || '').trim().toUpperCase();
      const oldFlt = String(track.old_flight_no || '').toUpperCase().replace(/\s+/g, '');
      const mType = String(track.monitor_type || '');

      // Chỉ VN (NKT synthetic VNNKT vẫn startsWith VN)
      if (oldFlt && !isVnAirlineFlightNo(oldFlt) && mType !== 'TECHNICAL_HAN') {
        await db.run('DELETE FROM fms_temp_import_exports WHERE id = ?', track.id);
        continue;
      }

      // ── Self-heal theo loại (không lẫn) ──────────────────────────────────
      if (mType === 'CANCELLED_FUELED') {
        // Chỉ khi đang quét đúng ngày monitor: chuyến cũ quay lại VNA → Cancel giả
        // (không dùng list ngày khác — VN1806 ngày 20 trên tàu khác ≠ hủy ngày 19)
        if (String(targetDate) === String(track.date) && vnaFltSet.has(oldFlt)) {
          log(`[Cancel] Self-heal: ${oldFlt} đã có lại trên VNA ngày ${track.date} → xóa #${track.id}`);
          await db.run('DELETE FROM fms_temp_import_exports WHERE id = ?', track.id);
          continue;
        }
      }
      if (mType === 'DOMESTIC_TO_INTL' || mType === 'INTL_TO_DOMESTIC') {
        // Chuyến cũ vẫn gắn đúng tàu đang bám → không còn “đổi tàu”
        try {
          const liveOld = await db.get(
            `SELECT ac_reg FROM fms_flights_live
             WHERE date = ? AND UPPER(REPLACE(REPLACE(flight_no,' ',''),'-','')) = ? LIMIT 1`,
            track.date,
            oldFlt.replace(/[\s\-_.]/g, '')
          );
          if (liveOld && liveOld.ac_reg && acRegsMatch(liveOld.ac_reg, trackAcReg)) {
            log(`[Giám sát] Self-heal đổi tàu: ${oldFlt} vẫn tàu ${liveOld.ac_reg} → xóa #${track.id}`);
            await db.run('DELETE FROM fms_temp_import_exports WHERE id = ?', track.id);
            continue;
          }
        } catch (_) { /* ignore */ }
      }

      // ── Đúng 1 chặng tiếp theo: gần nhất theo (ngày, giờ) — không ưu tiên QT ──
      let candidates = await collectNextFlightCandidates(db, track, fmsFlights, targetDate);
      // Gắn _date cho payload đang quét
      candidates = candidates.map((f) => ({
        ...f,
        _date: f._date || f.date || targetDate
      }));

      let next = null;
      let decision = { action: 'wait' };
      // Bỏ lần lượt nếu verify fail — nhưng mỗi lần vẫn lấy “gần nhất” còn lại
      for (let attempt = 0; attempt < 8; attempt++) {
        const cand = findNextMonitorFlight(candidates, track, targetDate, {
          requireAfterOldTime: true
        });
        if (!cand) break;

        let liveRejected = false;
        try {
          const vdList = [...new Set([cand.fDate, track.date, targetDate].filter(Boolean))];
          for (const vd of vdList) {
            const liveCheck = await db.get(
              `SELECT ac_reg, route, time_fuel, time_dep FROM fms_flights_live
               WHERE date = ? AND UPPER(REPLACE(REPLACE(flight_no,' ',''),'-','')) = ? LIMIT 1`,
              vd,
              String(cand.fltNo).replace(/[\s\-_.]/g, '')
            );
            if (!liveCheck || !liveCheck.ac_reg) continue;
            const liveAc = normalizeAcRegKey(liveCheck.ac_reg);
            if (!acRegsMatch(liveCheck.ac_reg, trackAcReg)) {
              if (liveAc.length < 5) {
                // ac mơ hồ trên Skypec — tin VNA/presence
                break;
              }
              log(`[Giám sát] Bỏ ${cand.fltNo}: Skypec ${liveCheck.ac_reg} ≠ ${trackAcReg}`);
              liveRejected = true;
              break;
            }
            if (liveCheck.route) {
              const { origin, dest } = parseRouteEndpoints(liveCheck.route);
              if (origin && dest) {
                cand.route = `${origin}-${dest}`;
                cand.isIntl = isDepartingIntlRoute(cand.route);
              }
            }
            // Cùng ngày monitor: chặn gán ngược giờ
            if (String(vd) === String(track.date) && cand.fDate === track.date) {
              const oldM = parseHhMmToMinutes(track.old_time);
              const liveM = parseHhMmToMinutes(liveCheck.time_dep);
              const liveMf = liveM != null ? liveM : parseHhMmToMinutes(liveCheck.time_fuel);
              if (oldM != null && liveMf != null && liveMf < oldM) {
                liveRejected = true;
                break;
              }
            }
            break;
          }
        } catch (verErr) {
          console.error('[Giám sát] Lỗi verify next:', verErr.message);
        }

        if (liveRejected) {
          candidates = candidates.filter(
            (f) => String(f.FLIGHTNO || '').toUpperCase().replace(/\s+/g, '') !== cand.fltNo
          );
          continue;
        }

        // 1 chặng gần nhất → quyết định 1 lần theo loại monitor
        const dec = decideMonitorAction(track, cand);
        next = cand;
        decision = dec;
        break;
      }

      if (!next || decision.action === 'wait') continue;

      if (decision.action === 'close') {
        log(`[Giám sát] Đóng #${track.id} ${mType} ${trackAcReg}: ${decision.kind} → ${next.fltNo} (${next.route}) @${next.fDate || ''} ${next.ft != null ? Math.floor(next.ft / 60) + ':' + String(next.ft % 60).padStart(2, '0') : ''}`);
        await db.run(
          `UPDATE fms_temp_import_exports
           SET new_flight_no = ?, new_route = ?, is_warned = 2, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          next.fltNo, next.route, track.id
        );
        continue;
      }

      if (decision.action === 'warn') {
        // Chỉ cảnh báo 1 lần (is_warned: 0 → 1)
        const warningMsg = buildMonitorWarningMessage(track, next, decision.kind);
        if (!warningMsg) continue;
        log(`[Giám sát] Cảnh báo #${track.id} ${mType} ${trackAcReg} → ${next.fltNo} (${next.route}) [${decision.kind}]`);
        await db.run(
          `UPDATE fms_temp_import_exports
           SET new_flight_no = ?, new_route = ?, is_warned = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND is_warned = 0`,
          next.fltNo, next.route, track.id
        );
        sendImportExportZalo(targetGroupId, isSkyOneEnabled, warningMsg, `Giám sát ${trackAcReg}`);
      }
    }
  } catch (err) {
    console.error('[Tạm nhập - Tái xuất] Lỗi kiểm tra cảnh báo chéo:', err.message);
  }
}

let isSyncing = false;

// Thực hiện đồng bộ hóa toàn bộ chuyến bay trong lịch trực từ FMS
async function syncFMSData(forceDate = null, forceShift = null) {
  if (isSyncing) {
    log('Chu kỳ quét trước vẫn đang chạy. Bỏ qua chu kỳ này để tránh tranh chấp dữ liệu.');
    return;
  }
  isSyncing = true;
  log(`Bắt đầu chu kỳ quét tải dầu FMS (ForceDate: ${forceDate || 'Không'}, ForceShift: ${forceShift || 'Không'})...`);
  try {
    const db = await getDb();
    const todayDb = getVietnamDbDateStr();

    // Dọn dẹp dữ liệu lịch bay cũ — GIỮ HÔM QUA + HÔM NAY
    // (Ca đêm bắt đầu hôm qua 23h → 07h30 sáng nay vẫn cần lịch date = hôm qua)
    try {
      const keepFromParts = String(todayDb).split('-').map(Number);
      let keepFromStr = todayDb;
      if (keepFromParts.length === 3 && keepFromParts.every(n => Number.isFinite(n))) {
        const kd = new Date(Date.UTC(keepFromParts[0], keepFromParts[1] - 1, keepFromParts[2]));
        kd.setUTCDate(kd.getUTCDate() - 1); // giữ từ hôm qua
        keepFromStr = `${kd.getUTCFullYear()}-${String(kd.getUTCMonth() + 1).padStart(2, '0')}-${String(kd.getUTCDate()).padStart(2, '0')}`;
      }

      // Xóa lịch trực cũ hơn "hôm qua" (không xóa lịch ca đêm ngày hôm qua)
      const deletedRows = await db.run('DELETE FROM fms_schedules WHERE date < ?', keepFromStr);
      if (deletedRows && deletedRows.changes > 0) {
        log(`[Dọn dẹp DB] Đã xóa ${deletedRows.changes} dòng lịch bay cũ trước ${keepFromStr} (giữ từ hôm qua trở đi).`);
      }

      // Tải dầu FMS: giữ từ hôm qua (khớp ca đêm / fms_date)
      const deletedOrders = await db.run("DELETE FROM fms_fuel_orders WHERE flight_no LIKE '%_%' AND substr(flight_no, instr(flight_no, '_') + 1) < ?", keepFromStr);
      if (deletedOrders && deletedOrders.changes > 0) {
        log(`[Dọn dẹp DB] Đã xóa ${deletedOrders.changes} bản ghi tải dầu FMS cũ trước ${keepFromStr}.`);
      }

      // Đọc cấu hình thời gian giám sát Tạm nhập - Tái xuất
      const durationSetting = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_duration'");
      const durationVal = durationSetting ? durationSetting.value : '24h';
      
      // Xóa toàn bộ monitor trước mốc 19/07/2026 (NKT lịch sử / spam cũ)
      const delEpoch = await db.run(
        'DELETE FROM fms_temp_import_exports WHERE date < ?',
        MONITOR_EPOCH_DATE
      );
      if (delEpoch && delEpoch.changes > 0) {
        log(`[Dọn dẹp DB] Đã xóa ${delEpoch.changes} bản ghi giám sát trước mốc ${MONITOR_EPOCH_DATE}.`);
      }

      // Xóa INTL_TO_DOMESTIC sai: route không có dạng XXX-YYY (VD "HAN") hoặc trùng NKT cùng tàu/ngày/kg
      const badIntl = await db.all(
        `SELECT id, ac_reg, date, old_route, fuel_order FROM fms_temp_import_exports
         WHERE monitor_type = 'INTL_TO_DOMESTIC' AND is_warned < 2`
      );
      let purgedDup = 0;
      for (const r of badIntl || []) {
        const rt = String(r.old_route || '').toUpperCase().replace(/\s+/g, '');
        const badRoute = !rt || rt === '-' || !rt.includes('-') || rt === 'HAN';
        const tech = await db.get(
          `SELECT id FROM fms_temp_import_exports
           WHERE monitor_type = 'TECHNICAL_HAN' AND UPPER(TRIM(ac_reg)) = UPPER(TRIM(?))
             AND date = ? AND is_warned < 2 AND ABS(COALESCE(fuel_order,0) - ?) < 2`,
          r.ac_reg, r.date, r.fuel_order || 0
        );
        if (badRoute || tech) {
          await db.run('DELETE FROM fms_temp_import_exports WHERE id = ?', r.id);
          purgedDup++;
        }
      }
      if (purgedDup > 0) {
        log(`[Dọn dẹp DB] Đã xóa ${purgedDup} monitor INTL_TO_DOMESTIC sai/trùng NKT.`);
      }

      // Chỉ giám sát tái xuất chuyến VN — xóa VU, 9G, hãng QT còn sót
      const allMonRows = await db.all(
        'SELECT id, old_flight_no FROM fms_temp_import_exports'
      );
      let purgedNonVn = 0;
      for (const r of allMonRows || []) {
        if (!isVnAirlineFlightNo(r.old_flight_no)) {
          await db.run('DELETE FROM fms_temp_import_exports WHERE id = ?', r.id);
          purgedNonVn++;
        }
      }
      if (purgedNonVn > 0) {
        log(`[Dọn dẹp DB] Đã xóa ${purgedNonVn} monitor không phải chuyến VN (VU/9G/hãng QT).`);
      }

      // Chỉ giữ cửa sổ ngày theo dõi (+ đã đóng gần đây); không ôm TECHNICAL vô hạn nhiều ngày
      const watch = getCancelWatchDates();
      const keepDates = watch.length ? watch : [todayDb];
      const ph = keepDates.map(() => '?').join(',');
      const delOld = await db.run(
        `DELETE FROM fms_temp_import_exports
         WHERE date >= ? AND date NOT IN (${ph}) AND is_warned = 2`,
        MONITOR_EPOCH_DATE,
        ...keepDates
      );
      // Bản ghi mở ngoài cửa sổ ngày → đóng (không hiển thị/truy xuất ngày cũ)
      await db.run(
        `UPDATE fms_temp_import_exports SET is_warned = 2, updated_at = CURRENT_TIMESTAMP
         WHERE date >= ? AND date NOT IN (${ph}) AND is_warned < 2`,
        MONITOR_EPOCH_DATE,
        ...keepDates
      );

      if (delOld && delOld.changes > 0) {
        log(`[Dọn dẹp DB] Đã dọn monitor ngoài cửa sổ ngày (${durationVal}): ${delOld.changes} dòng.`);
      }
    } catch (cleanupErr) {
      console.error('[Dọn dẹp DB] Lỗi khi dọn dẹp dữ liệu cũ:', cleanupErr.message);
    }

    let targetDates = [];
    if (forceDate) {
      const selectedDateStr = String(forceDate).trim();
      // Ca tối (evening) / ca đêm (night): quét FMS ngày D + ngày D+1
      // (đoạn 00:00–07:30 lấy dữ liệu FMS ngày hôm sau)
      const overnight = forceShift === 'evening' || forceShift === 'night';
      if (overnight) {
        const parts = selectedDateStr.split('-').map(Number);
        let nextDayStr = selectedDateStr;
        if (parts.length === 3 && parts.every(n => Number.isFinite(n))) {
          const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
          d.setUTCDate(d.getUTCDate() + 1);
          nextDayStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        }
        targetDates = [selectedDateStr, nextDayStr];
        log(`[Ca tối] Quét FMS 2 ngày: ${selectedDateStr} (19:30–23:59) + ${nextDayStr} (00:00–07:30)`);
      } else {
        targetDates = [selectedDateStr];
      }
    } else {
      // Tự động: mọi fms_date đã gán khi import (ca ngày = D, ca tối sáng sớm = D+1)
      const dateRows = await db.all('SELECT DISTINCT COALESCE(fms_date, date) as target_date FROM fms_schedules');
      targetDates = dateRows.map(r => r.target_date).filter(Boolean);

      if (targetDates.length === 0) {
        targetDates = [todayDb];
      }
    }
    
    log(`Các ngày sẽ thực hiện quét FMS: ${targetDates.join(', ')}`);

    // 2. Sử dụng cookie từ cache bộ nhớ, hoặc đọc từ DB, hoặc tiến hành đăng nhập mới
    let activeCookie = cachedFmsCookie;
    if (!activeCookie) {
      log('Chưa có cookie trong cache bộ nhớ. Đang kiểm tra Database...');
      activeCookie = await getStoredFmsCookie(db);
      if (activeCookie) {
        cachedFmsCookie = activeCookie; // Lưu lại vào memory cache
      }
    }

    if (!activeCookie) {
      log('Chưa có cookie hợp lệ. Tiến hành đăng nhập FMS mới...');
      activeCookie = await loginFMS();
    } else {
      log('Sử dụng cookie FMS hợp lệ từ Database/Cache bộ nhớ.');
    }

    // Đọc cấu hình tắt/bật cho từng loại thông báo từ DB
    const nStandby = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_new_standby'");
    const nFuel = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_new_fuel_order'");
    const nStandbyChg = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_standby_changed'");
    const nFuelChg = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_fuel_order_changed'");
    const nAc = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_ac_reg_changed'");
    const nGate = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_gate_changed'");
    const nEtd = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_etd_changed'");

    const notifyNewStandby = nStandby ? (nStandby.value === 'true') : true;
    const notifyNewFuelOrder = nFuel ? (nFuel.value === 'true') : true;
    const notifyStandbyChanged = nStandbyChg ? (nStandbyChg.value === 'true') : true;
    const notifyFuelOrderChanged = nFuelChg ? (nFuelChg.value === 'true') : true;
    const notifyAcRegChanged = nAc ? (nAc.value === 'true') : true;
    const notifyGateChanged = nGate ? (nGate.value === 'true') : true;
    const notifyEtdChanged = nEtd ? (nEtd.value === 'true') : true;

    for (const targetDate of targetDates) {
      // Lấy danh sách các chuyến bay cần theo dõi của ngày đang xét theo ngày bay thực tế FMS (fms_date)
      const schedules = await db.all('SELECT DISTINCT flight_no, time_fuel, time_dep, time_arr FROM fms_schedules WHERE COALESCE(fms_date, date) = ?', targetDate);

      // Helper: tải FMS VNA cho ngày (dùng chung Cancel + quét fuel)
      const loadVnaFlightsForDate = async () => {
        const targetFmsDateStr = convertDbDateToFmsDate(targetDate);
        let list = [];
        try {
          list = await fetchFMSData(targetFmsDateStr, activeCookie);
          if (list.length === 0) {
            log(`[Cảnh báo] Tải về 0 chuyến bay từ FMS cho ngày ${targetFmsDateStr}. Có khả năng cookie hết hạn âm thầm. Tiến hành đăng nhập lại để làm mới cookie...`);
            await db.run("DELETE FROM settings WHERE key = 'fms_cookie'");
            await db.run("DELETE FROM settings WHERE key = 'fms_cookie_created_at'");
            cachedFmsCookie = null;
            activeCookie = await loginFMS();
            list = await fetchFMSData(targetFmsDateStr, activeCookie);
          }
        } catch (err) {
          log(`Cookie FMS bị lỗi hoặc hết hạn. Đang tiến hành đăng nhập lại... Chi tiết lỗi: ${err.message || JSON.stringify(err)}`);
          await db.run("DELETE FROM settings WHERE key = 'fms_cookie'");
          await db.run("DELETE FROM settings WHERE key = 'fms_cookie_created_at'");
          cachedFmsCookie = null;
          activeCookie = await loginFMS();
          list = await fetchFMSData(targetFmsDateStr, activeCookie);
        }
        return list;
      };

      // Không có lịch SkyEyes: chỉ quét Cancel nếu trong cửa sổ “trong ngày”
      if (schedules.length === 0) {
        if (isCancelWatchDate(targetDate)) {
          try {
            const vnaOnly = await loadVnaFlightsForDate();
            log(`[Ngày ${targetDate}] Không lịch SkyEyes — quét Cancel sát trong ngày (VNA ${vnaOnly.length}).`);
            await detectCancelledFueledFlights(db, targetDate, vnaOnly);
            await checkTempImportExportAlerts(db, targetDate, vnaOnly);
          } catch (e) {
            console.error(`[Cancel] Ngày ${targetDate} (no schedule):`, e.message);
          }
        }
        continue;
      }

      // Lọc theo ca — khớp nguyên tắc nghiệp vụ
      // day: 07:30–19:30 | evening/night (ca tối): 19:30–23:59 HOẶC 00:00–07:30
      let filteredSchedules = schedules;
      if (forceShift && forceShift !== 'all') {
        filteredSchedules = schedules.filter(s => {
          const timeStr = s.time_fuel || s.time_dep || s.time_arr || '';
          if (!timeStr || timeStr === '-') {
            return forceShift === 'evening' || forceShift === 'night';
          }
          
          try {
            const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
            if (!match) return forceShift === 'evening' || forceShift === 'night';
            
            const hour = parseInt(match[1], 10);
            const minute = parseInt(match[2], 10);
            const minutes = hour * 60 + minute;
            
            const m_0730 = 7 * 60 + 30;
            const m_1930 = 19 * 60 + 30;
            
            if (forceShift === 'day') {
              return minutes >= m_0730 && minutes < m_1930;
            }
            if (forceShift === 'evening' || forceShift === 'night') {
              // Ca tối full: tối muộn cùng ngày + sáng sớm ngày FMS tiếp theo
              return minutes >= m_1930 || minutes < m_0730;
            }
          } catch (e) {
            console.error('[Backend Shift Filter Error]', e.message);
          }
          return false;
        });
      }

      if (filteredSchedules.length === 0) {
        log(`[Ngày ${targetDate}] Không có chuyến bay nào khớp với ca trực ${forceShift}. Bỏ qua.`);
        continue;
      }

      const flightNumbers = filteredSchedules.map(s => s.flight_no.toUpperCase().replace(/\s+/g, ''));
      log(`[Ngày ${targetDate}] Danh sách chuyến bay cần theo dõi (${flightNumbers.length} chuyến): ${flightNumbers.join(', ')}`);

      const fmsFlights = await loadVnaFlightsForDate();
      log(`[Ngày ${targetDate}] Đã tải danh sách chuyến bay từ FMS, tổng cộng ${fmsFlights.length} chuyến.`);

      // Cancel: chỉ sát trong ngày (VN nội địa, ≥40p sau nạp, mất VNA)
      if (isCancelWatchDate(targetDate)) {
        try {
          await detectCancelledFueledFlights(db, targetDate, fmsFlights);
        } catch (cancelErr) {
          console.error('[Cancel] Lỗi khi quét:', cancelErr.message);
        }
      }

      // Kiểm tra và cảnh báo Tạm nhập - Tái xuất tàu bay (gồm sau Cancel)
      await checkTempImportExportAlerts(db, targetDate, fmsFlights);

      // Lọc các chuyến bay khớp với lịch trực của ngày này
      // Rà soát chi tiết FMS VNA: chỉ chuyến VN (VNA). Bỏ 9G, VU, hãng ngoài.
      const matchedFlights = fmsFlights.filter(f => {
        if (!f.FLIGHTNO) return false;
        const cleanFltNo = f.FLIGHTNO.toUpperCase().replace(/\s+/g, '');
        if (!flightNumbers.includes(cleanFltNo)) return false;
        if (!isVnAirlineFlightNo(cleanFltNo)) return false;
        const route = `${f.DEP_AP_SCHED || ''}-${f.ARR_AP_SCHED || ''}`.toUpperCase();
        // Không quét chi tiết chuyến quốc tế cho pipeline Cancel/FO nội địa VNA (vẫn có thể có VN QT — user yêu cầu bỏ QT)
        if (route && route !== '-' && isDepartingIntlRoute(route)) return false;
        if (route && route !== '-' && !isDomesticRoute(route) && route !== 'HAN-HAN') return false;
        return true;
      });

      log(`[Ngày ${targetDate}] Khớp FMS VNA (chỉ VN nội địa): ${matchedFlights.length} chuyến (lịch gốc ${flightNumbers.length}, bỏ 9G/VU/QT).`);
      if (matchedFlights.length === 0) continue;

      // Map lịch trực theo flight_no để gắn cặp nạp vào cảnh báo hãng
      const scheduleByFlight = {};
      const fullSchedRows = await db.all(
        'SELECT flight_no, crew_info, truck_no, gate, driver_name, operator_name FROM fms_schedules WHERE COALESCE(fms_date, date) = ?',
        targetDate
      );
      fullSchedRows.forEach(s => {
        const key = String(s.flight_no || '').toUpperCase().replace(/\s+/g, '');
        if (key) scheduleByFlight[key] = s;
      });

      // Cảnh báo sai tên hãng (ký hiệu chuyến vs CARRIER FMS)
      await checkAirlineNameMismatchAlerts(db, targetDate, matchedFlights, scheduleByFlight);

      // Quét chi tiết tải dầu SONG SONG (Promise.all) cho các chuyến bay trùng khớp của ngày này
      log(`[Ngày ${targetDate}] Bắt đầu quét song song chi tiết tải dầu cho các chuyến bay...`);
      const promises = matchedFlights.map(async (flt) => {
        const cleanFltNo = flt.FLIGHTNO.toUpperCase().replace(/\s+/g, '');
        const legNo = flt.LEG_NO;

        try {
          log(`[Bắt đầu quét] Chuyến bay: ${cleanFltNo} (LEG_NO: ${legNo})`);
          const detail = await fetchFlightDetail(legNo, activeCookie);

          // Xác định trạng thái tải dầu
          const hasOrder = parseInt(detail.fuel_order) > 0 || parseInt(detail.standby_fuel) > 0;
          const status = hasOrder ? 'Đã có số liệu' : 'Chờ cập nhật';

          const oldOrder = await db.get('SELECT status, fuel_order, standby_fuel, ac_reg, gate, etd, warn_ac_reg, warn_standby, warn_fuel_order, warn_etd, warn_updated_at, old_ac_reg, old_standby_fuel, old_fuel_order, old_etd FROM fms_fuel_orders WHERE flight_no = ?', cleanFltNo + '_' + targetDate);

          // Lấy lịch trực để so sánh bến đỗ trước khi check thay đổi
          const sched = await db.get('SELECT crew_info, truck_no, gate, time_arr, time_dep, time_fuel, crew_zalo_uids, notify_type, driver_name, operator_name FROM fms_schedules WHERE flight_no = ? AND COALESCE(fms_date, date) = ?', cleanFltNo, targetDate);

          const cleanACREG = flt.ACREG ? String(flt.ACREG).trim() : '';
          const acTypeStr = flt.ACTYPE ? String(flt.ACTYPE).trim() : '-';
          const oldStandby = oldOrder ? (parseInt(oldOrder.standby_fuel) || 0) : 0;
          const oldFuelOrder = oldOrder ? (parseInt(oldOrder.fuel_order) || 0) : 0;
          let newStandby = parseInt(String(detail.standby_fuel || '0').replace(/[^\d]/g, ''), 10) || 0;
          let newFuelOrder = parseInt(String(detail.fuel_order || '0').replace(/[^\d]/g, ''), 10) || 0;

          // Không ghi đè kg về 0 khi FMS tạm trống / đổi tàu nhiễu (tránh spam "CHÍNH THỨC MỚI" lặp)
          // Giữ số kg đã biết nếu bản ghi mới = 0 nhưng trước đó đã có số liệu & đã báo
          if (oldOrder && (oldOrder.warn_fuel_order || 0) === 1 && newFuelOrder <= 0 && oldFuelOrder > 0) {
            newFuelOrder = oldFuelOrder;
            detail.fuel_order = String(oldFuelOrder);
          }
          if (oldOrder && (oldOrder.warn_standby || 0) === 1 && newStandby <= 0 && oldStandby > 0) {
            newStandby = oldStandby;
            detail.standby_fuel = String(oldStandby);
          }

          const oldGate = oldOrder ? String(oldOrder.gate || '').trim() : '';
          const newGate = sched ? String(sched.gate || '').trim() : '';
          const isGateChanged = !!(oldOrder && oldGate && newGate && oldGate !== newGate);

          const newEtd = convertUtcToVnTime(flt.ETD);
          const oldEtd = oldOrder ? String(oldOrder.etd || '').trim() : '';
          const isEtdChanged = !!(oldOrder && oldEtd && newEtd && oldEtd !== String(newEtd).trim());

          const prevWarnedFuel = oldOrder ? (oldOrder.warn_fuel_order || 0) : 0;
          const prevWarnedStandby = oldOrder ? (oldOrder.warn_standby || 0) : 0;
          const prevWarnedAc = oldOrder ? (oldOrder.warn_ac_reg || 0) : 0;
          const prevWarnedEtd = oldOrder ? (oldOrder.warn_etd || 0) : 0;
          // Gate: dùng last gate trong DB — chỉ báo khi đổi thật
          // warn_gate không có cột riêng → so sánh giá trị là đủ

          // --- Phát hiện sự kiện (RAW) ---
          // "Mới": lần đầu có số >0 và CHƯA từng báo (warn_*=0). Đã báo rồi + FMS về 0 rồi lên lại → KHÔNG báo "mới" nữa.
          const isNewStandby = newStandby > 0 && oldStandby <= 0 && prevWarnedStandby === 0;
          const isNewFuelOrder = newFuelOrder > 0 && oldFuelOrder <= 0 && prevWarnedFuel === 0;
          const isStandbyChanged = oldStandby > 0 && newStandby > 0 && oldStandby !== newStandby;
          const isFuelOrderChanged = oldFuelOrder > 0 && newFuelOrder > 0 && oldFuelOrder !== newFuelOrder;
          const isAcRegChanged = !!(
            oldOrder &&
            oldOrder.ac_reg &&
            cleanACREG &&
            String(oldOrder.ac_reg).trim().toUpperCase().replace(/\s+/g, '') !==
              cleanACREG.toUpperCase().replace(/\s+/g, '')
          );

          // Áp dụng settings bật/tắt
          let triggerNewStandby = isNewStandby && notifyNewStandby;
          let triggerNewFuelOrder = isNewFuelOrder && notifyNewFuelOrder;
          let triggerStandbyChanged = isStandbyChanged && notifyStandbyChanged;
          let triggerFuelOrderChanged = isFuelOrderChanged && notifyFuelOrderChanged;
          let triggerAcRegChanged = isAcRegChanged && notifyAcRegChanged;
          let triggerGateChanged = isGateChanged && notifyGateChanged;
          let triggerEtdChanged = isEtdChanged && notifyEtdChanged;

          // Lần import đầu (chưa có oldOrder): không bắn Zalo
          if (!oldOrder) {
            triggerNewStandby = false;
            triggerNewFuelOrder = false;
            triggerStandbyChanged = false;
            triggerFuelOrderChanged = false;
            triggerAcRegChanged = false;
            triggerGateChanged = false;
            triggerEtdChanged = false;
          }

          // Danh sách sự kiện theo thứ tự ưu tiên — MỖI sự kiện 1 tin, CHỈ field liên quan
          const eventQueue = [];
          if (triggerNewFuelOrder) eventQueue.push('new_fuel');
          if (triggerNewStandby) eventQueue.push('new_standby');
          if (triggerFuelOrderChanged) eventQueue.push('fuel_changed');
          if (triggerStandbyChanged) eventQueue.push('standby_changed');
          if (triggerAcRegChanged) eventQueue.push('ac_changed');
          if (triggerGateChanged) eventQueue.push('gate_changed');
          if (triggerEtdChanged) eventQueue.push('etd_changed');

          const shouldNotify = eventQueue.length > 0;

          // --- Resolve tag Zalo: BẮT BUỘC cố gắng tag cả Lái + NV ---
          const rawDr = sched && sched.driver_name ? String(sched.driver_name).trim() : '';
          const rawOp = sched && sched.operator_name ? String(sched.operator_name).trim() : '';
          const stripAccents = (s) => String(s || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd').replace(/Đ/g, 'D')
            .toUpperCase().replace(/\s+/g, ' ').trim();
          const drName = stripAccents(rawDr);
          const opName = stripAccents(rawOp);

          let driverCrewPart = rawDr || '-';
          let operatorCrewPart = rawOp || '-';
          let driverMentionInfo = null;
          let operatorMentionInfo = null;

          if (shouldNotify) {
            try {
              const dbMappings = await db.all('SELECT schedule_name, zalo_uid, zalo_name FROM zalo_user_mappings');
              const mappingMap = {};
              dbMappings.forEach(m => {
                const key = stripAccents(m.schedule_name);
                if (key) {
                  mappingMap[key] = { uid: m.zalo_uid, name: m.zalo_name || m.schedule_name };
                }
              });
              const resolveOne = (normKey) => {
                if (!normKey || normKey === '-') return null;
                if (mappingMap[normKey]) return mappingMap[normKey];
                // Khớp token cuối (tên) + độ dài hợp lý
                const tokens = normKey.split(' ').filter(Boolean);
                const last = tokens[tokens.length - 1] || '';
                for (const [k, v] of Object.entries(mappingMap)) {
                  if (k === normKey) return v;
                  if (k.includes(normKey) || normKey.includes(k)) return v;
                  const kt = k.split(' ').filter(Boolean);
                  if (last && kt[kt.length - 1] === last && Math.abs(kt.length - tokens.length) <= 2) return v;
                }
                return null;
              };
              if (drName) {
                const mapInfo = resolveOne(drName);
                if (mapInfo) {
                  driverCrewPart = `@${mapInfo.name}`;
                  driverMentionInfo = { uid: mapInfo.uid, tagLabel: `@${mapInfo.name}` };
                }
              }
              if (opName) {
                const mapInfo = resolveOne(opName);
                if (mapInfo) {
                  operatorCrewPart = `@${mapInfo.name}`;
                  operatorMentionInfo = { uid: mapInfo.uid, tagLabel: `@${mapInfo.name}` };
                }
              }
            } catch (mappingErr) {
              console.error('[Mapping Fetch Error]', mappingErr.message);
            }
          }

          // Luôn hiển thị cả Lái + NV (tag nếu có mapping)
          const crewInfoVal = (rawDr || rawOp)
            ? [
                rawDr ? `Lái: ${driverCrewPart}` : null,
                rawOp ? `NV: ${operatorCrewPart}` : null
              ].filter(Boolean).join(' | ')
            : (sched ? (sched.crew_info || '-') : '-');

          const formatNumber = (val) => {
            const num = parseInt(String(val || '0').replace(/[^\d]/g, ''), 10);
            return isNaN(num) ? '0' : num.toLocaleString('vi-VN');
          };
          const notifyTimeStr = getVietnamDateTimeStr();
          const timeFuelStr = sched && sched.time_fuel ? sched.time_fuel : '-';

          /**
           * Tin nhắn THEO LOẠI SỰ KIỆN — chỉ field liên quan (không kèm field khác).
           * new_fuel: chính thức mới → không standby/gate/xe
           * gate: chỉ vị trí → không tải dầu
           * ac: chỉ tàu → không tải/đỗ
           */
          const buildFocusedMessage = (eventType) => {
            const lines = [];
            const pushCrew = () => {
              if (crewInfoVal && crewInfoVal !== '-') {
                lines.push(`👥 Cặp: ${crewInfoVal}${timeFuelStr !== '-' ? ` | Giờ nạp: ${timeFuelStr}` : ''}`);
              }
            };
            const pushAc = () => {
              lines.push(`🛩️ Tàu bay: ${cleanACREG || '-'} (Loại: ${acTypeStr})`);
            };
            const pushFlight = (withAc = true) => {
              lines.push(withAc
                ? `✈️ Chuyến: ${cleanFltNo} - ${cleanACREG || '-'}`
                : `✈️ Chuyến: ${cleanFltNo}`);
            };
            const pushFooter = () => {
              lines.push(`📢 Giờ thông báo: ${notifyTimeStr}`);
            };

            if (eventType === 'new_fuel') {
              lines.push('⛽ [FMS BÁO TẢI DẦU CHÍNH THỨC MỚI]');
              pushFlight(true);
              pushCrew();
              pushAc();
              lines.push(`⛽ Chính thức: ${formatNumber(newFuelOrder)} kg`);
              pushFooter();
              return lines.join('\n');
            }
            if (eventType === 'new_standby') {
              lines.push('🔔 [FMS BÁO TẢI DẦU STANDBY MỚI]');
              pushFlight(true);
              pushCrew();
              pushAc();
              lines.push(`⛽ Standby: ${formatNumber(newStandby)} kg`);
              pushFooter();
              return lines.join('\n');
            }
            if (eventType === 'fuel_changed') {
              lines.push('🔄 [FMS CẬP NHẬT TẢI DẦU CHÍNH THỨC]');
              pushFlight(true);
              pushCrew();
              lines.push(`⛽ Chính thức: ${formatNumber(oldFuelOrder)} → ${formatNumber(newFuelOrder)} kg`);
              pushFooter();
              return lines.join('\n');
            }
            if (eventType === 'standby_changed') {
              lines.push('🔄 [FMS CẬP NHẬT TẢI DẦU STANDBY]');
              pushFlight(true);
              pushCrew();
              lines.push(`⛽ Standby: ${formatNumber(oldStandby)} → ${formatNumber(newStandby)} kg`);
              pushFooter();
              return lines.join('\n');
            }
            if (eventType === 'ac_changed') {
              lines.push('🛩️ [FMS CẢNH BÁO THAY ĐỔI TÀU BAY]');
              lines.push(`✈️ Chuyến: ${cleanFltNo}`);
              pushCrew();
              lines.push(`🛩️ Tàu cũ: ${String(oldOrder.ac_reg || '-').trim()}`);
              lines.push(`🛩️ Tàu mới: ${cleanACREG || '-'} (Loại: ${acTypeStr})`);
              pushFooter();
              return lines.join('\n');
            }
            if (eventType === 'gate_changed') {
              lines.push('📍 [FMS CẢNH BÁO THAY ĐỔI VỊ TRÍ ĐỖ]');
              pushFlight(true);
              pushCrew();
              lines.push(`📍 Vị trí đỗ: ${oldGate || '-'} → ${newGate || '-'}`);
              pushFooter();
              return lines.join('\n');
            }
            if (eventType === 'etd_changed') {
              lines.push('🔄 [FMS THAY ĐỔI GIỜ BAY ETD]');
              pushFlight(true);
              pushCrew();
              lines.push(`⏰ ETD cũ: ${oldEtd || '-'}`);
              lines.push(`⏰ ETD mới: ${newEtd || '-'}`);
              lines.push(`Yêu cầu ĐIỀU HÀNH & Cặp tra nạp check chéo thông tin.`);
              pushFooter();
              return lines.join('\n');
            }
            return '';
          };

          const sendOneZalo = async (msg) => {
            if (!msg) return;
            const notifySetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_notify_enabled'");
            const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
            const isSkyOneEnabled = notifySetting ? (notifySetting.value === 'true') : false;
            const targetGroupId = groupSetting ? groupSetting.value : null;
            const notifyType = sched ? (sched.notify_type || 1) : 1;
            const crewZaloUidsStr = sched ? (sched.crew_zalo_uids || '') : '';
            const uids = crewZaloUidsStr.split(',').map(uid => uid.trim()).filter(Boolean);

            if (isSkyOneEnabled) {
              if ((notifyType === 1 || notifyType === 3) && targetGroupId) {
                const groupMentions = [];
                if (driverMentionInfo) {
                  const pos = msg.indexOf(driverMentionInfo.tagLabel);
                  if (pos !== -1) {
                    groupMentions.push({
                      pos,
                      uid: driverMentionInfo.uid,
                      len: driverMentionInfo.tagLabel.length
                    });
                  }
                }
                if (operatorMentionInfo) {
                  const pos = msg.indexOf(operatorMentionInfo.tagLabel);
                  if (pos !== -1) {
                    groupMentions.push({
                      pos,
                      uid: operatorMentionInfo.uid,
                      len: operatorMentionInfo.tagLabel.length
                    });
                  }
                }
                // Fallback: nếu chưa map Zalo nhưng có tên — vẫn hiện chữ (đã trong msg)
                const groupIds = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
                for (const id of groupIds) {
                  try {
                    await sendSkyEyesMessage(id, msg, groupMentions);
                    log(`[SkyOne] ${cleanFltNo} → nhóm ${id} OK (mentions=${groupMentions.length})`);
                  } catch (err) {
                    console.error(`[SkyOne] Gửi nhóm ${id} thất bại:`, err.message);
                  }
                }
              }
              if ((notifyType === 2 || notifyType === 3) && uids.length > 0) {
                for (const uid of uids) {
                  try {
                    await sendSkyEyesPrivateMessage(uid, msg);
                  } catch (err) {
                    console.error(`[SkyOne] Inbox ${uid}:`, err.message);
                  }
                }
              }
            }
            // Fallback webhook cũ
            sendZaloNotification(msg).catch(err => console.error('[Zalo Bot cũ]', err.message));
          };

          if (shouldNotify) {
            // Gửi TỪNG sự kiện 1 tin (không gộp field lạ vào 1 tin)
            // Giới hạn 1 chu kỳ: tối đa 3 tin / chuyến để tránh bão
            const toSend = eventQueue.slice(0, 3);
            log(`[FMS Notify] ${cleanFltNo}: events=${toSend.join(',')} ac=${cleanACREG} fuel=${newFuelOrder} stby=${newStandby}`);
            for (const ev of toSend) {
              const msg = buildFocusedMessage(ev);
              await sendOneZalo(msg);
            }
          }

          // Cờ đã báo (sticky — không reset khi FMS tạm 0)
          const oldWarnAcReg = prevWarnedAc;
          const oldWarnStandby = prevWarnedStandby;
          const oldWarnFuelOrder = prevWarnedFuel;
          const oldWarnEtd = prevWarnedEtd;
          const oldWarnUpdatedAt = oldOrder ? oldOrder.warn_updated_at : null;

          const warnAcRegVal = (isAcRegChanged || triggerAcRegChanged) ? 1 : oldWarnAcReg;
          const warnStandbyVal = (isStandbyChanged || isNewStandby || triggerNewStandby) ? 1 : oldWarnStandby;
          const warnFuelOrderVal = (isFuelOrderChanged || isNewFuelOrder || triggerNewFuelOrder) ? 1 : oldWarnFuelOrder;
          const warnEtdVal = (isEtdChanged || triggerEtdChanged) ? 1 : oldWarnEtd;

          let warnUpdatedAtVal = oldWarnUpdatedAt;
          if (shouldNotify || isAcRegChanged || isStandbyChanged || isNewStandby || isFuelOrderChanged || isNewFuelOrder || isEtdChanged) {
            warnUpdatedAtVal = new Date().toISOString();
          }

          const oldAcRegDb = oldOrder ? oldOrder.old_ac_reg : null;
          const oldStandbyDb = oldOrder ? oldOrder.old_standby_fuel : null;
          const oldFuelOrderDb = oldOrder ? oldOrder.old_fuel_order : null;
          const oldEtdDb = oldOrder ? oldOrder.old_etd : null;

          const finalOldAcReg = isAcRegChanged ? oldOrder.ac_reg : (warnAcRegVal === 1 ? oldAcRegDb : null);
          const finalOldStandby = isStandbyChanged ? oldOrder.standby_fuel : (warnStandbyVal === 1 ? oldStandbyDb : null);
          const finalOldFuelOrder = isFuelOrderChanged ? oldOrder.fuel_order : (warnFuelOrderVal === 1 ? oldFuelOrderDb : null);
          const finalOldEtd = isEtdChanged ? oldOrder.etd : (warnEtdVal === 1 ? oldEtdDb : null);

          // Persist kg đã “bảo vệ” (newFuelOrder/newStandby có thể đã giữ số cũ)
          const persistFuel = newFuelOrder;
          const persistStandby = newStandby;
          const persistStatus = (persistFuel > 0 || persistStandby > 0) ? 'Đã có số liệu' : status;

          await db.run(`
            INSERT INTO fms_fuel_orders (
              flight_no, ac_reg, ac_type, dep_arr, standby_fuel, fuel_order, 
              trip_fuel, trip_time, taxi_fuel, alternate, status,
              warn_ac_reg, warn_standby, warn_fuel_order, warn_etd, warn_updated_at,
              old_ac_reg, old_standby_fuel, old_fuel_order, old_etd, gate, etd,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(flight_no) DO UPDATE SET
              ac_reg = excluded.ac_reg,
              ac_type = excluded.ac_type,
              dep_arr = excluded.dep_arr,
              standby_fuel = excluded.standby_fuel,
              fuel_order = excluded.fuel_order,
              trip_fuel = excluded.trip_fuel,
              trip_time = excluded.trip_time,
              taxi_fuel = excluded.taxi_fuel,
              alternate = excluded.alternate,
              status = excluded.status,
              warn_ac_reg = excluded.warn_ac_reg,
              warn_standby = excluded.warn_standby,
              warn_fuel_order = excluded.warn_fuel_order,
              warn_etd = excluded.warn_etd,
              warn_updated_at = excluded.warn_updated_at,
              old_ac_reg = excluded.old_ac_reg,
              old_standby_fuel = excluded.old_standby_fuel,
              old_fuel_order = excluded.old_fuel_order,
              old_etd = excluded.old_etd,
              gate = excluded.gate,
              etd = excluded.etd,
              updated_at = CURRENT_TIMESTAMP
          `, 
            cleanFltNo + '_' + targetDate,
            cleanACREG,
            acTypeStr === '-' ? '' : acTypeStr,
            `${flt.DEP_AP_SCHED || ''} - ${flt.ARR_AP_SCHED || ''}`,
            String(persistStandby),
            String(persistFuel),
            detail.trip_fuel,
            detail.trip_time,
            detail.taxi_fuel,
            detail.alternate,
            persistStatus,
            warnAcRegVal,
            warnStandbyVal,
            warnFuelOrderVal,
            warnEtdVal,
            warnUpdatedAtVal,
            finalOldAcReg,
            finalOldStandby,
            finalOldFuelOrder,
            finalOldEtd,
            newGate,
            newEtd
          );
        log(`[Hoàn tất quét] Chuyến bay ${cleanFltNo}: Fuel Order = ${detail.fuel_order} kg, Trạng thái = ${status}`);
      } catch (fltErr) {
        console.error(`[Lỗi quét] Chuyến bay ${cleanFltNo} thất bại:`, fltErr.message);
      }
    });

    // Chờ tất cả các luồng quét chi tiết hoàn tất
    await Promise.all(promises);
    }
    log('Hoàn thành chu kỳ quét tải dầu FMS!');
  } catch (err) {
    console.error('[FMS Service] Lỗi đồng bộ FMS:', err.message);
  } finally {
    isSyncing = false;
  }
}

// Hàm giải mã ký tự HTML Entity
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

// Gửi request POST lấy chi tiết tra nạp JRefuelInfo từ FMS Skypec
function fetchRefuelInfo(cookie, flightId) {
  return new Promise((resolve) => {
    const postData = querystring.stringify({
      id: flightId,
      url: '/Flights'
    });

    const req = https.request({
      hostname: 'fms.skypec.com.vn',
      port: 443,
      path: '/Flights/JRefuelInfo',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Cookie': cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve(body);
      });
    });

    req.on('error', (err) => {
      console.error(`[FMS Service] Lỗi gọi JRefuelInfo cho ID ${flightId}:`, err.message);
      resolve('');
    });

    req.write(postData);
    req.end();
  });
}

// Parse HTML chi tiết tra nạp để lấy Lái xe & Thợ bơm thực tế của các xe nạp
function parseRefuelInfoHtml(html) {
  const refuels = [];
  let pos = 0;
  while (true) {
    const trStart = html.indexOf('<tr class="item-refuel-', pos);
    if (trStart === -1) break;
    const trEnd = html.indexOf('</tr>', trStart);
    if (trEnd === -1) break;
    const trHtml = html.substring(trStart, trEnd + 5);
    pos = trEnd + 5;

    // Bóc tách các td
    const tds = [];
    let tdPos = 0;
    while (true) {
      const tdStart = trHtml.indexOf('<td', tdPos);
      if (tdStart === -1) break;
      const tdEnd = trHtml.indexOf('</td>', tdStart);
      if (tdEnd === -1) break;
      tds.push(trHtml.substring(tdStart, tdEnd + 5));
      tdPos = tdEnd + 5;
    }

    if (tds.length >= 2) {
      // Cột 1: Xe tra nạp
      const truckNo = tds[0].replace(/<[^>]*>/g, '').trim();
      
      // Cột 2: Lái xe & Thợ bơm (nằm trong các thẻ span class="ctn")
      const spanCtn = [];
      let spanPos = 0;
      while (true) {
        const spanStart = tds[1].indexOf('<span class="ctn"', spanPos);
        if (spanStart === -1) break;
        const spanEnd = tds[1].indexOf('</span>', spanStart);
        if (spanEnd === -1) break;
        spanCtn.push(tds[1].substring(spanStart, spanEnd + 7).replace(/<[^>]*>/g, '').trim());
        spanPos = spanEnd + 7;
      }

      // Cột 7: Số lượng Kg (tds[6])
      let amountKg = 0;
      if (tds.length >= 7) {
        const kgStr = tds[6].replace(/<[^>]*>/g, '').replace(/[^\d]/g, '');
        amountKg = parseInt(kgStr, 10) || 0;
      }

      const driver = spanCtn.length > 0 ? decodeHtmlEntities(spanCtn[0]) : '';
      const operator = spanCtn.length > 1 ? decodeHtmlEntities(spanCtn[1]) : '';

      refuels.push({
        truck_no: truckNo,
        driver_name: driver,
        operator_name: operator,
        amount_kg: amountKg
      });
    }
  }
  return refuels;
}

// Đồng bộ danh sách chuyến bay và nhân viên thực tế từ trang Flights của FMS Skypec
let isLiveSyncing = false;
async function syncFmsSkypecLive(forceDate = null) {
  if (isLiveSyncing) return;
  isLiveSyncing = true;
  
  const HOST = 'fms.skypec.com.vn';
  const targetDate = forceDate || getVietnamDbDateStr(); // YYYY-MM-DD
  
  // Chuyển sang DD/MM/YYYY
  const parts = targetDate.split('-');
  const dateStr = `${parts[2]}/${parts[1]}/${parts[0]}`;
  const dateRange = `${dateStr} 00:00-${dateStr} 23:59`;

  console.log(`[FMS Skypec Live] Bắt đầu đồng bộ cho ngày: ${targetDate} (range: ${dateRange})...`);

  try {
    const db = await getDb();
    
    // 1. GET login page lấy CSRF Token
    const cookie = await new Promise((resolve, reject) => {
      https.get(`https://${HOST}/Account/Login`, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const cookies = res.headers['set-cookie'] || [];
          const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');
          const tokenMatch = body.match(/input name="__RequestVerificationToken" type="hidden" value="([^"]+)"/i);
          if (!tokenMatch) return reject(new Error('No CSRF token'));
          
          const csrfToken = tokenMatch[1];
          const postData = querystring.stringify({
            __RequestVerificationToken: csrfToken,
            UserName: 'noibai.han',
            Password: '12345678',
            RememberMe: 'false'
          });

          const req = https.request({
            hostname: HOST,
            port: 443,
            path: '/Account/Login',
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(postData),
              'Cookie': cookieStr
            }
          }, (postRes) => {
            postRes.on('data', () => {});
            postRes.on('end', () => {
              const postCookies = postRes.headers['set-cookie'] || [];
              let authCookieStr = cookieStr;
              if (postCookies.length > 0) {
                authCookieStr = postCookies.map(c => c.split(';')[0]).join('; ');
              }
              resolve(authCookieStr);
            });
          });
          req.on('error', reject);
          req.write(postData);
          req.end();
        });
      }).on('error', reject);
    });

    // 2. Fetch Flights page
    const path = `/Flights?daterange=${encodeURIComponent(dateRange)}`;
    const html = await new Promise((resolve, reject) => {
      https.get({
        hostname: HOST,
        port: 443,
        path: path,
        headers: {
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          if (res.statusCode !== 200) reject(new Error(`HTTP Code ${res.statusCode}`));
          else resolve(body);
        });
      }).on('error', reject);
    });

    // 3. Parse HTML và trích xuất các chuyến bay
    const tbodyStart = html.indexOf('<tbody');
    const tbodyEnd = html.indexOf('</tbody>');
    if (tbodyStart === -1 || tbodyEnd === -1) {
      console.log('[FMS Skypec Live] Không tìm thấy tbody trong trang Flights');
      isLiveSyncing = false;
      return;
    }

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

    // Map id_fms → tên "Hãng bay" (nằm ở hàng con item-flight-after-*)
    const airlineByFmsId = {};
    const airlineNameRe = /class="airline-name-(\d+)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
    let airlineMatch;
    while ((airlineMatch = airlineNameRe.exec(tbodyHtml)) !== null) {
      const fmsId = airlineMatch[1];
      const rawName = airlineMatch[2].replace(/<[^>]+>/g, '').trim();
      airlineByFmsId[fmsId] = decodeHtmlEntities(rawName);
    }

    const flightsToSync = [];

    for (const rowHtml of rows) {
      if (!rowHtml.includes('parent')) continue;

      const codeMatch = rowHtml.match(/id="Code"[^>]*>([\s\S]*?)<\/span>/i);
      const flightNo = codeMatch ? codeMatch[1].trim().toUpperCase().replace(/\s+/g, '') : '';
      if (!flightNo) continue;

      // ID FMS của chuyến bay từ checkbox value
      const idMatch = rowHtml.match(/value="(\d+)"/);
      const idFms = idMatch ? idMatch[1] : '';
      const airlineName = idFms && airlineByFmsId[idFms] ? airlineByFmsId[idFms] : '';

      // Loại tàu bay
      const acTypeMatch = rowHtml.match(/id="AircraftType"[^>]*>([\s\S]*?)<\/span>/i);
      let acType = acTypeMatch ? acTypeMatch[1].trim() : '';
      if (acType.startsWith('<span>')) acType = acType.replace('<span>', '').trim();

      // Số hiệu tàu bay
      const acRegMatch = rowHtml.match(/id="AircraftCode"[^>]*>([\s\S]*?)<\/span>/i);
      const acReg = acRegMatch ? acRegMatch[1].trim() : '';

      // Đường bay
      const routeMatch = rowHtml.match(/id="RouteName"[^>]*>([\s\S]*?)<\/span>/i);
      const route = routeMatch ? routeMatch[1].trim() : '';

      // Giờ
      const depTimeMatch = rowHtml.match(/id="DepartureScheduledTime"[^>]*>([\s\S]*?)<\/span>/i);
      const timeDep = depTimeMatch ? depTimeMatch[1].trim() : '';
      const arrTimeMatch = rowHtml.match(/id="ArrivalScheduledTime"[^>]*>([\s\S]*?)<\/span>/i);
      const timeArr = arrTimeMatch ? arrTimeMatch[1].trim() : '';
      const refuelHoursMatch = rowHtml.match(/id="RefuelScheduledHours"[^>]*>([\s\S]*?)<\/span>/i);
      const timeFuel = refuelHoursMatch ? refuelHoursMatch[1].trim() : '';

      // Vị trí đỗ
      const parkingMatch = rowHtml.match(/id="Parking"[^>]*>([\s\S]*?)<\/span>/i);
      const gate = parkingMatch ? parkingMatch[1].trim() : '';

      // Tải dầu standby và thực tế ban đầu ở trang chính
      const estAmountMatch = rowHtml.match(/id="EstimateAmount"[^>]*>([\s\S]*?)<\/td>/i);
      let standbyFuel = '';
      let fuelOrder = '';
      if (estAmountMatch) {
        const tdContent = estAmountMatch[1];
        const actuMatch = tdContent.match(/<span[^>]*class="actu-capa"[^>]*>([\s\S]*?)<\/span>/i);
        if (actuMatch) {
          fuelOrder = actuMatch[1].replace(/[^\d]/g, '');
        }
        const beforeSpan = tdContent.split(/<br|<span/i)[0];
        standbyFuel = beforeSpan.replace(/[^\d]/g, '');
      }

      // Lái xe (driverId) ban đầu
      const driverSelectMatch = rowHtml.match(/<select[^>]*class="[^"]*driverId[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
      let driverName = '';
      if (driverSelectMatch) {
        const selectedOptionMatch = driverSelectMatch[1].match(/<option[^>]*selected="selected"[^>]*>([\s\S]*?)<\/option>/i);
        if (selectedOptionMatch) {
          driverName = decodeHtmlEntities(selectedOptionMatch[1].trim());
        }
      }

      // NV tra nạp (operatorId) ban đầu
      const operatorSelectMatch = rowHtml.match(/<select[^>]*class="[^"]*operatorId[^"]*"[^>]*>([\s\S]*?)<\/select>/i);
      let operatorName = '';
      if (operatorSelectMatch) {
        const selectedOptionMatch = operatorSelectMatch[1].match(/<option[^>]*selected="selected"[^>]*>([\s\S]*?)<\/option>/i);
        if (selectedOptionMatch) {
          operatorName = decodeHtmlEntities(selectedOptionMatch[1].trim());
        }
      }

      const status = (fuelOrder || standbyFuel) ? 'Đã có số liệu' : 'Chờ cập nhật';

      flightsToSync.push({
        id_fms: idFms,
        flight_no: flightNo,
        ac_type: acType,
        ac_reg: acReg,
        route: route,
        time_arr: timeArr,
        time_dep: timeDep,
        time_fuel: timeFuel,
        gate: gate,
        driver_name: driverName,
        operator_name: operatorName,
        truck_no: '',
        standby_fuel: standbyFuel,
        fuel_order: fuelOrder,
        status: status,
        airline_name: airlineName,
        date: targetDate
      });
    }

    // 4. Gọi song song (giới hạn concurrency = 5) để lấy mẻ nạp JRefuelInfo thực tế
    const concurrencyLimit = 5;
    const queue = [...flightsToSync];
    
    async function worker() {
      while (queue.length > 0) {
        const flight = queue.shift();
        if (!flight) continue;

        if (flight.id_fms) {
          try {
            const refuelHtml = await fetchRefuelInfo(cookie, flight.id_fms);
            if (refuelHtml) {
              const refuels = parseRefuelInfoHtml(refuelHtml);
              if (refuels.length > 0) {
                // Gộp thông tin của tất cả các mẻ nạp vào chuyến bay chính
                flight.driver_name = refuels.map(r => r.driver_name).filter(Boolean).join(', ');
                flight.operator_name = refuels.map(r => r.operator_name).filter(Boolean).join(', ');
                flight.truck_no = refuels.map(r => r.truck_no).filter(Boolean).join(', ');
                flight.fuel_order = refuels.reduce((sum, r) => sum + r.amount_kg, 0).toString();
                flight.status = 'Đã có số liệu';
              }
            }
          } catch (refuelErr) {
            console.error(`[FMS JRefuelInfo Live] Lỗi lấy mẻ nạp cho chuyến ${flight.flight_no}:`, refuelErr.message);
          }
        }
      }
    }

    const workers = Array(concurrencyLimit).fill(0).map(() => worker());
    await Promise.all(workers);

    // 5. Lưu toàn bộ chuyến bay vào SQLite
    let insertCount = 0;
    const todayDb = getVietnamDbDateStr();
    for (const flight of flightsToSync) {
      // Chỉ tạo monitor từ mốc 19/07/2026 và trong cửa sổ ngày đang quét (không cào lịch sử NKT cũ)
      const allowMonitor = canCreateMonitorForDate(flight.date);
      
      if (allowMonitor) {
        // TRƯỚC KHI LƯU: So sánh với bản ghi cũ để phát hiện đổi tàu bay đã nạp dầu thực tế
        try {
          const oldFlight = await db.get(
            "SELECT ac_reg, fuel_order, time_fuel, route FROM fms_flights_live WHERE UPPER(flight_no) = UPPER(?) AND date = ?",
            flight.flight_no, flight.date
          );

          if (oldFlight && oldFlight.ac_reg && flight.ac_reg && 
              String(oldFlight.ac_reg).trim().toUpperCase() !== String(flight.ac_reg).trim().toUpperCase()) {
            
            const oldAcReg = String(oldFlight.ac_reg).trim().toUpperCase();
            const oldFuelOrder = parseInt(oldFlight.fuel_order) || 0;
            
            if (oldFuelOrder > 0) {
              const oldRoute = String(oldFlight.route || '').trim().toUpperCase().replace(/\s+/g, '');
              // Route không hợp lệ (VD chỉ "HAN") → không tạo monitor đổi tàu
              const routeOk = oldRoute && oldRoute !== '-' && oldRoute.includes('-');
              if (!routeOk) {
                log(`[FMS Skypec Live] Bỏ monitor đổi tàu ${oldAcReg}/${flight.flight_no}: route không hợp lệ "${oldFlight.route}"`);
              } else {
              let monitorType = null;
              if (oldRoute === 'HAN-HAN') {
                monitorType = 'TECHNICAL_HAN';
              } else if (isDomesticRoute(oldRoute)) {
                // Đổi tàu sau nạp nội địa → bám có bay QT không
                monitorType = 'DOMESTIC_TO_INTL';
              } else if (isDepartingIntlRoute(oldRoute) || (!isDomesticRoute(oldRoute) && oldRoute.includes('-'))) {
                // Đổi tàu sau nạp QT (HAN-ICN…) → bám có bay nội địa không
                monitorType = 'INTL_TO_DOMESTIC';
              }

              const cleanFltNo = String(flight.flight_no).trim().toUpperCase();
              // Chỉ giám sát tái xuất chuyến VN (VNA) — bỏ VU, 9G, hãng QT
              if (!isVnAirlineFlightNo(cleanFltNo)) {
                log(`[FMS Skypec Live] Bỏ monitor đổi tàu ${oldAcReg}/${cleanFltNo}: không phải chuyến VN.`);
                monitorType = null;
              }
              // Đã có NKT cùng tàu/ngày/kg → không tạo thêm dòng Q.tế→N.địa trùng
              const hasTechSame = monitorType
                ? await db.get(
                    `SELECT id FROM fms_temp_import_exports
                     WHERE UPPER(TRIM(ac_reg)) = ? AND date = ? AND monitor_type = 'TECHNICAL_HAN'
                       AND is_warned < 2 AND ABS(COALESCE(fuel_order,0) - ?) < 2`,
                    oldAcReg, flight.date, oldFuelOrder
                  )
                : null;
              if (hasTechSame && monitorType !== 'TECHNICAL_HAN') {
                log(`[FMS Skypec Live] Bỏ monitor ${monitorType} ${oldAcReg}: đã có TECHNICAL_HAN cùng ngày/kg.`);
                monitorType = null;
              }

              const exists = monitorType
                ? await db.get(
                    "SELECT id FROM fms_temp_import_exports WHERE ac_reg = ? AND date = ? AND old_flight_no = ?",
                    oldAcReg, flight.date, cleanFltNo
                  )
                : { id: 1 };

              if (monitorType && !exists) {
                log(`[FMS Skypec Live] Phát hiện đổi tàu chéo: Tàu ${oldAcReg} đã nạp ${oldFuelOrder} kg dầu cho chuyến ${cleanFltNo} (${oldRoute}) nhưng bị đổi. Kiểu giám sát: ${monitorType}`);
                await db.run(`
                  INSERT INTO fms_temp_import_exports (ac_reg, old_flight_no, old_route, fuel_order, date, monitor_type, old_time)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `, oldAcReg, cleanFltNo, oldRoute, oldFuelOrder, flight.date, monitorType, oldFlight.time_fuel || '-');
              }
              }
            }
          }
        } catch (errDb) {
          console.error('[FMS Skypec Live] Lỗi kiểm tra đổi tàu chéo:', errDb.message);
        }
      }

      if (allowMonitor) {
        // TỰ ĐỘNG GIÁM SÁT tàu HAN-HAN nạp dầu kỹ thuật (chỉ ngày trong cửa sổ, từ 19/07)
        try {
          const currentRoute = String(flight.route || '').trim().toUpperCase();
          const currentFuel = parseInt(String(flight.fuel_order || '0').replace(/[^\d]/g, ''), 10) || 0;
          if (currentRoute === 'HAN-HAN' && currentFuel > 0 && flight.ac_reg) {
            const currentAcReg = String(flight.ac_reg).trim().toUpperCase();
            const cleanFltNo = String(flight.flight_no).trim().toUpperCase();
            // Chỉ NKT chuyến VN — bỏ VU, 9G, hãng QT
            if (!isVnAirlineFlightNo(cleanFltNo)) {
              // skip silently
            } else {
            const exists = await db.get(
              "SELECT id FROM fms_temp_import_exports WHERE ac_reg = ? AND date = ? AND old_flight_no = ? AND monitor_type = 'TECHNICAL_HAN'",
              currentAcReg, flight.date, cleanFltNo
            );
            if (!exists) {
              log(`[FMS Skypec Live] NKT HAN-HAN: Tàu ${currentAcReg} nạp ${currentFuel} kg (${cleanFltNo}) date=${flight.date} → giám sát.`);
              await db.run(`
                INSERT INTO fms_temp_import_exports (ac_reg, old_flight_no, old_route, fuel_order, date, monitor_type, old_time)
                VALUES (?, ?, ?, ?, ?, 'TECHNICAL_HAN', ?)
              `, currentAcReg, cleanFltNo, currentRoute, currentFuel, flight.date, flight.time_fuel || '-');
            }
            }
          }
        } catch (errDb) {
          console.error('[FMS Skypec Live] Lỗi kiểm tra chặng HAN-HAN:', errDb.message);
        }
      }

      await db.run(`
        INSERT INTO fms_flights_live (
          flight_no, ac_type, ac_reg, route, time_arr, time_dep, time_fuel,
          gate, truck_no, driver_name, operator_name, standby_fuel, fuel_order, status, airline_name, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(flight_no, date) DO UPDATE SET
          ac_type = excluded.ac_type,
          ac_reg = excluded.ac_reg,
          route = excluded.route,
          time_arr = excluded.time_arr,
          time_dep = excluded.time_dep,
          time_fuel = excluded.time_fuel,
          gate = excluded.gate,
          truck_no = excluded.truck_no,
          driver_name = excluded.driver_name,
          operator_name = excluded.operator_name,
          standby_fuel = excluded.standby_fuel,
          fuel_order = excluded.fuel_order,
          status = excluded.status,
          airline_name = excluded.airline_name,
          created_at = CURRENT_TIMESTAMP
      `, 
        flight.flight_no, flight.ac_type, flight.ac_reg, flight.route, 
        flight.time_arr, flight.time_dep, flight.time_fuel, flight.gate, 
        flight.truck_no || '', flight.driver_name, flight.operator_name, flight.standby_fuel, 
        flight.fuel_order, flight.status, flight.airline_name || '', flight.date
      );

      // Đồng bộ tên lái/NV sang fms_schedules nếu lịch đang thiếu tên (tránh cột nhân viên trống)
      try {
        const dName = String(flight.driver_name || '').split(',')[0].trim();
        const oName = String(flight.operator_name || '').split(',')[0].trim();
        const realD = dName && !/^NAFSC$/i.test(dName) ? dName : '';
        const realO = oName && !/^NAFSC$/i.test(oName) ? oName : '';
        if (realD || realO) {
          const cleanFn = String(flight.flight_no || '').toUpperCase().replace(/[\s\-_.]/g, '');
          const crewInfo = [realD, realO].filter(Boolean).join(' - ');
          await db.run(
            `UPDATE fms_schedules SET
              driver_name = CASE
                WHEN driver_name IS NULL OR TRIM(driver_name) = '' OR UPPER(TRIM(driver_name)) = 'NAFSC'
                THEN ? ELSE driver_name END,
              operator_name = CASE
                WHEN operator_name IS NULL OR TRIM(operator_name) = '' OR UPPER(TRIM(operator_name)) = 'NAFSC'
                THEN ? ELSE operator_name END,
              crew_info = CASE
                WHEN crew_info IS NULL OR TRIM(crew_info) = '' OR TRIM(crew_info) = '-' OR UPPER(crew_info) LIKE '%NAFSC%'
                THEN ? ELSE crew_info END,
              truck_no = COALESCE(NULLIF(truck_no, ''), ?)
             WHERE (date = ? OR fms_date = ?)
               AND REPLACE(REPLACE(UPPER(flight_no), ' ', ''), '-', '') = ?
               AND UPPER(COALESCE(NULLIF(unit_code,''),'SKYPEC')) IN ('SKYPEC','NAFC','BOTH')`,
            realD || null,
            realO || null,
            crewInfo || null,
            (flight.truck_no || '').split(',')[0].trim() || null,
            flight.date,
            flight.date,
            cleanFn
          );
        }
      } catch (_) { /* ignore schedule enrich errors */ }

      insertCount++;
    }
    console.log(`[FMS Skypec Live] Đồng bộ thành công ${insertCount} chuyến bay của ngày: ${targetDate}`);

    // 5b. Auto đồng bộ kế hoạch ca từ Flights (chỉ hôm nay / hôm qua — không chạy khi cào lịch sử)
    try {
      const todayDb = getVietnamDbDateStr();
      const yest = (() => {
        const vn = new Date(Date.now() + 7 * 60 * 60 * 1000);
        vn.setUTCDate(vn.getUTCDate() - 1);
        return `${vn.getUTCFullYear()}-${String(vn.getUTCMonth() + 1).padStart(2, '0')}-${String(vn.getUTCDate()).padStart(2, '0')}`;
      })();
      if (targetDate === todayDb || targetDate === yest) {
        const { autoSyncScheduleFromFlightsIfEnabled } = require('./scheduleFromFlights');
        await autoSyncScheduleFromFlightsIfEnabled();
      }
    } catch (schedErr) {
      console.error('[FMS Skypec Live] Lỗi auto schedule từ Flights:', schedErr.message);
    }

    // 6. Giám sát SAI TÊN HÃNG theo field "Hãng bay" Skypec
    // Chỉ chạy cho hôm nay (+ hôm qua cho ca đêm) — không bắn khi cào lịch sử 40 ngày
    try {
      const todayDb = getVietnamDbDateStr();
      const yest = new Date(Date.now() + 7 * 60 * 60 * 1000);
      yest.setUTCDate(yest.getUTCDate() - 1);
      const yesterdayDb = `${yest.getUTCFullYear()}-${String(yest.getUTCMonth() + 1).padStart(2, '0')}-${String(yest.getUTCDate()).padStart(2, '0')}`;
      const shouldCheckAirline = targetDate === todayDb || targetDate === yesterdayDb;

      if (shouldCheckAirline) {
        const scheduleRows = await db.all(
          "SELECT * FROM fms_schedules WHERE date = ? OR fms_date = ?",
          targetDate, targetDate
        ).catch(() => []);
        const scheduleByFlight = {};
        for (const s of scheduleRows || []) {
          if (!s.flight_no) continue;
          const key = String(s.flight_no).toUpperCase().replace(/\s+/g, '');
          scheduleByFlight[key] = s;
        }
        const liveAsMatched = flightsToSync.map(f => ({
          FLIGHTNO: f.flight_no,
          CARRIER: '',
          AIRLINE_NAME: f.airline_name || '',
          ACREG: f.ac_reg,
          GATE: f.gate,
          DRIVER_NAME: f.driver_name,
          OPERATOR_NAME: f.operator_name,
          TRUCK_NO: f.truck_no
        }));
        await checkAirlineNameMismatchAlerts(db, targetDate, liveAsMatched, scheduleByFlight);
      }
    } catch (alertErr) {
      console.error('[FMS Skypec Live] Lỗi kiểm tra sai tên hãng:', alertErr.message);
    }
  } catch (err) {
    console.error('[FMS Skypec Live] Lỗi cào FMS Skypec:', err.message);
  } finally {
    isLiveSyncing = false;
  }
}

// Hàm cào dữ liệu lịch sử từ ngày 1 của tháng trước đến ngày hôm nay
async function syncFmsSkypecHistory() {
  console.log('[FMS Skypec Live] Bắt đầu cào dữ liệu lịch sử 40 ngày gần đây...');
  
  const targetDates = [];
  const now = new Date();
  const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  
  // Lấy ngày hiện tại
  const today = new Date(vnTime.getFullYear(), vnTime.getMonth(), vnTime.getDate());
  
  // Tính ngày 1 của tháng trước
  let startYear = vnTime.getFullYear();
  let startMonth = vnTime.getMonth() - 1; // Month index 0-11
  if (startMonth < 0) {
    startMonth = 11;
    startYear -= 1;
  }
  const startDate = new Date(startYear, startMonth, 1);
  
  // Loop từ startDate đến today
  let current = new Date(startDate);
  while (current <= today) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    const d = String(current.getDate()).padStart(2, '0');
    targetDates.push(`${y}-${m}-${d}`);
    current.setDate(current.getDate() + 1);
  }
  
  console.log(`[FMS Skypec Live] Tổng số ngày lịch sử cần cào: ${targetDates.length} ngày.`);
  
  // Cào tuần tự cách nhau 1.5s để tránh block IP hoặc quá tải FMS
  for (let i = 0; i < targetDates.length; i++) {
    const dateStr = targetDates[i];
    try {
      isLiveSyncing = false;
      await syncFmsSkypecLive(dateStr);
      // Delay 1.5s
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (e) {
      console.error(`[FMS Skypec Live] Lỗi cào lịch sử ngày ${dateStr}:`, e.message);
    }
  }
  console.log('[FMS Skypec Live] Hoàn tất cào dữ liệu lịch sử 40 ngày!');
}

// Khởi chạy tiến trình quét ngầm định kỳ
let workerInterval = null;
function startFmsWorker(intervalMs = 3 * 60 * 1000) { // Mặc định quét mỗi 3 phút
  if (workerInterval) {
    clearInterval(workerInterval);
  }
  
  // Chạy lần đầu tiên
  setTimeout(() => {
    syncFMSData();
    syncFmsSkypecLive().catch(err => console.error('[FMS Skypec Live Worker Error]', err.message));
    // Tự động kích hoạt cào ngầm dữ liệu lịch sử 40 ngày gần đây
    syncFmsSkypecHistory().catch(err => console.error('[FMS Skypec History Error]', err.message));
  }, 5000);

  workerInterval = setInterval(() => {
    syncFMSData();
    syncFmsSkypecLive().catch(err => console.error('[FMS Skypec Live Worker Error]', err.message));
  }, intervalMs);
  
  log(`Đã khởi chạy tiến trình quét ngầm FMS (Chu kỳ: ${intervalMs / 1000}s)`);
}

module.exports = {
  syncFMSData,
  syncFmsSkypecLive,
  syncFmsSkypecHistory,
  startFmsWorker,
  getVietnamDbDateStr,
  getVietnamDateTimeStr,
  isDomesticRoute,
  isDepartingIntlRoute,
  isVnAirlineFlightNo,
  isCancelScopeFlight,
  checkAirlineNameMismatchAlerts,
  listAirlineMappings,
  detectCancelledFueledFlights,
  checkTempImportExportAlerts,
  decideMonitorAction,
  MONITOR_EPOCH_DATE,
  isMonitorEpochDate,
  canCreateMonitorForDate
};
