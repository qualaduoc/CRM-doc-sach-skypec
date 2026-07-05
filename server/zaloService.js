const { getDb } = require('./db');
const path = require('path');
const fs = require('fs');

let ZaloSDK = null;
let activeApi = null;
let qrLoginActive = false;
let qrState = {
  status: 'disconnected', // disconnected, generating, qr_ready, scanned, connected, error
  error: null,
  qrUrl: null,
  ttl: 30
};

// Hàm phụ trợ import động Zalo SDK từ ES Module sang CommonJS
async function getZaloSDK() {
  if (!ZaloSDK) {
    const module = await import('./zca-gwendev/zalo.js');
    ZaloSDK = module.Zalo;
  }
  return ZaloSDK;
}

// Chuyển đổi cookie sang dạng chuẩn của tough-cookie
function serializeCookie(jar) {
  if (jar && typeof jar.toJSON === 'function') {
    const json = jar.toJSON();
    return JSON.stringify(json.cookies ?? json);
  } else if (typeof jar === 'string') {
    return jar;
  } else if (jar) {
    try {
      return JSON.stringify(jar);
    } catch (e) {
      return String(jar);
    }
  }
  return '';
}

// Khởi tạo Bot tự động bằng cookies đã lưu
async function initZaloBot() {
  try {
    const db = await getDb();
    const cookieSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_session_cookies'");
    const imeiSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_imei'");
    const uaSetting = await db.get("SELECT value FROM settings WHERE key = 'zalo_useragent'");

    if (!cookieSetting || !cookieSetting.value) {
      console.log('[SkyOne] Chưa cấu hình Session Cookies. Bot ở trạng thái disconnected.');
      qrState.status = 'disconnected';
      return null;
    }

    console.log('[SkyOne] Phát hiện cookies. Đang tự động kết nối...');
    qrState.status = 'connecting';

    const Zalo = await getZaloSDK();
    const zaloInstance = new Zalo({
      selfListen: true,
      checkUpdate: false,
      logging: false,
      qrPath: path.join(__dirname, '../public/zalo_qr.png')
    });

    let cookieValue = cookieSetting.value;
    try {
      cookieValue = JSON.parse(cookieSetting.value);
    } catch (e) {}

    activeApi = await zaloInstance.login({
      cookie: cookieValue,
      imei: imeiSetting ? imeiSetting.value : null,
      userAgent: uaSetting ? uaSetting.value : ''
    });

    console.log('[SkyOne] Kết nối tự động thành công!');
    qrState.status = 'connected';

    // Khởi chạy listener duy trì socket kết nối
    try {
      if (activeApi && activeApi.listener && typeof activeApi.listener.start === 'function') {
        activeApi.listener.start();
        console.log('[SkyOne] Đã khởi chạy socket listener.');
      }
    } catch (err) {
      console.warn('[SkyOne] Không thể start listener:', err.message);
    }

    return activeApi;
  } catch (err) {
    console.error('[SkyOne] Tự động kết nối thất bại:', err.message);
    qrState.status = 'disconnected';
    qrState.error = err.message;
    return null;
  }
}

// Sinh mã QR và bắt đầu tiến trình đăng nhập QR
async function startQRLogin() {
  if (qrLoginActive) {
    console.log('[SkyOne] Tiến trình QR Login đang chạy, không khởi tạo lại.');
    return;
  }

  qrLoginActive = true;
  qrState.status = 'generating';
  qrState.error = null;
  qrState.qrUrl = null;

  const qrFilename = 'zalo_qr.png';
  const absQrPath = path.join(__dirname, '../public', qrFilename);

  // Xóa ảnh QR cũ nếu có
  try {
    if (fs.existsSync(absQrPath)) {
      fs.unlinkSync(absQrPath);
    }
  } catch (e) {}

  try {
    const Zalo = await getZaloSDK();
    const setup = {
      selfListen: true,
      checkUpdate: false,
      logging: false,
      qrPath: absQrPath,
      ttl: 30,
      autoRetry: false,
      retry: 0,
      onScanned: () => {
        console.log('[SkyOne] Cảnh báo: Khầy đã quét QR! Đang chờ xác nhận trên điện thoại...');
        qrState.status = 'scanned';
      }
    };

    const zaloInstance = new Zalo(setup);

    // Chạy login QR ngầm (không chặn luồng chính)
    zaloInstance.loginQR(setup)
      .then(async (api) => {
        console.log('[SkyOne] Đăng nhập QR thành công!');
        activeApi = api;
        qrState.status = 'connected';
        qrState.qrUrl = null;
        qrLoginActive = false;

        // Lưu thông tin đăng nhập vào SQLite
        let ctx = {};
        try {
          if (typeof api.getContext === 'function') {
            ctx = await api.getContext();
          }
        } catch (e) {}

        const userAgent = ctx?.userAgent || api?.userAgent || '';
        const imei = ctx?.imei || ctx?.deviceId || api?.imei || '';
        const uid = ctx?.uid || api?.uid || '';
        
        let cookieSerialized = '';
        try {
          const jar = await api.getCookie();
          cookieSerialized = serializeCookie(jar);
        } catch (e) {}

        let displayName = 'SkyOne';
        try {
          if (typeof api.getUserInfo === 'function' && uid) {
            const info = await api.getUserInfo(uid);
            if (Array.isArray(info) && info.length) {
              displayName = info[0]?.displayName || info[0]?.name || 'SkyOne';
            }
          }
        } catch (e) {}

        const db = await getDb();
        await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('zalo_session_cookies', ?)", cookieSerialized);
        await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('zalo_imei', ?)", imei);
        await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('zalo_useragent', ?)", userAgent);
        await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('zalo_bot_name', ?)", displayName);

        // Khởi chạy listener duy trì kết nối socket
        try {
          if (api && api.listener && typeof api.listener.start === 'function') {
            api.listener.start();
          }
        } catch (e) {}
      })
      .catch((err) => {
        console.error('[SkyOne] QR Login lỗi:', err.message);
        qrState.status = 'error';
        qrState.error = err.message;
        qrLoginActive = false;
      });

    // Chờ file ảnh QR được tạo xong (tối đa 15s)
    let qrReady = false;
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 300));
      if (fs.existsSync(absQrPath) && fs.statSync(absQrPath).size > 100) {
        qrReady = true;
        break;
      }
      if (!qrLoginActive && qrState.status === 'error') {
        break;
      }
    }

    if (qrReady) {
      qrState.status = 'qr_ready';
      qrState.qrUrl = `/${qrFilename}?t=${Date.now()}`;
      console.log('[SkyOne] QR Code đã sẵn sàng cho Khầy quét!');
    } else {
      if (qrState.status !== 'error') {
        qrState.status = 'error';
        qrState.error = 'Timeout tạo QR Code từ Zalo';
      }
      qrLoginActive = false;
    }

  } catch (err) {
    console.error('[SkyOne] startQRLogin lỗi:', err.message);
    qrState.status = 'error';
    qrState.error = err.message;
    qrLoginActive = false;
  }
}

