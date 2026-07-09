const http = require('http');
const https = require('https');
const querystring = require('querystring');
const { getDb } = require('./db');
const { sendSkyEyesMessage, sendSkyEyesPrivateMessage } = require('./zaloService');

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

    // Dọn dẹp dữ liệu lịch bay và kế hoạch trực ca cũ của những ngày trước để tránh quá tải DB
    try {
      // Xóa sạch toàn bộ lịch trực cũ của tất cả các ngày trước ngày hôm nay (date < todayDb)
      const deletedRows = await db.run('DELETE FROM fms_schedules WHERE date < ?', todayDb);
      if (deletedRows && deletedRows.changes > 0) {
        log(`[Dọn dẹp DB] Đã xóa ${deletedRows.changes} dòng lịch bay cũ trước ngày hôm nay.`);
      }

      // Xóa sạch toàn bộ tải dầu FMS của các ngày trước ngày hôm nay (date < todayDb) để tránh so sánh nhầm
      const deletedOrders = await db.run("DELETE FROM fms_fuel_orders WHERE flight_no LIKE '%_%' AND substr(flight_no, instr(flight_no, '_') + 1) < ?", todayDb);
      if (deletedOrders && deletedOrders.changes > 0) {
        log(`[Dọn dẹp DB] Đã xóa ${deletedOrders.changes} bản ghi tải dầu FMS cũ của các ngày trước.`);
      }
    } catch (cleanupErr) {
      console.error('[Dọn dẹp DB] Lỗi khi dọn dẹp dữ liệu cũ:', cleanupErr.message);
    }

    let targetDates = [];
    if (forceDate) {
      const selectedDateStr = String(forceDate).trim();
      if (forceShift === 'night') {
        // Ca đêm vượt ngày: các chuyến rạng sáng bay vào ngày hôm sau, do đó cần quét cả 2 ngày
        const d = new Date(selectedDateStr + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        const nextDayStr = d.toISOString().split('T')[0];
        targetDates = [selectedDateStr, nextDayStr];
      } else {
        targetDates = [selectedDateStr];
      }
    } else {
      // Tự động trích xuất các ngày bay thực tế đang có trong lịch trực hiện tại để quét
      const dateRows = await db.all('SELECT DISTINCT COALESCE(fms_date, date) as target_date FROM fms_schedules');
      targetDates = dateRows.map(r => r.target_date).filter(Boolean);

      // Nếu database hoàn toàn trống lịch trực, mặc định quét ngày hôm nay
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

    for (const targetDate of targetDates) {
      // Lấy danh sách các chuyến bay cần theo dõi của ngày đang xét theo ngày bay thực tế FMS (fms_date)
      const schedules = await db.all('SELECT DISTINCT flight_no, time_fuel, time_dep, time_arr FROM fms_schedules WHERE COALESCE(fms_date, date) = ?', targetDate);
      if (schedules.length === 0) continue;

      // Lọc theo ca trực nếu được chỉ định
      let filteredSchedules = schedules;
      if (forceShift && forceShift !== 'all') {
        filteredSchedules = schedules.filter(s => {
          const timeStr = s.time_fuel || s.time_dep || s.time_arr || '';
          if (!timeStr || timeStr === '-') return false;
          
          try {
            const match = timeStr.match(/^(\d{1,2}):(\d{2})/);
            if (!match) return false;
            
            const hour = parseInt(match[1]);
            const minute = parseInt(match[2]);
            const minutes = hour * 60 + minute;
            
            const m_0730 = 7 * 60 + 30;
            const m_1930 = 19 * 60 + 30;
            const m_2359 = 23 * 60 + 59;
            
            if (forceShift === 'day') {
              return minutes >= m_0730 && minutes < m_1930;
            } else if (forceShift === 'evening') {
              return minutes >= m_1930 && minutes <= m_2359;
            } else if (forceShift === 'night') {
              return minutes >= m_2359 || minutes < m_0730;
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

      // Tải danh sách chuyến bay từ FMS cho ngày này
      const targetFmsDateStr = convertDbDateToFmsDate(targetDate);
      let fmsFlights = [];
      try {
        fmsFlights = await fetchFMSData(targetFmsDateStr, activeCookie);
        
        // Phát hiện cookie hết hạn âm thầm khi FMS trả về 0 chuyến bay
        if (fmsFlights.length === 0) {
          log(`[Cảnh báo] Tải về 0 chuyến bay từ FMS cho ngày ${targetFmsDateStr}. Có khả năng cookie hết hạn âm thầm. Tiến hành đăng nhập lại để làm mới cookie...`);
          // Xóa cookie cũ khỏi DB và cache bộ nhớ để ép login mới
          await db.run("DELETE FROM settings WHERE key = 'fms_cookie'");
          await db.run("DELETE FROM settings WHERE key = 'fms_cookie_created_at'");
          cachedFmsCookie = null;
          
          activeCookie = await loginFMS();
          fmsFlights = await fetchFMSData(targetFmsDateStr, activeCookie);
        }
      } catch (err) {
        log(`Cookie FMS bị lỗi hoặc hết hạn. Đang tiến hành đăng nhập lại... Chi tiết lỗi: ${err.message || JSON.stringify(err)}`);
        // Xóa cookie cũ khỏi DB và cache bộ nhớ để ép login mới
        await db.run("DELETE FROM settings WHERE key = 'fms_cookie'");
        await db.run("DELETE FROM settings WHERE key = 'fms_cookie_created_at'");
        cachedFmsCookie = null;
        
        activeCookie = await loginFMS();
        fmsFlights = await fetchFMSData(targetFmsDateStr, activeCookie);
      }
      
      log(`[Ngày ${targetDate}] Đã tải danh sách chuyến bay từ FMS, tổng cộng ${fmsFlights.length} chuyến.`);

      // Lọc các chuyến bay khớp với lịch trực của ngày này
      const matchedFlights = fmsFlights.filter(f => {
        if (!f.FLIGHTNO) return false;
        const cleanFltNo = f.FLIGHTNO.toUpperCase().replace(/\s+/g, '');
        return flightNumbers.includes(cleanFltNo);
      });

      log(`[Ngày ${targetDate}] Tìm thấy ${matchedFlights.length} chuyến bay khớp trên FMS.`);
      if (matchedFlights.length === 0) continue;

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
          const sched = await db.get('SELECT crew_info, truck_no, gate, time_arr, time_dep, time_fuel, crew_zalo_uids, notify_type FROM fms_schedules WHERE flight_no = ? AND COALESCE(fms_date, date) = ?', cleanFltNo, targetDate);

          const cleanACREG = flt.ACREG ? flt.ACREG.trim() : '';
          const oldStandby = oldOrder ? (parseInt(oldOrder.standby_fuel) || 0) : 0;
          const oldFuelOrder = oldOrder ? (parseInt(oldOrder.fuel_order) || 0) : 0;
          const newStandby = parseInt(detail.standby_fuel) || 0;
          const newFuelOrder = parseInt(detail.fuel_order) || 0;

          // So sánh vị trí đỗ
          const oldGate = oldOrder ? (oldOrder.gate || '') : '';
          const newGate = sched ? (sched.gate || '') : '';
          const isGateChanged = oldOrder && oldGate && newGate && (oldGate.trim() !== newGate.trim());

          // So sánh giờ bay ETD dự kiến
          const newEtd = convertUtcToVnTime(flt.ETD);
          const oldEtd = oldOrder ? (oldOrder.etd || '') : '';
          const isEtdChanged = oldOrder && oldEtd && newEtd && (oldEtd.trim() !== newEtd.trim());

          // Báo tin khi mới xuất hiện standby_fuel lần đầu
          const isNewStandby = newStandby > 0 && oldStandby <= 0;
          // Báo tin khi mới xuất hiện fuel_order lần đầu
          const isNewFuelOrder = newFuelOrder > 0 && oldFuelOrder <= 0;
          
          // Kiểm tra thay đổi trị số khi đã có dữ liệu từ trước
          const isStandbyChanged = oldStandby > 0 && newStandby > 0 && oldStandby !== newStandby;
          const isFuelOrderChanged = oldFuelOrder > 0 && newFuelOrder > 0 && oldFuelOrder !== newFuelOrder;
          const isFuelChanged = isStandbyChanged || isFuelOrderChanged;

          // Báo tin khi đổi tàu bay
          const isAcRegChanged = oldOrder && oldOrder.status === 'Đã có số liệu' && oldOrder.ac_reg && cleanACREG && 
                                 (String(oldOrder.ac_reg).trim() !== cleanACREG);

          // Nhận diện lần quét đầu tiên khi import lịch trực: nếu oldOrder chưa tồn tại trong DB, không bắn thông báo Zalo
          const shouldNotify = oldOrder ? (isNewStandby || isNewFuelOrder || isFuelChanged || isAcRegChanged || isGateChanged || isEtdChanged) : false;

          if (shouldNotify) {
            let title = '🔔 [FMS BÁO TẢI DẦU MỚI]';
            if (isNewStandby && !isNewFuelOrder) {
              title = '🔔 [FMS BÁO TẢI DẦU STANDBY MỚI]';
            } else if (isNewFuelOrder) {
              title = '⛽ [FMS BÁO TẢI DẦU CHÍNH THỨC MỚI]';
            } else if (isFuelChanged) {
              title = '🔄 [FMS CẬP NHẬT SỐ LIỆU TẢI DẦU]';
            } else if (isAcRegChanged) {
              title = '🛩️ [FMS CẢNH BÁO THAY ĐỔI TÀU BAY]';
            } else if (isGateChanged) {
              title = '📍 [FMS CẢNH BÁO THAY ĐỔI VỊ TRÍ ĐỖ]';
            } else if (isEtdChanged) {
              title = '🔄 [FMS THAY ĐỔI THÔNG TIN CHUYẾN BAY]';
            }
            
            // Lấy giá trị cũ phục vụ template
            const oldAcRegVal = oldOrder ? (oldOrder.ac_reg || '-') : '-';
            const oldStandbyFuelVal = oldOrder ? (parseInt(oldOrder.standby_fuel) > 0 ? parseInt(oldOrder.standby_fuel).toLocaleString() : '0') : '-';
            const oldFuelOrderVal = oldOrder ? (parseInt(oldOrder.fuel_order) > 0 ? parseInt(oldOrder.fuel_order).toLocaleString() : '0') : '-';

            // Đọc template từ settings
            const templateSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_message_template'");
            let template = templateSetting ? templateSetting.value : '';

            if (!template || template.trim() === '') {
              template = `{{status_change_title}}
✈️ Chuyến bay: {{flight_no}} - {{ac_reg}}
👥 Cặp tra nạp: {{crew_info}}
🚛 Số xe nạp: {{truck_no}}
📍 Vị trí đỗ: {{gate}}
🛩️ Số hiệu tàu: {{ac_reg}} (Loại: {{ac_type}})
---------------------------
⛽ Tải dầu Standby (CFP): {{standby_fuel}} kg
⛽ Tải dầu Chính thức: {{fuel_order}} kg
⏰ Giờ Tra nạp: {{time_fuel}}
⏰ Giờ Hạ/Cất: Hạ {{time_arr}} | Cất {{time_dep}}
📢 Giờ thông báo: {{notify_time}}`;
            }

            // Đảm bảo dòng Chuyến bay luôn có định dạng {{flight_no}} - {{ac_reg}} để nhận diện
            if (template.includes('{{flight_no}}') && !template.includes('{{flight_no}} - {{ac_reg}}') && !template.includes('{{flight_no}}-{{ac_reg}}')) {
              template = template.replace('{{flight_no}}', '{{flight_no}} - {{ac_reg}}');
            }

            // 1. Phân giải tag Zalo trực tiếp cho lái xe và nhân viên nạp
            const drName = sched && sched.driver_name ? sched.driver_name.toUpperCase().trim() : '';
            const opName = sched && sched.operator_name ? sched.operator_name.toUpperCase().trim() : '';
            
            let driverCrewPart = drName || '-';
            let operatorCrewPart = opName || '-';
            
            let driverMentionInfo = null;
            let operatorMentionInfo = null;
            
            try {
              const dbMappings = await db.all('SELECT schedule_name, zalo_uid, zalo_name FROM zalo_user_mappings');
              const mappingMap = {};
              dbMappings.forEach(m => {
                mappingMap[m.schedule_name.toUpperCase().trim()] = {
                  uid: m.zalo_uid,
                  name: m.zalo_name || m.schedule_name
                };
              });
              
              if (drName && mappingMap[drName]) {
                const mapInfo = mappingMap[drName];
                driverCrewPart = `@${mapInfo.name}`;
                driverMentionInfo = {
                  uid: mapInfo.uid,
                  tagLabel: `@${mapInfo.name}`
                };
              }
              
              if (opName && mappingMap[opName]) {
                const mapInfo = mappingMap[opName];
                operatorCrewPart = `@${mapInfo.name}`;
                operatorMentionInfo = {
                  uid: mapInfo.uid,
                  tagLabel: `@${mapInfo.name}`
                };
              }
            } catch (mappingErr) {
              console.error('[Mapping Fetch Error]', mappingErr.message);
            }
            
            const crewInfoVal = (drName || opName)
              ? (drName && opName ? `${driverCrewPart} - ${operatorCrewPart}` : (driverCrewPart || operatorCrewPart))
              : (sched ? (sched.crew_info || '-') : '-');

            const formatNumber = (val) => {
              const num = parseInt(val);
              return isNaN(num) ? '0' : num.toLocaleString();
            };

            const replacements = {
              status_change_title: title,
              flight_no: cleanFltNo,
              ac_reg: cleanACREG,
              old_ac_reg: oldAcRegVal,
              ac_type: flt.ACTYPE ? flt.ACTYPE.trim() : '-',
              route: `${flt.DEP_AP_SCHED || ''}-${flt.ARR_AP_SCHED || ''}`,
              gate: sched ? (sched.gate || '-') : '-',
              old_gate: '-',
              crew_info: crewInfoVal, // Chứa tag Zalo trực tiếp
              truck_no: sched ? (sched.truck_no || '-') : '-',
              standby_fuel: formatNumber(detail.standby_fuel),
              old_standby_fuel: oldStandbyFuelVal,
              fuel_order: formatNumber(detail.fuel_order),
              old_fuel_order: oldFuelOrderVal,
              time_fuel: sched && sched.time_fuel ? sched.time_fuel : '-',
              time_arr: sched && sched.time_arr ? sched.time_arr : '-',
              time_dep: sched && sched.time_dep ? sched.time_dep : '-',
              notify_time: getVietnamDateTimeStr()
            };

            let msg = template;
            // Nếu chỉ thay đổi giờ bay ETD, soạn tin nhắn theo đúng mẫu Khầy yêu cầu
            if (isEtdChanged && !isNewStandby && !isNewFuelOrder && !isFuelChanged && !isAcRegChanged && !isGateChanged) {
              const oldEtdVal = oldEtd || '-';
              const newEtdVal = newEtd || '-';
              const crewVal = crewInfoVal;
              msg = `${title}
✈️ Chuyến bay: ${cleanFltNo} - ${cleanACREG || '-'}
⛽ Giờ bay ETD (dự kiến) cũ: ${oldEtdVal}'
⛽ Giờ bay ETD (dự kiến) mới: ${newEtdVal}'
Yêu cầu ĐIỀU HÀNH & Cặp tra nạp [${crewVal}] check chéo thông tin.
📢 Giờ thông báo: ${replacements.notify_time}`;
            } else {
              // Đối với các trường hợp khác, dùng template soạn sẵn bình thường
              for (const [key, value] of Object.entries(replacements)) {
                const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
                msg = msg.replace(regex, value);
              }

              // Tự động lọc dòng thông minh chi tiết (Fine-grained Smart Filtering)
              const lines = msg.split('\n');
              const filteredLines = lines.filter(line => {
                const lower = line.toLowerCase();
                
                // 1. Dòng chứa Số hiệu tàu cũ/mới: Chỉ hiển thị khi có đổi tàu
                if (lower.includes('số hiệu tàu cũ') || lower.includes('old_ac_reg') || (lower.includes('tàu') && lower.includes('cũ') && lower.includes('mới'))) {
                  return !!isAcRegChanged;
                }
                
                // 2. Dòng chứa Tải dầu Standby cũ/mới: Chỉ hiển thị khi Standby thay đổi hoặc mới xuất hiện
                if (lower.includes('tải dầu standby cũ') || lower.includes('old_standby_fuel') || (lower.includes('standby') && lower.includes('cũ') && lower.includes('mới'))) {
                  return !!(isStandbyChanged || isNewStandby);
                }
                
                // 3. Dòng chứa Tải dầu Chính thức cũ/mới: Chỉ hiển thị khi Chính thức thay đổi hoặc mới xuất hiện
                if (lower.includes('tải dầu chính thức cũ') || lower.includes('old_fuel_order') || (lower.includes('chính thức') && lower.includes('cũ') && lower.includes('mới'))) {
                  return !!(isNewFuelOrder || isFuelOrderChanged);
                }

                // 4. Dòng chứa Vị trí đỗ: Chỉ hiển thị khi vị trí đỗ có thay đổi (Ngoại trừ dòng đó chứa Tổ nạp/Cặp tra nạp/Người trực)
                if ((lower.includes('vị trí đỗ') || lower.includes('gate') || lower.includes('vị trí:')) && 
                    !lower.includes('tổ nạp') && !lower.includes('cặp tra nạp') && !lower.includes('crew') && !lower.includes('người trực')) {
                  return !!isGateChanged;
                }

                return true;
              });

              // Gom lại và dọn dẹp các dòng trống liên tiếp bị thừa ra
              msg = filteredLines
                .map(line => line.trimEnd())
                .filter((line, index, arr) => {
                  if (line === '' && index > 0 && arr[index - 1] === '') return false;
                  return true;
                })
                .join('\n');

              // Đảm bảo tin nhắn luôn có dòng Giờ thông báo ở cuối
              if (!msg.includes('Giờ thông báo')) {
                msg += `\n📢 Giờ thông báo: ${replacements.notify_time}`;
              }
            }

          // Lấy cấu hình gửi tin nhắn trực tiếp qua Bot SkyOne từ settings
          const notifySetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_notify_enabled'");
          const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
          
          const isSkyOneEnabled = notifySetting ? (notifySetting.value === 'true') : false;
          const targetGroupId = groupSetting ? groupSetting.value : null;

          if (isSkyOneEnabled) {
            const notifyType = sched ? (sched.notify_type || 1) : 1;
            const crewZaloUidsStr = sched ? (sched.crew_zalo_uids || '') : '';
            const uids = crewZaloUidsStr.split(',').map(uid => uid.trim()).filter(Boolean);

            let msgGroup = msg;
            let groupMentions = [];

            // Nếu cần gửi vào nhóm (notifyType === 1 hoặc 3)
            if ((notifyType === 1 || notifyType === 3) && targetGroupId) {
              // Tìm vị trí tag Zalo của driver và operator trong thân tin nhắn
              if (driverMentionInfo) {
                const pos = msg.indexOf(driverMentionInfo.tagLabel);
                if (pos !== -1) {
                  groupMentions.push({
                    pos: pos,
                    uid: driverMentionInfo.uid,
                    len: driverMentionInfo.tagLabel.length
                  });
                }
              }
              
              if (operatorMentionInfo) {
                const pos = msg.indexOf(operatorMentionInfo.tagLabel);
                if (pos !== -1) {
                  groupMentions.push({
                    pos: pos,
                    uid: operatorMentionInfo.uid,
                    len: operatorMentionInfo.tagLabel.length
                  });
                }
              }

              // Fallback: Nếu không tag được ai (chưa liên kết Zalo) và tin nhắn gốc không chứa thông tin cặp tra nạp
              if (groupMentions.length === 0 && sched && sched.crew_info) {
                const rawCrew = String(sched.crew_info).trim();
                const hasCrewInMsg = rawCrew && msg.toUpperCase().includes(rawCrew.toUpperCase());
                if (!hasCrewInMsg) {
                  msgGroup = msg + `\n👥 Tổ trực: ${sched.crew_info}`;
                }
              }

              const groupIds = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
              groupIds.forEach(id => {
                sendSkyEyesMessage(id, msgGroup, groupMentions)
                  .then(() => log(`[SkyOne] Đã gửi thông báo trực tiếp cho chuyến bay ${cleanFltNo} tới nhóm ${id} thành công!`))
                  .catch(err => console.error(`[SkyOne] Gửi tới nhóm ${id} thất bại:`, err.message));
              });
            }

            // Nếu cần gửi inbox cá nhân riêng (notifyType === 2 hoặc 3)
            if ((notifyType === 2 || notifyType === 3) && uids.length > 0) {
              uids.forEach(uid => {
                sendSkyEyesPrivateMessage(uid, msg)
                  .then(() => log(`[SkyOne] Đã gửi tin nhắn riêng cho chuyến bay ${cleanFltNo} tới UID ${uid} thành công!`))
                  .catch(err => console.error(`[SkyOne] Gửi tin nhắn riêng tới UID ${uid} thất bại:`, err.message));
              });
            }
          }

          // Gửi qua Webhook Bot Zalo cũ làm phương án dự phòng (fallback)
          sendZaloNotification(msg).catch(err => console.error('[Zalo Bot cũ] Lỗi gửi thông báo:', err.message));
          }

          // Tính toán các giá trị cảnh báo mới
          const oldWarnAcReg = oldOrder ? (oldOrder.warn_ac_reg || 0) : 0;
          const oldWarnStandby = oldOrder ? (oldOrder.warn_standby || 0) : 0;
          const oldWarnFuelOrder = oldOrder ? (oldOrder.warn_fuel_order || 0) : 0;
          const oldWarnEtd = oldOrder ? (oldOrder.warn_etd || 0) : 0;
          const oldWarnUpdatedAt = oldOrder ? oldOrder.warn_updated_at : null;

          const warnAcRegVal = isAcRegChanged ? 1 : oldWarnAcReg;
          const warnStandbyVal = (isStandbyChanged || isNewStandby) ? 1 : oldWarnStandby;
          const warnFuelOrderVal = (isFuelOrderChanged || isNewFuelOrder) ? 1 : oldWarnFuelOrder;
          const warnEtdVal = isEtdChanged ? 1 : oldWarnEtd;
          
          let warnUpdatedAtVal = oldWarnUpdatedAt;
          if (isAcRegChanged || isStandbyChanged || isNewStandby || isFuelOrderChanged || isNewFuelOrder || isEtdChanged) {
            warnUpdatedAtVal = new Date().toISOString();
          }

          // Trực quan hóa giá trị cũ để hiển thị trên UI
          const oldAcRegDb = oldOrder ? oldOrder.old_ac_reg : null;
          const oldStandbyDb = oldOrder ? oldOrder.old_standby_fuel : null;
          const oldFuelOrderDb = oldOrder ? oldOrder.old_fuel_order : null;
          const oldEtdDb = oldOrder ? oldOrder.old_etd : null;

          // Khi có thay đổi thì lưu lại giá trị cũ (trước khi thay đổi)
          // Nếu không đổi nhưng đang trong thời gian nhấp nháy, giữ lại giá trị cũ để render
          const finalOldAcReg = isAcRegChanged ? oldOrder.ac_reg : (warnAcRegVal === 1 ? oldAcRegDb : null);
          const finalOldStandby = isStandbyChanged ? oldOrder.standby_fuel : (warnStandbyVal === 1 ? oldStandbyDb : null);
          const finalOldFuelOrder = isFuelOrderChanged ? oldOrder.fuel_order : (warnFuelOrderVal === 1 ? oldFuelOrderDb : null);
          const finalOldEtd = isEtdChanged ? oldOrder.etd : (warnEtdVal === 1 ? oldEtdDb : null);

          // Lưu hoặc cập nhật vào database SQLite
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
            flt.ACREG ? flt.ACREG.trim() : '',
            flt.ACTYPE ? flt.ACTYPE.trim() : '',
            `${flt.DEP_AP_SCHED || ''} - ${flt.ARR_AP_SCHED || ''}`,
            detail.standby_fuel,
            detail.fuel_order,
            detail.trip_fuel,
            detail.trip_time,
            detail.taxi_fuel,
            detail.alternate,
            status,
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
  return str.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
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

    const flightsToSync = [];

    for (const rowHtml of rows) {
      if (!rowHtml.includes('parent')) continue;

      const codeMatch = rowHtml.match(/id="Code"[^>]*>([\s\S]*?)<\/span>/i);
      const flightNo = codeMatch ? codeMatch[1].trim().toUpperCase().replace(/\s+/g, '') : '';
      if (!flightNo) continue;

      // ID FMS của chuyến bay từ checkbox value
      const idMatch = rowHtml.match(/value="(\d+)"/);
      const idFms = idMatch ? idMatch[1] : '';

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
    for (const flight of flightsToSync) {
      await db.run(`
        INSERT INTO fms_flights_live (
          flight_no, ac_type, ac_reg, route, time_arr, time_dep, time_fuel,
          gate, truck_no, driver_name, operator_name, standby_fuel, fuel_order, status, date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          created_at = CURRENT_TIMESTAMP
      `, 
        flight.flight_no, flight.ac_type, flight.ac_reg, flight.route, 
        flight.time_arr, flight.time_dep, flight.time_fuel, flight.gate, 
        flight.truck_no || '', flight.driver_name, flight.operator_name, flight.standby_fuel, 
        flight.fuel_order, flight.status, flight.date
      );
      insertCount++;
    }
    console.log(`[FMS Skypec Live] Đồng bộ thành công ${insertCount} chuyến bay của ngày: ${targetDate}`);
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
  getVietnamDbDateStr
};
