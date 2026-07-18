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

    INSERT OR IGNORE INTO settings (key, value) VALUES ('max_active_classes', '3');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('fms_import_export_duration', '24h');
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

  // Thêm các cột cho fms_temp_import_exports của database cũ
  try { await dbInstance.exec(`ALTER TABLE fms_temp_import_exports ADD COLUMN monitor_type TEXT DEFAULT 'DOMESTIC_TO_INTL';`); } catch(e) {}
  try { await dbInstance.exec(`ALTER TABLE fms_temp_import_exports ADD COLUMN old_time TEXT DEFAULT '-';`); } catch(e) {}

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
