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

// Hàm chuyển đổi ngày Excel sang String YYYY-MM-DD
function excelDateToString(excelDate) {
  if (!excelDate) return '';
  const date = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// Hàm chuyển đổi thời gian Excel (phần thập phân) sang HH:MM
function excelTimeToStr(excelTime) {
  if (!excelTime) return '';
  const totalSeconds = Math.round((excelTime % 1) * 24 * 3600);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function runComparison() {
  const viasPath = path.join(__dirname, 'vias.xlsx');
  const skypecPath = path.join(__dirname, 'skypec.xls');

  // 1. Đọc vias.xlsx
  const viasWorkbook = XLSX.readFile(viasPath);
  const viasSheet = viasWorkbook.Sheets[viasWorkbook.SheetNames[0]];
  const viasRows = XLSX.utils.sheet_to_json(viasSheet, { header: 1 });
  
  // Trích xuất ngày từ tiêu đề dòng 3 (ví dụ: KẾ HOẠCH BAY CHỦ NHẬT NGÀY 05/07/2026)
  const titleRow = viasRows[2] ? viasRows[2][0] : '';
  console.log('Tiêu đề lịch bay VIAGS:', titleRow);

  // Đọc danh sách chuyến bay kế hoạch từ dòng 10 trở đi
  const viasFlights = [];
  viasRows.slice(9).forEach(row => {
    if (!row || row.length < 5) return;
    const flightNo = normalizeFlightNo(row[2] || row[1]); // Dùng DEP FLT NO hoặc ARR FLT NO
    const regs = normalizeRegs(row[3]);
    const route = normalizeRoute(row[4]);
    if (!flightNo) return;

    viasFlights.push({
      index: row[0],
      flightNoOriginal: (row[2] || row[1] || '').trim(),
      flightNo,
      regsOriginal: (row[3] || '').trim(),
      regs,
      routeOriginal: (row[4] || '').trim(),
      route,
      std: (row[6] || '').trim(),
      atd: (row[10] || '').trim(),
      prk: (row[12] || '').trim(),
      gate: (row[13] || '').trim(),
      aircraft: (row[15] || '').trim(),
      rawRow: row
    });
  });

  console.log(`Đọc được ${viasFlights.length} chuyến bay kế hoạch từ VIAGS.`);

  // 2. Đọc skypec.xls
  const skypecWorkbook = XLSX.readFile(skypecPath);
  const skypecSheet = skypecWorkbook.Sheets[skypecWorkbook.SheetNames[0]];
  const skypecRows = XLSX.utils.sheet_to_json(skypecSheet); // Đọc dạng object dựa vào header dòng 1

  const skypecFlights = skypecRows.map((row, idx) => {
    const flightNo = normalizeFlightNo(row['Số hiệu chuyến bay']);
    const regs = normalizeRegs(row['Số hiệu tàu bay']);
    const route = normalizeRoute(row['Tuyến bay']);
    const kg = row['Số Kg'];
    
    // Convert ngày giờ
    const dateStr = excelDateToString(row['Ngày xuất']);
    const timeStart = excelTimeToStr(row['Giờ bắt đầu tra nạp']);
    const timeEnd = excelTimeToStr(row['Giờ kết thúc tra nạp']);

    return {
      index: row['STT'] || (idx + 1),
      flightNo,
      regs,
      route,
      kg,
      dateStr,
      timeStart,
      timeEnd,
      driver: row['Lái xe tra nạp'],
      operator: row['Thợ bơm'],
      rawRow: row
    };
  });

  console.log(`Đọc được ${skypecFlights.length} phiếu tra nạp thực tế từ Skypec.`);

  // 3. Tiến hành đối soát khớp nối
  console.log('\n--- BẮT ĐẦU ĐỐI SOÁT ---');
  let matchCount = 0;
  const matchedViasIndices = new Set();
  const matchedSkypecIndices = new Set();
  
  const comparisonResults = [];

  viasFlights.forEach(vf => {
    // Tìm trong Skypec có phiếu nào khớp cả FlightNo và Regs không
    const match = skypecFlights.find(sf => {
      // Điều kiện khớp: Khớp số hiệu chuyến bay VÀ khớp số hiệu tàu bay
      return sf.flightNo === vf.flightNo && sf.regs === vf.regs;
    });

    if (match) {
      matchCount++;
      matchedViasIndices.add(vf.index);
      matchedSkypecIndices.add(match.index);
      comparisonResults.push({
        status: 'KHỚP',
        vias: vf,
        skypec: match
      });
    } else {
      comparisonResults.push({
        status: 'KHÔNG_KHỚP_SKYPEC',
        vias: vf,
        skypec: null
      });
    }
  });

  // Tìm các phiếu Skypec không có trong kế hoạch VIAGS
  skypecFlights.forEach(sf => {
    if (!matchedSkypecIndices.has(sf.index)) {
      comparisonResults.push({
        status: 'KHÔNG_KHỚP_VIAGS',
        vias: null,
        skypec: sf
      });
    }
  });

  console.log(`Số lượng chuyến bay khớp hoàn toàn (Số hiệu chuyến + Số tàu): ${matchCount} / ${viasFlights.length}`);
  
  // In ra 10 chuyến bay khớp đầu tiên làm ví dụ
  console.log('\n--- VÍ DỤ 10 CHUYẾN BAY KHỚP HOÀN TOÀN ---');
  let printedMatch = 0;
  comparisonResults.forEach(r => {
    if (r.status === 'KHỚP' && printedMatch < 10) {
      printedMatch++;
      console.log(`Khớp ${printedMatch}:`);
      console.log(`  - VIAGS : ${r.vias.flightNoOriginal} | Tàu: ${r.vias.regsOriginal} | Tuyến: ${r.vias.routeOriginal} | STD: ${r.vias.std} | Đỗ: ${r.vias.prk}`);
      console.log(`  - Skypec: ${r.skypec.rawRow['Số hiệu chuyến bay']} | Tàu: ${r.skypec.rawRow['Số hiệu tàu bay']} | Tuyến: ${r.skypec.rawRow['Tuyến bay']} | Lượng nạp: ${r.skypec.kg} kg | Nạp xong lúc: ${r.skypec.timeEnd} | Lái xe: ${r.skypec.driver}`);
    }
  });

  // In ra các chuyến bay VIAGS không tìm thấy nạp Skypec
  console.log('\n--- VÍ DỤ 5 CHUYẾN BAY KẾ HOẠCH VIAGS CHƯA CÓ THÔNG TIN NẠP SKYPEC ---');
  let printedNoSkypec = 0;
  comparisonResults.forEach(r => {
    if (r.status === 'KHÔNG_KHỚP_SKYPEC' && printedNoSkypec < 5) {
      printedNoSkypec++;
      console.log(`Chưa nạp ${printedNoSkypec}: Chuyến ${r.vias.flightNoOriginal} | Tàu: ${r.vias.regsOriginal} | Tuyến: ${r.vias.routeOriginal} | STD: ${r.vias.std} | Đỗ: ${r.vias.prk}`);
    }
  });

  // In ra các phiếu nạp Skypec không có trong kế hoạch VIAGS
  console.log('\n--- VÍ DỤ 5 PHIẾU NẠP SKYPEC KHÔNG NẰM TRONG KẾ HOẠCH VIAGS ---');
  let printedNoViags = 0;
  comparisonResults.forEach(r => {
    if (r.status === 'KHÔNG_KHỚP_VIAGS' && printedNoViags < 5) {
      printedNoViags++;
      console.log(`Phiếu dư ${printedNoViags}: Chuyến ${r.skypec.rawRow['Số hiệu chuyến bay']} | Tàu: ${r.skypec.rawRow['Số hiệu tàu bay']} | Tuyến: ${r.skypec.rawRow['Tuyến bay']} | Lượng nạp: ${r.skypec.kg} kg`);
    }
  });
}

runComparison();
