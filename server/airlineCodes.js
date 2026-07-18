/**
 * Bảng ký hiệu chuyến bay → tên hãng HK (billing / fuel customer).
 * CA đặc biệt:
 *   3 số = Air China Limited
 *   4 số = World Fuel Services (Singapore) Pte. Ltd.-Air China Cargo
 * Nguồn thực tế để so khớp: field "Hãng bay" trên FMS Skypec Flights.
 */

const AIRLINE_CODE_MAP = {
  IO: 'JSC «IrAero» Airline',
  BSF: 'CÔNG TY CỔ PHẦN HÀNG KHÔNG BẦU TRỜI XANH',
  SAV: 'CÔNG TY TNHH SUN AIR',
  QY: 'Sinopec (Hong Kong) Aviation Co., Ltd.-European Air Transport'
};

/** CA: 3 chữ số sau ký hiệu */
const CA_NAME_3_DIGITS = 'Air China Limited';
/** CA: 4 chữ số sau ký hiệu */
const CA_NAME_4_DIGITS = 'World Fuel Services (Singapore) Pte. Ltd.-Air China Cargo';

/** Các ký hiệu đang giám sát (CA không nằm trong AIRLINE_CODE_MAP vì tên phụ thuộc số chữ số) */
const MONITOR_CODES = [...Object.keys(AIRLINE_CODE_MAP), 'CA'].sort((a, b) => b.length - a.length);

/**
 * Lấy ký hiệu hãng từ số hiệu chuyến: CA6116 | CA-6116 | CA 6116 | ca6116 → CA
 */
function parseAirlineCodeFromFlightNo(flightNo) {
  if (!flightNo) return null;
  const clean = String(flightNo).toUpperCase().replace(/[\s\-_.]/g, '');
  if (!clean) return null;
  for (const code of MONITOR_CODES) {
    if (clean.startsWith(code) && clean.length > code.length && /\d/.test(clean.slice(code.length))) {
      return code;
    }
  }
  // Fallback: chữ cái đầu trước dãy số — chỉ khi đã có trong map giám sát
  const m = clean.match(/^([A-Z]{1,4})(\d+)/);
  if (m) {
    const code = m[1];
    if (MONITOR_CODES.includes(code)) return code;
  }
  return null;
}

/** Phần số ngay sau ký hiệu (VD: CA6116 → "6116") */
function getFlightNumberDigits(flightNo, code) {
  if (!flightNo || !code) return '';
  const clean = String(flightNo).toUpperCase().replace(/[\s\-_.]/g, '');
  const c = String(code).toUpperCase();
  if (!clean.startsWith(c)) return '';
  const m = clean.slice(c.length).match(/^(\d+)/);
  return m ? m[1] : '';
}

/**
 * Tên hãng đúng theo ký hiệu (+ số chữ số với CA).
 * @param {string} code
 * @param {string} [flightNo] bắt buộc cho CA để phân 3/4 số
 */
function getExpectedAirlineName(code, flightNo) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  if (c === 'CA') {
    const digits = getFlightNumberDigits(flightNo, 'CA');
    if (!digits) return null;
    if (digits.length === 3) return CA_NAME_3_DIGITS;
    if (digits.length >= 4) return CA_NAME_4_DIGITS;
    // 1–2 số: coi như biến thể 3 số
    return CA_NAME_3_DIGITS;
  }
  return AIRLINE_CODE_MAP[c] || null;
}

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[\s\-_.]/g, '');
}

function normalizeAirlineName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[«»""'']/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chuẩn hoá biến thể pháp lý để so mềm (LIMITED≈LTD, COMPANY≈CO, …) */
function expandLegalSynonyms(s) {
  return String(s || '')
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/\bCOMPANY\b/g, 'CO')
    .replace(/\bCORPORATION\b/g, 'CORP')
    .replace(/\bINCORPORATED\b/g, 'INC')
    .replace(/\bPRIVATE\b/g, 'PTE')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * So khớp mềm tên hãng: bằng nhau, chứa nhau, hoặc trùng phần lớn token dài.
 */
function namesMatch(actual, expected) {
  if (!actual || !expected) return false;
  const a0 = normalizeAirlineName(actual);
  const e0 = normalizeAirlineName(expected);
  if (!a0 || !e0) return false;
  const a = expandLegalSynonyms(a0);
  const e = expandLegalSynonyms(e0);
  if (a === e) return true;
  if (a.includes(e) || e.includes(a)) return true;

  const tokensE = e.split(/[\s\-.,;/()]+/).filter(t => t.length >= 3);
  if (tokensE.length === 0) return false;
  const hit = tokensE.filter(t => a.includes(t)).length;
  return hit >= Math.ceil(tokensE.length * 0.6);
}

/**
 * So khớp tên hãng đúng vs Hãng bay Skypec (ưu tiên), fallback CARRIER FMS VNA.
 * @returns null nếu không giám sát / hợp lệ / thiếu dữ liệu; object mismatch nếu sai
 */
function evaluateAirlineMismatch({ flightNo, carrierCode, selectedAirlineName, actualAirlineName }) {
  const expectedCode = parseAirlineCodeFromFlightNo(flightNo);
  if (!expectedCode) return null;

  const expectedName = getExpectedAirlineName(expectedCode, flightNo);
  if (!expectedName) return null;

  // Ưu tiên: Hãng bay Skypec → selectedAirlineName (tương thích cũ) → rỗng
  const actualName = String(actualAirlineName || selectedAirlineName || '').trim();
  const actualCarrier = normalizeCode(carrierCode);

  // 1) Có tên hãng thực tế (Skypec) → so tên
  if (actualName) {
    if (namesMatch(actualName, expectedName)) return null;
    return {
      expectedCode,
      expectedName,
      actualCarrier: actualCarrier || '-',
      actualAirlineName: actualName,
      selectedAirlineName: actualName,
      reason: `Hãng bay Skypec="${actualName}" khác tên đúng "${expectedName}"`
    };
  }

  // 2) Chưa có Hãng bay: fallback CARRIER FMS VNA (so ký hiệu)
  if (actualCarrier) {
    if (actualCarrier === expectedCode) return null;
    return {
      expectedCode,
      expectedName,
      actualCarrier,
      actualAirlineName: '-',
      selectedAirlineName: '-',
      reason: `CARRIER FMS="${actualCarrier}" khác ký hiệu chuyến "${expectedCode}" (chưa có Hãng bay Skypec)`
    };
  }

  // Chưa đủ dữ liệu → không cảnh báo
  return null;
}

function listAirlineMappings() {
  const base = Object.keys(AIRLINE_CODE_MAP)
    .sort((a, b) => b.length - a.length)
    .map(code => ({ code, name: AIRLINE_CODE_MAP[code] }));
  return [
    ...base,
    { code: 'CA (3 số)', name: CA_NAME_3_DIGITS },
    { code: 'CA (4 số)', name: CA_NAME_4_DIGITS }
  ];
}

module.exports = {
  AIRLINE_CODE_MAP,
  CA_NAME_3_DIGITS,
  CA_NAME_4_DIGITS,
  MONITOR_CODES,
  parseAirlineCodeFromFlightNo,
  getFlightNumberDigits,
  getExpectedAirlineName,
  evaluateAirlineMismatch,
  listAirlineMappings,
  normalizeCode,
  namesMatch,
  normalizeAirlineName
};
