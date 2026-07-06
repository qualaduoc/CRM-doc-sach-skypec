const XLSX = require('xlsx');
const path = require('path');

// Hàm chuẩn hóa số hiệu chuyến bay (loại bỏ khoảng trắng, đổi thành chữ hoa)
function normalizeFlightNo(flt) {
  if (!flt) return '';
  return flt.toString().replace(/\s+/g, '').toUpperCase();
}

// Hàm chuẩn hóa số hiệu tàu bay (tách phần đăng ký sau dấu gạch ngang và loại bỏ khoảng trắng)
function normalizeRegs(reg) {
  if (!reg) return '';
  let clean = reg.toString().trim().toUpperCase();
  if (clean.includes('-')) {
    const parts = clean.split('-');
    // Bỏ phần tử đầu tiên (loại tàu), gộp tất cả các phần tử còn lại để xử lý tàu bay có nhiều dấu gạch ngang
    clean = parts.slice(1).join('');
  }
  return clean.replace(/\s+/g, '');
}

// Hàm chuẩn hóa tuyến bay (loại bỏ khoảng trắng)
function normalizeRoute(route) {
  if (!route) return '';
  return route.toString().replace(/\s+/g, '').toUpperCase();
}

function runAudit() {
  const viasPath = path.join(__dirname, 'vias.xlsx');
  const skypecPath = path.join(__dirname, 'skypec.xls');

  // 1. Đọc file vias.xlsx (Dữ liệu chuẩn)
  const viasWorkbook = XLSX.readFile(viasPath);
  const viasSheet = viasWorkbook.Sheets[viasWorkbook.SheetNames[0]];
  const viasRows = XLSX.utils.sheet_to_json(viasSheet, { header: 1 });
  
  const viasMap = {}; // Dùng Map để tra cứu nhanh theo FlightNo
  
  viasRows.slice(9).forEach(row => {
    if (!row || row.length < 5) return;
    const flightNo = normalizeFlightNo(row[2] || row[1]); // Dùng DEP FLT NO hoặc ARR FLT NO
    const regs = normalizeRegs(row[3]);
    const route = normalizeRoute(row[4]);
    if (!flightNo) return;

    // Lưu lại thông tin chuẩn
    viasMap[flightNo] = {
      flightNoOriginal: (row[2] || row[1] || '').trim(),
      regsOriginal: (row[3] || '').trim(),
      regs,
      routeOriginal: (row[4] || '').trim(),
      route,
      std: (row[6] || '').trim(),
      prk: (row[12] || '').trim(),
      gate: (row[13] || '').trim(),
      aircraft: (row[15] || '').trim()
    };
  });

  // 2. Đọc file skypec.xls (Dữ liệu thực tế tra nạp của nhân viên)
  const skypecWorkbook = XLSX.readFile(skypecPath);
  const skypecSheet = skypecWorkbook.Sheets[skypecWorkbook.SheetNames[0]];
  const skypecRows = XLSX.utils.sheet_to_json(skypecSheet);

  const errors = [];
  let totalChecked = 0;

  skypecRows.forEach(row => {
    const flightNoRaw = row['Số hiệu chuyến bay'];
    const regsRaw = row['Số hiệu tàu bay'];
    
    if (!flightNoRaw) return;
    
    const flightNo = normalizeFlightNo(flightNoRaw);
    const regs = normalizeRegs(regsRaw);
    
    totalChecked++;

    // Tra cứu chuyến bay tương ứng trong dữ liệu chuẩn VIAGS
    const viasMatch = viasMap[flightNo];

    if (viasMatch) {
      // So sánh số đăng ký tàu bay (REGS) giữa VIAGS (Chuẩn) và Skypec (Nhân viên nhập)
      if (viasMatch.regs !== regs) {
        errors.push({
          flightNo: viasMatch.flightNoOriginal,
          viasRegs: viasMatch.regsOriginal,
          skypecRegs: regsRaw.trim(),
          viasRoute: viasMatch.routeOriginal,
          skypecRoute: (row['Tuyến bay'] || '').trim(),
          ticketNo: row['Số phiếu xuất'],
          receiptNo: row['Số Receipt'],
          driver: row['Lái xe tra nạp'],
          operator: row['Thợ bơm'],
          kg: row['Số Kg']
        });
      }
    }
  });

  console.log(`\n==================================================`);
  console.log(`BÁO CÁO SAI PHẠM ĐIỀN SAI SỐ TÀU BAY (NGÀY 05/07/2026)`);
  console.log(`==================================================`);
  console.log(`- Tổng số phiếu tra nạp được kiểm tra: ${totalChecked}`);
  console.log(`- Số trường hợp phát hiện sai lệch số hiệu tàu bay: ${errors.length}`);
  console.log(`--------------------------------------------------\n`);

  if (errors.length === 0) {
    console.log(`Chúc mừng! Không phát hiện trường hợp sai lệch số tàu bay nào.`);
  } else {
    errors.forEach((err, idx) => {
      console.log(`Trường hợp sai phạm #${idx + 1}:`);
      console.log(`  ✈️ Chuyến bay: ${err.flightNo} | Chặng: ${err.viasRoute} (Skypec ghi: ${err.skypecRoute})`);
      console.log(`  ✅ Số tàu bay CHUẨN (VIAGS)   : ${err.viasRegs}`);
      console.log(`  ❌ Số tàu bay NHẬP SAI (Skypec): ${err.skypecRegs}`);
      console.log(`  📄 Chứng từ: Phiếu xuất số ${err.ticketNo} | Số Receipt: ${err.receiptNo} | Lượng nạp: ${err.kg} kg`);
      console.log(`  👤 Nhân viên chịu trách nhiệm : Lái xe: ${err.driver || 'N/A'} | Thợ bơm: ${err.operator || 'N/A'}`);
      console.log(`  --------------------------------------------------`);
    });
  }
}

runAudit();
