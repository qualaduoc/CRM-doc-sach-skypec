window.onerror = function (message, source, lineno, colno, error) {
  const errMsg = `[Window Error] Message: ${message}\nURL: ${source}\nLine: ${lineno}:${colno}\nStack: ${error ? error.stack : 'N/A'}`;
  console.error(errMsg);
  // Banner không chặn UI (tránh alert treo trang trắng)
  try { showGlobalErrorBanner(errMsg); } catch (e) {}
  return false;
};

window.onunhandledrejection = function (event) {
  const errMsg = `[Unhandled Promise Rejection] Reason: ${event.reason ? (event.reason.stack || event.reason) : 'N/A'}`;
  console.error(errMsg);
  try { showGlobalErrorBanner(errMsg); } catch (e) {}
};

function showGlobalErrorBanner(msg) {
  if (!document.body) return;
  let errDiv = document.getElementById('global-error-reporter');
  if (!errDiv) {
    errDiv = document.createElement('div');
    errDiv.id = 'global-error-reporter';
    errDiv.style.position = 'fixed';
    errDiv.style.top = '10px';
    errDiv.style.left = '10px';
    errDiv.style.right = '10px';
    errDiv.style.zIndex = '999999';
    errDiv.style.background = '#f87171';
    errDiv.style.color = '#7f1d1d';
    errDiv.style.padding = '15px';
    errDiv.style.borderRadius = '8px';
    errDiv.style.border = '2px solid #b91c1c';
    errDiv.style.fontFamily = 'monospace';
    errDiv.style.fontSize = '12px';
    errDiv.style.whiteSpace = 'pre-wrap';
    errDiv.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Đóng [X]';
    closeBtn.style.float = 'right';
    closeBtn.style.background = '#7f1d1d';
    closeBtn.style.color = '#f87171';
    closeBtn.style.border = 'none';
    closeBtn.style.padding = '3px 8px';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontWeight = 'bold';
    closeBtn.onclick = function() {
      errDiv.remove();
    };
    errDiv.appendChild(closeBtn);
    
    const textSpan = document.createElement('span');
    textSpan.id = 'global-error-text';
    errDiv.appendChild(textSpan);
    
    document.body.appendChild(errDiv);
  }
  const textEl = document.getElementById('global-error-text');
  if (textEl) textEl.textContent = msg;
}

function safeParseJSON(raw, fallback) {
  try {
    if (raw == null || raw === '' || raw === 'undefined' || raw === 'null') return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[safeParseJSON] Invalid JSON in localStorage, using fallback.', e.message);
    return fallback;
  }
}

const state = {
  token: localStorage.getItem('crm_token'),
  role: localStorage.getItem('crm_role'),
  username: localStorage.getItem('crm_username'),
  displayName: localStorage.getItem('crm_display_name'),
  department: localStorage.getItem('crm_department'),
  permissions: safeParseJSON(localStorage.getItem('crm_permissions'), {}),
  selectedUser: null,
  zaloMembers: [],
  zaloMappings: []
};

// Tải danh sách thành viên nhóm Zalo và các mapping tên nhân viên trực ca
async function loadZaloMembersAndMappings() {
  if (!state.token) return;
  try {
    const [resMembers, resMappings] = await Promise.all([
      fetch('/api/fms/zalo/group-members', { headers: { 'Authorization': `Bearer ${state.token}` } }),
      fetch('/api/fms/zalo/mappings', { headers: { 'Authorization': `Bearer ${state.token}` } })
    ]);

    const dataMembers = await resMembers.json();
    const dataMappings = await resMappings.json();

    if (dataMembers.success) {
      state.zaloMembers = dataMembers.members || [];
    }
    if (dataMappings.success) {
      state.zaloMappings = dataMappings.mappings || [];
    }
  } catch (err) {
    console.error('[Zalo Load Error]', err.message);
  }
}

let dashboardInterval = null;

// --- THEME SÁNG / TỐI (luxury aviation) ---
const THEME_STORAGE_KEY = 'skyeyes_theme';

function getPreferredTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch (e) {}
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

function applyTheme(theme, persist) {
  const next = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  const meta = document.getElementById('meta-theme-color');
  if (meta) meta.setAttribute('content', next === 'dark' ? '#080d16' : '#007297');
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
    btn.title = next === 'dark' ? 'Đang dùng giao diện Tối — bấm để chuyển Sáng' : 'Đang dùng giao diện Sáng — bấm để chuyển Tối';
  });
  if (persist !== false) {
    try { localStorage.setItem(THEME_STORAGE_KEY, next); } catch (e) {}
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || getPreferredTheme();
  applyTheme(current === 'dark' ? 'light' : 'dark', true);
}

function bindThemeToggles() {
  ['btn-theme-toggle-login', 'btn-theme-toggle-admin', 'btn-theme-toggle-user'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.themeBound) {
      el.dataset.themeBound = '1';
      el.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
      });
    }
  });
}

// Áp dụng theme ngay khi parse file (phòng script head chưa chạy / localStorage đổi)
applyTheme(getPreferredTheme(), false);

// --- KHỞI CHẠY KHI ĐÃ TẢI XONG TRANG ---
document.addEventListener('DOMContentLoaded', () => {
  try {
    applyTheme(getPreferredTheme(), false);
    bindThemeToggles();
  } catch (err) {
    console.error('[Theme]', err);
  }
  try {
    setupEventListeners();
  } catch (err) {
    console.error('[setupEventListeners] Lỗi gắn sự kiện (app vẫn chạy):', err);
  }
  try {
    initApp();
  } catch (err) {
    console.error('[initApp] Lỗi khởi tạo:', err);
    forceLogoutToLogin(err.message);
  }
  try {
    initSpaceBackground();
  } catch (err) {
    console.error('[initSpaceBackground]', err);
  }
});

function getUserRole() {
  if (state.role === 'admin' || state.permissions?.perm_admin === 1) return 'admin';
  if (state.permissions?.perm_fms === 1) return 'dieu_hanh';
  if (state.permissions?.perm_gemini === 1) return 'nv_c1';
  return 'nv_c2';
}

// Xóa phiên đăng nhập hỏng / hết hạn và đưa về màn hình login (không confirm)
function forceLogoutToLogin(reason) {
  console.warn('[Auth] Force logout:', reason || 'unknown');
  const rememberedUser = localStorage.getItem('crm_remembered_user');
  const rememberedPass = localStorage.getItem('crm_remembered_pass');
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_role');
  localStorage.removeItem('crm_username');
  localStorage.removeItem('crm_display_name');
  localStorage.removeItem('crm_department');
  localStorage.removeItem('crm_permissions');
  // Giữ "ghi nhớ đăng nhập" nếu có
  if (rememberedUser) localStorage.setItem('crm_remembered_user', rememberedUser);
  if (rememberedPass) localStorage.setItem('crm_remembered_pass', rememberedPass);

  state.token = null;
  state.role = null;
  state.username = null;
  state.displayName = null;
  state.department = null;
  state.permissions = {};
  state.selectedUser = null;
  stopDashboardPolling();
  showScreen('login-screen');

  if (rememberedUser && rememberedPass) {
    const usernameEl = document.getElementById('username');
    const passwordEl = document.getElementById('password');
    const rememberMeEl = document.getElementById('remember-me');
    if (usernameEl) usernameEl.value = rememberedUser;
    if (passwordEl) passwordEl.value = rememberedPass;
    if (rememberMeEl) rememberMeEl.checked = true;
  }
}

// Đồng bộ thông tin phân quyền mới nhất của chính mình từ server
async function syncUserPermissions() {
  if (!state.token) return false;
  try {
    const res = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    // Token hết hạn / không hợp lệ → quay về login thay vì màn hình trắng
    if (res.status === 401 || res.status === 403) {
      forceLogoutToLogin(`API /api/me HTTP ${res.status}`);
      return false;
    }
    const data = await res.json();
    if (data.success && data.user) {
      const oldRole = getUserRole();
      
      // Cập nhật state và localStorage
      state.permissions = data.user.permissions || {};
      if (data.user.display_name) {
        state.displayName = data.user.display_name;
        localStorage.setItem('crm_display_name', data.user.display_name);
      }
      if (data.user.department) {
        state.department = data.user.department;
        localStorage.setItem('crm_department', data.user.department);
      }
      localStorage.setItem('crm_permissions', JSON.stringify(state.permissions));
      
      const newRole = getUserRole();
      
      // Nếu vai trò bị thay đổi thì cập nhật ngay UI
      if (oldRole !== newRole) {
        console.log(`[Permission Sync] Phát hiện thay đổi vai trò từ ${oldRole} sang ${newRole}. Cập nhật lại UI...`);
        if (newRole === 'admin' || newRole === 'dieu_hanh') {
          showScreen('admin-screen');
          applyPermissionsUI();
          loadAdminDashboard();
        } else {
          showScreen('user-screen');
          applyUserPermissionsUI();
          loadUserDashboard();
        }
      }
      return true;
    }
    if (data && data.success === false) {
      forceLogoutToLogin(data.error || 'Phiên đăng nhập không hợp lệ');
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Permission Sync Error]', err.message);
    return true; // Lỗi mạng: giữ session, không đá logout
  }
}

function initApp() {
  try {
    if (state.token) {
      // Luôn đồng bộ lấy quyền mới nhất khi khởi động hoặc F5 tải lại trang
      syncUserPermissions().then((ok) => {
        if (ok === false || !state.token) return; // đã force logout
        try {
          const userRole = getUserRole();
          if (userRole === 'admin' || userRole === 'dieu_hanh') {
            showScreen('admin-screen');
            applyPermissionsUI();
            loadAdminDashboard();
          } else {
            showScreen('user-screen');
            applyUserPermissionsUI();
            loadUserDashboard();
          }
        } catch (e) {
          console.error('[Init App Permission Then Error]', e);
          forceLogoutToLogin(e.message);
        }
      }).catch(err => {
        console.error('[Sync Permissions Promise Error]', err);
        // Không chặn UI: vẫn cố hiển thị dashboard theo token local
        try {
          const userRole = getUserRole();
          if (userRole === 'admin' || userRole === 'dieu_hanh') {
            showScreen('admin-screen');
            applyPermissionsUI();
            loadAdminDashboard();
          } else {
            showScreen('user-screen');
            applyUserPermissionsUI();
            loadUserDashboard();
          }
        } catch (e2) {
          forceLogoutToLogin(e2.message);
        }
      });
      startDashboardPolling();
    } else {
      showScreen('login-screen');
      stopDashboardPolling();
      
      // Tự động điền tài khoản đã ghi nhớ
      const rememberedUser = localStorage.getItem('crm_remembered_user');
      const rememberedPass = localStorage.getItem('crm_remembered_pass');
      if (rememberedUser && rememberedPass) {
        const usernameEl = document.getElementById('username');
        const passwordEl = document.getElementById('password');
        const rememberMeEl = document.getElementById('remember-me');
        if (usernameEl) usernameEl.value = rememberedUser;
        if (passwordEl) passwordEl.value = rememberedPass;
        if (rememberMeEl) rememberMeEl.checked = true;
      }
    }
  } catch (err) {
    console.error('[Init App Error]', err);
    forceLogoutToLogin(err.message);
  }
}

// Áp dụng ẩn/hiện giao diện theo phân quyền của người dùng đăng nhập
function applyPermissionsUI() {
  const accountsTabBtn = document.querySelector('[data-tab="tab-accounts"]');
  const fmsTabBtn = document.getElementById('tab-btn-fms');
  const geminiCard = document.getElementById('card-gemini-settings');
  const zaloCard = document.getElementById('card-zalo-settings');
  
  const userRole = getUserRole();

  if (userRole === 'admin') {
    if (accountsTabBtn) accountsTabBtn.style.display = 'block';
    if (fmsTabBtn) fmsTabBtn.style.display = 'block';
    if (geminiCard) geminiCard.style.display = 'none'; // OCR/Gemini đã gỡ
    if (zaloCard) zaloCard.style.display = 'flex';
    
    // Mặc định hiển thị tab-accounts cho Admin
    const tabAccounts = document.getElementById('tab-accounts');
    const tabFms = document.getElementById('tab-fms');
    if (tabAccounts) tabAccounts.style.display = 'block';
    if (tabFms) tabFms.style.display = 'none';
    
    // Reset active button tab
    if (accountsTabBtn) {
      accountsTabBtn.classList.add('active');
      accountsTabBtn.style.color = 'var(--primary)';
      accountsTabBtn.style.borderBottom = '2px solid var(--primary)';
    }
    if (fmsTabBtn) {
      fmsTabBtn.classList.remove('active');
      fmsTabBtn.style.color = 'var(--text-muted)';
      fmsTabBtn.style.borderBottom = '2px solid transparent';
    }
    return;
  }

  if (userRole === 'dieu_hanh') {
    // Ẩn tab quản lý tài khoản
    if (accountsTabBtn) accountsTabBtn.style.display = 'none';
    if (fmsTabBtn) fmsTabBtn.style.display = 'block';
    
    // Ẩn card Gemini API keys, hiện card Zalo
    if (geminiCard) geminiCard.style.display = 'none';
    if (zaloCard) zaloCard.style.display = 'flex';
    
    // Mặc định kích hoạt và hiển thị tab-fms cho Điều hành
    const tabAccounts = document.getElementById('tab-accounts');
    const tabFms = document.getElementById('tab-fms');
    if (tabAccounts) tabAccounts.style.display = 'none';
    if (tabFms) tabFms.style.display = 'grid';
    
    if (fmsTabBtn) {
      fmsTabBtn.classList.add('active');
      fmsTabBtn.style.color = 'var(--primary)';
      fmsTabBtn.style.borderBottom = '2px solid var(--primary)';
    }
    
    // Load dữ liệu FMS & Zalo cho Điều hành
    loadFmsSchedules();
    loadSkyEyesSettings();
    startSkyEyesPolling();
    return;
  }
}

// Áp dụng ẩn hiện trên màn hình User (Nhân viên C1, C2 hoặc Admin/Điều hành xem hộ)
function applyUserPermissionsUI() {
  const userRole = getUserRole();
  const tabNavbar = document.getElementById('user-tab-navbar');
  const elearningSec = document.getElementById('user-elearning-section');
  const fmsSec = document.getElementById('user-fms-section');
  
  const fmsTabBtn = document.querySelector('[data-user-tab="tab-user-fms"]');
  const elearningTabBtn = document.getElementById('user-tab-btn-elearning');

  // Nếu là Admin/Điều hành đang xem hộ (impersonate), hoặc là Nhân viên C1
  if (state.selectedUser || userRole === 'nv_c1') {
    // Hiện Navbar chuyển đổi tab
    if (tabNavbar) tabNavbar.style.setProperty('display', 'flex', 'important');
    if (elearningTabBtn) elearningTabBtn.style.setProperty('display', 'flex', 'important');

    // Chỉ reset tab FMS mặc định nếu không phải Admin đang xem hộ
    if (!state.selectedUser) {
      if (fmsTabBtn) {
        fmsTabBtn.classList.add('active');
        fmsTabBtn.style.color = 'var(--primary)';
        fmsTabBtn.style.borderBottom = '2px solid var(--primary)';
      }
      if (elearningTabBtn) {
        elearningTabBtn.classList.remove('active');
        elearningTabBtn.style.color = 'var(--text-muted)';
        elearningTabBtn.style.borderBottom = '2px solid transparent';
      }
      if (fmsSec) fmsSec.style.setProperty('display', 'flex', 'important');
      if (elearningSec) elearningSec.style.setProperty('display', 'none', 'important');
    }
  } else {
    // Nhân viên C2: Ẩn hoàn toàn Navbar và phần Elearning, chỉ hiển thị FMS
    if (tabNavbar) tabNavbar.style.setProperty('display', 'none', 'important');
    if (fmsSec) fmsSec.style.setProperty('display', 'flex', 'important');
    if (elearningSec) elearningSec.style.setProperty('display', 'none', 'important');
  }
  
  // Luôn load dữ liệu FMS cho User
  loadUserFmsSchedules();
}

// Hiệu ứng nền vũ trụ động lấp lánh (Twinkling space background) cho màn hình đăng nhập
function initSpaceBackground() {
  const canvas = document.getElementById('space-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  let width = canvas.width = window.innerWidth;
  let height = canvas.height = window.innerHeight;
  
  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });
  
  const numStars = 120;
  const stars = [];
  
  for (let i = 0; i < numStars; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.2 + 0.4,
      vx: (Math.random() - 0.5) * 0.15,
      vy: (Math.random() - 0.5) * 0.15,
      alpha: Math.random() * 0.8 + 0.2,
      alphaSpeed: Math.random() * 0.015 + 0.005
    });
  }
  
  function animate() {
    // Vẽ nền không gian sâu thẳm
    const gradient = ctx.createRadialGradient(width / 2, height / 2, 10, width / 2, height / 2, Math.max(width, height) * 0.8);
    gradient.addColorStop(0, '#0c1020');
    gradient.addColorStop(0.5, '#070a14');
    gradient.addColorStop(1, '#020408');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    
    // Vẽ các vì sao trôi nổi
    for (let i = 0; i < numStars; i++) {
      const s = stars[i];
      
      // Cập nhật vị trí trôi
      s.x += s.vx;
      s.y += s.vy;
      
      // Độ sáng lấp lánh
      s.alpha += s.alphaSpeed;
      if (s.alpha > 1 || s.alpha < 0.2) {
        s.alphaSpeed = -s.alphaSpeed;
      }
      
      // Tràn viền màn hình thì quay lại ở phía đối diện
      if (s.x < 0) s.x = width;
      if (s.x > width) s.x = 0;
      if (s.y < 0) s.y = height;
      if (s.y > height) s.y = 0;
      
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
      ctx.fill();
    }
    
    requestAnimationFrame(animate);
  }
  
  animate();
}

function startDashboardPolling() {
  if (dashboardInterval) clearInterval(dashboardInterval);
  dashboardInterval = setInterval(() => {
    // Tự động kiểm tra đồng bộ phân quyền động từ server
    syncUserPermissions();

    const activeScreen = document.querySelector('.screen.active');
    if (activeScreen && activeScreen.id === 'user-screen') {
      const userRole = getUserRole();
      if (userRole === 'nv_c1') {
        loadUserDashboard(state.selectedUser ? state.selectedUser.username : null, true);
      }
      loadUserFmsSchedules(true);
    } else if (activeScreen && activeScreen.id === 'admin-screen') {
      loadAdminDashboard(true);
      
      const activeTabBtn = document.querySelector('.admin-tab-btn.active');
      if (activeTabBtn && activeTabBtn.getAttribute('data-tab') === 'tab-fms') {
        loadFmsSchedules(true);
      }
    }
  }, 10000); // 10 giây một lần
}

function stopDashboardPolling() {
  if (dashboardInterval) {
    clearInterval(dashboardInterval);
    dashboardInterval = null;
  }
}

// Chuyển đổi giữa các màn hình (an toàn khi thiếu node)
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(screenId);
  if (el) {
    el.classList.add('active');
  } else {
    console.error('[showScreen] Không tìm thấy màn hình:', screenId);
    const login = document.getElementById('login-screen');
    if (login) login.classList.add('active');
  }
}

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
  else console.warn('[bindClick] Missing element #' + id);
}

function bindChange(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('change', handler);
  else console.warn('[bindChange] Missing element #' + id);
}

