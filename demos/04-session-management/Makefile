IMAGE ?= dsh-demo-04
CONTAINER ?= dsh-demo-04
NETWORK ?= dsh-demo-04-net
PORT ?= 3000
ENV_FILE ?= .env
SESSION_ID ?=
PROMPT ?= What did I ask you to remember?

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

.PHONY: configure install format test typecheck build verify image run up down health session-create session-list session-get session-turn session-terminate smoke

configure:
	@test -f $(ENV_FILE) || cp .env.example $(ENV_FILE)

install:
	pnpm install --frozen-lockfile

format:
	pnpm format

test:
	pnpm test

typecheck:
	pnpm typecheck

build:
	pnpm build

verify: format test typecheck build

image:
	docker build --tag $(IMAGE) .

run: image
	@docker network create $(NETWORK) >/dev/null; \
	trap 'docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --rm $(DOCKER_ARGS) $(IMAGE)

up: image
	@docker network create $(NETWORK) >/dev/null 2>&1 || true
	docker run --detach --rm $(DOCKER_ARGS) $(IMAGE)

down:
	@docker stop $(CONTAINER) >/dev/null 2>&1 || true
	@docker network rm $(NETWORK) >/dev/null 2>&1 || true

health:
	curl --fail --silent --show-error $(BASE_URL)/health

session-create:
	curl --fail --silent --show-error --request POST $(BASE_URL)/sessions

session-list:
	curl --fail --silent --show-error $(BASE_URL)/sessions

session-get:
	@test -n "$(SESSION_ID)" || (echo 'SESSION_ID is required' >&2; exit 2)
	curl --fail --silent --show-error $(BASE_URL)/sessions/$(SESSION_ID)

session-turn:
	@test -n "$(SESSION_ID)" || (echo 'SESSION_ID is required' >&2; exit 2)
	curl --fail --silent --show-error \
		--header 'content-type: application/json' \
		--data '{"prompt":"$(PROMPT)"}' \
		$(BASE_URL)/sessions/$(SESSION_ID)/turns

session-terminate:
	@test -n "$(SESSION_ID)" || (echo 'SESSION_ID is required' >&2; exit 2)
	curl --fail --silent --show-error --request DELETE \
		$(BASE_URL)/sessions/$(SESSION_ID)

smoke: image
	@set -eu; \
	docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3000/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env DSH_MODEL=mock-model \
		$(IMAGE) >/dev/null; \
	until curl --fail --silent $(BASE_URL)/health >/dev/null; do sleep 1; done; \
	created="$$(curl --fail --silent --show-error --request POST $(BASE_URL)/sessions)"; \
	session_id="$$(node -e 'const d=JSON.parse(process.argv[1]); if(!d.id)process.exit(1); process.stdout.write(d.id)' "$$created")"; \
	first="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"Remember blue and reply briefly"}' $(BASE_URL)/sessions/$$session_id/turns)"; \
	second="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"What did I ask you to remember?"}' $(BASE_URL)/sessions/$$session_id/turns)"; \
	terminated="$$(curl --fail --silent --show-error --request DELETE $(BASE_URL)/sessions/$$session_id)"; \
	code="$$(curl --silent --output /dev/null --write-out '%{http_code}' --header 'content-type: application/json' --data '{"prompt":"again"}' $(BASE_URL)/sessions/$$session_id/turns)"; \
	printf '%s\n%s\n%s\n' "$$first" "$$second" "$$terminated"; \
	case "$$second" in *'"finalResponse":"context-ok"'*) ;; *) echo 'session context was not preserved' >&2; exit 1 ;; esac; \
	case "$$terminated" in *'"state":"terminated"'*) ;; *) echo 'session was not terminated' >&2; exit 1 ;; esac; \
	test "$$code" = 409
