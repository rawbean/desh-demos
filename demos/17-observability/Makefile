IMAGE ?= dsh-demo-17
CONTAINER ?= dsh-demo-17
PORT ?= 3017
ENV_FILE ?= .env
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--name $(CONTAINER) \
	$(ENV_ARGS) \
	--publish $(PORT):3017 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test typecheck build verify image run up down health smoke

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
	docker run --rm $(DOCKER_ARGS) $(IMAGE)

up: image
	docker run --detach --rm $(DOCKER_ARGS) $(IMAGE)

down:
	-@docker stop $(CONTAINER) >/dev/null

health:
	curl --fail --silent --show-error $(BASE_URL)/health

smoke: image
	@set -eu; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3017/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env DSH_MODEL=mock-model \
		$(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	submission="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"call todo_write exactly once"}' $(BASE_URL)/tasks)"; \
	task_id="$$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).id)' "$$submission")"; \
	trace_id="$$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).traceId)' "$$submission")"; \
	task=""; \
	for attempt in $$(seq 1 60); do \
		task="$$(curl --fail --silent --show-error $(BASE_URL)/tasks/$$task_id)"; \
		state="$$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).state)' "$$task")"; \
		if test "$$state" = completed || test "$$state" = failed; then break; fi; \
		sleep 1; \
	done; \
	events="$$(curl --fail --silent --show-error $(BASE_URL)/traces/$$trace_id/events?limit=200)"; \
	metrics="$$(curl --fail --silent --show-error $(BASE_URL)/traces/$$trace_id/metrics)"; \
	observation="$$(curl --fail --silent --show-error $(BASE_URL)/mock/observation)"; \
	inspect="$$(docker inspect $(CONTAINER))"; \
	printf '%s\n%s\n%s\n' "$$task" "$$events" "$$metrics"; \
	node -e 'const t=JSON.parse(process.argv[1]); if(t.state!=="completed"||!(t.durationMs>0)) process.exit(1)' "$$task"; \
	node -e 'const e=JSON.parse(process.argv[1]).events; const c=new Set(e.map(x=>x.category)); if(!["agent","model","tool","notification"].every(x=>c.has(x))||e.length>200) process.exit(1)' "$$events"; \
	node -e 'const m=JSON.parse(process.argv[1]); if(!(m.durationMs>0)||m.totalTokens!==43||!(m.eventCount>0)||!Object.values(m.categoryCounts).every(x=>x>0)) process.exit(1)' "$$metrics"; \
	node -e 'if(JSON.parse(process.argv[1]).sawToolResult!==true)process.exit(1)' "$$observation"; \
	node -e 'const c=JSON.parse(process.argv[1])[0],h=c.HostConfig; if(c.Config.User!=="demo"||!h.ReadonlyRootfs||!h.CapDrop.includes("ALL")||!h.SecurityOpt.includes("no-new-privileges")||h.PidsLimit!==128||!h.Tmpfs["/tmp"]) process.exit(1)' "$$inspect"
