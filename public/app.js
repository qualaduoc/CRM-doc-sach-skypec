const state = {
  token: localStorage.getItem('crm_token'),
  role: localStorage.getItem('crm_role'),
  username: localStorage.getItem('crm_username'),
  displayName: localStorage.getItem('crm_display_name'),
  department: localStorage.getItem('crm_department'),
  selectedUser: null // Dành cho Admin khi click xem chi tiết một nhân viên
};

let dashboardInterval = null;

// --- KHỞI CHẠY KHI ĐÃ TẢI XONG TRANG ---
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
  initSpaceBackground();
});

function initApp() {
  if (state.token) {
    if (state.role === 'admin') {
      showScreen('admin-screen');
      loadAdminDashboard();
    } else {
      showScreen('user-screen');
      loadUserDashboard();
    }
    startDashboardPolling();
  } else {
    showScreen('login-screen');
    stopDashboardPolling();
    
    // Tự động điền tài khoản đã ghi nhớ
    const rememberedUser = localStorage.getItem('crm_remembered_user');
    const rememberedPass = localStorage.getItem('crm_remembered_pass');
    if (rememberedUser && rememberedPass) {
      document.getElementById('username').value = rememberedUser;
      document.getElementById('password').value = rememberedPass;
      document.getElementById('remember-me').checked = true;
    }
  }
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
    const activeScreen = document.querySelector('.screen.active');
    if (activeScreen && activeScreen.id === 'user-screen') {
      loadUserDashboard(state.selectedUser ? state.selectedUser.username : null, true);
    } else if (activeScreen && activeScreen.id === 'admin-screen') {
      loadAdminDashboard(true);
    }
  }, 10000); // 10 giây một lần
}

function stopDashboardPolling() {
  if (dashboardInterval) {
    clearInterval(dashboardInterval);
    dashboardInterval = null;
  }
}

// Chuyển đổi giữa các màn hình
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

