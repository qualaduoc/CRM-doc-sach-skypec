# SkyEyes FlyClean - Công cụ Đối soát Lịch bay & Tra nạp Xăng dầu

Công cụ chạy Offline (Cục bộ) trên Windows giúp đối soát nhanh chênh lệch số hiệu tàu bay giữa Kế hoạch VIAGS và Dữ liệu tra nạp thực tế Skypec.

## 🚀 Hướng dẫn khởi động nhanh (Chạy Local):

1. **Cách 1 (Kích đúp):**
   - Vào thư mục `FlyClean/`
   - Kích đúp chuột vào file **`start.bat`**.
   
2. **Cách 2 (Sử dụng Terminal):**
   - Mở Terminal tại thư mục `FlyClean/`
   - Chạy lệnh: `node server.js`

*Sau khi chạy, ứng dụng sẽ tự động mở trình duyệt web mặc định của bạn tại địa chỉ: **http://localhost:4567** để sử dụng.*

---

## 🛠️ Các tính năng nổi bật:
* **Giao diện Modern Glassmorphism:** Đẹp mắt, trực quan và dễ sử dụng.
* **Kéo thả file trực quan:** Kéo thả trực tiếp file Excel vào khung để nhận diện tự động.
* **Cấu hình hàng cột động:** Cho phép tùy chỉnh thủ công dòng bắt đầu, tiêu đề và chữ cái tên cột để đề phòng cấu trúc file Excel bị thay đổi trong tương lai.
* **Sao chép và Xuất file báo cáo nhanh:** Có nút bấm sao chép định dạng text ngay lập tức để gửi qua Zalo/Telegram.

## 📦 Đóng gói thành file chạy EXE độc lập:
Nếu Khầy muốn đóng gói toàn bộ server và frontend thành 1 file **`FlyClean.exe`** duy nhất (dung lượng khoảng 30MB, không cần cài đặt node_modules hay chạy file bat):
1. Cài đặt thư viện `pkg` toàn cục: `npm install -g pkg`
2. Đứng tại thư mục `FlyClean/` chạy lệnh đóng gói: `pkg server.js --targets node18-win-x64 --output FlyClean.exe`
