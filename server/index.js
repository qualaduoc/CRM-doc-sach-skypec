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
const { startLearning, stopLearning, initEngine, activeConnections, fetchActualProgress } = require('./lrsEngine');

const app = express();
const PORT = process.env.PORT || 3005; // Chạy ở cổng 3005 để tránh xung đột
const JWT_SECRET = process.env.JWT_SECRET || 'crm-skypec-secret-key';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'd6F3EFEa15839011290abcdef1234567'; // Phải đúng 32 ký tự
const IV_LENGTH = 16;
const HOST = 'elearning.skypec.com.vn';

app.use(cors());
app.use(express.json());
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
              resolve(json.data[0].id);
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
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ success: false, error: 'Chưa cung cấp mã xác thực JWT' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Mã xác thực không hợp lệ hoặc đã hết hạn' });
    req.user = user;
    next();
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

    // 1. Kiểm tra nếu là Admin đăng nhập hệ thống CRM
    if (username.trim() === 'admin') {
      const adminRow = await db.get('SELECT * FROM admin WHERE username = ?', 'admin');
      if (adminRow && bcrypt.compareSync(password, adminRow.password)) {
        const token = jwt.sign({ role: 'admin', username: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, token, role: 'admin', displayName: 'Quản trị viên' });
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

    // Tạo JWT token cho phiên làm việc
    const token = jwt.sign({ role: 'user', username: username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, token, role: 'user', displayName, department });

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

        const isFinish = (joinData.data.isFinish === 1 || joinData.data.isFinish === true) ? 1 : 0;

        // Tránh tình trạng tụt lùi số phút trên giao diện khi đồng bộ lúc lớp học vẫn đang treo ngầm
        const currentLocal = await db.get('SELECT learn_time, auto_learn FROM classes WHERE id = ? AND account_username = ?', classId, username);
        if (currentLocal && currentLocal.auto_learn === 1 && learnTime < currentLocal.learn_time) {
          // Giữ nguyên số phút tự đếm lớn hơn của hệ thống khi phiên học của Skypec chưa được đóng và ghi nhận
          learnTime = currentLocal.learn_time;
        }

        // Lưu vào DB cục bộ
        await db.run(`
          INSERT INTO classes (id, account_username, class_title, class_user_id, learning_id, content_id, learn_time, min_time_required, is_finish)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id, account_username) DO UPDATE SET
            class_title = excluded.class_title,
            class_user_id = excluded.class_user_id,
            learning_id = excluded.learning_id,
            content_id = excluded.content_id,
            learn_time = excluded.learn_time,
            min_time_required = excluded.min_time_required,
            is_finish = excluded.is_finish
        `, classId, username, item.classTitle, classUserId, learningId, contentId, learnTime, minTimeRequired, isFinish);

        // Tự động dừng học ngầm nếu lớp học đã hoàn thành hoặc đạt đủ số phút
        if (isFinish === 1) {
          const prevClass = await db.get('SELECT auto_learn FROM classes WHERE id = ? AND account_username = ?', classId, username);
          if (prevClass && prevClass.auto_learn === 1) {
            console.log(`[Sync] Lớp học "${item.classTitle}" của ${username} đã hoàn thành. Tự động dừng học ngầm.`);
            await db.run('UPDATE classes SET auto_learn = 0 WHERE id = ? AND account_username = ?', classId, username);
            stopLearning(classId);
          }
        } else if (minTimeRequired && learnTime >= minTimeRequired) {
          const prevClass = await db.get('SELECT auto_learn FROM classes WHERE id = ? AND account_username = ?', classId, username);
          if (prevClass && prevClass.auto_learn === 1) {
            console.log(`[Sync] Lớp học "${item.classTitle}" của ${username} đã đạt đủ số phút tối thiểu. Tự động dừng học ngầm.`);
            await db.run('UPDATE classes SET auto_learn = 0, is_finish = 1 WHERE id = ? AND account_username = ?', classId, username);
            stopLearning(classId);
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
    const db = await getDb();
    if (req.user.role === 'admin') {
      return res.json({ 
        success: true, 
        user: { 
          role: 'admin', 
          username: 'admin', 
          display_name: 'Quản trị viên',
          department: 'Quản lý hệ thống'
        } 
      });
    }

    const user = await db.get('SELECT username, display_name, department, email, phone, position_name, kpi_percent, kpi_total, kpi_current, total_certificate, class_total FROM accounts WHERE username = ?', req.user.username);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy tài khoản nhân viên' });
    }
    res.json({ success: true, user: { ...user, role: 'user' } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Lấy danh sách tài khoản (Chỉ dành cho Admin)
app.get('/api/accounts', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Không có quyền truy cập' });

  try {
    const db = await getDb();
    const rows = await db.all('SELECT username, display_name, department, status, created_at, kpi_percent FROM accounts');
    
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
      if (activeConnections.has(c.id)) {
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

    // Gắn thêm trạng thái kết nối WebSocket thực tế từ bộ máy Engine
    const result = rows.map(c => ({
      ...c,
      isRunning: activeConnections.has(c.id)
    }));

    res.json({ success: true, classes: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Bật/Tắt chế độ tự động chạy ngầm cho lớp học
app.post('/api/classes/:classId/toggle-learn', authenticateToken, async (req, res) => {
  const classId = req.params.classId;
  const { auto_learn } = req.body; // 0 hoặc 1

  try {
    const db = await getDb();
    const classItem = await db.get('SELECT * FROM classes WHERE id = ?', classId);
    if (!classItem) return res.status(404).json({ success: false, error: 'Không tìm thấy lớp học' });

    // Kiểm tra quyền sở hữu
    if (req.user.role !== 'admin' && classItem.account_username !== req.user.username) {
      return res.status(403).json({ success: false, error: 'Không có quyền thao tác trên lớp học này' });
    }

    if (auto_learn === 1) {
      // Đếm số lớp đang treo của tài khoản này
      const activeCount = await db.get(
        'SELECT COUNT(*) as count FROM classes WHERE account_username = ? AND auto_learn = 1',
        classItem.account_username
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
    await db.run('UPDATE classes SET auto_learn = ? WHERE id = ? AND account_username = ?', auto_learn, classId, classItem.account_username);

    const account = await db.get('SELECT * FROM accounts WHERE username = ?', classItem.account_username);
    const decryptedPassword = decrypt(account.password);
    const accWithPlainPass = { ...account, password: decryptedPassword };

    if (auto_learn === 1) {
      // Bật chạy ngầm
      startLearning(accWithPlainPass, classItem);
    } else {
      // Dừng chạy ngầm
      stopLearning(classId);
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

// Xóa tài khoản nhân viên ra khỏi CRM (Chỉ dành cho Admin)
app.delete('/api/accounts/:username', authenticateToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ success: false, error: 'Không có quyền thao tác' });

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

// --- KHỞI ĐỘNG HỆ THỐNG ---
app.listen(PORT, async () => {
  console.log(`[CRM] Máy chủ đang chạy tại: http://localhost:${PORT}`);
  
  // Khởi chạy bộ máy học tập chạy ngầm cho các tài khoản đang bật sẵn
  await initEngine();
});
