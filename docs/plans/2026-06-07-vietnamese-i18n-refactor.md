# Kế hoạch Việt hoá mã nguồn GuJumpgate

> **Cho Hermes/dev:** triển khai theo hướng i18n tối thiểu, tránh sửa tay toàn bộ text một lần rồi khó merge upstream.

**Mục tiêu:** chuyển UI và message runtime chính của GuJumpgate sang tiếng Việt, đồng thời tạo kiến trúc i18n đủ sạch để sau này giữ được đa ngôn ngữ `zh-CN / vi-VN / en-US`.

**Kiến trúc:** thêm một lớp i18n mỏng dùng key-value dictionary, ưu tiên áp dụng trước ở `sidepanel`, sau đó mới lan sang `background` và `content scripts`. Không đổi logic nghiệp vụ; chỉ tách text khỏi code và thêm hàm `t(key, params?)` để render chuỗi.

**Tech stack:** Chrome Extension Manifest V3, plain JavaScript, sidepanel HTML/CSS/JS, background service worker, content scripts.

---

## 1. Kết quả mong muốn

Sau khi hoàn tất pha đầu:

1. Mở sidepanel thấy tiếng Việt ở các khu vực chính:
   - header
   - nút hành động
   - menu cấu hình
   - nhãn form phổ biến
   - trạng thái cơ bản
2. Toast/log/status chính hiển thị tiếng Việt.
3. Code không còn hardcode text mới trong `sidepanel/sidepanel.html` và các vùng sidepanel chính của `sidepanel/sidepanel.js`.
4. Có hạ tầng i18n để tiếp tục migrate các file lớn như:
   - `background.js`
   - `background/steps/*.js`
   - `content/signup-page.js`
   - `content/plus-checkout.js`
   - `content/vps-panel.js`

---

## 2. Hiện trạng repo

### Các file đang chứa nhiều text cứng

- `sidepanel/sidepanel.html`
- `sidepanel/sidepanel.js`
- `background.js`
- `content/signup-page.js`
- `content/plus-checkout.js`
- `content/vps-panel.js`
- `background/phone-verification-flow.js`
- `background/steps/create-plus-checkout.js`
- `background/steps/fill-plus-checkout.js`
- nhiều manager file dưới `sidepanel/`

### Dấu hiệu hiện trạng

- UI hiện tại chủ yếu là tiếng Trung.
- Chuỗi hiển thị đang nằm lẫn trong:
  - HTML text nodes
  - `title`
  - `aria-label`
  - `placeholder`
  - `textContent = ...`
  - `innerHTML = ...`
  - `throw new Error(...)`
  - `message: '...'`
  - `addLog(...)`
- Repo chưa có thư mục/kiến trúc i18n chuẩn.

---

## 3. Nguyên tắc thiết kế lại

### 3.1. Không sửa tay một đợt toàn repo

Nếu sửa trực tiếp toàn bộ chuỗi tiếng Trung sang tiếng Việt trong các file lớn:
- diff sẽ cực lớn
- khó review
- khó merge upstream
- dễ sót text runtime

=> Thay vào đó, phải **tạo lớp i18n trước**, rồi migrate dần.

### 3.2. Chia làm 3 lớp text

#### Lớp A — UI tĩnh
Ví dụ:
- nút
- tiêu đề
- nhãn form
- placeholder
- menu item

#### Lớp B — UI động / trạng thái
Ví dụ:
- toast
- status badge
- auto-run status
- summary text
- confirmation text

#### Lớp C — runtime / nghiệp vụ
Ví dụ:
- log text
- error message
- callback status
- verification message
- warning/fallback message

### 3.3. Ưu tiên `sidepanel` trước

Lý do:
- người dùng nhìn thấy ngay
- rủi ro thấp hơn content/background
- ít ảnh hưởng logic automation hơn

### 3.4. Không phá backward compatibility

Bản refactor i18n không được làm thay đổi:
- key cấu hình cũ trong storage
- message protocol giữa background và content
- step IDs / flow IDs / runtime state shape

---

## 4. Kiến trúc i18n đề xuất

## 4.1. File mới

### Tạo: `shared/i18n.js`

Trách nhiệm:
- giữ locale hiện tại
- nạp dictionary
- export hàm `t(key, params?)`
- export helper áp text vào DOM

### Tạo: `locales/vi-VN.js`
### Tạo: `locales/zh-CN.js`

