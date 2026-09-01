IMAGE ?= dsh-demo-06
CONTAINER ?= dsh-demo-06
NETWORK ?= dsh-demo-06-net
PORT ?= 3006
ENV_FILE ?= .env
COMPOSITION ?= focused
PROMPT ?= demonstrate the active composition
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3006 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test typecheck build verify image run up down compositions current select run-api smoke

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

compositions:
	curl --fail --silent --show-error $(BASE_URL)/compositions

current:
	curl --fail --silent --show-error $(BASE_URL)/composition

select:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({id:process.argv[1]}))' "$(COMPOSITION)")"; \
	curl --fail --silent --show-error --request PUT --header 'content-type: application/json' --data "$$payload" $(BASE_URL)/composition

run-api:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error --header 'content-type: application/json' --data "$$payload" $(BASE_URL)/runs

smoke: image
	@set -eu; \
	docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3006/mock/v1 \
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
	focused="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"prove composition"}' $(BASE_URL)/runs)"; \
	switched="$$(curl --fail --silent --show-error --request PUT --header 'content-type: application/json' --data '{"id":"planner"}' $(BASE_URL)/composition)"; \
	planner="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"prove composition"}' $(BASE_URL)/runs)"; \
	printf '%s\n%s\n%s\n' "$$focused" "$$switched" "$$planner"; \
	node -e 'const [f,s,p]=process.argv.slice(1).map(JSON.parse); if(f.finalResponse!=="profile=focused;todo=false"||s.rebuilt!==true||s.generation!==2||p.finalResponse!=="profile=planner;todo=true") process.exit(1)' "$$focused" "$$switched" "$$planner"
