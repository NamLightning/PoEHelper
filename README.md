# PoeStash

Dashboard mẫu (React, Vite, Tailwind CSS) mô phỏng giao diện tối nâu-đen: tài sản, biểu đồ phiên, mục tiêu Mageblood và các chiến lược kiếm currency. Dữ liệu là mock trên trình duyệt, không kết nối game hay API giao dịch.

## Chạy trên máy

Cần [Node.js](https://nodejs.org/) 18 trở lên (kèm npm).

Mở terminal tại thư mục dự án, rồi chạy lần lượt:

```bash
cd d:\poehelper
npm install
npm run dev
```

Vite in địa chỉ local, thường là http://localhost:5173. Mở đường dẫn đó trong trình duyệt.

Dừng server: `Ctrl + C` trong terminal đang chạy `npm run dev`.

## Bản build tĩnh

```bash
npm run build
npm run preview
```

`npm run build` ghi thư mục `dist`. `npm run preview` phục vụ đúng bản đó để xem lại trên local.

## Thử tương tác

- Menu trái chuyển Home, Stash, Market, Make Currency, Tools, Craft, Build.
- PoE 1 / PoE 2 / Covens PC đổi đơn vị giá. Dòng chữ dưới lời chào và các con số đổi theo.
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
