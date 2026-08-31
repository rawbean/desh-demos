IMAGE ?= dsh-demo-03
CONTAINER ?= dsh-demo-03
NETWORK ?= dsh-demo-03-net
PORT ?= 3000
ENV_FILE ?= .env
PROMPT ?= Use todo_write once, then reply with exactly event-stream-ok
TASK_ID ?=

ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3000 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=128m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128
BASE_URL = http://127.0.0.1:$(PORT)

.PHONY: configure install format lint test typecheck build verify image run up down health runtime-start runtime-stop task task-status events smoke

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

runtime-start:
	curl --fail --silent --show-error --request POST $(BASE_URL)/runtime/start

runtime-stop:
	curl --fail --silent --show-error --request POST $(BASE_URL)/runtime/stop

task:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt: process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error \
		--header 'content-type: application/json' \
		--data "$$payload" \
		$(BASE_URL)/tasks

task-status:
	@test -n "$(TASK_ID)" || (echo 'TASK_ID is required' >&2; exit 2)
	curl --fail --silent --show-error $(BASE_URL)/tasks/$(TASK_ID)

events:
	@test -n "$(TASK_ID)" || (echo 'TASK_ID is required' >&2; exit 2)
	curl --fail --no-buffer --silent --show-error $(BASE_URL)/tasks/$(TASK_ID)/events

smoke: image
	@set -eu; \
	docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3000/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env MOCK_USE_TOOL=true \
		--env DSH_MODEL=mock-model \
		$(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	submission="$$(curl --fail --silent --show-error \
		--header 'content-type: application/json' \
		--data '{"prompt":"Use todo_write once, then reply with exactly event-stream-ok"}' \
		$(BASE_URL)/tasks)"; \
	task_id="$$(node -p 'JSON.parse(process.argv[1]).id' "$$submission")"; \
	stream="$$(curl --fail --no-buffer --silent --show-error --max-time 60 \
		$(BASE_URL)/tasks/$$task_id/events)"; \
	status="$$(curl --fail --silent --show-error $(BASE_URL)/tasks/$$task_id)"; \
	printf '%s\n%s\n' "$$stream" "$$status"; \
	for expected in '"category":"agent"' '"category":"model"' '"category":"tool"' '"category":"notification"' '"finalResponse":"event-stream-ok"'; do \
		case "$$stream$$status" in *"$$expected"*) ;; *) echo "missing $$expected" >&2; exit 1 ;; esac; \
	done
