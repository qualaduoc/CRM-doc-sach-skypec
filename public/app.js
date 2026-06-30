const state = {
  token: localStorage.getItem('crm_token'),
  role: localStorage.getItem('crm_role'),
  username: localStorage.getItem('crm_username'),
  displayName: localStorage.getItem('crm_display_name'),
  department: localStorage.getItem('crm_department'),
  selectedUser: null // Dành cho Admin khi click xem chi tiết một nhân viên
};

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
  } else {
    showScreen('login-screen');
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

  // Nút điều khiển hàng loạt của Admin
  document.getElementById('btn-start-all').addEventListener('click', () => triggerBulkControl('start-all'));
  document.getElementById('btn-stop-all').addEventListener('click', () => triggerBulkControl('stop-all'));

  // Đồng bộ tiến độ
  document.getElementById('btn-sync-progress').addEventListener('click', () => {
    const userToSync = state.selectedUser ? state.selectedUser.username : state.username;
    triggerSyncProgress(userToSync);
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
async function loadAdminDashboard() {
  try {
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
      const statusText = isRunning ? 'Đang chạy ngầm' : 'Ngoại tuyến';
      const statusClass = isRunning ? 'active' : 'error';
      const indicatorColor = isRunning ? 'var(--success)' : 'var(--text-muted)';

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
            <div style="display: flex; gap: 8px; justify-content: center;">
              <button class="btn-secondary" style="padding: 6px 12px; font-size: 0.85rem;" onclick="viewStaffDetails('${acc.username}', '${acc.display_name}', '${acc.department}')">
                <i class="fa-solid fa-eye"></i> Xem lớp
              </button>
              <button class="btn-danger" style="padding: 6px 12px; font-size: 0.85rem;" onclick="deleteAccount('${acc.username}')">
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
        alert('Đã xóa tài khoản thành công!');
        loadAdminDashboard();
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      alert('Lỗi khi xóa tài khoản: ' + e.message);
    }
  }
}

// --- DASHBOARD USER (NHÂN VIÊN) ---
async function loadUserDashboard(targetUsername = null) {
  const username = targetUsername || state.username;
  const tbody = document.getElementById('classes-table-body');
  
  // Nếu là tài khoản thường, cập nhật tên và phòng ban của họ
  if (!targetUsername) {
    document.getElementById('user-title-name').textContent = state.displayName;
    document.getElementById('user-title-dept').textContent = state.department;
    document.getElementById('btn-back-to-admin').classList.add('hidden');
    document.getElementById('back-bar').classList.add('hidden');
  }

  tbody.innerHTML = `
    <tr>
      <td colspan="4" style="text-align: center; padding: 30px;">
        <div class="loading-spinner">
          <i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải dữ liệu lớp học...
        </div>
      </td>
    </tr>
  `;

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

    // Cập nhật KPI
    document.getElementById('kpi-user-total-classes').textContent = classes.length;
    
    const completedCount = classes.reduce((acc, curr) => acc + (curr.is_finish === 1 ? 1 : 0), 0);
    document.getElementById('kpi-user-completed-classes').textContent = completedCount;

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
      const percent = Math.min(100, Math.max(0, (c.learn_time / c.min_time_required) * 100));
      const isCompleted = c.is_finish === 1 || percent >= 100;
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
              <span style="color: var(--text-muted);">${c.min_time_required} ph (${percent.toFixed(0)}%)</span>
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
      alert('Lỗi thao tác: ' + data.error);
      // Reset lại giao diện
      loadUserDashboard(state.selectedUser ? state.selectedUser.username : null);
    } else {
      // Tải lại số đếm KPI
      loadUserDashboard(state.selectedUser ? state.selectedUser.username : null);
    }
  } catch (e) {
    alert('Lỗi kết nối mạng: ' + e.message);
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
      alert('Đồng bộ thành công dữ liệu học tập mới nhất từ Skypec!');
      loadUserDashboard(username === state.username ? null : username);
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    alert('Không thể đồng bộ: ' + err.message);
  } finally {
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
        alert(data.message);
        loadAdminDashboard();
      } else {
        throw new Error(data.error);
      }
    } catch (e) {
      alert('Lỗi: ' + e.message);
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
      alert(`Đã liên kết và đồng bộ thành công tài khoản: ${data.displayName}`);
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
