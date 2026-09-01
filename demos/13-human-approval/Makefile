IMAGE ?= dsh-demo-13
CONTAINER ?= dsh-demo-13
NETWORK ?= dsh-demo-13-net
PORT ?= 3013
ENV_FILE ?= .env
PROJECT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
PROMPT ?= trigger the protected deletion simulation
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
DOCKER_ARGS = \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--env DEEPSEEK_API_KEY=mock \
	--publish $(PORT):3013 \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128

.PHONY: configure install format lint test typecheck build verify image run up down health runtime events run-api smoke smoke-allow smoke-reject

configure:
	@test -f $(ENV_FILE) || cp .env.example $(ENV_FILE)

install:
	pnpm --dir "$(PROJECT_DIR)" install --frozen-lockfile

format:
	pnpm --dir "$(PROJECT_DIR)" format

lint:
	pnpm --dir "$(PROJECT_DIR)" lint

test:
	pnpm --dir "$(PROJECT_DIR)" test

typecheck:
	pnpm --dir "$(PROJECT_DIR)" typecheck

build:
	pnpm --dir "$(PROJECT_DIR)" build

verify:
	pnpm --dir "$(PROJECT_DIR)" format:check
	pnpm --dir "$(PROJECT_DIR)" lint
	pnpm --dir "$(PROJECT_DIR)" test
	pnpm --dir "$(PROJECT_DIR)" typecheck
	pnpm --dir "$(PROJECT_DIR)" build

image:
	docker build --tag $(IMAGE) "$(PROJECT_DIR)"

run: image
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null
	docker run --rm --name $(CONTAINER) $(DOCKER_ARGS) $(IMAGE)

up: image
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null
	docker run --detach --rm --name $(CONTAINER) $(DOCKER_ARGS) $(IMAGE)

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
	@$(MAKE) --no-print-directory -f "$(firstword $(MAKEFILE_LIST))" smoke-allow
	@$(MAKE) --no-print-directory -f "$(firstword $(MAKEFILE_LIST))" smoke-reject

smoke-allow:
	@$(MAKE) --no-print-directory -f "$(firstword $(MAKEFILE_LIST))" _smoke MODE=allow EXPECTED=allowed-once FINAL=approval-allowed EXECUTED=true

smoke-reject:
	@$(MAKE) --no-print-directory -f "$(firstword $(MAKEFILE_LIST))" _smoke MODE=reject EXPECTED=rejected FINAL=approval-rejected EXECUTED=false

.PHONY: _smoke
_smoke:
	@set -eu; \
	name="$(CONTAINER)-$(MODE)"; \
	docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null; \
	trap 'docker stop "$$name" >/dev/null 2>&1 || true; docker network rm $(NETWORK) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm --name "$$name" $(DOCKER_ARGS) --env DEMO_APPROVAL=$(MODE) $(IMAGE) >/dev/null; \
	test "$$(docker inspect --format '{{.Config.User}}' "$$name")" != ""; \
	test "$$(docker inspect --format '{{.Config.User}}' "$$name")" != "root"; \
	test "$$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$$name")" = "true"; \
	docker inspect --format '{{json .HostConfig.CapDrop}}' "$$name" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(!JSON.parse(s).includes("ALL"))process.exit(1)})'; \
	docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$$name" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{if(!JSON.parse(s).includes("no-new-privileges"))process.exit(1)})'; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if curl --fail --silent $(BASE_URL)/health >/dev/null; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	result="$$(curl --fail --silent --show-error --header 'content-type: application/json' --data '{"prompt":"Call high_risk_workspace_delete exactly once."}' $(BASE_URL)/runs)"; \
	printf '%s\n' "$$result"; \
	node -e 'const [r,outcome,final,executed]=[JSON.parse(process.argv[1]),process.argv[2],process.argv[3],process.argv[4]==="true"]; if(!r.finalResponse.includes(final)||!Object.values(r.assertions).every(Boolean)||!r.approvalEvents.some(e=>e.type==="approval/asked")||!r.approvalEvents.some(e=>e.type==="approval/decided"&&e.data.outcome===outcome)||r.pluginEvents.some(e=>e.event==="high-risk-tool-executed")!==executed) process.exit(1)' "$$result" "$(EXPECTED)" "$(FINAL)" "$(EXECUTED)"
