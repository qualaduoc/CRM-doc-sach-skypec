/**
 * Bảng ký hiệu chuyến bay → tên hãng HK (billing / fuel customer).
 * Cập nhật khi có quy định mới từ đơn vị.
 */
const AIRLINE_CODE_MAP = {
  IO: 'JSC «IrAero» Airline',
  BSF: 'CÔNG TY CỔ PHẦN HÀNG KHÔNG BẦU TRỜI XANH',
  SAV: 'CÔNG TY TNHH SUN AIR',
  CA: 'World Fuel Services (Singapore) Pte. Ltd.-Air China Cargo',
  QY: 'Sinopec (Hong Kong) Aviation Co., Ltd.-European Air Transport'
};

/** Prefix dài trước để BSF không bị bắt nhầm thành BS */
const SORTED_CODES = Object.keys(AIRLINE_CODE_MAP).sort((a, b) => b.length - a.length);

/**
 * Lấy ký hiệu hãng từ số hiệu chuyến: CA6116 | CA-6116 | CA 6116 | ca6116 → CA
 */
function parseAirlineCodeFromFlightNo(flightNo) {
  if (!flightNo) return null;
  const clean = String(flightNo).toUpperCase().replace(/[\s\-_.]/g, '');
  if (!clean) return null;
  for (const code of SORTED_CODES) {
    if (clean.startsWith(code) && clean.length > code.length && /\d/.test(clean.slice(code.length))) {
      return code;
    }
  }
  // Fallback: chữ cái đầu trước dãy số (VD: BL6211 → BL) — không có trong map thì null
  const m = clean.match(/^([A-Z]{1,4})(\d+)/);
  if (m) {
    const code = m[1];
    if (AIRLINE_CODE_MAP[code]) return code;
  }
  return null;
}

function getExpectedAirlineName(code) {
  if (!code) return null;
  return AIRLINE_CODE_MAP[String(code).toUpperCase()] || null;
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[\s\-_.]/g, '');
}

/**
 * So khớp: ký hiệu từ số chuyến vs CARRIER FMS (và tên nếu có).
 * @returns null nếu không giám sát / hợp lệ; object mismatch nếu sai
 */
function evaluateAirlineMismatch({ flightNo, carrierCode, selectedAirlineName }) {
  const expectedCode = parseAirlineCodeFromFlightNo(flightNo);
  if (!expectedCode) return null;

  const expectedName = getExpectedAirlineName(expectedCode);
  const actualCarrier = normalizeCode(carrierCode);
  const selected = selectedAirlineName ? String(selectedAirlineName).trim() : '';

  let isMismatch = false;
  let reason = '';

  if (actualCarrier) {
    if (actualCarrier !== expectedCode) {
      isMismatch = true;
      reason = `CARRIER FMS="${actualCarrier}" khác ký hiệu chuyến "${expectedCode}"`;
    }
  }

  // Nếu có tên hãng nhân viên chọn (khi FMS/Skypec cung cấp): so khớp mềm với tên đúng
  if (selected && expectedName) {
    const norm = (s) => s.toUpperCase().replace(/\s+/g, ' ').trim();
    const sel = norm(selected);
    const exp = norm(expectedName);
    // Khớp nếu chứa nhau hoặc bằng nhau
    const nameOk = sel === exp || sel.includes(exp) || exp.includes(sel) || sel.includes(expectedCode);
    if (!nameOk) {
      isMismatch = true;
      reason = reason
        ? `${reason}; tên chọn="${selected}"`
        : `Tên hãng chọn không khớp "${expectedName}"`;
    }
  }

  // Chưa có CARRIER và chưa có tên chọn → chưa đủ dữ liệu, không cảnh báo
  if (!actualCarrier && !selected) return null;

  if (!isMismatch) return null;

  return {
    expectedCode,
    expectedName,
    actualCarrier: actualCarrier || '-',
    selectedAirlineName: selected || '-',
    reason
  };
}

function listAirlineMappings() {
  return SORTED_CODES.map(code => ({ code, name: AIRLINE_CODE_MAP[code] }));
}

module.exports = {
  AIRLINE_CODE_MAP,
  parseAirlineCodeFromFlightNo,
  getExpectedAirlineName,
  evaluateAirlineMismatch,
  listAirlineMappings,
  normalizeCode
};
