IMAGE ?= dsh-demo-05
CONTAINER ?= dsh-demo-05
NETWORK ?= dsh-demo-05-net
PORT ?= 3005
ENV_FILE ?= .env
PROMPT ?= Reply once
PROVIDER ?= mock-secondary
MODEL ?= mock-green

ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3005 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=128m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128
BASE_URL = http://127.0.0.1:$(PORT)

.PHONY: configure install format lint test typecheck build verify image run up down health config prompt switch smoke

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

config:
	curl --fail --silent --show-error $(BASE_URL)/config

prompt:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt: process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error \
		--header 'content-type: application/json' \
		--data "$$payload" \
		$(BASE_URL)/prompts

switch:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({provider: process.argv[1],model: process.argv[2]}))' "$(PROVIDER)" "$(MODEL)")"; \
	curl --fail --silent --show-error \
		--request PUT \
		--header 'content-type: application/json' \
		--data "$$payload" \
		$(BASE_URL)/config

smoke: image
	@set -eu; \
	docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3005/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env DSH_PROVIDER=mock-primary \
		--env DSH_MODEL=mock-blue \
		$(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	before="$$(curl --fail --silent --show-error \
		--header 'content-type: application/json' \
		--data '{"prompt":"first deterministic answer"}' \
		$(BASE_URL)/prompts)"; \
	switched="$$(curl --fail --silent --show-error \
		--request PUT \
		--header 'content-type: application/json' \
		--data '{"provider":"mock-secondary","model":"mock-green"}' \
		$(BASE_URL)/config)"; \
	after="$$(curl --fail --silent --show-error \
		--header 'content-type: application/json' \
		--data '{"prompt":"second deterministic answer"}' \
		$(BASE_URL)/prompts)"; \
	final="$$(curl --fail --silent --show-error $(BASE_URL)/config)"; \
	node -e 'const [before,switched,after,final]=process.argv.slice(1).map(JSON.parse); \
		if(before.answer!=="blue-provider-answer") throw new Error("unexpected first answer"); \
		if(before.runtime.route.model!=="mock-blue" || before.runtime.generation!==1) throw new Error("unexpected first state"); \
		if(switched.route.model!=="mock-green" || switched.generation!==2) throw new Error("switch did not rebuild runtime"); \
		if(after.answer!=="green-provider-answer") throw new Error("unexpected second answer"); \
		if(final.active.route.provider!=="mock-secondary" || final.active.generation!==2) throw new Error("unexpected final state");' \
		"$$before" "$$switched" "$$after" "$$final"; \
	printf '%s\n%s\n%s\n%s\n' "$$before" "$$switched" "$$after" "$$final"