// Cài đặt các sự kiện lắng nghe
function setupEventListeners() {
  // Đăng nhập
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Đăng xuất
  document.getElementById('btn-admin-logout').addEventListener('click', handleLogout);
  document.getElementById('btn-user-logout').addEventListener('click', handleLogout);

  // Lưu cấu hình Admin
  document.getElementById('btn-save-settings').addEventListener('click', saveSystemSettings);

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
      document.getElementById(tabId).style.display = tabId === 'tab-fms' ? 'grid' : 'block';

      if (tabId === 'tab-fms') {
        loadFmsSchedules();
        loadGeminiKeys();
        startSkyOnePolling();
        loadSkyOneSettings();
      } else {
        stopSkyOnePolling();
      }
    });
  });

  // Lưu lịch trực FMS
  document.getElementById('btn-fms-save-schedule').addEventListener('click', handleSaveFmsSchedule);

  // Quét FMS ngay lập tức
  document.getElementById('btn-fms-sync-now').addEventListener('click', handleSyncFmsNow);

  // Trigger chọn file Excel FMS
  document.getElementById('btn-fms-upload-excel').addEventListener('click', () => {
    document.getElementById('fms-file-input').value = ''; // Reset file input
    document.getElementById('fms-file-input').click();
  });

  // Đọc file Excel FMS
  document.getElementById('fms-file-input').addEventListener('change', handleExcelFileSelect);

  // Trigger chọn ảnh FMS
  document.getElementById('btn-fms-upload-image').addEventListener('click', () => {
    document.getElementById('fms-image-input').value = ''; // Reset file input
    document.getElementById('fms-image-input').click();
  });

  // Đọc và OCR ảnh FMS
  document.getElementById('fms-image-input').addEventListener('change', handleImageFileSelect);

  // Lưu danh sách Gemini API Keys
  document.getElementById('btn-save-gemini-keys').addEventListener('click', handleSaveGeminiKeys);

  // Kiểm tra danh sách Gemini API Keys
  document.getElementById('btn-test-gemini-keys').addEventListener('click', handleTestGeminiKeys);

  // Sự kiện thay đổi ngày lọc lịch bay FMS
  document.getElementById('fms-filter-date').addEventListener('change', () => loadFmsSchedules(false));

  // Đóng Modal Preview FMS
  document.getElementById('btn-close-fms-preview-modal').addEventListener('click', () => {
    document.getElementById('fms-preview-modal').classList.remove('active');
  });
  document.getElementById('btn-fms-cancel-preview').addEventListener('click', () => {
    document.getElementById('fms-preview-modal').classList.remove('active');
  });

  // Xác nhận lưu lịch trực FMS từ preview
  document.getElementById('btn-fms-confirm-preview').addEventListener('click', handleConfirmFmsPreview);

  // --- SỰ KIỆN TRỢ LÝ ZALO SKYONE ---
  document.getElementById('btn-skyone-connect').addEventListener('click', handleSkyOneConnect);
  document.getElementById('btn-skyone-send-test').addEventListener('click', handleSkyOneSendTest);
  document.getElementById('btn-skyone-logout').addEventListener('click', handleSkyOneLogout);
  document.getElementById('skyone-group-select').addEventListener('change', handleSaveSkyOneSettings);
  document.getElementById('skyone-notify-enabled').addEventListener('change', handleSaveSkyOneSettings);
  document.getElementById('skyone-template-presets').addEventListener('change', handleSkyOnePresetChange);
  document.getElementById('skyone-template-input').addEventListener('blur', handleSaveSkyOneSettings);
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

      localStorage.setItem('crm_token', data.token);
      localStorage.setItem('crm_role', data.role);
      localStorage.setItem('crm_username', usernameInput);
      localStorage.setItem('crm_display_name', data.displayName);
      localStorage.setItem('crm_department', data.department);

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

      return `
        <tr>
          <td><code style="color: var(--primary); font-weight: 600;">${acc.username}</code></td>
          <td style="font-weight: 500;">${acc.display_name}</td>
          <td style="color: var(--text-muted); font-size: 0.9em;">${acc.department}</td>
          <td style="text-align: center;">
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
    const userData = await userRes.json();
    if (userData.success) {
      const u = userData.user;
      document.getElementById('user-title-name').textContent = u.display_name;
      document.getElementById('user-title-dept').textContent = `${u.position_name || 'Học viên'} | ${u.department || 'Đơn vị'}`;
      
      // Cập nhật các thẻ KPI từ Skypec
      document.getElementById('kpi-user-total-classes').textContent = u.class_total || 0;
      document.getElementById('kpi-user-kpi').textContent = `${u.kpi_percent || 0}%`;
      document.getElementById('kpi-user-kpi-detail').textContent = `KPI: ${u.kpi_current || 0}/${u.kpi_total || 0} giờ`;
      document.getElementById('kpi-user-certificates').textContent = u.total_certificate || 0;
    }
  } catch (e) {
    console.error('Lỗi khi tải thông tin KPI tài khoản:', e.message);
  }

  if (!targetUsername) {
    document.getElementById('btn-back-to-admin').classList.add('hidden');
    document.getElementById('back-bar').classList.add('hidden');
  }

  if (!isSilent) {
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
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    // Nếu là admin đang xem, lọc các lớp học của tài khoản đang chọn
    let classes = data.classes;
    if (targetUsername) {
      classes = classes.filter(c => c.account_username === targetUsername);
    }

    // Lưu trữ danh sách ID các lớp đã đăng ký
    state.registeredClassIds = classes.map(c => c.id);

    // Cập nhật số lớp đang treo máy
    const runningCount = classes.reduce((acc, curr) => acc + (curr.isRunning ? 1 : 0), 0);
    document.getElementById('kpi-user-running-classes').textContent = runningCount;

    if (classes.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" style="text-align: center; padding: 30px; color: var(--text-muted);">
            Hiện tại không có lớp học nào đang diễn ra.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = classes.map(c => {
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

  } catch (err) {
    tbody.innerHTML = `
      <tr>
        <td colspan="4" style="text-align: center; padding: 30px; color: var(--danger-color);">
          Không thể tải dữ liệu: ${err.message}
        </td>
      </tr>
    `;
  }
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

function formatDateVN(dateStr) {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

async function loadFmsSchedules(isSilent = false) {
  try {
    const filterInput = document.getElementById('fms-filter-date');
    if (filterInput && !filterInput.value) {
      const vnDate = new Date();
      // Chuyển múi giờ Việt Nam GMT+7
      const utc = vnDate.getTime() + (vnDate.getTimezoneOffset() * 60000);
      const vnTime = new Date(utc + (3600000 * 7));
      filterInput.value = vnTime.toISOString().split('T')[0];
    }
    const selectedDate = filterInput ? filterInput.value : '';

    const res = await fetch(`/api/fms/schedules?date=${selectedDate}`, {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error);
    }

    const rows = data.data || [];
    const tbody = document.getElementById('fms-table-body');
    
    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">
            Chưa có lịch bay được phân công cho ngày ${selectedDate ? formatDateVN(selectedDate) : 'được chọn'}.
          </td>
        </tr>
      `;
      return;
    }

    // Đổ dữ liệu lịch bay vào textarea nếu textarea đang trống hoặc không được focus
    const textarea = document.getElementById('fms-schedule-input');
    if (textarea && textarea !== document.activeElement && (!textarea.value.trim())) {
      const scheduleLines = rows.map(r => `${r.flight_no}: ${r.crew_info}`);
      textarea.value = scheduleLines.join('\n');
    }

    // Render bảng tải dầu FMS chi tiết (9 cột)
    tbody.innerHTML = rows.map(r => {
      const hasData = r.status === 'Đã có số liệu';
      const statusClass = hasData ? 'review-finished' : 'review-pending';
      const statusText = r.status;
      
      const standbyVal = parseInt(r.standby_fuel) > 0 ? `${parseInt(r.standby_fuel).toLocaleString()} kg` : '-';
      const orderVal = parseInt(r.fuel_order) > 0 ? `${parseInt(r.fuel_order).toLocaleString()} kg` : '-';
      const tripVal = parseInt(r.trip_fuel) > 0 ? `${parseInt(r.trip_fuel).toLocaleString()} kg` : '-';
      
      const crewText = r.crew_info || '-';
      const truckText = r.truck_no ? `<br><span style="color: var(--primary); font-size: 0.8rem; font-weight: bold;"><i class="fa-solid fa-truck-field"></i> Xe: ${r.truck_no}</span>` : '';
      
      const planeInfo = `
        ${r.ac_reg ? `<span style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; font-weight: 600;">${r.ac_reg}</span>` : '-'}
        ${r.ac_type ? `<span style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-top: 3px;">Loại: ${r.ac_type}</span>` : ''}
        ${r.route ? `<span style="color: #60a5fa; font-size: 0.8rem; display: block; margin-top: 3px;"><i class="fa-solid fa-route"></i> ${r.route}</span>` : ''}
      `;
      
      const timesHtml = `
        <div style="font-size: 0.8rem; text-align: left; line-height: 1.4;">
          ${r.time_arr ? `<div>Hạ: <span>${r.time_arr}</span></div>` : ''}
          ${r.time_dep ? `<div>Cất: <span>${r.time_dep}</span></div>` : ''}
          ${r.time_fuel ? `<div style="margin-top: 2px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 2px;">Nạp: <strong style="color: #fb923c; font-size: 0.88rem;">${r.time_fuel}</strong></div>` : ''}
        </div>
      `;
      
      return `
        <tr>
          <td style="font-weight: 700; color: var(--primary); font-size: 1rem;">${r.flight_no}</td>
          <td>${crewText}${truckText}</td>
          <td style="text-align: center;">${planeInfo}</td>
          <td style="text-align: center; font-weight: 700; color: #f59e0b; font-size: 1rem;">${r.gate || '-'}</td>
          <td>${timesHtml}</td>
          <td style="text-align: center; font-weight: 600; color: #a3e635;">${standbyVal}</td>
          <td style="text-align: center; font-weight: 700; color: #f97316;">${orderVal}</td>
          <td style="text-align: center; font-weight: 600; color: #60a5fa;">${tripVal}</td>
          <td style="text-align: center;">
            <span class="status-tag ${statusClass}">
              ${statusText}
            </span>
          </td>
        </tr>
      `;
    }).join('');

    // Khởi động vòng lặp tự động cập nhật số liệu tải dầu mỗi 10 giây khi đang ở tab FMS
    if (!fmsInterval) {
      fmsInterval = setInterval(() => {
        const activeTabBtn = document.querySelector('.admin-tab-btn.active');
        if (activeTabBtn && activeTabBtn.getAttribute('data-tab') === 'tab-fms') {
          loadFmsSchedules(true);
        }
      }, 10000);
    }

  } catch (err) {
    if (!isSilent) {
      showToast('Không thể tải lịch FMS: ' + err.message, 'error', 'Lỗi kết nối');
    }
  }
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
    const res = await fetch('/api/fms/sync', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
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

    if (!isNaN(stt) && flightNo) {
      flights.push({
        ac_type: r[1] ? String(r[1]).trim() : '',
        ac_reg: r[2] ? String(r[2]).trim() : '',
        flight_no: flightNo,
        route: r[4] ? String(r[4]).trim() : '',
        time_arr: r[6] ? String(r[6]).trim() : '',
        time_dep: r[7] ? String(r[7]).trim() : '',
        time_fuel: r[8] ? String(r[8]).trim() : '',
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

  // Lưu lịch bay bóc tách tạm thời vào state để xác nhận sau
  state.fmsPreviewFlights = flights;

  // Hiển thị bảng xem trước (Preview) lên modal
  const tbody = document.getElementById('fms-preview-table-body');
  tbody.innerHTML = flights.map(f => `
    <tr>
      <td style="font-weight: 700; color: var(--primary);">${f.flight_no}</td>
      <td style="color: var(--text-muted);">${f.ac_type || '-'}</td>
      <td>${f.ac_reg || '-'}</td>
      <td style="color: #60a5fa;">${f.route || '-'}</td>
      <td style="text-align: center;">${f.time_arr || '-'}</td>
      <td style="text-align: center;">${f.time_dep || '-'}</td>
      <td style="text-align: center; font-weight: bold; color: #fb923c;">${f.time_fuel || '-'}</td>
      <td style="text-align: center; font-weight: bold; color: #f59e0b;">${f.gate || '-'}</td>
      <td style="text-align: center; font-weight: bold; color: var(--primary);">${f.truck_no || '-'}</td>
      <td>${f.driver_name || '-'}</td>
      <td>${f.operator_name || '-'}</td>
    </tr>
  `).join('');

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
    const res = await fetch('/api/fms/schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ flights: state.fmsPreviewFlights })
    });
    
    const data = await res.json();
    if (data.success) {
      showToast(data.message, 'success', 'Thành công');
      document.getElementById('fms-preview-modal').classList.remove('active');
      loadFmsSchedules();
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
        renderOcrPreview(data.flights);
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
  state.fmsPreviewFlights = flights;
  const tbody = document.getElementById('fms-preview-table-body');
  
  tbody.innerHTML = flights.map(f => `
    <tr>
      <td style="font-weight: 700; color: var(--primary);">${f.flight_no}</td>
      <td style="color: var(--text-muted);">${f.ac_type || '-'}</td>
      <td>${f.ac_reg || '-'}</td>
      <td style="color: #60a5fa;">${f.route || '-'}</td>
      <td style="text-align: center;">${f.time_arr || '-'}</td>
      <td style="text-align: center;">${f.time_dep || '-'}</td>
      <td style="text-align: center; font-weight: bold; color: #fb923c;">${f.time_fuel || '-'}</td>
      <td style="text-align: center; font-weight: bold; color: #f59e0b;">${f.gate || '-'}</td>
      <td style="text-align: center; font-weight: bold; color: var(--primary);">${f.truck_no || '-'}</td>
      <td>${f.driver_name || '-'}</td>
      <td>${f.operator_name || '-'}</td>
    </tr>
  `).join('');

  document.getElementById('fms-preview-modal').classList.add('active');
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

// --- TRỢ LÝ ZALO SKYONE CLIENT-SIDE LOGIC ---
let skyonePollInterval = null;
let lastSkyOneStatus = '';

// Bắt đầu vòng lặp polling lấy trạng thái Zalo
function startSkyOnePolling() {
  if (skyonePollInterval) return;
  
  // Polling mỗi 2.5 giây
  skyonePollInterval = setInterval(fetchSkyOneState, 2500);
  fetchSkyOneState(); // Gọi ngay lập tức
}

// Dừng vòng lặp polling
function stopSkyOnePolling() {
  if (skyonePollInterval) {
    clearInterval(skyonePollInterval);
    skyonePollInterval = null;
  }
}

// Lấy trạng thái Zalo SkyOne từ server
async function fetchSkyOneState() {
  try {
    const res = await fetch('/api/fms/zalo/state', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      updateSkyOneUI(data.state);
    }
  } catch (err) {
    console.error('[SkyOne] Không thể lấy trạng thái Zalo:', err.message);
  }
}

// Cập nhật giao diện Trợ lý SkyOne dựa trên trạng thái hiện tại
async function updateSkyOneUI(botState) {
  const statusEl = document.getElementById('skyone-bot-status');
  const qrContainer = document.getElementById('skyone-qr-container');
  const qrImg = document.getElementById('skyone-qr-img');
  const btnConnect = document.getElementById('btn-skyone-connect');
  const btnLogout = document.getElementById('btn-skyone-logout');
  const groupSelect = document.getElementById('skyone-group-select');

  if (botState.status !== lastSkyOneStatus) {
    console.log(`[SkyOne] Trạng thái chuyển đổi: ${lastSkyOneStatus} -> ${botState.status}`);
    lastSkyOneStatus = botState.status;
  }

  switch (botState.status) {
    case 'disconnected':
      statusEl.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Chưa kết nối';
      statusEl.style.color = '#ef4444';
      qrContainer.style.display = 'none';
      btnConnect.style.display = 'block';
      btnConnect.innerHTML = '<i class="fa-solid fa-qrcode"></i> Kết Nối SkyOne (Quét QR)';
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
      statusEl.innerHTML = `<i class="fa-solid fa-circle-check"></i> Đang hoạt động (${botState.botName || 'SkyOne'})`;
      statusEl.style.color = '#10b981';
      qrContainer.style.display = 'none';
      btnConnect.style.display = 'none';
      btnLogout.style.display = 'block';

      // Tự động load danh sách nhóm nếu dropdown chưa có nhóm nào (chỉ có option mặc định)
      if (groupSelect.options.length <= 1) {
        loadSkyOneGroups();
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
async function handleSkyOneConnect() {
  const btnConnect = document.getElementById('btn-skyone-connect');
  if (lastSkyOneStatus === 'qr_ready' || lastSkyOneStatus === 'scanned') {
    // Nhấp nút khi đang chờ quét -> Thực hiện đăng xuất để hủy phiên quét
    await handleSkyOneLogout();
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
      startSkyOnePolling();
    }
  } catch (e) {
    showToast('Lỗi kết nối tạo QR: ' + e.message, 'error', 'Lỗi kết nối');
  }
}

// Đăng xuất Bot Zalo
async function handleSkyOneLogout() {
  if (!confirm('Bạn có chắc chắn muốn đăng xuất và ngắt kết nối Trợ lý Zalo SkyOne không?')) return;
  
  try {
    const res = await fetch('/api/fms/zalo/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đã ngắt kết nối Zalo thành công!', 'success', 'Đăng xuất thành công');
      // Reset dropdown nhóm
      const groupSelect = document.getElementById('skyone-group-select');
      groupSelect.innerHTML = '<option value="">-- Chưa tải danh sách nhóm --</option>';
      fetchSkyOneState();
    } else {
      showToast(data.error, 'error', 'Đăng xuất thất bại');
    }
  } catch (e) {
    showToast('Lỗi đăng xuất Zalo: ' + e.message, 'error', 'Lỗi kết nối');
  }
}

// Tải cấu hình cài đặt Zalo từ server
async function loadSkyOneSettings() {
  try {
    const res = await fetch('/api/fms/zalo/settings', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success && data.settings) {
      const { targetGroupId, targetGroupName, notifyEnabled, messageTemplate } = data.settings;
      document.getElementById('skyone-notify-enabled').checked = notifyEnabled;
      document.getElementById('skyone-template-input').value = messageTemplate || '';
      
      // Cập nhật dropdown nếu đã có nhóm đó, nếu chưa có thì tạm thời chèn option
      const groupSelect = document.getElementById('skyone-group-select');
      if (targetGroupId) {
        let hasOption = false;
        for (let i = 0; i < groupSelect.options.length; i++) {
          if (groupSelect.options[i].value === targetGroupId) {
            groupSelect.selectedIndex = i;
            hasOption = true;
            break;
          }
        }
        if (!hasOption) {
          const opt = document.createElement('option');
          opt.value = targetGroupId;
          opt.text = targetGroupName || `Nhóm ID: ${targetGroupId}`;
          opt.selected = true;
          groupSelect.appendChild(opt);
        }
      }
    }
  } catch (err) {
    console.error('[SkyOne] Lỗi tải cấu hình Zalo:', err.message);
  }
}

// Lưu cấu hình nhóm nhận tin và checkbox bật/tắt
async function handleSaveSkyOneSettings() {
  const groupSelect = document.getElementById('skyone-group-select');
  const notifyEnabled = document.getElementById('skyone-notify-enabled').checked;
  const messageTemplate = document.getElementById('skyone-template-input').value;
  
  const targetGroupId = groupSelect.value;
  const targetGroupName = groupSelect.options[groupSelect.selectedIndex]?.text || '';

  if (!targetGroupId && notifyEnabled) {
    showToast('Vui lòng chọn nhóm Zalo đích trước khi bật thông báo!', 'warning', 'Lưu ý');
    document.getElementById('skyone-notify-enabled').checked = false;
    return;
  }

  try {
    const res = await fetch('/api/fms/zalo/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ targetGroupId, targetGroupName, notifyEnabled, messageTemplate })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đã lưu cấu hình trợ lý SkyOne thành công!', 'success', 'Đã cập nhật');
    } else {
      showToast(data.error, 'error', 'Lưu cấu hình thất bại');
    }
  } catch (e) {
    showToast('Lỗi lưu cấu hình: ' + e.message, 'error', 'Lỗi kết nối');
  }
}

// Thay đổi mẫu tin nhắn từ mẫu soạn sẵn
function handleSkyOnePresetChange(e) {
  const preset = e.target.value;
  const templateInput = document.getElementById('skyone-template-input');
  
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
    handleSaveSkyOneSettings();
  }
}

// Gửi thử tin nhắn test
async function handleSkyOneSendTest() {
  const groupSelect = document.getElementById('skyone-group-select');
  const groupId = groupSelect.value;
  if (!groupId) {
    showToast('Vui lòng chọn nhóm Zalo nhận tin trước khi gửi thử!', 'warning', 'Lưu ý');
    return;
  }

  const btn = document.getElementById('btn-skyone-send-test');
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>...';

  try {
    const res = await fetch('/api/fms/zalo/send-test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({
        groupId,
        message: '🤖 Trợ lý Zalo SkyOne xin kính chào Khầy Được! Kênh thông báo tải dầu FMS đã hoạt động tốt.'
      })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Đã gửi tin nhắn test thành công! Hãy kiểm tra nhóm Zalo.', 'success', 'Gửi thử thành công');
    } else {
      showToast(data.error, 'error', 'Gửi thử thất bại');
    }
  } catch (e) {
    showToast('Lỗi gửi thử Zalo: ' + e.message, 'error', 'Lỗi kết nối');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
  }
}

// Tải danh sách các nhóm Zalo từ tài khoản đăng nhập
async function loadSkyOneGroups() {
  const groupSelect = document.getElementById('skyone-group-select');
  groupSelect.innerHTML = '<option value="">-- Đang quét danh sách nhóm... --</option>';

  try {
    const res = await fetch('/api/fms/zalo/groups', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success && data.groups) {
      const groups = data.groups;
      if (groups.length === 0) {
        groupSelect.innerHTML = '<option value="">-- Không tìm thấy nhóm nào --</option>';
        return;
      }

      // Lưu giữ ID đã chọn trước đó
      const dbRes = await fetch('/api/fms/zalo/settings', {
        headers: { 'Authorization': `Bearer ${state.token}` }
      });
      const dbData = await dbRes.json();
      const savedGroupId = dbData.success ? dbData.settings.targetGroupId : '';

      groupSelect.innerHTML = '<option value="">-- Chọn nhóm Zalo nhận tin --</option>' +
        groups.map(g => `
          <option value="${g.groupId}" ${g.groupId === savedGroupId ? 'selected' : ''}>
            ${g.groupName} (${g.memberCount} thành viên)
          </option>
        `).join('');
    } else {
      groupSelect.innerHTML = '<option value="">-- Quét nhóm thất bại (Nhấp Kết nối lại) --</option>';
    }
  } catch (err) {
    console.error('[SkyOne] Lỗi tải danh sách nhóm:', err.message);
    groupSelect.innerHTML = '<option value="">-- Lỗi tải danh sách nhóm --</option>';
  }
}
