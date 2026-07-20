const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const bcrypt = require('bcryptjs');

let dbInstance = null;

async function getDb() {
  if (dbInstance) return dbInstance;

  const dbPath = path.join(__dirname, '../database.db');
  dbInstance = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Khởi tạo các bảng
  await dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS admin (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      username TEXT PRIMARY KEY,
      password TEXT NOT NULL,
      display_name TEXT,
      department TEXT,
      email TEXT,
      phone TEXT,
      position_name TEXT,
      kpi_percent REAL DEFAULT 0,
      kpi_total REAL DEFAULT 0,
      kpi_current REAL DEFAULT 0,
      total_certificate INTEGER DEFAULT 0,
      class_total INTEGER DEFAULT 0,
      access_token TEXT,
      status TEXT DEFAULT 'active',
      perm_admin INTEGER DEFAULT 0,
      perm_fms INTEGER DEFAULT 0,
      perm_zalo INTEGER DEFAULT 0,
      perm_gemini INTEGER DEFAULT 0,
      perm_gate INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS classes (
      id TEXT,
      account_username TEXT,
      class_title TEXT,
      class_user_id TEXT,
      learning_id TEXT,
      content_id TEXT,
      learn_time REAL DEFAULT 0,
      min_time_required REAL DEFAULT 430,
      is_finish INTEGER DEFAULT 0,
      auto_learn INTEGER DEFAULT 0,
      class_exercise_id TEXT,
      is_exercise_finished INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id, account_username),
      FOREIGN KEY(account_username) REFERENCES accounts(username) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS fms_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_no TEXT NOT NULL,
      ac_type TEXT,
      ac_reg TEXT,
      route TEXT,
      time_arr TEXT,
      time_dep TEXT,
      time_fuel TEXT,
      gate TEXT,
      truck_no TEXT,
      driver_name TEXT,
      operator_name TEXT,
      crew_info TEXT,
      crew_zalo_uids TEXT,
      notify_type INTEGER DEFAULT 1,
      date TEXT NOT NULL,
      fms_date TEXT,
      unit_code TEXT DEFAULT 'SKYPEC',
      schedule_source TEXT DEFAULT 'manual',
      id_fms TEXT,
      updated_from_flights_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fms_fuel_orders (
      flight_no TEXT PRIMARY KEY,
      ac_reg TEXT,
      ac_type TEXT,
      dep_arr TEXT,
      standby_fuel TEXT,
      fuel_order TEXT,
      trip_fuel TEXT,
      trip_time TEXT,
      taxi_fuel TEXT,
      alternate TEXT,
      status TEXT DEFAULT 'Chờ cập nhật',
      warn_ac_reg INTEGER DEFAULT 0,
      warn_standby INTEGER DEFAULT 0,
      warn_fuel_order INTEGER DEFAULT 0,
      warn_updated_at DATETIME,
      old_ac_reg TEXT,
      old_standby_fuel TEXT,
      old_fuel_order TEXT,
      gate TEXT,
      etd TEXT,
      old_etd TEXT,
      warn_etd INTEGER DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS zalo_user_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_name TEXT UNIQUE,
      zalo_uid TEXT NOT NULL,
      zalo_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS fms_flights_live (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_no TEXT NOT NULL,
      ac_type TEXT,
      ac_reg TEXT,
      route TEXT,
      time_arr TEXT,
      time_dep TEXT,
      time_fuel TEXT,
      gate TEXT,
      truck_no TEXT,
      driver_name TEXT,
      operator_name TEXT,
      standby_fuel TEXT,
      fuel_order TEXT,
      status TEXT,
      airline_name TEXT,
      unit_code TEXT DEFAULT 'BOTH',
      date TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(flight_no, date)
    );

    CREATE TABLE IF NOT EXISTS fms_temp_import_exports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ac_reg TEXT NOT NULL,
      old_flight_no TEXT NOT NULL,
      old_route TEXT NOT NULL,
      fuel_order INTEGER DEFAULT 0,
      date TEXT NOT NULL,
      new_flight_no TEXT DEFAULT NULL,
      new_route TEXT DEFAULT NULL,
      is_warned INTEGER DEFAULT 0,
      monitor_type TEXT DEFAULT 'DOMESTIC_TO_INTL',
      old_time TEXT DEFAULT '-',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Lưu dài hạn sự kiện giám sát (thống kê tháng / xuất DOCX) — không xóa theo live
    CREATE TABLE IF NOT EXISTS fms_monitor_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_key TEXT NOT NULL UNIQUE,
      ac_reg TEXT NOT NULL,
      monitor_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      old_flight_no TEXT,
      old_route TEXT,
      old_time TEXT DEFAULT '-',
      fuel_order INTEGER DEFAULT 0,
      reason TEXT,
      status TEXT DEFAULT 'OPEN',
      new_flight_no TEXT,
      new_route TEXT,
      resolved_at TEXT,
      resolved_note TEXT,
      zalo_sent INTEGER DEFAULT 0,
      source_monitor_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_monitor_events_date ON fms_monitor_events(event_date);
    CREATE INDEX IF NOT EXISTS idx_monitor_events_status ON fms_monitor_events(status);

    -- Snapshot chuyến từng xuất hiện trên FMS VNA (để detect Cancel đúng, không nhầm hãng ngoài)
    CREATE TABLE IF NOT EXISTS fms_vna_presence (
      flight_no TEXT NOT NULL,
      date TEXT NOT NULL,
      ac_reg TEXT NOT NULL,
      route TEXT DEFAULT '-',
      last_etd TEXT DEFAULT NULL,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (flight_no, date)
    );

    CREATE TABLE IF NOT EXISTS fms_airline_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flight_no TEXT NOT NULL,
      date TEXT NOT NULL,
      expected_code TEXT NOT NULL,
      expected_name TEXT NOT NULL,
      actual_carrier TEXT DEFAULT '-',
      actual_name TEXT DEFAULT '-',
      crew_info TEXT DEFAULT '-',
      reason TEXT DEFAULT '',
      is_warned INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(flight_no, date)
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('max_active_classes', '3');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_import_export_duration', '24h');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_import_export_group_id', '');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_import_export_group_name', '');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_notify_airline_mismatch', 'true');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_airline_alert_group_id', '');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_airline_alert_group_name', '');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_schedule_from_flights', 'true');
  `);

  // Di chuyển tự động cấu hình cột mới cho database đã tồn tại
  try {
    await dbInstance.exec(`ALTER TABLE classes ADD COLUMN class_exercise_id TEXT;`);
  } catch (e) {}
  try {
    await dbInstance.exec(`ALTER TABLE classes ADD COLUMN is_exercise_finished INTEGER DEFAULT 0;`);
  } catch (e) {}

  // Thêm các cột cho fms_schedules của database cũ
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN ac_type TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN ac_reg TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN route TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN time_arr TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN time_dep TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN time_fuel TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN gate TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN truck_no TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN driver_name TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN operator_name TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN crew_zalo_uids TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN notify_type INTEGER DEFAULT 1;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN fms_date TEXT;`); } catch(e) {}

  // Thêm cột cảnh báo cho fms_fuel_orders của database cũ
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN warn_ac_reg INTEGER DEFAULT 0;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN warn_standby INTEGER DEFAULT 0;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN warn_fuel_order INTEGER DEFAULT 0;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN warn_updated_at DATETIME;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN old_ac_reg TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN old_standby_fuel TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN old_fuel_order TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN gate TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN etd TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN old_etd TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_fuel_orders ADD COLUMN warn_etd INTEGER DEFAULT 0;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_flights_live ADD COLUMN truck_no TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_flights_live ADD COLUMN airline_name TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_flights_live ADD COLUMN unit_code TEXT DEFAULT 'BOTH';`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN unit_code TEXT DEFAULT 'SKYPEC';`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN schedule_source TEXT DEFAULT 'manual';`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN id_fms TEXT;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_schedules ADD COLUMN updated_from_flights_at TEXT;`); } catch(e) {}
  try {
    await dbInstance.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_schedule_from_flights', 'true');`);
  } catch(e) {}

  // Thêm các cột cho fms_temp_import_exports của database cũ
  try { await dbInstance.exec(`ALTER TABLE fms_temp_import_exports ADD COLUMN monitor_type TEXT DEFAULT 'DOMESTIC_TO_INTL';`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_temp_import_exports ADD COLUMN old_time TEXT DEFAULT '-';`); } catch(e) {}

  // Lịch sử giám sát dài hạn (DB cũ)
  try {
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS fms_monitor_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key TEXT NOT NULL UNIQUE,
        ac_reg TEXT NOT NULL,
        monitor_type TEXT NOT NULL,
        event_date TEXT NOT NULL,
        old_flight_no TEXT,
        old_route TEXT,
        old_time TEXT DEFAULT '-',
        fuel_order INTEGER DEFAULT 0,
        reason TEXT,
        status TEXT DEFAULT 'OPEN',
        new_flight_no TEXT,
        new_route TEXT,
        resolved_at TEXT,
        resolved_note TEXT,
        zalo_sent INTEGER DEFAULT 0,
        source_monitor_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {}
  try { await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_monitor_events_date ON fms_monitor_events(event_date);`); } catch (e) {}
  try { await dbInstance.exec(`CREATE INDEX IF NOT EXISTS idx_monitor_events_status ON fms_monitor_events(status);`); } catch (e) {}

  // Snapshot FMS VNA cho detect Cancel (DB cũ)
  try { await dbInstance.exec(`ALTER TABLE fms_vna_presence ADD COLUMN last_etd TEXT;`); } catch (e) {}
  try {
    await dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS fms_vna_presence (
        flight_no TEXT NOT NULL,
        date TEXT NOT NULL,
        ac_reg TEXT NOT NULL,
        route TEXT DEFAULT '-',
        last_etd TEXT DEFAULT NULL,
        last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (flight_no, date)
      );
    `);
  } catch (e) {}

  // Thêm cột phân quyền cho accounts của database cũ
  try { await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN perm_admin INTEGER DEFAULT 0;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN perm_fms INTEGER DEFAULT 0;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN perm_zalo INTEGER DEFAULT 0;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN perm_gemini INTEGER DEFAULT 0;`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE accounts ADD COLUMN perm_gate INTEGER DEFAULT 0;`); } catch(e) {}

  // Tạo tài khoản admin mặc định nếu chưa tồn tại
  const adminRow = await dbInstance.get('SELECT * FROM admin WHERE username = ?', 'admin');
  if (!adminRow) {
    const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
    const hashedPassword = bcrypt.hashSync(defaultPassword, 10);
    await dbInstance.run('INSERT INTO admin (username, password) VALUES (?, ?)', 'admin', hashedPassword);
    console.log(`[DB] Đã tạo tài khoản admin mặc định: admin / ${defaultPassword}`);
  }

  return dbInstance;
}

module.exports = { getDb };
