require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const https = require('https');
const querystring = require('querystring');
const path = require('path');
const { getDb } = require('./db');
const { startLearning, stopLearning, initEngine, activeConnections, fetchActualProgress, checkAndAutoSubmitSurveys, surveyStatuses } = require('./lrsEngine');
const { syncFMSData, syncFmsSkypecLive, startFmsWorker, getVietnamDbDateStr, getVietnamDateTimeStr, isDomesticRoute, isDepartingIntlRoute } = require('./fmsService');
const { evaluateAirlineMismatch, listAirlineMappings } = require('./airlineCodes');
const { performImageOCR, testSingleGeminiKey } = require('./ocrService');
const { initZaloBot, startQRLogin, getBotGroups, logoutBot, sendSkyEyesMessage, sendSkyEyesPrivateMessage, getBotState } = require('./zaloService');


const app = express();
const PORT = process.env.PORT || 3005; // Chạy ở cổng 3005 để tránh xung đột
const JWT_SECRET = process.env.JWT_SECRET || 'crm-skypec-secret-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'd6F3EFEa15839011290abcdef1234567'; // Phải đúng 32 ký tự
const IV_LENGTH = 16;
const HOST = 'elearning.skypec.com.vn';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, '../public')));

// --- CÁC HÀM HELPER MÃ HÓA MẬT KHẨU ---
function encrypt(text) {
  try {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
  } catch (e) {
    return text;
  }
}