// Cài đặt các sự kiện lắng nghe
function setupEventListeners() {
  // Đăng nhập
  const loginForm = document.getElementById('login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLogin);

  // Đăng xuất
  bindClick('btn-admin-logout', handleLogout);
  bindClick('btn-user-logout', handleLogout);

  // Lưu cấu hình Admin
  bindClick('btn-save-settings', saveSystemSettings);

  // Modal Thêm Tài Khoản (Admin)
  const modal = document.getElementById('add-account-modal');
  document.getElementById('btn-add-account').addEventListener('click', () => {
    modal.classList.add('active');
    document.getElementById('add-error').classList.add('hidden');
    document.getElementById('add-account-form').reset();
  });
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    modal.classList.remove('active');
  });

  // Xử lý form thêm tài khoản
  document.getElementById('add-account-form').addEventListener('submit', handleAddAccount);

  // Modal Đổi mật khẩu Admin
  const passModal = document.getElementById('change-password-modal');
  document.getElementById('btn-admin-change-pass').addEventListener('click', () => {
    passModal.classList.add('active');
    document.getElementById('change-pass-error').classList.add('hidden');
    document.getElementById('change-password-form').reset();
  });
  document.getElementById('btn-close-pass-modal').addEventListener('click', () => {
    passModal.classList.remove('active');
  });
  document.getElementById('change-password-form').addEventListener('submit', handleChangePassword);

  // Nút điều khiển hàng loạt của Admin
  document.getElementById('btn-start-all').addEventListener('click', () => triggerBulkControl('start-all'));
  document.getElementById('btn-stop-all').addEventListener('click', () => triggerBulkControl('stop-all'));

  // Đồng bộ tiến độ
  document.getElementById('btn-sync-progress').addEventListener('click', () => {
    const userToSync = state.selectedUser ? state.selectedUser.username : state.username;
    triggerSyncProgress(userToSync);
  });

  // Modal Khám phá lớp học mới
  const exploreModal = document.getElementById('explore-classes-modal');
  document.getElementById('btn-explore-classes').addEventListener('click', () => {
    exploreModal.classList.add('active');
    exploreState.keyword = '';
    document.getElementById('explore-search-input').value = '';
    exploreState.page = 1;
    loadExploreClasses();
  });
  document.getElementById('btn-close-explore-modal').addEventListener('click', () => {
    exploreModal.classList.remove('active');
  });

  // Chuyển đổi danh mục khám phá
  document.querySelectorAll('.category-item').forEach(item => {
    item.addEventListener('click', (e) => {
      document.querySelectorAll('.category-item').forEach(i => i.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      exploreState.activeCategory = target.getAttribute('data-cate');
      exploreState.page = 1;
      loadExploreClasses();
    });
  });

  // Tìm kiếm lớp khám phá
  document.getElementById('btn-explore-search').addEventListener('click', () => {
    exploreState.keyword = document.getElementById('explore-search-input').value.trim();
    exploreState.page = 1;
    loadExploreClasses();
  });
  document.getElementById('explore-search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      exploreState.keyword = document.getElementById('explore-search-input').value.trim();
      exploreState.page = 1;
      loadExploreClasses();
    }
  });

  // Phân trang khám phá
  document.getElementById('btn-explore-prev').addEventListener('click', () => {
    if (exploreState.page > 1) {
      exploreState.page--;
      loadExploreClasses();
    }
  });
  document.getElementById('btn-explore-next').addEventListener('click', () => {
    if (exploreState.page < exploreState.totalPages) {
      exploreState.page++;
      loadExploreClasses();
    }
  });

  // Lắng nghe sự kiện chuyển đổi tab ở màn hình User (nhân viên)
  document.querySelectorAll('.user-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.user-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.color = 'var(--text-muted)';
        b.style.borderBottom = '2px solid transparent';
      });
      
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      targetBtn.style.color = 'var(--primary)';
      targetBtn.style.borderBottom = '2px solid var(--primary)';
      
      const tabId = targetBtn.getAttribute('data-user-tab');
      const elearningSec = document.getElementById('user-elearning-section');
      const fmsSec = document.getElementById('user-fms-section');
      
      if (tabId === 'tab-user-fms') {
        if (fmsSec) fmsSec.style.setProperty('display', 'flex', 'important');
        if (elearningSec) elearningSec.style.setProperty('display', 'none', 'important');
        loadUserFmsSchedules();
      } else {
        if (fmsSec) fmsSec.style.setProperty('display', 'none', 'important');
        if (elearningSec) elearningSec.style.setProperty('display', 'flex', 'important');
        loadUserDashboard(state.selectedUser?.username);
      }
    });
  });

  // --- SỰ KIỆN TAB ADMIN & QUẢN LÝ FMS ---
  document.querySelectorAll('.admin-tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.admin-tab-btn').forEach(b => {
        b.classList.remove('active');
        b.style.color = 'var(--text-muted)';
        b.style.borderBottom = '2px solid transparent';
      });
      
      const targetBtn = e.currentTarget;
      targetBtn.classList.add('active');
      targetBtn.style.color = 'var(--primary)';
      targetBtn.style.borderBottom = '2px solid var(--primary)';

      const tabId = targetBtn.getAttribute('data-tab');
      document.querySelectorAll('.admin-tab-content').forEach(content => {
        content.style.display = 'none';
      });
      document.getElementById(tabId).style.display = tabId === 'tab-fms-schedule-admin' ? 'grid' : 'block';

      if (['tab-fms', 'tab-temp-import-export', 'tab-fms-schedule-admin', 'tab-settings'].includes(tabId)) {
        if (tabId === 'tab-fms' || tabId === 'tab-fms-schedule-admin') {
          loadFmsSchedules();
        }
        if (tabId === 'tab-temp-import-export') {
          fetchTempImportExportData();
          fetchAirlineAlerts();
        }
        loadGeminiKeys();
        startSkyEyesPolling();
        loadSkyEyesSettings();
      } else {
        stopSkyEyesPolling();
      }

      if (tabId === 'tab-fms-stats') {
        loadAdminFmsStats();
      }
    });
  });

  // Lưu lịch trực FMS
  document.getElementById('btn-fms-save-schedule').addEventListener('click', handleSaveFmsSchedule);

  // Quét FMS ngay lập tức
  document.getElementById('btn-fms-sync-now').addEventListener('click', handleSyncFmsNow);

  // Sự kiện chạy test giả lập Tạm nhập - Tái xuất
  const testBtn = document.getElementById('btn-fms-test-import-export');
  const testPanel = document.getElementById('fms-test-scenarios-panel');
  const closePanelBtn = document.getElementById('btn-close-test-panel');

  if (testBtn && testPanel) {
    testBtn.addEventListener('click', () => {
      const isHidden = testPanel.style.display === 'none';
      testPanel.style.display = isHidden ? 'flex' : 'none';
    });
  }
  if (closePanelBtn && testPanel) {
    closePanelBtn.addEventListener('click', () => {
      testPanel.style.display = 'none';
    });
  }

  // Cảnh báo sai tên hãng HK
  const btnAirlineRefresh = document.getElementById('btn-airline-alert-refresh');
  if (btnAirlineRefresh) btnAirlineRefresh.addEventListener('click', () => fetchAirlineAlerts());
  const btnAirlineTestToggle = document.getElementById('btn-airline-alert-test-toggle');
  const airlineTestPanel = document.getElementById('airline-test-panel');
  if (btnAirlineTestToggle && airlineTestPanel) {
    btnAirlineTestToggle.addEventListener('click', () => {
      airlineTestPanel.style.display = airlineTestPanel.style.display === 'none' ? 'flex' : 'none';
    });
  }
  document.querySelectorAll('.btn-airline-test').forEach(btn => {
    btn.addEventListener('click', () => runAirlineAlertTest(parseInt(btn.getAttribute('data-scenario'), 10) || 1));
  });

  // Dropdown nhóm cảnh báo hãng
  const airlineDisplay = document.getElementById('skyeyes-airline-groups-display');
  if (airlineDisplay) {
    airlineDisplay.addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = document.getElementById('skyeyes-airline-groups-dropdown');
      if (dd) dd.style.display = dd.style.display === 'flex' ? 'none' : 'flex';
    });
  }
  document.addEventListener('click', (e) => {
    const dd = document.getElementById('skyeyes-airline-groups-dropdown');
    const disp = document.getElementById('skyeyes-airline-groups-display');
    if (dd && disp && !dd.contains(e.target) && !disp.contains(e.target)) dd.style.display = 'none';
  });
  const airlineSearch = document.getElementById('skyeyes-airline-group-search');
  if (airlineSearch) {
    airlineSearch.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll('#skyeyes-airline-groups-list label').forEach(item => {
        item.style.display = item.textContent.toLowerCase().includes(q) ? 'flex' : 'none';
      });
    });
  }

  // Xuất lịch trực ra file Excel mẫu chuẩn
  document.getElementById('btn-fms-export-excel').addEventListener('click', exportFmsScheduleToExcel);

  // Trigger chọn file Excel FMS
  document.getElementById('btn-fms-upload-excel').addEventListener('click', () => {
    document.getElementById('fms-file-input').value = ''; // Reset file input
    document.getElementById('fms-file-input').click();
  });

  // Đọc file Excel FMS
  document.getElementById('fms-file-input').addEventListener('change', handleExcelFileSelect);

  // OCR / Gemini đã gỡ hoàn toàn

  // Đồng bộ lịch từ Skypec Flights
  const btnFlightsPreview = document.getElementById('btn-fms-flights-preview');
  if (btnFlightsPreview) btnFlightsPreview.addEventListener('click', () => handleFlightsScheduleSync('preview'));
  const btnFlightsApply = document.getElementById('btn-fms-flights-apply');
  if (btnFlightsApply) btnFlightsApply.addEventListener('click', () => handleFlightsScheduleSync('apply'));

  // Toggle đơn vị Skypec | NAFC (admin) — tách lịch riêng, mặc định Skypec
  document.querySelectorAll('.fms-unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setFmsUnitFilter(btn.getAttribute('data-unit') || 'SKYPEC', 'admin');
      loadFmsSchedules(false);
    });
  });

  // Sự kiện thay đổi ngày lọc lịch bay FMS
  const fmsFilterDateEl = document.getElementById('fms-filter-date');
  if (fmsFilterDateEl) {
    fmsFilterDateEl.addEventListener('change', () => {
      try { sessionStorage.setItem(FMS_SHIFT_STORAGE.dateManual('admin'), '1'); } catch (e) { /* ignore */ }
      loadFmsSchedules(false);
    });
  }

  // Select ca xem bảng (admin) — auto / day / evening / all
  const fmsViewShiftEl = document.getElementById('fms-view-shift');
  if (fmsViewShiftEl) {
    fmsViewShiftEl.addEventListener('change', () => {
      fmsViewShiftEl.dataset.userTouched = '1';
      try {
        sessionStorage.setItem(FMS_SHIFT_STORAGE.view('admin'), fmsViewShiftEl.value);
        if (fmsViewShiftEl.value === 'auto') {
          sessionStorage.removeItem(FMS_SHIFT_STORAGE.dateManual('admin'));
          applySmartFmsDefaults('admin');
          loadFmsSchedules(false);
          return;
        }
      } catch (e) { /* ignore */ }
      renderFmsTable();
    });
  }

  // Sự kiện thay đổi ngày trực ca FMS (cột bên trái - Nhập lịch trực)
  const fmsScheduleDateEl = document.getElementById('fms-schedule-date');
  if (fmsScheduleDateEl) {
    fmsScheduleDateEl.addEventListener('change', (e) => {
      const val = e.target.value;
      const filterInput = document.getElementById('fms-filter-date');
      if (filterInput) filterInput.value = val;
      try { sessionStorage.setItem(FMS_SHIFT_STORAGE.dateManual('admin'), '1'); } catch (err) { /* ignore */ }
      loadFmsSchedules(false);
    });
  }

  // Sự kiện cho bảng FMS ở màn hình nhân viên (chỉ xem)
  const userFmsDate = document.getElementById('user-fms-filter-date');
  if (userFmsDate) {
    userFmsDate.addEventListener('change', () => {
      try { sessionStorage.setItem(FMS_SHIFT_STORAGE.dateManual('user'), '1'); } catch (e) { /* ignore */ }
      loadUserFmsSchedules(false);
    });
  }
  const userFmsViewShift = document.getElementById('user-fms-view-shift');
  if (userFmsViewShift) {
    userFmsViewShift.addEventListener('change', () => {
      userFmsViewShift.dataset.userTouched = '1';
      try {
        sessionStorage.setItem(FMS_SHIFT_STORAGE.view('user'), userFmsViewShift.value);
        if (userFmsViewShift.value === 'auto') {
          sessionStorage.removeItem(FMS_SHIFT_STORAGE.dateManual('user'));
          applySmartFmsDefaults('user');
          loadUserFmsSchedules(false);
          return;
        }
      } catch (e) { /* ignore */ }
      renderUserFmsTable();
    });
  }
  const userFmsSearch = document.getElementById('user-fms-search-input');
  if (userFmsSearch) {
    userFmsSearch.addEventListener('input', () => renderUserFmsTable());
  }
  const userFmsCrewFilter = document.getElementById('user-fms-crew-filter');
  if (userFmsCrewFilter) {
    userFmsCrewFilter.addEventListener('change', () => renderUserFmsTable());
  }

  // Toggle xổ/gập ngoài ca (admin + user) — event delegation
  if (!document.body.dataset.fmsOutShiftBound) {
    document.body.dataset.fmsOutShiftBound = '1';
    document.body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-fms-out-toggle]');
      if (!row) return;
      const scope = row.getAttribute('data-fms-out-toggle') || 'admin';
      const next = !isOutShiftExpanded(scope);
      setOutShiftExpanded(scope, next);
      if (scope === 'user') renderUserFmsTable();
      else renderFmsTable();
    });
  }
  document.querySelectorAll('.user-fms-unit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setFmsUnitFilter(btn.getAttribute('data-unit') || 'SKYPEC', 'user');
      loadUserFmsSchedules(false);
    });
  });
  // Đảm bảo mặc định Skypec khi load
  setFmsUnitFilter('SKYPEC', 'admin');
  setFmsUnitFilter('SKYPEC', 'user');

  // Đóng Modal Preview FMS
  document.getElementById('btn-close-fms-preview-modal').addEventListener('click', () => {
    document.getElementById('fms-preview-modal').classList.remove('active');
  });
  document.getElementById('btn-fms-cancel-preview').addEventListener('click', () => {
    document.getElementById('fms-preview-modal').classList.remove('active');
  });

  // Xác nhận lưu lịch trực FMS từ preview
  document.getElementById('btn-fms-confirm-preview').addEventListener('click', handleConfirmFmsPreview);

  // Sự kiện thay đổi ca trực trên Modal Preview
  const previewShiftSelect = document.getElementById('fms-preview-shift-input');
  if (previewShiftSelect) {
    previewShiftSelect.addEventListener('change', (e) => {
      if (!state.fmsRawParsedFlights || state.fmsRawParsedFlights.length === 0) return;
      const newShift = e.target.value;
      const filtered = filterFlightsByShift(state.fmsRawParsedFlights, newShift);
      state.fmsPreviewFlights = filtered;
      renderFmsPreviewContent(filtered, false); // false để giữ nguyên ngày/ca đã chọn trên modal
    });
  }

  // --- SỰ KIỆN TRỢ LÝ ZALO SKYEYES ---
  document.getElementById('btn-skyeyes-connect').addEventListener('click', handleSkyEyesConnect);
  const btnLogout = document.getElementById('btn-skyeyes-logout');
  if (btnLogout) btnLogout.addEventListener('click', handleSkyEyesLogout);
  
  // Các Nút test kịch bản giả lập
  const btnTestNewFuel = document.getElementById('btn-test-zalo-new-fuel');
  if (btnTestNewFuel) btnTestNewFuel.addEventListener('click', () => runZaloTestScenario('new-fuel'));
  
  const btnTestUpdateFuel = document.getElementById('btn-test-zalo-update-fuel');
  if (btnTestUpdateFuel) btnTestUpdateFuel.addEventListener('click', () => runZaloTestScenario('update-fuel'));
  
  const btnTestChangeAc = document.getElementById('btn-test-zalo-change-ac');
  if (btnTestChangeAc) btnTestChangeAc.addEventListener('click', () => runZaloTestScenario('change-ac'));
  
  const btnTestChangeGate = document.getElementById('btn-test-zalo-change-gate');
  if (btnTestChangeGate) btnTestChangeGate.addEventListener('click', () => runZaloTestScenario('change-gate'));
  
  const btnTestChangeEtd = document.getElementById('btn-test-zalo-change-etd');
  if (btnTestChangeEtd) btnTestChangeEtd.addEventListener('click', () => runZaloTestScenario('change-etd'));

  const btnTestRemindSchedule = document.getElementById('btn-test-zalo-remind-schedule');
  if (btnTestRemindSchedule) btnTestRemindSchedule.addEventListener('click', () => runZaloTestScenario('remind-schedule'));
  
  // Sự kiện mở/đóng và tương tác trên Modal Quản Lý Zalo Mappings
  const btnManageMappings = document.getElementById('btn-skyeyes-manage-mappings');
  if (btnManageMappings) {
    btnManageMappings.addEventListener('click', openZaloMappingsModal);
  }
  const btnCloseMappingsModal = document.getElementById('btn-close-zalo-mappings-modal');
  if (btnCloseMappingsModal) {
    btnCloseMappingsModal.addEventListener('click', () => {
      document.getElementById('zalo-mappings-modal').classList.remove('active');
    });
  }
  const searchMappingInput = document.getElementById('search-zalo-mapping');
  if (searchMappingInput) {
    searchMappingInput.addEventListener('input', renderZaloMappingsListTable);
  }
  const searchMemberInput = document.getElementById('search-zalo-member');
  if (searchMemberInput) {
    searchMemberInput.addEventListener('input', renderZaloGroupMembersTable);
  }
  const btnRefreshMembers = document.getElementById('btn-refresh-zalo-members');
  if (btnRefreshMembers) {
    btnRefreshMembers.addEventListener('click', loadZaloGroupMembers);
  }
  const btnSaveSingleMapping = document.getElementById('btn-save-single-mapping');
  if (btnSaveSingleMapping) {
    btnSaveSingleMapping.addEventListener('click', handleSaveSingleMapping);
  }
  
  // Khởi tạo sự kiện cho dropdown chọn tên mapping
  initMappingScheduleNameSelectEvent();
  // Toggle Custom Dropdown chọn nhiều nhóm
  const displayBox = document.getElementById('skyeyes-groups-display');
  if (displayBox) {
    displayBox.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('skyeyes-groups-dropdown');
      dropdown.style.display = dropdown.style.display === 'flex' ? 'none' : 'flex';
    });
  }

  // Đóng dropdown khi click ra ngoài
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('skyeyes-groups-dropdown');
    const display = document.getElementById('skyeyes-groups-display');
    if (dropdown && display && !dropdown.contains(e.target) && !display.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // Tìm kiếm lọc tên nhóm
  const searchInput = document.getElementById('skyeyes-group-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const items = document.querySelectorAll('#skyeyes-groups-list label');
      items.forEach(item => {
        const name = item.textContent.toLowerCase();
        if (name.includes(q)) {
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });
    });
  }

  // Toggle Custom Dropdown chọn nhiều nhóm (nhóm Tạm nhập riêng)
  const displayBoxIe = document.getElementById('skyeyes-ie-groups-display');
  if (displayBoxIe) {
    displayBoxIe.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById('skyeyes-ie-groups-dropdown');
      dropdown.style.display = dropdown.style.display === 'flex' ? 'none' : 'flex';
    });
  }

  // Đóng dropdown khi click ra ngoài
  document.addEventListener('click', (e) => {
    const dropdown = document.getElementById('skyeyes-ie-groups-dropdown');
    const display = document.getElementById('skyeyes-ie-groups-display');
    if (dropdown && display && !dropdown.contains(e.target) && !display.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });

  // Tìm kiếm lọc tên nhóm (nhóm Tạm nhập riêng)
  const searchInputIe = document.getElementById('skyeyes-ie-group-search');
  if (searchInputIe) {
    searchInputIe.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase().trim();
      const items = document.querySelectorAll('#skyeyes-ie-groups-list label');
      items.forEach(item => {
        const name = item.textContent.toLowerCase();
        if (name.includes(q)) {
          item.style.display = 'flex';
        } else {
          item.style.display = 'none';
        }
      });
    });
  }

  document.querySelectorAll('input[name="fms-import-export-duration"]').forEach(rad => {
    rad.addEventListener('change', handleSaveSkyEyesSettings);
  });

  const skyeyesNotify = document.getElementById('skyeyes-notify-enabled');
  if (skyeyesNotify) skyeyesNotify.addEventListener('change', handleSaveSkyEyesSettings);
  const skyeyesPresets = document.getElementById('skyeyes-template-presets');
  if (skyeyesPresets) skyeyesPresets.addEventListener('change', handleSkyEyesPresetChange);
  const skyeyesTemplate = document.getElementById('skyeyes-template-input');
  if (skyeyesTemplate) skyeyesTemplate.addEventListener('blur', handleSaveSkyEyesSettings);

  // Đăng ký Auto-save cho các checkbox bộ lọc thông báo Zalo FMS
  [
    'skyeyes-notify-new-standby', 'skyeyes-notify-new-fuel-order', 
    'skyeyes-notify-standby-changed', 'skyeyes-notify-fuel-order-changed', 
    'skyeyes-notify-ac-reg-changed', 'skyeyes-notify-gate-changed', 
    'skyeyes-notify-etd-changed', 'skyeyes-notify-airline-mismatch'
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', handleSaveSkyEyesSettings);
  });

  // Lắng nghe sự kiện tìm kiếm và bộ lọc FMS
  const fmsSearchInput = document.getElementById('fms-search-input');
  if (fmsSearchInput) {
    fmsSearchInput.addEventListener('input', () => renderFmsTable());
  }
  const fmsCrewSelect = document.getElementById('fms-crew-filter');
  if (fmsCrewSelect) {
    fmsCrewSelect.addEventListener('change', () => renderFmsTable());
  }

  // Đăng ký Event Delegation cho bảng FMS cập nhật vị trí đỗ (in-place edit)
  const fmsTbody = document.getElementById('fms-table-body');
  if (fmsTbody) {
    fmsTbody.addEventListener('click', (e) => {
      const span = e.target.closest('.editable-gate');
      if (!span) return;
      if (span.querySelector('input')) return; // Đang trong chế độ sửa

      const flightNo = span.getAttribute('data-flight');
      const flightDate = span.getAttribute('data-date');
      const originalGate = span.textContent.trim();
      const currentVal = originalGate === '-' ? '' : originalGate;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentVal;
      input.style.width = '60px';
      input.style.textAlign = 'center';
      input.style.background = 'var(--input-bg)';
      input.style.border = '1px solid var(--success)';
      input.style.color = 'var(--text)';
      input.style.fontWeight = 'bold';
      input.style.borderRadius = '4px';
      input.style.padding = '2px';
      input.style.outline = 'none';

      span.innerHTML = '';
      span.appendChild(input);
      input.focus();
      input.select();

      let isSaving = false;

      const saveGate = async () => {
        if (isSaving) return;
        isSaving = true;
        const newVal = input.value.trim();

        if (newVal === currentVal) {
          span.textContent = originalGate;
          return;
        }

        try {
          const res = await fetch('/api/fms/schedule/update-gate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ flightNo, date: flightDate, gate: newVal })
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.error);
          }

          // Cập nhật cache cục bộ
          const flightInCache = cachedFmsRows.find(r => r.flight_no === flightNo && r.date === flightDate);
          if (flightInCache) {
            flightInCache.gate = newVal;
          }

          showToast(data.message || 'Đã cập nhật vị trí đỗ thành công!', 'success', 'Thành công');
          renderFmsTable();
        } catch (err) {
          showToast('Không thể cập nhật vị trí đỗ: ' + err.message, 'error', 'Lỗi cập nhật');
          span.textContent = originalGate;
        }
      };

      input.addEventListener('blur', saveGate);
      input.addEventListener('keydown', (evt) => {
        if (evt.key === 'Enter') {
          saveGate();
        } else if (evt.key === 'Escape') {
          span.textContent = originalGate;
        }
      });
    });

  }

  // Map Zalo + báo tin theo từng người (Lái | NV) — bảng gọn trên trang chính
  const notifyContainer = document.getElementById('fms-crew-notify-settings-container');
  if (notifyContainer && !notifyContainer.getAttribute('data-has-listener')) {
    notifyContainer.setAttribute('data-has-listener', 'true');
    notifyContainer.addEventListener('change', async (e) => {
      const t = e.target;

      // --- Map tài khoản Zalo ---
      if (t.classList.contains('fms-zalo-map-select') || t.classList.contains('zalo-member-select')) {
        const select = t;
        const personName = select.getAttribute('data-person')
          || (select.closest('[data-person]') && select.closest('[data-person]').getAttribute('data-person'))
          || (select.closest('[data-name]') && select.closest('[data-name]').getAttribute('data-name'));
        const zaloUid = select.value;
        const originalUid = select.getAttribute('data-original-uid') || '';
        if (!personName) return;

        try {
          if (!zaloUid) {
            // Bỏ map
            const res = await fetch('/api/fms/zalo/mappings', {
              method: 'DELETE',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
              },
              body: JSON.stringify({ scheduleName: personName })
            });
            const data = await res.json();
            if (data.success) {
              state.zaloMappings = (state.zaloMappings || []).filter(
                m => String(m.schedule_name).toUpperCase().trim() !== personName.toUpperCase().trim()
              );
              select.setAttribute('data-original-uid', '');
              select.classList.remove('is-mapped');
              select.classList.add('is-unmapped');
              showToast(`Đã bỏ map: ${personName}`, 'success', 'Zalo');
              renderFmsTable();
            } else {
              showToast(data.error || 'Lỗi bỏ map', 'error');
              select.value = originalUid;
            }
            return;
          }

          const zaloName = select.options[select.selectedIndex]
            ? select.options[select.selectedIndex].text
            : '';
          const res = await fetch('/api/fms/zalo/mappings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({
              scheduleName: personName,
              zaloUid,
              zaloName: /chưa map|chưa liên kết/i.test(zaloName) ? '' : zaloName
            })
          });
          const data = await res.json();
          if (data.success) {
            const key = personName.toUpperCase().trim();
            const existing = (state.zaloMappings || []).find(
              m => String(m.schedule_name).toUpperCase().trim() === key
            );
            if (existing) {
              existing.zalo_uid = zaloUid;
              existing.zalo_name = zaloName;
            } else {
              state.zaloMappings = state.zaloMappings || [];
              state.zaloMappings.push({
                schedule_name: key,
                zalo_uid: zaloUid,
                zalo_name: zaloName
              });
            }
            select.setAttribute('data-original-uid', zaloUid);
            select.classList.remove('is-unmapped');
            select.classList.add('is-mapped');
            showToast(`Đã map ${personName}`, 'success', 'Zalo');
            // Cập nhật crew_zalo_uids trên cache cho chuyến có người này
            const pNorm = normalizePersonName(personName);
            cachedFmsRows.forEach(r => {
              const { driver, operator } = parseCrewRoles(r);
              const names = [driver, operator].filter(Boolean);
              if (!names.some(n => normalizePersonName(n) === pNorm)) return;
              const mapDb = getZaloMapDb();
              mapDb[key] = zaloUid;
              const uids = [];
              names.forEach(n => {
                const uid = resolveZaloUidForPerson(n, mapDb);
                if (uid) uids.push(uid);
              });
              r.crew_zalo_uids = Array.from(new Set(uids)).join(',');
            });
            renderFmsTable();
          } else {
            showToast(data.error || 'Lỗi map Zalo', 'error');
            select.value = originalUid;
          }
        } catch (err) {
          showToast('Lỗi kết nối: ' + err.message, 'error');
          select.value = originalUid;
        }
        return;
      }

      // --- Báo tin (notify type) theo người ---
      if (t.classList.contains('fms-crew-notify-select')) {
        const select = t;
        const personName = select.getAttribute('data-person') || select.getAttribute('data-crew');
        const date = select.getAttribute('data-date');
        const notifyType = parseInt(select.value, 10);
        const originalVal = parseInt(select.getAttribute('data-original-val') || '1', 10);

        try {
          const res = await fetch('/api/fms/schedule/update-notify-type', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${state.token}`
            },
            body: JSON.stringify({ personName, date, notifyType })
          });
          const data = await res.json();
          if (data.success) {
            showToast(data.message || `Đã cập nhật ${personName}`, 'success', 'Zalo');
            select.setAttribute('data-original-val', String(notifyType));
            const pNorm = normalizePersonName(personName);
            cachedFmsRows.forEach(r => {
              if (date && r.date !== date) return;
              const { driver, operator } = parseCrewRoles(r);
              if (normalizePersonName(driver) === pNorm || normalizePersonName(operator) === pNorm) {
                r.notify_type = notifyType;
              }
            });
          } else {
            showToast(data.error || 'Lỗi cập nhật', 'error', 'Thất bại');
            select.value = originalVal;
          }
        } catch (err) {
          showToast('Lỗi kết nối: ' + err.message, 'error', 'Lỗi');
          select.value = originalVal;
        }
      }
    });
  }
}

// --- XỬ LÝ ĐĂNG NHẬP / ĐĂNG XUẤT ---
async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('username').value.trim();
  const passwordInput = document.getElementById('password').value.trim();
  const errorEl = document.getElementById('login-error');
  const errorTextEl = document.getElementById('error-text');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang xác thực...';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });

    const data = await res.json();
    if (data.success) {
      // Lưu thông tin đăng nhập
      state.token = data.token;
      state.role = data.role;
      state.username = usernameInput;
      state.displayName = data.displayName;
      state.department = data.department;

      state.permissions = data.permissions || {};
      localStorage.setItem('crm_token', data.token);
      localStorage.setItem('crm_role', data.role);
      localStorage.setItem('crm_username', usernameInput);
      localStorage.setItem('crm_display_name', data.displayName);
      localStorage.setItem('crm_department', data.department);
      localStorage.setItem('crm_permissions', JSON.stringify(data.permissions || {}));

      // Lưu hoặc xóa thông tin Ghi nhớ đăng nhập
      const rememberMe = document.getElementById('remember-me').checked;
      if (rememberMe) {
        localStorage.setItem('crm_remembered_user', usernameInput);
        localStorage.setItem('crm_remembered_pass', passwordInput);
      } else {
        localStorage.removeItem('crm_remembered_user');
        localStorage.removeItem('crm_remembered_pass');
      }

      initApp();
    } else {
      throw new Error(data.error || 'Lỗi đăng nhập không xác định');
    }
  } catch (err) {
    errorTextEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

function handleLogout() {
  if (confirm('Khầy có chắc chắn muốn đăng xuất khỏi hệ thống LMS không?')) {
    localStorage.clear();
    state.token = null;
    state.role = null;
    state.username = null;
    state.displayName = null;
    state.department = null;
    state.permissions = {};
    state.selectedUser = null;
    showScreen('login-screen');
  }
}

// --- DASHBOARD ADMIN ---
async function loadAdminDashboard(isPolling = false) {
  try {
    if (!isPolling) {
      loadSystemSettings();
    }
    const res = await fetch('/api/accounts', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const accounts = data.accounts;
    
    // Cập nhật các thẻ KPI
    document.getElementById('kpi-total-accounts').textContent = accounts.length;
    
    const activeCount = accounts.reduce((acc, curr) => acc + (curr.runningCount > 0 ? 1 : 0), 0);
    document.getElementById('kpi-active-accounts').textContent = activeCount;

    // Vẽ bảng danh sách tài khoản
    const tbody = document.getElementById('accounts-table-body');
    if (accounts.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 30px; color: var(--text-muted);">
            Chưa có tài khoản học viên nào được kết nối. Nhấn "Thêm tài khoản" để bắt đầu.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = accounts.map(acc => {
      const isRunning = acc.runningCount > 0;
      const statusText = isRunning ? 'Treo máy (Online)' : 'Không đọc gì';
      const statusClass = isRunning ? 'active' : 'error';
      const indicatorColor = isRunning ? 'var(--success)' : '#ef4444';

      // Xử lý phân loại màu sắc KPI theo yêu cầu của Khầy Được
      const kpi = acc.kpi_percent || 0;
      let kpiColor = '#ef4444'; // Đỏ mặc định (< 60)
      let kpiBg = 'rgba(239, 68, 68, 0.1)';
      let kpiBorder = 'rgba(239, 68, 68, 0.2)';
      
      if (kpi >= 100) {
        kpiColor = '#10b981'; // Xanh (>= 100)
        kpiBg = 'rgba(16, 185, 129, 0.1)';
        kpiBorder = 'rgba(16, 185, 129, 0.2)';
      } else if (kpi >= 60) {
        kpiColor = '#f59e0b'; // Cam (60 đến < 100)
        kpiBg = 'rgba(245, 158, 11, 0.1)';
        kpiBorder = 'rgba(245, 158, 11, 0.2)';
      }

      const currentRole = (acc.role === 'admin' || acc.perm_admin === 1) ? 'admin' :
                          (acc.perm_fms === 1) ? 'dieu_hanh' :
                          (acc.perm_gemini === 1) ? 'nv_c1' : 'nv_c2';

      const permissionsHtml = `
        <select class="role-select" data-username="${acc.username}" style="padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--input-bg); color: var(--text); font-weight: 600; cursor: pointer; outline: none; font-size: 0.82rem; width: 100%; box-sizing: border-box;">
          <option value="admin" ${currentRole === 'admin' ? 'selected' : ''} style="color: var(--text); background: var(--panel-bg);">👑 Admin</option>
          <option value="dieu_hanh" ${currentRole === 'dieu_hanh' ? 'selected' : ''} style="color: var(--text); background: var(--panel-bg);">✈️ Điều hành</option>
          <option value="nv_c1" ${currentRole === 'nv_c1' ? 'selected' : ''} style="color: var(--text); background: var(--panel-bg);">👤 Nhân viên C1</option>
          <option value="nv_c2" ${currentRole === 'nv_c2' ? 'selected' : ''} style="color: var(--text); background: var(--panel-bg);">👤 Nhân viên C2</option>
        </select>
      `;

      return `
        <tr>
          <td><code style="color: var(--primary); font-weight: 600;">${acc.username}</code></td>
          <td style="font-weight: 500;">${acc.display_name}</td>
          <td style="color: var(--text-muted); font-size: 0.9em;" class="hide-on-mobile">${acc.department}</td>
          <td style="text-align: center;" class="hide-on-mobile">
            <span class="status-badge ${statusClass}">
              <i class="fa-solid fa-circle" style="font-size: 0.6em; color: ${indicatorColor}"></i> ${statusText}
            </span>
          </td>
          <td style="text-align: center; font-weight: 600; color: ${isRunning ? 'var(--success)' : 'inherit'};">
            ${acc.runningCount} lớp
          </td>
          <td style="text-align: center;">
            <span class="status-badge" style="color: ${kpiColor}; background: ${kpiBg}; border: 1px solid ${kpiBorder}; font-weight: 600; padding: 4px 10px; border-radius: 6px; display: inline-block;">
              ${kpi}%
            </span>
          </td>
          <td style="text-align: center;">${permissionsHtml}</td>
          <td style="text-align: center;">
            <div style="display: flex; gap: 6px; justify-content: center;">
              <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.85em;" onclick="viewStaffDetails('${acc.username}', '${acc.display_name}', '${acc.department}')">
                <i class="fa-solid fa-eye"></i> Xem lớp
              </button>
              <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.85em; color: #60a5fa; border-color: rgba(96, 165, 250, 0.2);" onclick="syncAccountFromRow('${acc.username}', this)">
                <i class="fa-solid fa-rotate"></i> Đồng bộ
              </button>
              <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.85em; color: var(--danger); border-color: rgba(239, 68, 68, 0.2);" onclick="deleteAccount('${acc.username}')">
                <i class="fa-solid fa-trash"></i> Xóa
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Đăng ký sự kiện thay đổi vai trò
    document.querySelectorAll('.role-select').forEach(sel => {
      sel.addEventListener('change', async (e) => {
        const username = e.target.getAttribute('data-username');
        const roleName = e.target.value;
        await updateAccountRole(username, roleName);
      });
    });

    // Lấy tổng số lớp học quản lý
    const classRes = await fetch('/api/classes', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const classData = await classRes.json();
    if (classData.success) {
      document.getElementById('kpi-total-classes-admin').textContent = classData.classes.length;
    }

  } catch (err) {
    console.error('Lỗi tải danh sách tài khoản:', err.message);
  }
}

// Cập nhật phân quyền tài khoản học viên lên máy chủ
async function updateAccountPermission(username, perm, value) {
  try {
    const res = await fetch(`/api/accounts/${username}/permissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ perm, value: value ? 1 : 0 })
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Đã cập nhật quyền ${perm.toUpperCase()} cho tài khoản ${username} thành công!`, 'success', 'Đã lưu');
    } else {
      showToast(data.error, 'error', 'Thất bại');
    }
  } catch (e) {
    showToast('Lỗi cập nhật quyền: ' + e.message, 'error', 'Lỗi kết nối');
  }
}

// Cập nhật vai trò tài khoản trực tiếp
async function updateAccountRole(username, roleName) {
  try {
    const res = await fetch(`/api/accounts/${username}/role`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ roleName })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast(`Đã chuyển vai trò tài khoản ${username} thành công!`, 'success', 'Cập nhật vai trò');
  } catch (e) {
    showToast('Lỗi khi cập nhật vai trò: ' + e.message, 'error', 'Thất bại');
  }
}

