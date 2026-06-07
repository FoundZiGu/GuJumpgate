# Hướng dẫn nhanh cho contributor: Reverse-Skill tiếng Việt

Dành cho contributor mới vào repo này: nếu bạn muốn bật nhanh lớp route `reverse-skill` tiếng Việt trong workspace hiện tại, chỉ cần làm theo các bước dưới đây.

## Mục tiêu

- Cung cấp cho agent / Codex một router tiếng Việt có thể đọc ngay tại local
- Ưu tiên route các tác vụ CTF / reverse / web security vào đúng skill family hẹp nhất
- Giữ tích hợp ở dạng **local-only**, không sửa luồng chạy chính của extension

## Điều kiện đầu vào

Tốt nhất máy của bạn đã có sẵn các nguồn skill local sau:

- `~/.hermes-shop/skills/reverse-skill`
- `~/.hermes-shop/skills/ctf-sandbox-orchestrator`

Nếu thiếu một hoặc cả hai thư mục trên, script vẫn chạy bình thường; nó chỉ ghi các nguồn còn thiếu vào `MANIFEST.json`.

## Một lệnh để bật

```bash
python reverse_skill_proxy.py --bundle-dir .reverse-skill-proxy --workspace-root .
```

## Kết quả sẽ được tạo ra

Sau khi chạy xong, bạn sẽ thấy:

- `.reverse-skill-proxy/ROUTER.vi.md`
- `.reverse-skill-proxy/MANIFEST.json`
- `AGENTS.md`

## Cách sử dụng

1. Mở `AGENTS.md`
2. Khi gặp tác vụ như CTF / reverse / pwn / web API security / LLM security / Windows AD, đọc `.reverse-skill-proxy/ROUTER.vi.md` trước
3. Chọn skill family hẹp nhất theo router
4. Nếu chưa rõ challenge thuộc loại nào, bắt đầu bằng `ctf-sandbox-orchestrator`

## Các trường hợp fallback thường gặp

### `MANIFEST.json` có `missing_source_roots`

Điều này có nghĩa là máy hiện tại chưa có đầy đủ local skill sources. Đây **không phải lỗi nghiêm trọng**.

Bạn vẫn có thể tiếp tục theo một trong hai cách:

- dùng router như lớp dẫn đường tối thiểu
- hoặc fallback về workflow mặc định của agent

### Không muốn commit file sinh ra vào Git

Repo đã ignore sẵn:

- `/.reverse-skill-proxy/`

Vì vậy bình thường bạn chỉ cần commit:

- `reverse_skill_proxy.py`
- `AGENTS.md`
- các file tài liệu được cập nhật

## Khuyến nghị sử dụng

- Luôn bắt đầu bằng kiểm tra thụ động tối thiểu trước khi route
- Chỉ nạp skill family liên quan nhất, đừng đọc dồn toàn bộ
- Khi ghi nhận kết quả, ưu tiên format ngắn:
  - kết quả
  - bằng chứng
  - xác minh
  - bước tiếp theo
