IMAGE ?= dsh-demo-11
CONTAINER ?= dsh-demo-11
NETWORK ?= dsh-demo-11-net
PORT ?= 3011
ENV_FILE ?= .env
PROMPT ?= prove the custom adapter path
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3011 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test typecheck build verify image run up down health runtime events run-api smoke

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

runtime:
	curl --fail --silent --show-error $(BASE_URL)/runtime

events:
	curl --fail --silent --show-error $(BASE_URL)/events

run-api:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error --header 'content-type: application/json' --data "$$payload" $(BASE_URL)/runs

smoke: image
	@set -eu; \
	docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) $(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	result="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"prove the custom adapter path"}' $(BASE_URL)/runs)"; \
	printf '%s\n' "$$result"; \
	node -e 'const r=JSON.parse(process.argv[1]); if(r.finalResponse!=="custom-adapter-ok"||r.provider!=="demo-custom-adapter"||r.model!=="deterministic-v1"||!Object.values(r.assertions).every(Boolean)||!r.events.some(e=>e.source==="runtime-adapter"&&e.event==="stream-start"&&e.provider===r.provider)) process.exit(1)' "$$result"
