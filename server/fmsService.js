const http = require('http');
const querystring = require('querystring');
const { getDb } = require('./db');

const HOST = 'fms.vietnamairlines.com';

function log(msg) {
  console.log(`[FMS Service] [${new Date().toISOString()}] ${msg}`);
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

// Thực hiện đăng nhập FMS bằng HTTP
async function loginFMS() {
  return new Promise((resolve, reject) => {
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
        'User-Agent': 'Mozilla/5.0'
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Tải danh sách chuyến bay thất bại, HTTP Code: ${res.statusCode}`));
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
        'User-Agent': 'Mozilla/5.0'
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

// Thực hiện đồng bộ hóa toàn bộ chuyến bay trong lịch trực từ FMS
async function syncFMSData() {
  log('Bắt đầu chu kỳ quét tải dầu FMS...');
  try {
    const db = await getDb();
    const todayDb = getVietnamDbDateStr();
    
    // 1. Lấy danh sách các chuyến bay cần theo dõi của ngày hôm nay
    const schedules = await db.all('SELECT DISTINCT flight_no FROM fms_schedules WHERE date = ?', todayDb);
    if (schedules.length === 0) {
      log('Hôm nay không có chuyến bay nào trong lịch trực được phân công.');
      return;
    }

    const flightNumbers = schedules.map(s => s.flight_no.toUpperCase().replace(/\s+/g, ''));
    log(`Danh sách chuyến bay cần theo dõi (${flightNumbers.length} chuyến): ${flightNumbers.join(', ')}`);

    // 2. Đăng nhập FMS
    const authCookie = await loginFMS();
    log('Đăng nhập FMS thành công!');

    // 3. Tải danh sách chuyến bay từ FMS
    const todayFmsStr = getVietnamDateStr();
    const fmsFlights = await fetchFMSData(todayFmsStr, authCookie);
    log(`Đã tải danh sách chuyến bay ngày hôm nay từ FMS, tổng cộng ${fmsFlights.length} chuyến.`);

    // 4. Lọc các chuyến bay khớp với lịch trực
    const matchedFlights = fmsFlights.filter(f => {
      if (!f.FLIGHTNO) return false;
      const cleanFltNo = f.FLIGHTNO.toUpperCase().replace(/\s+/g, '');
      return flightNumbers.includes(cleanFltNo);
    });

    log(`Tìm thấy ${matchedFlights.length} chuyến bay khớp trên FMS.`);

    // 5. Quét chi tiết tải dầu cho từng chuyến bay khớp
    for (const flt of matchedFlights) {
      const cleanFltNo = flt.FLIGHTNO.toUpperCase().replace(/\s+/g, '');
      const legNo = flt.LEG_NO;

      try {
        log(`Đang quét chi tiết chuyến bay: ${cleanFltNo} (LEG_NO: ${legNo})...`);
        const detail = await fetchFlightDetail(legNo, authCookie);

        // Xác định trạng thái tải dầu
        // Nếu có số liệu Pilot Request hoặc Block Fuel > 0
        const hasOrder = parseInt(detail.fuel_order) > 0 || parseInt(detail.standby_fuel) > 0;
        const status = hasOrder ? 'Đã có số liệu' : 'Chờ cập nhật';

        // Lưu hoặc cập nhật vào database
        await db.run(`
          INSERT INTO fms_fuel_orders (
            flight_no, ac_reg, ac_type, dep_arr, standby_fuel, fuel_order, 
            trip_fuel, trip_time, taxi_fuel, alternate, status, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
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
            updated_at = CURRENT_TIMESTAMP
        `, 
          cleanFltNo,
          flt.ACREG ? flt.ACREG.trim() : '',
          flt.ACTYPE ? flt.ACTYPE.trim() : '',
          `${flt.DEP_AP_SCHED || ''} - ${flt.ARR_AP_SCHED || ''}`,
          detail.standby_fuel,
          detail.fuel_order,
          detail.trip_fuel,
          detail.trip_time,
          detail.taxi_fuel,
          detail.alternate,
          status
        );
        log(`Cập nhật thành công chuyến bay ${cleanFltNo}: Fuel Order = ${detail.fuel_order} kg, Trạng thái = ${status}`);
      } catch (fltErr) {
        console.error(`[FMS Service] Lỗi khi quét chi tiết chuyến bay ${cleanFltNo}:`, fltErr.message);
      }
    }

    log('Hoàn thành chu kỳ quét tải dầu FMS!');
  } catch (err) {
    console.error('[FMS Service] Lỗi đồng bộ FMS:', err.message);
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