function decrypt(text) {
  try {
    let textParts = text.split(':');
    let iv = Buffer.from(textParts.shift(), 'hex');
    let encryptedText = Buffer.from(textParts.join(':'), 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return text;
  }
}

// --- CÁC HÀM GỌI API SKYPEC ---
function loginSkypec(username, password) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      grant_type: 'password',
      client_id: 'web',
      username: username,
      password: password,
      scope: ''
    });

    const options = {
      hostname: HOST, port: 443,
      path: '/skypec2.authentication.api/connect/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'Accept-Encoding': 'identity'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(JSON.parse(body));
        } else if (res.statusCode === 400) {
          reject(new Error('Có vẻ anh zai sai Mật khẩu rồi! gõ chuẩn vào đê!'));
        } else {
          reject(new Error(`Đăng nhập Skypec thất bại (Mã lỗi: ${res.statusCode})`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function fetchSkypecProfile(token, username) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.hr.api/api/v1/HrProfile/FeGetByUserInfo/${encodeURIComponent(username)}`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(body));
        else reject(new Error(`Không thể lấy profile Skypec (Mã: ${res.statusCode})`));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function fetchSkypecKPI(token, year = new Date().getFullYear()) {
  return new Promise((resolve) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsHistory/SearchKPI?year=${year}&month=0`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function fetchSkypecCertificates(token) {
  return new Promise((resolve) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsHistory/GetTotalCertificate`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function fetchSkypecCurrentClasses(token) {
  return new Promise((resolve) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsHistory/FeClassCurrent?order=1`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function registerSkypecClass(token, classId) {
  return new Promise((resolve) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsClass/FrUserRegisterClass/${classId}`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve({ status: false, message: 'Lỗi giải mã JSON phản hồi đăng ký' });
          }
        } else {
          resolve({ status: false, message: `Lỗi máy chủ Skypec (Mã: ${res.statusCode})` });
        }
      });
    });
    req.on('error', (err) => resolve({ status: false, message: err.message }));
    req.end();
  });
}

async function syncUserStats(username, token) {
  const db = await getDb();
  try {
    const [kpiRes, certRes, classRes] = await Promise.all([
      fetchSkypecKPI(token),
      fetchSkypecCertificates(token),
      fetchSkypecCurrentClasses(token)
    ]);

    let positionName = 'Học viên Skypec';
    let kpiPercent = 0;
    let kpiTotal = 0;
    let kpiCurrent = 0;
    let totalCertificate = 0;
    let classTotal = 0;

    if (kpiRes && kpiRes.status && kpiRes.data) {
      positionName = kpiRes.data.positionName || 'Học viên Skypec';
      kpiPercent = kpiRes.data.studentPercent || 0;
      kpiTotal = kpiRes.data.studentTotal || 0;
      kpiCurrent = kpiRes.data.studentCurrent || 0;
    }

    if (certRes && certRes.status) {
      totalCertificate = certRes.data || 0;
    }

    if (classRes && classRes.status && classRes.data && classRes.data.details) {
      classTotal = classRes.data.details.length || 0;
    }

    let displayName = null;
    if (kpiRes && kpiRes.status && kpiRes.data && kpiRes.data.displayName) {
      displayName = kpiRes.data.displayName;
    }

    await db.run(`
      UPDATE accounts SET
        display_name = COALESCE(?, display_name),
        position_name = ?,
        kpi_percent = ?,
        kpi_total = ?,
        kpi_current = ?,
        total_certificate = ?,
        class_total = ?
      WHERE username = ?
    `, displayName, positionName, kpiPercent, kpiTotal, kpiCurrent, totalCertificate, classTotal, username);

    console.log(`[Sync] Đã cập nhật chỉ số KPI cho: ${username} (KPI: ${kpiPercent}%, Lớp: ${classTotal})`);
  } catch (err) {
    console.error(`[Sync Stats Error] Không thể cập nhật chỉ số KPI cho ${username}:`, err.message);
  }
}

function fetchSkypecClasses(token, year) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      year: year,
      month: 0,
      key: '',
      status: -1,
      isFinish: -1,
      pageIndex: 1,
      pageSize: 100,
      orderId: 0
    });

    const options = {
      hostname: HOST, port: 443,
      path: '/skypec2.lms.api/api/v1/LmsHistory/SearchClass',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept-Encoding': 'identity'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(body));
        else reject(new Error(`Lấy danh sách lớp thất bại (Mã: ${res.statusCode})`));
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function fetchFirstLessonId(token, classId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsClassContent/frGetByClassId/${classId}`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(body);
            if (json.status && json.data && json.data.length > 0) {
              // Tìm bài học tính phút học đầu tiên (không phải khảo sát, không phải bài thi/kiểm tra)
              const validLesson = json.data.find(item => {
                const typeTitle = (item.type && item.type.title) ? item.type.title.toLowerCase() : '';
                const itemTitle = item.title ? item.title.toLowerCase() : '';
                
                // Loại trừ khảo sát và bài thi/kiểm tra
                const isSurvey = typeTitle.includes('khảo sát') || typeTitle.includes('survey') || itemTitle.includes('khảo sát');
                const isTest = typeTitle.includes('test') || typeTitle.includes('thi') || typeTitle.includes('kiểm tra') || itemTitle.includes('kiểm tra') || itemTitle.includes('bài thi');
                
                return !isSurvey && !isTest;
              });

              if (validLesson) {
                console.log(`[Sync] Lớp ${classId}: Chọn bài giảng hợp lệ "${validLesson.title}" (ID: ${validLesson.id}) để treo máy.`);
                resolve(validLesson.id);
              } else {
                // Fallback: nếu không tìm thấy bài nào thỏa mãn, chọn bài đầu tiên
                console.log(`[Sync] Lớp ${classId}: Không tìm thấy bài giảng, fallback chọn bài đầu tiên "${json.data[0].title}" (ID: ${json.data[0].id}).`);
                resolve(json.data[0].id);
              }
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}


function fetchClassDetails(token, classId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsClass/GetById?id=${classId}`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept-Encoding': 'identity'
      }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// --- MIDDLEWARE XÁC THỰC TOKEN ---
// JWT chỉ dùng để xác định username/role phiên; quyền perm_* luôn đọc lại từ DB
// → Admin hạ/nâng quyền có hiệu lực ngay, không cần user login lại.
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ success: false, error: 'Chưa cung cấp mã xác thực JWT' });

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Mã xác thực không hợp lệ hoặc đã hết hạn' });

    try {
      // Super Admin hệ thống (bảng admin) — full quyền cố định
      if (user && user.role === 'admin' && user.username === 'admin') {
        req.user = {
          ...user,
          role: 'admin',
          username: 'admin',
          perm_admin: 1,
          perm_fms: 1,
          perm_zalo: 1,
          perm_gemini: 1,
          perm_gate: 1
        };
        return next();
      }

      if (!user || !user.username) {
        return res.status(403).json({ success: false, error: 'Mã xác thực không hợp lệ' });
      }

      const db = await getDb();
      const row = await db.get(
        'SELECT perm_admin, perm_fms, perm_zalo, perm_gemini, perm_gate, status FROM accounts WHERE username = ?',
        user.username
      );

      if (!row) {
        return res.status(403).json({ success: false, error: 'Tài khoản không tồn tại hoặc đã bị xóa' });
      }

      if (row.status && String(row.status).toLowerCase() === 'disabled') {
        return res.status(403).json({ success: false, error: 'Tài khoản đã bị vô hiệu hóa' });
      }

      // Ghi đè perm_* từ DB (bỏ qua giá trị cũ trong JWT).
      // role JWT 'admin' chỉ hợp lệ với super admin ở nhánh trên — account Skypec luôn role=user.
      req.user = {
        ...user,
        role: 'user',
        username: user.username,
        perm_admin: row.perm_admin ? 1 : 0,
        perm_fms: row.perm_fms ? 1 : 0,
        perm_zalo: row.perm_zalo ? 1 : 0,
        perm_gemini: row.perm_gemini ? 1 : 0,
        perm_gate: row.perm_gate ? 1 : 0
      };
      next();
    } catch (e) {
      console.error('[Auth] Lỗi làm mới quyền từ DB:', e.message);
      return res.status(500).json({ success: false, error: 'Lỗi xác thực quyền truy cập' });
    }
  });
}

// --- API ĐĂNG NHẬP (ADMIN / NHÂN VIÊN) ---
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ tài khoản và mật khẩu' });
  }

  try {
    const db = await getDb();

    // 1. Kiểm tra nếu là Admin đăng nhập hệ thống LMS
    if (username.trim() === 'admin') {
      const adminRow = await db.get('SELECT * FROM admin WHERE username = ?', 'admin');
      if (adminRow && bcrypt.compareSync(password, adminRow.password)) {
        const token = jwt.sign({ 
          role: 'admin', 
          username: 'admin',
          perm_admin: 1,
          perm_fms: 1,
          perm_zalo: 1,
          perm_gemini: 1,
          perm_gate: 1
        }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ 
          success: true, 
          token, 
          role: 'admin', 
          displayName: 'Quản trị viên',
          permissions: {
            perm_admin: 1,
            perm_fms: 1,
            perm_zalo: 1,
            perm_gemini: 1,
            perm_gate: 1
          }
        });
      } else {
        return res.status(401).json({ success: false, error: 'Mật khẩu admin không chính xác' });
      }
    }

    // 2. Nếu là nhân viên đăng nhập bằng tài khoản Skypec thật
    console.log(`[Auth] Đăng nhập tài khoản nhân viên: ${username}`);
    const loginResult = await loginSkypec(username, password);
    const accessToken = loginResult.access_token;

    // Lấy thông tin cá nhân từ Skypec
    let displayName = username;
    let department = 'Học viên Skypec';

    // Giải mã JWT token của Skypec để lấy tên thật làm dự phòng
    try {
      const decoded = jwt.decode(accessToken);
      if (decoded) {
        displayName = decoded.fullname || decoded.displayname || username;
      }
    } catch (jwtErr) {
      console.warn(`[Auth Warning] Lỗi giải mã token Skypec cho ${username}:`, jwtErr.message);
    }

    try {
      const profileResult = await fetchSkypecProfile(accessToken, username);
      const profile = profileResult.data || {};
      displayName = profile.fullName || profile.employeeName || profile.hoTen || displayName;
      department = profile.departmentName || 'Học viên Skypec';
    } catch (profileErr) {
      console.warn(`[Auth Warning] Không lấy được profile cho ${username}:`, profileErr.message);
    }

    // Lưu/Cập nhật tài khoản vào cơ sở dữ liệu nội bộ (mã hóa mật khẩu)
    const encryptedPassword = encrypt(password);
    await db.run(`
      INSERT INTO accounts (username, password, display_name, department, access_token, status)
      VALUES (?, ?, ?, ?, ?, 'active')
      ON CONFLICT(username) DO UPDATE SET
        password = excluded.password,
        display_name = excluded.display_name,
        department = excluded.department,
        access_token = excluded.access_token,
        status = 'active'
    `, username, encryptedPassword, displayName, department, accessToken);

    // Đồng bộ danh sách lớp học của nhân viên này (các năm gần đây)
    await syncUserClasses(username, accessToken);
    await syncUserStats(username, accessToken);

    // Đọc phân quyền từ cơ sở dữ liệu
    const userRow = await db.get('SELECT perm_admin, perm_fms, perm_zalo, perm_gemini, perm_gate FROM accounts WHERE username = ?', username);
    const permAdmin = userRow ? (userRow.perm_admin || 0) : 0;
    const permFms = userRow ? (userRow.perm_fms || 0) : 0;
    const permZalo = userRow ? (userRow.perm_zalo || 0) : 0;
    const permGemini = userRow ? (userRow.perm_gemini || 0) : 0;
    const permGate = userRow ? (userRow.perm_gate || 0) : 0;

    // Tạo JWT token cho phiên làm việc
    const token = jwt.sign({ 
      role: 'user', 
      username: username,
      perm_admin: permAdmin,
      perm_fms: permFms,
      perm_zalo: permZalo,
      perm_gemini: permGemini,
      perm_gate: permGate
    }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ 
      success: true, 
      token, 
      role: 'user', 
      displayName, 
      department,
      permissions: {
        perm_admin: permAdmin,
        perm_fms: permFms,
        perm_zalo: permZalo,
        perm_gemini: permGemini,
        perm_gate: permGate
      }
    });

  } catch (err) {
    console.error('[Auth Error]', err.message);
    res.status(401).json({ success: false, error: err.message });
  }
});

// Hàm đồng bộ lớp học cho một tài khoản cụ thể
async function syncUserClasses(username, token) {
  const db = await getDb();
  console.log(`[Sync] Đang đồng bộ danh sách lớp cho: ${username}`);
  
  // Tải lớp học cho các năm 2024, 2025, 2026
  const years = [2024, 2025, 2026];
  let allClassItems = [];

  for (const y of years) {
    try {
      const res = await fetchSkypecClasses(token, y);
      if (res.status && res.data && res.data.details) {
        allClassItems = allClassItems.concat(res.data.details);
      }
    } catch (e) {
      console.error(`[Sync Error] Không thể tải lớp năm ${y} cho ${username}:`, e.message);
    }
  }

  // Lưu thông tin chi tiết của từng lớp
  for (const item of allClassItems) {
    const classId = item.id || item.classId;
    if (!classId) continue;

    try {
      // 1. Lấy classUserId và learningId từ API FrUserJoinClassNew
      const joinData = await fetchActualProgress(token, classId);
      if (joinData && joinData.status && joinData.data) {
        const classUserId = joinData.data.id;
        const learningHistories = joinData.data.lmsClassUserLearning || [];
        
        let learningId = null;
        // Lấy giá trị lớn nhất giữa totalTime ở cấp cao nhất và learnTime trong lịch sử phiên học lẻ
        let learnTime = joinData.data.totalTime || 0;
        let minTimeRequired = null;

        if (learningHistories.length > 0) {
          learningId = learningHistories[0].id;
          learningHistories.forEach(h => {
            if (h.learnTime && h.learnTime > learnTime) {
              learnTime = h.learnTime;
            }
          });
        }

        // Lấy thời gian yêu cầu tối thiểu thực tế từ API GetById
        try {
          const classDetails = await fetchClassDetails(token, classId);
          if (classDetails && classDetails.status && classDetails.data) {
            minTimeRequired = classDetails.data.minTimeRequired || null;
          }
        } catch (e) {
          console.warn(`[Sync Warning] Không lấy được minTimeRequired cho lớp ${classId}:`, e.message);
        }

        // 2. Lấy ID bài học đầu tiên làm contentId nếu chưa có
        let contentId = null;
        if (learningId) {
          contentId = await fetchFirstLessonId(token, classId);
        }

        // Tự động phát hiện và làm bài khảo sát chưa hoàn thành
        try {
          await checkAndAutoSubmitSurveys(token, classId, classUserId, joinData.data.userId, joinData.data.displayName, username, learningHistories);
        } catch (e) {
          console.error(`[Sync] Lỗi tự động nộp khảo sát cho lớp ${classId}:`, e.message);
        }

        const isFinish = (joinData.data.isFinish === 1 || joinData.data.isFinish === true) ? 1 : 0;

        // Tránh tình trạng tụt lùi số phút trên giao diện khi đồng bộ lúc lớp học vẫn đang treo ngầm
        const currentLocal = await db.get('SELECT learn_time, auto_learn FROM classes WHERE id = ? AND account_username = ?', classId, username);
        if (currentLocal && currentLocal.auto_learn === 1 && learnTime < currentLocal.learn_time) {
          // Giữ nguyên số phút tự đếm lớn hơn của hệ thống khi phiên học của Skypec chưa được đóng và ghi nhận
          learnTime = currentLocal.learn_time;
        }

        // 3. Tự động kiểm tra bài tập review
        let classExerciseId = null;
        let isExerciseFinished = 0;
        try {
          const exerciseRes = await new Promise((resEx) => {
            const options = {
              hostname: HOST, port: 443,
              path: `/skypec2.lms.api/api/v1/LmsClassExercise?classId=${classId}&limit=10&offset=0`,
              method: 'GET',
              headers: { 'Authorization': `Bearer ${token}`, 'Accept-Encoding': 'identity' }
            };
            const req = https.request(options, (res) => {
              let body = '';
              res.on('data', chunk => body += chunk);
              res.on('end', () => {
                if (res.statusCode === 200) {
                  try { resEx(JSON.parse(body)); } catch (e) { resEx(null); }
                } else resEx(null);
              });
            });
            req.on('error', () => resEx(null));
            req.end();
          });
          if (exerciseRes && exerciseRes.status && exerciseRes.data && exerciseRes.data.length > 0) {
            classExerciseId = exerciseRes.data[0].id;
            
            // Check xem đã nộp chưa
            if (classUserId) {
              const exUserRes = await new Promise((resExUser) => {
                const options = {
                  hostname: HOST, port: 443,
                  path: `/skypec2.lms.api/api/v1/LmsClassExerciseUser/${classUserId}`,
                  method: 'GET',
                  headers: { 'Authorization': `Bearer ${token}`, 'Accept-Encoding': 'identity' }
                };
                const req = https.request(options, (res) => {
                  let body = '';
                  res.on('data', chunk => body += chunk);
                  res.on('end', () => {
                    if (res.statusCode === 200) {
                      try { resExUser(JSON.parse(body)); } catch (e) { resExUser(null); }
                    } else resExUser(null);
                  });
                });
                req.on('error', () => resExUser(null));
                req.end();
              });
              if (exUserRes && exUserRes.status && exUserRes.data) {
                isExerciseFinished = (exUserRes.data.isFinish === true || exUserRes.data.isFinish === 1) ? 1 : 0;
              }
            }
          }
        } catch (exErr) {
          console.warn(`[Sync Warning] Lỗi check bài tập lớp ${classId}:`, exErr.message);
        }

        // Lưu vào DB cục bộ
        await db.run(`
          INSERT INTO classes (id, account_username, class_title, class_user_id, learning_id, content_id, learn_time, min_time_required, is_finish, class_exercise_id, is_exercise_finished)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id, account_username) DO UPDATE SET
            class_title = excluded.class_title,
            class_user_id = excluded.class_user_id,
            learning_id = excluded.learning_id,
            content_id = excluded.content_id,
            learn_time = excluded.learn_time,
            min_time_required = excluded.min_time_required,
            is_finish = excluded.is_finish,
            class_exercise_id = excluded.class_exercise_id,
            is_exercise_finished = excluded.is_exercise_finished
        `, classId, username, item.classTitle, classUserId, learningId, contentId, learnTime, minTimeRequired, isFinish, classExerciseId, isExerciseFinished);

        // Tự động dừng học ngầm nếu lớp học đã hoàn thành hoặc đạt đủ số phút
        if (isFinish === 1) {
          const prevClass = await db.get('SELECT auto_learn FROM classes WHERE id = ? AND account_username = ?', classId, username);
          if (prevClass && prevClass.auto_learn === 1) {
            console.log(`[Sync] Lớp học "${item.classTitle}" của ${username} đã hoàn thành. Tự động dừng học ngầm.`);
            await db.run('UPDATE classes SET auto_learn = 0 WHERE id = ? AND account_username = ?', classId, username);
            stopLearning(username, classId);
          }
        } else if (minTimeRequired && learnTime >= minTimeRequired) {
          const prevClass = await db.get('SELECT auto_learn FROM classes WHERE id = ? AND account_username = ?', classId, username);
          if (prevClass && prevClass.auto_learn === 1) {
            console.log(`[Sync] Lớp học "${item.classTitle}" của ${username} đã đạt đủ số phút tối thiểu. Tự động dừng học ngầm.`);
            await db.run('UPDATE classes SET auto_learn = 0, is_finish = 1 WHERE id = ? AND account_username = ?', classId, username);
            stopLearning(username, classId);
          }
        }
      }
    } catch (e) {
      console.error(`[Sync Error] Lỗi xử lý chi tiết lớp ${classId} của ${username}:`, e.message);
    }
  }
}

// --- CÁC API THAO TÁC HỆ THỐNG ---

// Lấy thông tin cá nhân hiện tại
app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    // authenticateToken đã refresh perm_* từ DB — /api/me phản ánh đúng quyền hiện tại
    if (req.user.role === 'admin' && req.user.username === 'admin') {
      return res.json({ 
        success: true, 
        user: { 
          role: 'admin', 
          username: 'admin', 
          display_name: 'Quản trị viên',
          department: 'Quản lý hệ thống',
          permissions: {
            perm_admin: 1,
            perm_fms: 1,
            perm_zalo: 1,
            perm_gemini: 1,
            perm_gate: 1
          }
        } 
      });
    }

    const db = await getDb();
    const user = await db.get('SELECT username, display_name, department, email, phone, position_name, kpi_percent, kpi_total, kpi_current, total_certificate, class_total, perm_admin, perm_fms, perm_zalo, perm_gemini, perm_gate FROM accounts WHERE username = ?', req.user.username);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản nhân viên' });
    }
    // Ưu tiên perm vừa refresh trên req.user (đồng bộ tuyệt đối với middleware)
    res.json({ 
      success: true, 
      user: { 
        ...user, 
        role: 'user',
        perm_admin: req.user.perm_admin,
        perm_fms: req.user.perm_fms,
        perm_zalo: req.user.perm_zalo,
        perm_gemini: req.user.perm_gemini,
        perm_gate: req.user.perm_gate,
        permissions: {
          perm_admin: req.user.perm_admin,
          perm_fms: req.user.perm_fms,
          perm_zalo: req.user.perm_zalo,
          perm_gemini: req.user.perm_gemini,
          perm_gate: req.user.perm_gate
        }
      } 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách tài khoản (Chỉ dành cho Admin)
app.get('/api/accounts', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1) return res.status(403).json({ success: false, error: 'Không có quyền truy cập' });

  try {
    const db = await getDb();
    const rows = await db.all('SELECT username, display_name, department, status, created_at, kpi_percent, perm_admin, perm_fms, perm_zalo, perm_gemini, perm_gate FROM accounts');
    
    // Đếm số lớp học đang chạy ngầm của từng tài khoản
    const accounts = rows.map(acc => {
      let activeCount = 0;
      activeConnections.forEach((conn, classId) => {
        // Kiểm tra xem classId này có thuộc về tài khoản này không
        const classRow = db.prepare ? null : true; // Đang sử dụng async
      });
      return acc;
    });

    // Cập nhật lại số kết nối đang chạy thực tế
    const dbClasses = await db.all('SELECT id, account_username FROM classes WHERE auto_learn = 1');
    const runningMap = {};
    dbClasses.forEach(c => {
      const connectionKey = `${c.account_username}_${c.id}`;
      if (activeConnections.has(connectionKey)) {
        runningMap[c.account_username] = (runningMap[c.account_username] || 0) + 1;
      }
    });

    const result = rows.map(acc => ({
      ...acc,
      runningCount: runningMap[acc.username] || 0
    }));

    res.json({ success: true, accounts: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Đồng bộ thủ công dữ liệu tài khoản (Admin đồng bộ tất cả, User chỉ đồng bộ của mình)
app.post('/api/accounts/:username/sync', authenticateToken, async (req, res) => {
  const targetUser = req.params.username;
  
  if (req.user.role !== 'admin' && req.user.username !== targetUser) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  try {
    const db = await getDb();
    const acc = await db.get('SELECT * FROM accounts WHERE username = ?', targetUser);
    if (!acc) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });

    // Cập nhật lại token mới từ đăng nhập thật
    const password = decrypt(acc.password);
    const loginResult = await loginSkypec(targetUser, password);
    
    await db.run('UPDATE accounts SET access_token = ?, status = "active" WHERE username = ?', loginResult.access_token, targetUser);
    await syncUserClasses(targetUser, loginResult.access_token);
    await syncUserStats(targetUser, loginResult.access_token);

    res.json({ success: true, message: 'Đồng bộ dữ liệu lớp học thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách lớp học (Admin lấy toàn bộ, User chỉ lấy của mình)
app.get('/api/classes', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    let rows = [];

    if (req.user.role === 'admin') {
      rows = await db.all(`
        SELECT classes.*, accounts.display_name 
        FROM classes 
        JOIN accounts ON classes.account_username = accounts.username
      `);
    } else {
      rows = await db.all('SELECT * FROM classes WHERE account_username = ?', req.user.username);
    }

    // Gắn thêm trạng thái kết nối WebSocket thực tế từ bộ máy Engine và tiến trình khảo sát
    const result = rows.map(c => {
      const connectionKey = `${c.account_username}_${c.id}`;
      return {
        ...c,
        isRunning: activeConnections.has(connectionKey),
        surveyStatus: surveyStatuses.get(connectionKey) || null
      };
    });

    res.json({ success: true, classes: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bật/Tắt chế độ tự động chạy ngầm cho lớp học
app.post('/api/classes/:classId/toggle-learn', authenticateToken, async (req, res) => {
  const classId = req.params.classId;
  const { auto_learn, username } = req.body; // 0 hoặc 1, nhận thêm username từ frontend

  try {
    const db = await getDb();
    
    // Xác định đối tượng tài khoản học viên cần thao tác
    const targetUsername = (req.user.role === 'admin' && username) ? username : req.user.username;
    
    const classItem = await db.get('SELECT * FROM classes WHERE id = ? AND account_username = ?', classId, targetUsername);
    if (!classItem) return res.status(404).json({ success: false, error: 'Không tìm thấy lớp học của nhân viên này' });

    // Kiểm tra quyền sở hữu (nếu không phải admin và username không khớp)
    if (req.user.role !== 'admin' && classItem.account_username !== req.user.username) {
      return res.status(403).json({ success: false, error: 'Không có quyền thao tác trên lớp học này' });
    }

    if (auto_learn === 1) {
      // Đếm số lớp đang treo của tài khoản này
      const activeCount = await db.get(
        'SELECT COUNT(*) as count FROM classes WHERE account_username = ? AND auto_learn = 1',
        targetUsername
      );
      
      // Lấy giới hạn cấu hình từ bảng settings
      let limit = 3;
      const limitSetting = await db.get('SELECT value FROM settings WHERE key = ?', 'max_active_classes');
      if (limitSetting) {
        limit = parseInt(limitSetting.value, 10) || 3;
      }

      if (activeCount.count >= limit) {
        return res.status(400).json({
          success: false,
          error: 'Tham vừa thôi! đọc nhiều cuốn 1 lúc để cháy máy à!'
        });
      }
    }

    // Cập nhật trạng thái tự học
    await db.run('UPDATE classes SET auto_learn = ? WHERE id = ? AND account_username = ?', auto_learn, classId, targetUsername);

    const account = await db.get('SELECT * FROM accounts WHERE username = ?', targetUsername);
    const decryptedPassword = decrypt(account.password);
    const accWithPlainPass = { ...account, password: decryptedPassword };

    if (auto_learn === 1) {
      // Bật chạy ngầm
      startLearning(accWithPlainPass, classItem);
    } else {
      // Dừng chạy ngầm
      stopLearning(targetUsername, classId);
    }

    res.json({ success: true, isRunning: auto_learn === 1 });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy cấu hình hệ thống (Admin lấy hoặc trả về giá trị mặc định)
app.get('/api/settings', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM settings');
    const settings = {};
    rows.forEach(r => {
      settings[r.key] = r.value;
    });
    // Nếu chưa có max_active_classes, trả về mặc định 3
    if (!settings.max_active_classes) {
      settings.max_active_classes = '3';
    }
    res.json({ success: true, settings });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật cấu hình hệ thống (Chỉ dành cho Admin)
app.post('/api/settings', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Không có quyền thao tác' });
  const { key, value } = req.body;
  if (!key || value === undefined) {
    return res.status(400).json({ success: false, error: 'Thiếu tham số cấu hình' });
  }
  try {
    const db = await getDb();
    await db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
    res.json({ success: true, message: 'Cập nhật cấu hình thành công' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bật chạy ngầm cho toàn bộ các tài khoản (Chỉ dành cho Admin)
app.post('/api/control/start-all', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Không có quyền thao tác' });

  try {
    const db = await getDb();
    await db.run('UPDATE classes SET auto_learn = 1');
    
    const activeClasses = await db.all(`
      SELECT classes.*, accounts.password, accounts.access_token 
      FROM classes 
      JOIN accounts ON classes.account_username = accounts.username 
      WHERE accounts.status = 'active'
    `);

    activeClasses.forEach(c => {
      const decryptedPassword = decrypt(c.password);
      const account = { username: c.account_username, password: decryptedPassword, access_token: c.access_token };
      startLearning(account, c);
    });

    res.json({ success: true, message: `Đã kích hoạt chạy ngầm cho tất cả ${activeClasses.length} lớp học.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Dừng toàn bộ hoạt động học tập chạy ngầm (Chỉ dành cho Admin)
app.post('/api/control/stop-all', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Không có quyền thao tác' });

  try {
    const db = await getDb();
    await db.run('UPDATE classes SET auto_learn = 0');
    
    activeConnections.forEach((conn, classId) => {
      conn.stop();
    });

    res.json({ success: true, message: 'Đã dừng toàn bộ các tiến trình kết nối chạy ngầm.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy thông tin chi tiết một tài khoản (Dành cho Admin hoặc chính User đó)
app.get('/api/accounts/:username', authenticateToken, async (req, res) => {
  const username = req.params.username;
  if (req.user.role !== 'admin' && req.user.username !== username) {
    return res.status(403).json({ success: false, error: 'Không có quyền truy cập' });
  }

  try {
    const db = await getDb();
    const user = await db.get('SELECT username, display_name, department, email, phone, position_name, kpi_percent, kpi_total, kpi_current, total_certificate, class_total FROM accounts WHERE username = ?', username);
    if (!user) return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản' });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật phân quyền cho tài khoản học viên (chỉ Admin hoặc người có quyền admin)
app.post('/api/accounts/:username/permissions', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { username } = req.params;
  const { perm, value } = req.body;

  const validPerms = ['admin', 'fms', 'zalo', 'gemini', 'gate'];
  if (!validPerms.includes(perm)) {
    return res.status(400).json({ success: false, error: 'Quyền hạn không hợp lệ' });
  }

  try {
    const db = await getDb();
    const columnName = `perm_${perm}`;
    await db.run(`UPDATE accounts SET ${columnName} = ? WHERE username = ?`, value ? 1 : 0, username);
    res.json({ success: true, message: `Đã cập nhật quyền ${perm} thành công!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật vai trò trực tiếp cho tài khoản (Admin, Điều hành, Nhân viên C1, Nhân viên C2)
app.post('/api/accounts/:username/role', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { username } = req.params;
  const { roleName } = req.body;

  const validRoles = ['admin', 'dieu_hanh', 'nv_c1', 'nv_c2'];
  if (!validRoles.includes(roleName)) {
    return res.status(400).json({ success: false, error: 'Vai trò không hợp lệ' });
  }

  try {
    const db = await getDb();
    let query = '';

    if (roleName === 'admin') {
      query = `UPDATE accounts SET perm_admin = 1, perm_fms = 1, perm_zalo = 1, perm_gemini = 1, perm_gate = 1 WHERE username = ?`;
    } else if (roleName === 'dieu_hanh') {
      query = `UPDATE accounts SET perm_admin = 0, perm_fms = 1, perm_zalo = 1, perm_gemini = 1, perm_gate = 1 WHERE username = ?`;
    } else if (roleName === 'nv_c1') {
      query = `UPDATE accounts SET perm_admin = 0, perm_fms = 0, perm_zalo = 0, perm_gemini = 1, perm_gate = 0 WHERE username = ?`;
    } else if (roleName === 'nv_c2') {
      query = `UPDATE accounts SET perm_admin = 0, perm_fms = 0, perm_zalo = 0, perm_gemini = 0, perm_gate = 0 WHERE username = ?`;
    }

    await db.run(query, username);
    res.json({ success: true, message: `Đã cập nhật vai trò thành công!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Xóa tài khoản nhân viên ra khỏi LMS (Chỉ dành cho Admin hoặc người có quyền admin)
app.delete('/api/accounts/:username', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1) return res.status(403).json({ success: false, error: 'Không có quyền thao tác' });

  const targetUser = req.params.username;

  try {
    const db = await getDb();
    
    // Lấy danh sách các lớp học của tài khoản này để dừng kết nối
    const userClasses = await db.all('SELECT id FROM classes WHERE account_username = ?', targetUser);
    userClasses.forEach(c => {
      stopLearning(c.id);
    });

    // Xóa trong DB (do quan hệ CASCADE nên các lớp học của tài khoản này cũng tự động bị xóa)
    await db.run('DELETE FROM accounts WHERE username = ?', targetUser);

    res.json({ success: true, message: `Đã xóa tài khoản ${targetUser} và dừng toàn bộ tiến trình chạy ngầm.` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Khám phá lớp học theo danh mục từ Skypec Catalog
app.post('/api/classes/explore', authenticateToken, async (req, res) => {
  const { categoryId, keyword, offset, limit, username } = req.body;
  const targetUsername = (req.user.role === 'admin' && username) ? username : req.user.username;

  try {
    const db = await getDb();
    const account = await db.get('SELECT access_token FROM accounts WHERE username = ?', targetUsername);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản nhân viên' });
    }

    const token = account.access_token;
    const payload = {
      keyword: keyword || "",
      offset: parseInt(offset) || 0,
      limit: parseInt(limit) || 20,
      categoryId: categoryId,
      departmentId: "00000000-0000-0000-0000-000000000000",
      branchId: "00000000-0000-0000-0000-000000000000",
      trainingId: "00000000-0000-0000-0000-000000000000",
      subjectId: "00000000-0000-0000-0000-000000000000"
    };

    const options = {
      hostname: HOST, port: 443,
      path: '/skypec2.lms.api/api/v1/LmsClass/frSearch',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Encoding': 'identity'
      }
    };

    const request = https.request(options, (response) => {
      let body = '';
      response.on('data', (chunk) => body += chunk);
      response.on('end', () => {
        if (response.statusCode === 200) {
          try {
            res.json(JSON.parse(body));
          } catch (e) {
            res.status(500).json({ success: false, error: 'Lỗi giải mã JSON phản hồi từ Skypec' });
          }
        } else {
          res.status(response.statusCode).json({ success: false, error: `Skypec phản hồi mã lỗi: ${response.statusCode}` });
        }
      });
    });

    request.on('error', (err) => {
      res.status(500).json({ success: false, error: err.message });
    });

    request.write(JSON.stringify(payload));
    request.end();
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Đăng ký tham gia lớp học mới
app.post('/api/classes/register', authenticateToken, async (req, res) => {
  const { classId, username } = req.body;
  if (!classId) {
    return res.status(400).json({ success: false, error: 'Thiếu mã lớp học (classId)' });
  }

  const targetUsername = (req.user.role === 'admin' && username) ? username : req.user.username;

  try {
    const db = await getDb();
    const account = await db.get('SELECT access_token FROM accounts WHERE username = ?', targetUsername);
    if (!account) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản nhân viên' });
    }

    const token = account.access_token;
    
    // 1. Gọi API đăng ký lớp học trước
    const regRes = await registerSkypecClass(token, classId);
    if (!regRes.status) {
      let friendlyError = 'Không thể đăng ký lớp học này';
      if (regRes.code === 'LMS_NOT_ALLLOW_REGISTER') {
        friendlyError = 'Lớp học này hiện không cho phép tự đăng ký (đã đóng đăng ký hoặc giới hạn đối tượng)';
      } else if (regRes.message) {
        friendlyError = regRes.message;
      }
      return res.status(400).json({ success: false, error: friendlyError });
    }

    // 2. Gọi fetchActualProgress để kích hoạt trạng thái vào học
    const joinRes = await fetchActualProgress(token, classId);
    if (joinRes && joinRes.status) {
      // Đồng bộ tức thì danh sách lớp học và các chỉ số thống kê
      await syncUserClasses(targetUsername, token);
      await syncUserStats(targetUsername, token);
      res.json({ success: true, message: 'Đăng ký và tham gia lớp học thành công!' });
    } else {
      res.status(400).json({ success: false, error: joinRes.message || 'Đăng ký thành công nhưng không thể kích hoạt vào học' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Đổi mật khẩu Admin
app.post('/api/admin/change-password', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, error: 'Vui lòng điền đầy đủ mật khẩu hiện tại và mật khẩu mới' });
  }

  try {
    const db = await getDb();
    const adminRow = await db.get('SELECT * FROM admin WHERE username = ?', 'admin');
    
    if (!adminRow || !bcrypt.compareSync(currentPassword, adminRow.password)) {
      return res.status(400).json({ success: false, error: 'Mật khẩu hiện tại không chính xác' });
    }

    const hashedNewPassword = bcrypt.hashSync(newPassword, 10);
    await db.run('UPDATE admin SET password = ? WHERE username = ?', hashedNewPassword, 'admin');

    res.json({ success: true, message: 'Đổi mật khẩu admin thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- API QUẢN LÝ TẢI DẦU FMS VIETNAM AIRLINES ---
// Cập nhật lịch bay trực ca (chỉ Admin)
// Cộng/trừ ngày YYYY-MM-DD an toàn (tránh lệch timezone toISOString)
function addDaysYmd(dateStr, deltaDays) {
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return dateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Nguyên tắc ngày FMS Vietnam Airlines (theo ca trực):
 *
 * - Ca ngày (07:30–19:30 cùng ngày D):
 *     mọi chuyến → fms_date = D  (cùng ngày lịch FMS)
 *
 * - Ca tối (2 giai đoạn, bắt đầu ngày D):
 *     • 19:30–23:59 ngày D     → fms_date = D
 *     • 00:00–07:30 sáng D+1   → fms_date = D+1  (sang ngày mới trên FMS)
 *
 * isOvernightShift = true khi ca tối / ca đêm / tự nhận file có giờ tối muộn.
 */
function isEarlyMorningTime(hour, minute) {
  // 00:00 <= t <= 07:30
  return hour < 7 || (hour === 7 && minute <= 30);
}

function calculateFmsDate(dateStr, timeStr, isOvernightShift = false) {
  if (!timeStr || timeStr === '-') return dateStr;
  try {
    const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
    if (!match) return dateStr;
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);

    if (isEarlyMorningTime(hour, minute)) {
      if (isOvernightShift) {
        // Đoạn sáng sớm của ca tối → lấy dữ liệu FMS ngày hôm sau
        return addDaysYmd(dateStr, 1);
      }
      // Ca ngày / lịch không overnight: giữ cùng ngày trực
      return dateStr;
    }

    // 07:31 → 23:59: cùng ngày bắt đầu ca (ca ngày hoặc đoạn tối 19:30–23:59)
    return dateStr;
  } catch (e) {
    console.error('[calculateFmsDate Error]', e.message);
  }
  return dateStr;
}

function isOvernightShiftValue(shift) {
  const s = String(shift || '').trim().toLowerCase();
  // evening = ca tối full (19:30→07:30); night giữ tương thích cũ
  return s === 'evening' || s === 'night';
}

app.post('/api/fms/schedule', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_fms !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { scheduleText, flights, mappings, date, shift } = req.body;
  if (!scheduleText && (!flights || flights.length === 0)) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp lịch bay hoặc danh sách chuyến bay' });
  }

  try {
    const db = await getDb();

    // Lưu các mapping Zalo mới được cấu hình từ client (lưu học hỏi)
    if (Array.isArray(mappings)) {
      for (const m of mappings) {
        if (m.scheduleName && m.zaloUid) {
          try {
            await db.run(
              'INSERT OR REPLACE INTO zalo_user_mappings (schedule_name, zalo_uid, zalo_name) VALUES (?, ?, ?)',
              String(m.scheduleName).trim().toUpperCase(),
              String(m.zaloUid).trim(),
              m.zaloName ? String(m.zaloName).trim() : ''
            );
          } catch (e) {
            console.error('[Save Mapping Error]', e.message);
          }
        }
      }
    }

    const targetDate = date ? String(date).trim() : getVietnamDbDateStr();
    const schedules = [];

    // Ca tối (overnight): evening/night, hoặc tự nhận file có giờ ≥ 19:30
    let isOvernightShift = isOvernightShiftValue(shift);
    if (!isOvernightShift && flights && flights.length > 0) {
      isOvernightShift = flights.some(f => {
        const timeStr = f.time_fuel || f.time_dep || f.time_arr;
        if (!timeStr || timeStr === '-') return false;
        const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
        if (match) {
          const hour = parseInt(match[1], 10);
          const minute = parseInt(match[2], 10);
          return hour > 19 || (hour === 19 && minute >= 30);
        }
        return false;
      });
    }
    const hasNightFlights = isOvernightShift; // alias dùng trong log / sync

    if (flights && flights.length > 0) {
      // 1. Phân tích lịch bay dạng JSON mảng (từ file Excel)
      for (const f of flights) {
        if (!f.flight_no) continue;
        const flightNo = f.flight_no.trim().toUpperCase().replace(/\s+/g, '');
        const driverName = f.driver_name ? f.driver_name.trim() : '';
        const operatorName = f.operator_name ? f.operator_name.trim() : '';
        const crewInfo = driverName && operatorName ? `${driverName} - ${operatorName}` : (driverName || operatorName);

        schedules.push({
          flight_no: flightNo,
          ac_type: f.ac_type ? f.ac_type.trim() : '',
          ac_reg: f.ac_reg ? f.ac_reg.trim() : '',
          route: f.route ? f.route.trim() : '',
          time_arr: f.time_arr ? f.time_arr.trim() : '',
          time_dep: f.time_dep ? f.time_dep.trim() : '',
          time_fuel: f.time_fuel ? f.time_fuel.trim() : '',
          gate: f.gate ? f.gate.trim() : '',
          truck_no: f.truck_no ? f.truck_no.trim() : '',
          driver_name: driverName,
          operator_name: operatorName,
          crew_info: crewInfo,
          crew_zalo_uids: f.crew_zalo_uids ? f.crew_zalo_uids.trim() : '',
          notify_type: parseInt(f.notify_type) || 1
        });
      }
    } else if (scheduleText) {
      // 2. Phân tích lịch bay dạng Text dán thủ công (tương thích ngược)
      const lines = scheduleText.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        
        const parts = line.split(':');
        if (parts.length >= 2) {
          const flightNo = parts[0].trim().toUpperCase().replace(/\s+/g, '');
          const crewInfo = parts.slice(1).join(':').trim();
          
          if (flightNo) {
            schedules.push({
              flight_no: flightNo,
              ac_type: '',
              ac_reg: '',
              route: '',
              time_arr: '',
              time_dep: '',
              time_fuel: '',
              gate: '',
              truck_no: '',
              driver_name: crewInfo.split('-')[0] ? crewInfo.split('-')[0].trim() : '',
              operator_name: crewInfo.split('-')[1] ? crewInfo.split('-')[1].trim() : '',
              crew_info: crewInfo,
              crew_zalo_uids: '',
              notify_type: 1
            });
          }
        }
      }
    }

    if (schedules.length === 0) {
      return res.status(400).json({ success: false, error: 'Không tìm thấy chuyến bay hợp lệ trong dữ liệu gửi lên' });
    }

    // Chỉ dọn dẹp lịch bay cũ hơn ngày hôm trước (date < targetDate - 1 ngày) để giữ lại ca đêm hôm trước
    const limitDateStr = addDaysYmd(targetDate, -1);
    await db.run('DELETE FROM fms_schedules WHERE date < ?', limitDateStr);

    // Xóa tải dầu FMS cũ của các ngày trước ngày import (date < targetDate) để tránh báo tin nhầm lẫn
    await db.run("DELETE FROM fms_fuel_orders WHERE flight_no LIKE '%_%' AND substr(flight_no, instr(flight_no, '_') + 1) < ?", targetDate);

    // Xóa tải dầu FMS của ngày được import để quét lại từ đầu, tránh so sánh nhầm số liệu cũ và tránh spam Zalo lần đầu
    await db.run("DELETE FROM fms_fuel_orders WHERE flight_no LIKE '%_%' AND substr(flight_no, instr(flight_no, '_') + 1) = ?", targetDate);

    // Xóa lịch cũ của ngày hôm nay
    await db.run('DELETE FROM fms_schedules WHERE date = ?', targetDate);

    // Tải toàn bộ zalo_user_mappings từ DB để tự động map tên sang zalo_uid ở Backend
    const dbMappings = await db.all('SELECT schedule_name, zalo_uid FROM zalo_user_mappings');
    const mappingMap = {};
    dbMappings.forEach(m => {
      mappingMap[m.schedule_name.toUpperCase().trim()] = m.zalo_uid;
    });

    // Thêm lịch mới — gán fms_date theo nguyên tắc ca ngày / ca tối
    for (const item of schedules) {
      const fmsDate = calculateFmsDate(
        targetDate,
        item.time_fuel || item.time_dep || item.time_arr,
        isOvernightShift
      );
      
      // Tự động phân giải Zalo UIDs ở Backend nếu chưa có
      let finalCrewZaloUids = item.crew_zalo_uids || '';
      if (!finalCrewZaloUids) {
        const uids = [];
        const drName = item.driver_name ? item.driver_name.toUpperCase().trim() : '';
        const opName = item.operator_name ? item.operator_name.toUpperCase().trim() : '';
        
        if (drName && mappingMap[drName]) {
          uids.push(mappingMap[drName]);
        }
        if (opName && mappingMap[opName]) {
          uids.push(mappingMap[opName]);
        }
        finalCrewZaloUids = Array.from(new Set(uids)).join(',');
      }

      await db.run(`
        INSERT INTO fms_schedules (
          flight_no, ac_type, ac_reg, route, time_arr, time_dep, time_fuel, 
          gate, truck_no, driver_name, operator_name, crew_info, crew_zalo_uids, notify_type, date, fms_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        item.flight_no,
        item.ac_type,
        item.ac_reg,
        item.route,
        item.time_arr,
        item.time_dep,
        item.time_fuel,
        item.gate,
        item.truck_no,
        item.driver_name,
        item.operator_name,
        item.crew_info,
        finalCrewZaloUids,
        item.notify_type || 1,
        targetDate,
        fmsDate
      );
    }

    // Quét FMS ngay — ca tối quét cả D và D+1 (đoạn sáng sớm lấy FMS ngày mới)
    let shiftForSync = (shift && String(shift).trim()) ? String(shift).trim() : 'all';
    if (isOvernightShift && shiftForSync === 'all') shiftForSync = 'evening';
    console.log(`[FMS Schedule] Đã lưu ${schedules.length} chuyến date=${targetDate} shift=${shiftForSync} overnight=${isOvernightShift}`);
    syncFMSData(targetDate, shiftForSync).catch(err => console.error('[FMS] Lỗi quét nhanh sau khi cập nhật lịch:', err.message));

    res.json({
      success: true,
      message: `Đã cập nhật lịch trực ca thành công (${schedules.length} chuyến)! Chọn ngày ${targetDate} trên Kế hoạch FMS để xem.`,
      date: targetDate,
      shift: shiftForSync,
      count: schedules.length
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách lịch bay và dữ liệu tải dầu tương ứng (Cho phép tất cả người dùng đăng nhập xem)
// Ghép thêm fms_flights_live (Skypec Flights) để đánh dấu "Đã tra nạp"
app.get('/api/fms/schedules', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const targetDate = req.query.date || getVietnamDbDateStr();

    const rows = await db.all(`
      SELECT 
        s.id,
        s.flight_no,
        COALESCE(NULLIF(fo.ac_type, ''), NULLIF(fl.ac_type, ''), s.ac_type) as ac_type,
        COALESCE(NULLIF(fo.ac_reg, ''), NULLIF(fl.ac_reg, ''), s.ac_reg) as ac_reg,
        COALESCE(NULLIF(s.route, ''), fl.route) as route,
        s.time_arr,
        s.time_dep,
        s.time_fuel,
        s.gate,
        s.truck_no,
        s.driver_name,
        s.operator_name,
        s.crew_info,
        s.crew_zalo_uids,
        s.notify_type,
        s.date,
        s.fms_date,
        fo.dep_arr,
        fo.standby_fuel,
        fo.fuel_order,
        fo.trip_fuel,
        fo.trip_time,
        fo.taxi_fuel,
        fo.alternate,
        COALESCE(fo.status, 'Chờ cập nhật') as status,
        fo.warn_ac_reg,
        fo.warn_standby,
        fo.warn_fuel_order,
        fo.warn_updated_at,
        fo.old_ac_reg,
        fo.old_standby_fuel,
        fo.old_fuel_order,
        fo.etd,
        fo.old_etd,
        fo.warn_etd,
        fo.updated_at,
        fl.fuel_order as skypec_fuel_order,
        fl.status as skypec_status,
        fl.driver_name as skypec_driver_name,
        fl.operator_name as skypec_operator_name,
        fl.truck_no as skypec_truck_no,
        fl.date as skypec_date,
        CASE
          WHEN CAST(COALESCE(NULLIF(TRIM(fl.fuel_order), ''), '0') AS INTEGER) > 0 THEN 1
          WHEN fl.status = 'Đã có số liệu' THEN 1
          WHEN CAST(COALESCE(NULLIF(TRIM(fo.fuel_order), ''), '0') AS INTEGER) > 0 THEN 1
          ELSE 0
        END as is_refueled
      FROM fms_schedules s
      LEFT JOIN fms_fuel_orders fo ON UPPER(s.flight_no || '_' || COALESCE(s.fms_date, s.date)) = UPPER(fo.flight_no)
      LEFT JOIN fms_flights_live fl ON fl.id = (
        SELECT fl2.id FROM fms_flights_live fl2
        WHERE REPLACE(REPLACE(UPPER(fl2.flight_no), ' ', ''), '-', '')
            = REPLACE(REPLACE(UPPER(s.flight_no), ' ', ''), '-', '')
          AND fl2.date IN (s.date, COALESCE(NULLIF(s.fms_date, ''), s.date))
        ORDER BY
          CASE WHEN CAST(COALESCE(NULLIF(TRIM(fl2.fuel_order), ''), '0') AS INTEGER) > 0 THEN 0 ELSE 1 END,
          fl2.created_at DESC
        LIMIT 1
      )
      WHERE s.date = ?
      ORDER BY s.id ASC
    `, targetDate);

    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Hàm bỏ dấu tiếng Việt để so khớp mềm
function removeAccents(str) {
  if (!str) return '';
  return str.normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase();
}

// Hàm sinh danh sách các biến thể tên viết tắt khả dĩ của nhân viên
async function getPossibleNames(db, displayName) {
  if (!displayName) return [];
  const names = new Set();
  const upperDisplay = displayName.trim().toUpperCase();
  names.add(upperDisplay);
  
  const cleanName = displayName.trim().replace(/\s+/g, ' ');
  const parts = cleanName.split(' ');
  if (parts.length > 0) {
    const lastName = parts[parts.length - 1].toUpperCase();
    
    if (parts.length >= 2) {
      const firstCharHọ = parts[0][0].toUpperCase();
      names.add(`${firstCharHọ}.${lastName}`);
      
      const firstCharĐệm = parts[parts.length - 2][0].toUpperCase();
      names.add(`${firstCharĐệm}.${lastName}`);
      
      if (parts.length >= 3) {
        names.add(`${firstCharHọ}.${firstCharĐệm}.${lastName}`);
      }
    }
  }
  
  // Truy vấn thêm từ bảng zalo_user_mappings để lấy các schedule_name tương ứng
  try {
    const mappings = await db.all('SELECT schedule_name, zalo_name FROM zalo_user_mappings');
    const displayMain = removeAccents(parts[parts.length - 1]);
    
    if (mappings) {
      for (const m of mappings) {
        if (m.zalo_name && m.schedule_name) {
          const zaloParts = m.zalo_name.trim().replace(/\s+/g, ' ').split(' ');
          const zaloMain = removeAccents(zaloParts[zaloParts.length - 1]);
          if (zaloMain === displayMain) {
            names.add(m.schedule_name.trim().toUpperCase());
          }
        }
      }
    }
  } catch (e) {
    console.error('[getPossibleNames mappings error]', e.message);
  }
  
  return Array.from(names);
}

// So khớp tên nhân viên FMS Skypec (hỗ trợ viết tắt hàng không)
function matchFmsEmployee(displayName, fmsName, possibleNames = []) {
  if (!displayName || !fmsName) return false;
  
  const emp = displayName.trim().toUpperCase();
  const fms = fmsName.trim().toUpperCase();
  
  // 1. So khớp chính xác tuyệt đối (có dấu hoặc không dấu)
  if (emp === fms) return true;
  if (removeAccents(emp) === removeAccents(fms)) return true;
  
  // 2. Chuyển đổi khoảng trắng thành dấu chấm để xử lý viết tắt đồng bộ
  const normalizedFms = fms.replace(/\s+/g, '.');
  
  // Thử so khớp viết tắt cho tên chính displayName
  if (matchAbbreviation(emp, normalizedFms)) return true;
  
  // 3. Thử so khớp viết tắt cho các possibleNames
  if (possibleNames && possibleNames.length > 0) {
    for (const name of possibleNames) {
      const uName = name.trim().toUpperCase();
      if (uName === fms || removeAccents(uName) === removeAccents(fms)) return true;
      if (matchAbbreviation(uName, normalizedFms)) return true;
    }
  }
  
  return false;
}

function matchAbbreviation(empName, fmsName) {
  const empParts = empName.split(' ').filter(p => p.trim() !== '');
  const fmsParts = fmsName.split('.').filter(p => p.trim() !== '');
  
  if (fmsParts.length < 2 || empParts.length < 2) return false;
  
  const fmsLastName = fmsParts[fmsParts.length - 1];
  const empLastName = empParts[empParts.length - 1];
  
  // Tên chính bắt buộc phải khớp hoàn toàn
  if (removeAccents(fmsLastName) !== removeAccents(empLastName)) return false;
  
  // Nếu FMS viết tắt đầy đủ (ví dụ C.K.ANH cho CAO KỲ ANH)
  if (fmsParts.length === empParts.length) {
    for (let i = 0; i < empParts.length - 1; i++) {
      const fmsChar = removeAccents(fmsParts[i]);
      const empChar = removeAccents(empParts[i][0]);
      if (fmsChar.length === 1) {
        if (fmsChar !== empChar) return false;
      } else {
        if (fmsChar !== removeAccents(empParts[i])) return false;
      }
    }
    return true;
  }
  
  // Nếu FMS viết tắt ngắn hơn (ví dụ C.ANH cho CAO KỲ ANH)
  // Chỉ cho phép nếu fmsParts có đúng 2 phần
  if (fmsParts.length === 2 && empParts.length > 2) {
    const fmsChar = removeAccents(fmsParts[0]);
    const empChar = removeAccents(empParts[0][0]);
    return fmsChar === empChar;
  }
  
  return false;
}

let lastLiveSyncTime = 0;

// Lấy chỉ số thống kê số chuyến ước tính cho nhân viên (Hôm nay, Tháng này, Tháng trước)
app.get('/api/fms/user-stats', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    
    // Nếu là admin hoặc điều hành thì cho phép xem stats của tài khoản khác
    const isAdminOrOperator = req.user.role === 'admin' || req.user.perm_admin === 1 || req.user.perm_fms === 1;
    const targetUsername = (isAdminOrOperator && req.query.username)
      ? req.query.username
      : req.user.username;

    // 1. Lấy thông tin display_name của tài khoản mục tiêu
    const account = await db.get('SELECT display_name FROM accounts WHERE username = ?', targetUsername);
    if (!account || !account.display_name) {
      return res.json({
        success: true,
        data: {
          todayCount: 0,
          monthCount: 0,
          lastMonthCount: 0,
          todayFlights: [],
          monthFlights: [],
          lastMonthFlights: []
        }
      });
    }

    const displayName = account.display_name;

    // 2. Tính toán các mốc thời gian
    const now = new Date();
    // Chuyển sang múi giờ Việt Nam (+7)
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const currentYear = vnTime.getUTCFullYear();
    const currentMonth = vnTime.getUTCMonth() + 1;

    const formatMonth = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const thisMonthStr = formatMonth(currentYear, currentMonth);

    let lastMonthYear = currentYear;
    let lastMonth = currentMonth - 1;
    if (lastMonth === 0) {
      lastMonth = 12;
      lastMonthYear -= 1;
    }
    const lastMonthStr = formatMonth(lastMonthYear, lastMonth);
    const todayStr = getVietnamDbDateStr();

    // 3. Kích hoạt đồng bộ live chạy ngầm (background) nếu lần cào gần nhất cách đây hơn 30 giây
    const nowMs = Date.now();
    if (nowMs - lastLiveSyncTime > 30000) {
      lastLiveSyncTime = nowMs;
      syncFmsSkypecLive().catch(err => console.error('[FMS Live Sync Error]', err.message));
    }

    // 4. Lấy danh sách các biến thể tên viết tắt khả dĩ để so khớp dự phòng
    const possibleNames = await getPossibleNames(db, displayName);

    // 5. Truy vấn database lấy toàn bộ chuyến bay trong 3 mốc thời gian
    const rows = await db.all(`
      SELECT 
        id,
        flight_no,
        ac_type,
        ac_reg,
        route,
        time_arr,
        time_dep,
        time_fuel,
        gate,
        '' as truck_no,
        driver_name,
        operator_name,
        (driver_name || ' - ' || operator_name) as crew_info,
        date as date_str,
        status,
        fuel_order,
        standby_fuel
      FROM fms_flights_live
      WHERE date = ?
        OR strftime('%Y-%m', date) = ?
        OR strftime('%Y-%m', date) = ?
      ORDER BY date DESC, id ASC
    `, todayStr, thisMonthStr, lastMonthStr);

    // 6. Định nghĩa hàm so khớp tên nhân viên mềm dẻo bằng JS
    const matchEmployee = (flight) => {
      const driver = (flight.driver_name || '').trim();
      const operator = (flight.operator_name || '').trim();

      const drivers = driver.split(',').map(d => d.trim());
      const operators = operator.split(',').map(o => o.trim());

      for (const d of drivers) {
        if (matchFmsEmployee(displayName, d, possibleNames)) return true;
      }
      for (const o of operators) {
        if (matchFmsEmployee(displayName, o, possibleNames)) return true;
      }

      return false;
    };

    // 7. Phân loại chuyến bay theo các mốc thời gian
    const todayFlights = [];
    const thisMonthFlights = [];
    const lastMonthFlights = [];

    const seenToday = new Set();
    const seenMonth = new Set();
    const seenLastMonth = new Set();

    for (const row of rows) {
      // Chỉ tính các chuyến bay khớp với tên của nhân viên này
      if (!matchEmployee(row)) continue;

      const flightDate = row.date_str;
      const key = `${row.flight_no}_${flightDate}`;

      if (flightDate === todayStr) {
        if (!seenToday.has(key)) {
          seenToday.add(key);
          todayFlights.push(row);
        }
      }
      
      if (flightDate.startsWith(thisMonthStr)) {
        if (!seenMonth.has(key)) {
          seenMonth.add(key);
          thisMonthFlights.push(row);
        }
      }
      
      if (flightDate.startsWith(lastMonthStr)) {
        if (!seenLastMonth.has(key)) {
          seenLastMonth.add(key);
          lastMonthFlights.push(row);
        }
      }
    }

    res.json({
      success: true,
      data: {
        todayCount: todayFlights.length,
        monthCount: thisMonthFlights.length,
        lastMonthCount: lastMonthFlights.length,
        todayFlights,
        monthFlights: thisMonthFlights,
        lastMonthFlights
      }
    });

  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy thống kê chuyến bay của tất cả nhân viên (Chỉ Admin và Điều hành mới được gọi)
app.get('/api/fms/admin-stats', authenticateToken, async (req, res) => {
  const isAdminOrOperator = req.user.role === 'admin' || req.user.perm_admin === 1 || req.user.perm_fms === 1;
  if (!isAdminOrOperator) {
    return res.status(403).json({ success: false, error: 'Không có quyền truy cập số liệu thống kê Admin.' });
  }

  try {
    const db = await getDb();
    
    // 1. Lấy danh sách tất cả tài khoản học viên/nhân viên
    const users = await db.all('SELECT username, display_name, position_name, department FROM accounts WHERE username != "admin" ORDER BY display_name ASC');
    
    // 2. Tính toán các mốc thời gian
    const todayStr = getVietnamDbDateStr();
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    
    const currentYear = vnTime.getUTCFullYear();
    const currentMonth = vnTime.getUTCMonth() + 1;
    const formatMonth = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const thisMonthStr = formatMonth(currentYear, currentMonth);

    let lastMonthYear = currentYear;
    let lastMonth = currentMonth - 1;
    if (lastMonth === 0) {
      lastMonth = 12;
      lastMonthYear -= 1;
    }
    const lastMonthStr = formatMonth(lastMonthYear, lastMonth);

    // 3. Lấy toàn bộ chuyến bay trong database thuộc 3 mốc thời gian này
    const rows = await db.all(`
      SELECT 
        id,
        flight_no,
        ac_type,
        ac_reg,
        route,
        time_arr,
        time_dep,
        time_fuel,
        gate,
        '' as truck_no,
        driver_name,
        operator_name,
        (driver_name || ' - ' || operator_name) as crew_info,
        date as date_str,
        status,
        fuel_order,
        standby_fuel
      FROM fms_flights_live
      WHERE date = ?
        OR strftime('%Y-%m', date) = ?
        OR strftime('%Y-%m', date) = ?
      ORDER BY date DESC, id ASC
    `, todayStr, thisMonthStr, lastMonthStr);

    // 4. Duyệt qua từng tài khoản nhân viên để tính số chuyến bay tương ứng
    const fmsStats = [];
    for (const u of users) {
      const displayName = u.display_name;
      if (!displayName) continue;

      const possibleNames = await getPossibleNames(db, displayName);
      
      const matchEmployee = (flight) => {
        const driver = (flight.driver_name || '').trim();
        const operator = (flight.operator_name || '').trim();

        const drivers = driver.split(',').map(d => d.trim());
        const operators = operator.split(',').map(o => o.trim());

        for (const d of drivers) {
          if (matchFmsEmployee(displayName, d, possibleNames)) return true;
        }
        for (const o of operators) {
          if (matchFmsEmployee(displayName, o, possibleNames)) return true;
        }

        return false;
      };

      const todayFlights = [];
      const thisMonthFlights = [];
      const lastMonthFlights = [];

      const seenToday = new Set();
      const seenMonth = new Set();
      const seenLastMonth = new Set();

      for (const row of rows) {
        if (!matchEmployee(row)) continue;

        const flightDate = row.date_str;
        const key = `${row.flight_no}_${flightDate}`;

        if (flightDate === todayStr) {
          if (!seenToday.has(key)) {
            seenToday.add(key);
            todayFlights.push(row);
          }
        }
        if (flightDate.startsWith(thisMonthStr)) {
          if (!seenMonth.has(key)) {
            seenMonth.add(key);
            thisMonthFlights.push(row);
          }
        }
        if (flightDate.startsWith(lastMonthStr)) {
          if (!seenLastMonth.has(key)) {
            seenLastMonth.add(key);
            lastMonthFlights.push(row);
          }
        }
      }

      fmsStats.push({
        username: u.username,
        display_name: displayName,
        position_name: u.position_name || 'Nhân viên',
        department: u.department || 'Skypec',
        todayCount: todayFlights.length,
        monthCount: thisMonthFlights.length,
        lastMonthCount: lastMonthFlights.length
      });
    }

    res.json({ success: true, data: fmsStats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- CÁC ROUTE API QUẢN LÝ BOT ZALO SKYEYES ---

// Lấy trạng thái của Bot Zalo hiện tại (chỉ Admin)
app.get('/api/fms/zalo/state', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }
  try {
    const state = getBotState();
    res.json({ success: true, state });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Yêu cầu sinh mã QR đăng nhập mới (chỉ Admin)
app.post('/api/fms/zalo/qr', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }
  try {
    startQRLogin().catch(err => console.error('[SkyEyes] Lỗi sinh QR ngầm:', err.message));
    res.json({ success: true, message: 'Đang bắt đầu tạo QR Code...' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Yêu cầu đăng xuất Zalo (chỉ Admin)
app.post('/api/fms/zalo/logout', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }
  try {
    await logoutBot();
    res.json({ success: true, message: 'Đã đăng xuất Bot Zalo thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách nhóm chat Zalo (chỉ Admin hoặc người có quyền Zalo)
app.get('/api/fms/zalo/groups', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }
  try {
    const groups = await getBotGroups();
    res.json({ success: true, groups });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy các cài đặt Zalo đã lưu (chỉ Admin hoặc người có quyền Zalo)
app.get('/api/fms/zalo/settings', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }
  try {
    const db = await getDb();
    const groupVal = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
    const nameVal = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_name'");
    const notifyVal = await db.get("SELECT value FROM settings WHERE key = 'zalo_notify_enabled'");
    const templateVal = await db.get("SELECT value FROM settings WHERE key = 'zalo_message_template'");

    const nStandby = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_new_standby'");
    const nFuel = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_new_fuel_order'");
    const nStandbyChg = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_standby_changed'");
    const nFuelChg = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_fuel_order_changed'");
    const nAc = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_ac_reg_changed'");
    const nGate = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_gate_changed'");
    const nEtd = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_etd_changed'");
    const durationSetting = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_duration'");
    const durationVal = durationSetting ? durationSetting.value : '24h';
    const ieGroupVal = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_group_id'");
    const ieGroupNameVal = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_group_name'");
    const nAirline = await db.get("SELECT value FROM settings WHERE key = 'fms_notify_airline_mismatch'");
    const airlineGroupVal = await db.get("SELECT value FROM settings WHERE key = 'fms_airline_alert_group_id'");
    const airlineGroupNameVal = await db.get("SELECT value FROM settings WHERE key = 'fms_airline_alert_group_name'");

    res.json({
      success: true,
      settings: {
        targetGroupId: groupVal ? groupVal.value : '',
        targetGroupName: nameVal ? nameVal.value : '',
        notifyEnabled: notifyVal ? (notifyVal.value === 'true') : false,
        messageTemplate: templateVal ? templateVal.value : '',
        notifyNewStandby: nStandby ? (nStandby.value === 'true') : true,
        notifyNewFuelOrder: nFuel ? (nFuel.value === 'true') : true,
        notifyStandbyChanged: nStandbyChg ? (nStandbyChg.value === 'true') : true,
        notifyFuelOrderChanged: nFuelChg ? (nFuelChg.value === 'true') : true,
        notifyAcRegChanged: nAc ? (nAc.value === 'true') : true,
        notifyGateChanged: nGate ? (nGate.value === 'true') : true,
        notifyEtdChanged: nEtd ? (nEtd.value === 'true') : true,
        fmsImportExportDuration: durationVal,
        fmsImportExportGroupId: ieGroupVal ? ieGroupVal.value : '',
        fmsImportExportGroupName: ieGroupNameVal ? ieGroupNameVal.value : '',
        notifyAirlineMismatch: nAirline ? (nAirline.value === 'true') : true,
        fmsAirlineAlertGroupId: airlineGroupVal ? airlineGroupVal.value : '',
        fmsAirlineAlertGroupName: airlineGroupNameVal ? airlineGroupNameVal.value : '',
        airlineMappings: listAirlineMappings()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lưu cấu hình cài đặt Zalo (chỉ Admin hoặc người có quyền Zalo)
app.post('/api/fms/zalo/settings', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }
  const { 
    targetGroupId, targetGroupName, notifyEnabled, messageTemplate,
    notifyNewStandby, notifyNewFuelOrder, notifyStandbyChanged, notifyFuelOrderChanged,
    notifyAcRegChanged, notifyGateChanged, notifyEtdChanged,
    fmsImportExportDuration, fmsImportExportGroupId, fmsImportExportGroupName,
    notifyAirlineMismatch, fmsAirlineAlertGroupId, fmsAirlineAlertGroupName
  } = req.body;
  try {
    const db = await getDb();
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('zalo_target_group_id', ?)", targetGroupId ? String(targetGroupId).trim() : '');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('zalo_target_group_name', ?)", targetGroupName ? String(targetGroupName).trim() : '');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('zalo_notify_enabled', ?)", notifyEnabled ? 'true' : 'false');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('zalo_message_template', ?)", messageTemplate ? String(messageTemplate) : '');

    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_notify_new_standby', ?)", notifyNewStandby ? 'true' : 'false');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_notify_new_fuel_order', ?)", notifyNewFuelOrder ? 'true' : 'false');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_notify_standby_changed', ?)", notifyStandbyChanged ? 'true' : 'false');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_notify_fuel_order_changed', ?)", notifyFuelOrderChanged ? 'true' : 'false');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_notify_ac_reg_changed', ?)", notifyAcRegChanged ? 'true' : 'false');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_notify_gate_changed', ?)", notifyGateChanged ? 'true' : 'false');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_notify_etd_changed', ?)", notifyEtdChanged ? 'true' : 'false');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_import_export_duration', ?)", fmsImportExportDuration ? String(fmsImportExportDuration).trim() : '24h');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_import_export_group_id', ?)", fmsImportExportGroupId ? String(fmsImportExportGroupId).trim() : '');
    await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_import_export_group_name', ?)", fmsImportExportGroupName ? String(fmsImportExportGroupName).trim() : '');
    if (notifyAirlineMismatch !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_notify_airline_mismatch', ?)", notifyAirlineMismatch ? 'true' : 'false');
    }
    if (fmsAirlineAlertGroupId !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_airline_alert_group_id', ?)", fmsAirlineAlertGroupId ? String(fmsAirlineAlertGroupId).trim() : '');
    }
    if (fmsAirlineAlertGroupName !== undefined) {
      await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('fms_airline_alert_group_name', ?)", fmsAirlineAlertGroupName ? String(fmsAirlineAlertGroupName).trim() : '');
    }

    res.json({ success: true, message: 'Đã lưu cấu hình trợ lý SkyEyes thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Gửi tin nhắn test (chỉ Admin hoặc người có quyền Zalo)
app.post('/api/fms/zalo/send-test', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }
  const { groupId, message } = req.body;
  if (!groupId || !message) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp đầy đủ thông tin nhóm nhận và nội dung!' });
  }
  try {
    const ids = String(groupId).split(',').map(id => id.trim()).filter(Boolean);
    const promises = ids.map(id => sendSkyEyesMessage(id, message));
    const responses = await Promise.all(promises);
    res.json({ success: true, message: `Đã gửi tin nhắn test tới ${ids.length} nhóm thành công!`, responses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Gửi tin nhắn thử FMS thực tế (chỉ Admin hoặc người có quyền Zalo)
app.post('/api/fms/zalo/test-realtime', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  try {
    const db = await getDb();
    
    // Lấy cấu hình nhóm Zalo
    const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
    const targetGroupId = groupSetting ? groupSetting.value : null;
    if (!targetGroupId) {
      return res.status(400).json({ success: false, error: 'Vui lòng chọn và lưu nhóm Zalo đích trước!' });
    }

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

    // Cố gắng tìm một chuyến bay thực tế trong DB để test
    let testFlight = await db.get('SELECT flight_no, ac_reg, ac_type, dep_arr, standby_fuel, fuel_order FROM fms_fuel_orders WHERE status = "Đã có số liệu" LIMIT 1');
    let sched = null;
    
    if (testFlight) {
      sched = await db.get('SELECT crew_info, truck_no, gate, time_arr, time_dep, time_fuel FROM fms_schedules WHERE flight_no = ? LIMIT 1', testFlight.flight_no);
    } else {
      // Giả lập dữ liệu ảo nếu DB trống
      testFlight = {
        flight_no: 'VN319',
        ac_reg: 'VN-A897',
        ac_type: 'A350',
        dep_arr: 'DAD-SGN',
        standby_fuel: 14500,
        fuel_order: 16000
      };
      sched = {
        crew_info: 'Thùy - Được',
        truck_no: 'Xe 12',
        gate: 'Gate 18',
        time_arr: '18:30',
        time_dep: '19:15',
        time_fuel: '18:45'
      };
    }

    const title = '⛽ [FMS TEST GỬI TIN THỰC TẾ]';
    const formatNumber = (val) => {
      const num = parseInt(val);
      return isNaN(num) ? '0' : num.toLocaleString();
    };

    const replacements = {
      status_change_title: title,
      flight_no: testFlight.flight_no,
      ac_reg: testFlight.ac_reg || '-',
      old_ac_reg: 'VN-A886 (Cũ)',
      ac_type: testFlight.ac_type || '-',
      route: testFlight.dep_arr || '-',
      gate: sched ? (sched.gate || '-') : '-',
      old_gate: 'Gate 05',
      crew_info: sched ? (sched.crew_info || '-') : '-',
      truck_no: sched ? (sched.truck_no || '-') : '-',
      standby_fuel: formatNumber(testFlight.standby_fuel),
      old_standby_fuel: '12,000',
      fuel_order: formatNumber(testFlight.fuel_order),
      old_fuel_order: '14,500',
      time_fuel: sched && sched.time_fuel ? sched.time_fuel : '-',
      time_arr: sched && sched.time_arr ? sched.time_arr : '-',
      time_dep: sched && sched.time_dep ? sched.time_dep : '-'
    };

    let msg = template;
    for (const [key, value] of Object.entries(replacements)) {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g');
      msg = msg.replace(regex, value);
    }

    const ids = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
    const promises = ids.map(id => sendSkyEyesMessage(id, msg));
    const responses = await Promise.all(promises);
    res.json({ success: true, message: `Đã bắn tin nhắn test thực tế tới ${ids.length} nhóm thành công!`, responses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Các câu nhắc nhở hài hước khi thiếu lịch trực ca mới
const WARNING_MESSAGES = [
  "🤖 Ca trực mới đã bắt đầu, Nv.Điều hành vui lòng import lịch trực mới cho anh em được nhờ!",
  "Ối giời ơi! Sếp điều hành tải lịch trực mới lên đi cho anh em ca sau được nhờ!",
  "Cán bộ cấp cao nào đang trực điều hành thì tải lịch lên App đê! Anh em giao ca xong rồi kìa!...",
  "Thông báo từ bộ chỉ huy chiến khu: Điều hành chưa tải lịch mới lên app! Phạt chạy 10 vòng quanh kho N2! 🏃‍♂️💨",
  "Loa loa loa! Giờ lành đã điểm, ca mới đã lên. Kính mời sếp điều hành bắn cho xin cái lịch trực mới lên hệ thống với ạ! 🙏",
  "Alo điều hành nghe rõ trả lời! Anh em tra nạp đang ngóng lịch trực như ngóng mẹ đi chợ về. Tải lịch ngay đê! 🥺",
  "Cảnh báo cấp độ 1: Phát hiện điều hành đang 'quên' tải lịch trực ca mới. Đề nghị sếp đặt ly trà đá xuống và import lịch ngay nhé! ☕",
  "Báo cáo sếp điều hành, máy quét FMS đang chạy roda nhưng chưa thấy lịch trực đâu cả. Tải lịch lên kẻo Bot dỗi không quét đâu đấy! 🤖💢",
  "Anh em giao ca đứng chờ đỏ mắt, mà lịch trực ca mới vẫn biệt vô âm tín. Điều hành ơi, cứu net tải lịch lên app đi ạ! 🆘",
  "Tin khẩn từ tổ bay: Đề nghị Điều hành trực ca nhanh chóng cập nhật lịch trực mới lên CRM để anh em điều phối xe nạp dầu kịp thời!"
];

// Giả lập kịch bản test Zalo Bot (chỉ Admin hoặc người có quyền Zalo)
app.post('/api/fms/zalo/test-scenario', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { scenario } = req.body;
  if (!scenario) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp kịch bản test!' });
  }

  try {
    const db = await getDb();
    
    // Lấy cấu hình nhóm Zalo
    const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
    const targetGroupId = groupSetting ? groupSetting.value : null;
    if (!targetGroupId) {
      return res.status(400).json({ success: false, error: 'Vui lòng cấu hình và lưu nhóm Zalo đích nhận thông báo trước!' });
    }

    // Hàm lấy giờ hiện tại dạng HH:MM DD/MM/YYYY
    const getVnDateTimeStr = () => {
      const vnTime = new Date(new Date().getTime() + 7 * 60 * 60 * 1000);
      const hour = String(vnTime.getUTCHours()).padStart(2, '0');
      const minute = String(vnTime.getUTCMinutes()).padStart(2, '0');
      const day = String(vnTime.getUTCDate()).padStart(2, '0');
      const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
      const year = vnTime.getUTCFullYear();
      return `${hour}:${minute} ${day}/${month}/${year}`;
    };

    const nowStr = getVnDateTimeStr();
    let title = '';
    let msg = '';

    if (scenario === 'new-fuel') {
      title = '⛽ [FMS BÁO TẢI DẦU CHÍNH THỨC MỚI]';
      msg = `${title}
✈️ Chuyến bay: VN-TEST - VNA888
👥 Cặp tra nạp: THÀNH - CƯỜNG
🚛 Số xe nạp: Xe 09
📍 Vị trí đỗ: 49
🛩️ Số hiệu tàu: VNA888 (Loại: A321)
---------------------------
⛽ Tải dầu Standby (CFP): 12,500 kg
⛽ Tải dầu Chính thức: 13,800 kg
⏰ Giờ Tra nạp: 10:45
⏰ Giờ Hạ/Cất: Hạ 10:50 | Cất 11:35
📢 Giờ thông báo: ${nowStr}`;
    } else if (scenario === 'update-fuel') {
      title = '🔄 [FMS CẬP NHẬT SỐ LIỆU TẢI DẦU]';
      msg = `${title}
✈️ Chuyến bay: VN-TEST - VNA888
👥 Cặp tra nạp: THÀNH - CƯỜNG
🚛 Số xe nạp: Xe 09
🛩️ Số hiệu tàu: VNA888 (Loại: A321)
---------------------------
Tải dầu Chính thức cũ: 12,000 kg
Mới: 13,800 kg
⏰ Giờ Tra nạp: 10:45
⏰ Giờ Hạ/Cất: Hạ 10:50 | Cất 11:35
📢 Giờ thông báo: ${nowStr}`;
    } else if (scenario === 'change-ac') {
      title = '🛩️ [FMS CẢNH BÁO THAY ĐỔI TÀU BAY]';
      msg = `${title}
✈️ Chuyến bay: VN-TEST - VNA999
Số hiệu tàu cũ: VNA888
Mới: VNA999 (Loại: A321)
👥 Cặp tra nạp: THÀNH - CƯỜNG
🚛 Số xe nạp: Xe 09
⏰ Giờ Tra nạp: 10:45
⏰ Giờ Hạ/Cất: Hạ 10:50 | Cất 11:35
📢 Giờ thông báo: ${nowStr}`;
    } else if (scenario === 'change-gate') {
      title = '📍 [FMS CẢNH BÁO THAY ĐỔI VỊ TRÍ ĐỖ]';
      msg = `${title}
✈️ Chuyến bay: VN-TEST - VNA888
Vị trí đỗ cũ: 49
Mới: 52
👥 Cặp tra nạp: THÀNH - CƯỜNG
🚛 Số xe nạp: Xe 09
⏰ Giờ Tra nạp: 10:45
⏰ Giờ Hạ/Cất: Hạ 10:50 | Cất 11:35
📢 Giờ thông báo: ${nowStr}`;
    } else if (scenario === 'change-etd') {
      title = '🔄 [FMS THAY ĐỔI THÔNG TIN CHUYẾN BAY]';
      msg = `${title}
✈️ Chuyến bay: VN-TEST - VNA888
⛽ Giờ bay ETD (dự kiến) cũ: 11:35'
⛽ Giờ bay ETD (dự kiến) mới: 12:35'
Yêu cầu ĐIỀU HÀNH & Cặp tra nạp [THÀNH - CƯỜNG] check chéo thông tin.
📢 Giờ thông báo: ${nowStr}`;
    } else if (scenario === 'remind-schedule') {
      const randomMsg = WARNING_MESSAGES[Math.floor(Math.random() * WARNING_MESSAGES.length)];
      msg = randomMsg;
    } else {
      return res.status(400).json({ success: false, error: 'Kịch bản test không hợp lệ!' });
    }

    const ids = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
    const promises = ids.map(id => sendSkyEyesMessage(id, msg));
    const responses = await Promise.all(promises);
    res.json({ success: true, message: `Đã gửi tin nhắn test kịch bản thành công tới ${ids.length} nhóm!`, responses });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Yêu cầu quét FMS thủ công tức thì (chỉ Admin hoặc người có quyền FMS)
app.post('/api/fms/sync', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_fms !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { date, shift } = req.body;

  try {
    syncFMSData(date, shift).catch(err => console.error('[FMS] Lỗi quét thủ công:', err.message));
    res.json({ success: true, message: 'Đã bắt đầu tiến trình quét tải dầu FMS chạy ngầm...' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật vị trí đỗ (Gate) thủ công và báo Zalo (Admin hoặc người có quyền sửa vị trí đỗ)
app.post('/api/fms/schedule/update-gate', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_gate !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền sửa vị trí đỗ' });
  }

  const { flightNo, date, gate } = req.body;
  if (!flightNo || !date) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp số hiệu chuyến bay và ngày bay!' });
  }

  const newGate = gate ? String(gate).trim() : '';

  try {
    const db = await getDb();
    
    // Tìm chuyến bay trong fms_schedules
    const flight = await db.get(
      'SELECT id, flight_no, ac_reg, crew_info, truck_no, gate, crew_zalo_uids, notify_type FROM fms_schedules WHERE flight_no = ? AND date = ? ORDER BY id DESC LIMIT 1',
      flightNo,
      date
    );

    if (!flight) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy chuyến bay tương ứng trong lịch trực!' });
    }

    const oldGate = flight.gate ? String(flight.gate).trim() : '';
    if (oldGate === newGate) {
      return res.json({ success: true, message: 'Vị trí đỗ không thay đổi.' });
    }

    // Cập nhật vị trí đỗ
    await db.run('UPDATE fms_schedules SET gate = ? WHERE id = ?', newGate, flight.id);

    // Gửi thông báo qua Zalo nếu cấu hình thông báo đang bật
    const notifySetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_notify_enabled'");
    const notifyEnabled = notifySetting ? notifySetting.value === 'true' : false;

    if (notifyEnabled) {
      const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
      const targetGroupId = groupSetting ? groupSetting.value : null;

      const crewZaloUids = flight.crew_zalo_uids || '';
      const notifyType = flight.notify_type !== undefined ? parseInt(flight.notify_type) : 1; // 1: Tag Nhóm, 2: Inbox, 3: Cả hai
      const uids = crewZaloUids.split(',').map(uid => uid.trim()).filter(Boolean);

      const title = '🔄 [FMS THAY ĐỔI VỊ TRÍ ĐỖ]';
      const msg = `${title}
✈️ Chuyến bay: ${flight.flight_no} - ${flight.ac_reg || '-'}
📍 Vị trí đỗ cũ: ${oldGate || '-'} ➔ Mới: ${newGate || '-'}
👥 Cặp tra nạp: ${flight.crew_info || '-'}
🚛 Số xe nạp: ${flight.truck_no || '-'}`;

      let msgGroup = msg;
      let groupMentions = [];

      // 1. Gửi tin nhóm (notifyType === 1 || notifyType === 3)
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
            console.error('[Gate Mentions Build Error]', mentionErr.message);
          }
        }

        const ids = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
        ids.forEach(id => {
          sendSkyEyesMessage(id, msgGroup, groupMentions).catch(err => console.error('[Zalo Gate Change Error] Group:', id, err.message));
        });
      }

      // 2. Gửi inbox cá nhân riêng (notifyType === 2 || notifyType === 3)
      if ((notifyType === 2 || notifyType === 3) && uids.length > 0) {
        uids.forEach(uid => {
          sendSkyEyesPrivateMessage(uid, msg).catch(err => console.error('[Zalo Gate Change Private Error] UID:', uid, err.message));
        });
      }
    }

    res.json({ success: true, message: `Đã cập nhật vị trí đỗ thành ${newGate || 'trống'} và gửi tin nhắn Zalo thành công!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cập nhật hình thức thông báo Zalo (notify_type) cho Cặp trực ban
app.post('/api/fms/schedule/update-notify-type', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_fms !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thay đổi cài đặt thông báo Zalo!' });
  }

  const { crewInfo, date, notifyType } = req.body;
  if (!crewInfo || !date || notifyType === undefined) {
    return res.status(400).json({ success: false, error: 'Thiếu thông số cần thiết!' });
  }

  const nType = parseInt(notifyType);
  if (![1, 2, 3].includes(nType)) {
    return res.status(400).json({ success: false, error: 'Hình thức thông báo không hợp lệ!' });
  }

  try {
    const db = await getDb();
    
    // Cập nhật tất cả bản ghi khớp Cặp trực ban và ngày bay
    const result = await db.run(
      'UPDATE fms_schedules SET notify_type = ? WHERE UPPER(crew_info) = UPPER(?) AND date = ?',
      nType,
      crewInfo.trim(),
      date
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy Cặp trực ban tương ứng trong lịch trực!' });
    }

    res.json({ success: true, message: `Đã cập nhật hình thức báo Zalo cho cặp ${crewInfo.trim()} thành công!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Nhận diện ảnh lịch bay trực ca qua Gemini Vision API (chỉ Admin hoặc người có quyền FMS)
app.post('/api/fms/ocr-image', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_fms !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { mimeType, base64Data } = req.body;
  if (!mimeType || !base64Data) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp đầy đủ dữ liệu ảnh và định dạng!' });
  }

  try {
    // Làm sạch chuỗi Base64
    const cleanBase64 = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
    
    // Gọi OCR xoay vòng key
    const flights = await performImageOCR(mimeType, cleanBase64);
    
    res.json({ success: true, flights });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách API Keys Gemini đã lưu (chỉ Admin hoặc người có quyền Gemini)
app.get('/api/fms/settings/gemini-keys', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_gemini !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  try {
    const db = await getDb();
    const setting = await db.get("SELECT value FROM settings WHERE key = 'gemini_api_keys'");
    res.json({ success: true, keys: setting ? setting.value : '' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lưu danh sách API Keys Gemini (chỉ Admin hoặc người có quyền Gemini)
app.post('/api/fms/settings/gemini-keys', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_gemini !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { keys } = req.body;
  
  try {
    const db = await getDb();
    await db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES ('gemini_api_keys', ?)",
      keys ? keys.trim() : ''
    );
    res.json({ success: true, message: 'Đã lưu danh sách API Key Gemini thành công!' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Kiểm thử danh sách API Keys Gemini (chỉ Admin hoặc người có quyền Gemini)
app.post('/api/fms/settings/test-keys', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_gemini !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { keys } = req.body;
  if (!keys) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp danh sách keys để test!' });
  }

  const apiKeys = keys
    .split(/[\n,;]/)
    .map(k => k.trim())
    .filter(k => k.length > 0);

  if (apiKeys.length === 0) {
    return res.json({ success: true, results: [] });
  }

  try {
    const promises = apiKeys.map(async (key) => {
      const maskedKey = key.length > 10
        ? key.substring(0, 6) + '...' + key.substring(key.length - 4)
        : 'Key ngắn';
      
      const testResult = await testSingleGeminiKey(key);
      return {
        key: maskedKey,
        success: testResult.success,
        message: testResult.success ? 'Hoạt động tốt (OK)' : `Lỗi: ${testResult.error}`
      };
    });

    const results = await Promise.all(promises);
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- API QUẢN LÝ MAPPING THÀNH VIÊN VÀ TRẠNG THÁI ZALO MỚI ---
let cachedMembers = null;
let cacheTime = 0;

// API lấy danh sách nhân sự trực hôm nay chưa liên kết Zalo
app.get('/api/fms/zalo/unmapped-crews', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    
    // Lấy ngày hiện tại Việt Nam YYYY-MM-DD
    const tzOffset = 7 * 60 * 60 * 1000;
    const vnDate = new Date(Date.now() + tzOffset);
    const pad = (n) => String(n).padStart(2, '0');
    const todayStr = `${vnDate.getUTCFullYear()}-${pad(vnDate.getUTCMonth() + 1)}-${pad(vnDate.getUTCDate())}`;
    
    // Lấy lịch bay của ngày hôm nay
    const schedules = await db.all("SELECT driver_name, operator_name FROM fms_schedules WHERE date = ?", todayStr);
    
    // Lấy tất cả tên độc nhất của nhân sự trực hôm nay
    const activeCrews = new Set();
    schedules.forEach(s => {
      if (s.driver_name) activeCrews.add(s.driver_name.toUpperCase().trim());
      if (s.operator_name) activeCrews.add(s.operator_name.toUpperCase().trim());
    });
    
    // Lấy danh sách mappings hiện tại
    const mappings = await db.all("SELECT schedule_name FROM zalo_user_mappings");
    const mappedNames = new Set(mappings.map(m => m.schedule_name.toUpperCase().trim()));
    
    // Lọc ra các nhân sự chưa được map
    const unmapped = [];
    activeCrews.forEach(name => {
      if (name && name !== '-' && !mappedNames.has(name)) {
        unmapped.push(name);
      }
    });
    
    unmapped.sort();
    res.json({ success: true, unmapped: unmapped });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API lấy danh sách thành viên nhóm Zalo đang được cấu hình
app.get('/api/fms/zalo/group-members', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền truy cập cài đặt Zalo' });
  }

  // Kiểm tra cache (3 phút) để tránh spam API Zalo làm block tài khoản
  const now = Date.now();
  if (cachedMembers && (now - cacheTime < 3 * 60 * 1000)) {
    return res.json({ success: true, members: cachedMembers });
  }

  try {
    const db = await getDb();
    const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
    const targetGroupId = groupSetting ? groupSetting.value : null;

    if (!targetGroupId) {
      return res.json({ success: true, members: [], message: 'Chưa cấu hình nhóm Zalo đích' });
    }

    const { initZaloBot } = require('./zaloService');
    const api = await initZaloBot();
    if (!api) {
      return res.status(500).json({ success: false, error: 'Bot Zalo chưa được đăng nhập hoặc không hoạt động!' });
    }

    const ids = targetGroupId.split(',').map(id => id.trim()).filter(Boolean);
    let allMembers = [];
    let processedUids = new Set();

    for (const gid of ids) {
      try {
        const gInfo = await api.getGroupInfo(gid);
        const gridInfo = gInfo?.gridInfoMap?.[gid];
        const memList = gridInfo?.memVerList || [];

        if (memList.length > 0) {
          const uids = memList.map(item => {
            if (typeof item === 'string') return item.split('_')[0];
            if (item && typeof item === 'object') return Object.keys(item)[0];
            return String(item);
          }).filter(Boolean);

          const chunkSize = 50;
          for (let i = 0; i < uids.length; i += chunkSize) {
            const chunk = uids.slice(i, i + chunkSize);
            const membersInfo = await api.getGroupMembersInfo(chunk);
            const profiles = membersInfo?.profiles || membersInfo || {};

            for (const uid of Object.keys(profiles)) {
              if (!processedUids.has(uid) && uid !== 'profiles' && uid !== 'unchangeds_profile') {
                processedUids.add(uid);
                const profile = profiles[uid];
                allMembers.push({
                  uid: uid,
                  displayName: profile?.displayName || profile?.name || profile?.zaloName || uid
                });
              }
            }
          }
        }
      } catch (groupErr) {
        console.error(`[API Members] Lỗi xử lý nhóm ${gid}:`, groupErr.message);
      }
    }

    allMembers.sort((a, b) => a.displayName.localeCompare(b.displayName));
    
    cachedMembers = allMembers;
    cacheTime = now;

    res.json({ success: true, members: allMembers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API lấy toàn bộ danh sách mapping tên lịch trực -> Zalo UID
app.get('/api/fms/zalo/mappings', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT schedule_name, zalo_uid, zalo_name FROM zalo_user_mappings');
    res.json({ success: true, mappings: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API thêm/cập nhật mapping Zalo
app.post('/api/fms/zalo/mappings', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { scheduleName, zaloUid, zaloName } = req.body;
  if (!scheduleName || !zaloUid) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp đầy đủ Tên lịch trực và Zalo UID!' });
  }

  const cleanName = String(scheduleName).trim().toUpperCase();

  try {
    const db = await getDb();
    await db.run(
      'INSERT OR REPLACE INTO zalo_user_mappings (schedule_name, zalo_uid, zalo_name) VALUES (?, ?, ?)',
      cleanName,
      String(zaloUid).trim(),
      zaloName ? String(zaloName).trim() : ''
    );
    res.json({ success: true, message: `Đã cập nhật mapping cho nhân viên ${cleanName} thành công!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API xóa mapping Zalo (chỉ Admin hoặc người có quyền Zalo)
app.delete('/api/fms/zalo/mappings', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_zalo !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { scheduleName } = req.body;
  if (!scheduleName) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp Tên lịch trực cần xóa!' });
  }

  try {
    const db = await getDb();
    await db.run('DELETE FROM zalo_user_mappings WHERE UPPER(schedule_name) = UPPER(?)', String(scheduleName).trim());
    res.json({ success: true, message: `Đã xóa liên kết của nhân viên ${scheduleName} thành công!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API lấy danh sách tàu bay giám sát Tạm nhập - Tái xuất trong ngày (Admin hoặc có quyền FMS/Zalo)
app.get('/api/fms/temp-import-exports', authenticateToken, async (req, res) => {
  const { date } = req.query;
  const targetDate = date ? String(date).trim() : new Date().toISOString().split('T')[0];

  try {
    const db = await getDb();
    const rows = await db.all(
      "SELECT * FROM fms_temp_import_exports WHERE date = ? OR is_warned < 2 ORDER BY id DESC",
      targetDate
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API xác nhận đã xử lý hóa đơn hoặc xóa theo dõi cho một bản ghi Tạm nhập - Tái xuất
app.post('/api/fms/temp-import-exports/confirm', authenticateToken, async (req, res) => {
  const { id, action } = req.body; // action: 'confirm' hoặc 'delete'
  if (!id) {
    return res.status(400).json({ success: false, error: 'Vui lòng cung cấp mã định danh ID!' });
  }

  try {
    const db = await getDb();
    if (action === 'confirm') {
      // Đánh dấu là đã xử lý/xác nhận (is_warned = 2)
      await db.run(
        "UPDATE fms_temp_import_exports SET is_warned = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        id
      );
      res.json({ success: true, message: 'Đã chuyển trạng thái sang Đã xử lý!' });
    } else if (action === 'pending') {
      // Đặt lại về trạng thái đang theo dõi/chờ xử lý (is_warned = 0)
      await db.run(
        "UPDATE fms_temp_import_exports SET is_warned = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        id
      );
      res.json({ success: true, message: 'Đã khôi phục trạng thái sang Chờ xử lý!' });
    } else {
      // Xóa hẳn bản ghi khỏi database
      await db.run("DELETE FROM fms_temp_import_exports WHERE id = ?", id);
      res.json({ success: true, message: 'Đã xóa bản ghi theo dõi thành công!' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API giả lập tình huống test Tạm nhập - Tái xuất
app.post('/api/fms/temp-import-exports/test', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_fms !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền thực hiện hành động này' });
  }

  const { scenario } = req.body; // scenario: 1 (Nội địa -> Quốc tế), 2 (Quốc tế -> Nội địa), 3 (HAN-HAN -> Nội địa), 4 (HAN-HAN -> Quốc tế)
  const scNum = parseInt(scenario) || 1;

  const todayDb = getVietnamDbDateStr();
  const testAcReg = 'VNA-TEST';
  let oldFlight = 'VN161';
  let oldRoute = 'HAN-DAD';
  let fuelOrder = 8500;
  let newFlight = 'VN416';
  let newRoute = 'HAN-ICN';
  let monitorType = 'DOMESTIC_TO_INTL';
  let oldTime = '10:30';
  let msg = '';

  if (scNum === 2) {
    oldFlight = 'VN416';
    oldRoute = 'HAN-ICN';
    fuelOrder = 15000;
    newFlight = 'VN161';
    newRoute = 'HAN-DAD';
    monitorType = 'INTL_TO_DOMESTIC';
    oldTime = '08:15';
    msg = `⚠️ [CẢNH BÁO SỬ DỤNG DẦU QUỐC TẾ CHO NỘI ĐỊA]
Điều hành chú ý: Sử dụng tàu đã nạp Quốc tế cho chuyến bay Nội địa.
✈️ Tàu bay: ${testAcReg}
⛽ Đã nạp chặng Quốc tế: ${fuelOrder.toLocaleString()} kg (Chuyến cũ: ${oldFlight} lúc ${oldTime} chặng ${oldRoute})
🔄 Hiện được phân công xếp bay chuyến Nội địa: ${newFlight} (${newRoute})
📢 Giờ cảnh báo giả lập: ${getVietnamDateTimeStr()}`;
  } else if (scNum === 3) {
    oldFlight = 'VN990';
    oldRoute = 'HAN-HAN';
    fuelOrder = 5000;
    newFlight = 'VN172';
    newRoute = 'HAN-DAD';
    monitorType = 'TECHNICAL_HAN';
    oldTime = '14:20';
    msg = `⚠️ [CẢNH BÁO SỬ DỤNG DẦU NẠP KỸ THUẬT]
Điều hành chú ý: Sử dụng tàu đã nạp kỹ thuật cho chuyến bay nội địa.
✈️ Tàu bay: ${testAcReg}
⛽ Đã nạp kỹ thuật chặng HAN-HAN: ${fuelOrder.toLocaleString()} kg (Chuyến cũ: ${oldFlight} lúc ${oldTime})
🔄 Hiện được phân công bay chuyến Nội địa: ${newFlight} (${newRoute})
📢 Giờ cảnh báo giả lập: ${getVietnamDateTimeStr()}`;
  } else if (scNum === 4) {
    oldFlight = 'VN990';
    oldRoute = 'HAN-HAN';
    fuelOrder = 5000;
    newFlight = 'VN416';
    newRoute = 'HAN-ICN';
    monitorType = 'TECHNICAL_HAN';
    oldTime = '14:20';
    msg = `⚠️ [CẢNH BÁO TẠM NHẬP - TÁI XUẤT]
Điều hành chú ý: Sử dụng tàu đã nạp kỹ thuật Han-Han cho chuyến bay Quốc Tế.
✈️ Tàu bay: ${testAcReg}
⛽ Đã nạp kỹ thuật chặng HAN-HAN: ${fuelOrder.toLocaleString()} kg (Chuyến cũ: ${oldFlight} lúc ${oldTime})
🔄 Hiện được phân công bay chuyến Quốc tế: ${newFlight} (${newRoute})
📢 Giờ cảnh báo giả lập: ${getVietnamDateTimeStr()}`;
  } else {
    // Mặc định: Kịch bản 1 (Nội địa -> Quốc tế)
    msg = `⚠️ [CẢNH BÁO]
Tàu bay ${testAcReg} đã nạp ${fuelOrder.toLocaleString()} kg dầu cho chuyến bay nội địa ${oldFlight} (${oldRoute} lúc ${oldTime}) nhưng đổi tàu.
Hiện tại, tàu ${testAcReg} đang được phân công bay chuyến bay Quốc tế ${newFlight} (${newRoute}).
Yêu cầu Điều hành & thống kê kiểm tra ngay lập tức!
📢 Giờ cảnh báo giả lập: ${getVietnamDateTimeStr()}`;
  }

  try {
    const db = await getDb();
    
    // Xóa bản ghi test cũ của ngày hôm nay nếu có để tránh trùng lặp
    await db.run("DELETE FROM fms_temp_import_exports WHERE ac_reg = ?", testAcReg);

    // 1. Thêm bản ghi mới ở trạng thái đã phát hiện và phát cảnh báo (is_warned = 1)
    await db.run(`
      INSERT INTO fms_temp_import_exports (ac_reg, old_flight_no, old_route, fuel_order, date, new_flight_no, new_route, is_warned, monitor_type, old_time)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `, testAcReg, oldFlight, oldRoute, fuelOrder, todayDb, newFlight, newRoute, monitorType, oldTime);

    // 2. Gửi tin nhắn Zalo cảnh báo
    const notifySetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_notify_enabled'");
    const isSkyOneEnabled = notifySetting ? (notifySetting.value === 'true') : false;

    // Đọc nhóm riêng nhận cảnh báo chênh lệch tải dầu
    const ieGroupSetting = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_group_id'");
    let targetGroupId = ieGroupSetting ? ieGroupSetting.value : '';

    if (!targetGroupId) {
      // Fallback về nhóm Zalo FMS chung
      const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
      targetGroupId = groupSetting ? groupSetting.value : '';
    }

    if (isSkyOneEnabled && targetGroupId) {
      const groupIds = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
      for (const id of groupIds) {
        await sendSkyEyesMessage(id, msg, []).catch(e => console.error('[Test Alert Zalo Error]', e.message));
      }
    }

    res.json({ success: true, message: `Đã tạo giả lập test kịch bản ${scNum} thành công và gửi tin Zalo cảnh báo!` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- CẢNH BÁO SAI TÊN HÃNG HÀNG KHÔNG ---
app.get('/api/fms/airline-alerts', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const targetDate = req.query.date || getVietnamDbDateStr();
    const rows = await db.all(
      "SELECT * FROM fms_airline_alerts WHERE date = ? OR is_warned < 2 ORDER BY id DESC LIMIT 100",
      targetDate
    );
    res.json({ success: true, data: rows, mappings: listAirlineMappings() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/fms/airline-alerts/confirm', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_fms !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền' });
  }
  const { id, action } = req.body;
  if (!id) return res.status(400).json({ success: false, error: 'Thiếu ID' });
  try {
    const db = await getDb();
    if (action === 'confirm') {
      await db.run("UPDATE fms_airline_alerts SET is_warned = 2, updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
    } else if (action === 'reopen') {
      await db.run("UPDATE fms_airline_alerts SET is_warned = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?", id);
    } else {
      await db.run("DELETE FROM fms_airline_alerts WHERE id = ?", id);
    }
    res.json({ success: true, message: 'Đã cập nhật cảnh báo hãng HK' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/fms/airline-alerts/test', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin' && req.user.perm_admin !== 1 && req.user.perm_fms !== 1) {
    return res.status(403).json({ success: false, error: 'Không có quyền' });
  }

  // scenario:
  // 1=CA 4 số tên sai, 2=CA 3 số tên sai, 3=IO, 4=BSF, 5=SAV, 6=QY, 7=CA 4 số tên đúng (không cảnh báo)
  const scNum = parseInt(req.body.scenario, 10) || 1;
  const todayDb = getVietnamDbDateStr();
  const cases = {
    1: {
      flight: 'CA6116',
      wrongAirlineName: 'Tổng công ty Hàng không Việt Nam - CTCP',
      code: 'CA'
    },
    2: {
      flight: 'CA123',
      wrongAirlineName: 'World Fuel Services (Singapore) Pte. Ltd.-Air China Cargo',
      code: 'CA'
    },
    3: {
      flight: 'IO1234',
      wrongAirlineName: 'Pacific Airlines',
      code: 'IO'
    },
    4: {
      flight: 'BSF8801',
      wrongAirlineName: 'Vietnam Airlines',
      code: 'BSF'
    },
    5: {
      flight: 'SAV220',
      wrongAirlineName: 'Bamboo Airways',
      code: 'SAV'
    },
    6: {
      flight: 'QY9901',
      wrongAirlineName: 'Air China Limited',
      code: 'QY'
    },
    7: {
      flight: 'CA8421',
      wrongAirlineName: 'World Fuel Services (Singapore) Pte. Ltd.-Air China Cargo',
      code: 'CA',
      expectOk: true
    }
  };
  const c = cases[scNum] || cases[1];
  const mismatch = evaluateAirlineMismatch({
    flightNo: c.flight,
    carrierCode: '',
    actualAirlineName: c.wrongAirlineName,
    selectedAirlineName: c.wrongAirlineName
  });

  if (c.expectOk) {
    return res.json({
      success: true,
      message: mismatch
        ? `Kịch bản 7 kỳ vọng KHỚP nhưng hệ thống báo sai: ${mismatch.reason}`
        : `OK — CA 4 số với tên đúng không sinh cảnh báo (${c.flight}).`,
      preview: mismatch
        ? JSON.stringify(mismatch, null, 2)
        : `PASS: ${c.flight} + "${c.wrongAirlineName}" khớp tên đúng.`
    });
  }

  if (!mismatch) {
    return res.status(400).json({
      success: false,
      error: `Kịch bản ${scNum} không tạo mismatch — kiểm tra map/logic.`
    });
  }

  const expectedName = mismatch.expectedName || '-';
  const msg = `⚠️ [CẢNH BÁO SAI TÊN HÃNG HÀNG KHÔNG] (TEST)
✈️ Chuyến bay: ${c.flight}
📋 Ký hiệu đúng: ${c.code}
🏢 Tên hãng đúng: ${expectedName}
❌ Hãng bay trên Skypec/FMS: ${c.wrongAirlineName}
📝 Chi tiết: ${mismatch.reason}
👥 Cặp tra nạp: TEST - DEMO
🚛 Xe: 99 | 📍 Gate: 12A | 🛩️ Tàu: VNA-TEST
📅 Ngày FMS: ${todayDb}
📢 Giờ cảnh báo giả lập: ${getVietnamDateTimeStr()}`;

  try {
    const db = await getDb();
    await db.run("DELETE FROM fms_airline_alerts WHERE flight_no = ? AND date = ?", c.flight, todayDb);
    await db.run(
      `INSERT INTO fms_airline_alerts
        (flight_no, date, expected_code, expected_name, actual_carrier, actual_name, crew_info, reason, is_warned)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      c.flight, todayDb, c.code, expectedName, '-', c.wrongAirlineName, 'TEST - DEMO',
      mismatch.reason
    );

    const notifySetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_notify_enabled'");
    const isOn = notifySetting ? (notifySetting.value === 'true') : false;

    let targetGroupId = '';
    const airlineGroup = await db.get("SELECT value FROM settings WHERE key = 'fms_airline_alert_group_id'");
    if (airlineGroup && airlineGroup.value) targetGroupId = airlineGroup.value;
    if (!targetGroupId) {
      const ie = await db.get("SELECT value FROM settings WHERE key = 'fms_import_export_group_id'");
      if (ie && ie.value) targetGroupId = ie.value;
    }
    if (!targetGroupId) {
      const g = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
      if (g && g.value) targetGroupId = g.value;
    }

    let sent = 0;
    if (isOn && targetGroupId) {
      const ids = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
      for (const id of ids) {
        await sendSkyEyesMessage(id, msg, []).catch(e => console.error('[Airline Test Zalo]', e.message));
        sent++;
      }
    }

    res.json({
      success: true,
      message: sent > 0
        ? `Đã tạo cảnh báo test ${c.flight} và gửi Zalo (${sent} nhóm)!`
        : `Đã tạo cảnh báo test ${c.flight} trên bảng (Zalo tắt hoặc chưa chọn nhóm).`,
      preview: msg
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Tiến trình tự động cảnh báo Zalo nếu bắt đầu ca trực mới mà chưa import lịch trực mới
function startScheduleWarningWorker() {
  console.log('[Scheduler] Đã kích hoạt tiến trình kiểm tra thiếu lịch trực tự động.');
  let lastCheckedKey = ''; // Định dạng 'YYYY-MM-DD HH:MM'

  const checkAndWarnMissingSchedule = async (targetDate) => {
    try {
      const db = await getDb();
      const row = await db.get("SELECT COUNT(*) as count FROM fms_schedules WHERE date = ?", targetDate);
      if (!row || row.count === 0) {
        const randomMsg = WARNING_MESSAGES[Math.floor(Math.random() * WARNING_MESSAGES.length)];
        const groupSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_target_group_id'");
        const targetGroupId = groupSetting ? groupSetting.value : null;
        if (targetGroupId) {
          const ids = String(targetGroupId).split(',').map(id => id.trim()).filter(Boolean);
          console.log(`[Scheduler] Phát hiện thiếu lịch trực ngày ${targetDate}. Tiến hành gửi Zalo cảnh báo...`);
          for (const id of ids) {
            await sendSkyEyesMessage(id, randomMsg).catch(e => console.error('[Scheduler Zalo Send Error]', e.message));
          }
        }
      }
    } catch (err) {
      console.error('[Scheduler Error]', err.message);
    }
  };

  setInterval(() => {
    const now = new Date();
    const vnTime = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    
    const year = vnTime.getUTCFullYear();
    const month = String(vnTime.getUTCMonth() + 1).padStart(2, '0');
    const dateVal = String(vnTime.getUTCDate()).padStart(2, '0');
    const hours = vnTime.getUTCHours();
    const minutes = vnTime.getUTCMinutes();
    
    const timeKey = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    const dateStr = `${year}-${month}-${dateVal}`;
    const checkKey = `${dateStr} ${timeKey}`;
    
    if (checkKey === lastCheckedKey) return;
    
    if (timeKey === '07:30' || timeKey === '19:30') {
      lastCheckedKey = checkKey;
      checkAndWarnMissingSchedule(dateStr);
    } else if (timeKey === '00:00') {
      lastCheckedKey = checkKey;
      const yesterday = new Date(vnTime.getTime() - 24 * 60 * 60 * 1000);
      const yYear = yesterday.getUTCFullYear();
      const yMonth = String(yesterday.getUTCMonth() + 1).padStart(2, '0');
      const yDate = String(yesterday.getUTCDate()).padStart(2, '0');
      const yesterdayStr = `${yYear}-${yMonth}-${yDate}`;
      checkAndWarnMissingSchedule(yesterdayStr);
    }
  }, 30000);
}

// --- KHỞI ĐỘNG HỆ THỐNG ---
app.listen(PORT, async () => {
  console.log(`[LMS] Máy chủ đang chạy tại: http://localhost:${PORT}`);
  
  // Khởi chạy bộ máy học tập chạy ngầm cho các tài khoản đang bật sẵn
  await initEngine();

  // Khởi chạy tiến trình quét ngầm FMS (1.5 phút/90 giây một lần)
  startFmsWorker(1.5 * 60 * 1000);

  // Khởi chạy tiến trình cảnh báo thiếu lịch trực ca mới
  startScheduleWarningWorker();

  // Tự động kết nối Zalo Bot SkyEyes nếu đã có session cookies
  initZaloBot().catch(err => console.error('[SkyEyes] Khởi tạo Zalo tự động thất bại:', err.message));
});
