# Reverse-Skill Proxy Integration (Tiếng Việt)

Tài liệu này thêm một lớp **proxy tối thiểu** để repo này có thể mang theo bundle `reverse-skill` tiếng Việt / CTF mà không làm thay đổi luồng chạy chính của extension.

## Mục tiêu

- Không đụng vào luồng extension hiện có nếu không cần.
- Chỉ thêm một bundle phụ trợ để Codex / agent có thể đọc khi làm CTF, reverse, web security hoặc các bài nhiều bước.
- Khi thiếu skill local, hệ thống vẫn **fallback an toàn** về workflow mặc định, không chặn tác vụ chính.

## Thành phần

- `reverse_skill_proxy.py`
  - đồng bộ local skill bundle từ:
    - `~/.hermes-shop/skills/reverse-skill`
    - `~/.hermes-shop/skills/ctf-sandbox-orchestrator`
  - sinh ra:
    - `ROUTER.vi.md`
    - `MANIFEST.json`
    - `AGENTS.md` tùy chọn cho workspace hiện tại

- `AGENTS.md`
  - contract nhẹ để Codex / agent biết khi nào nên đọc router tiếng Việt trước

## Cách dùng

### 1) Tạo bundle cục bộ trong repo hiện tại

```bash
python reverse_skill_proxy.py --bundle-dir .reverse-skill-proxy --workspace-root .
```

Sau khi chạy xong sẽ có:

- `.reverse-skill-proxy/ROUTER.vi.md`
- `.reverse-skill-proxy/MANIFEST.json`
- `./AGENTS.md`

### 2) Dùng cùng agent/Codex

Khi mở workspace có `AGENTS.md`, agent có thể đọc router tiếng Việt trước khi xử lý các bài như:

- CTF tổng quát
- reverse / pwn
- web / API security
- prompt injection / LLM security
- mobile reverse
- Windows / AD pivot
- cloud / container drift

### 3) Fallback-friendly

Nếu máy không có local skills ở `~/.hermes-shop/skills/...`:

- script vẫn tạo router + manifest
- `MANIFEST.json` sẽ ghi các nguồn bị thiếu
- workflow còn lại vẫn dùng được

## Khi nào nên route sang skill nào

- Chưa rõ đề bài: `ctf-sandbox-orchestrator`
- Web/API: `competition-web-runtime`
- Reverse/Pwn: `competition-reverse-pwn`
- Agent/LLM/Cloud: `competition-agent-cloud`
- Windows/AD: `competition-identity-windows`
- Reverse tổng quát/mobile: `reverse-engineering`
- API auth/boundary: `api-security`
- Nhiều bước / pivot chain: `attack-chain`
- LLM security / RAG poisoning: `llm-security`

## Gợi ý vận hành

- Luôn bắt đầu bằng **kiểm tra thụ động tối thiểu**.
- Chỉ route sang family hẹp nhất phù hợp.
- Ghi nhận ngắn gọn theo format:
  - kết quả
  - bằng chứng
  - xác minh
  - bước kế tiếp