// Xem chi tiết lớp học của một nhân viên (Chức năng dành cho Admin)
function viewStaffDetails(username, displayName, department) {
  state.selectedUser = { username, displayName, department };
  
  // Hiển thị nút quay lại và bar quay lại
  document.getElementById('btn-back-to-admin').classList.remove('hidden');
  document.getElementById('back-bar').classList.remove('hidden');
  
  // Cập nhật thông tin Header
  document.getElementById('user-title-name').textContent = displayName;
  document.getElementById('user-title-dept').textContent = department + ` (Tài khoản: ${username})`;

  showScreen('user-screen');

  // Mặc định kích hoạt tab E-learning cho Admin xem tiến độ học tập
  const elearningTabBtn = document.getElementById('user-tab-btn-elearning');
  if (elearningTabBtn) {
    document.querySelectorAll('.user-tab-btn').forEach(b => {
      b.classList.remove('active');
      b.style.color = 'var(--text-muted)';
      b.style.borderBottom = '2px solid transparent';
    });
    elearningTabBtn.classList.add('active');
    elearningTabBtn.style.color = 'var(--primary)';
    elearningTabBtn.style.borderBottom = '2px solid var(--primary)';

    const elearningSec = document.getElementById('user-elearning-section');
    const fmsSec = document.getElementById('user-fms-section');
    if (fmsSec) fmsSec.style.setProperty('display', 'none', 'important');
    if (elearningSec) elearningSec.style.setProperty('display', 'flex', 'important');
  }

  loadUserDashboard(username);
}

// Quay lại màn hình Admin Dashboard
function showAdminDashboard() {
  state.selectedUser = null;
  document.getElementById('btn-back-to-admin').classList.add('hidden');
  document.getElementById('back-bar').classList.add('hidden');
  showScreen('admin-screen');
  loadAdminDashboard();
}

// Xóa tài khoản nhân viên
async function deleteAccount(username) {
  if (confirm(`Khầy có chắc chắn muốn xóa tài khoản ${username} ra khỏi hệ thống? Mọi tiến trình chạy ngầm của tài khoản này cũng sẽ bị dừng.`)) {
    try {
      const res = await fetch(`/api/accounts/${username}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast('Đã xóa tài khoản thành công!', 'success', 'Thành công');
        loadAdminDashboard();
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      showToast('Lỗi khi xóa tài khoản: ' + e.message, 'error', 'Thất bại');
    }
  }
}

async function loadUserDashboard(targetUsername = null, isSilent = false) {
  const username = targetUsername || state.username;
  const tbody = document.getElementById('classes-table-body');
  
  // Lấy thông tin chi tiết tài khoản bao gồm các chỉ số KPI từ Skypec
  try {
    const userRes = await fetch(`/api/accounts/${username}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (userRes.status === 401 || userRes.status === 403) {
      forceLogoutToLogin(`API /api/accounts HTTP ${userRes.status}`);
      return;
    }
    const userData = await userRes.json();
    if (userData.success) {
      const u = userData.user;
      const titleNameEl = document.getElementById('user-title-name');
      if (titleNameEl) titleNameEl.textContent = u.display_name;
      
      const titleDeptEl = document.getElementById('user-title-dept');
      if (titleDeptEl) titleDeptEl.textContent = `${u.position_name || 'Học viên'} | ${u.department || 'Đơn vị'}`;
      
      // Cập nhật các thẻ KPI từ Skypec
      const kpiTotalEl = document.getElementById('kpi-user-total-classes');
      if (kpiTotalEl) kpiTotalEl.textContent = u.class_total || 0;
      
      const kpiUserEl = document.getElementById('kpi-user-kpi');
      if (kpiUserEl) kpiUserEl.textContent = `${u.kpi_percent || 0}%`;
      
      const kpiDetailEl = document.getElementById('kpi-user-kpi-detail');
      if (kpiDetailEl) kpiDetailEl.textContent = `KPI: ${u.kpi_current || 0}/${u.kpi_total || 0} giờ`;
      
      const kpiCertEl = document.getElementById('kpi-user-certificates');
      if (kpiCertEl) kpiCertEl.textContent = u.total_certificate || 0;
    }
  } catch (e) {
    console.error('Lỗi khi tải thông tin KPI tài khoản:', e.message);
  }

  const btnBack = document.getElementById('btn-back-to-admin');
  const backBar = document.getElementById('back-bar');

  if (!targetUsername && !state.selectedUser) {
    if (btnBack) btnBack.classList.add('hidden');
    if (backBar) backBar.classList.add('hidden');
  }

  if (state.selectedUser) {
    if (btnBack) btnBack.classList.remove('hidden');
    if (backBar) backBar.classList.remove('hidden');
  }

  if (!isSilent && tbody) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 30px;">
          <div class="loading-spinner">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải dữ liệu lớp học...
          </div>
        </td>
      </tr>
    `;
  }

  try {
    const res = await fetch('/api/classes', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    if (res.status === 401 || res.status === 403) {
      forceLogoutToLogin(`API /api/classes HTTP ${res.status}`);
      return;
    }
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // Nếu là admin đang xem, lọc các lớp học của tài khoản đang chọn
    let classes = data.classes || [];
    if (targetUsername) {
      classes = classes.filter(c => c.account_username === targetUsername);
    }

    // Lưu trữ danh sách ID các lớp đã đăng ký
    state.registeredClassIds = classes.map(c => c.id);

    // Cập nhật số lớp đang treo máy
    const runningCount = classes.reduce((acc, curr) => acc + (curr.isRunning ? 1 : 0), 0);
    const runningClassesEl = document.getElementById('kpi-user-running-classes');
    if (runningClassesEl) runningClassesEl.textContent = runningCount;

    if (classes.length === 0) {
      if (tbody) {
        tbody.innerHTML = `
          <tr>
            <td colspan="4" style="text-align: center; padding: 30px; color: var(--text-muted);">
              Hiện tại không có lớp học nào đang diễn ra.
            </td>
          </tr>
        `;
      }
      // Vẫn cần load stats FMS chứ không return ngắt luồng hoàn toàn
      loadUserFmsStats().catch(err => console.error('[FMS Stats] Lỗi tải số liệu:', err.message));
      return;
    }

    const htmlContent = classes.map(c => {
      const hasRequiredTime = c.min_time_required && c.min_time_required > 0;
      const percent = hasRequiredTime ? Math.min(100, Math.max(0, (c.learn_time / c.min_time_required) * 100)) : (c.is_finish === 1 ? 100 : 0);
      const isCompleted = c.is_finish === 1 || (hasRequiredTime && percent >= 100);
      const statusText = isCompleted ? 'Hoàn thành' : 'Đang học';
      const statusClass = isCompleted ? 'finished' : 'studying';
      
      const isChecked = c.auto_learn === 1 ? 'checked' : '';

      return `
        <tr>
          <td style="font-weight: 500;">
            ${c.class_title}
            <div style="margin-top: 4px; font-size: 0.8rem; color: var(--text-muted);">
              ID Lớp: <code>${c.id}</code>
            </div>
            ${c.surveyStatus ? `
            <div class="survey-status-indicator" style="margin-top: 6px; font-size: 0.82rem; font-weight: 600; color: #f97316; display: flex; align-items: center; gap: 6px;">
              <i class="fa-solid fa-circle-notch fa-spin"></i>
              <span>${c.surveyStatus}</span>
            </div>
            ` : ''}
          </td>
          <td>
            <div style="display: flex; justify-content: space-between; font-size: 0.85rem; font-weight: 600;">
              <span style="color: var(--primary);">${c.learn_time.toFixed(1)} ph</span>
              <span style="color: var(--text-muted);">${hasRequiredTime ? c.min_time_required + ' ph (' + percent.toFixed(0) + '%)' : 'Không rõ'}</span>
            </div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill ${isCompleted ? 'finished' : ''}" style="width: ${percent}%"></div>
            </div>
          </td>
          <td style="text-align: center;">
            <div style="display: flex; flex-direction: column; align-items: center; gap: 6px;">
              <span class="status-tag ${statusClass}" style="padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; background: ${isCompleted ? 'var(--success-bg)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isCompleted ? 'var(--success)' : '#60a5fa'};">
                ${statusText}
              </span>
              ${c.class_exercise_id ? (c.is_exercise_finished === 1 ? '<span class="status-tag review-finished">Đã Review</span>' : '<span class="status-tag review-pending">Cần Review</span>') : ''}
            </div>
          </td>
          <td style="text-align: center;">
            <label class="switch">
              <input type="checkbox" ${isChecked} onchange="toggleLearn('${c.id}', this.checked)">
              <span class="slider"></span>
            </label>
          </td>
        </tr>
      `;
    }).join('');

    if (tbody) {
      tbody.innerHTML = htmlContent;
    }

  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 30px; color: var(--danger-color);">
            Không thể tải dữ liệu: ${err.message}
          </td>
        </tr>
      `;
    }
  }

  // Tải các chỉ số thống kê số chuyến bay FMS của nhân viên
  loadUserFmsStats().catch(err => console.error('[FMS Stats] Lỗi tải số liệu:', err.message));
}

// Bật/Tắt học ngầm cho một lớp
async function toggleLearn(classId, isChecked) {
  try {
    const targetUser = state.selectedUser ? state.selectedUser.username : state.username;
    const res = await fetch(`/api/classes/${classId}/toggle-learn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ 
        auto_learn: isChecked ? 1 : 0,
        username: targetUser 
      })
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.error || 'Lỗi thao tác', 'error', 'Thất bại');
      // Tải lại danh sách lớp để khôi phục trạng thái checkbox
      loadUserDashboard(targetUser);
    } else {
      // Tải lại số đếm KPI
      loadUserDashboard(targetUser);
    }
  } catch (e) {
    showToast('Lỗi kết nối mạng: ' + e.message, 'error', 'Lỗi kết nối');
  }
}

// Đồng bộ tiến độ từ Skypec
async function triggerSyncProgress(username) {
  const btn = document.getElementById('btn-sync-progress');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang đồng bộ...';

  try {
    const res = await fetch(`/api/accounts/${username}/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đồng bộ thành công dữ liệu học tập mới nhất từ Skypec!', 'success', 'Đồng bộ thành công');
      loadUserDashboard(username === state.username ? null : username);
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast('Không thể đồng bộ: ' + err.message, 'error', 'Đồng bộ thất bại');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- KHÁM PHÁ & ĐĂNG KÝ LỚP HỌC MỚI ---
let exploreState = {
  activeCategory: '713056e6-8fc2-4d54-8614-0c475c0ae1a4',
  keyword: '',
  page: 1,
  limit: 9,
  totalPages: 1
};

async function loadExploreClasses() {
  const grid = document.getElementById('explore-grid');
  const loading = document.getElementById('explore-loading');
  const pagination = document.getElementById('explore-pagination');
  
  grid.style.display = 'none';
  loading.style.display = 'flex';
  pagination.style.display = 'none';

  const userToExplore = state.selectedUser ? state.selectedUser.username : state.username;
  const offset = (exploreState.page - 1) * exploreState.limit;

  try {
    const res = await fetch('/api/classes/explore', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        username: userToExplore,
        categoryId: exploreState.activeCategory,
        keyword: exploreState.keyword,
        offset: offset,
        limit: exploreState.limit
      })
    });

    const data = await res.json();
    loading.style.display = 'none';

    if (data.status && data.data) {
      const classes = data.data;
      const totalRecord = data.metaData ? data.metaData.totalRecord : 0;
      exploreState.totalPages = Math.ceil(totalRecord / exploreState.limit) || 1;

      if (classes.length === 0) {
        grid.innerHTML = `
          <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
            <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; margin-bottom: 15px; display: block; color: var(--primary);"></i>
            Không tìm thấy lớp học nào trong danh mục này.
          </div>
        `;
        grid.style.display = 'grid';
        return;
      }

      grid.innerHTML = classes.map(c => {
        const isRegistered = state.registeredClassIds && state.registeredClassIds.includes(c.id);
        const actionBtn = isRegistered 
          ? `<button class="btn-secondary" style="color: var(--success); border-color: var(--success); width: 100%; cursor: not-allowed;" disabled><i class="fa-solid fa-circle-check"></i> Đã đăng ký</button>`
          : `<button class="btn-glow" style="width: 100%; margin-top: 0;" onclick="registerExploreClass('${c.id}', this)"><i class="fa-solid fa-graduation-cap"></i> Đăng ký & Vào học</button>`;

        const timeCommit = c.minTimeRequired ? `${c.minTimeRequired} phút` : 'Không rõ';

        return `
          <div class="explore-card">
            <div class="explore-card-title" title="${c.title}">${c.title}</div>
            <div class="explore-card-meta">
              <span><i class="fa-solid fa-clock"></i> Yêu cầu: ${timeCommit}</span>
              <span>ID: <code>${c.id.substring(0, 8)}...</code></span>
            </div>
            <div class="explore-card-action">
              ${actionBtn}
            </div>
          </div>
        `;
      }).join('');

      grid.style.display = 'grid';
      pagination.style.display = 'flex';
      
      document.getElementById('explore-page-info').textContent = `Trang ${exploreState.page} / ${exploreState.totalPages} (Tổng số ${totalRecord} lớp)`;
      document.getElementById('btn-explore-prev').disabled = exploreState.page === 1;
      document.getElementById('btn-explore-next').disabled = exploreState.page >= exploreState.totalPages;

    } else {
      throw new Error(data.error || 'Lỗi tải danh mục từ Skypec');
    }
  } catch (err) {
    loading.style.display = 'none';
    grid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--danger);">
        <i class="fa-solid fa-circle-exclamation" style="font-size: 2.5rem; margin-bottom: 15px; display: block;"></i>
        Lỗi tải danh sách lớp: ${err.message}
      </div>
    `;
    grid.style.display = 'grid';
  }
}

async function registerExploreClass(classId, btn) {
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang đăng ký...';

  const userToRegister = state.selectedUser ? state.selectedUser.username : state.username;

  try {
    const res = await fetch('/api/classes/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        username: userToRegister,
        classId: classId
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast('Đăng ký lớp học thành công! Hệ thống đã đồng bộ lớp mới vào bảng điều khiển.', 'success', 'Đăng ký thành công');
      if (!state.registeredClassIds) state.registeredClassIds = [];
      state.registeredClassIds.push(classId);
      
      btn.outerHTML = `<button class="btn-secondary" style="color: var(--success); border-color: var(--success); width: 100%; cursor: not-allowed;" disabled><i class="fa-solid fa-circle-check"></i> Đã đăng ký</button>`;
      
      loadUserDashboard(userToRegister === state.username ? null : userToRegister);
    } else {
      throw new Error(data.error || 'Đăng ký thất bại');
    }
  } catch (err) {
    showToast('Không thể đăng ký lớp học: ' + err.message, 'error', 'Đăng ký thất bại');
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- ADMIN CONTROL BATCH ---
async function triggerBulkControl(action) {
  if (confirm(`Khầy có chắc chắn muốn thực hiện hành động này cho TẤT CẢ lớp học không?`)) {
    try {
      const res = await fetch(`/api/control/${action}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'info');
        loadAdminDashboard();
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      showToast('Lỗi: ' + e.message, 'info');
    }
  }
}

// --- THÊM TÀI KHOẢN MỚI (ADMIN) ---
async function handleAddAccount(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('new-username').value.trim();
  const passwordInput = document.getElementById('new-password').value.trim();
  const errorEl = document.getElementById('add-error');
  const errorTextEl = document.getElementById('add-error-text');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang xác thực & đồng bộ...';

  try {
    // Gọi API đăng nhập (đồng thời tạo/cập nhật tài khoản trong DB)
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: usernameInput, password: passwordInput })
    });

    const data = await res.json();
    if (data.success) {
      showToast(`Đã liên kết và đồng bộ thành công tài khoản: ${data.displayName}`, 'info');
      document.getElementById('add-account-modal').classList.remove('active');
      loadAdminDashboard();
    } else {
      throw new Error(data.error || 'Lỗi thêm tài khoản');
    }
  } catch (err) {
    errorTextEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

// --- HÀM CẤU HÌNH HỆ THỐNG (ADMIN) ---
async function loadSystemSettings() {
  try {
    const res = await fetch('/api/settings', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success && data.settings) {
      document.getElementById('setting-max-classes').value = data.settings.max_active_classes || 3;
    }
  } catch (err) {
    console.error('Lỗi tải cấu hình hệ thống:', err.message);
  }
}

async function saveSystemSettings() {
  const value = document.getElementById('setting-max-classes').value;
  const btn = document.getElementById('btn-save-settings');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang lưu...';
  
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ key: 'max_active_classes', value: value })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Cập nhật giới hạn lớp treo song song thành công!', 'success', 'Thành công');
    } else {
      showToast(data.error || 'Lỗi lưu cấu hình', 'error', 'Thất bại');
    }
  } catch (err) {
    showToast(err.message, 'error', 'Thất bại');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- HỆ THỐNG THÔNG BÁO TOAST TỰ CHỈNH (CUSTOM TOAST NOTIFICATION) ---
function showToast(message, type = 'info', title = null) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconHtml = '<i class="fa-solid fa-circle-info"></i>';
  let defaultTitle = 'Thông báo';
  if (type === 'success') {
    iconHtml = '<i class="fa-solid fa-circle-check"></i>';
    defaultTitle = 'Thành công';
  } else if (type === 'error') {
    iconHtml = '<i class="fa-solid fa-circle-xmark"></i>';
    defaultTitle = 'Lỗi';
  } else if (type === 'warning') {
    iconHtml = '<i class="fa-solid fa-triangle-exclamation"></i>';
    defaultTitle = 'Cảnh báo';
  }

  toast.innerHTML = `
    <div class="toast-icon">${iconHtml}</div>
    <div class="toast-content">
      <div class="toast-title">${title || defaultTitle}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close"><i class="fa-solid fa-xmark"></i></button>
    <div class="toast-progress">
      <div class="toast-progress-fill"></div>
    </div>
  `;

  container.appendChild(toast);

  // Kích hoạt hiệu ứng xuất hiện
  setTimeout(() => {
    toast.classList.add('active');
  }, 10);

  // Chạy thanh thời gian co lại
  const progressFill = toast.querySelector('.toast-progress-fill');
  setTimeout(() => {
    if (progressFill) progressFill.style.width = '0%';
  }, 50);

  // Tự động đóng sau 4 giây
  const autoCloseTimeout = setTimeout(() => {
    closeToast(toast);
  }, 4000);

  // Đóng thủ công bằng nút X
  toast.querySelector('.toast-close').addEventListener('click', () => {
    clearTimeout(autoCloseTimeout);
    closeToast(toast);
  });
}

function closeToast(toast) {
  toast.classList.remove('active');
  toast.classList.add('fade-out');
  toast.addEventListener('transitionend', () => {
    toast.remove();
  });
}

// --- ĐỔI MẬT KHẨU ADMIN ---
async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password-input').value;
  const confirmNewPassword = document.getElementById('confirm-new-password').value;
  const errorEl = document.getElementById('change-pass-error');
  const errorTextEl = document.getElementById('change-pass-error-text');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (newPassword !== confirmNewPassword) {
    errorTextEl.textContent = 'Mật khẩu mới và xác nhận mật khẩu không khớp!';
    errorEl.classList.remove('hidden');
    return;
  }

  errorEl.classList.add('hidden');
  submitBtn.disabled = true;
  const originalText = submitBtn.innerHTML;
  submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang cập nhật...';

  try {
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await res.json();
    if (data.success) {
      showToast('Cập nhật mật khẩu admin thành công!', 'success', 'Thành công');
      document.getElementById('change-password-modal').classList.remove('active');
    } else {
      throw new Error(data.error || 'Đổi mật khẩu thất bại');
    }
  } catch (err) {
    errorTextEl.textContent = err.message;
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }
}

