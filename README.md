# MarkMoment — Smart Tab Context Bookmark & Reminder Extension

Chrome Extension (Manifest V3) gọn nhẹ giúp lưu **đúng khoảnh khắc đang xem/đọc dở** trên tab hiện tại và nhắc bạn quay lại đúng lúc bằng thông báo nổi tinh tế ở **góc trên-phải Chrome** kèm âm thanh chuông nhẹ.

## Tính năng chính

- **Bắt & khôi phục chính xác ngữ cảnh:**
  - **YouTube (`youtube.com`, `youtu.be`, Shorts):** Tự lấy chính xác giây đang xem (`HH:MM:SS`) và tua lại đúng mốc khi mở lại.
  - **Video HTML5 chung:** Bắt thời gian hiện tại của thẻ `<video>` trên các trang học online.
  - **Blog / Web đọc bài:** Lưu `%` cuộn kết hợp đoạn văn neo (`anchorText`, `anchorOccurrence`, `anchorViewportTop`) và tự căn chỉnh lại theo ảnh lazy-load để không bị lệch vị trí, kèm highlight mềm trong 2 giây.
  - **PDF:** Lưu và mở lại đúng số trang (`#page=N`).
- **Hẹn giờ & Thói quen lặp lại:**
  - Preset nhanh: `+15 phút`, `+30 phút`, `+1 giờ`, `Tối 20:00`, `Mai 09:00`.
  - Tùy chỉnh ngày/giờ và tần suất lặp: **Một lần**, **Hằng ngày**, **T2–T6**, hoặc **Chọn các thứ trong tuần**.
  - Sửa hoặc tắt lịch trực tiếp qua menu `⋯` trên từng thẻ đã lưu.
- **Thông báo góc trên-phải (Shadow DOM) + System Fallback + Âm thanh nhẹ:**
  - Hiển thị Toast mượt ở góc trên-phải màn hình với nút **Mở ngay** và **Nhắc +15p**, thanh đếm ngược tự tạm dừng khi di chuột vào.
  - Phát âm thanh chuông nhẹ *"tình tinh"* êm tai (tổng hợp qua Web Audio & Chrome Offscreen API, có nút bật/tắt và nghe thử trong bảng giao diện).
  - Gom lịch trùng giờ vào 1 thẻ có nút chuyển `1/N`, tự fallback sang **Chrome Notification** khi bạn đang ở `chrome://newtab` hoặc thu nhỏ trình duyệt.
  - Tổng hợp gọn các lịch bị lỡ khi tắt Chrome thành 1 thông báo duy nhất khi mở lại.
- **Thao tác nhanh & Cá nhân hóa:**
  - Hiển thị **Favicon thật** của từng trang web, nút **Lưu & Đóng tab** để nhẹ trình duyệt, phím tắt **`Alt + S`** lưu tức thì.
  - Hỗ trợ 3 chế độ (**Tự động / Sáng / Tối**) cùng **5 bộ theme chọn lọc** (`Indigo`, `Warm Paper`, `Sage Focus`, `Soft Rose`, `Mono Ink`) đồng bộ từ Popup đến Toast thông báo.

## Cách cài vào Chrome để dùng thử (dành cho bạn bè)

1. Trên trang GitHub, bấm **`<> Code` → `Download ZIP`** (hoặc chạy `git clone https://github.com/QuanHuynh123/MarkMoment.git`) rồi giải nén ra máy.
2. Mở Chrome và truy cập: `chrome://extensions`
3. Bật công tắc **Developer mode** (Chế độ dành cho nhà phát triển) ở góc trên-phải.
4. Nhấn **Load unpacked** (Tải tiện ích đã giải nén) và chọn đúng thư mục **`extension`** bên trong thư mục vừa giải nén.
5. Ghim biểu tượng **MarkMoment** lên thanh công cụ Chrome để sử dụng.

> **Lưu ý phím tắt `Alt+S`:** Nếu muốn đổi phím tắt, vào `chrome://extensions/shortcuts` và chỉnh cho **MarkMoment**.

## Cấu trúc dự án

- `extension/manifest.json` — Cấu hình Chrome Extension Manifest V3.
- `extension/shared/core.js` — Logic thuần (format thời gian, chuẩn hóa URL YouTube/Blog/PDF, tính lịch lặp, cuộn trang & bộ lọc).
- `extension/shared/storage.js` — Quản lý dữ liệu cục bộ qua `chrome.storage.local`.
- `extension/shared/sound.js` — Tổng hợp âm thanh chuông *"tình tinh"* bằng Web Audio API.
- `extension/offscreen/` — Offscreen Document phát âm thanh thông báo ổn định trên mọi tab.
- `extension/content/content.js` — Bắt/khôi phục mốc ngữ cảnh & hiển thị Shadow DOM Toast ở góc trên-phải.
- `extension/background/service-worker.js` — Điều phối `chrome.alarms`, phím tắt `Alt+S`, badge, mở lại tab và Chrome Notification fallback.
- `extension/popup/` — Giao diện Popup (`360px`), 5 theme preset, hẹn giờ nhanh, menu `⋯` từng dòng, tìm kiếm và Hoàn tác khi xóa.
- `tests/core.test.mjs` — Bộ unit test cho tầng logic cốt lõi.

## Chạy kiểm tra (Unit Tests)

```powershell
node --test tests/core.test.mjs
```
