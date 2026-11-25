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

Mở **Account & Character** từ hồ sơ góc trên bên phải hoặc **Settings** ở sidebar để nhập Account Name#Tag và POESESSID tùy chọn, tải/chọn nhân vật. Cấu hình lưu trong `config.local.json` (đã được gitignore). Để trống ô POESESSID rồi Save sẽ xóa cookie cũ và dùng public profile; Characters/Build không gửi header Cookie trong chế độ này. Save Account validates with the same get-characters API as Load Characters (encoded accountName, realm=pc), without testing Stash. GGG code 6/HTTP 403 logs include endpoint and query parameters, never Cookie headers. Private Stash still requires a cookie. Biến môi trường `POE_ACCOUNT_NAME` vẫn được ưu tiên cho tên tài khoản; cookie local đã lưu (kể cả giá trị trống) được ưu tiên hơn cookie môi trường để tránh khôi phục cookie vừa xóa. API Save bỏ qua trường `poeSessId` thì giữ nguyên cookie, gửi chuỗi trống thì xóa. Mọi request `character-window` dùng `User-Agent: PoeStash/1.0 (contact: local-dev@poestash.app)`, thêm `Cookie: POESESSID=...` chỉ khi có cookie. League của nhân vật được đồng bộ với lựa chọn League ở trang Market.

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

## Build — PoB & GGG Character Viewer

Chọn nhân vật trên header rồi mở **Build** để tải trang bị và passive từ GGG, tạo mã PoB và copy bằng **Copy PoB Code**. Badge **Live from GGG API** hiển thị nhân vật và league. Có thể dán mã PoB hoặc link `pobb.in/<id>`, `https://pobb.in/<id>` hay `https://pobb.in/<id>/raw` rồi bấm **Load Build** để chuyển sang **PoB / pobb.in Snapshot** với bảng chỉ số mở sẵn. Nút **Quay lại nhân vật của tôi** tải lại dữ liệu GGG. Sau khi cập nhật backend, chạy lại `npm run dev` để đăng ký các API mới.

Build và Market dùng chung theme economy trong [build.css](src/components/build.css). Trình xem chỉ giữ một build đang hoạt động; lịch sử localStorage chứa tối đa 5 bản ghi gồm tên hiển thị và mã nén gốc, tương thích với cache chuỗi cũ. React chỉ giữ tên lịch sử; chọn một mục sẽ đọc và giải nén đúng bản đó. Trang Build và trình xem SVG được chia thành các JavaScript chunk riêng. Dữ liệu bản đồ chỉ tải khi mở modal, request được hủy khi đóng và SVG được unmount, đồng thời gỡ listener bàn phím và trả lại trạng thái cuộn trang.

GGG cung cấp tổng mod cố định từ đồ, jewels và passive cùng kháng uncapped đã trừ 60%. Core Stats có nhãn **(Est.)**: Life/Mana tính theo level, attributes và mod flat/increased; ES theo properties, mod global và Intelligence; Armour/Evasion dùng properties đã tính mod cục bộ; block/suppression cộng từ khiên và passive. Hai weapon set được tính sẵn một lần khi parse, không chạy lại trong render. Các điều kiện, flask, buff, cluster/timeless biến đổi và giới hạn phòng thủ cần engine PoB. Đổi weapon set trong bản PoB chỉ đổi trang bị hiển thị, không tính lại snapshot. Cây GGG dùng bản export hiện tại; mã PoB có `treeVersion` dùng export GGG tương ứng.

GGG còn ước tính Physical Taken As và Recovery từ mod cố định; chuyển sát thương trên flask giả định flask đang có hiệu lực. Max Hit dùng Life + ES, armour, kháng cap theo mod maximum resistance (tối đa 90%) và chuyển sát thương; Chaos bỏ qua ES. EHP tham khảo là Max Hit thấp nhất trong 5 hệ, chưa mô phỏng avoidance, suppression, recovery, buff, keystone đặc biệt hay cấu hình kẻ địch. Các giá trị GGG này có nhãn **(Est.)**. PoB ưu tiên PlayerStat, hỗ trợ alias `Effective...`; block/suppression thiếu mặc định 0%, Physical Taken As thiếu được cộng từ đồ và passive đã tải; mục All saved PlayerStats giữ nguyên danh sách khóa gốc.

