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
  if (confirm('Khầy có chắc chắn muốn đăng xuất khỏi hệ thống CRM không?')) {
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
            <span class="status-tag ${statusClass}" style="padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; background: ${isCompleted ? 'var(--success-bg)' : 'rgba(59, 130, 246, 0.15)'}; color: ${isCompleted ? 'var(--success)' : '#60a5fa'};">
              ${statusText}
            </span>
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
    const res = await fetch(`/api/classes/${classId}/toggle-learn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.token}`
      },
      body: JSON.stringify({ auto_learn: isChecked ? 1 : 0 })
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.error || 'Lỗi thao tác', 'error', 'Thất bại');
      // Tải lại danh sách lớp để khôi phục trạng thái checkbox
      loadUserDashboard(state.selectedUser ? state.selectedUser.username : null);
    } else {
      // Tải lại số đếm KPI
      loadUserDashboard(state.selectedUser ? state.selectedUser.username : null);
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
