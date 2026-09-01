IMAGE ?= dsh-demo-12
CONTAINER ?= dsh-demo-12
NETWORK ?= dsh-demo-12-net
PORT ?= 3012
ENV_FILE ?= .env
PROMPT ?= run the fixed sandbox probes
BASE_URL = http://127.0.0.1:$(PORT)
ENV_ARGS = $(if $(wildcard $(ENV_FILE)),--env-file $(ENV_FILE),)
HARDENING_ARGS = \
	--read-only \
	--tmpfs /tmp:rw,noexec,nosuid,size=192m \
	--tmpfs /workspace:rw,noexec,nosuid,size=64m,uid=999,gid=999 \
	--cap-drop ALL \
	--security-opt no-new-privileges \
	--memory 1g \
	--cpus 1 \
	--pids-limit 128
RUN_ARGS = \
	--name $(CONTAINER) \
	--network $(NETWORK) \
	$(ENV_ARGS) \
	--publish $(PORT):3012 \
	$(HARDENING_ARGS)

.PHONY: configure install format lint test typecheck build verify image run up down health runtime run-api smoke

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
	docker run --rm $(RUN_ARGS) $(IMAGE)

up: image
	@docker network inspect $(NETWORK) >/dev/null 2>&1 || docker network create $(NETWORK) >/dev/null
	docker run --detach --rm $(RUN_ARGS) $(IMAGE)

down:
	-@docker stop $(CONTAINER) >/dev/null
	-@docker network rm $(NETWORK) >/dev/null

health:
	curl --fail --silent --show-error $(BASE_URL)/health

runtime:
	curl --fail --silent --show-error $(BASE_URL)/runtime

run-api:
	@payload="$$(node -e 'process.stdout.write(JSON.stringify({prompt:process.argv[1]}))' "$(PROMPT)")"; \
	curl --fail --silent --show-error --header 'content-type: application/json' --data "$$payload" $(BASE_URL)/runs

smoke: image
	@set -eu; \
	trap 'docker stop $(CONTAINER) >/dev/null 2>&1 || true' EXIT; \
	docker run --detach --rm \
		--name $(CONTAINER) \
		--network none \
		$(HARDENING_ARGS) \
		--env DEEPSEEK_API_KEY=mock \
		--env DEEPSEEK_BASE_URL=http://127.0.0.1:3012/mock/v1 \
		--env ENABLE_MOCK_PROVIDER=true \
		--env DSH_TELEMETRY_DISABLED=1 \
		--env DSH_MODEL=mock-model \
		$(IMAGE) >/dev/null; \
	ready=0; \
	for attempt in $$(seq 1 60); do \
		if docker exec $(CONTAINER) node -e "fetch('http://127.0.0.1:3012/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then ready=1; break; fi; \
		sleep 1; \
	done; \
	test "$$ready" = 1; \
	result="$$(docker exec $(CONTAINER) node -e "fetch('http://127.0.0.1:3012/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:'run fixed probes'})}).then(async r=>{const t=await r.text();if(!r.ok)throw new Error(t);process.stdout.write(t)}).catch(e=>{console.error(e);process.exit(1)})")"; \
	inspect="$$(docker inspect $(CONTAINER))"; \
	printf '%s\n' "$$result"; \
	node -e 'const r=JSON.parse(process.argv[1]); const p=r.sdkProof; const a=r.artifactProof; if(r.finalResponse!=="verified workspace sandbox and default capability denials"||p?.toolCalls!==4||p?.toolResults!==4||!p.workspaceWrite||!p.outsideDenied||!p.shellDenied||!p.networkToolDenied||a?.insideContent!=="written through the real DSH fs tool\n"||a?.outsideExists) process.exit(1)' "$$result"; \
	node -e 'const c=JSON.parse(process.argv[1])[0]; const h=c.HostConfig; if(c.Config.User!=="demo"||!h.ReadonlyRootfs||!h.CapDrop.includes("ALL")||!h.SecurityOpt.includes("no-new-privileges")||h.PidsLimit!==128||h.NetworkMode!=="none") process.exit(1)' "$$inspect"; \
	docker exec $(CONTAINER) node -e "const c=new AbortController();setTimeout(()=>c.abort(),1500);fetch('https://example.com',{signal:c.signal}).then(()=>process.exit(1),()=>process.exit(0))"
