const https = require('https');
const { getDb } = require('./db');

function log(msg) {
  console.log(`[OCR Service] [${new Date().toISOString()}] ${msg}`);
}

// Gọi API Gemini 1.5 Flash sử dụng HTTPS thuần của Node.js
async function callGeminiVisionAPI(apiKey, mimeType, base64Image) {
  return new Promise((resolve, reject) => {
    const prompt = `Bạn là chuyên gia số hóa dữ liệu hàng không. Nhiệm vụ của bạn là nhận diện và bóc tách bảng kế hoạch trực ca của nhân viên tra nạp nhiên liệu từ hình ảnh được cung cấp.
Bảng này gồm các cột tương ứng:
- Cột 1: STT
- Cột 2: Loại tàu bay (ac_type, ví dụ: B737, A321, B747, B777, A330, B787)
- Cột 3: Số hiệu máy bay (ac_reg, ví dụ: VNA508, VNA353, VNA909)
- Cột 4: Số hiệu chuyến bay (flight_no, ví dụ: KJ 372, KE 362, VN 205, VN 7591)
- Cột 5: Đường bay (route, ví dụ: HAN-ICN, HAN-SGN, HAN-VDH)
- Cột 6: Bỏ qua
- Cột 7: Giờ hạ cánh (time_arr)
- Cột 8: Giờ cất cánh (time_dep)
- Cột 9: Giờ tra nạp (time_fuel)
- Cột 10: Vị trí tàu bay đỗ (gate, ví dụ: 37, 50, 55, 74, 12A)
- Cột 11: Số xe tra nạp (truck_no, ví dụ: 6, 12, 10, 5)
- Cột 12: Tên lái xe (driver_name, ví dụ: HÀ, THẮNG, TUẤN, HÙNG, VÂN, THÀNH, N.HẢI)
- Cột 13: Tên thợ bơm (operator_name, ví dụ: TÂM, L.KIÊN, L.TUẤN, L.CƯỜNG, B.HIỆP, MẠNH, D.HỘI)

Chỉ bóc tách các dòng dữ liệu hợp lệ bắt đầu bằng số thứ tự (STT). Trả về dữ liệu JSON có cấu trúc là một đối tượng chứa thuộc tính "flights", trong đó mỗi phần tử đại diện cho một chuyến bay với các thuộc tính tương ứng ở trên.`;

    const payload = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Image
            }
          }
        ]
      }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            flights: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  ac_type: { type: 'STRING' },
                  ac_reg: { type: 'STRING' },
                  flight_no: { type: 'STRING' },
                  route: { type: 'STRING' },
                  time_arr: { type: 'STRING' },
                  time_dep: { type: 'STRING' },
                  time_fuel: { type: 'STRING' },
                  gate: { type: 'STRING' },
                  truck_no: { type: 'STRING' },
                  driver_name: { type: 'STRING' },
                  operator_name: { type: 'STRING' }
                },
                required: ['flight_no']
              }
            }
          }
        }
      }
    });

    const options = {
      hostname: 'generativelanguage.googleapis.com',
      port: 443,
      path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Google API trả về lỗi HTTP ${res.statusCode}: ${body}`));
        }
        try {
          const json = JSON.parse(body);
          const responseText = json.candidates[0].content.parts[0].text;
          const parsed = JSON.parse(responseText);
          resolve(parsed.flights || []);
        } catch (e) {
          reject(new Error(`Lỗi bóc tách JSON kết quả từ Gemini: ${e.message} (Raw: ${body})`));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Thực hiện bóc tách ảnh bằng danh sách API Keys xoay vòng
async function performImageOCR(mimeType, base64Image) {
  const db = await getDb();
  const setting = await db.get("SELECT value FROM settings WHERE key = 'gemini_api_keys'");
  
  // Mặc định sử dụng API Key trong môi trường nếu settings chưa cấu hình
  const rawKeys = setting ? setting.value : (process.env.GEMINI_API_KEY || '');
  const apiKeys = rawKeys
    .split(/[\n,;]/)
    .map(k => k.trim())
    .filter(k => k.length > 0);

  if (apiKeys.length === 0) {
    throw new Error('Chưa cấu hình API Key Gemini trong hệ thống. Vui lòng thêm key tại mục cấu hình!');
  }

  log(`Tìm thấy ${apiKeys.length} API Keys Gemini trong hệ thống để thực hiện xoay vòng.`);

  let lastError = null;
  for (let idx = 0; idx < apiKeys.length; idx++) {
    const key = apiKeys[idx];
    const maskedKey = key.substring(0, 6) + '...' + key.substring(key.length - 4);
    log(`[Thử lần ${idx + 1}/${apiKeys.length}] Đang quét ảnh bằng API Key: ${maskedKey}`);

    try {
      const flights = await callGeminiVisionAPI(key, mimeType, base64Image);
      log(`[Thành công] Đã bóc tách thành công ${flights.length} chuyến bay bằng API Key: ${maskedKey}`);
      return flights;
    } catch (err) {
      lastError = err;
      console.error(`[Lỗi] API Key ${maskedKey} thất bại:`, err.message);
      // Tiếp tục xoay vòng thử API key tiếp theo
    }
  }

  throw new Error(`Tất cả ${apiKeys.length} API Keys Gemini đều bị lỗi hoặc hết hạn ngạch. Lỗi cuối cùng: ${lastError.message}`);
}

module.exports = {
  performImageOCR
};
