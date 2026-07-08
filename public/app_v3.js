const state = {
  token: localStorage.getItem('crm_token'),
  role: localStorage.getItem('crm_role'),
  username: localStorage.getItem('crm_username'),
  displayName: localStorage.getItem('crm_display_name'),
  department: localStorage.getItem('crm_department'),
  permissions: JSON.parse(localStorage.getItem('crm_permissions') || '{}'),
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

// --- KHỞI CHẠY KHI ĐÃ TẢI XONG TRANG ---
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();
  initSpaceBackground();
});

function getUserRole() {
  if (state.role === 'admin' || state.permissions?.perm_admin === 1) return 'admin';
  if (state.permissions?.perm_fms === 1) return 'dieu_hanh';
  if (state.permissions?.perm_gemini === 1) return 'nv_c1';
  return 'nv_c2';
}

// Đồng bộ thông tin phân quyền mới nhất của chính mình từ server
async function syncUserPermissions() {
  if (!state.token) return;
  try {
    const res = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${state.token}` }
    });
    const data = await res.json();
    if (data.success && data.user) {
      const oldRole = getUserRole();
      
      // Cập nhật state và localStorage
      state.permissions = data.user.permissions || {};
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
    }
  } catch (err) {
    console.error('[Permission Sync Error]', err.message);
  }
}

function initApp() {
  if (state.token) {
    // Luôn đồng bộ lấy quyền mới nhất khi khởi động hoặc F5 tải lại trang
    syncUserPermissions().then(() => {
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
    });
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
    if (geminiCard) geminiCard.style.display = 'flex';
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
      document.getElementById(tabId).style.display = tabId === 'tab-fms' ? 'grid' : 'block';

      if (tabId === 'tab-fms' || tabId === 'tab-settings') {
        if (tabId === 'tab-fms') {
          loadFmsSchedules();
        }
        loadGeminiKeys();
        startSkyEyesPolling();
        loadSkyEyesSettings();
      } else {
        stopSkyEyesPolling();
      }
    });
  });

  // Lưu lịch trực FMS
  document.getElementById('btn-fms-save-schedule').addEventListener('click', handleSaveFmsSchedule);

  // Quét FMS ngay lập tức
  document.getElementById('btn-fms-sync-now').addEventListener('click', handleSyncFmsNow);

  // Xuất lịch trực ra file Excel mẫu chuẩn
  document.getElementById('btn-fms-export-excel').addEventListener('click', exportFmsScheduleToExcel);

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

  // Sự kiện thay đổi ngày trực ca FMS (cột bên trái - Nhập lịch trực)
  document.getElementById('fms-schedule-date').addEventListener('change', (e) => {
    const val = e.target.value;
    const filterInput = document.getElementById('fms-filter-date');
    if (filterInput) {
      filterInput.value = val;
    }
    loadFmsSchedules(false);
  });

  // Sự kiện cho bảng FMS ở màn hình nhân viên (chỉ xem)
  const userFmsDate = document.getElementById('user-fms-filter-date');
  if (userFmsDate) {
    userFmsDate.addEventListener('change', () => loadUserFmsSchedules(false));
  }
  const userFmsSearch = document.getElementById('user-fms-search-input');
  if (userFmsSearch) {
    userFmsSearch.addEventListener('input', () => renderUserFmsTable());
  }

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

  document.getElementById('skyeyes-notify-enabled').addEventListener('change', handleSaveSkyEyesSettings);
  document.getElementById('skyeyes-template-presets').addEventListener('change', handleSkyEyesPresetChange);
  document.getElementById('skyeyes-template-input').addEventListener('blur', handleSaveSkyEyesSettings);

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
      input.style.background = '#1e293b';
      input.style.border = '1px solid var(--success)';
      input.style.color = '#fff';
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

  // Lắng nghe thay đổi dropdown hình thức thông báo Zalo theo Cặp trực ban trên bảng chính
  const notifyContainer = document.getElementById('fms-crew-notify-settings-container');
  if (notifyContainer) {
    if (!notifyContainer.getAttribute('data-has-listener')) {
      notifyContainer.setAttribute('data-has-listener', 'true');
      notifyContainer.addEventListener('change', async (e) => {
        if (e.target.classList.contains('fms-crew-notify-select')) {
          const select = e.target;
          const crewInfo = select.getAttribute('data-crew');
          const date = select.getAttribute('data-date');
          const notifyType = parseInt(select.value);
          const originalVal = parseInt(select.getAttribute('data-original-val') || "1");

          try {
            const res = await fetch('/api/fms/schedule/update-notify-type', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${state.token}`
              },
              body: JSON.stringify({ crewInfo, date, notifyType })
            });
            const data = await res.json();
            if (data.success) {
              showToast(`Đã chuyển cài đặt Cặp ${crewInfo} sang: ${select.options[select.selectedIndex].text}`, 'success', 'Cập nhật thành công');
              select.setAttribute('data-original-val', notifyType);
              
              // Cập nhật cache cục bộ cho tất cả các chuyến bay thuộc cặp trực này
              cachedFmsRows.forEach(r => {
                if (r.crew_info && r.crew_info.toUpperCase().trim() === crewInfo.toUpperCase().trim() && r.date === date) {
                  r.notify_type = notifyType;
                }
              });
              
              // Vẽ lại bảng
              renderFmsTable();
            } else {
              showToast(data.error || 'Lỗi cập nhật hình thức thông báo', 'error', 'Cập nhật thất bại');
              select.value = originalVal; // Rollback
            }
          } catch (err) {
            showToast('Lỗi kết nối: ' + err.message, 'error', 'Lỗi cập nhật');
            select.value = originalVal; // Rollback
          }
        }
      });
    }
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
        <select class="role-select" data-username="${acc.username}" style="padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.15); background: #0f172a; color: white; font-weight: 600; cursor: pointer; outline: none; font-size: 0.82rem; width: 100%; box-sizing: border-box;">
          <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>👑 Admin</option>
          <option value="dieu_hanh" ${currentRole === 'dieu_hanh' ? 'selected' : ''}>✈️ Điều hành</option>
          <option value="nv_c1" ${currentRole === 'nv_c1' ? 'selected' : ''}>👤 Nhân viên C1</option>
          <option value="nv_c2" ${currentRole === 'nv_c2' ? 'selected' : ''}>👤 Nhân viên C2</option>
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

  if (!targetUsername && !state.selectedUser) {
    document.getElementById('btn-back-to-admin').classList.add('hidden');
    document.getElementById('back-bar').classList.add('hidden');
  }

  if (state.selectedUser) {
    document.getElementById('btn-back-to-admin').classList.remove('hidden');
    document.getElementById('back-bar').classList.remove('hidden');
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

async function loadFmsSchedules(isSilent = false) {
  try {
    const filterInput = document.getElementById('fms-filter-date');
    const scheduleDateInput = document.getElementById('fms-schedule-date');
    const vnDate = new Date();
    const utc = vnDate.getTime() + (vnDate.getTimezoneOffset() * 60000);
    const vnTime = new Date(utc + (3600000 * 7));
    const todayStr = vnTime.toISOString().split('T')[0];

    if (filterInput && !filterInput.value) {
      filterInput.value = todayStr;
    }
    if (scheduleDateInput && !scheduleDateInput.value) {
      scheduleDateInput.value = todayStr;
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
    cachedFmsRows = rows;
    const tbody = document.getElementById('fms-table-body');
    
    if (rows.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">
            Chưa có lịch bay được phân công cho ngày ${selectedDate ? formatDateVN(selectedDate) : 'được chọn'}.
          </td>
        </tr>
      `;
      // Xoá danh sách cặp tra nạp nếu không có dữ liệu
      updateFmsCrewFilter([]);
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

  } catch (err) {
    if (!isSilent) {
      showToast('Không thể tải lịch FMS: ' + err.message, 'error', 'Lỗi kết nối');
    }
  }
}

// Cập nhật danh sách cặp tra nạp vào Dropdown filter
function updateFmsCrewFilter(rows) {
  const crewSelect = document.getElementById('fms-crew-filter');
  if (!crewSelect) return;

  // Lưu giữ giá trị đang chọn hiện tại để không bị mất trạng thái
  const currentVal = crewSelect.value;

  // Lấy các giá trị cặp tra nạp duy nhất, không rỗng
  const crews = [...new Set(rows.map(r => r.crew_info ? r.crew_info.trim() : '').filter(Boolean))].sort();

  let html = '<option value="">-- Tất cả Cặp tra nạp --</option>';
  crews.forEach(c => {
    const selectedAttr = c === currentVal ? 'selected' : '';
    html += `<option value="${c}" ${selectedAttr}>${c}</option>`;
  });

  crewSelect.innerHTML = html;
}

// Thực hiện lọc và vẽ lại bảng FMS
function renderFmsTable() {
  const tbody = document.getElementById('fms-table-body');
  if (!tbody) return;

  // Vẽ cấu hình thông báo Zalo theo Cặp trực ban
  const crewContainer = document.getElementById('fms-crew-notify-settings-container');
  if (crewContainer) {
    const crewMap = {};
    cachedFmsRows.forEach(r => {
      if (r.crew_info && r.crew_info !== '-') {
        const key = r.crew_info.toUpperCase().trim();
        if (!crewMap[key]) {
          crewMap[key] = {
            crewName: r.crew_info,
            truckNo: r.truck_no || '-',
            notifyType: r.notify_type || 1,
            date: r.date
          };
        }
      }
    });

    const crews = Object.values(crewMap);
    if (crews.length > 0) {
      crewContainer.innerHTML = `
        <div style="width: 100%; font-size: 0.85rem; font-weight: bold; color: #fb923c; margin-bottom: 5px; display: flex; align-items: center; gap: 6px;">
          <i class="fa-solid fa-comments"></i> Hình Thức Báo Tin Zalo Theo Cặp Trực Ban:
        </div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap; width: 100%;">
          ${crews.map(c => `
            <div class="crew-notify-badge" style="background: rgba(30, 41, 59, 0.65); border: 1px solid rgba(56, 189, 248, 0.25); padding: 6px 12px; border-radius: 6px; display: flex; align-items: center; gap: 8px; font-size: 0.82rem;">
              <span style="font-weight: bold; color: #38bdf8;">👥 ${c.crewName} ${c.truckNo !== '-' ? `(Xe: ${c.truckNo})` : ''}</span>
              <select class="fms-crew-notify-select" data-crew="${c.crewName}" data-date="${c.date || ''}" data-original-val="${c.notifyType}" style="font-size: 0.75rem; padding: 2px 4px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); background: #0f172a; color: white; cursor: pointer; outline: none;">
                <option value="1" ${c.notifyType == 1 ? 'selected' : ''}>👥 Tag Nhóm</option>
                <option value="2" ${c.notifyType == 2 ? 'selected' : ''}>💬 Inbox Riêng</option>
                <option value="3" ${c.notifyType == 3 ? 'selected' : ''}>🔄 Nhóm + Inbox</option>
              </select>
            </div>
          `).join('')}
        </div>
      `;
      crewContainer.style.display = 'block';
    } else {
      crewContainer.innerHTML = '';
      crewContainer.style.display = 'none';
    }
  }

  const searchInput = document.getElementById('fms-search-input');
  const crewSelect = document.getElementById('fms-crew-filter');

  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  const selectedCrew = crewSelect ? crewSelect.value : '';

  // Lọc dữ liệu
  const filteredRows = cachedFmsRows.filter(r => {
    // 1. Lọc theo dropdown Cặp tra nạp
    if (selectedCrew && r.crew_info !== selectedCrew) {
      return false;
    }

    // 2. Lọc theo tìm kiếm nhanh (số hiệu chuyến bay, số hiệu tàu bay, tên người tra nạp)
    if (query) {
      const fltNo = r.flight_no ? r.flight_no.toLowerCase() : '';
      const acReg = r.ac_reg ? r.ac_reg.toLowerCase() : '';
      const crewInfo = r.crew_info ? r.crew_info.toLowerCase() : '';
      
      const matchFltNo = fltNo.includes(query);
      const matchAcReg = acReg.includes(query);
      const matchCrew = crewInfo.includes(query);

      return matchFltNo || matchAcReg || matchCrew;
    }

    return true;
  });

  if (filteredRows.length === 0) {
    // Đảm bảo số cột colSpan khớp với bảng
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Không tìm thấy chuyến bay nào khớp với điều kiện lọc.
        </td>
      </tr>
    `;
    return;
  }

  // Vẽ bảng
  tbody.innerHTML = filteredRows.map(r => {
    const hasData = r.status === 'Đã có số liệu';
    const statusClass = hasData ? 'review-finished' : 'review-pending';
    const statusText = r.status;
    
    const tripVal = parseInt(r.trip_fuel) > 0 ? `${parseInt(r.trip_fuel).toLocaleString()} kg` : '-';
    
    const crewText = r.crew_info || '-';
    const truckText = r.truck_no ? `<br><span style="color: var(--primary); font-size: 0.8rem; font-weight: bold;"><i class="fa-solid fa-truck-field"></i> Xe: ${r.truck_no}</span>` : '';
    

    
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
        <div style="font-size: 0.78rem; text-align: left; line-height: 1.35; padding: 4px; border-radius: 4px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.25);">
          <div style="color: #a3e635; font-weight: 500;">Cũ: <span style="text-decoration: line-through;">${r.old_ac_reg}</span></div>
          <div style="color: #ef4444; font-weight: bold; margin-top: 1px;" class="${acRegClass}">Mới: ${r.ac_reg || '-'}</div>
          ${r.ac_type ? `<span style="color: var(--text-muted); font-size: 0.72rem; display: block; margin-top: 2px;">Loại: ${r.ac_type}</span>` : ''}
          ${r.route ? `<span style="color: #60a5fa; font-size: 0.72rem; display: block; margin-top: 2px;"><i class="fa-solid fa-route"></i> ${r.route}</span>` : ''}
        </div>
      `;
    } else {
      planeInfo = `
        ${r.ac_reg ? `<span style="background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; font-weight: 600;" class="${acRegClass}">${r.ac_reg}</span>` : '-'}
        ${r.ac_type ? `<span style="color: var(--text-muted); font-size: 0.8rem; display: block; margin-top: 3px;">Loại: ${r.ac_type}</span>` : ''}
        ${r.route ? `<span style="color: #60a5fa; font-size: 0.8rem; display: block; margin-top: 3px;"><i class="fa-solid fa-route"></i> ${r.route}</span>` : ''}
      `;
    }

    // Trực quan hóa chi tiết thay đổi (Cũ và Mới) cho standby fuel
    let standbyHtml = '';
    if (blinkStandby && r.old_standby_fuel) {
      standbyHtml = `
        <div style="font-size: 0.78rem; text-align: center; line-height: 1.35; padding: 4px; border-radius: 4px; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.25);">
          <div style="color: #a3e635; font-size: 0.72rem;">Cũ: ${parseInt(r.old_standby_fuel) > 0 ? parseInt(r.old_standby_fuel).toLocaleString() + ' kg' : '-'}</div>
          <div style="color: #fb923c; font-weight: bold; margin-top: 1px;" class="${standbyClass}">Mới: ${parseInt(r.standby_fuel) > 0 ? parseInt(r.standby_fuel).toLocaleString() + ' kg' : '-'}</div>
        </div>
      `;
    } else {
      standbyHtml = parseInt(r.standby_fuel) > 0 ? `${parseInt(r.standby_fuel).toLocaleString()} kg` : '-';
    }

    // Trực quan hóa chi tiết thay đổi (Cũ và Mới) cho fuel order chính thức
    let orderHtml = '';
    if (blinkFuelOrder && r.old_fuel_order) {
      orderHtml = `
        <div style="font-size: 0.78rem; text-align: center; line-height: 1.35; padding: 4px; border-radius: 4px; background: rgba(249, 115, 22, 0.12); border: 1px solid rgba(249, 115, 22, 0.25);">
          <div style="color: #a3e635; font-size: 0.72rem;">Cũ: ${parseInt(r.old_fuel_order) > 0 ? parseInt(r.old_fuel_order).toLocaleString() + ' kg' : '-'}</div>
          <div style="color: #f97316; font-weight: bold; margin-top: 1px;" class="${fuelOrderClass}">Mới: ${parseInt(r.fuel_order) > 0 ? parseInt(r.fuel_order).toLocaleString() + ' kg' : '-'}</div>
        </div>
      `;
    } else {
      orderHtml = parseInt(r.fuel_order) > 0 ? `${parseInt(r.fuel_order).toLocaleString()} kg` : '-';
    }
    
    // Trực quan hóa chi tiết thay đổi (Cũ và Mới) cho Giờ bay (cột Cất)
    let depTimeHtml = '';
    if (blinkEtd && r.old_etd) {
      depTimeHtml = `
        <div style="font-size: 0.76rem; padding: 2px 4px; border-radius: 4px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.25); display: inline-block; line-height: 1.3;">
          <div style="color: #a3e635; text-decoration: line-through;">Cũ: ${r.old_etd}</div>
          <div style="color: #ef4444; font-weight: bold; margin-top: 1px;" class="${etdClass}">Mới: ${r.etd || '-'}</div>
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
        ${r.time_fuel ? `<div style="margin-top: 2px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 2px;">Nạp: <strong style="color: #fb923c; font-size: 0.88rem;">${r.time_fuel}</strong></div>` : ''}
      </div>
    `;
    
    const canEditGate = state.role === 'admin' || state.permissions?.perm_admin === 1 || state.permissions?.perm_gate === 1;
    const gateHtml = canEditGate
      ? `<span class="editable-gate" data-flight="${r.flight_no}" data-date="${r.date || ''}" title="Click để sửa vị trí đỗ" style="cursor: pointer; display: inline-block; padding: 2px 8px; border: 1px dashed rgba(245, 158, 11, 0.4); border-radius: 4px; min-width: 35px; transition: all 0.2s;">${r.gate || '-'}</span>`
      : `${r.gate || '-'}`;

    return `
      <tr>
        <td style="font-weight: 700; color: #38bdf8; font-size: 1rem;">${r.flight_no}</td>
        <td>${crewText}${truckText}</td>
        <td style="text-align: center;" class="${acRegTdClass}">${planeInfo}</td>
        <td style="text-align: center; font-weight: 700; color: #f59e0b; font-size: 1rem;">${gateHtml}</td>
        <td class="${etdTdClass}">${timesHtml}</td>
        <td style="text-align: center; font-weight: 600; color: #a3e635; transition: all 0.3s;" class="${standbyTdClass} ${standbyClass}">${standbyHtml}</td>
        <td style="text-align: center; font-weight: 700; color: #f97316; transition: all 0.3s;" class="${fuelOrderTdClass} ${fuelOrderClass}">${orderHtml}</td>
        <td style="text-align: center; font-weight: 600; color: #60a5fa;" class="hide-on-mobile">${tripVal}</td>
        <td style="text-align: center;">
          <span class="status-tag ${statusClass}">
            ${statusText}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

// Lọc và vẽ bảng FMS ở màn hình nhân viên (chỉ xem)
let cachedUserFmsRows = [];
async function loadUserFmsSchedules(isSilent = false) {
  try {
    const filterInput = document.getElementById('user-fms-filter-date');
    if (filterInput && !filterInput.value) {
      const vnDate = new Date();
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
    cachedUserFmsRows = rows;
    renderUserFmsTable();
  } catch (err) {
    console.error('Lỗi tải danh sách FMS nhân viên:', err.message);
  }
}

function renderUserFmsTable() {
  const searchInput = document.getElementById('user-fms-search-input');
  const query = searchInput ? searchInput.value.trim().toUpperCase() : '';
  const tbody = document.getElementById('user-fms-table-body');
  
  if (!tbody) return;

  const filteredRows = cachedUserFmsRows.filter(r => {
    if (query) {
      const flightNo = (r.flight_no || '').toUpperCase();
      const acReg = (r.ac_reg || '').toUpperCase();
      const crewInfo = (r.crew_info || '').toUpperCase();
      const route = (r.route || '').toUpperCase();
      return flightNo.includes(query) || acReg.includes(query) || crewInfo.includes(query) || route.includes(query);
    }
    return true;
  });

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

  tbody.innerHTML = filteredRows.map(r => {
    let statusClass = 'review-pending';
    let statusText = 'Chờ cập nhật';
    if (r.fuel_order > 0) {
      statusClass = 'review-finished';
      statusText = 'Đã có số liệu';
    }

    return `
      <tr>
        <td style="font-weight: 700; color: #38bdf8; font-size: 1rem;">${r.flight_no}</td>
        <td><span style="font-weight: 600; color: #fb923c;">${r.crew_info || '-'}</span> ${r.truck_no && r.truck_no !== '-' ? `<span style="font-size: 0.85em; color: var(--primary);"> (Xe ${r.truck_no})</span>` : ''}</td>
        <td style="text-align: center;">
          <span style="font-weight: bold; color: #fff;">${r.ac_reg || '-'}</span>
          <span style="color: var(--text-muted); font-size: 0.8em;"> (${r.ac_type || '-'})</span>
          <br>
          <span style="color: #60a5fa; font-size: 0.85em;">${r.route || '-'}</span>
        </td>
        <td style="text-align: center; font-weight: bold; color: #f59e0b; font-size: 1rem;">${r.gate || '-'}</td>
        <td>
          <div style="font-size: 0.8rem; text-align: left; line-height: 1.4;">
            ${r.time_arr ? `<div>Hạ: <span>${r.time_arr}</span></div>` : ''}
            ${r.time_dep ? `<div>Cất: <span>${r.time_dep}</span></div>` : ''}
            ${r.time_fuel ? `<div style="margin-top: 2px; border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 2px;">Nạp: <strong style="color: #fb923c; font-size: 0.88rem;">${r.time_fuel}</strong></div>` : ''}
          </div>
        </td>
        <td style="text-align: center; font-weight: 600; color: #a3e635;">${r.standby_fuel ? parseInt(r.standby_fuel).toLocaleString() + ' kg' : '-'}</td>
        <td style="text-align: center; font-weight: 700; color: #f97316; font-size: 1.05rem;">${r.fuel_order ? parseInt(r.fuel_order).toLocaleString() + ' kg' : '-'}</td>
        <td style="text-align: center; color: var(--text-muted);" class="hide-on-mobile">${r.trip_fuel ? parseInt(r.trip_fuel).toLocaleString() + ' kg' : '-'}</td>
        <td style="text-align: center;">
          <span class="status-tag ${statusClass}">${statusText}</span>
        </td>
      </tr>
    `;
  }).join('');
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

// Hàm lọc danh sách chuyến bay theo ca trực đã chọn
function filterFlightsByShift(flights, shift) {
  if (!shift || shift === 'all') return flights;

  return flights.filter(f => {
    const timeStr = f.time_fuel || f.time_dep || f.time_arr || '';
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

      if (shift === 'day') {
        return minutes >= m_0730 && minutes < m_1930;
      } else if (shift === 'evening') {
        return minutes >= m_1930 && minutes <= m_2359;
      } else if (shift === 'night') {
        // Ca đêm: từ 23h59 ngày N đến 07h30 sáng ngày N+1
        return minutes >= m_2359 || minutes < m_0730;
      }
    } catch (e) {
      console.error('[Shift Filter Error]', e.message);
    }
    return false;
  });
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

// Gửi xác nhận lưu lịch trực bay từ Modal Preview
// Render dữ liệu nhận diện ảnh/Excel lên preview modal (kèm cấu hình Zalo Mapping)
// Vẽ bảng Zalo Mapping (tự học hỏi) phía dưới bảng Preview
function renderZaloMappingTable(flights) {
  const uniqueNamesSet = new Set();
  flights.forEach(f => {
    if (f.driver_name && f.driver_name.trim()) {
      uniqueNamesSet.add(f.driver_name.trim().toUpperCase());
    }
    if (f.operator_name && f.operator_name.trim()) {
      uniqueNamesSet.add(f.operator_name.trim().toUpperCase());
    }
  });
  
  const uniqueNames = Array.from(uniqueNamesSet).sort();
  const mappingTbody = document.getElementById('fms-zalo-mapping-table-body');
  
  if (uniqueNames.length > 0) {
    // Tạo map danh sách mapping từ db để tra cứu nhanh: schedule_name -> zalo_uid
    const mapDb = {};
    state.zaloMappings.forEach(m => {
      mapDb[m.schedule_name.toUpperCase()] = m.zalo_uid;
    });

    // Lấy trạng thái đã chọn trên các dropdown hiện tại để giữ lại lựa chọn tương tác
    const currentSelections = {};
    document.querySelectorAll('.zalo-mapping-row').forEach(row => {
      const name = row.getAttribute('data-name');
      const select = row.querySelector('.zalo-member-select');
      if (name && select) {
        currentSelections[name.toUpperCase()] = select.value;
      }
    });

    mappingTbody.innerHTML = uniqueNames.map(name => {
      // Ưu tiên lựa chọn hiện tại đang tương tác, nếu không có thì lấy từ DB học hỏi
      const savedUid = currentSelections[name] !== undefined ? currentSelections[name] : (mapDb[name] || '');
      
      // Tạo danh sách option của thành viên Zalo
      let optionsHtml = '<option value="">-- Chưa liên kết --</option>';
      state.zaloMembers.forEach(mem => {
        optionsHtml += `<option value="${mem.uid}" ${mem.uid === savedUid ? 'selected' : ''}>${mem.displayName}</option>`;
      });

      return `
        <tr class="zalo-mapping-row" data-name="${name}">
          <td style="font-weight: 700; color: #fb923c;">${name}</td>
          <td>
            <select class="zalo-member-select" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); background: #0f172a; color: white;">
              ${optionsHtml}
            </select>
          </td>
        </tr>
      `;
    }).join('');

    document.getElementById('fms-zalo-mapping-section').style.display = 'block';
  } else {
    mappingTbody.innerHTML = '';
    document.getElementById('fms-zalo-mapping-section').style.display = 'none';
  }
}

// Vẽ bảng cấu hình thông báo Zalo theo Cặp trực ban trong Modal Preview
function renderCrewNotifyTable(flights) {
  const crewMap = {};
  flights.forEach(f => {
    const driver = (f.driver_name || '').trim().toUpperCase();
    const operator = (f.operator_name || '').trim().toUpperCase();
    
    if (!driver && !operator) return;
    
    const crewName = `${driver || '?'}-${operator || '?'}`;
    const truckNo = f.truck_no || '-';
    
    const key = `${crewName}::${truckNo}`;
    if (!crewMap[key]) {
      crewMap[key] = {
        crewName,
        truckNo,
        notifyType: f.notify_type || 1
      };
    }
  });

  const crews = Object.values(crewMap);
  const notifyTbody = document.getElementById('fms-crew-notify-table-body');
  const section = document.getElementById('fms-crew-notify-section');

  if (crews.length > 0) {
    const currentSelections = {};
    document.querySelectorAll('.crew-notify-row').forEach(row => {
      const key = row.getAttribute('data-key');
      const select = row.querySelector('.crew-notify-select');
      if (key && select) {
        currentSelections[key] = select.value;
      }
    });

    notifyTbody.innerHTML = crews.map(c => {
      const key = `${c.crewName}::${c.truckNo}`;
      const savedNotifyType = currentSelections[key] !== undefined ? currentSelections[key] : c.notifyType;

      return `
        <tr class="crew-notify-row" data-key="${key}" data-crew="${c.crewName}" data-truck="${c.truckNo}">
          <td style="font-weight: 700; color: #fb923c;">${c.crewName}</td>
          <td style="font-weight: bold; color: var(--primary);">${c.truckNo}</td>
          <td>
            <select class="crew-notify-select" style="width: 100%; padding: 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.1); background: #0f172a; color: white;">
              <option value="1" ${savedNotifyType == 1 ? 'selected' : ''}>👥 Tag Nhóm</option>
              <option value="2" ${savedNotifyType == 2 ? 'selected' : ''}>💬 Inbox Riêng</option>
              <option value="3" ${savedNotifyType == 3 ? 'selected' : ''}>🔄 Nhóm + Inbox</option>
            </select>
          </td>
        </tr>
      `;
    }).join('');

    section.style.display = 'block';
  } else {
    notifyTbody.innerHTML = '';
    section.style.display = 'none';
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
    renderZaloMappingTable(state.fmsPreviewFlights);
    renderCrewNotifyTable(state.fmsPreviewFlights);
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

  // 3. Gọi render bảng Zalo Mapping & Crew Notify
  renderZaloMappingTable(flights);
  renderCrewNotifyTable(flights);

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
    // 1. Gom các mapping Zalo từ giao diện người dùng
    const mappings = [];
    const nameToUidMap = {}; // schedule_name -> zalo_uid
    
    document.querySelectorAll('.zalo-mapping-row').forEach(row => {
      const scheduleName = row.getAttribute('data-name');
      const select = row.querySelector('.zalo-member-select');
      const zaloUid = select.value;
      const zaloName = select.options[select.selectedIndex].text;

      if (scheduleName && zaloUid) {
        mappings.push({
          scheduleName: scheduleName,
          zaloUid: zaloUid,
          zaloName: zaloName !== '-- Chưa liên kết --' ? zaloName : ''
        });
        nameToUidMap[scheduleName.toUpperCase()] = zaloUid;
      }
    });

    // 1b. Gom cấu hình báo Zalo theo Cặp trực ban
    const crewNotifyMap = {}; // "crewName::truckNo" -> notifyType
    document.querySelectorAll('.crew-notify-row').forEach(row => {
      const key = row.getAttribute('data-key');
      const select = row.querySelector('.crew-notify-select');
      if (key && select) {
        crewNotifyMap[key.toUpperCase()] = parseInt(select.value);
      }
    });

    // 2. Cập nhật crew_zalo_uids và notify_type cho từng chuyến bay
    const finalFlights = state.fmsPreviewFlights.map((f, index) => {
      const driver = (f.driver_name || '').trim().toUpperCase();
      const operator = (f.operator_name || '').trim().toUpperCase();
      const crewName = `${driver}-${operator}`;
      const truckNo = f.truck_no || '-';
      const key = `${crewName}::${truckNo}`.toUpperCase();

      const notifyType = crewNotifyMap[key] !== undefined ? crewNotifyMap[key] : 1;

      // Gom UID của driver và operator của chuyến bay này dựa trên bảng nameToUidMap
      const uids = [];
      if (f.driver_name && nameToUidMap[f.driver_name.trim().toUpperCase()]) {
        uids.push(nameToUidMap[f.driver_name.trim().toUpperCase()]);
      }
      if (f.operator_name && nameToUidMap[f.operator_name.trim().toUpperCase()]) {
        uids.push(nameToUidMap[f.operator_name.trim().toUpperCase()]);
      }

      // Loại bỏ trùng lặp UID
      const uniqueUids = Array.from(new Set(uids));

      return {
        ...f,
        crew_info: f.driver_name && f.operator_name ? `${f.driver_name.trim()} - ${f.operator_name.trim()}` : f.crew_info,
        crew_zalo_uids: uniqueUids.join(','),
        notify_type: notifyType
      };
    });

    // 3. Gọi API lưu lịch bay và mapping học hỏi
    const dateInput = document.getElementById('fms-preview-date-input');
    const selectedDate = dateInput ? dateInput.value : '';
    const shiftSelect = document.getElementById('fms-filter-shift');
    const selectedShift = shiftSelect ? shiftSelect.value : 'all';

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
      showToast(data.message, 'success', 'Thành công');
      document.getElementById('fms-preview-modal').classList.remove('active');
      if (selectedDate) {
        const schedInput = document.getElementById('fms-schedule-date');
        const filtInput = document.getElementById('fms-filter-date');
        if (schedInput) schedInput.value = selectedDate;
        if (filtInput) filtInput.value = selectedDate;
      }
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
      const { targetGroupId, targetGroupName, notifyEnabled, messageTemplate } = data.settings;
      document.getElementById('skyeyes-notify-enabled').checked = notifyEnabled;
      document.getElementById('skyeyes-template-input').value = messageTemplate || '';
      
      // Lưu lại các giá trị nhóm đã chọn để khi load group list sẽ check
      window.savedTargetGroupIds = targetGroupId ? targetGroupId.split(',').map(id => id.trim()) : [];
      window.savedTargetGroupName = targetGroupName || '';
      
      updateSkyEyesGroupsDisplayText(targetGroupName);
    }
  } catch (err) {
    console.error('[SkyEyes] Lỗi tải cấu hình Zalo:', err.message);
  }
}

// Cập nhật text hiển thị trên nút chọn nhóm
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

// Lưu cấu hình nhóm nhận tin và checkbox bật/tắt
async function handleSaveSkyEyesSettings() {
  const notifyEnabled = document.getElementById('skyeyes-notify-enabled').checked;
  const messageTemplate = document.getElementById('skyeyes-template-input').value;
  
  // Thu thập các ID và tên nhóm được tích chọn
  const checkedBoxes = document.querySelectorAll('.skyeyes-group-checkbox:checked');
  const targetGroupId = Array.from(checkedBoxes).map(cb => cb.value).join(',');
  const targetGroupName = Array.from(checkedBoxes).map(cb => cb.getAttribute('data-name')).join(', ');

  // Lưu tạm vào biến global
  window.savedTargetGroupIds = targetGroupId ? targetGroupId.split(',') : [];
  window.savedTargetGroupName = targetGroupName;
  updateSkyEyesGroupsDisplayText(targetGroupName);

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
      body: JSON.stringify({ targetGroupId, targetGroupName, notifyEnabled, messageTemplate })
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
async function loadSkyEyesGroups() {
  const groupsListDiv = document.getElementById('skyeyes-groups-list');
  if (groupsListDiv) groupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: var(--text-muted); font-size: 0.78rem;"><i class="fa-solid fa-circle-notch fa-spin"></i> Đang tải...</div>';

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

      window.savedTargetGroupIds = savedGroupIdsArray;
      window.savedTargetGroupName = savedGroupName;

      if (groupsListDiv) {
        groupsListDiv.innerHTML = groups.map(g => {
          const isChecked = savedGroupIdsArray.includes(String(g.groupId).trim());
          return `
            <label style="display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 4px; cursor: pointer; user-select: none; transition: background 0.2s; justify-content: flex-start; text-align: left; width: 100%;" class="group-item-hover">
              <input type="checkbox" class="skyeyes-group-checkbox" value="${g.groupId}" data-name="${g.groupName}" ${isChecked ? 'checked' : ''} style="cursor: pointer; width: 14px; height: 14px; flex-shrink: 0;">
              <span style="font-size: 0.78rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">${g.groupName}</span>
            </label>
          `;
        }).join('');

        // Đăng ký sự kiện change cho các checkbox
        document.querySelectorAll('.skyeyes-group-checkbox').forEach(cb => {
          cb.addEventListener('change', handleSaveSkyEyesSettings);
        });
      }

      updateSkyEyesGroupsDisplayText(savedGroupName);
    } else {
      if (groupsListDiv) groupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: #ef4444; font-size: 0.78rem;">Quét nhóm thất bại</div>';
    }
  } catch (err) {
    console.error('[SkyEyes] Lỗi tải danh sách nhóm:', err.message);
    if (groupsListDiv) groupsListDiv.innerHTML = '<div style="padding: 10px; text-align: center; color: #ef4444; font-size: 0.78rem;">Lỗi tải danh sách nhóm</div>';
  }
}

// --- LOGIC QUẢN LÝ ZALO MAPPINGS VÀ THÀNH VIÊN NHÓM ---
async function openZaloMappingsModal() {
  const modal = document.getElementById('zalo-mappings-modal');
  if (!modal) return;
  modal.classList.add('active');

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
      document.getElementById('mapping-schedule-name').value = name;
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

window.showUserFmsDetailModal = function(period) {
  const modal = document.getElementById('user-fms-detail-modal');
  const titleEl = document.getElementById('user-fms-detail-title');
  const tbody = document.getElementById('user-fms-detail-tbody');
  
  if (!modal || !tbody || !userFmsStatsData) {
    showToast('Chưa có dữ liệu thống kê, vui lòng đợi trong giây lát!', 'warning', 'Chờ tải');
    return;
  }

  let titleText = '';
  let flights = [];
  
  if (period === 'today') {
    titleText = '<i class="fa-solid fa-plane-departure" style="color: var(--primary);"></i> Chi tiết chuyến trực ca hôm nay';
    flights = userFmsStatsData.todayFlights || [];
  } else if (period === 'month') {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const currentMonth = vnTime.getUTCMonth() + 1;
    titleText = `<i class="fa-solid fa-plane-departure" style="color: var(--secondary);"></i> Chi tiết chuyến trực ca tháng ${currentMonth}`;
    flights = userFmsStatsData.monthFlights || [];
  } else if (period === 'last-month') {
    const now = new Date();
    const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    let lastMonth = vnTime.getUTCMonth();
    if (lastMonth === 0) lastMonth = 12;
    titleText = `<i class="fa-solid fa-plane-departure" style="color: var(--orange);"></i> Chi tiết chuyến trực ca tháng ${lastMonth}`;
    flights = userFmsStatsData.lastMonthFlights || [];
  }

  titleEl.innerHTML = titleText;

  if (flights.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 30px;">
          Chưa có lịch bay được phân công cho khoảng thời gian này.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = flights.map(r => {
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

  modal.classList.add('active');
};

// Gắn sự kiện đóng modal chi tiết FMS của user
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
});
