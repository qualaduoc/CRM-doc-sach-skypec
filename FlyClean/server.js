const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 4567;

// Cấu hình multer để upload file lên bộ nhớ tạm (Buffer)
const storage = multer.memoryStorage();
const uploadInstance = multer({ storage: storage });
const upload = uploadInstance.fields([
  { name: 'viasFile', maxCount: 1 },
  { name: 'skypecFile', maxCount: 1 }
]);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Hàm chuyển đổi Chữ cái cột (A, B, C...) hoặc Số chỉ số (0, 1, 2...) sang Chỉ số mảng (0-indexed)
function parseColRef(ref, headerRow = null) {
  if (ref === undefined || ref === null) return -1;
  const val = ref.toString().trim();
  if (val === '') return -1;

  // 1. Nếu là số thuần túy (ví dụ: "2") -> Trả về chính số đó
  if (/^\d+$/.test(val)) {
    return parseInt(val);
  }

  // 2. Nếu là chữ cái cột (ví dụ: "A", "B", "AA") -> Quy đổi ra chỉ số
  if (/^[A-Z]+$/i.test(val)) {
    let clean = val.toUpperCase();
    let col = 0;
    for (let i = 0; i < clean.length; i++) {
      col = col * 26 + (clean.charCodeAt(i) - 64);
    }
    return col - 1;
  }

  // 3. Nếu là Tên cột (chữ thường/hoa) và ta có dòng header để tìm kiếm
  if (headerRow && Array.isArray(headerRow)) {
    const cleanVal = val.toLowerCase().replace(/\s+/g, '');
    for (let i = 0; i < headerRow.length; i++) {
      if (headerRow[i]) {
        const cleanHeader = headerRow[i].toString().toLowerCase().replace(/\s+/g, '');
        if (cleanHeader === cleanVal || cleanHeader.includes(cleanVal)) {
          return i;
        }
      }
    }
  }

  return -1;
}

// Chuẩn hóa số hiệu chuyến bay
function normalizeFlightNo(flt) {
  if (!flt) return '';
  return flt.toString().replace(/\s+/g, '').toUpperCase();
}

// Chuẩn hóa số hiệu tàu bay
function normalizeRegs(reg) {
  if (!reg) return '';
  let clean = reg.toString().trim().toUpperCase();
  if (clean.includes('-')) {
    const parts = clean.split('-');
    clean = parts.slice(1).join(''); // Gộp tất cả các phần tử sau dấu gạch ngang thứ nhất
  }
  return clean.replace(/\s+/g, '');
}

// Chuẩn hóa tuyến bay
function normalizeRoute(route) {
  if (!route) return '';
  return route.toString().replace(/\s+/g, '').toUpperCase();
}

