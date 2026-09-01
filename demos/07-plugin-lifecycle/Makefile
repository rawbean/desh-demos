IMAGE ?= dsh-demo-07
CONTAINER ?= dsh-demo-07
NETWORK ?= dsh-demo-07-net
PORT ?= 3007
PLUGIN ?= enforcer
BASE_URL = http://127.0.0.1:$(PORT)
DOCKER_ARGS = --name $(CONTAINER) --network $(NETWORK) --publish $(PORT):3007 \
	--read-only --tmpfs /tmp:rw,noexec,nosuid,size=128m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m --cap-drop ALL \
	--security-opt no-new-privileges --memory 1g --cpus 1 --pids-limit 128

.PHONY: configure install format lint test typecheck build verify image up down health plugins current select runtime-start runtime-stop smoke
configure:
	@test -f .env || cp .env.example .env
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
up: image
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null
	docker run --detach --rm $(DOCKER_ARGS) $(IMAGE)
down:
	-@docker stop $(CONTAINER) >/dev/null
	-@docker network rm $(NETWORK) >/dev/null
health:
	curl --fail --silent --show-error $(BASE_URL)/health
plugins:
	curl --fail --silent --show-error $(BASE_URL)/plugins
current:
	curl --fail --silent --show-error $(BASE_URL)/plugin
select:
	curl --fail --silent --show-error -X PUT -H 'content-type: application/json' \
		-d '{"id":"$(PLUGIN)"}' $(BASE_URL)/plugin
runtime-start:
	curl --fail --silent --show-error -X POST $(BASE_URL)/runtime/start
runtime-stop:
	curl --fail --silent --show-error -X POST $(BASE_URL)/runtime/stop
smoke: image
	@set -eu; docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm $(DOCKER_ARGS) -e DEEPSEEK_API_KEY=mock \
		-e DEEPSEEK_BASE_URL=http://127.0.0.1:3007/mock/v1 -e ENABLE_MOCK_PROVIDER=true \
		-e DSH_MODEL=mock-model -e DSH_TELEMETRY_DISABLED=1 $(IMAGE) >/dev/null; \
	ready=0; for n in $$(seq 1 60); do if curl -fsS $(BASE_URL)/health >/dev/null; then ready=1; break; fi; sleep 1; done; test "$$ready" = 1; \
	first="$$(curl -fsS -H 'content-type: application/json' -d '{"prompt":"Check This"}' $(BASE_URL)/runs)"; \
	switch="$$(curl -fsS -X PUT -H 'content-type: application/json' -d '{"id":"enforcer"}' $(BASE_URL)/plugin)"; \
	second="$$(curl -fsS -H 'content-type: application/json' -d '{"prompt":"Check This"}' $(BASE_URL)/runs)"; \
	printf '%s\n%s\n%s\n' "$$first" "$$switch" "$$second"; \
	node -e 'const [a,s,b]=process.argv.slice(1).map(JSON.parse); if(a.finalResponse!=="plugin=observer;probe=observer:check-this"||b.finalResponse!=="plugin=enforcer;probe=enforcer:check-this"||s.generation!==2||!s.rebuilt||!s.cordis.injected||s.lifecycle.filter(e=>e.generation===1&&e.phase.endsWith("-stop")).length!==2) process.exit(1)' "$$first" "$$switch" "$$second"