async function syncAccountFromRow(username, btn) {
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
  
  try {
    const res = await fetch(`/api/accounts/${username}/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Đồng bộ dữ liệu tài khoản ${username} thành công!`, 'success', 'Thành công');
      loadAdminDashboard(true);
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast('Không thể đồng bộ: ' + err.message, 'error', 'Đồng bộ thất bại');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- LOGIC QUẢN LÝ FMS VIETNAM AIRLINES ---
let fmsInterval = null;
let cachedFmsRows = [];

function formatDateVN(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

window.fmsUnitFilter = window.fmsUnitFilter || 'SKYPEC';
window.userFmsUnitFilter = window.userFmsUnitFilter || 'SKYPEC';

/** Cập nhật toggle + tiêu đề lịch theo đơn vị (SKYPEC mặc định) */
function setFmsUnitFilter(unit, scope) {
  const u = String(unit || 'SKYPEC').toUpperCase() === 'NAFC' ? 'NAFC' : 'SKYPEC';
  const isNa = u === 'NAFC';
  const title = isNa ? 'Lịch tra nạp NAFC' : 'Lịch tra nạp Skypec';
  const activeBg = isNa ? '#0f766e' : 'var(--primary)';
  const idleBg = '#e2e8f0';
  const idleColor = '#334155';

  if (scope === 'admin' || scope === 'both') {
    window.fmsUnitFilter = u;
    document.querySelectorAll('.fms-unit-btn').forEach(b => {
      const on = (b.getAttribute('data-unit') || '') === u;
      b.classList.toggle('active', on);
      b.style.background = on ? activeBg : idleBg;
      b.style.color = on ? '#fff' : idleColor;
    });
    const t = document.getElementById('fms-panel-title');
    if (t) {
      t.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${title}`;
      t.style.color = isNa ? '#0f766e' : 'var(--success)';
    }
  }
  if (scope === 'user' || scope === 'both') {
    window.userFmsUnitFilter = u;
    document.querySelectorAll('.user-fms-unit-btn').forEach(b => {
      const on = (b.getAttribute('data-unit') || '') === u;
      b.classList.toggle('active', on);
      b.style.background = on ? activeBg : idleBg;
      b.style.color = on ? '#fff' : idleColor;
    });
    const t = document.getElementById('user-fms-panel-title');
    if (t) {
      t.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${title}`;
      t.style.color = isNa ? '#0f766e' : 'var(--success)';
    }
  }
}

async function loadFmsSchedules(isSilent = false) {
  try {
    const filterInput = document.getElementById('fms-filter-date');
    const scheduleDateInput = document.getElementById('fms-schedule-date');

    // Smart A+B: ca auto + ngày duty theo giờ VN (nếu user chưa chọn tay)
    applySmartFmsDefaults('admin');

    if (scheduleDateInput && !scheduleDateInput.value && filterInput && filterInput.value) {
      scheduleDateInput.value = filterInput.value;
    }
    const selectedDate = filterInput ? filterInput.value : '';
    const unit = window.fmsUnitFilter || 'SKYPEC';

    const res = await fetch(`/api/fms/schedules?date=${encodeURIComponent(selectedDate)}&unit=${encodeURIComponent(unit)}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error);
    }

    const rows = data.data || [];
    cachedFmsRows = rows;
    const tbody = document.getElementById('fms-table-body');
    
    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px; line-height: 1.6;">
            <div style="font-weight: 600; margin-bottom: 6px;">Chưa có lịch bay phân công cho ngày ${selectedDate ? formatDateVN(selectedDate) : 'được chọn'}.</div>
            <div style="font-size: 0.85rem;">
              Lịch được lưu theo <strong>ngày bắt đầu ca trực</strong> (ô lọc ngày phía trên).<br>
              Ví dụ ca tối 18/07 (19:30 → 07:30 sáng 19/07) phải chọn bộ lọc <strong>18/07</strong>, không phải 19/07.<br>
              Đang chọn <strong>Ca tự động</strong> sẽ gợi ý đúng ngày ca theo giờ VN.
            </div>
          </td>
        </tr>
      `;
      updateFmsCrewFilter([]);
      updateFmsShiftBadge('admin', 0, 0);
      return;
    }

    // Đổ dữ liệu lịch bay vào textarea nếu textarea đang trống hoặc không được focus
    const textarea = document.getElementById('fms-schedule-input');
    if (textarea && textarea !== document.activeElement && (!textarea.value.trim())) {
      const scheduleLines = rows.map(r => `${r.flight_no}: ${r.crew_info}`);
      textarea.value = scheduleLines.join('\n');
    }

    // Cập nhật bộ lọc dropdown cặp tra nạp
    updateFmsCrewFilter(rows);

    // Render bảng tải dầu FMS chi tiết sau lọc
    renderFmsTable();

    // Khởi động vòng lặp tự động cập nhật số liệu tải dầu mỗi 10 giây khi đang ở tab FMS
    if (!fmsInterval) {
      fmsInterval = setInterval(() => {
        const activeTabBtn = document.querySelector('.admin-tab-btn.active');
        if (activeTabBtn && activeTabBtn.getAttribute('data-tab') === 'tab-fms') {
          loadFmsSchedules(true);
        }
      }, 10000);
    }
    // Tải danh sách nhân sự chưa liên kết Zalo
    fetchUnmappedCrews();
    // Tải dữ liệu Tạm nhập - Tái xuất tàu bay
    fetchTempImportExportData();

  } catch (err) {
    if (!isSilent) {
      showToast('Không thể tải lịch FMS: ' + err.message, 'error', 'Lỗi kết nối');
    }
  }
}

// Cập nhật dropdown lọc theo người (Lái / NV) — value = tên đầy đủ 1 người
function updateFmsCrewFilter(rows, selectId = 'fms-crew-filter') {
  const crewSelect = document.getElementById(selectId);
  if (!crewSelect) return;

  const currentVal = crewSelect.value;
  const people = new Map(); // norm -> display name

  (rows || []).forEach(r => {
    const { driver, operator } = parseCrewRoles(r);
    [driver, operator].forEach(name => {
      if (!name) return;
      const k = normalizePersonName(name);
      if (!k || k === '-') return;
      if (!people.has(k)) people.set(k, name);
    });
  });

  const sorted = [...people.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'));
  let html = '<option value="">-- Tất cả Lái xe / NV tra nạp --</option>';
  sorted.forEach(([norm, display]) => {
    const safe = escapeHtml(display);
    const selectedAttr = display === currentVal || norm === normalizePersonName(currentVal) ? 'selected' : '';
    html += `<option value="${safe}" ${selectedAttr}>${safe}</option>`;
  });

  crewSelect.innerHTML = html;
  if (currentVal) {
    const match = sorted.find(([, d]) => d === currentVal || normalizePersonName(d) === normalizePersonName(currentVal));
    if (match) crewSelect.value = match[1];
  }
}

function updateUserFmsCrewFilter(rows) {
  updateFmsCrewFilter(rows, 'user-fms-crew-filter');
}

// Cuộn màn hình xuống widget Tạm nhập - Tái xuất
function scrollToImportExportWidget() {
  const tabBtn = document.getElementById('tab-btn-temp-import-export');
  if (tabBtn) {
    tabBtn.click();
  }
}
window.scrollToImportExportWidget = scrollToImportExportWidget;

// Tải dữ liệu Tạm nhập - Tái xuất tàu bay
async function fetchTempImportExportData() {
  try {
    const filterInput = document.getElementById('fms-filter-date');
    const selectedDate = filterInput ? filterInput.value : '';
    
    const res = await fetch(`/api/fms/temp-import-exports?date=${selectedDate}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) return;
    
    const rows = data.data || [];
    const tbody = document.getElementById('fms-import-export-body');
    const banner = document.getElementById('fms-import-export-alert-banner');
    const alertText = document.getElementById('fms-import-export-alert-text');
    
    if (!tbody) return;
    
    // 1. Kiểm tra xem có bản ghi nào bị cảnh báo mà chưa xác nhận (is_warned = 1)
    const activeAlert = rows.find(r => r.is_warned === 1);
    if (activeAlert && banner && alertText) {
      let alertMsg = '';
      if (activeAlert.monitor_type === 'TECHNICAL_HAN') {
        const isNextIntl = activeAlert.new_route && isDepartingIntlRoute(activeAlert.new_route);
        if (isNextIntl) {
          alertMsg = `Điều hành chú ý: Sử dụng tàu ${activeAlert.ac_reg} đã nạp kỹ thuật Han-Han cho chuyến bay Quốc Tế ${activeAlert.new_flight_no} (${activeAlert.new_route})!`;
        } else {
          alertMsg = `Điều hành chú ý: Sử dụng tàu ${activeAlert.ac_reg} đã nạp kỹ thuật cho chuyến bay nội địa ${activeAlert.new_flight_no} (${activeAlert.new_route})!`;
        }
      } else if (activeAlert.monitor_type === 'INTL_TO_DOMESTIC') {
        alertMsg = `Điều hành chú ý: Sử dụng tàu ${activeAlert.ac_reg} đã nạp Quốc tế cho chuyến bay Nội địa ${activeAlert.new_flight_no} (${activeAlert.new_route})!`;
      } else {
        // DOMESTIC_TO_INTL
        alertMsg = `Cảnh báo: Tàu ${activeAlert.ac_reg} (đã nạp ${activeAlert.fuel_order.toLocaleString()} kg chặng ${activeAlert.old_route}) chuyển sang bay Quốc tế ${activeAlert.new_flight_no} (${activeAlert.new_route})!`;
      }
      alertText.textContent = alertMsg;
      banner.style.display = 'flex';
    } else if (banner) {
      banner.style.display = 'none';
    }
    
    // 2. Render dữ liệu ra bảng
    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 15px 0;">
            Không có tàu bay nào cần theo dõi.
          </td>
        </tr>
      `;
      return;
    }
    
    tbody.innerHTML = rows.map(r => {
      let typeBadge = '';
      if (r.monitor_type === 'TECHNICAL_HAN') {
        typeBadge = `<span style="background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); color: #c084fc; font-size: 0.72rem; padding: 2px 4px; border-radius: 4px; font-weight: 600; white-space: nowrap;">Kỹ thuật HAN</span>`;
      } else if (r.monitor_type === 'INTL_TO_DOMESTIC') {
        typeBadge = `<span style="background: rgba(251, 146, 60, 0.15); border: 1px solid rgba(251, 146, 60, 0.3); color: #fb923c; font-size: 0.72rem; padding: 2px 4px; border-radius: 4px; font-weight: 600; white-space: nowrap;">Q.tế ➔ N.địa</span>`;
      } else {
        typeBadge = `<span style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8; font-size: 0.72rem; padding: 2px 4px; border-radius: 4px; font-weight: 600; white-space: nowrap;">N.địa ➔ Q.tế</span>`;
      }

      const isResolved = r.is_warned === 2;
      const rowClass = isResolved ? 'row-resolved' : '';
      
      // Chấm LED xanh lá cây nhấp nháy báo trạng thái đang theo dõi
      const ledDot = isResolved 
        ? `<span style="display:inline-block; width:8px; height:8px; margin-right:6px; vertical-align:middle;"></span>`
        : `<span class="pulse-dot-green" title="Đang theo dõi realtime"></span>`;

      // Nút trạng thái dạng Pill Switch
      const pendingClass = isResolved ? 'status-pill-inactive' : 'status-pill-pending active';
      const successClass = isResolved ? 'status-pill-success active' : 'status-pill-inactive';
      
      const pendingClick = isResolved ? `onclick="confirmTempImportExport(${r.id}, 'pending')"` : '';
      const successClick = isResolved ? '' : `onclick="confirmTempImportExport(${r.id}, 'confirm')"`;

      const statusHtml = `
        <div style="display: flex; align-items: center; gap: 6px; justify-content: center;">
          <button class="status-pill-btn ${pendingClass}" ${pendingClick} style="outline:none;">
            <i class="fa-solid fa-hourglass-half"></i> Chờ xử lý
          </button>
          <button class="status-pill-btn ${successClass}" ${successClick} style="outline:none;">
            <i class="fa-solid fa-circle-check"></i> Đã xử lý
          </button>
        </div>
      `;

      const actionHtml = `<button onclick="confirmTempImportExport(${r.id}, 'delete')" style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); color: #f87171; font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; cursor: pointer; transition: all 0.2s;">Xóa</button>`;
      
      const nextCol = r.new_flight_no 
        ? `<span style="color: #fb923c; font-weight: bold;">✈️ ${r.new_flight_no}</span><br><span style="color: var(--text-muted); font-size: 0.72rem;">(${r.new_route})</span>` 
        : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.75rem;">Chưa phát hiện</span>`;

      const oldFuelVal = parseInt(r.fuel_order) || 0;

      return `
        <tr class="${rowClass}" style="border-bottom: 1px solid rgba(255,255,255,0.05); transition: all 0.2s;">
          <td style="padding: 10px 4px; font-weight: bold; color: #fff; vertical-align: middle;">
            <div style="display: flex; align-items: center; justify-content: flex-start;">
              ${ledDot} <span style="font-size: 0.85rem;">${r.ac_reg}</span>
            </div>
          </td>
          <td style="padding: 10px 4px; vertical-align: middle;">${typeBadge}</td>
          <td style="padding: 10px 4px; vertical-align: middle;">
            <span style="font-weight: 600; color: #38bdf8;">${r.old_flight_no}</span><br>
            <span style="color: var(--text-muted); font-size: 0.72rem;">${r.old_route} (${oldFuelVal.toLocaleString()} kg)</span>
          </td>
          <td style="padding: 10px 4px; vertical-align: middle;">${nextCol}</td>
          <td style="padding: 10px 4px; text-align: center; vertical-align: middle;">
            <div style="display: flex; flex-direction: column; gap: 6px; align-items: center;">
              ${statusHtml}
              ${actionHtml}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('[Frontend Tạm nhập] Lỗi tải dữ liệu:', err.message);
  }
}
window.fetchTempImportExportData = fetchTempImportExportData;

// Xác nhận hoàn thành xử lý hóa đơn hoặc xóa theo dõi
async function confirmTempImportExport(id, action) {
  let confirmMsg = '';
  if (action === 'confirm') {
    confirmMsg = 'Khầy có chắc chắn đã xử lý hóa đơn Tạm nhập - Tái xuất cho tàu bay này?';
  } else if (action === 'pending') {
    confirmMsg = 'Khầy muốn khôi phục tàu bay này về trạng thái Chờ xử lý để tiếp tục theo dõi?';
  } else {
    confirmMsg = 'Khầy có chắc chắn muốn xóa theo dõi cho tàu bay này?';
  }
    
  if (!confirm(confirmMsg)) return;
  
  try {
    const res = await fetch('/api/fms/temp-import-exports/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ id, action })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success', 'Thành công');
      fetchTempImportExportData();
    } else {
      showToast(data.error, 'error', 'Thất bại');
    }
  } catch (e) {
    showToast('Lỗi kết nối server: ' + e.message, 'error', 'Lỗi kết nối');
  }
}
window.confirmTempImportExport = confirmTempImportExport;

// Gửi thử kịch bản giả lập test chéo Zalo
async function runZaloIeTest(scNum) {
  try {
    const res = await fetch('/api/fms/temp-import-exports/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ scenario: scNum })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success', 'Thành công');
      fetchTempImportExportData();
    } else {
      showToast(data.error, 'error', 'Thất bại');
    }
  } catch (err) {
    showToast('Lỗi kết nối gửi test: ' + err.message, 'error', 'Lỗi kết nối');
  }
}
window.runZaloIeTest = runZaloIeTest;

/**
 * Đã tra nạp = có kg nạp thực tế từ Skypec Flights (> 0), đúng chuyến + đúng ngày lịch.
 * Không dùng status text "Đã có số liệu" (thường gán nhầm khi 0 kg).
 */
function isFlightRefueled(r) {
  if (!r) return false;
  if (Number(r.is_refueled) === 1) return true;
  const skypecKg = parseInt(String(r.skypec_fuel_order || '').replace(/[^\d]/g, ''), 10) || 0;
  return skypecKg > 0;
}

/** Chuẩn hóa tên để so/gộp (bỏ dấu, hoa) */
function normalizePersonName(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCrewPerson(name) {
  const s = String(name || '').trim();
  if (!s || s === '-' || s === '---' || /^NAFSC$/i.test(s)) return '';
  return s;
}

/**
 * Tách Lái xe / NV tra nạp từ bản ghi lịch (không gộp chung 1 chuỗi mơ hồ).
 * Ưu tiên driver_name + operator_name; fallback tách crew_info "A - B".
 */
function parseCrewRoles(r) {
  let driver = cleanCrewPerson(r && r.driver_name);
  let operator = cleanCrewPerson(r && r.operator_name);
  if ((!driver || !operator) && r && r.crew_info && r.crew_info !== '-') {
    const parts = String(r.crew_info).split(/\s+-\s+/).map(p => cleanCrewPerson(p));
    if (!driver && parts[0]) driver = parts[0];
    if (!operator && parts[1]) operator = parts[1];
  }
  return { driver, operator };
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Gom danh sách người từ lịch — 1 entry / 1 người (merge role Lái+NV nếu cùng tên).
 * Không gộp Lái với NV khác người.
 */
function collectPeopleFromRows(rows) {
  const peopleMap = {};
  (rows || []).forEach(r => {
    const { driver, operator } = parseCrewRoles(r);
    const date = (r && r.date) || '';
    const nType = (r && r.notify_type) || 1;
    const addPerson = (name, role) => {
      if (!name) return;
      const key = normalizePersonName(name);
      if (!key) return;
      if (!peopleMap[key]) {
        peopleMap[key] = {
          key,
          name,
          roles: new Set(),
          notifyType: nType,
          date
        };
      }
      peopleMap[key].roles.add(role);
      if (nType) peopleMap[key].notifyType = nType;
      if (date && !peopleMap[key].date) peopleMap[key].date = date;
    };
    addPerson(driver, 'Lái');
    addPerson(operator, 'NV');
  });
  return Object.values(peopleMap).sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

function personRoleMeta(rolesSet) {
  const roles = rolesSet instanceof Set ? [...rolesSet] : (rolesSet || []);
  const hasLai = roles.includes('Lái');
  const hasNv = roles.includes('NV');
  if (hasLai && hasNv) return { label: 'Lái+NV', cls: 'is-both' };
  if (hasLai) return { label: 'Lái', cls: 'is-lai' };
  return { label: 'NV', cls: 'is-nv' };
}

/** Map schedule_name -> zalo_uid từ state */
function getZaloMapDb() {
  const mapDb = {};
  (state.zaloMappings || []).forEach(m => {
    if (m && m.schedule_name) {
      mapDb[String(m.schedule_name).toUpperCase().trim()] = m.zalo_uid;
    }
  });
  return mapDb;
}

/** Tìm zalo uid: DB mapping trước, rồi khớp displayName Zalo (soft) */
function resolveZaloUidForPerson(personName, mapDb) {
  const key = String(personName || '').toUpperCase().trim();
  if (!key) return '';
  if (mapDb && mapDb[key]) return mapDb[key];
  const norm = normalizePersonName(personName);
  const members = state.zaloMembers || [];
  // khớp exact displayName
  let hit = members.find(m => normalizePersonName(m.displayName) === norm);
  if (hit) return hit.uid;
  // khớp chứa (tên không dấu chứa nhau)
  hit = members.find(m => {
    const dn = normalizePersonName(m.displayName);
    return dn && norm && (dn.includes(norm) || norm.includes(dn));
  });
  return hit ? hit.uid : '';
}

function buildZaloMemberOptionsHtml(selectedUid) {
  let html = '<option value="">— Chưa map —</option>';
  (state.zaloMembers || []).forEach(mem => {
    const sel = mem.uid === selectedUid ? 'selected' : '';
    html += `<option value="${escapeHtml(mem.uid)}" ${sel}>${escapeHtml(mem.displayName)}</option>`;
  });
  return html;
}

/**
 * HTML 1 dòng người: Vai | Tên | Zalo | Báo tin
 * rowClass: class trên <tr> (zalo-mapping-row / fms-person-row)
 */
function buildPersonZaloRowHtml(p, opts = {}) {
  const mapDb = opts.mapDb || getZaloMapDb();
  const currentSel = opts.currentSelections || {};
  const role = personRoleMeta(p.roles);
  const nameKey = (p.name || '').toUpperCase();
  let savedUid = '';
  if (currentSel[nameKey] !== undefined) {
    savedUid = currentSel[nameKey];
  } else {
    savedUid = resolveZaloUidForPerson(p.name, mapDb);
  }
  const mapped = !!savedUid;
  const notifyVal = currentSel[`notify::${nameKey}`] !== undefined
    ? currentSel[`notify::${nameKey}`]
    : (p.notifyType || 1);

  return `
    <tr class="zalo-person-row zalo-mapping-row" data-name="${escapeHtml(p.name)}" data-person="${escapeHtml(p.name)}" data-date="${escapeHtml(p.date || '')}" data-key="${escapeHtml(p.key || nameKey)}">
      <td><span class="zalo-role-pill ${role.cls}">${role.label}</span></td>
      <td class="zalo-name-cell" title="${escapeHtml(p.name)}">
        <span class="zalo-map-dot ${mapped ? 'on' : 'off'}" title="${mapped ? 'Đã map' : 'Chưa map'}"></span>${escapeHtml(p.name)}
      </td>
      <td>
        <select class="zalo-member-select fms-zalo-map-select ${mapped ? 'is-mapped' : 'is-unmapped'}"
          data-person="${escapeHtml(p.name)}" data-original-uid="${escapeHtml(savedUid)}">
          ${buildZaloMemberOptionsHtml(savedUid)}
        </select>
      </td>
      <td>
        <select class="fms-crew-notify-select crew-notify-select" data-person="${escapeHtml(p.name)}" data-date="${escapeHtml(p.date || '')}" data-original-val="${notifyVal}">
          <option value="1" ${notifyVal == 1 ? 'selected' : ''}>Tag nhóm</option>
          <option value="2" ${notifyVal == 2 ? 'selected' : ''}>Inbox</option>
          <option value="3" ${notifyVal == 3 ? 'selected' : ''}>Cả hai</option>
        </select>
      </td>
    </tr>`;
}

/** HTML cột nhân viên: Lái xe / NV tra nạp / Xe (tên đầy đủ) */
function formatCrewCellHtml(r) {
  const { driver, operator } = parseCrewRoles(r);
  const truck = r && r.truck_no && String(r.truck_no).trim() && r.truck_no !== '-'
    ? String(r.truck_no).trim()
    : '';
  if (!driver && !operator && !truck) {
    return '<span style="color:var(--text-muted);">-</span>';
  }
  let html = '<div style="line-height:1.45;font-size:0.84rem;text-align:left;">';
  if (driver) {
    html += `<div><span style="color:var(--text-muted);font-size:0.7rem;font-weight:600;">Lái xe</span><br><strong style="color:#c2410c;">${escapeHtml(driver)}</strong></div>`;
  }
  if (operator) {
    html += `<div style="margin-top:3px;"><span style="color:var(--text-muted);font-size:0.7rem;font-weight:600;">NV tra nạp</span><br><strong style="color:#0369a1;">${escapeHtml(operator)}</strong></div>`;
  }
  if (!driver && !operator) {
    html += `<div style="color:var(--text-muted);">Chưa gán NV</div>`;
  }
  if (truck) {
    html += `<div style="margin-top:4px;color:var(--primary);font-weight:700;font-size:0.8rem;"><i class="fa-solid fa-truck-field"></i> ${escapeHtml(truck)}</div>`;
  }
  html += '</div>';
  return html;
}

/** Nhãn ngắn cho badge Zalo / filter */
function formatCrewPairLabel(r) {
  const { driver, operator } = parseCrewRoles(r);
  if (driver && operator) return `Lái: ${driver} · NV: ${operator}`;
  if (driver) return `Lái: ${driver}`;
  if (operator) return `NV: ${operator}`;
  return r.crew_info && r.crew_info !== '-' ? r.crew_info : '-';
}

function getRefuelStatusMeta(r) {
  const done = isFlightRefueled(r);
  const kg = parseInt(String(r.skypec_fuel_order || '').replace(/[^\d]/g, ''), 10) || 0;
  return {
    done,
    statusClass: done ? 'status-refueled' : 'status-not-refueled',
    statusText: done ? 'Đã tra nạp' : 'Chưa tra nạp',
    title: done
      ? `Đã tra nạp trên Skypec Flights${kg > 0 ? ` · ${kg.toLocaleString()} kg` : ''}`
      : 'Chưa có số liệu tra nạp trên Skypec Flights'
  };
}

// Thực hiện lọc và vẽ lại bảng FMS
function renderFmsTable() {
  const tbody = document.getElementById('fms-table-body');
  if (!tbody) return;

  // Zalo: 1 dòng / 1 người — map Zalo + báo tin (Lái và NV tách, không card)
  const crewContainer = document.getElementById('fms-crew-notify-settings-container');
  if (crewContainer) {
    const people = collectPeopleFromRows(cachedFmsRows);
    if (people.length > 0) {
      // Lazy load members/mappings nếu chưa có (không chặn render lần đầu)
      if ((!state.zaloMembers || state.zaloMembers.length === 0) && state.token && !window.__zaloLoadInflight) {
        window.__zaloLoadInflight = true;
        loadZaloMembersAndMappings().finally(() => {
          window.__zaloLoadInflight = false;
          renderFmsTable();
        });
      }
      const mapDb = getZaloMapDb();
      const mappedCount = people.filter(p => resolveZaloUidForPerson(p.name, mapDb)).length;
      crewContainer.innerHTML = `
        <div class="zalo-person-dense-head">
          <span class="zalo-person-dense-title">
            <i class="fa-solid fa-user-tag"></i> Map Zalo từng người
            <span style="font-weight:500;color:var(--text-muted);font-size:0.68rem;">(${mappedCount}/${people.length} đã map)</span>
          </span>
          <span class="zalo-person-dense-hint">Lái xe · NV tra nạp tách dòng · gọn</span>
        </div>
        <div class="zalo-person-dense-scroll">
          <table class="zalo-person-dense-table">
            <thead>
              <tr>
                <th style="width:48px;">Vai</th>
                <th>Họ tên</th>
                <th style="width:38%;">Tài khoản Zalo</th>
                <th style="width:96px;">Báo tin</th>
              </tr>
            </thead>
            <tbody>
              ${people.map(p => buildPersonZaloRowHtml(p, { mapDb })).join('')}
            </tbody>
          </table>
        </div>
      `;
      crewContainer.style.display = 'block';
      crewContainer.classList.add('zalo-person-dense-wrap');
    } else {
      crewContainer.innerHTML = '';
      crewContainer.style.display = 'none';
    }
  }

  const searchInput = document.getElementById('fms-search-input');
  const crewSelect = document.getElementById('fms-crew-filter');

  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const selectedPerson = crewSelect ? crewSelect.value : '';
  const selectedNorm = selectedPerson ? normalizePersonName(selectedPerson) : '';

  // Lọc dữ liệu (search + crew) — ca tách sau
  const filteredRows = cachedFmsRows.filter(r => {
    // 1. Lọc theo 1 người (Lái hoặc NV)
    if (selectedNorm) {
      const { driver, operator } = parseCrewRoles(r);
      const hit =
        normalizePersonName(driver) === selectedNorm ||
        normalizePersonName(operator) === selectedNorm ||
        normalizePersonName(r.crew_info).includes(selectedNorm);
      if (!hit) return false;
    }

    // 2. Lọc theo tìm kiếm nhanh
    if (query) {
      const fltNo = r.flight_no ? r.flight_no.toLowerCase() : '';
      const acReg = r.ac_reg ? r.ac_reg.toLowerCase() : '';
      const { driver, operator } = parseCrewRoles(r);
      const crewBlob = `${driver} ${operator} ${r.crew_info || ''}`.toLowerCase();
      return fltNo.includes(query) || acReg.includes(query) || crewBlob.includes(query);
    }

    return true;
  });

  const { inShift, outShift, view: shiftView } = splitRowsByViewShift(filteredRows, 'admin');
  updateFmsShiftBadge('admin', inShift.length, outShift.length);

  if (filteredRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Không tìm thấy chuyến bay nào khớp với điều kiện lọc.
        </td>
      </tr>
    `;
    return;
  }

  if (shiftView.effective !== 'all' && inShift.length === 0 && outShift.length > 0) {
    // Chỉ có ngoài ca — vẫn hiện toggle + gợi ý
  } else if (inShift.length === 0 && outShift.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Không có chuyến trong bộ lọc hiện tại.
        </td>
      </tr>
    `;
    return;
  }

  const outOpen = isOutShiftExpanded('admin');
  const otherLabel = shiftView.effective === 'day' ? 'Ca tối (19:30–07:29)' : 'Ca ngày (07:30–19:29)';
  const mapRow = (r, isOut) => {
    const refuelMeta = getRefuelStatusMeta(r);
    const refueled = refuelMeta.done;
    const statusClass = refuelMeta.statusClass;
    const statusText = refuelMeta.statusText;
    
    const tripVal = parseInt(r.trip_fuel) > 0 ? `${parseInt(r.trip_fuel).toLocaleString()} kg` : '-';
    const crewHtml = formatCrewCellHtml(r);

    
    // 1. Tính toán hiệu ứng nhấp nháy cảnh báo (hết hạn nhấp nháy sau giờ tra nạp 15 phút)
    let blinkAcReg = false;
    let blinkStandby = false;
    let blinkFuelOrder = false;
    let blinkEtd = false;

    const now = new Date();
    if (r.time_fuel && r.time_fuel !== '-' && r.date) {
      try {
        const [hour, minute] = r.time_fuel.split(':').map(Number);
        const fuelTime = new Date(r.date);
        fuelTime.setHours(hour, minute, 0, 0);
        
        const limitTime = new Date(fuelTime.getTime() + 15 * 60 * 1000); // Quá giờ nạp 15p
        const isExpired = now > limitTime;
        
        if (!isExpired) {
          blinkAcReg = r.warn_ac_reg === 1;
          blinkStandby = r.warn_standby === 1;
          blinkFuelOrder = r.warn_fuel_order === 1;
          blinkEtd = r.warn_etd === 1;
        }
      } catch (e) {
        console.error('[Blink] Lỗi parse time:', e.message);
      }
    }

    const acRegClass = blinkAcReg ? 'blink-red-text' : '';
    const standbyClass = blinkStandby ? 'blink-orange-text' : '';
    const fuelOrderClass = blinkFuelOrder ? 'blink-orange-text' : '';
    const etdClass = blinkEtd ? 'blink-red-text' : '';

    const acRegTdClass = blinkAcReg ? 'blink-red-bg' : '';
    const standbyTdClass = blinkStandby ? 'blink-orange-bg' : '';
    const fuelOrderTdClass = blinkFuelOrder ? 'blink-orange-bg' : '';
    const etdTdClass = blinkEtd ? 'blink-red-bg' : '';

    // Trực quan hóa chi tiết thay đổi (Cũ và Mới) cho số hiệu máy bay
    let planeInfo = '';
    if (blinkAcReg && r.old_ac_reg) {
      planeInfo = `
        <div style="font-size: 0.78rem; text-align: left; line-height: 1.35; padding: 4px; border-radius: 4px; background: rgba(185, 28, 28, 0.08); border: 1px solid rgba(185, 28, 28, 0.22);">
          <div style="color: #475569; font-weight: 500;">Cũ: <span style="text-decoration: line-through;">${r.old_ac_reg}</span></div>
          <div style="color: #b91c1c; font-weight: bold; margin-top: 1px;" class="${acRegClass}">Mới: ${r.ac_reg || '-'}</div>
          ${r.ac_type ? `<span style="color: var(--text-muted); font-size: 0.72rem; display: block; margin-top: 2px;">Loại: ${r.ac_type}</span>` : ''}
          ${r.route ? `<span style="color: var(--primary); font-size: 0.72rem; display: block; margin-top: 2px; font-weight: bold;"><i class="fa-solid fa-route"></i> ${r.route}</span>` : ''}
        </div>
      `;
    } else {
      planeInfo = `
        ${r.ac_reg ? `<span style="background: var(--chip-bg); border: 1px solid var(--border); color: var(--text); padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; font-weight: 600;" class="${acRegClass}">${r.ac_reg}</span>` : '-'}
        ${r.ac_type ? `<span style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-top: 3px;">Loại: ${r.ac_type}</span>` : ''}
        ${r.route ? `<span style="color: var(--primary); font-size: 0.8rem; display: block; margin-top: 3px; font-weight: bold;"><i class="fa-solid fa-route"></i> ${r.route}</span>` : ''}
      `;
    }

    // Trực quan hóa chi tiết thay đổi (Cũ và Mới) cho standby fuel
    let standbyHtml = '';
    if (blinkStandby && r.old_standby_fuel) {
      standbyHtml = `
        <div style="font-size: 0.78rem; text-align: center; line-height: 1.35; padding: 4px; border-radius: 4px; background: rgba(194, 65, 12, 0.08); border: 1px solid rgba(194, 65, 12, 0.22);">
          <div style="color: #475569; font-size: 0.72rem;">Cũ: ${parseInt(r.old_standby_fuel) > 0 ? parseInt(r.old_standby_fuel).toLocaleString() + ' kg' : '-'}</div>
          <div style="color: #c2410c; font-weight: bold; margin-top: 1px;" class="${standbyClass}">Mới: ${parseInt(r.standby_fuel) > 0 ? parseInt(r.standby_fuel).toLocaleString() + ' kg' : '-'}</div>
        </div>
      `;
    } else {
      standbyHtml = parseInt(r.standby_fuel) > 0 ? `${parseInt(r.standby_fuel).toLocaleString()} kg` : '-';
    }

    // Trực quan hóa chi tiết thay đổi (Cũ và Mới) cho fuel order chính thức
    let orderHtml = '';
    if (blinkFuelOrder && r.old_fuel_order) {
      orderHtml = `
        <div style="font-size: 0.78rem; text-align: center; line-height: 1.35; padding: 4px; border-radius: 4px; background: rgba(194, 65, 12, 0.08); border: 1px solid rgba(194, 65, 12, 0.22);">
          <div style="color: #475569; font-size: 0.72rem;">Cũ: ${parseInt(r.old_fuel_order) > 0 ? parseInt(r.old_fuel_order).toLocaleString() + ' kg' : '-'}</div>
          <div style="color: #c2410c; font-weight: bold; margin-top: 1px;" class="${fuelOrderClass}">Mới: ${parseInt(r.fuel_order) > 0 ? parseInt(r.fuel_order).toLocaleString() + ' kg' : '-'}</div>
        </div>
      `;
    } else {
      orderHtml = parseInt(r.fuel_order) > 0 ? `${parseInt(r.fuel_order).toLocaleString()} kg` : '-';
    }
    
    // Trực quan hóa chi tiết thay đổi (Cũ và Mới) cho Giờ bay (cột Cất)
    let depTimeHtml = '';
    if (blinkEtd && r.old_etd) {
      depTimeHtml = `
        <div style="font-size: 0.76rem; padding: 2px 4px; border-radius: 4px; background: rgba(185, 28, 28, 0.08); border: 1px solid rgba(185, 28, 28, 0.22); display: inline-block; line-height: 1.3;">
          <div style="color: #475569; text-decoration: line-through;">Cũ: ${r.old_etd}</div>
          <div style="color: #b91c1c; font-weight: bold; margin-top: 1px;" class="${etdClass}">Mới: ${r.etd || '-'}</div>
        </div>
      `;
    } else {
      const displayEtd = r.etd || r.time_dep || '-';
      depTimeHtml = `<span>${displayEtd}</span>`;
    }

    const timesHtml = `
      <div style="font-size: 0.8rem; text-align: left; line-height: 1.4;">
        ${r.time_arr ? `<div>Hạ: <span>${r.time_arr}</span></div>` : ''}
        <div>Cất: ${depTimeHtml}</div>
        ${r.time_fuel ? `<div style="margin-top: 2px; border-top: 1px dashed var(--border); padding-top: 2px;">Nạp: <strong style="color: #c2410c; font-size: 0.88rem;">${r.time_fuel}</strong></div>` : ''}
      </div>
    `;
    
    const canEditGate = state.role === 'admin' || state.permissions?.perm_admin === 1 || state.permissions?.perm_gate === 1;
    const gateHtml = canEditGate
      ? `<span class="editable-gate" data-flight="${r.flight_no}" data-date="${r.date || ''}" title="Click để sửa vị trí đỗ" style="cursor: pointer; display: inline-block; padding: 2px 8px; border: 1px dashed rgba(0, 114, 151, 0.4); background: rgba(0, 114, 151, 0.03); border-radius: 4px; min-width: 35px; transition: all 0.2s;">${r.gate || '-'}</span>`
      : `${r.gate || '-'}`;

    const rowCls = [refueled ? 'row-refueled' : '', isOut ? 'fms-out-shift-row' : ''].filter(Boolean).join(' ');
    return `
      <tr class="${rowCls}">
        <td style="font-weight: 700; color: var(--primary); font-size: 1rem;">${r.flight_no}</td>
        <td>${crewHtml}</td>
        <td style="text-align: center;" class="${acRegTdClass}">${planeInfo}</td>
        <td style="text-align: center; font-weight: 700; color: #b45309; font-size: 1rem;">${gateHtml}</td>
        <td class="${etdTdClass}">${timesHtml}</td>
        <td style="text-align: center; font-weight: 700; color: #15803d; transition: all 0.3s;" class="${standbyTdClass} ${standbyClass}">${standbyHtml}</td>
        <td style="text-align: center; font-weight: 800; color: #c2410c; transition: all 0.3s;" class="${fuelOrderTdClass} ${fuelOrderClass}">${orderHtml}</td>
        <td style="text-align: center; font-weight: 700; color: #1d4ed8;" class="hide-on-mobile">${tripVal}</td>
        <td style="text-align: center;">
          <span class="status-tag ${statusClass}" title="${refuelMeta.title}">
            <i class="fa-solid ${refueled ? 'fa-circle-check' : 'fa-clock'}" style="margin-right:3px;"></i>${statusText}
          </span>
        </td>
      </tr>
    `;
  };

  let html = '';
  if (shiftView.effective === 'all') {
    html = inShift.map(r => mapRow(r, false)).join('');
  } else {
    if (inShift.length > 0) {
      html += buildInShiftSectionRow(shiftView.label, inShift.length, shiftView.window);
      html += inShift.map(r => mapRow(r, false)).join('');
    } else {
      html += `
        <tr>
          <td colspan="9" style="text-align:center;color:var(--text-muted);padding:16px;font-size:0.85rem;">
            Không có chuyến trong <strong>${escapeHtml(shiftView.label)}</strong> (${escapeHtml(shiftView.window)}).
          </td>
        </tr>`;
    }
    if (outShift.length > 0) {
      html += buildOutShiftToggleRow('admin', outShift.length, otherLabel, outOpen);
      if (outOpen) {
        html += outShift.map(r => mapRow(r, true)).join('');
      }
    }
  }
  tbody.innerHTML = html;
}

// Lọc và vẽ bảng FMS ở màn hình nhân viên (chỉ xem)
let cachedUserFmsRows = [];
async function loadUserFmsSchedules(isSilent = false) {
  try {
    applySmartFmsDefaults('user');
    const filterInput = document.getElementById('user-fms-filter-date');
    const selectedDate = filterInput ? filterInput.value : '';
    const unit = window.userFmsUnitFilter || 'SKYPEC';

    const res = await fetch(`/api/fms/schedules?date=${encodeURIComponent(selectedDate)}&unit=${encodeURIComponent(unit)}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error);
    }

    const rows = data.data || [];
    cachedUserFmsRows = rows;
    updateUserFmsCrewFilter(rows);
    renderUserFmsTable();
  } catch (err) {
    console.error('Lỗi tải danh sách FMS nhân viên:', err.message);
  }
}

async function handleFlightsScheduleSync(action) {
  const logEl = document.getElementById('fms-flights-sync-log');
  const dateEl = document.getElementById('fms-schedule-date') || document.getElementById('fms-filter-date');
  const shiftEl = document.getElementById('fms-filter-shift');
  const date = dateEl && dateEl.value ? dateEl.value : '';
  const shiftRaw = shiftEl && shiftEl.value ? shiftEl.value : 'day';
  const shift = (shiftRaw === 'evening' || shiftRaw === 'night')
    ? 'evening'
    : (shiftRaw === 'all' ? 'all' : 'day');
  if (!date) {
    showToast('Chọn ngày trực trước', 'error', 'Thiếu ngày');
    return;
  }
  if (logEl) logEl.textContent = action === 'preview' ? 'Đang xem trước từ Flights...' : 'Đang đồng bộ merge từ Flights...';
  try {
    const url = action === 'preview'
      ? '/api/fms/schedule/from-flights/preview'
      : '/api/fms/schedule/from-flights/apply';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ date, shift, mode: 'merge' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Thất bại');
    if (logEl) {
      const sample = (data.data || data.candidates || []).slice(0, 8).map(f =>
        `${f.flight_no} ${f.time_fuel || f.time_dep || ''} ${f.crew_info || ''}`
      ).join('\n');
      logEl.textContent = `${data.message || 'OK'}\n${sample}${sample ? '\n…' : ''}`;
    }
    showToast(data.message || 'OK', 'success', action === 'preview' ? 'Preview' : 'Đồng bộ lịch');
    if (action === 'apply') loadFmsSchedules(false);
  } catch (err) {
    if (logEl) logEl.textContent = 'Lỗi: ' + err.message;
    showToast(err.message, 'error', 'Flights sync');
  }
}

function renderUserFmsTable() {
  const searchInput = document.getElementById('user-fms-search-input');
  const crewSelect = document.getElementById('user-fms-crew-filter');
  const query = searchInput ? searchInput.value.trim().toUpperCase() : '';
  const selectedCrew = crewSelect ? crewSelect.value : '';
  const tbody = document.getElementById('user-fms-table-body');
  
  if (!tbody) return;

  const selectedNorm = selectedCrew ? normalizePersonName(selectedCrew) : '';
  const filteredRows = cachedUserFmsRows.filter(r => {
    // 1. Lọc theo 1 người (Lái hoặc NV)
    if (selectedNorm) {
      const { driver, operator } = parseCrewRoles(r);
      const hit =
        normalizePersonName(driver) === selectedNorm ||
        normalizePersonName(operator) === selectedNorm ||
        normalizePersonName(r.crew_info).includes(selectedNorm);
      if (!hit) return false;
    }

    // 2. Lọc tìm kiếm nhanh
    if (query) {
      const flightNo = (r.flight_no || '').toUpperCase();
      const acReg = (r.ac_reg || '').toUpperCase();
      const { driver, operator } = parseCrewRoles(r);
      const crewBlob = `${driver} ${operator} ${r.crew_info || ''}`.toUpperCase();
      const route = (r.route || '').toUpperCase();
      return flightNo.includes(query) || acReg.includes(query) || crewBlob.includes(query) || route.includes(query);
    }
    return true;
  });

  const { inShift, outShift, view: shiftView } = splitRowsByViewShift(filteredRows, 'user');
  updateFmsShiftBadge('user', inShift.length, outShift.length);

  if (filteredRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Không tìm thấy chuyến bay nào khớp với điều kiện lọc.
        </td>
      </tr>
    `;
    return;
  }

  const outOpen = isOutShiftExpanded('user');
  const otherLabel = shiftView.effective === 'day' ? 'Ca tối (19:30–07:29)' : 'Ca ngày (07:30–19:29)';

  const mapRow = (r, isOut) => {
    const refuelMeta = getRefuelStatusMeta(r);
    const refueled = refuelMeta.done;
    const rowCls = [refueled ? 'row-refueled' : '', isOut ? 'fms-out-shift-row' : ''].filter(Boolean).join(' ');

    return `
      <tr class="${rowCls}">
        <td style="font-weight: 700; color: var(--primary); font-size: 1rem;">${r.flight_no}</td>
        <td>${formatCrewCellHtml(r)}</td>
        <td style="text-align: center;">
          <span style="font-weight: bold; color: var(--text);">${r.ac_reg || '-'}</span>
          <span style="color: var(--text-muted); font-size: 0.8em;"> (${r.ac_type || '-'})</span>
          <br>
          <span style="color: #007297; font-size: 0.85em; font-weight: bold;">${r.route || '-'}</span>
        </td>
        <td style="text-align: center; font-weight: 700; color: #b45309; font-size: 1rem;">${r.gate || '-'}</td>
        <td>
          <div style="font-size: 0.8rem; text-align: left; line-height: 1.4;">
            ${r.time_arr ? `<div>Hạ: <span>${r.time_arr}</span></div>` : ''}
            ${r.time_dep ? `<div>Cất: <span>${r.time_dep}</span></div>` : ''}
            ${r.time_fuel ? `<div style="margin-top: 2px; border-top: 1px dashed var(--border); padding-top: 2px;">Nạp: <strong style="color: #c2410c; font-size: 0.88rem;">${r.time_fuel}</strong></div>` : ''}
          </div>
        </td>
        <td style="text-align: center; font-weight: 700; color: #15803d;">${r.standby_fuel ? parseInt(r.standby_fuel).toLocaleString() + ' kg' : '-'}</td>
        <td style="text-align: center; font-weight: 800; color: #c2410c; font-size: 1.05rem;">${r.fuel_order ? parseInt(r.fuel_order).toLocaleString() + ' kg' : '-'}</td>
        <td style="text-align: center; color: #1d4ed8; font-weight: 700;" class="hide-on-mobile">${r.trip_fuel ? parseInt(r.trip_fuel).toLocaleString() + ' kg' : '-'}</td>
        <td style="text-align: center;">
          <span class="status-tag ${refuelMeta.statusClass}" title="${refuelMeta.title}">
            <i class="fa-solid ${refueled ? 'fa-circle-check' : 'fa-clock'}" style="margin-right:3px;"></i>${refuelMeta.statusText}
          </span>
        </td>
      </tr>
    `;
  };

  let html = '';
  if (shiftView.effective === 'all') {
    html = inShift.map(r => mapRow(r, false)).join('');
  } else {
    if (inShift.length > 0) {
      html += buildInShiftSectionRow(shiftView.label, inShift.length, shiftView.window);
      html += inShift.map(r => mapRow(r, false)).join('');
    } else {
      html += `
        <tr>
          <td colspan="9" style="text-align:center;color:var(--text-muted);padding:16px;font-size:0.85rem;">
            Không có chuyến trong <strong>${escapeHtml(shiftView.label)}</strong> (${escapeHtml(shiftView.window)}).
          </td>
        </tr>`;
    }
    if (outShift.length > 0) {
      html += buildOutShiftToggleRow('user', outShift.length, otherLabel, outOpen);
      if (outOpen) {
        html += outShift.map(r => mapRow(r, true)).join('');
      }
    }
  }
  tbody.innerHTML = html;
}

async function handleSaveFmsSchedule() {
  const textarea = document.getElementById('fms-schedule-input');
  const btn = document.getElementById('btn-fms-save-schedule');
  const scheduleText = textarea.value.trim();

  if (!scheduleText) {
    showToast('Vui lòng nhập nội dung lịch bay!', 'error', 'Lưu thất bại');
    return;
  }

  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang lưu...';

  try {
    const res = await fetch('/api/fms/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ scheduleText })
    });
    
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success', 'Thành công');
      loadFmsSchedules();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast(err.message, 'error', 'Lỗi lưu lịch');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

async function handleSyncFmsNow() {
  const btn = document.getElementById('btn-fms-sync-now');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang gửi yêu cầu...';

  try {
    const dateInput = document.getElementById('fms-schedule-date');
    const shiftSelect = document.getElementById('fms-filter-shift');
    const selectedDate = dateInput ? dateInput.value : '';
    const selectedShift = shiftSelect ? shiftSelect.value : 'all';

    const res = await fetch('/api/fms/sync', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        date: selectedDate,
        shift: selectedShift
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đang yêu cầu VPS quét dữ liệu FMS, bảng số liệu sẽ tự động cập nhật sau ít phút!', 'success', 'Yêu cầu thành công');
      
      // Đợi 4 giây rồi cập nhật lại bảng
      setTimeout(() => {
        loadFmsSchedules(true);
      }, 4000);
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast(err.message, 'error', 'Yêu cầu thất bại');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// Xử lý chọn và đọc file Excel
function handleExcelFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      parseFmsExcel(json);
    } catch (err) {
      showToast('Không thể đọc file Excel: ' + err.message, 'error', 'Lỗi định dạng');
    }
  };
  reader.readAsArrayBuffer(file);
}

// Hàm chuyển đổi định dạng giờ Excel (số thập phân) sang HH:MM
function formatExcelTime(val) {
  if (val === undefined || val === null || String(val).trim() === '') return '';
  const strVal = String(val).trim();
  
  if (strVal.includes(':')) {
    return strVal;
  }
  
  if (/^\d+(\.\d+)?$/.test(strVal)) {
    const num = parseFloat(strVal);
    if (!isNaN(num)) {
      const decimalPart = num % 1;
      const totalSeconds = Math.round(decimalPart * 24 * 60 * 60);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }
  return strVal;
}

// ─── Ca trực FMS: day 07:30–19:29 · evening 19:30–07:29 ─────────────
const FMS_SHIFT_STORAGE = {
  view: (scope) => `skyeyes_fms_view_shift_${scope || 'admin'}`,
  dateManual: (scope) => `skyeyes_fms_date_manual_${scope || 'admin'}`,
  outOpen: (scope) => `skyeyes_fms_out_open_${scope || 'admin'}`
};
const FMS_M_0730 = 7 * 60 + 30;
const FMS_M_1930 = 19 * 60 + 30;

/** Giờ VN hiện tại (Asia/Ho_Chi_Minh) */
function getVietnamNow() {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const parts = {};
    fmt.formatToParts(new Date()).forEach(p => {
      if (p.type !== 'literal') parts[p.type] = p.value;
    });
    const hour = parseInt(parts.hour, 10) || 0;
    const minute = parseInt(parts.minute, 10) || 0;
    return {
      ymd: `${parts.year}-${parts.month}-${parts.day}`,
      hour,
      minute,
      minutes: hour * 60 + minute
    };
  } catch (e) {
    const d = new Date();
    const utc = d.getTime() + d.getTimezoneOffset() * 60000;
    const vn = new Date(utc + 3600000 * 7);
    return {
      ymd: vn.toISOString().slice(0, 10),
      hour: vn.getUTCHours(),
      minute: vn.getUTCMinutes(),
      minutes: vn.getUTCHours() * 60 + vn.getUTCMinutes()
    };
  }
}

function addDaysYmdClient(ymd, days) {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const da = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Smart A: ca + ngày bắt đầu ca theo giờ VN
 * - 07:30–19:29 → ca ngày, dutyDate = hôm nay
 * - 19:30–23:59 → ca tối, dutyDate = hôm nay
 * - 00:00–07:29 → ca tối, dutyDate = hôm qua
 */
function detectCurrentShiftContext() {
  const now = getVietnamNow();
  if (now.minutes >= FMS_M_0730 && now.minutes < FMS_M_1930) {
    return {
      shift: 'day',
      dutyDate: now.ymd,
      label: 'Ca ngày',
      window: '07:30–19:29',
      icon: 'fa-sun',
      now
    };
  }
  if (now.minutes >= FMS_M_1930) {
    return {
      shift: 'evening',
      dutyDate: now.ymd,
      label: 'Ca tối',
      window: '19:30–07:29',
      icon: 'fa-moon',
      now
    };
  }
  return {
    shift: 'evening',
    dutyDate: addDaysYmdClient(now.ymd, -1),
    label: 'Ca tối',
    window: '19:30–07:29',
    icon: 'fa-moon',
    now
  };
}

/** Phút trong ngày từ time_fuel / dep / arr; null nếu không parse được */
function getFlightMinutes(f) {
  const timeStr = (f && (f.time_fuel || f.time_dep || f.time_arr)) || '';
  if (!timeStr || timeStr === '-') return null;
  const match = String(timeStr).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}

/** Bucket ca của 1 chuyến: day | evening */
function getFlightShiftBucket(f) {
  const minutes = getFlightMinutes(f);
  if (minutes === null) return 'evening';
  if (minutes >= FMS_M_0730 && minutes < FMS_M_1930) return 'day';
  return 'evening';
}

function sortFlightsByTime(rows) {
  return [...(rows || [])].sort((a, b) => {
    const ma = getFlightMinutes(a);
    const mb = getFlightMinutes(b);
    if (ma === null && mb === null) return 0;
    if (ma === null) return 1;
    if (mb === null) return -1;
    // Ca tối: 19:30… rồi 00:00… → phút < 07:30 cộng 24h để sort
    const na = ma < FMS_M_0730 ? ma + 24 * 60 : ma;
    const nb = mb < FMS_M_0730 ? mb + 24 * 60 : mb;
    return na - nb;
  });
}

// Lọc chuyến theo ca (import Excel / view)
// - day:     07:30 – 19:29
// - evening: 19:30 – 23:59 + 00:00 – 07:29
// - night:   alias evening
function filterFlightsByShift(flights, shift) {
  if (!shift || shift === 'all') return flights;
  const s = shift === 'night' ? 'evening' : shift;
  return (flights || []).filter(f => {
    const bucket = getFlightShiftBucket(f);
    if (s === 'day') return bucket === 'day';
    if (s === 'evening') return bucket === 'evening';
    return true;
  });
}

/** mode select: auto|day|evening|all → ca hiệu lực */
function resolveViewShift(scope = 'admin') {
  const selectId = scope === 'user' ? 'user-fms-view-shift' : 'fms-view-shift';
  const el = document.getElementById(selectId);
  let mode = el && el.value ? el.value : 'auto';
  try {
    const saved = sessionStorage.getItem(FMS_SHIFT_STORAGE.view(scope));
    if (el && saved && ['auto', 'day', 'evening', 'all'].includes(saved) && !el.dataset.userTouched) {
      // lần đầu hydrate từ session
      if (!el.dataset.hydrated) {
        el.value = saved;
        mode = saved;
        el.dataset.hydrated = '1';
      }
    }
  } catch (e) { /* ignore */ }

  mode = el && el.value ? el.value : mode;
  const ctx = detectCurrentShiftContext();
  const effective = mode === 'auto' ? ctx.shift : mode;
  return {
    mode,
    effective,
    live: ctx,
    isAuto: mode === 'auto',
    label: effective === 'all'
      ? 'Tất cả ca'
      : (effective === 'day' ? 'Ca ngày' : 'Ca tối'),
    window: effective === 'all'
      ? 'cả ngày'
      : (effective === 'day' ? '07:30–19:29' : '19:30–07:29')
  };
}

function isOutShiftExpanded(scope) {
  try {
    return sessionStorage.getItem(FMS_SHIFT_STORAGE.outOpen(scope)) === '1';
  } catch (e) {
    return false;
  }
}

function setOutShiftExpanded(scope, open) {
  try {
    sessionStorage.setItem(FMS_SHIFT_STORAGE.outOpen(scope), open ? '1' : '0');
  } catch (e) { /* ignore */ }
}

/**
 * Smart default ngày + ca khi mở bảng FMS.
 * - Ca: session hoặc auto
 * - Ngày: nếu user chưa chọn tay → dutyDate theo ca hiện tại
 */
function applySmartFmsDefaults(scope = 'admin') {
  const dateId = scope === 'user' ? 'user-fms-filter-date' : 'fms-filter-date';
  const shiftId = scope === 'user' ? 'user-fms-view-shift' : 'fms-view-shift';
  const dateEl = document.getElementById(dateId);
  const shiftEl = document.getElementById(shiftId);
  const ctx = detectCurrentShiftContext();

  if (shiftEl) {
    try {
      const saved = sessionStorage.getItem(FMS_SHIFT_STORAGE.view(scope));
      if (saved && ['auto', 'day', 'evening', 'all'].includes(saved)) {
        shiftEl.value = saved;
      } else if (!shiftEl.value) {
        shiftEl.value = 'auto';
      }
    } catch (e) {
      if (!shiftEl.value) shiftEl.value = 'auto';
    }
    shiftEl.dataset.hydrated = '1';
  }

  let dateManual = false;
  try {
    dateManual = sessionStorage.getItem(FMS_SHIFT_STORAGE.dateManual(scope)) === '1';
  } catch (e) { /* ignore */ }

  const mode = shiftEl ? shiftEl.value : 'auto';
  if (dateEl && (!dateEl.value || (!dateManual && mode === 'auto'))) {
    dateEl.value = ctx.dutyDate;
  }

  // Soft-sync select import khi đang auto theo giờ (không đụng khi user chọn "Tất cả" để import)
  if (scope === 'admin') {
    const importShift = document.getElementById('fms-filter-shift');
    if (importShift && mode === 'auto') {
      importShift.value = ctx.shift === 'evening' ? 'evening' : 'day';
    }
  }

  return ctx;
}

function updateFmsShiftBadge(scope, inCount, outCount) {
  const badgeId = scope === 'user' ? 'user-fms-shift-badge' : 'fms-shift-badge';
  const hintId = scope === 'user' ? 'user-fms-shift-hint' : 'fms-shift-hint';
  const badge = document.getElementById(badgeId);
  const hint = document.getElementById(hintId);
  const vs = resolveViewShift(scope);
  const icon = vs.effective === 'day' ? 'fa-sun' : (vs.effective === 'evening' ? 'fa-moon' : 'fa-calendar-day');
  const cls = vs.effective === 'day' ? 'is-day' : (vs.effective === 'evening' ? 'is-evening' : 'is-all');

  if (badge) {
    badge.className = `fms-shift-badge ${cls}`;
    badge.style.display = 'inline-flex';
    const autoTag = vs.isAuto ? ' · auto' : '';
    badge.innerHTML = `<i class="fa-solid ${icon}"></i> ${escapeHtml(vs.label)} · ${escapeHtml(vs.window)}${autoTag}`;
    badge.title = vs.isAuto
      ? `Theo giờ VN: đang ${vs.live.label} (${vs.live.window}). Ngày ca gợi ý: ${vs.live.dutyDate}`
      : `Đang lọc: ${vs.label} (${vs.window})`;
  }
  if (hint) {
    if (vs.effective === 'all') {
      hint.style.display = 'block';
      hint.textContent = `Hiển thị cả ngày · ${inCount + outCount} chuyến (không gập ngoài ca).`;
    } else {
      hint.style.display = 'block';
      const other = vs.effective === 'day' ? 'Ca tối' : 'Ca ngày';
      hint.innerHTML = `<strong>${escapeHtml(vs.label)}</strong> đang xổ · <strong>${inCount}</strong> chuyến`
        + (outCount > 0
          ? ` · <span style="color:var(--text-muted);">${escapeHtml(other)} gập lại (${outCount} chuyến — bấm để xổ)</span>`
          : '');
    }
  }
}

/**
 * Tách rows sau search/crew filter → trong ca / ngoài ca
 */
function splitRowsByViewShift(rows, scope = 'admin') {
  const vs = resolveViewShift(scope);
  const sorted = sortFlightsByTime(rows);
  if (vs.effective === 'all') {
    return { inShift: sorted, outShift: [], view: vs };
  }
  const inShift = [];
  const outShift = [];
  sorted.forEach(r => {
    const bucket = getFlightShiftBucket(r);
    if (bucket === vs.effective) inShift.push(r);
    else outShift.push(r);
  });
  return { inShift, outShift, view: vs };
}

function buildOutShiftToggleRow(scope, outCount, otherLabel, open) {
  if (outCount <= 0) return '';
  return `
    <tr class="fms-out-shift-toggle ${open ? 'is-open' : ''}" data-fms-out-toggle="${scope}" title="Bấm để ${open ? 'thu gọn' : 'xem'} chuyến ngoài ca">
      <td colspan="9">
        <span class="chev">▸</span>
        Ngoài ca · ${escapeHtml(otherLabel)}
        <span style="font-weight:500;opacity:0.85;">(${outCount} chuyến)</span>
        <span style="font-weight:500;margin-left:6px;opacity:0.7;">${open ? '— bấm để thu' : '— bấm để xổ'}</span>
      </td>
    </tr>`;
}

function buildInShiftSectionRow(label, count, windowLabel) {
  return `
    <tr class="fms-shift-section-row is-in">
      <td colspan="9">
        <i class="fa-solid fa-circle-check" style="margin-right:4px;"></i>
        Trong ca · ${escapeHtml(label)} (${escapeHtml(windowLabel)}) · ${count} chuyến
      </td>
    </tr>`;
}

// Phân tích và bóc tách các dòng từ file Excel lịch trực (13 cột)
function parseFmsExcel(rows) {
  const flights = [];
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 13) continue;

    // Cột 1 (index 0) phải là STT (số thứ tự)
    const stt = parseInt(r[0]);
    // Cột 4 (index 3) là Flight No (Số hiệu chuyến bay)
    const flightNo = r[3] ? String(r[3]).trim().toUpperCase().replace(/\s+/g, '') : '';

    // Loại bỏ dòng chỉ số cột (dòng 1, 2, 3, 4, 5...) và đảm bảo flightNo hợp lệ
    const isHeaderRow = r[0] == 1 && r[1] == 2 && r[2] == 3 && r[3] == 4;
    const isNumericFlight = /^\d+$/.test(flightNo);

    if (!isNaN(stt) && flightNo && !isHeaderRow && !isNumericFlight) {
      flights.push({
        ac_type: r[1] ? String(r[1]).trim() : '',
        ac_reg: r[2] ? String(r[2]).trim() : '',
        flight_no: flightNo,
        route: r[4] ? String(r[4]).trim() : '',
        time_arr: formatExcelTime(r[6]),
        time_dep: formatExcelTime(r[7]),
        time_fuel: formatExcelTime(r[8]),
        gate: r[9] ? String(r[9]).trim() : '',
        truck_no: r[10] ? String(r[10]).trim() : '',
        driver_name: r[11] ? String(r[11]).trim() : '',
        operator_name: r[12] ? String(r[12]).trim() : ''
      });
    }
  }

  if (flights.length === 0) {
    showToast('Không tìm thấy dữ liệu chuyến bay hợp lệ trong file Excel. Vui lòng kiểm tra lại cấu trúc cột!', 'error', 'Không có dữ liệu');
    return;
  }

  // Lọc theo ca trực đã chọn ở giao diện
  const shiftSelect = document.getElementById('fms-filter-shift');
  const selectedShift = shiftSelect ? shiftSelect.value : 'all';
  const filteredFlights = filterFlightsByShift(flights, selectedShift);

  if (filteredFlights.length === 0) {
    showToast('Không có chuyến bay nào thuộc ca trực đã chọn trong file Excel!', 'warning', 'Không có dữ liệu ca trực');
    return;
  }

  // Lưu lịch bay bóc tách tạm thời vào state để xác nhận sau
  state.fmsRawParsedFlights = flights;
  state.fmsPreviewFlights = filteredFlights;

  // Hiển thị bảng xem trước (Preview) và Zalo Mapping lên modal
  renderFmsPreviewContent(filteredFlights, true);
}

/**
 * Preview modal: 1 bảng gọn — mỗi người (Lái / NV) 1 dòng: map Zalo + báo tin.
 * Thay 2 panel card lớn "Theo cặp" + "Liên kết Zalo".
 */
function renderPersonZaloCompact(flights) {
  const people = collectPeopleFromRows(flights || []);
  const section = document.getElementById('fms-person-zalo-section');
  const tbody = document.getElementById('fms-person-zalo-tbody');
  const legacyMapBody = document.getElementById('fms-zalo-mapping-table-body');
  const legacyNotifyBody = document.getElementById('fms-crew-notify-table-body');

  // Giữ lựa chọn đang chọn khi re-render
  const currentSelections = {};
  document.querySelectorAll('.zalo-person-row, .zalo-mapping-row').forEach(row => {
    const name = (row.getAttribute('data-name') || row.getAttribute('data-person') || '').toUpperCase();
    const mapSel = row.querySelector('.zalo-member-select, .fms-zalo-map-select');
    const notifySel = row.querySelector('.fms-crew-notify-select, .crew-notify-select');
    if (name && mapSel) currentSelections[name] = mapSel.value;
    if (name && notifySel) currentSelections[`notify::${name}`] = notifySel.value;
  });

  if (!people.length) {
    if (section) section.style.display = 'none';
    if (tbody) tbody.innerHTML = '';
    if (legacyMapBody) legacyMapBody.innerHTML = '';
    if (legacyNotifyBody) legacyNotifyBody.innerHTML = '';
    return;
  }

  const mapDb = getZaloMapDb();
  const rowsHtml = people.map(p => buildPersonZaloRowHtml(p, { mapDb, currentSelections })).join('');
  if (tbody) tbody.innerHTML = rowsHtml;
  if (section) section.style.display = 'block';

  // Mirror vào tbody ẩn để handleConfirmFmsPreview (đọc .zalo-mapping-row) vẫn hoạt động
  if (legacyMapBody) {
    legacyMapBody.innerHTML = people.map(p => {
      const nameKey = (p.name || '').toUpperCase();
      let savedUid = currentSelections[nameKey] !== undefined
        ? currentSelections[nameKey]
        : resolveZaloUidForPerson(p.name, mapDb);
      return `
        <tr class="zalo-mapping-row" data-name="${escapeHtml(p.name)}">
          <td>${escapeHtml(p.name)}</td>
          <td>
            <select class="zalo-member-select">
              ${buildZaloMemberOptionsHtml(savedUid)}
            </select>
          </td>
        </tr>`;
    }).join('');
  }
  if (legacyNotifyBody) {
    legacyNotifyBody.innerHTML = people.map(p => {
      const nameKey = (p.name || '').toUpperCase();
      const notifyVal = currentSelections[`notify::${nameKey}`] !== undefined
        ? currentSelections[`notify::${nameKey}`]
        : (p.notifyType || 1);
      return `
        <tr class="crew-notify-row" data-key="${escapeHtml(p.key || nameKey)}" data-crew="${escapeHtml(p.name)}" data-person="${escapeHtml(p.name)}" data-truck="-">
          <td>${escapeHtml(p.name)}</td>
          <td>-</td>
          <td>
            <select class="crew-notify-select">
              <option value="1" ${notifyVal == 1 ? 'selected' : ''}>Tag nhóm</option>
              <option value="2" ${notifyVal == 2 ? 'selected' : ''}>Inbox</option>
              <option value="3" ${notifyVal == 3 ? 'selected' : ''}>Cả hai</option>
            </select>
          </td>
        </tr>`;
    }).join('');
  }
}

// Tương thích lời gọi cũ
function renderZaloMappingTable(flights) {
  renderPersonZaloCompact(flights);
}
function renderCrewNotifyTable(flights) {
  // gộp vào renderPersonZaloCompact — không vẽ panel cặp nữa
  const section = document.getElementById('fms-person-zalo-section');
  if (section && section.style.display === 'none') {
    renderPersonZaloCompact(flights);
  }
}

// Gửi xác nhận lưu lịch trực bay từ Modal Preview
// Render dữ liệu nhận diện ảnh/Excel lên preview modal (kèm cấu hình Zalo Mapping)
async function renderFmsPreviewContent(flights, shouldResetInputs = true) {
  state.fmsPreviewFlights = flights;
  
  // 1. Tải danh sách thành viên Zalo và mapping (nếu chưa tải)
  const btnConfirm = document.getElementById('btn-fms-confirm-preview');
  const originalConfirmText = btnConfirm.innerHTML;
  
  if (!state.zaloMembers || state.zaloMembers.length === 0) {
    btnConfirm.disabled = true;
    btnConfirm.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tải dữ liệu Zalo...';
    await loadZaloMembersAndMappings();
    btnConfirm.disabled = false;
    btnConfirm.innerHTML = originalConfirmText;
  }

  // Điền ngày và ca trực kế hoạch mặc định khi mở modal lần đầu
  if (shouldResetInputs) {
    const extDateInput = document.getElementById('fms-schedule-date');
    const extDate = extDateInput ? extDateInput.value : '';
    const todayStr = new Date().toLocaleDateString('en-CA'); 
    const defaultDate = extDate ? extDate : (flights.length > 0 && flights[0].date ? flights[0].date : todayStr);
    const dateInput = document.getElementById('fms-preview-date-input');
    if (dateInput) {
      dateInput.value = defaultDate;
    }

    const extShiftSelect = document.getElementById('fms-filter-shift');
    const extShift = extShiftSelect ? extShiftSelect.value : 'all';
    const shiftSelect = document.getElementById('fms-preview-shift-input');
    if (shiftSelect) {
      shiftSelect.value = extShift;
    }
  }

  // 2. Render bảng chuyến bay kèm nút Xóa ở cột đầu tiên (Gộp cột chống cuộn ngang)
  const tbody = document.getElementById('fms-preview-table-body');
  tbody.innerHTML = flights.map((f, index) => {
    const timesHtml = `
      <div style="font-size: 0.8rem; text-align: left; line-height: 1.4;">
        ${f.time_arr ? `<div>Hạ: <span style="color: var(--text-muted);">${f.time_arr}</span></div>` : ''}
        ${f.time_dep ? `<div>Cất: <span style="color: var(--text-muted);">${f.time_dep}</span></div>` : ''}
        ${f.time_fuel ? `<div style="margin-top: 2px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 2px;">Nạp: <strong style="color: #fb923c; font-size: 0.88rem;">${f.time_fuel}</strong></div>` : ''}
      </div>
    `;

    const positionHtml = `
      <div style="font-size: 0.85rem; line-height: 1.4; text-align: center;">
        <div>Gate: <strong style="color: #f59e0b;">${f.gate || '-'}</strong></div>
        <div style="margin-top: 2px; color: var(--primary);">Xe: <strong>${f.truck_no || '-'}</strong></div>
      </div>
    `;

    const staffHtml = `
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 0.78rem; color: var(--text-muted); min-width: 42px;">Lái xe:</span>
          <input type="text" class="fms-preview-driver-input" data-index="${index}" value="${f.driver_name || ''}" style="width: 100px; padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: #0f172a; color: white; font-weight: 600; font-size: 0.8rem; outline: none;">
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-size: 0.78rem; color: var(--text-muted); min-width: 42px;">Bơm:</span>
          <input type="text" class="fms-preview-operator-input" data-index="${index}" value="${f.operator_name || ''}" style="width: 100px; padding: 3px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.15); background: #0f172a; color: white; font-weight: 600; font-size: 0.8rem; outline: none;">
        </div>
      </div>
    `;

    return `
      <tr data-index="${index}">
        <td style="text-align: center; vertical-align: middle; padding: 4px;">
          <span class="btn-delete-preview-flight" data-index="${index}" style="font-weight: 900; font-size: 1.25rem; color: #ef4444; cursor: pointer; user-select: none; transition: transform 0.2s; display: inline-block;" title="Xóa chuyến bay này">X</span>
        </td>
        <td>
          <strong style="color: #38bdf8; font-size: 1.05rem;">${f.flight_no}</strong>
          <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">
            ${f.ac_type || '-'} (${f.ac_reg || '-'})
          </div>
          <div style="font-size: 0.82rem; color: #60a5fa; margin-top: 2px; font-weight: 600;">${f.route || '-'}</div>
        </td>
        <td>${timesHtml}</td>
        <td>${positionHtml}</td>
        <td>${staffHtml}</td>
      </tr>
    `;
  }).join('');

  // Lắng nghe sự thay đổi tên nhân viên để cập nhật realtime các bảng Zalo Mapping & Crew Notify
  const updatePreviewInputs = () => {
    tbody.querySelectorAll('.fms-preview-driver-input').forEach(input => {
      const idx = parseInt(input.getAttribute('data-index'));
      if (state.fmsPreviewFlights[idx]) {
        state.fmsPreviewFlights[idx].driver_name = input.value.trim();
      }
    });
    tbody.querySelectorAll('.fms-preview-operator-input').forEach(input => {
      const idx = parseInt(input.getAttribute('data-index'));
      if (state.fmsPreviewFlights[idx]) {
        state.fmsPreviewFlights[idx].operator_name = input.value.trim();
      }
    });
    renderPersonZaloCompact(state.fmsPreviewFlights);
  };

  tbody.querySelectorAll('.fms-preview-driver-input, .fms-preview-operator-input').forEach(input => {
    input.addEventListener('input', updatePreviewInputs);
  });

  // Lắng nghe sự kiện Click nút Xóa chuyến bay
  tbody.querySelectorAll('.btn-delete-preview-flight').forEach(span => {
    span.addEventListener('mouseenter', () => span.style.transform = 'scale(1.2)');
    span.addEventListener('mouseleave', () => span.style.transform = 'scale(1)');
    
    span.addEventListener('click', (e) => {
      const idx = parseInt(e.target.getAttribute('data-index'));
      // Xóa phần tử khỏi mảng
      state.fmsPreviewFlights.splice(idx, 1);
      // Render lại giao diện modal với danh sách mới
      renderFmsPreviewContent(state.fmsPreviewFlights);
    });
  });

  // 3. Bảng gọn map Zalo + báo tin từng người (Lái | NV)
  renderPersonZaloCompact(flights);

  // Hiện Modal Xem trước
  document.getElementById('fms-preview-modal').classList.add('active');
}

// Gửi xác nhận lưu lịch trực bay từ Modal Preview
async function handleConfirmFmsPreview() {
  const btn = document.getElementById('btn-fms-confirm-preview');
  if (!state.fmsPreviewFlights || state.fmsPreviewFlights.length === 0) return;

  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang lưu...';

  try {
    // 1. Gom map Zalo + báo tin theo TỪNG NGƯỜI (Lái / NV tách) từ bảng gọn
    const mappings = [];
    const nameToUidMap = {}; // schedule_name UPPER -> zalo_uid
    const personNotifyMap = {}; // personName UPPER -> notifyType
    const seenMap = new Set();

    const collectFromRow = (row) => {
      const scheduleName = row.getAttribute('data-name') || row.getAttribute('data-person') || '';
      if (!scheduleName) return;
      const nameKey = scheduleName.toUpperCase().trim();
      const mapSel = row.querySelector('.zalo-member-select, .fms-zalo-map-select');
      const notifySel = row.querySelector('.fms-crew-notify-select, .crew-notify-select');

      if (mapSel && !seenMap.has(nameKey)) {
        seenMap.add(nameKey);
        const zaloUid = mapSel.value;
        const zaloName = mapSel.options[mapSel.selectedIndex]
          ? mapSel.options[mapSel.selectedIndex].text
          : '';
        if (zaloUid) {
          const cleanZaloName = (zaloName && !/chưa map|chưa liên kết/i.test(zaloName)) ? zaloName : '';
          mappings.push({
            scheduleName,
            zaloUid,
            zaloName: cleanZaloName
          });
          nameToUidMap[nameKey] = zaloUid;
        }
      }
      if (notifySel) {
        personNotifyMap[nameKey] = parseInt(notifySel.value, 10) || 1;
      }
    };

    // Ưu tiên bảng gọn visible, fallback legacy rows
    document.querySelectorAll('#fms-person-zalo-tbody .zalo-person-row').forEach(collectFromRow);
    if (!seenMap.size) {
      document.querySelectorAll('.zalo-mapping-row, .zalo-person-row').forEach(collectFromRow);
    }
    document.querySelectorAll('.crew-notify-row').forEach(row => {
      const person = row.getAttribute('data-person') || row.getAttribute('data-crew') || '';
      const select = row.querySelector('.crew-notify-select, .fms-crew-notify-select');
      if (person && select && personNotifyMap[person.toUpperCase().trim()] === undefined) {
        personNotifyMap[person.toUpperCase().trim()] = parseInt(select.value, 10) || 1;
      }
    });

    // 2. Gán UID cả Lái + NV; notifyType ưu tiên người trên chuyến (max / hoặc driver)
    const finalFlights = state.fmsPreviewFlights.map((f) => {
      const { driver, operator } = parseCrewRoles(f);
      const drKey = driver ? driver.toUpperCase().trim() : '';
      const opKey = operator ? operator.toUpperCase().trim() : '';

      const uids = [];
      if (drKey && nameToUidMap[drKey]) uids.push(nameToUidMap[drKey]);
      if (opKey && nameToUidMap[opKey]) uids.push(nameToUidMap[opKey]);
      const uniqueUids = Array.from(new Set(uids));

      let notifyType = 1;
      if (drKey && personNotifyMap[drKey] !== undefined) notifyType = personNotifyMap[drKey];
      else if (opKey && personNotifyMap[opKey] !== undefined) notifyType = personNotifyMap[opKey];
      // nếu cả hai có và khác nhau → ưu tiên "Cả hai" (3) nếu có, không thì max
      if (drKey && opKey && personNotifyMap[drKey] !== undefined && personNotifyMap[opKey] !== undefined) {
        const a = personNotifyMap[drKey];
        const b = personNotifyMap[opKey];
        notifyType = (a === 3 || b === 3) ? 3 : Math.max(a, b);
      }

      return {
        ...f,
        driver_name: driver || f.driver_name,
        operator_name: operator || f.operator_name,
        crew_info: driver && operator ? `${driver} - ${operator}` : (f.crew_info || driver || operator || ''),
        crew_zalo_uids: uniqueUids.join(','),
        notify_type: notifyType
      };
    });

    // 3. Gọi API lưu lịch bay và mapping học hỏi
    // Ưu tiên ca/ngày trên Modal Preview (đúng chỗ user vừa chọn), fallback form bên ngoài
    const dateInput = document.getElementById('fms-preview-date-input');
    const selectedDate = dateInput ? dateInput.value : '';
    const previewShiftEl = document.getElementById('fms-preview-shift-input');
    const outerShiftEl = document.getElementById('fms-filter-shift');
    const selectedShift = (previewShiftEl && previewShiftEl.value)
      ? previewShiftEl.value
      : (outerShiftEl ? outerShiftEl.value : 'all');

    const res = await fetch('/api/fms/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ 
        flights: finalFlights,
        mappings: mappings,
        date: selectedDate,
        shift: selectedShift
      })
    });
    
    const data = await res.json();
    if (data.success) {
      const shiftLabel = {
        all: 'cả ngày',
        day: 'ca ngày (07:30–19:30)',
        evening: 'ca tối (19:30–07:30 sáng mai)',
        night: 'ca tối (19:30–07:30 sáng mai)'
      }[selectedShift] || selectedShift;
      const dateVn = selectedDate ? formatDateVN(selectedDate) : '';
      showToast(
        `${data.message || 'Đã lưu lịch trực.'} Đang mở Kế hoạch FMS ngày ${dateVn} (${shiftLabel}).`,
        'success',
        'Thành công'
      );
      document.getElementById('fms-preview-modal').classList.remove('active');
      if (selectedDate) {
        const schedInput = document.getElementById('fms-schedule-date');
        const filtInput = document.getElementById('fms-filter-date');
        if (schedInput) schedInput.value = selectedDate;
        if (filtInput) filtInput.value = selectedDate;
      }
      // Đồng bộ dropdown ca ngoài form nhập với ca vừa lưu
      if (outerShiftEl && selectedShift) outerShiftEl.value = selectedShift;

      // Chuyển sang tab Kế hoạch bay FMS để user thấy ngay dữ liệu vừa nhập
      const fmsTabBtn = document.getElementById('tab-btn-fms') || document.querySelector('[data-tab="tab-fms"]');
      if (fmsTabBtn) fmsTabBtn.click();
      else loadFmsSchedules();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast('Lỗi lưu lịch trực FMS: ' + err.message, 'error', 'Thất bại');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// Lấy danh sách API Keys Gemini từ settings
async function loadGeminiKeys() {
  try {
    const res = await fetch('/api/fms/settings/gemini-keys', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('gemini-keys-input').value = data.keys || '';
    }
  } catch (err) {
    console.error('Không thể lấy API Keys Gemini:', err.message);
  }
}

// Lưu danh sách API Keys Gemini
async function handleSaveGeminiKeys() {
  const btn = document.getElementById('btn-save-gemini-keys');
  const keysInput = document.getElementById('gemini-keys-input').value;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang lưu...';

  try {
    const res = await fetch('/api/fms/settings/gemini-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ keys: keysInput })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success', 'Thành công');
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast(err.message, 'error', 'Lưu thất bại');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// Xử lý gửi ảnh FMS để OCR
async function handleImageFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const btn = document.getElementById('btn-fms-upload-image');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang nhận diện ảnh...';

  const reader = new FileReader();
  reader.onload = async function(evt) {
    const base64Data = evt.target.result;
    try {
      const res = await fetch('/api/fms/ocr-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.token}`
        },
        body: JSON.stringify({
          mimeType: file.type,
          base64Data: base64Data
        })
      });
      
      const data = await res.json();
      if (data.success) {
        showToast('Bóc tách ảnh lịch trực thành công! Vui lòng duyệt xem trước.', 'success', 'Nhận diện thành công');
        const rawFlights = data.flights || [];
        state.fmsRawParsedFlights = rawFlights;
        const shiftSelect = document.getElementById('fms-filter-shift');
        const selectedShift = shiftSelect ? shiftSelect.value : 'all';
        const filteredFlights = filterFlightsByShift(rawFlights, selectedShift);
        
        if (filteredFlights.length === 0) {
          showToast('Không có chuyến bay nào thuộc ca trực đã chọn trong ảnh lịch trực!', 'warning', 'Không có dữ liệu ca trực');
          return;
        }
        state.fmsPreviewFlights = filteredFlights;
        renderOcrPreview(filteredFlights);
      } else {
        throw new Error(data.error);
      }
    } catch (err) {
      showToast(err.message, 'error', 'Nhận diện ảnh thất bại');
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  };
  reader.readAsDataURL(file);
}

// Render dữ liệu nhận diện ảnh lên preview modal giống Excel
function renderOcrPreview(flights) {
  renderFmsPreviewContent(flights, true);
}

// Kiểm thử đồng thời danh sách API Keys Gemini
async function handleTestGeminiKeys() {
  const btn = document.getElementById('btn-test-gemini-keys');
  const keysInput = document.getElementById('gemini-keys-input').value.trim();
  const resultsDiv = document.getElementById('gemini-keys-test-results');

  if (!keysInput) {
    showToast('Vui lòng nhập API Keys để kiểm tra!', 'error', 'Lỗi kiểm tra');
    return;
  }

  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang test...';
  
  resultsDiv.style.display = 'flex';
  resultsDiv.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 5px;"><i class="fa-solid fa-circle-notch fa-spin"></i> Đang kiểm tra danh sách keys...</div>';

  try {
    const res = await fetch('/api/fms/settings/test-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ keys: keysInput })
    });
    const data = await res.json();
    if (data.success) {
      const results = data.results || [];
      if (results.length === 0) {
        resultsDiv.innerHTML = '<div style="color: var(--text-muted); text-align: center; padding: 5px;">Không có key nào để kiểm tra.</div>';
        return;
      }
      
      resultsDiv.innerHTML = results.map(r => {
        const icon = r.success ? '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i>' : '<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i>';
        const color = r.success ? '#10b981' : '#ef4444';
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px dashed rgba(255,255,255,0.05); padding-bottom: 4px; margin-bottom: 4px; font-size: 0.78rem;">
            <span style="font-family: monospace; font-weight: bold; color: var(--text-muted);">${r.key}</span>
            <span style="color: ${color}; font-weight: 600; display: flex; align-items: center; gap: 5px; font-size: 0.78rem;">
              ${icon} ${r.message}
            </span>
          </div>
        `;
      }).join('');
      
      showToast('Đã hoàn thành kiểm tra danh sách API Keys!', 'success', 'Hoàn tất kiểm tra');
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast(err.message, 'error', 'Kiểm tra thất bại');
    resultsDiv.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 5px;">Lỗi: ${err.message}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// --- TRỢ LÝ ZALO SKYEYES CLIENT-SIDE LOGIC ---
let skyeyesPollInterval = null;
let lastSkyEyesStatus = '';

// Bắt đầu vòng lặp polling lấy trạng thái Zalo
function startSkyEyesPolling() {
  if (skyeyesPollInterval) return;
  
  // Polling mỗi 2.5 giây
  skyeyesPollInterval = setInterval(fetchSkyEyesState, 2500);
  fetchSkyEyesState(); // Gọi ngay lập tức
}

// Dừng vòng lặp polling
function stopSkyEyesPolling() {
  if (skyeyesPollInterval) {
    clearInterval(skyeyesPollInterval);
    skyeyesPollInterval = null;
  }
}

// Lấy trạng thái Zalo SkyEyes từ server
async function fetchSkyEyesState() {
  try {
    const res = await fetch('/api/fms/zalo/state', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      updateSkyEyesUI(data.state);
    }
  } catch (err) {
    console.error('[SkyEyes] Không thể lấy trạng thái Zalo:', err.message);
  }
}

// Cập nhật giao diện Trợ lý SkyEyes dựa trên trạng thái hiện tại
async function updateSkyEyesUI(botState) {
  const statusEl = document.getElementById('skyeyes-bot-status');
  const qrContainer = document.getElementById('skyeyes-qr-container');
  const qrImg = document.getElementById('skyeyes-qr-img');
  const btnConnect = document.getElementById('btn-skyeyes-connect');
  const btnLogout = document.getElementById('btn-skyeyes-logout');
  const groupsListDiv = document.getElementById('skyeyes-groups-list');

  if (botState.status !== lastSkyEyesStatus) {
    console.log(`[SkyEyes] Trạng thái chuyển đổi: ${lastSkyEyesStatus} -> ${botState.status}`);
    lastSkyEyesStatus = botState.status;
  }

  switch (botState.status) {
    case 'disconnected':
      statusEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Chưa kết nối';
      statusEl.style.color = '#ef4444';
      qrContainer.style.display = 'none';
      btnConnect.style.display = 'block';
      btnConnect.innerHTML = '<i class="fa-solid fa-qrcode"></i> Kết Nối SkyEyes (Quét QR)';
      btnConnect.disabled = false;
      btnLogout.style.display = 'none';
      break;

    case 'generating':
      statusEl.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang tạo QR Code...';
      statusEl.style.color = '#fb923c';
      qrContainer.style.display = 'none';
      btnConnect.style.display = 'block';
      btnConnect.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang tạo QR...';
      btnConnect.disabled = true;
      btnLogout.style.display = 'none';
      break;

    case 'qr_ready':
      statusEl.innerHTML = '<i class="fa-solid fa-qrcode"></i> Đang chờ quét QR...';
      statusEl.style.color = '#38bdf8';
      if (botState.qrUrl) {
        qrImg.src = botState.qrUrl;
      }
      qrContainer.style.display = 'flex';
      btnConnect.style.display = 'block';
      btnConnect.innerHTML = '<i class="fa-solid fa-xmark"></i> Hủy / Đóng QR';
      btnConnect.disabled = false;
      btnLogout.style.display = 'none';
      break;

    case 'scanned':
      statusEl.innerHTML = '<i class="fa-solid fa-circle-check"></i> Đã quét QR. Chờ xác nhận...';
      statusEl.style.color = '#60a5fa';
      qrContainer.style.display = 'flex';
      btnConnect.style.display = 'block';
      btnConnect.innerHTML = '<i class="fa-solid fa-xmark"></i> Hủy Đăng Nhập';
      btnConnect.disabled = false;
      btnLogout.style.display = 'none';
      break;

    case 'connected':
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đang hoạt động (${botState.botName || 'SkyEyes'})`;
      statusEl.style.color = '#10b981';
      qrContainer.style.display = 'none';
      btnConnect.style.display = 'none';
      btnLogout.style.display = 'block';

      // Tự động load danh sách nhóm nếu chưa được load
      const hasGroupsLoaded = groupsListDiv && groupsListDiv.querySelectorAll('.skyeyes-group-checkbox').length > 0;
      if (!hasGroupsLoaded) {
        loadSkyEyesGroups();
      }
      break;

    case 'error':
      statusEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Lỗi: ${botState.error || 'Thử lại'}`;
      statusEl.style.color = '#ef4444';
      qrContainer.style.display = 'none';
      btnConnect.style.display = 'block';
      btnConnect.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Tạo lại QR';
      btnConnect.disabled = false;
      btnLogout.style.display = 'none';
      break;
  }
}

// Kết nối QR (hoặc đóng QR nếu đang chờ quét)
async function handleSkyEyesConnect() {
  const btnConnect = document.getElementById('btn-skyeyes-connect');
  if (lastSkyEyesStatus === 'qr_ready' || lastSkyEyesStatus === 'scanned') {
    // Nhấp nút khi đang chờ quét -> Thực hiện đăng xuất để hủy phiên quét
    await handleSkyEyesLogout();
    return;
  }

  try {
    btnConnect.disabled = true;
    btnConnect.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang yêu cầu...';
    
    const res = await fetch('/api/fms/zalo/qr', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) {
      showToast('Không thể tạo QR Code Zalo: ' + data.error, 'error', 'Tạo QR thất bại');
    } else {
      startSkyEyesPolling();
    }
  } catch (e) {
    showToast('Lỗi kết nối tạo QR: ' + e.message, 'error', 'Lỗi kết nối');
  }
}

// Đăng xuất Bot Zalo
async function handleSkyEyesLogout() {
  if (!confirm('Bạn có chắc chắn muốn đăng xuất và ngắt kết nối Trợ lý Zalo SkyEyes không?')) return;
  
  try {
    const res = await fetch('/api/fms/zalo/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đã ngắt kết nối Zalo thành công!', 'success', 'Đăng xuất thành công');
      // Reset dropdown nhóm
      const groupsListDiv = document.getElementById('skyeyes-groups-list');
      if (groupsListDiv) groupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.78rem;">Chưa tải danh sách nhóm</div>';
      updateSkyEyesGroupsDisplayText('');
      fetchSkyEyesState();
    } else {
      showToast(data.error, 'error', 'Đăng xuất thất bại');
    }
  } catch (e) {
    showToast('Lỗi đăng xuất Zalo: ' + e.message, 'error', 'Lỗi kết nối');
  }
}

// Tải cấu hình cài đặt Zalo từ server
async function loadSkyEyesSettings() {
  try {
    const res = await fetch('/api/fms/zalo/settings', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success && data.settings) {
      const { 
        targetGroupId, targetGroupName, notifyEnabled, messageTemplate,
        notifyNewStandby, notifyNewFuelOrder, notifyStandbyChanged, notifyFuelOrderChanged,
        notifyAcRegChanged, notifyGateChanged, notifyEtdChanged,
        fmsImportExportDuration, fmsImportExportGroupId, fmsImportExportGroupName,
        notifyAirlineMismatch, fmsAirlineAlertGroupId, fmsAirlineAlertGroupName,
        airlineMappings
      } = data.settings;
      document.getElementById('skyeyes-notify-enabled').checked = notifyEnabled;
      document.getElementById('skyeyes-template-input').value = messageTemplate || '';
      
      document.getElementById('skyeyes-notify-new-standby').checked = notifyNewStandby !== false;
      document.getElementById('skyeyes-notify-new-fuel-order').checked = notifyNewFuelOrder !== false;
      document.getElementById('skyeyes-notify-standby-changed').checked = notifyStandbyChanged !== false;
      document.getElementById('skyeyes-notify-fuel-order-changed').checked = notifyFuelOrderChanged !== false;
      document.getElementById('skyeyes-notify-ac-reg-changed').checked = notifyAcRegChanged !== false;
      document.getElementById('skyeyes-notify-gate-changed').checked = notifyGateChanged !== false;
      document.getElementById('skyeyes-notify-etd-changed').checked = notifyEtdChanged !== false;
      const airlineCb = document.getElementById('skyeyes-notify-airline-mismatch');
      if (airlineCb) airlineCb.checked = notifyAirlineMismatch !== false;

      if (fmsImportExportDuration === 'always') {
        const rad = document.getElementById('fms-duration-always');
        if (rad) rad.checked = true;
      } else {
        const rad = document.getElementById('fms-duration-24h');
        if (rad) rad.checked = true;
      }
      
      // Lưu lại các giá trị nhóm đã chọn để khi load group list sẽ check
      window.savedTargetGroupIds = targetGroupId ? targetGroupId.split(',').map(id => id.trim()) : [];
      window.savedTargetGroupName = targetGroupName || '';
      
      window.savedIeTargetGroupIds = fmsImportExportGroupId ? fmsImportExportGroupId.split(',').map(id => id.trim()) : [];
      window.savedIeTargetGroupName = fmsImportExportGroupName || '';
      window.savedAirlineTargetGroupIds = fmsAirlineAlertGroupId ? fmsAirlineAlertGroupId.split(',').map(id => id.trim()) : [];
      window.savedAirlineTargetGroupName = fmsAirlineAlertGroupName || '';

      updateSkyEyesGroupsDisplayText(targetGroupName);
      updateSkyEyesIeGroupsDisplayText(fmsImportExportGroupName);
      updateSkyEyesAirlineGroupsDisplayText(fmsAirlineAlertGroupName);
      if (airlineMappings) renderAirlineMappingsChips(airlineMappings);
    }
  } catch (err) {
    console.error('[SkyEyes] Lỗi tải cấu hình Zalo:', err.message);
  }
}

// Cập nhật text hiển thị trên nút chọn nhóm FMS
function updateSkyEyesGroupsDisplayText(namesStr) {
  const displayText = document.getElementById('skyeyes-groups-display-text');
  if (displayText) {
    if (namesStr && namesStr.trim() !== '') {
      displayText.textContent = 'Đã chọn: ' + namesStr;
      displayText.style.color = '#38bdf8';
    } else {
      displayText.textContent = '-- Bấm để chọn các nhóm --';
      displayText.style.color = 'var(--text-muted)';
    }
  }
}

// Cập nhật text hiển thị trên nút chọn nhóm Tạm nhập - Tái xuất riêng biệt
function updateSkyEyesIeGroupsDisplayText(namesStr) {
  const displayText = document.getElementById('skyeyes-ie-groups-display-text');
  if (displayText) {
    if (namesStr && namesStr.trim() !== '') {
      displayText.textContent = 'Đã chọn: ' + namesStr;
      displayText.style.color = '#38bdf8';
    } else {
      displayText.textContent = '-- Dùng chung nhóm thông báo FMS --';
      displayText.style.color = 'var(--text-muted)';
    }
  }
}

function updateSkyEyesAirlineGroupsDisplayText(namesStr) {
  const displayText = document.getElementById('skyeyes-airline-groups-display-text');
  if (displayText) {
    if (namesStr && namesStr.trim() !== '') {
      displayText.textContent = 'Đã chọn: ' + namesStr;
      displayText.style.color = '#38bdf8';
    } else {
      displayText.textContent = '-- Dùng nhóm tạm nhập / FMS --';
      displayText.style.color = 'var(--text-muted)';
    }
  }
}

function renderAirlineMappingsChips(mappings) {
  const el = document.getElementById('airline-mappings-list');
  if (!el || !Array.isArray(mappings)) return;
  el.innerHTML = mappings.map(m =>
    `<span style="background:var(--chip-bg); border:1px solid var(--border); color:var(--text); padding:4px 8px; border-radius:6px; font-weight:600;"><code style="color:var(--primary);">${m.code}</code> → ${m.name}</span>`
  ).join('');
}

// Lưu cấu hình nhóm nhận tin và checkbox bật/tắt
async function handleSaveSkyEyesSettings() {
  const notifyEnabled = document.getElementById('skyeyes-notify-enabled').checked;
  const messageTemplate = document.getElementById('skyeyes-template-input').value;

  const notifyNewStandby = document.getElementById('skyeyes-notify-new-standby').checked;
  const notifyNewFuelOrder = document.getElementById('skyeyes-notify-new-fuel-order').checked;
  const notifyStandbyChanged = document.getElementById('skyeyes-notify-standby-changed').checked;
  const notifyFuelOrderChanged = document.getElementById('skyeyes-notify-fuel-order-changed').checked;
  const notifyAcRegChanged = document.getElementById('skyeyes-notify-ac-reg-changed').checked;
  const notifyGateChanged = document.getElementById('skyeyes-notify-gate-changed').checked;
  const notifyEtdChanged = document.getElementById('skyeyes-notify-etd-changed').checked;
  const airlineMismatchEl = document.getElementById('skyeyes-notify-airline-mismatch');
  const notifyAirlineMismatch = airlineMismatchEl ? airlineMismatchEl.checked : true;
  
  // Thu thập các ID và tên nhóm được tích chọn
  const checkedBoxes = document.querySelectorAll('.skyeyes-group-checkbox:checked');
  const targetGroupId = Array.from(checkedBoxes).map(cb => cb.value).join(',');
  const targetGroupName = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-name')).join(', ');
  
  // Thu thập các ID và tên nhóm riêng được tích chọn
  const checkedBoxesIe = document.querySelectorAll('.skyeyes-ie-group-checkbox:checked');
  const fmsImportExportGroupId = Array.from(checkedBoxesIe).map(cb => cb.value).join(',');
  const fmsImportExportGroupName = Array.from(checkedBoxesIe).map(cb => cb.getAttribute('data-name')).join(', ');

  const checkedBoxesAirline = document.querySelectorAll('.skyeyes-airline-group-checkbox:checked');
  const fmsAirlineAlertGroupId = Array.from(checkedBoxesAirline).map(cb => cb.value).join(',');
  const fmsAirlineAlertGroupName = Array.from(checkedBoxesAirline).map(cb => cb.getAttribute('data-name')).join(', ');
  
  const fmsImportExportDuration = document.querySelector('input[name="fms-import-export-duration"]:checked')?.value || '24h';

  // Lưu tạm vào biến global
  window.savedTargetGroupIds = targetGroupId ? targetGroupId.split(',') : [];
  window.savedTargetGroupName = targetGroupName;
  updateSkyEyesGroupsDisplayText(targetGroupName);

  window.savedIeTargetGroupIds = fmsImportExportGroupId ? fmsImportExportGroupId.split(',') : [];
  window.savedIeTargetGroupName = fmsImportExportGroupName;
  updateSkyEyesIeGroupsDisplayText(fmsImportExportGroupName);

  window.savedAirlineTargetGroupIds = fmsAirlineAlertGroupId ? fmsAirlineAlertGroupId.split(',') : [];
  window.savedAirlineTargetGroupName = fmsAirlineAlertGroupName;
  updateSkyEyesAirlineGroupsDisplayText(fmsAirlineAlertGroupName);

  if (!targetGroupId && notifyEnabled) {
    showToast('Vui lòng chọn ít nhất một nhóm Zalo trước khi bật thông báo!', 'warning', 'Lưu ý');
    document.getElementById('skyeyes-notify-enabled').checked = false;
    return;
  }

  try {
    const res = await fetch('/api/fms/zalo/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ 
        targetGroupId, targetGroupName, notifyEnabled, messageTemplate,
        notifyNewStandby, notifyNewFuelOrder, notifyStandbyChanged, notifyFuelOrderChanged,
        notifyAcRegChanged, notifyGateChanged, notifyEtdChanged,
        fmsImportExportDuration, fmsImportExportGroupId, fmsImportExportGroupName,
        notifyAirlineMismatch, fmsAirlineAlertGroupId, fmsAirlineAlertGroupName
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đã lưu cấu hình trợ lý SkyEyes thành công!', 'success', 'Đã cập nhật');
    } else {
      showToast(data.error, 'error', 'Lưu cấu hình thất bại');
    }
  } catch (e) {
    showToast('Lỗi lưu cấu hình: ' + e.message, 'error', 'Lỗi kết nối');
  }
}

// Thay đổi mẫu tin nhắn từ mẫu soạn sẵn
function handleSkyEyesPresetChange(e) {
  const preset = e.target.value;
  const templateInput = document.getElementById('skyeyes-template-input');
  
  const presets = {
    'preset-1': `{{status_change_title}}
✈️ Chuyến bay: {{flight_no}}
👥 Cặp tra nạp: {{crew_info}}
🚛 Số xe nạp: {{truck_no}}
📍 Vị trí đỗ: {{gate}}
🛩️ Số hiệu tàu: {{ac_reg}} (Loại: {{ac_type}})
---------------------------
⛽ Tải dầu Standby (CFP): {{standby_fuel}} kg
⛽ Tải dầu Chính thức: {{fuel_order}} kg
⏰ Giờ Tra nạp: {{time_fuel}}
⏰ Giờ Hạ/Cất: Hạ {{time_arr}} | Cất {{time_dep}}`,
    'preset-2': `{{status_change_title}}
✈️ Chuyến: {{flight_no}} | Đỗ: {{gate}} | Xe: {{truck_no}}
👥 Cặp: {{crew_info}} | Giờ nạp: {{time_fuel}}
🛩️ Tàu bay: {{ac_reg}} (Loại: {{ac_type}})
⛽ Standby: {{standby_fuel}} kg
⛽ Chính thức: {{fuel_order}} kg`,
    'preset-3': `🔄 [FMS THAY ĐỔI THÔNG TIN CHUYẾN BAY]
✈️ Chuyến bay: {{flight_no}}
🛩️ Số hiệu tàu cũ: {{old_ac_reg}} ➔ Tàu mới: {{ac_reg}}
⛽ Tải dầu Standby cũ: {{old_standby_fuel}} kg ➔ Mới: {{standby_fuel}} kg
⛽ Tải dầu Chính thức cũ: {{old_fuel_order}} kg ➔ Mới: {{fuel_order}} kg
📍 Vị trí đỗ: {{gate}} (Tổ nạp: {{crew_info}})`
  };

  if (preset && presets[preset]) {
    templateInput.value = presets[preset];
    handleSaveSkyEyesSettings();
  }
}

// Gửi thử tin nhắn giả lập cảnh báo Zalo Bot (5 kịch bản test)
async function runZaloTestScenario(scenario) {
  const checkedBoxes = document.querySelectorAll('.skyeyes-group-checkbox:checked');
  const groupId = Array.from(checkedBoxes).map(cb => cb.value).join(',');
  if (!groupId) {
    showToast('Vui lòng chọn ít nhất một nhóm Zalo nhận tin trước khi test!', 'warning', 'Lưu ý');
    return;
  }

  let btnId = '';
  if (scenario === 'new-fuel') btnId = 'btn-test-zalo-new-fuel';
  else if (scenario === 'update-fuel') btnId = 'btn-test-zalo-update-fuel';
  else if (scenario === 'change-ac') btnId = 'btn-test-zalo-change-ac';
  else if (scenario === 'change-gate') btnId = 'btn-test-zalo-change-gate';
  else if (scenario === 'change-etd') btnId = 'btn-test-zalo-change-etd';
  else if (scenario === 'remind-schedule') btnId = 'btn-test-zalo-remind-schedule';

  const btn = document.getElementById(btnId);
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = btn.innerHTML.replace(/<i[^>]*><\/i>/, '<i class="fa-solid fa-circle-notch fa-spin"></i>');
  }

  try {
    const res = await fetch('/api/fms/zalo/test-scenario', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ scenario })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đã gửi tin nhắn test kịch bản thành công! Hãy kiểm tra nhóm Zalo.', 'success', 'Gửi test thành công');
    } else {
      showToast(data.error, 'error', 'Gửi test thất bại');
    }
  } catch (e) {
    showToast('Lỗi gửi test Zalo: ' + e.message, 'error', 'Lỗi kết nối');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  }
}

// Tải danh sách các nhóm Zalo từ tài khoản đăng nhập
// Tải danh sách các nhóm Zalo từ tài khoản đăng nhập
async function loadSkyEyesGroups() {
  const groupsListDiv = document.getElementById('skyeyes-groups-list');
  const ieGroupsListDiv = document.getElementById('skyeyes-ie-groups-list');
  const airlineGroupsListDiv = document.getElementById('skyeyes-airline-groups-list');
  
  if (groupsListDiv) groupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.78rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải...</div>';
  if (ieGroupsListDiv) ieGroupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.78rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải...</div>';
  if (airlineGroupsListDiv) airlineGroupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.78rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải...</div>';

  try {
    const res = await fetch('/api/fms/zalo/groups', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success && data.groups) {
      const groups = data.groups;
      if (groups.length === 0) {
        if (groupsListDiv) groupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.78rem;">Không tìm thấy nhóm nào</div>';
        if (ieGroupsListDiv) ieGroupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.78rem;">Không tìm thấy nhóm nào</div>';
        if (airlineGroupsListDiv) airlineGroupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.78rem;">Không tìm thấy nhóm nào</div>';
        return;
      }

      // Lấy các cài đặt Zalo để check trạng thái
      const dbRes = await fetch('/api/fms/zalo/settings', {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const dbData = await dbRes.json();
      
      const savedGroupId = dbData.success ? dbData.settings.targetGroupId : '';
      const savedGroupIdsArray = savedGroupId ? savedGroupId.split(',').map(id => id.trim()) : [];
      const savedGroupName = dbData.success ? dbData.settings.targetGroupName : '';

      const savedIeGroupId = dbData.success ? dbData.settings.fmsImportExportGroupId : '';
      const savedIeGroupIdsArray = savedIeGroupId ? savedIeGroupId.split(',').map(id => id.trim()) : [];
      const savedIeGroupName = dbData.success ? dbData.settings.fmsImportExportGroupName : '';

      const savedAirlineGroupId = dbData.success ? dbData.settings.fmsAirlineAlertGroupId : '';
      const savedAirlineGroupIdsArray = savedAirlineGroupId ? savedAirlineGroupId.split(',').map(id => id.trim()) : [];
      const savedAirlineGroupName = dbData.success ? dbData.settings.fmsAirlineAlertGroupName : '';

      window.savedTargetGroupIds = savedGroupIdsArray;
      window.savedTargetGroupName = savedGroupName;
      window.savedIeTargetGroupIds = savedIeGroupIdsArray;
      window.savedIeTargetGroupName = savedIeGroupName;
      window.savedAirlineTargetGroupIds = savedAirlineGroupIdsArray;
      window.savedAirlineTargetGroupName = savedAirlineGroupName;

      const renderGroupChecks = (listEl, className, savedIds) => {
        if (!listEl) return;
        listEl.innerHTML = groups.map(g => {
          const isChecked = savedIds.includes(String(g.groupId).trim());
          return `
            <label class="group-item-hover skyeyes-group-label" style="display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; cursor: pointer; user-select: none; transition: background 0.2s; justify-content: flex-start; text-align: left; width: 100%; box-sizing: border-box;">
              <input type="checkbox" class="${className}" value="${g.groupId}" data-name="${g.groupName}" ${isChecked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; flex-shrink: 0;">
              <span class="skyeyes-group-label-text" style="font-size: 0.82rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 260px;">${g.groupName}</span>
            </label>
          `;
        }).join('');
        document.querySelectorAll('.' + className).forEach(cb => {
          cb.addEventListener('change', handleSaveSkyEyesSettings);
        });
      };

      renderGroupChecks(groupsListDiv, 'skyeyes-group-checkbox', savedGroupIdsArray);
      renderGroupChecks(ieGroupsListDiv, 'skyeyes-ie-group-checkbox', savedIeGroupIdsArray);
      renderGroupChecks(airlineGroupsListDiv, 'skyeyes-airline-group-checkbox', savedAirlineGroupIdsArray);

      updateSkyEyesGroupsDisplayText(savedGroupName);
      updateSkyEyesIeGroupsDisplayText(savedIeGroupName);
      updateSkyEyesAirlineGroupsDisplayText(savedAirlineGroupName);
    } else {
      if (groupsListDiv) groupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: #ef4444; font-size: 0.78rem;">Quét nhóm thất bại</div>';
      if (ieGroupsListDiv) ieGroupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: #ef4444; font-size: 0.78rem;">Quét nhóm thất bại</div>';
      if (airlineGroupsListDiv) airlineGroupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: #ef4444; font-size: 0.78rem;">Quét nhóm thất bại</div>';
    }
  } catch (err) {
    console.error('[SkyEyes] Lỗi tải danh sách nhóm:', err.message);
    if (groupsListDiv) groupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: #ef4444; font-size: 0.78rem;">Lỗi tải danh sách nhóm</div>';
    if (ieGroupsListDiv) ieGroupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: #ef4444; font-size: 0.78rem;">Lỗi tải danh sách nhóm</div>';
    if (airlineGroupsListDiv) airlineGroupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: #ef4444; font-size: 0.78rem;">Lỗi tải danh sách nhóm</div>';
  }
}

// --- CẢNH BÁO SAI TÊN HÃNG HK ---
async function fetchAirlineAlerts() {
  try {
    const filterInput = document.getElementById('fms-filter-date');
    const date = filterInput && filterInput.value ? filterInput.value : '';
    const res = await fetch('/api/fms/airline-alerts' + (date ? `?date=${date}` : ''), {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    if (data.mappings) renderAirlineMappingsChips(data.mappings);
    const tbody = document.getElementById('airline-alerts-body');
    if (!tbody) return;
    const rows = data.data || [];
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">Chưa có cảnh báo sai tên hãng.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const status = r.is_warned >= 2
        ? '<span style="color:var(--success);font-weight:600;">Đã xử lý</span>'
        : '<span style="color:#dc2626;font-weight:600;">Cảnh báo</span>';
      const actualDisplay = (r.actual_name && r.actual_name !== '-')
        ? r.actual_name
        : (r.actual_carrier || '-');
      return `<tr class="${r.is_warned >= 2 ? 'row-resolved' : ''}">
        <td><code style="color:var(--primary);font-weight:700;">${r.flight_no}</code></td>
        <td><strong>${r.expected_code}</strong></td>
        <td style="font-size:0.78rem;max-width:220px;">${r.expected_name}</td>
        <td style="font-size:0.78rem;max-width:220px;"><span style="color:#dc2626;font-weight:700;">${actualDisplay}</span></td>
        <td style="font-size:0.8rem;">${r.crew_info || '-'}</td>
        <td>${r.date || '-'}</td>
        <td style="text-align:center;">
          ${status}
          <div style="display:flex;gap:4px;justify-content:center;margin-top:4px;">
            <button class="btn-secondary" style="margin:0;padding:3px 8px;font-size:0.7rem;" onclick="confirmAirlineAlert(${r.id},'confirm')">OK</button>
            <button class="btn-secondary" style="margin:0;padding:3px 8px;font-size:0.7rem;color:var(--danger);" onclick="confirmAirlineAlert(${r.id},'delete')">Xóa</button>
          </div>
        </td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('[Airline Alerts]', err.message);
  }
}

async function confirmAirlineAlert(id, action) {
  try {
    const res = await fetch('/api/fms/airline-alerts/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ id, action })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast(data.message, 'success', 'OK');
    fetchAirlineAlerts();
  } catch (err) {
    showToast(err.message, 'error', 'Lỗi');
  }
}

async function runAirlineAlertTest(scenario) {
  const preview = document.getElementById('airline-test-preview');
  if (preview) preview.textContent = 'Đang gửi kịch bản test...';
  try {
    const res = await fetch('/api/fms/airline-alerts/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${state.token}` },
      body: JSON.stringify({ scenario })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    if (preview && data.preview) preview.textContent = data.preview;
    showToast(data.message, 'success', 'Test hãng HK');
    fetchAirlineAlerts();
  } catch (err) {
    if (preview) preview.textContent = 'Lỗi: ' + err.message;
    showToast(err.message, 'error', 'Test thất bại');
  }
}

window.fetchAirlineAlerts = fetchAirlineAlerts;
window.confirmAirlineAlert = confirmAirlineAlert;
window.runAirlineAlertTest = runAirlineAlertTest;

// --- LOGIC QUẢN LÝ ZALO MAPPINGS VÀ THÀNH VIÊN NHÓM ---
async function openZaloMappingsModal() {
  const modal = document.getElementById('zalo-mappings-modal');
  if (!modal) return;
  modal.classList.add('active');

  // Nạp danh sách tên từ lịch trực hiện tại
  populateScheduleNameSelect();

  await Promise.all([
    loadZaloMappingsList(),
    loadZaloGroupMembers()
  ]);
}

async function loadZaloMappingsList() {
  try {
    const res = await fetch('/api/fms/zalo/mappings', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      state.zaloMappings = data.mappings || [];
      renderZaloMappingsListTable();
    }
  } catch (err) {
    console.error('Lỗi tải danh sách mappings:', err.message);
  }
}

function renderZaloMappingsListTable() {
  const tbody = document.getElementById('zalo-mappings-list-tbody');
  const searchInput = document.getElementById('search-zalo-mapping');
  const query = searchInput ? searchInput.value.trim().toUpperCase() : '';

  if (!tbody) return;

  const filtered = state.zaloMappings.filter(m => {
    if (query) {
      const scheduleName = (m.schedule_name || '').toUpperCase();
      const zaloName = (m.zalo_name || '').toUpperCase();
      return scheduleName.includes(query) || zaloName.includes(query);
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--text-muted); padding: 15px;">Không tìm thấy liên kết nào</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(m => {
    return `
      <tr>
        <td style="font-weight: 700; color: #fb923c;">${m.schedule_name}</td>
        <td><span style="font-weight: bold; color: #fff;">${m.zalo_name || '-'}</span><br><span style="font-size: 0.72rem; color: var(--text-muted);">${m.zalo_uid}</span></td>
        <td style="text-align: center;">
          <div style="display: flex; gap: 6px; justify-content: center;">
            <button class="btn-edit-mapping" data-name="${m.schedule_name}" data-uid="${m.zalo_uid}" style="padding: 3px 6px; font-size: 0.7rem; margin-top: 0; background: rgba(56, 189, 248, 0.1); border-color: rgba(56, 189, 248, 0.3); color: #38bdf8; cursor: pointer; border-radius: 4px;">Sửa</button>
            <button class="btn-delete-mapping" data-name="${m.schedule_name}" style="padding: 3px 6px; font-size: 0.7rem; margin-top: 0; background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #ef4444; cursor: pointer; border-radius: 4px;">Xóa</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Đăng ký sự kiện nút sửa/xóa
  tbody.querySelectorAll('.btn-edit-mapping').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const name = e.target.getAttribute('data-name');
      const uid = e.target.getAttribute('data-uid');
      
      const selectName = document.getElementById('mapping-schedule-name-select');
      const inputName = document.getElementById('mapping-schedule-name');
      
      if (selectName) {
        // Kiểm tra xem name có tồn tại trong select option hay không
        let hasOption = false;
        for (let i = 0; i < selectName.options.length; i++) {
          if (selectName.options[i].value === name) {
            hasOption = true;
            break;
          }
        }
        
        if (hasOption) {
          selectName.value = name;
          if (inputName) {
            inputName.style.display = 'none';
            inputName.value = name;
          }
        } else {
          selectName.value = 'custom';
          if (inputName) {
            inputName.style.display = 'block';
            inputName.value = name;
          }
        }
      } else if (inputName) {
        inputName.value = name;
      }
      
      const select = document.getElementById('mapping-zalo-uid');
      if (select) select.value = uid;
    });
  });

  tbody.querySelectorAll('.btn-delete-mapping').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const name = e.target.getAttribute('data-name');
      if (confirm(`Bạn có chắc chắn muốn xóa liên kết của nhân viên ${name}?`)) {
        try {
          const res = await fetch('/api/fms/zalo/mappings', {
            method: 'DELETE',
            headers: { 
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${state.token}` 
            },
            body: JSON.stringify({ scheduleName: name })
          });
          const data = await res.json();
          if (data.success) {
            showToast(data.message, 'success', 'Thành công');
            loadZaloMappingsList();
            fetchUnmappedCrews();
          } else {
            throw new Error(data.error);
          }
        } catch (err) {
          showToast(err.message, 'error', 'Xóa thất bại');
        }
      }
    });
  });
}