// Chuyển đổi ngày Excel sang String YYYY-MM-DD
function excelDateToString(excelDate) {
  if (!excelDate) return '';
  // Nếu là số Excel
  if (!isNaN(excelDate)) {
    const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy}`;
  }
  return excelDate.toString().trim();
}

// Chuyển đổi thời gian Excel sang HH:MM
function excelTimeToStr(excelTime) {
  if (!excelTime) return '';
  if (!isNaN(excelTime)) {
    const totalSeconds = Math.round((excelTime % 1) * 24 * 3600);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  return excelTime.toString().trim();
}

// API thực hiện đối soát dữ liệu
app.post('/api/compare', upload, (req, res) => {
  try {
    const viasFile = req.files['viasFile'] ? req.files['viasFile'][0] : null;
    const skypecFile = req.files['skypecFile'] ? req.files['skypecFile'][0] : null;
    const config = JSON.parse(req.body.config || '{}');

    if (!viasFile || !skypecFile) {
      return res.status(400).json({ success: false, error: 'Thiếu file Vias hoặc file Skypec!' });
    }

    // 1. Phân tích file VIAGS (Dữ liệu chuẩn)
    const viasWorkbook = XLSX.read(viasFile.buffer, { type: 'buffer' });
    const viasSheetName = viasWorkbook.SheetNames[0];
    const viasSheet = viasWorkbook.Sheets[viasSheetName];
    const viasRows = XLSX.utils.sheet_to_json(viasSheet, { header: 1 });

    const viasHeaderIdx = Math.max(0, parseInt(config.viasHeaderRow || 9) - 1);
    const viasDataStartIdx = Math.max(0, parseInt(config.viasStartRow || 10) - 1);
    const viasHeaderRow = viasRows[viasHeaderIdx] || [];

    // Quy đổi cột vias sang chỉ số
    const viasColFlight = parseColRef(config.viasColFlight || 'C', viasHeaderRow);
    const viasColRegs = parseColRef(config.viasColRegs || 'D', viasHeaderRow);
    const viasColRoute = parseColRef(config.viasColRoute || 'E', viasHeaderRow);

    const viasFlights = [];
    viasRows.slice(viasDataStartIdx).forEach((row, idx) => {
      if (!row || row.length === 0) return;
      
      const rawFlight = row[viasColFlight];
      if (!rawFlight) return;
      
      const flightNo = normalizeFlightNo(rawFlight);
      const regs = normalizeRegs(row[viasColRegs]);
      const route = normalizeRoute(row[viasColRoute]);

      viasFlights.push({
        index: row[0] || (idx + 1),
        flightNoOriginal: rawFlight.toString().trim(),
        flightNo,
        regsOriginal: (row[viasColRegs] || '').toString().trim(),
        regs,
        routeOriginal: (row[viasColRoute] || '').toString().trim(),
        route,
        std: (row[parseColRef('G')] || '').toString().trim(),
        prk: (row[parseColRef('M')] || '').toString().trim(),
        gate: (row[parseColRef('N')] || '').toString().trim()
      });
    });

    // 2. Phân tích file SKYPEC (Dữ liệu thực tế nạp của nhân viên)
    const skypecWorkbook = XLSX.read(skypecFile.buffer, { type: 'buffer' });
    const skypecSheetName = skypecWorkbook.SheetNames[0];
    const skypecSheet = skypecWorkbook.Sheets[skypecSheetName];
    const skypecRows = XLSX.utils.sheet_to_json(skypecSheet, { header: 1 });

    const skypecHeaderIdx = Math.max(0, parseInt(config.skypecHeaderRow || 1) - 1);
    const skypecDataStartIdx = Math.max(0, parseInt(config.skypecStartRow || 2) - 1);
    const skypecHeaderRow = skypecRows[skypecHeaderIdx] || [];

    // Quy đổi cột skypec sang chỉ số
    const skypecColFlight = parseColRef(config.skypecColFlight || 'Số hiệu chuyến bay', skypecHeaderRow);
    const skypecColRegs = parseColRef(config.skypecColRegs || 'Số hiệu tàu bay', skypecHeaderRow);
    const skypecColRoute = parseColRef(config.skypecColRoute || 'Tuyến bay', skypecHeaderRow);
    const skypecColKg = parseColRef(config.skypecColKg || 'Số Kg', skypecHeaderRow);
    const skypecColDriver = parseColRef(config.skypecColDriver || 'Lái xe tra nạp', skypecHeaderRow);
    const skypecColOperator = parseColRef(config.skypecColOperator || 'Thợ bơm', skypecHeaderRow);
    const skypecColTicket = parseColRef(config.skypecColTicket || 'Số phiếu xuất', skypecHeaderRow);
    const skypecColReceipt = parseColRef(config.skypecColReceipt || 'Số Receipt', skypecHeaderRow);
    const skypecColDate = parseColRef(config.skypecColDate || 'Ngày xuất', skypecHeaderRow);
    const skypecColTimeEnd = parseColRef(config.skypecColTimeEnd || 'Giờ kết thúc tra nạp', skypecHeaderRow);

    const skypecFlights = [];
    skypecRows.slice(skypecDataStartIdx).forEach((row, idx) => {
      if (!row || row.length === 0) return;
      const rawFlight = row[skypecColFlight];
      if (!rawFlight) return;

      skypecFlights.push({
        index: row[0] || (idx + 1),
        flightNo: normalizeFlightNo(rawFlight),
        flightNoOriginal: rawFlight.toString().trim(),
        regs: normalizeRegs(row[skypecColRegs]),
        regsOriginal: (row[skypecColRegs] || '').toString().trim(),
        route: normalizeRoute(row[skypecColRoute]),
        routeOriginal: (row[skypecColRoute] || '').toString().trim(),
        kg: row[skypecColKg] || 0,
        driver: (row[skypecColDriver] || 'N/A').toString().trim(),
        operator: (row[skypecColOperator] || 'N/A').toString().trim(),
        ticketNo: (row[skypecColTicket] || 'N/A').toString().trim(),
        receiptNo: (row[skypecColReceipt] || 'N/A').toString().trim(),
        dateStr: excelDateToString(row[skypecColDate]),
        timeEnd: excelTimeToStr(row[skypecColTimeEnd])
      });
    });

    // 3. Tiến hành đối soát
    const viasMap = {};
    viasFlights.forEach(f => {
      viasMap[f.flightNo] = f;
    });

    const matchedFlights = [];
    const mismatchedFlights = [];
    const unmatchedSkypec = [];
    const unmatchedVias = [];

    const matchedSkypecIdxs = new Set();
    const matchedViasIdxs = new Set();

    // Đối chiếu theo Số hiệu chuyến bay làm khóa
    skypecFlights.forEach(sf => {
      const vf = viasMap[sf.flightNo];
      if (vf) {
        // Có cùng số hiệu chuyến bay
        if (vf.regs === sf.regs) {
          // Khớp hoàn toàn cả số tàu
          matchedFlights.push({ vias: vf, skypec: sf });
          matchedSkypecIdxs.add(sf.index);
          matchedViasIdxs.add(vf.index);
        } else {
          // Sai lệch số đăng ký tàu bay!
          mismatchedFlights.push({ vias: vf, skypec: sf });
          matchedSkypecIdxs.add(sf.index);
          matchedViasIdxs.add(vf.index);
        }
      } else {
        unmatchedSkypec.push(sf);
      }
    });

    // Tìm các chuyến bay vias không có trong phiếu nạp Skypec
    viasFlights.forEach(vf => {
      if (!matchedViasIdxs.has(vf.index)) {
        unmatchedVias.push(vf);
      }
    });

    res.json({
      success: true,
      summary: {
        totalVias: viasFlights.length,
        totalSkypec: skypecFlights.length,
        matchedCount: matchedFlights.length,
        mismatchedCount: mismatchedFlights.length,
        unmatchedViasCount: unmatchedVias.length,
        unmatchedSkypecCount: unmatchedSkypec.length,
        date: viasFlights.length > 0 ? (viasRows[2] ? viasRows[2][0] : 'Chưa rõ ngày') : 'Chưa rõ ngày'
      },
      results: {
        matched: matchedFlights,
        mismatched: mismatchedFlights, // Đây chính là danh sách điền sai số tàu bay!
        unmatchedVias: unmatchedVias, // VIAGS có nhưng Skypec chưa nạp
        unmatchedSkypec: unmatchedSkypec // Skypec nạp nhưng VIAGS không có trong lịch
      }
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Lỗi trong quá trình đối soát: ' + e.message });
  }
});

// Tự động mở trình duyệt web khi chạy server
app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 FLYCLEAN DESKTOP SERVER ĐANG CHẠY TẠI PORT: ${PORT}`);
  console.log(`👉 Truy cập giao diện: http://localhost:${PORT}`);
  console.log(`==================================================\n`);
  
  // Tự động mở trình duyệt web theo OS
  const url = `http://localhost:${PORT}`;
  const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  require('child_process').exec(`${startCmd} ${url}`);
});