Trách nhiệm:
- mỗi file export object dictionary phẳng hoặc nested

Ví dụ dạng phẳng:

```js
window.GuJumpgateLocaleViVN = {
  'app.title': 'GuJumpgate',
  'header.guide': 'Hướng dẫn',
  'header.auto': 'Tự động',
  'header.stop': 'Dừng',
  'header.config': 'Cấu hình',
  'config.export': 'Xuất cấu hình',
  'config.import': 'Nhập cấu hình',
  'status.waiting_callback': 'Đang chờ callback',
  'status.oauth_url_not_generated': 'Chưa tạo liên kết đăng nhập',
};
```

### Sửa: `manifest.json`

Thêm các file locale/i18n vào trước các script cần dùng, ví dụ với sidepanel:
- `locales/zh-CN.js`
- `locales/vi-VN.js`
- `shared/i18n.js`
- rồi mới tới `sidepanel/*.js`

Nếu background/content cũng cần dùng chung, cần bảo đảm các script này được load trước chúng.

---

## 4.2. API i18n tối thiểu

Trong `shared/i18n.js` triển khai các API sau:

```js
(function attachI18n(root) {
  const dictionaries = {
    'zh-CN': root.GuJumpgateLocaleZhCN || {},
    'vi-VN': root.GuJumpgateLocaleViVN || {},
  };

  const DEFAULT_LOCALE = 'vi-VN';
  let currentLocale = DEFAULT_LOCALE;

  function interpolate(template, params = {}) {
    return String(template).replace(/\{(\w+)\}/g, (_, key) => {
      return Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : `{${key}}`;
    });
  }

  function t(key, params = {}, fallback = '') {
    const dict = dictionaries[currentLocale] || {};
    const fallbackDict = dictionaries['zh-CN'] || {};
    const raw = dict[key] ?? fallbackDict[key] ?? fallback || key;
    return interpolate(raw, params);
  }

  function setLocale(locale) {
    if (dictionaries[locale]) currentLocale = locale;
  }

  function getLocale() {
    return currentLocale;
  }

  function applyI18n(rootEl = document) {
    rootEl.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    rootEl.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.title = t(el.dataset.i18nTitle);
    });
    rootEl.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    rootEl.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
    });
  }

  root.GuJumpgateI18n = { t, setLocale, getLocale, applyI18n };
})(typeof self !== 'undefined' ? self : globalThis);
```

---

## 4.3. Cách chọn locale

Pha đầu dùng mặc định:
- `vi-VN`

Pha sau có thể thêm setting storage, ví dụ:
- `uiLocale: 'vi-VN' | 'zh-CN' | 'en-US'`

Không nên làm ngay ở bước đầu nếu chưa cần, để tránh scope creep.

---

## 5. Chiến lược migrate theo pha

## Pha 1 — Việt hoá sidepanel nhìn thấy ngay

### Mục tiêu
Khi mở extension, người dùng nhìn thấy tiếng Việt ở phần lớn vùng giao diện chính.

### File cần sửa
- Tạo: `shared/i18n.js`
- Tạo: `locales/vi-VN.js`
- Tạo: `locales/zh-CN.js`
- Sửa: `manifest.json`
- Sửa: `sidepanel/sidepanel.html`
- Sửa: `sidepanel/sidepanel.js`
- Có thể sửa thêm các manager sidepanel nếu cần:
  - `sidepanel/hotmail-manager.js`
  - `sidepanel/mail-2925-manager.js`
  - `sidepanel/icloud-manager.js`
  - `sidepanel/luckmail-manager.js`
  - `sidepanel/custom-email-pool-manager.js`
  - `sidepanel/hosted-sms-pool-manager.js`
  - `sidepanel/paypal-manager.js`

### Việc cụ thể

#### Bước 1
Tạo `locales/vi-VN.js` với các key dùng cho:
- header
- nút chính
- menu config
- section label phổ biến
- các chuỗi sidepanel rất hay gặp

#### Bước 2
Tạo `locales/zh-CN.js` làm bản đối chiếu/fallback.

#### Bước 3
Tạo `shared/i18n.js` và expose `window.GuJumpgateI18n`.

#### Bước 4
Sửa `sidepanel/sidepanel.html`:
- thay text cứng bằng `data-i18n`
- thay `title` bằng `data-i18n-title`
- thay `placeholder` bằng `data-i18n-placeholder`
- thay `aria-label` bằng `data-i18n-aria-label`

