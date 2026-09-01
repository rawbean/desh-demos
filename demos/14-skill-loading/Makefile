IMAGE ?= dsh-demo-14
CONTAINER ?= dsh-demo-14
NETWORK ?= dsh-demo-14-net
PORT ?= 3014
ENV_FILE ?= .env
PROMPT ?= use the local skill and return its deterministic verdict
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3014 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test typecheck build verify image run up down runtime run-api smoke

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

runtime:
	curl --fail --silent --show-error $(BASE_URL)/runtime

run-api:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error --header 'content-type: application/json' --data "$$payload" $(BASE_URL)/runs

smoke: image
	@set -eu; \
	docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3014/mock/v1 \
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
	result="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"use the applicable local skill and return its deterministic verdict"}' $(BASE_URL)/runs)"; \
	inspect="$$(docker inspect $(CONTAINER))"; \
	printf '%s\n' "$$result"; \
	node -e 'const r=JSON.parse(process.argv[1]); const o=r.mockObservation; const p=r.sdkProof; if(r.finalResponse!=="SKILL_LOADED_VERDICT_314159"||o?.requestCount!==2||!o?.sawSkillTool||!o?.sawDiscoveredCatalog||!o?.emittedSkillCall||!o?.sawLoadedBody||!p?.toolCall||!p?.toolResult||!p?.discoveredFromDirectory||!p?.loadedSkillBody||!p?.deterministicInstructionApplied||!r.eventTypes.includes("tool/call")||!r.eventTypes.includes("tool/result")) process.exit(1)' "$$result"; \
	node -e 'const c=JSON.parse(process.argv[1])[0]; const h=c.HostConfig; if(c.Config.User!=="demo"||!h.ReadonlyRootfs||!h.CapDrop.includes("ALL")||!h.SecurityOpt.includes("no-new-privileges")||h.PidsLimit!==128||h.Memory!==1073741824||h.NanoCpus!==1000000000) process.exit(1)' "$$inspect"
