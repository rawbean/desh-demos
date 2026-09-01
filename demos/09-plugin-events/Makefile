IMAGE ?= dsh-demo-09
CONTAINER ?= dsh-demo-09
NETWORK ?= dsh-demo-09-net
PORT ?= 3009
ENV_FILE ?= .env
PROMPT ?= call todo_write exactly once
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3009 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test typecheck build verify image run up down health events run-api smoke

configure:
	@test -f $(ENV_FILE) || cp .env.example $(ENV_FILE)

install:
	pnpm --dir "$(CURDIR)" install --frozen-lockfile

format:
	pnpm --dir "$(CURDIR)" format

lint:
	pnpm --dir "$(CURDIR)" lint

test:
	pnpm --dir "$(CURDIR)" test

typecheck:
	pnpm --dir "$(CURDIR)" typecheck

build:
	pnpm --dir "$(CURDIR)" build

verify:
	pnpm --dir "$(CURDIR)" format:check
	pnpm --dir "$(CURDIR)" lint
	pnpm --dir "$(CURDIR)" test
	pnpm --dir "$(CURDIR)" typecheck
	pnpm --dir "$(CURDIR)" build

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

events:
	curl --fail --silent --show-error $(BASE_URL)/events

run-api:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error --header 'content-type: application/json' --data "$$payload" $(BASE_URL)/runs

smoke: image
	@set -eu; \
	docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3009/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env DSH_TELEMETRY_DISABLED=1 \
		--env DSH_MODEL=mock-model \
		--env DSH_PLUGIN_MAX_TOKENS=321 \
		$(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	result="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"call todo_write exactly once"}' $(BASE_URL)/runs)"; \
	printf '%s\n' "$$result"; \
	node -e 'const r=JSON.parse(process.argv[1]); const a=r.assertions; if(r.finalResponse!=="plugin-events-ok"||!Object.values(a).every(Boolean)||r.counts.agent<1||r.counts.llm<1||r.counts.tool<1) process.exit(1)' "$$result"