Ví dụ:

```html
<button id="btn-config-menu"
  class="btn btn-ghost btn-sm header-config-btn"
  type="button"
  aria-haspopup="menu"
  aria-expanded="false"
  data-i18n="header.config">
</button>
```

#### Bước 5
Trong `sidepanel/sidepanel.js`, khi init panel:

```js
const { t, applyI18n } = window.GuJumpgateI18n;
applyI18n(document);
```

#### Bước 6
Thay các chuỗi runtime UI ở `sidepanel/sidepanel.js` bằng `t(...)`.

Ví dụ:

```js
btnAutoRun.innerHTML = `<svg ...></svg> ${t('header.auto')}`;
```

hoặc với text-only:

```js
contributionModeSummary.textContent = t('contribution.waiting_to_start');
```

#### Bước 7
Các chuỗi có biến dùng param interpolation:

```js
t('auto.status.running_with_count', { count: runCount })
```

Dictionary:

```js
'auto.status.running_with_count': 'Đang chạy ({count})'
```

---

## Pha 2 — Việt hoá manager sidepanel và message UI phụ

### Mục tiêu
Dọn sạch các chuỗi tiếng Trung còn hiện ra trong panel phụ.

### File ưu tiên
- `sidepanel/hotmail-manager.js`
- `sidepanel/mail-2925-manager.js`
- `sidepanel/icloud-manager.js`
- `sidepanel/luckmail-manager.js`
- `sidepanel/account-records-manager.js`
- `sidepanel/hosted-sms-pool-manager.js`
- `sidepanel/custom-email-pool-manager.js`
- `sidepanel/contribution-mode.js`

### Việc cụ thể
- thay empty state text
- thay filter/no-match text
- thay action button labels
- thay overlay titles/stats labels

### Lưu ý
Các đoạn `innerHTML` cần:
- giữ `escapeHtml` nếu đang dùng
- chỉ dùng `t(...)` cho phần text, không nhét HTML động nguy hiểm vào dictionary

---

## Pha 3 — Việt hoá background và content script message

### Mục tiêu
- lỗi/log/toast/message chính sang tiếng Việt
- vẫn giữ nguyên protocol và logic automation

### File ưu tiên
- `background.js`
- `background/message-router.js`
- `background/verification-flow.js`
- `background/phone-verification-flow.js`
- `background/steps/create-plus-checkout.js`
- `background/steps/fill-plus-checkout.js`
- `background/steps/fetch-login-code.js`
- `content/signup-page.js`
- `content/plus-checkout.js`
- `content/vps-panel.js`
- `content/phone-auth.js`
- `content/paypal-flow.js`

### Chiến lược
Không migrate mọi text một lượt. Chia theo nhóm:

1. error message user-facing
2. status message
3. log/debug message
4. fallback text/diagnostic text

### Quy tắc
- text người dùng thấy được → đưa vào i18n
- text debug nội bộ ít thấy → có thể giữ lại sau cùng
- message protocol key/enum → **không dịch**

Ví dụ:
- `STEP_COMPLETE` giữ nguyên
- `error: 'email_invalid'` nếu là machine code thì giữ nguyên
- nhưng phần mô tả hiển thị cho người dùng thì dịch qua `t(...)`

---

## 6. Quy ước key i18n

Dùng namespace rõ ràng, ví dụ:

- `app.*`
- `header.*`
- `config.*`
- `common.*`
- `form.*`
- `auto.*`
- `status.*`
- `error.*`
- `contribution.*`
- `paypal.*`
- `mail.*`
- `phone.*`
- `records.*`

Ví dụ:

```js
'common.save': 'Lưu'
'common.cancel': 'Huỷ'
'header.auto': 'Tự động'
'header.stop': 'Dừng'
'status.waiting_callback': 'Đang chờ callback'
'error.invalid_api_url': 'URL API không hợp lệ'
```

Không dùng key kiểu mơ hồ như:
- `text1`
- `msg2`
- `buttonA`

---

## 7. Những gì không được dịch

Không đổi các giá trị nghiệp vụ/enum/protocol như:
- `pending`
- `running`
- `completed`
- `failed`
- `stopped`
- `manual_completed`
- `skipped`
- message types giữa background/content
- storage keys hiện có
- flow IDs
- node IDs
- provider IDs

Chỉ map chúng sang label hiển thị nếu cần.

