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
      date TEXT NOT NULL,
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    INSERT OR IGNORE INTO settings (key, value) VALUES ('max_active_classes', '3');
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
