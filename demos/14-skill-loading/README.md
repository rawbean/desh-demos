# Demo 14 — Skill loading

This standalone service proves the complete local-skill path in DeepSeek
Harness. It uses the real `@deepseek-ai/dsh-skill` registry,
`@deepseek-ai/dsh-skill-filesystem` provider, and
`@deepseek-ai/dsh-tool-skill` model tool instead of emulating skill loading in
application code.

## What is proved

The bundled `workspace/skills/deterministic-verdict/SKILL.md` has valid YAML
frontmatter and a body-only deterministic instruction. A runtime patch limits
the filesystem provider to `workspace/skills`, making discovery isolated and
repeatable even though this demo lives below a larger Git repository.

The deterministic Mock LLM is an OpenAI-compatible streaming endpoint used
only for verification:

1. Its first request must contain both the real `skill` tool schema and the
   catalog entry discovered from the local directory.
2. It emits an actual `skill` tool call for `deterministic-verdict`.
3. The real tool loads `SKILL.md`; the second request must contain the canonical
   `<skill_content>` result, the full instruction body, and its private verdict.
4. Only then does the Mock LLM return the exact verdict from the loaded body.
5. The HTTP response exposes the SDK's `tool/call` and `tool/result` events as
   independent evidence that the tool round trip happened.

The catalog description deliberately does not contain
`SKILL_LOADED_VERDICT_314159`, so the final answer cannot be obtained from
directory discovery alone.

## Core code

`RuntimeManager` materializes the filesystem-provider patch and passes it to a
fresh Harness. Its responsibility is to ensure skill discovery occurs inside
the real Runtime rather than in the HTTP application:

```ts
const patchPath = await materializePatch(this.dshHome, this.skillRoot);
const harness = this.factory({ ...this.baseOptions, patches: [patchPath] });
await harness.start();
this.harness = harness;
this.patchPath = patchPath;
```

## Layout

- `src/` — Fastify service, SDK runtime lifecycle, and deterministic Mock LLM
- `workspace/skills/` — local skill bundle discovered by the real provider
- `patches/` — provider configuration template resolved to an absolute path
- `tests/` — API, patch/lifecycle, and full SDK integration tests
- `Dockerfile` / `Makefile` — reproducible build and hardened smoke test

## Run locally

Requirements: Node.js 24+, pnpm 11+, and Docker for the container smoke test.

```sh
make install # 按锁文件安装依赖
make verify # 运行完整质量门禁
```

To run against a real provider:

```sh
make configure # 首次创建本地 .env，不覆盖已有配置
# Set DEEPSEEK_API_KEY in .env
make run # 以前台受限容器运行服务
```

The service listens on port `3014`. Start a run with:

```sh
make run-api # 通过服务 API 发起一次运行
```

## Deterministic verification

`make verify` enforces frozen dependency installation, formatting, linting,
unit/integration tests, type checking, and production compilation.

`make smoke` builds and starts the production image with the deterministic
Mock LLM, executes the complete skill-tool flow, and checks both behavior and
container controls. The container runs as the unprivileged `demo` user with a
read-only root filesystem, all Linux capabilities dropped,
`no-new-privileges`, bounded memory/CPU/PIDs, and writable `noexec,nosuid`
tmpfs mounts only for runtime state.

Successful `/runs` output includes:

- `mockObservation.sawDiscoveredCatalog`
- `mockObservation.sawLoadedBody`
- `sdkProof.toolCall` and `sdkProof.toolResult`
- `sdkProof.deterministicInstructionApplied`
- final response `SKILL_LOADED_VERDICT_314159`

No real API key is needed for tests or `make smoke`.