// Lấy danh sách nhóm Zalo
async function getBotGroups() {
  if (!activeApi) {
    throw new Error('Bot Zalo chưa được đăng nhập!');
  }

  const groupsResp = await activeApi.getAllGroups();
  const groups = [];

  if (groupsResp && groupsResp.gridVerMap) {
    const ids = Object.keys(groupsResp.gridVerMap);
    for (let i = 0; i < ids.length; i++) {
      const gid = ids[i];
      try {
        const gInfo = await activeApi.getGroupInfo(gid);
        const gridInfo = gInfo?.gridInfoMap?.[gid];
        groups.push({
          groupId: gid,
          groupName: gridInfo?.name || `Nhóm_${gid}`,
          memberCount: (gridInfo?.memVerList || []).length
        });
      } catch (e) {}
      if (i < ids.length - 1) {
        await new Promise(r => setTimeout(r, 100)); // Delay tránh spam
      }
    }
  }

  groups.sort((a, b) => (a.groupName || '').localeCompare(b.groupName || ''));
  return groups;
}

// Đăng xuất và xóa session cookies
async function logoutBot() {
  try {
    if (activeApi && activeApi.listener && typeof activeApi.listener.stop === 'function') {
      activeApi.listener.stop();
    }
  } catch (e) {}

  activeApi = null;
  qrState.status = 'disconnected';
  qrState.qrUrl = null;
  qrState.error = null;
  qrLoginActive = false;

  const db = await getDb();
  await db.run("DELETE FROM settings WHERE key = 'zalo_session_cookies'");
  await db.run("DELETE FROM settings WHERE key = 'zalo_imei'");
  await db.run("DELETE FROM settings WHERE key = 'zalo_useragent'");
  await db.run("DELETE FROM settings WHERE key = 'zalo_bot_name'");

  // Xóa ảnh QR cũ
  const absQrPath = path.join(__dirname, '../public/zalo_qr.png');
  try {
    if (fs.existsSync(absQrPath)) {
      fs.unlinkSync(absQrPath);
    }
  } catch (e) {}

  console.log('[SkyOne] Đã đăng xuất và xóa toàn bộ session cookies.');
  return true;
}

// Gửi tin nhắn đến nhóm (hỗ trợ tag mentions)
async function sendSkyOneMessage(groupId, message, mentions = []) {
  if (!activeApi) {
    // Thử kết nối lại bằng cookies đã có
    await initZaloBot();
    if (!activeApi) {
      throw new Error('Bot Zalo chưa được đăng nhập hoặc không hoạt động!');
    }
  }

  try {
    const payload = { msg: message };
    if (Array.isArray(mentions) && mentions.length > 0) {
      payload.mentions = mentions;
    }
    // 1 chính là ThreadTypeGroup trong ZCA SDK
    const res = await activeApi.sendMessage(payload, String(groupId), 1);
    console.log('[SkyOne] Đã gửi thông báo nhóm thành công!');
    return res;
  } catch (err) {
    console.error('[SkyOne] Gửi tin nhắn nhóm thất bại:', err.message);
    throw err;
  }
}

// Gửi tin nhắn inbox cá nhân riêng tư
async function sendSkyOnePrivateMessage(zaloUid, message) {
  if (!activeApi) {
    await initZaloBot();
    if (!activeApi) {
      throw new Error('Bot Zalo chưa được đăng nhập hoặc không hoạt động!');
    }
  }

  try {
    // 0 chính là ThreadType.User trong ZCA SDK
    const res = await activeApi.sendMessage({ msg: message }, String(zaloUid), 0);
    console.log(`[SkyOne] Đã gửi inbox riêng thành công tới UID ${zaloUid}!`);
    return res;
  } catch (err) {
    console.error(`[SkyOne] Gửi inbox riêng thất bại tới UID ${zaloUid}:`, err.message);
    throw err;
  }
}

// Trạng thái bot hiện tại
function getBotState() {
  return {
    ...qrState,
    botName: activeApi ? (activeApi.displayName || 'SkyOne') : null,
    isLoggedIn: !!activeApi
  };
}

module.exports = {
  initZaloBot,
  startQRLogin,
  getBotGroups,
  logoutBot,
  sendSkyOneMessage,
  sendSkyOnePrivateMessage,
  getBotState
};
