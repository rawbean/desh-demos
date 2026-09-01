IMAGE ?= dsh-demo-15
CONTAINER ?= dsh-demo-15
NETWORK ?= dsh-demo-15-net
PORT ?= 3015
ENV_FILE ?= .env
PROMPT ?= call the demo MCP calculator exactly once
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3015 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test typecheck build verify image run up down health runtime mcp-events run-api smoke

configure:
	@test -f $(ENV_FILE) || cp .env.example $(ENV_FILE)

install:
	pnpm install --frozen-lockfile

format:
	pnpm format

lint:
	pnpm lint

test:
	pnpm test

typecheck:
	pnpm typecheck

build:
	pnpm build

verify:
	pnpm format:check
	pnpm lint
	pnpm test
	pnpm typecheck
	pnpm build

image:
	docker build --tag $(IMAGE) .

run: image
	@set -eu; \
	docker network create $(NETWORK) >/dev/null; \
	trap 'docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --rm $(DOCKER_ARGS) $(IMAGE)

up: image
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null
	docker run --detach --rm $(DOCKER_ARGS) $(IMAGE)

down:
	-@docker stop $(CONTAINER) >/dev/null
	-@docker network rm $(NETWORK) >/dev/null

health:
	curl --fail --silent --show-error $(BASE_URL)/health

runtime:
	curl --fail --silent --show-error $(BASE_URL)/runtime

mcp-events:
	curl --fail --silent --show-error $(BASE_URL)/mcp-events

run-api:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error --header 'content-type: application/json' --data "$$payload" $(BASE_URL)/runs

smoke: image
	@set -eu; \
	docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3015/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env DSH_TELEMETRY_DISABLED=1 \
		--env DSH_MODEL=mock-model \
		$(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	result="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"call the demo MCP calculator exactly once"}' $(BASE_URL)/runs)"; \
	inspect="$$(docker inspect $(CONTAINER))"; \
	stopped="$$(curl --fail --silent --show-error --request POST $(BASE_URL)/runtime/stop)"; \
	printf '%s\n' "$$result"; \
	node -e 'const r=JSON.parse(process.argv[1]); const o=r.mockObservation; if(r.finalResponse!=="verified MCP tool: 19+23=42"||r.expectedTool!=="mcp__demo__calculate"||o?.requestCount!==2||!o?.discoveredNamespacedTool||!o?.emittedNamespacedCall||!o?.sawMcpResult||!Object.values(r.sdkProof??{}).every(Boolean)||!r.mcpEvents.some(e=>e.event==="tool-called")) process.exit(1)' "$$result"; \
	node -e 'const r=JSON.parse(process.argv[1]); if(r.state!=="stopped"||r.initialized||!r.childCleaned||!Number.isInteger(r.childPid)) process.exit(1)' "$$stopped"; \
	node -e 'const c=JSON.parse(process.argv[1])[0]; const h=c.HostConfig; if(c.Config.User!=="demo"||!h.ReadonlyRootfs||!h.CapDrop.includes("ALL")||!h.SecurityOpt.includes("no-new-privileges")||h.PidsLimit!==128) process.exit(1)' "$$inspect"
