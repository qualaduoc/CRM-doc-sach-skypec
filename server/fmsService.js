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

// Biến lưu cookie đăng nhập FMS trong bộ nhớ cache
let cachedFmsCookie = null;

// Thực hiện đăng nhập FMS bằng HTTP
async function loginFMS() {
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
          return reject(new Error('Không tìm thấy __RequestVerificationToken trong HTML đăng nhập!'));
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
              return reject(new Error(`Đăng nhập FMS thất bại, HTTP Code: ${postRes.statusCode}`));
            }
            
            const postCookies = postRes.headers['set-cookie'] || [];
            let authCookieStr = cookieStr;
            if (postCookies.length > 0) {
              authCookieStr = postCookies.map(c => c.split(';')[0]).join('; ');
            }
            cachedFmsCookie = authCookieStr; // Lưu vào cache
            resolve(authCookieStr);
          });
        });

        req.on('error', reject);
        req.write(postData);
        req.end();
      });
    }).on('error', reject);
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
      // Chỉ dọn dẹp lịch bay cũ hơn ngày hôm trước (date < todayDb - 1 ngày) để giữ lại ca đêm hôm trước
      const todayDateObj = new Date(todayDb + 'T00:00:00');
      const limitDateObj = new Date(todayDateObj.getTime() - 24 * 60 * 60 * 1000);
      const limitDateStr = limitDateObj.toISOString().split('T')[0];
      const deletedRows = await db.run('DELETE FROM fms_schedules WHERE date < ?', limitDateStr);
      if (deletedRows && deletedRows.changes > 0) {
        log(`[Dọn dẹp DB] Đã xóa ${deletedRows.changes} dòng lịch bay cũ (cũ hơn ngày hôm trước).`);
      }
    } catch (cleanupErr) {
      console.error('[Dọn dẹp DB] Lỗi khi dọn dẹp lịch bay cũ:', cleanupErr.message);
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
      // 1. Quét dải 3 ngày liên tiếp: Hôm trước, Hôm nay, Hôm sau để tránh lệch múi giờ và bắt chuyến rạng sáng (00h00 - 07h00)
      const todayDate = new Date();
      // Chuyển múi giờ Việt Nam GMT+7
      const utc = todayDate.getTime() + (todayDate.getTimezoneOffset() * 60000);
      const vnTime = new Date(utc + (3600000 * 7));

      // Ngày hôm trước
      const yesterdayDate = new Date(vnTime.getTime() - 24 * 60 * 60 * 1000);
      const yesterdayDb = yesterdayDate.toISOString().split('T')[0];

      // Ngày hôm sau
      const tomorrowDate = new Date(vnTime.getTime() + 24 * 60 * 60 * 1000);
      const tomorrowDb = tomorrowDate.toISOString().split('T')[0];

      targetDates = [yesterdayDb, todayDb, tomorrowDb];
    }
    
    log(`Các ngày sẽ thực hiện quét FMS: ${targetDates.join(', ')}`);

    // 2. Sử dụng cookie đã được lưu cache hoặc tiến hành đăng nhập mới
    let activeCookie = cachedFmsCookie;
    if (!activeCookie) {
      log('Chưa có cookie cache. Tiến hành đăng nhập FMS...');
      activeCookie = await loginFMS();
    } else {
      log('Sử dụng cookie FMS từ cache bộ nhớ.');
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
      } catch (err) {
        log(`Cookie FMS bị lỗi hoặc hết hạn. Đang tiến hành đăng nhập lại... Chi tiết lỗi: ${err.message || JSON.stringify(err)}`);
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

          const oldOrder = await db.get('SELECT status, fuel_order, standby_fuel, ac_reg, warn_ac_reg, warn_standby, warn_fuel_order, warn_updated_at, old_ac_reg, old_standby_fuel, old_fuel_order FROM fms_fuel_orders WHERE flight_no = ?', cleanFltNo + '_' + targetDate);

          const cleanACREG = flt.ACREG ? flt.ACREG.trim() : '';
          const oldStandby = oldOrder ? (parseInt(oldOrder.standby_fuel) || 0) : 0;
          const oldFuelOrder = oldOrder ? (parseInt(oldOrder.fuel_order) || 0) : 0;
          const newStandby = parseInt(detail.standby_fuel) || 0;
          const newFuelOrder = parseInt(detail.fuel_order) || 0;

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
          const shouldNotify = oldOrder ? (isNewStandby || isNewFuelOrder || isFuelChanged || isAcRegChanged) : false;

          if (shouldNotify) {
            // Lấy thông tin lịch trực bay chi tiết (tổ lái - thợ bơm, số xe, vị trí đỗ) đúng theo ngày bay thực tế fms_date (kèm cấu hình Zalo)
            const sched = await db.get('SELECT crew_info, truck_no, gate, time_arr, time_dep, time_fuel, crew_zalo_uids, notify_type FROM fms_schedules WHERE flight_no = ? AND COALESCE(fms_date, date) = ?', cleanFltNo, targetDate);
            
            let title = '🔔 [FMS BÁO TẢI DẦU MỚI]';
            if (isNewStandby && !isNewFuelOrder) {
              title = '🔔 [FMS BÁO TẢI DẦU STANDBY MỚI]';
            } else if (isNewFuelOrder) {
              title = '⛽ [FMS BÁO TẢI DẦU CHÍNH THỨC MỚI]';
            } else if (isFuelChanged) {
              title = '🔄 [FMS CẬP NHẬT SỐ LIỆU TẢI DẦU]';
            } else if (isAcRegChanged) {
              title = '🛩️ [FMS CẢNH BÁO THAY ĐỔI TÀU BAY]';
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
⏰ Giờ Hạ/Cất: Hạ {{time_arr}} | Cất {{time_dep}}`;
            }

            // Đảm bảo dòng Chuyến bay luôn có định dạng {{flight_no}} - {{ac_reg}} để nhận diện
            if (template.includes('{{flight_no}}') && !template.includes('{{flight_no}} - {{ac_reg}}') && !template.includes('{{flight_no}}-{{ac_reg}}')) {
              template = template.replace('{{flight_no}}', '{{flight_no}} - {{ac_reg}}');
            }

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
              crew_info: sched ? (sched.crew_info || '-') : '-',
              truck_no: sched ? (sched.truck_no || '-') : '-',
              standby_fuel: formatNumber(detail.standby_fuel),
              old_standby_fuel: oldStandbyFuelVal,
              fuel_order: formatNumber(detail.fuel_order),
              old_fuel_order: oldFuelOrderVal,
              time_fuel: sched && sched.time_fuel ? sched.time_fuel : '-',
              time_arr: sched && sched.time_arr ? sched.time_arr : '-',
              time_dep: sched && sched.time_dep ? sched.time_dep : '-'
            };

            let msg = template;
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
              if (uids.length > 0) {
                try {
                  const placeholders = uids.map(() => '?').join(',');
                  const mappings = await db.all(`SELECT zalo_uid, zalo_name FROM zalo_user_mappings WHERE zalo_uid IN (${placeholders})`, uids);
                  const nameMap = {};
                  mappings.forEach(m => {
                    nameMap[m.zalo_uid] = m.zalo_name || m.zalo_uid;
                  });

                  let tagPrefix = '\n👥 Người trực: ';
                  let msgWithTags = msg + tagPrefix;
                  uids.forEach(uid => {
                    const zaloName = nameMap[uid] || 'Thành viên';
                    const tagLabel = `@${zaloName}`;
                    const startPos = msgWithTags.length;
                    msgWithTags += tagLabel + ' ';
                    groupMentions.push({
                      pos: startPos,
                      uid: uid,
                      len: tagLabel.length
                    });
                  });
                  msgGroup = msgWithTags.trimEnd();
                } catch (mentionErr) {
                  console.error('[Mentions Build Error]', mentionErr.message);
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
          const oldWarnUpdatedAt = oldOrder ? oldOrder.warn_updated_at : null;

          const warnAcRegVal = isAcRegChanged ? 1 : oldWarnAcReg;
          const warnStandbyVal = (isStandbyChanged || isNewStandby) ? 1 : oldWarnStandby;
          const warnFuelOrderVal = (isFuelOrderChanged || isNewFuelOrder) ? 1 : oldWarnFuelOrder;
          
          let warnUpdatedAtVal = oldWarnUpdatedAt;
          if (isAcRegChanged || isStandbyChanged || isNewStandby || isFuelOrderChanged || isNewFuelOrder) {
            warnUpdatedAtVal = new Date().toISOString();
          }

          // Trực quan hóa giá trị cũ để hiển thị trên UI
          const oldAcRegDb = oldOrder ? oldOrder.old_ac_reg : null;
          const oldStandbyDb = oldOrder ? oldOrder.old_standby_fuel : null;
          const oldFuelOrderDb = oldOrder ? oldOrder.old_fuel_order : null;

          // Khi có thay đổi thì lưu lại giá trị cũ (trước khi thay đổi)
          // Nếu không đổi nhưng đang trong thời gian nhấp nháy, giữ lại giá trị cũ để render
          const finalOldAcReg = isAcRegChanged ? oldOrder.ac_reg : (warnAcRegVal === 1 ? oldAcRegDb : null);
          const finalOldStandby = isStandbyChanged ? oldOrder.standby_fuel : (warnStandbyVal === 1 ? oldStandbyDb : null);
          const finalOldFuelOrder = isFuelOrderChanged ? oldOrder.fuel_order : (warnFuelOrderVal === 1 ? oldFuelOrderDb : null);

          // Lưu hoặc cập nhật vào database SQLite
          await db.run(`
            INSERT INTO fms_fuel_orders (
              flight_no, ac_reg, ac_type, dep_arr, standby_fuel, fuel_order, 
              trip_fuel, trip_time, taxi_fuel, alternate, status,
              warn_ac_reg, warn_standby, warn_fuel_order, warn_updated_at,
              old_ac_reg, old_standby_fuel, old_fuel_order,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
              warn_updated_at = excluded.warn_updated_at,
              old_ac_reg = excluded.old_ac_reg,
              old_standby_fuel = excluded.old_standby_fuel,
              old_fuel_order = excluded.old_fuel_order,
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
            warnUpdatedAtVal,
            finalOldAcReg,
            finalOldStandby,
            finalOldFuelOrder
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

// Khởi chạy tiến trình quét ngầm định kỳ
let workerInterval = null;
function startFmsWorker(intervalMs = 3 * 60 * 1000) { // Mặc định quét mỗi 3 phút
  if (workerInterval) {
    clearInterval(workerInterval);
  }
  
  // Chạy lần đầu tiên
  setTimeout(() => {
    syncFMSData();
  }, 5000);

  workerInterval = setInterval(() => {
    syncFMSData();
  }, intervalMs);
  
  log(`Đã khởi chạy tiến trình quét ngầm FMS (Chu kỳ: ${intervalMs / 1000}s)`);
}

module.exports = {
  syncFMSData,
  startFmsWorker,
  getVietnamDbDateStr
};
