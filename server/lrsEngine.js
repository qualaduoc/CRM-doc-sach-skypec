const WebSocket = require('ws');
const { getDb } = require('./db');
const https = require('https');
const querystring = require('querystring');

const activeConnections = new Map(); // key: classId, value: connection object
const RECORD_SEPARATOR = '\u001e';
const HOST = 'elearning.skypec.com.vn';

// Hàm helper gọi API đăng nhập Skypec để lấy token mới
function refreshSkypecToken(username, password) {
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
        } else {
          reject(new Error(`Login failed with status: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Hàm gọi API đồng bộ tiến độ thực tế từ Skypec
function fetchActualProgress(token, classId) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: HOST, port: 443,
      path: `/skypec2.lms.api/api/v1/LmsClass/FrUserJoinClassNew/${classId}`,
      method: 'GET',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json, text/plain, */*',
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
            reject(e);
          }
        } else {
          reject(new Error(`Fetch progress failed: ${res.statusCode}`));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Hàm khởi chạy một kết nối học tập chạy ngầm
function startLearning(account, classItem) {
  const classId = classItem.id;
  if (activeConnections.has(classId)) {
    console.log(`[Engine] Lớp học ${classId} đã đang chạy.`);
    return;
  }

  console.log(`[Engine] Bắt đầu chạy ngầm cho tài khoản ${account.username} - Lớp: ${classItem.class_title}`);
  
  let ws = null;
  let pingInterval = null;
  let videoInterval = null;
  let videoTimeSeconds = Math.round((classItem.learn_time || 0) * 60) + 10;
  let invocationId = 1;
  let reconnectTimeout = null;
  let isStoppedManually = false;

  const connectionObj = {
    stop: () => {
      isStoppedManually = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      stopTimers();
      if (ws) ws.close(1000, 'Stopped by user');
      activeConnections.delete(classId);
      console.log(`[Engine] Đã dừng chạy ngầm lớp ${classId}`);
    }
  };

  activeConnections.set(classId, connectionObj);

  function stopTimers() {
    if (pingInterval) clearInterval(pingInterval);
    if (videoInterval) clearInterval(videoInterval);
  }

  async function connect() {
    if (isStoppedManually) return;

    try {
      const db = await getDb();
      // Lấy thông tin mới nhất từ DB
      const currentAcc = await db.get('SELECT * FROM accounts WHERE username = ?', account.username);
      const currentClass = await db.get('SELECT * FROM classes WHERE id = ?', classId);
      
      if (!currentAcc || !currentClass || currentClass.auto_learn === 0) {
        connectionObj.stop();
        return;
      }

      const token = currentAcc.access_token;
      const learningId = currentClass.learning_id;
      const contentId = currentClass.content_id;

      if (!learningId) {
        console.log(`[Engine] Lớp ${classId} không có learningId. Không thể kết nối WebSocket.`);
        connectionObj.stop();
        return;
      }

      const wsUrl = `wss://${HOST}/skypec2.lms.api/socket/hubs/lrs?learningId=${learningId}&clientProtocol=1.5&access_token=${encodeURIComponent(token)}`;
      
      ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      ws.on('open', () => {
        console.log(`[Engine] WebSocket kết nối thành công cho ${account.username} - Lớp: ${currentClass.class_title}`);
        
        // Gửi gói tin bắt tay
        ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + RECORD_SEPARATOR);

        // Gửi Ping duy trì socket mỗi 15 giây
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 6 }) + RECORD_SEPARATOR);
          }
        }, 15000);

        // Gửi VIDEO_TIME_UPDATE giả lập mỗi 10 giây
        if (contentId) {
          videoInterval = setInterval(async () => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              try {
                const innerPayload = JSON.stringify({
                  eventName: 'VIDEO_TIME_UPDATE',
                  learningId: learningId,
                  id: contentId,
                  data: videoTimeSeconds
                });
                
                const message = JSON.stringify({
                  type: 1,
                  invocationId: String(invocationId),
                  target: 'Handshake',
                  arguments: [innerPayload]
                }) + RECORD_SEPARATOR;

                ws.send(message);
                videoTimeSeconds += 10;
                invocationId++;

                // Tăng số phút học tập tạm thời ở local mỗi 10 giây (10 giây = 1/60 phút = ~0.167 phút) để hiển thị mượt mà trên giao diện
                const localDb = await getDb();
                await localDb.run('UPDATE classes SET learn_time = learn_time + (10.0 / 60.0), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND account_username = ?', classId, account.username);

                // Cứ mỗi 30 giây, tự động đồng bộ và kiểm tra số phút thực tế trực tiếp từ máy chủ Skypec
                if (videoTimeSeconds % 30 === 0) {
                  try {
                    const progress = await fetchActualProgress(token, classId);
                    if (progress && progress.status && progress.data) {
                      const actualTime = progress.data.totalTime || 0;
                      const isFinish = (progress.data.isFinish === 1 || progress.data.isFinish === true) ? 1 : 0;
                      
                      await localDb.run('UPDATE classes SET learn_time = ?, is_finish = ? WHERE id = ? AND account_username = ?', actualTime, isFinish, classId, account.username);
                      
                      // Kiểm tra xem đã đạt thời gian yêu cầu tối thiểu chưa
                      const currentClassInfo = await localDb.get('SELECT min_time_required, class_title FROM classes WHERE id = ? AND account_username = ?', classId, account.username);
                      if (currentClassInfo && currentClassInfo.min_time_required && actualTime >= currentClassInfo.min_time_required) {
                        console.log(`[Engine] Lớp học "${currentClassInfo.class_title}" của ${account.username} đã đạt thời gian yêu cầu tối thiểu (${currentClassInfo.min_time_required} phút). Tự động dừng học ngầm.`);
                        await localDb.run('UPDATE classes SET auto_learn = 0, is_finish = 1 WHERE id = ? AND account_username = ?', classId, account.username);
                        connectionObj.stop();
                      }
                    }
                  } catch (syncErr) {
                    console.warn(`[Engine Warning] Không thể tự động đồng bộ thực tế lớp ${classId} của ${account.username}:`, syncErr.message);
                  }
                }
              } catch (err) {
                console.error(`[Engine] Lỗi gửi nhịp tim lớp ${classId}:`, err.message);
              }
            }
          }, 10000);
        }
      });

      ws.on('message', (data) => {
        const msgStr = data.toString();
        console.log(`[Engine WS Message] [${account.username}]`, msgStr);
        
        // Khi nhận được phản hồi bắt tay thành công từ SignalR ({})
        if (msgStr.includes('{}')) {
          console.log(`[Engine] Bắt tay thành công cho ${account.username}. Gửi sự kiện START_VIEW cho lớp ${classId}...`);
          try {
            const startPayload = JSON.stringify({
              eventName: 'START_VIEW',
              learningId: learningId,
              id: contentId
            });
            const startMessage = JSON.stringify({
              type: 1,
              invocationId: String(invocationId),
              target: 'Handshake',
              arguments: [startPayload]
            }) + RECORD_SEPARATOR;
            
            ws.send(startMessage);
            invocationId++;
          } catch (err) {
            console.error(`[Engine] Lỗi gửi sự kiện START_VIEW cho ${account.username}:`, err.message);
          }
        }
      });

      ws.on('close', async (code, reason) => {
        stopTimers();
        if (isStoppedManually) return;

        console.log(`[Engine] WebSocket đóng (Code: ${code}) cho ${account.username}. Thử lại sau 5 giây...`);
        
        // Tự động kiểm tra Token và đăng nhập lại nếu lỗi kết nối do hết hạn
        if (code === 4005 || code === 1008 || (reason && reason.toString().includes('Unauthorized'))) {
          console.log(`[Engine] Phát hiện Token hết hạn cho ${account.username}. Đang đăng nhập lại...`);
          try {
            const loginResult = await refreshSkypecToken(account.username, account.password);
            if (loginResult && loginResult.access_token) {
              const localDb = await getDb();
              await localDb.run('UPDATE accounts SET access_token = ?, status = "active" WHERE username = ?', loginResult.access_token, account.username);
              console.log(`[Engine] Đăng nhập lại thành công cho ${account.username}.`);
            }
          } catch (loginErr) {
            console.error(`[Engine] Đăng nhập lại thất bại cho ${account.username}:`, loginErr.message);
            const localDb = await getDb();
            await localDb.run('UPDATE accounts SET status = "error" WHERE username = ?', account.username);
          }
        }

        reconnectTimeout = setTimeout(connect, 5000);
      });

      ws.on('error', (err) => {
        console.error(`[Engine] WebSocket lỗi cho ${account.username}:`, err.message);
        ws.close();
      });
    } catch (dbErr) {
      console.error(`[Engine] Lỗi kết nối DB trong connect():`, dbErr.message);
      reconnectTimeout = setTimeout(connect, 5000);
    }
  }

  connect();
}

// Dừng một lớp học cụ thể
function stopLearning(classId) {
  const conn = activeConnections.get(classId);
  if (conn) {
    conn.stop();
  }
}

// Khởi động tất cả các lớp học có auto_learn = 1 khi khởi động Server
async function initEngine() {
  console.log('[Engine] Đang khởi tạo bộ máy tự động học tập chạy ngầm...');
  try {
    const db = await getDb();
    const autoClasses = await db.all(`
      SELECT classes.*, accounts.password, accounts.access_token 
      FROM classes 
      JOIN accounts ON classes.account_username = accounts.username 
      WHERE classes.auto_learn = 1 AND accounts.status = 'active'
    `);

    autoClasses.forEach(c => {
      const account = { username: c.account_username, password: c.password, access_token: c.access_token };
      startLearning(account, c);
    });

    console.log(`[Engine] Đã khôi phục ${autoClasses.length} tiến trình học tập chạy ngầm.`);
  } catch (err) {
    console.error('[Engine] Lỗi khởi tạo bộ máy học tập:', err.message);
  }
}

module.exports = {
  startLearning,
  stopLearning,
  initEngine,
  activeConnections,
  fetchActualProgress
};
