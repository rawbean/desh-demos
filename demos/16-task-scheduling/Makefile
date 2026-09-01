IMAGE ?= dsh-demo-16
CONTAINER ?= dsh-demo-16
NETWORK ?= dsh-demo-16-net
PORT ?= 3016
ENV_FILE ?= .env
PROMPT ?= reply with exactly scheduled-ok
TASK_ID ?=
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3016 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=128m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test typecheck build verify image run up down health submit status cancel force-cancel smoke

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

submit:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error --header 'content-type: application/json' --data "$$payload" $(BASE_URL)/tasks

status:
	@test -n "$(TASK_ID)" || (echo 'TASK_ID is required' >&2; exit 2)
	curl --fail --silent --show-error $(BASE_URL)/tasks/$(TASK_ID)

cancel:
	@test -n "$(TASK_ID)" || (echo 'TASK_ID is required' >&2; exit 2)
	curl --fail --silent --show-error --request DELETE $(BASE_URL)/tasks/$(TASK_ID)

force-cancel:
	@test -n "$(TASK_ID)" || (echo 'TASK_ID is required' >&2; exit 2)
	curl --fail --silent --show-error --request DELETE '$(BASE_URL)/tasks/$(TASK_ID)?forceRuntime=true'

smoke: image
	@set -eu; \
	docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3016/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env MOCK_RESPONSE=scheduled-ok \
		--env DSH_MODEL=mock-model \
		$(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	submission="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"reply with exactly scheduled-ok"}' $(BASE_URL)/tasks)"; \
	task_id="$$(node -p 'JSON.parse(process.argv[1]).id' "$$submission")"; \
	status=''; \
	for attempt in $$(seq 1 60); do \
		status="$$(curl --fail --silent --show-error $(BASE_URL)/tasks/$$task_id)"; \
		state="$$(node -p 'JSON.parse(process.argv[1]).state' "$$status")"; \
		case "$$state" in completed|failed|cancelled|timed_out) break ;; esac; \
		sleep 1; \
	done; \
	inspect="$$(docker inspect $(CONTAINER))"; \
	printf '%s\n' "$$status"; \
	node -e 'const r=JSON.parse(process.argv[1]); if(r.state!=="completed"||r.finalResponse!=="scheduled-ok"||r.attempts!==1) process.exit(1)' "$$status"; \
	node -e 'const c=JSON.parse(process.argv[1])[0]; const h=c.HostConfig; if(c.Config.User!=="demo"||!h.ReadonlyRootfs||!h.CapDrop.includes("ALL")||!h.SecurityOpt.includes("no-new-privileges")||h.PidsLimit!==128) process.exit(1)' "$$inspect"
