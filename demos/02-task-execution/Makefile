IMAGE ?= dsh-demo-02
CONTAINER ?= dsh-demo-02
PORT ?= 3002
ENV_FILE ?= .env
PROMPT ?= Reply with exactly: task-ok

ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
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

.PHONY: configure install test typecheck verify build image run up down health task smoke

configure:
	@test -f $(ENV_FILE) || cp .env.example $(ENV_FILE)

install:
	pnpm install --frozen-lockfile

test:
	pnpm test

typecheck:
	pnpm typecheck

verify: test typecheck build

build:
	pnpm build

image:
	docker build --tag $(IMAGE) .

run: image
	docker run --rm $(DOCKER_ARGS) $(IMAGE)

up: image
	docker run --detach --rm $(DOCKER_ARGS) $(IMAGE)

down:
	docker stop $(CONTAINER)

health:
	curl --fail --silent --show-error $(BASE_URL)/health

task:
	curl --fail --silent --show-error \
		--header 'content-type: application/json' \
		--data '{"prompt":"$(PROMPT)"}' \
		$(BASE_URL)/tasks

smoke: image
	@set -eu; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3000/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env DSH_MODEL=mock-model \
		$(IMAGE) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true' EXIT; \
	until curl --fail --silent $(BASE_URL)/health >/dev/null; do sleep 1; done; \
	result="$$(curl --fail --silent --show-error \
		--header 'content-type: application/json' \
		--data '{"prompt":"Reply with exactly: task-ok"}' \
		$(BASE_URL)/tasks)"; \
	printf '%s\n' "$$result"; \
	case "$$result" in \
		*'"finalResponse":"task-ok"'*) ;; \
		*) echo 'unexpected task result' >&2; exit 1 ;; \
	esac
