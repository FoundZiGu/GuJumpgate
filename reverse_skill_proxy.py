from __future__ import annotations

import argparse
import json
import os
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

DEFAULT_SOURCE_ROOTS = (
    Path.home() / ".hermes-shop" / "skills" / "reverse-skill",
    Path.home() / ".hermes-shop" / "skills" / "ctf-sandbox-orchestrator",
)
DEFAULT_BUNDLE_DIRNAME = ".reverse-skill-proxy"
ROUTER_FILENAME = "ROUTER.vi.md"
MANIFEST_FILENAME = "MANIFEST.json"
WORKSPACE_AGENTS_FILENAME = "AGENTS.md"

ROUTES = [
    {
        "name": "ctf-sandbox-orchestrator",
        "match": ["ctf", "challenge", "unknown target", "first look"],
        "description_vi": "Dùng khi loại bài chưa rõ hoặc cần bộ điều phối ban đầu cho môi trường CTF.",
    },
    {
        "name": "competition-web-runtime",
        "match": ["web", "http", "api", "graphql", "ssrf", "xss", "request smuggling"],
        "description_vi": "Ưu tiên cho web/API, route, middleware, auth flow, SSRF/XSS và các biến thể runtime web.",
    },
    {
        "name": "competition-reverse-pwn",
        "match": ["reverse", "pwn", "elf", "pe", "crackme", "rop", "gdb"],
        "description_vi": "Ưu tiên khi phân tích nhị phân, khai thác bộ nhớ, reverse và pwn.",
    },
    {
        "name": "competition-agent-cloud",
        "match": ["agent", "llm", "prompt injection", "mcp", "cloud", "container"],
        "description_vi": "Dùng cho agent/LLM security, tool abuse, cloud/container drift và prompt injection.",
    },
    {
        "name": "competition-identity-windows",
        "match": ["windows", "ad", "kerberos", "ntlm", "pivot", "domain"],
        "description_vi": "Ưu tiên cho Windows/AD, identity abuse, credential pivot và relay/coercion chain.",
    },
    {
        "name": "reverse-engineering",
        "match": ["decompile", "ida", "ghidra", "frida", "apk", "ios"],
        "description_vi": "Dùng cho reverse engineering tổng quát, mobile reverse và hiểu luồng xác minh/chữ ký.",
    },
    {
        "name": "api-security",
        "match": ["swagger", "openapi", "jwt", "oauth", "auth bypass"],
        "description_vi": "Dùng cho API security, auth bypass, trust boundary và xác minh nguồn dữ liệu.",
    },
    {
        "name": "attack-chain",
        "match": ["multi-step", "chain", "pivot", "lateral", "post-exploitation"],
        "description_vi": "Dùng khi cần ghép chuỗi khai thác nhiều bước và theo dõi bằng chứng theo từng fact.",
    },
    {
        "name": "llm-security",
        "match": ["model", "rag", "retrieval poisoning", "jailbreak", "tool misuse"],
        "description_vi": "Dùng cho các bài LLM security, RAG poisoning, jailbreak và lạm dụng tool.",
    },
]


@dataclass
class SyncSummary:
    bundle_dir: str
    source_roots: list[str]
    copied_skill_directories: int
    missing_source_roots: list[str]
    router_path: str
    workspace_agents_path: str | None


def _iter_skill_dirs(source_root: Path) -> Iterable[Path]:
    if not source_root.exists():
        return []
    return sorted(
        path for path in source_root.iterdir() if path.is_dir() and (path / "SKILL.md").exists()
    )


def build_router_markdown(routes: list[dict], source_roots: list[Path]) -> str:
    lines = [
        "# Reverse-Skill Router (VI)",
        "",
        "Router này là lớp proxy tối thiểu để agent/Codex đọc trước khi xử lý CTF, reverse hoặc bài security nhiều bước trong workspace hiện tại.",
        "Nếu bundle skill local có sẵn, hãy ưu tiên route hẹp nhất. Nếu chưa rõ loại bài, bắt đầu từ `ctf-sandbox-orchestrator`.",
        "",
        "## Nguồn local dự kiến",
        "",
    ]
    lines.extend(f"- `{root}`" for root in source_roots)
    lines.extend(
        [
            "",
            "## Quy tắc route",
            "",
            "1. Kiểm tra yêu cầu và artefact ban đầu bằng phương pháp thụ động trước.",
            "2. Chỉ route sang family hẹp nhất phù hợp với challenge hiện tại.",
            "3. Nếu thiếu bundle local hoặc skill cụ thể, fallback về workflow mặc định mà không chặn phần còn lại của task.",
            "4. Cập nhật theo dạng: kết quả -> bằng chứng -> xác minh -> bước kế tiếp.",
            "",
            "## Route map",
            "",
        ]
    )
    for route in routes:
        match_words = ", ".join(f"`{word}`" for word in route["match"])
        lines.extend(
            [
                f"### {route['name']}",
                f"- Khi gặp: {match_words}",
                f"- Gợi ý: {route['description_vi']}",
                "",
            ]
        )
    return "\n".join(lines).rstrip() + "\n"


