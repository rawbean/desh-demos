IMAGE ?= dsh-demo-18
CONTAINER ?= dsh-demo-18
PORT ?= 3018
ENV_FILE ?= .env
CRASH_TOKEN ?= recovery-smoke-secret
SESSION_ID ?=
PROMPT ?= What did I ask you to remember?
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--init \
	$(ENV_ARGS) \
	--publish $(PORT):3018 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test integration typecheck build verify image run up down health session-create session-list session-get session-turn session-terminate runtime-status crash recover recovery-status smoke

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

integration:
	pnpm test:integration

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
	docker run --rm $(DOCKER_ARGS) $(IMAGE)

up: image
	docker run --detach --rm $(DOCKER_ARGS) $(IMAGE)

down:
	-@docker stop $(CONTAINER) >/dev/null

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

runtime-status:
	curl --fail --silent --show-error $(BASE_URL)/runtime

crash:
	curl --fail --silent --show-error --request POST \
		--header 'x-runtime-crash-token: $(CRASH_TOKEN)' \
		$(BASE_URL)/runtime/crash

recover:
	curl --fail --silent --show-error --request POST $(BASE_URL)/recover

recovery-status:
	curl --fail --silent --show-error $(BASE_URL)/recover/status

smoke: image
	@set -eu; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3018/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env ENABLE_RUNTIME_CRASH_ENDPOINT=true \
		--env RUNTIME_CRASH_TOKEN=$(CRASH_TOKEN) \
		--env DSH_MODEL=mock-model \
		$(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	created="$$(curl --fail --silent --show-error --request POST $(BASE_URL)/sessions)"; \
	session_id="$$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$$created")"; \
	first="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"Remember blue and reply briefly."}' $(BASE_URL)/sessions/$$session_id/turns)"; \
	crashed="$$(curl --fail --silent --show-error --request POST --header 'x-runtime-crash-token: $(CRASH_TOKEN)' $(BASE_URL)/runtime/crash)"; \
	suspended="$$(curl --fail --silent --show-error $(BASE_URL)/sessions/$$session_id)"; \
	recovered="$$(curl --fail --silent --show-error --request POST $(BASE_URL)/recover)"; \
	second="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"What did I ask you to remember?","expectedResponse":"context-ok"}' $(BASE_URL)/sessions/$$session_id/turns)"; \
	status="$$(curl --fail --silent --show-error $(BASE_URL)/recover/status)"; \
	observation="$$(curl --fail --silent --show-error $(BASE_URL)/mock/observation)"; \
	terminated="$$(curl --fail --silent --show-error --request DELETE $(BASE_URL)/sessions/$$session_id)"; \
	code="$$(curl --silent --output /dev/null --write-out '%{http_code}' --header 'content-type: application/json' --data '{"prompt":"again"}' $(BASE_URL)/sessions/$$session_id/turns)"; \
	inspect="$$(docker inspect $(CONTAINER))"; \
	printf '%s\n%s\n%s\n%s\n%s\n%s\n' "$$first" "$$crashed" "$$suspended" "$$recovered" "$$second" "$$status"; \
	node -e 'const d=JSON.parse(process.argv[1]); if(d.finalResponse!=="remembered:blue")process.exit(1)' "$$first"; \
	node -e 'const d=JSON.parse(process.argv[1]); if(d.state!=="crashed")process.exit(1)' "$$crashed"; \
	node -e 'const d=JSON.parse(process.argv[1]); if(d.id!==process.argv[2]||d.state!=="suspended")process.exit(1)' "$$suspended" "$$session_id"; \
	node -e 'const d=JSON.parse(process.argv[1]); if(d.state!=="running"||d.recoveryGeneration!==1)process.exit(1)' "$$recovered"; \
	node -e 'const d=JSON.parse(process.argv[1]); if(d.finalResponse!==""||d.session.id!==process.argv[2]||d.session.contextContinuity!=="lost")process.exit(1)' "$$second" "$$session_id"; \
	node -e 'const d=JSON.parse(process.argv[1]); if(d.continuity.lost!==1)process.exit(1)' "$$status"; \
	node -e 'const d=JSON.parse(process.argv[1]); if(d.requestCount!==1||d.sawPersistedAssistantMemory!==false)process.exit(1)' "$$observation"; \
	node -e 'const d=JSON.parse(process.argv[1]); if(d.state!=="terminated")process.exit(1)' "$$terminated"; \
	test "$$code" = 409; \
	node -e 'const c=JSON.parse(process.argv[1])[0],h=c.HostConfig; if(c.Config.User!=="demo"||!h.ReadonlyRootfs||!h.CapDrop.includes("ALL")||!h.SecurityOpt.includes("no-new-privileges")||h.PidsLimit!==128||!h.Tmpfs["/tmp"]||!h.Init)process.exit(1)' "$$inspect"
