IMAGE ?= dsh-demo-01
CONTAINER ?= dsh-demo-01
PORT ?= 3000
ENV_FILE ?= .env

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

.PHONY: configure install test typecheck verify build image run up down health runtime-status runtime-start runtime-stop smoke

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

runtime-status:
	curl --fail --silent --show-error $(BASE_URL)/runtime

runtime-start:
	curl --fail --silent --show-error --request POST $(BASE_URL)/runtime/start

runtime-stop:
	curl --fail --silent --show-error --request POST $(BASE_URL)/runtime/stop

smoke: up
	@set -eu; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true' EXIT; \
	until curl --fail --silent $(BASE_URL)/health >/dev/null; do sleep 1; done; \
	$(MAKE) runtime-start; \
	$(MAKE) runtime-start; \
	$(MAKE) runtime-stop