async function loadZaloGroupMembers() {
  try {
    const res = await fetch('/api/fms/zalo/group-members', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      state.zaloMembers = data.members || [];
      
      const select = document.getElementById('mapping-zalo-uid');
      if (select) {
        let optionsHtml = '<option value="">-- Chọn thành viên Zalo --</option>';
        state.zaloMembers.forEach(mem => {
          optionsHtml += `<option value="${mem.uid}">${mem.displayName}</option>`;
        });
        select.innerHTML = optionsHtml;
      }

      renderZaloGroupMembersTable();
    }
  } catch (err) {
    console.error('Lỗi tải danh sách thành viên Zalo:', err.message);
  }
}

function renderZaloGroupMembersTable() {
  const tbody = document.getElementById('zalo-group-members-tbody');
  const searchInput = document.getElementById('search-zalo-member');
  const query = searchInput ? searchInput.value.trim().toUpperCase() : '';

  if (!tbody) return;

  const filtered = state.zaloMembers.filter(mem => {
    if (query) {
      const displayName = (mem.displayName || '').toUpperCase();
      const uid = (mem.uid || '').toUpperCase();
      return displayName.includes(query) || uid.includes(query);
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" style="text-align: center; color: var(--text-muted); padding: 15px;">Không tìm thấy thành viên nào</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(mem => {
    return `
      <tr class="zalo-member-row-click" data-uid="${mem.uid}" style="cursor: pointer; transition: background 0.2s;">
        <td style="font-weight: 700; color: #38bdf8;">${mem.displayName}</td>
        <td style="color: var(--text-muted); font-size: 0.72rem;">${mem.uid}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.zalo-member-row-click').forEach(row => {
    row.addEventListener('mouseenter', () => row.style.background = 'rgba(255,255,255,0.05)');
    row.addEventListener('mouseleave', () => row.style.background = 'transparent');
    row.addEventListener('click', (e) => {
      const tr = e.currentTarget;
      const uid = tr.getAttribute('data-uid');
      const select = document.getElementById('mapping-zalo-uid');
      if (select) {
        select.value = uid;
      }
    });
  });
}

async function handleSaveSingleMapping() {
  const nameInput = document.getElementById('mapping-schedule-name');
  const select = document.getElementById('mapping-zalo-uid');
  
  const scheduleName = nameInput ? nameInput.value.trim() : '';
  const zaloUid = select ? select.value : '';
  const zaloName = select && select.selectedIndex > 0 ? select.options[select.selectedIndex].text : '';

  if (!scheduleName || !zaloUid) {
    showToast('Vui lòng điền đầy đủ Tên trên lịch trực và chọn Tài khoản Zalo!', 'error', 'Thiếu thông tin');
    return;
  }

  const btn = document.getElementById('btn-save-single-mapping');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang lưu...';

  try {
    const res = await fetch('/api/fms/zalo/mappings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ scheduleName, zaloUid, zaloName })
    });
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success', 'Thành công');
      nameInput.value = '';
      if (select) select.value = '';
      await loadZaloMappingsList();
      fetchUnmappedCrews();
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    showToast(err.message, 'error', 'Lưu thất bại');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// Helper lấy ngày trực theo chuỗi tiếng Việt dài
function getVNDateLongString(dateStr) {
  const days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const dayName = days[d.getDay()];
  return `${dayName}, ngày ${parts[2]} tháng ${parts[1]} năm ${parts[0]}`;
}

// Hàm xuất Excel lịch trực chuẩn định dạng lichtruc.xlsx của Skypec
function exportFmsScheduleToExcel() {
  if (!cachedFmsRows || cachedFmsRows.length === 0) {
    showToast('Không có dữ liệu lịch trực để xuất Excel!', 'warning', 'Không có dữ liệu');
    return;
  }

  const dateInput = document.getElementById('fms-filter-date');
  const selectedDate = dateInput ? dateInput.value : '';

  const excelRows = [];
  
  // Dòng 0-2: Tiêu đề theo chuẩn Skypec
  excelRows.push(['CÔNG TY TNHH MTV NHIÊN LIỆU HÀNG KHÔNG VIỆT NAM (SKYPEC)', '', '', '', '', '', '', 'KẾ HOẠCH TRA NẠP NHIÊN LIỆU']);
  excelRows.push(['CHI NHÁNH SKYPEC KHU VỰC MIỀN BẮC', '', '', '', '', '', '', getVNDateLongString(selectedDate)]);
  excelRows.push(['     ĐƠN VỊ: TRUNG TÂM KHAI THÁC', '', '', '', '', '', '', 'KẾ HOẠCH PHÂN CÔNG CHI TIẾT']);
  excelRows.push([]); // Dòng trống 3
  
  // Dòng 4-6: Header gộp ô và chỉ số cột theo mẫu chuẩn
  excelRows.push(['STT', 'LOẠI TÀU BAY', 'THÔNG TIN CHUYẾN BAY', '', '', 'SẢN LƯỢNG DỰ KIẾN (KG)', 'THỜI GIAN DỰ KIẾN', '', '', 'VỊ TRÍ', 'SỐ HIỆU XE TRA NẠP', 'NGƯỜI THỰC HIỆN', '', '', 'GHI CHÚ']);
  excelRows.push(['', '', 'SỐ HIỆU TÀU BAY', 'SỐ HIỆU CHUYẾN BAY', 'ĐƯỜNG BAY', '', 'HẠ CÁNH', 'CẤT CÁNH', 'TRA NẠP', '', '', 'LÁI XE', 'NHÂN VIÊN TRA NẠP', 'TRỰC CHỈ HUY']);
  excelRows.push([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  
  // Dòng 7 trở đi: Dữ liệu lịch trực
  cachedFmsRows.forEach((r, idx) => {
    let driver = '';
    let operator = '';
    if (r.crew_info) {
      const parts = r.crew_info.split('-');
      if (parts.length === 2) {
        driver = parts[0].trim();
        operator = parts[1].trim();
      } else {
        driver = r.crew_info;
      }
    }
    
    // Định dạng số hiệu chuyến bay dạng "VN 1549" thay vì viết liền
    let formattedFltNo = r.flight_no || '';
    const fltMatch = formattedFltNo.match(/^([A-Za-z]+)(\d+)$/);
    if (fltMatch) {
      formattedFltNo = `${fltMatch[1]} ${fltMatch[2]}`;
    }
    
    excelRows.push([
      idx + 1,
      r.ac_type || '',
      r.ac_reg || '',
      formattedFltNo,
      r.route || '',
      r.fuel_order ? parseInt(r.fuel_order) : '',
      r.time_arr || '',
      r.time_dep || '',
      r.time_fuel || '',
      r.gate || '',
      r.truck_no || '',
      driver,
      operator,
      '',
      r.status || ''
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(excelRows);

  // Merges cells
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 0, c: 7 }, e: { r: 0, c: 14 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
    { s: { r: 1, c: 7 }, e: { r: 1, c: 14 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } },
    { s: { r: 2, c: 7 }, e: { r: 2, c: 14 } },
    
    { s: { r: 4, c: 0 }, e: { r: 5, c: 0 } },
    { s: { r: 4, c: 1 }, e: { r: 5, c: 1 } },
    { s: { r: 4, c: 2 }, e: { r: 4, c: 4 } },
    { s: { r: 4, c: 5 }, e: { r: 5, c: 5 } },
    { s: { r: 4, c: 6 }, e: { r: 4, c: 8 } },
    { s: { r: 4, c: 9 }, e: { r: 5, c: 9 } },
    { s: { r: 4, c: 10 }, e: { r: 5, c: 10 } },
    { s: { r: 4, c: 11 }, e: { r: 4, c: 13 } },
    { s: { r: 4, c: 14 }, e: { r: 5, c: 14 } }
  ];

  // Chiều rộng cột
  ws['!cols'] = [
    { wch: 6 },  // STT
    { wch: 15 }, // Loại tàu bay
    { wch: 15 }, // Số hiệu tàu bay
    { wch: 15 }, // Số hiệu chuyến bay
    { wch: 12 }, // Đường bay
    { wch: 15 }, // Sản lượng dự kiến
    { wch: 10 }, // Hạ cánh
    { wch: 10 }, // Cất cánh
    { wch: 10 }, // Tra nạp
    { wch: 8 },  // Vị trí
    { wch: 12 }, // Số hiệu xe
    { wch: 12 }, // Lái xe
    { wch: 18 }, // Nhân viên tra nạp
    { wch: 15 }, // Trực chỉ huy
    { wch: 15 }  // Ghi chú
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `Lich_truc_Skypec_${selectedDate}.xlsx`);
  showToast('Xuất file Excel lịch trực thành công!', 'success', 'Thành công');
}

// --- LOGIC THỐNG KÊ CHUYẾN BAY FMS VÀ MODAL CHI TIẾT DÀNH CHO USER ---
let userFmsStatsData = null;

async function loadUserFmsStats() {
  try {
    const username = state.username || localStorage.getItem('crm_username');
    if (!username) return;

    const res = await fetch('/api/fms/user-stats', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      userFmsStatsData = data.data;

      // Cập nhật các ô hiển thị số chuyến bay lên header màn hình user
      const todayEl = document.getElementById('user-stat-today');
      const monthEl = document.getElementById('user-stat-month');
      const lastMonthEl = document.getElementById('user-stat-last-month');

      if (todayEl) todayEl.textContent = data.data.todayCount;
      if (monthEl) monthEl.textContent = data.data.monthCount;
      if (lastMonthEl) lastMonthEl.textContent = data.data.lastMonthCount;
    }
  } catch (err) {
    console.error('Lỗi khi tải thông tin thống kê chuyến bay của nhân viên:', err.message);
  }
}

let currentModalFlights = [];

function renderUserFmsDetailTable(flights) {
  const tbody = document.getElementById('user-fms-detail-tbody');
  const countEl = document.getElementById('user-fms-filtered-count');
  if (!tbody) return;

  if (countEl) countEl.textContent = flights.length;

  if (flights.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Chưa có lịch bay phù hợp với bộ lọc này.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = flights.map((r, index) => {
    // Xác định trạng thái "Chưa lên hệ thống hoặc không lấy dầu"
    const isNoRefuel = !r.fuel_order || r.fuel_order === '---' || r.fuel_order === '0' || r.status === 'Chờ cập nhật' || r.status === 'Ko lấy dầu';
    
    let statusHtml = '';
    if (isNoRefuel) {
      statusHtml = `<span class="fms-no-refuel-blink">Chưa lên hệ thống hoặc không lấy dầu</span>`;
    } else {
      statusHtml = `<span class="status-tag review-finished" style="background: rgba(74, 222, 128, 0.15); color: var(--green); border: 1px solid rgba(74, 222, 128, 0.3); padding: 4px 8px; border-radius: 4px; font-weight: bold; font-size: 0.85em;">Đã có số liệu</span>`;
    }

    return `
      <tr>
        <td style="text-align: center; font-weight: bold; color: var(--text-muted); font-size: 0.85rem; width: 50px;">${index + 1}</td>
        <td style="font-weight: 700; color: #38bdf8; font-size: 0.95rem;">${r.flight_no}</td>
        <td style="color: #60a5fa; font-weight: 500;">${r.route || '-'}</td>
        <td style="text-align: center;">
          <span style="font-weight: bold; color: #fff;">${r.ac_reg || '-'}</span>
          <span style="color: var(--text-muted); font-size: 0.8em;"> (${r.ac_type || '-'})</span>
        </td>
        <td style="text-align: center; font-weight: bold; color: #f59e0b;">${r.gate || '-'}</td>
        <td style="text-align: center; font-weight: bold; color: #fb923c;">${r.time_fuel || '-'}</td>
        <td><span style="font-size: 0.9em; color: var(--primary); font-weight: 500;">${r.truck_no && r.truck_no !== '-' ? (String(r.truck_no).includes('Xe') || String(r.truck_no).includes('HAN') ? r.truck_no : 'Xe ' + r.truck_no) : '-'}</span></td>
        <td><span style="font-weight: 600; color: #fff;">${r.crew_info || (r.driver_name && r.operator_name ? r.driver_name + ' - ' + r.operator_name : '-')}</span></td>
        <td style="text-align: center;">${statusHtml}</td>
      </tr>
    `;
  }).join('');
}

window.currentViewingFmsName = '';

window.showUserFmsDetailModal = function(period) {
  console.log('[DEBUG_FMS_MODAL] Gọi hàm showUserFmsDetailModal với period:', period);
  const modal = document.getElementById('user-fms-detail-modal');
  const titleEl = document.getElementById('user-fms-detail-title');
  const tbody = document.getElementById('user-fms-detail-tbody');
  
  if (!modal || !tbody || !userFmsStatsData) {
    console.warn('[DEBUG_FMS_MODAL] Hủy mở modal vì thiếu modal, tbody hoặc userFmsStatsData!');
    showToast('Chưa có dữ liệu thống kê, vui lòng đợi trong giây lát!', 'warning', 'Chờ tải');
    return;
  }

  // Tự động tạo period tabs bằng JS nếu bị cache HTML cũ
  let tabsContainer = document.querySelector('.fms-modal-period-tabs');
  if (!tabsContainer) {
    tabsContainer = document.createElement('div');
    tabsContainer.className = 'fms-modal-period-tabs';
    tabsContainer.style.cssText = 'display: flex; gap: 8px; margin-bottom: 15px; flex-wrap: wrap;';
    tabsContainer.innerHTML = `
      <button id="btn-fms-period-today" class="btn-secondary" onclick="switchFmsModalPeriod('today')" style="margin: 0; padding: 6px 16px; font-size: 0.8rem; border-radius: 20px; font-weight: 600; width: auto; background: none; color: var(--text-muted); border-color: var(--border);">
        <i class="fa-solid fa-calendar-day"></i> Hôm nay
      </button>
      <button id="btn-fms-period-month" class="btn-secondary active" onclick="switchFmsModalPeriod('month')" style="margin: 0; padding: 6px 16px; font-size: 0.8rem; border-radius: 20px; font-weight: 600; width: auto; background: #34d399; color: #fff; border-color: #34d399;">
        <i class="fa-solid fa-calendar-week"></i> Tháng này
      </button>
      <button id="btn-fms-period-last-month" class="btn-secondary" onclick="switchFmsModalPeriod('last-month')" style="margin: 0; padding: 6px 16px; font-size: 0.8rem; border-radius: 20px; font-weight: 600; width: auto; background: none; color: var(--text-muted); border-color: var(--border);">
        <i class="fa-solid fa-calendar-minus"></i> Tháng trước
      </button>
    `;
    
    const filterToolbar = document.querySelector('.fms-filter-toolbar');
    if (filterToolbar && filterToolbar.parentNode) {
      filterToolbar.parentNode.insertBefore(tabsContainer, filterToolbar);
    }
  }

  // Đồng bộ trạng thái tab
  syncFmsPeriodTabUI(period);

  let titleText = '';
  let flights = [];
  
  const suffix = window.currentViewingFmsName ? ` của <strong>${window.currentViewingFmsName}</strong>` : '';
  
  if (period === 'today') {
    titleText = `<i class="fa-solid fa-plane-departure" style="color: var(--primary);"></i> Chi tiết chuyến trực ca hôm nay${suffix}`;
    flights = userFmsStatsData.todayFlights || [];
  } else if (period === 'month') {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const currentMonth = vnTime.getUTCMonth() + 1;
    titleText = `<i class="fa-solid fa-plane-departure" style="color: #34d399;"></i> Chi tiết chuyến trực ca tháng ${currentMonth}${suffix}`;
    flights = userFmsStatsData.monthFlights || [];
  } else if (period === 'last-month') {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    let lastMonth = vnTime.getUTCMonth();
    if (lastMonth === 0) lastMonth = 12;
    titleText = `<i class="fa-solid fa-plane-departure" style="color: #fb923c;"></i> Chi tiết chuyến trực ca tháng ${lastMonth}${suffix}`;
    flights = userFmsStatsData.lastMonthFlights || [];
  }

  titleEl.innerHTML = titleText;
  
  // Lưu vào biến toàn cục và reset filter checkbox
  currentModalFlights = flights;
  const totalCountEl = document.getElementById('user-fms-total-count');
  if (totalCountEl) totalCountEl.textContent = flights.length;
  
  const filterCheckbox = document.getElementById('user-fms-filter-no-refuel');
  if (filterCheckbox) filterCheckbox.checked = false;

  // Render bảng
  renderUserFmsDetailTable(flights);

  modal.classList.add('active');
};

// Gắn sự kiện đóng modal và bộ lọc chi tiết FMS của user
document.addEventListener('DOMContentLoaded', () => {
  const closeBtn = document.getElementById('btn-close-user-fms-detail-modal');
  const modal = document.getElementById('user-fms-detail-modal');
  
  if (closeBtn && modal) {
    closeBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('active');
      }
    });
  }

  // Bộ lọc loại bỏ chuyến không lấy dầu
  const filterCheckbox = document.getElementById('user-fms-filter-no-refuel');
  if (filterCheckbox) {
    filterCheckbox.addEventListener('change', (e) => {
      if (e.target.checked) {
        const filtered = currentModalFlights.filter(r => {
          const isNoRefuel = !r.fuel_order || r.fuel_order === '---' || r.fuel_order === '0' || r.status === 'Chờ cập nhật' || r.status === 'Ko lấy dầu';
          return !isNoRefuel;
        });
        renderUserFmsDetailTable(filtered);
      } else {
        renderUserFmsDetailTable(currentModalFlights);
      }
    });
  }
});

window.loadAdminFmsStats = async function() {
  const tbody = document.getElementById('admin-fms-stats-tbody');
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">
        <i class="fa-solid fa-spinner fa-spin"></i> Đang tính toán và tải dữ liệu thống kê...
      </td>
    </tr>
  `;

  try {
    const res = await fetch('/api/fms/admin-stats', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const stats = data.data;
    if (stats.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 30px; color: var(--text-muted);">
            Chưa có tài khoản nhân viên nào được tạo trên hệ thống.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = stats.map((u, index) => {
      return `
        <tr>
          <td style="text-align: center; font-weight: bold; color: var(--text-muted); font-size: 0.85rem;">${index + 1}</td>
          <td style="font-family: monospace; font-weight: 600;"><code>${u.username}</code></td>
          <td style="font-weight: bold; color: #fff;">${u.display_name}</td>
          <td>${u.position_name} | ${u.department}</td>
          <td style="text-align: center; font-weight: bold; color: var(--primary); font-size: 1rem;">${u.todayCount}</td>
          <td style="text-align: center; font-weight: bold; color: #34d399; font-size: 1rem;">${u.monthCount}</td>
          <td style="text-align: center; font-weight: bold; color: #fb923c; font-size: 1rem;">${u.lastMonthCount}</td>
          <td style="text-align: center;">
            <button class="btn-glow" onclick="showAdminUserFmsDetail('${u.username}', '${u.display_name}')" style="margin: 0; padding: 5px 12px; font-size: 0.8rem; background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%); width: auto; border: none;">
              <i class="fa-solid fa-eye"></i> Chi tiết
            </button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 30px; color: var(--danger-color); font-weight: bold;">
          Lỗi: ${err.message}
        </td>
      </tr>
    `;
    showToast(err.message, 'danger');
  }
};

window.showAdminUserFmsDetail = async function(username, displayName) {
  try {
    showToast(`Đang tải chi tiết chuyến bay của ${displayName}...`, 'info');
    const res = await fetch(`/api/fms/user-stats?username=${username}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // Lưu vào biến toàn cục của modal
    userFmsStatsData = data.data;
    
    // Gán tên nhân viên đang xem để hiển thị tiêu đề động trong modal
    window.currentViewingFmsName = displayName;
    
    // Mở modal chi tiết (mặc định mở tháng này)
    showUserFmsDetailModal('month');
  } catch (err) {
    showToast(err.message, 'danger');
  }
};

window.switchFmsModalPeriod = function(period) {
  showUserFmsDetailModal(period);
};

window.syncFmsPeriodTabUI = function(period) {
  const btnToday = document.getElementById('btn-fms-period-today');
  const btnMonth = document.getElementById('btn-fms-period-month');
  const btnLastMonth = document.getElementById('btn-fms-period-last-month');
  
  if (btnToday && btnMonth && btnLastMonth) {
    [btnToday, btnMonth, btnLastMonth].forEach(btn => {
      btn.classList.remove('active');
      btn.style.background = 'none';
      btn.style.color = 'var(--text-muted)';
      btn.style.borderColor = 'var(--border)';
    });
    
    let activeBtn;
    let activeColor = 'var(--primary)';
    if (period === 'today') {
      activeBtn = btnToday;
      activeColor = 'var(--primary)';
    } else if (period === 'month') {
      activeBtn = btnMonth;
      activeColor = '#34d399';
    } else if (period === 'last-month') {
      activeBtn = btnLastMonth;
      activeColor = '#fb923c';
    }
    
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.style.background = activeColor;
      activeBtn.style.color = '#fff';
      activeBtn.style.borderColor = activeColor;
    }
  }
};

// Trích xuất từng người (Lái / NV) từ lịch để dropdown liên kết Zalo
function populateScheduleNameSelect() {
  const select = document.getElementById('mapping-schedule-name-select');
  if (!select) return;

  const people = collectPeopleFromRows(
    (Array.isArray(cachedFmsRows) && cachedFmsRows.length)
      ? cachedFmsRows
      : (Array.isArray(state.schedules) ? state.schedules : [])
  );

  let optionsHtml = '<option value="">-- Chọn tên từ lịch trực --</option>';
  people.forEach(p => {
    const role = personRoleMeta(p.roles);
    optionsHtml += `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${role.label})</option>`;
  });
  optionsHtml += '<option value="custom">-- Nhập tên khác --</option>';

  select.innerHTML = optionsHtml;
}

// Đăng ký sự kiện thay đổi dropdown tên mapping
function initMappingScheduleNameSelectEvent() {
  const select = document.getElementById('mapping-schedule-name-select');
  const input = document.getElementById('mapping-schedule-name');
  if (!select || !input) return;
  
  select.addEventListener('change', () => {
    if (select.value === 'custom') {
      input.style.display = 'block';
      input.value = '';
      input.focus();
    } else {
      input.style.display = 'none';
      input.value = select.value;
    }
  });
}

// Tải danh sách nhân sự chưa map Zalo của ngày trực hiện tại
async function fetchUnmappedCrews() {
  try {
    const listContainer = document.getElementById('unmapped-crews-list');
    if (!listContainer) return;

    const res = await fetch('/api/fms/zalo/unmapped-crews', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error);
    }

    const unmapped = data.unmapped || [];
    if (unmapped.length === 0) {
      listContainer.innerHTML = `
        <span style="font-size: 0.82rem; color: #10b981; font-weight: 600; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-circle-check"></i> Tuyệt vời! Tất cả nhân sự trực hôm nay đã liên kết Zalo.
        </span>
      `;
      // Đổi border màu xanh lá cho card
      const card = document.getElementById('unmapped-crews-card');
      if (card) {
        card.style.borderColor = 'rgba(16, 185, 129, 0.25)';
        card.style.background = 'rgba(16, 185, 129, 0.03)';
      }
      return;
    }

    // Trả lại border màu đỏ nhạt cho card
    const card = document.getElementById('unmapped-crews-card');
    if (card) {
      card.style.borderColor = 'rgba(239, 68, 68, 0.25)';
      card.style.background = 'rgba(239, 68, 68, 0.03)';
    }

    let buttonsHtml = '';
    unmapped.forEach(item => {
      // Hỗ trợ cả object {name, roles} và string cũ
      const name = typeof item === 'string' ? item.replace(/\s*\([^)]*\)\s*$/, '').trim() : (item.name || '');
      const roles = typeof item === 'object' && item.roles ? item.roles : [];
      const roleLabel = roles.length
        ? roles.map(r => (String(r).includes('Lái') ? 'Lái' : (String(r).includes('NV') || String(r).includes('nạp') ? 'NV' : r))).join('+')
        : '';
      const safeName = String(name).replace(/'/g, "\\'");
      buttonsHtml += `
        <button type="button" onclick="quickMapCrew('${safeName}')" class="btn-secondary" style="margin-top:0;padding:3px 8px;font-size:0.72rem;border-color:rgba(239,68,68,0.35);color:#b91c1c;background:rgba(239,68,68,0.05);cursor:pointer;border-radius:5px;display:inline-flex;align-items:center;gap:4px;line-height:1.3;">
          <i class="fa-solid fa-link" style="font-size:0.65rem;"></i>
          <span style="font-weight:600;">${escapeHtml(name)}</span>
          ${roleLabel ? `<span class="zalo-role-pill ${roleLabel === 'Lái' ? 'is-lai' : (roleLabel === 'NV' ? 'is-nv' : 'is-both')}">${escapeHtml(roleLabel)}</span>` : ''}
        </button>
      `;
    });
    listContainer.innerHTML = buttonsHtml;
  } catch (err) {
    console.error('Lỗi lấy danh sách nhân sự chưa map:', err.message);
  }
}

// Bấm nhanh vào nhân sự chưa map để mở modal map
function quickMapCrew(name) {
  // Mở modal quản lý mappings trước
  openZaloMappingsModal();
  
  // Trì hoãn một chút để modal load danh sách dropdown xong
  setTimeout(() => {
    const select = document.getElementById('mapping-schedule-name-select');
    const input = document.getElementById('mapping-schedule-name');
    
    if (select && input) {
      let hasOption = false;
      for (let i = 0; i < select.options.length; i++) {
        if (select.options[i].value === name) {
          select.value = name;
          hasOption = true;
          break;
        }
      }
      
      if (hasOption) {
        input.style.display = 'none';
        input.value = name;
      } else {
        select.value = 'custom';
        input.style.display = 'block';
        input.value = name;
        input.focus();
      }
    }
    
    // Clear các thông tin khác trong form
    const idInput = document.getElementById('mapping-id');
    const uidSelect = document.getElementById('mapping-zalo-uid');
    
    if (idInput) idInput.value = '';
    if (uidSelect) uidSelect.value = '';
    
    const saveBtn = document.getElementById('btn-save-single-mapping');
    if (saveBtn) {
      saveBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Thêm Liên Kết';
    }
  }, 300);
}