Recovery ưu tiên `NetLifeRegen` / `NetManaRegen`, dùng `Math.floor` cho hai giá trị `/s` từ PoB. ES Recharge khi thiếu số `/s` trực tiếp được tính chung cho cả hai nguồn: ES / 3 × (1 + tổng increased recharge / 100), gồm mod trên trang bị, jewel, flask và passive. Life Recoup thiếu số `/s` được tính từ tổng phần trăm mod × Life (fallback Physical Max Hit) / 4 giây; node recoup 3 giây đổi mẫu số thành 3. ES Recharge và Life Recoup dùng `Math.round`. Nếu thiếu cả hit và Life thì hiển thị phần trăm; không có mod recoup thì hiển thị 0/s. Đây là giá trị tham khảo theo một hit, không mô phỏng sát thương liên tục. Hai dòng này bỏ nhãn **(Est.)** trong snapshot PoB theo quy ước giao diện; tooltip Life Recoup vẫn giải thích giả định hit và thời gian. Không log PlayerStats ra console.

Link pobb.in tải đồng thời raw XML và HTML qua proxy backend. HTML được làm phẳng trước khi tìm nhãn và giá trị `/s`; dữ liệu JSON nhúng hợp lệ cũng được đọc mà không thực thi JavaScript. Nếu trang gốc lỗi hoặc thiếu trường, backend thử AllOrigins với URL pobb.in đã kiểm tra, chỉ bổ sung các trường còn thiếu và log cảnh báo theo từng nguồn. Mỗi nguồn HTML có timeout 12 giây, giới hạn 2 MB; không giữ HTML trong React.

Bốn giá trị Recovery tìm được lưu ở `activeBuild.recovery`, áp dụng sau mọi bước tính XML/passive và được component Recovery ưu tiên đọc riêng. Đổi weapon set, cập nhật icon hoặc tính lại passive không ghi đè các giá trị này. Input giữ link; mỗi lần Load đều fetch mới với `no-store`, không đọc snapshot localStorage thay cho API. Lịch sử link mới chỉ thêm URL nguồn cạnh mã nén và tên, thay bản cũ theo URL; chọn lại mục đó cũng fetch mới. Mã PoB thô và lịch sử cũ không có URL dùng fallback XML/passive. Nếu cả hai nguồn HTML vẫn thiếu trường, trang báo số trường đọc được và dùng fallback cho phần thiếu; HTTP 200 không bảo đảm HTML có Recovery. Giá trị PlayerStats gốc vẫn giữ riêng để kiểm tra.

Khi nhập PoB, API tra ID của các node đã chọn theo đúng phiên bản GGG, kể cả node chỉ có stats và không có tọa độ. Cluster Jewel được truyền cùng socket ID và mod để tái tạo các small passive/notable đã chọn theo bố cục PoB, rồi cộng vào cùng danh sách active nodes; node trùng hoặc chưa cộng không được tính lại. Bảng thứ tự notable chỉ tải ở backend khi có cluster, không giữ catalog trong React. Nếu còn ID không phân giải được (ví dụ cluster đặc biệt hoặc phiên bản cũ), trang hiển thị cảnh báo thay vì khẳng định tổng mod đã đầy đủ. URL cây phiên bản 7 được hỗ trợ.

Icon PoB tra tên Unique, Base Type và gem qua [PoE Wiki Cargo API](https://www.poewiki.net/wiki/Path_of_Exile_Wiki:Data_query_API), dùng proxy `/api/build/icons` để tránh CORS. Chỉ tra các tên thuộc build hiện tại theo batch nhỏ, không tải catalog hoặc cache ảnh trong JavaScript. Ảnh tải lazy, có fallback theo slot khi thiếu/lỗi. Request ảnh bị hủy khi đổi build/rời trang, không sửa mã nén hoặc `PlayerStat`.

Kiểm thử codec, cache, tổng chỉ số và proxy:

```bash
node --test src/lib/buildCodec.test.js src/lib/buildEstimates.test.js src/lib/buildIcons.test.js src/lib/poeTradeStats.test.js
npm run build
```
