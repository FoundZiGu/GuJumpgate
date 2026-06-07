# Reverse-Skill Contributor Quickstart

给第一次接手这个仓库的 contributor：如果你需要在当前 workspace 里临时启用越南语 reverse-skill 路由，按下面做就能直接开始。

## 目的

- 给 agent / Codex 一个本地可读的越南语 router
- 优先把 CTF / reverse / web security 任务路由到更窄的 skill family
- 保持集成为 **local-only**，不改扩展运行逻辑

## 前置条件

本机最好已有以下 skill 源：

- `~/.hermes-shop/skills/reverse-skill`
- `~/.hermes-shop/skills/ctf-sandbox-orchestrator`

即使缺少其中一个，脚本也不会报死，只会把缺失项记入 manifest。

## 一条命令

```bash
python reverse_skill_proxy.py --bundle-dir .reverse-skill-proxy --workspace-root .
```

## 生成结果

运行后会看到：

- `.reverse-skill-proxy/ROUTER.vi.md`
- `.reverse-skill-proxy/MANIFEST.json`
- `AGENTS.md`

## 你该怎么用

1. 打开 `AGENTS.md`
2. 遇到 CTF / reverse / pwn / web API 安全 / LLM security / Windows AD 等任务时，先读 `.reverse-skill-proxy/ROUTER.vi.md`
3. 按 router 选最窄的 skill family
4. 如果 challenge 类型还不清楚，就先走 `ctf-sandbox-orchestrator`

## 常见 fallback

### `MANIFEST.json` 里出现 missing_source_roots

说明当前机器没有完整 local skill 源。这不是致命错误。

可以继续：

- 保留 router 作为最小引导
- 或回退到默认 agent workflow

### 不想把生成物提交到 Git

已经默认忽略：

- `/.reverse-skill-proxy/`

所以正常只提交：

- `reverse_skill_proxy.py`
- `AGENTS.md`
- 文档更新

## 建议

- 先做被动检查，再决定 route
- 只加载最相关的 skill family，不要一股脑全读
- 记录结论时尽量短：结果 -> 证据 -> 验证 -> 下一步