def build_workspace_agents(router_hint: str = ".reverse-skill-proxy/ROUTER.vi.md") -> str:
    return f"""# Reverse-Skill Proxy For GuJumpgate

This workspace includes an optional Vietnamese reverse-skill proxy bundle for CTF / reverse / exploit tasks.

## Startup contract

- When the task is CTF, reverse engineering, binary exploitation, web/API security, prompt injection, mobile analysis, cloud/container drift, or Windows/AD pivoting, read `{router_hint}` first.
- Start with the narrowest matching route instead of loading unrelated skill families.
- If challenge type is still unclear, start with `ctf-sandbox-orchestrator` and let it route you.
- If the bundle or route is missing, fall back to the default workflow without blocking the rest of the task.

## Local safety expectations

- Prefer passive inspection first.
- Do not disrupt already-running local services, browser sessions, or extension state unless explicitly asked.
- Keep updates short: outcome -> evidence -> verification -> next step.
"""


def sync_reverse_skills(
    bundle_dir: Path,
    source_roots: Iterable[Path] = DEFAULT_SOURCE_ROOTS,
    emit_workspace_agents: Path | None = None,
) -> SyncSummary:
    bundle_dir = bundle_dir.expanduser().resolve()
    roots = [Path(root).expanduser().resolve() for root in source_roots]
    bundle_dir.mkdir(parents=True, exist_ok=True)

    copied = 0
    missing_roots: list[str] = []
    for root in roots:
        if not root.exists():
            missing_roots.append(str(root))
            continue
        dest_root = bundle_dir / root.name
        dest_root.mkdir(parents=True, exist_ok=True)
        for skill_dir in _iter_skill_dirs(root):
            target_dir = dest_root / skill_dir.name
            if target_dir.exists():
                shutil.rmtree(target_dir)
            shutil.copytree(skill_dir, target_dir)
            copied += 1

    router_path = bundle_dir / ROUTER_FILENAME
    router_path.write_text(build_router_markdown(ROUTES, roots), encoding="utf-8")

    agents_path: str | None = None
    if emit_workspace_agents is not None:
        emit_workspace_agents = emit_workspace_agents.expanduser().resolve()
        emit_workspace_agents.mkdir(parents=True, exist_ok=True)
        workspace_agents_path = emit_workspace_agents / WORKSPACE_AGENTS_FILENAME
        workspace_agents_path.write_text(build_workspace_agents(), encoding="utf-8")
        agents_path = str(workspace_agents_path)

    summary = SyncSummary(
        bundle_dir=str(bundle_dir),
        source_roots=[str(root) for root in roots],
        copied_skill_directories=copied,
        missing_source_roots=missing_roots,
        router_path=str(router_path),
        workspace_agents_path=agents_path,
    )
    manifest_path = bundle_dir / MANIFEST_FILENAME
    manifest_path.write_text(json.dumps(asdict(summary), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync local reverse-skill bundles and generate a Vietnamese router proxy."
    )
    parser.add_argument(
        "--bundle-dir",
        default=os.path.join(os.getcwd(), DEFAULT_BUNDLE_DIRNAME),
        help="Directory where the proxy bundle should be written.",
    )
    parser.add_argument(
        "--workspace-root",
        default=None,
        help="Optional workspace root where an AGENTS.md proxy file should be emitted.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    summary = sync_reverse_skills(
        bundle_dir=Path(args.bundle_dir),
        emit_workspace_agents=Path(args.workspace_root) if args.workspace_root else None,
    )
    print(json.dumps(asdict(summary), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
