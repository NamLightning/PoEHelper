# PoeStash

Dashboard mẫu (React, Vite, Tailwind CSS) với giao diện tối nâu-đen: tài sản, biểu đồ phiên, mục tiêu Mageblood và các chiến lược kiếm currency. Tài sản và stash dùng dữ liệu mock; Market lấy economy data PoE 1 từ poe.ninja. Tài khoản Path of Exile có thể được liên kết cục bộ để xem và chọn nhân vật.

## Chạy trên máy

Cần [Node.js](https://nodejs.org/) 18 trở lên (kèm npm).

Mở terminal tại thư mục dự án, rồi chạy:

```bash
npm install
npm run dev
```

Lệnh này chạy frontend Vite tại http://localhost:5173 và backend proxy tại http://127.0.0.1:3001. Frontend gọi backend qua proxy `/api`.

Trang Market lấy dữ liệu PoE 1 từ poe.ninja. League Challenge hiện tại được tự chọn; dropdown liệt kê các league PoE 1 đang hoạt động. Thanh danh mục có đủ 48 loại vật phẩm trong các nhóm General, Equipment & gems, Atlas và Crafting; dữ liệu mỗi loại chỉ được tải khi chọn. Chọn Refresh để xóa cache league đang xem và lấy giá mới. API cache dữ liệu trong RAM tối đa 5 phút. Giá là ước tính của economy overview, không phải listing trực tiếp.

Mỗi dòng Market có nút pill **Trade ⇄** mở trang trade chính thức theo league hiện tại. Bulk Exchange để `have: []` và đặt vật phẩm vào `want`; vật phẩm search dùng đúng tên hiển thị, cùng base type và socket links nếu có.

Di chuột hoặc focus tên item trong bảng Market để xem tooltip từ PoE Wiki. Backend ưu tiên tên gốc, rồi tên đã bỏ tiền tố biến thể, base type và kết quả tìm kiếm Wiki; tooltip hiển thị trang Wiki khớp cùng các modifier Foulborn liên quan nếu có. Dữ liệu Cargo được cache trong RAM 24 giờ (kết quả không tìm thấy cache 5 phút), còn poe.ninja là phương án dự phòng.

Mở **Account & Character** từ hồ sơ góc trên bên phải hoặc **Settings** ở sidebar để nhập Account Name#Tag và POESESSID, tải/chọn nhân vật. Cấu hình lưu trong `config.local.json` (đã được gitignore); biến môi trường `POE_ACCOUNT_NAME` và `POESESSID` cũng được hỗ trợ và được ưu tiên hơn file local. Cookie chỉ được dùng bởi backend proxy local gọi API chính thức của Path of Exile; không chia sẻ cookie này. League của nhân vật được đồng bộ với lựa chọn League ở trang Market.

Dừng cả hai server: `Ctrl + C` trong terminal đang chạy `npm run dev`.

## Bản build tĩnh

```bash
npm run build
npm run preview
```

`npm run build` ghi thư mục `dist`. `npm run preview` phục vụ đúng bản đó để xem lại trên local.

## Thử tương tác

- Menu trái chuyển Home, Stash, Market, Make Currency, Tools, Craft, Build.
- PoE 1 / Covens PC đổi đơn vị giá mock trên dashboard.
- Ô tìm kiếm lọc danh sách của trang hiện tại. Gõ vài ký tự để mở kết quả nhanh, bấm một dòng để nhảy tới tab tương ứng. Phím tắt: `Ctrl + K` (hoặc `/` khi không đang gõ trong ô).
- Currency methods có chip All / Mapping / Bossing / Crafting.
- **Sync now** làm mới chuỗi tài sản mock và đưa mốc thời gian về “just now”.
- **Open stash** mở tab Stash. Goal / Details đổi nội dung thẻ mục tiêu.
- Nút mặt trời đổi tông nâu ấm hơn. Feedback chỉ lưu ghi chú trong phiên trình duyệt.

## Thành phần

- `src/components/Sidebar.jsx`
- `src/components/Topbar.jsx`
- `src/components/WealthChartCard.jsx` — biểu đồ đường bằng Recharts
- `src/components/GoalCard.jsx`
- `src/components/MethodGrid.jsx`
- Icon: `lucide-react`
