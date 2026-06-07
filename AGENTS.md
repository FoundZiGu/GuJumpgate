# Reverse-Skill Proxy For GuJumpgate

This workspace includes an optional Vietnamese reverse-skill proxy bundle for CTF / reverse / exploit tasks.

## Startup contract

- When the task is CTF, reverse engineering, binary exploitation, web/API security, prompt injection, mobile analysis, cloud/container drift, or Windows/AD pivoting, read `.reverse-skill-proxy/ROUTER.vi.md` first.
- Start with the narrowest matching route instead of loading unrelated skill families.
- If challenge type is still unclear, start with `ctf-sandbox-orchestrator` and let it route you.
- If the bundle or route is missing, fall back to the default workflow without blocking the rest of the task.

## Local safety expectations

- Prefer passive inspection first.
- Do not disrupt already-running local services, browser sessions, or extension state unless explicitly asked.
- Keep updates short: outcome -> evidence -> verification -> next step.