Ví dụ:

```js
const STATUS_LABELS = {
  pending: t('status.pending'),
  running: t('status.running'),
  completed: t('status.completed'),
};
```

---

## 8. Checklist review cho mỗi PR i18n

### Functional
- [ ] UI vẫn mở bình thường
- [ ] Không lỗi `GuJumpgateI18n is undefined`
- [ ] Không gãy thứ tự script load
- [ ] Không làm hỏng click handler / DOM selector

### UX
- [ ] Không còn text tiếng Trung ở vùng đã migrate
- [ ] `title`, `placeholder`, `aria-label` đã được Việt hoá
- [ ] Text có dấu tiếng Việt hiển thị đúng

### Safety
- [ ] Không đưa HTML động không escape vào dictionary
- [ ] Không đổi machine-readable error code
- [ ] Không đổi protocol message type

### Maintainability
- [ ] Text mới không hardcode trực tiếp trong file đã migrate
- [ ] Key i18n có namespace rõ ràng
- [ ] Không copy-paste dictionary trùng lặp

---

## 9. Thứ tự triển khai khuyến nghị

### PR 1
- thêm `locales/vi-VN.js`
- thêm `locales/zh-CN.js`
- thêm `shared/i18n.js`
- wiring vào `manifest.json`

### PR 2
- migrate `sidepanel/sidepanel.html`
- migrate phần header + config + action bar của `sidepanel/sidepanel.js`

### PR 3
- migrate form labels/chuỗi sidepanel chính
- migrate toast/status chính

### PR 4
- migrate `sidepanel/*manager.js`

### PR 5+
- migrate background/content theo domain:
  - auth/phone
  - plus-checkout
  - CPA/SUB2API
  - mail providers

---

## 10. Gợi ý kiểm thử thủ công

### Kiểm thử cơ bản
1. Load extension ở `chrome://extensions`
2. Mở sidepanel
3. Kiểm tra:
   - header
   - nút Auto/Stop/Reset/Config
   - menu export/import
   - section labels
   - placeholder inputs
4. Trigger vài toast/status để xem text tiếng Việt hiển thị đúng.

### Kiểm thử không hồi quy
1. Save config
2. Export/import config
3. Open account records overlay
4. Toggle Plus mode
5. Toggle contribution mode
6. Kiểm tra các manager list empty state/no-match state

### Kiểm thử kỹ thuật
Nếu có Node trong máy:

```bash
node --check sidepanel/sidepanel.js
node --check shared/i18n.js
node --check locales/vi-VN.js
node --check locales/zh-CN.js
```

Nếu sửa nhiều file JS:

```bash
git ls-files '*.js' | xargs -n 1 node --check
```

---

## 11. Phạm vi bản đầu tiên nên chốt

### Nên làm ngay
- sidepanel chính
- text nhìn thấy ngay
- toast/status cơ bản
- kiến trúc i18n nền

### Chưa cần làm ngay
- toàn bộ log diagnostic sâu
- toàn bộ content script hiếm gặp
- setting chọn locale nhiều ngôn ngữ
- tự động extract text từ source

---

## 12. Định nghĩa thành công

Bản refactor được coi là thành công khi:

1. sidepanel mở lên chủ yếu là tiếng Việt;
2. code mới không hardcode text trực tiếp ở vùng đã migrate;
3. không làm hỏng flow hiện tại;
4. có thể tiếp tục migrate background/content theo từng PR nhỏ.

---

## 13. Handoff cho bước thực thi

Nếu bắt đầu triển khai, nên đi theo đúng thứ tự sau:

1. dựng `shared/i18n.js`
2. dựng `locales/vi-VN.js` và `locales/zh-CN.js`
3. nối script load trong `manifest.json`
4. migrate `sidepanel/sidepanel.html`
5. migrate `sidepanel/sidepanel.js` phần header/action/config
6. test thủ công sidepanel
7. tiếp tục các manager và runtime text còn lại

---

## 14. Quyết định thiết kế chốt

**Quyết định:** chọn hướng **i18n mỏng + migrate dần**, không chọn hướng “find/replace toàn repo sang tiếng Việt”.

**Lý do:**
- ít rủi ro hơn
- review dễ hơn
- giữ khả năng merge upstream
- mở đường cho đa ngôn ngữ thật sự
- phù hợp với repo đang có nhiều file lớn và nhiều luồng automation
