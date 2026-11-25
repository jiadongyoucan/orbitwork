.PHONY: up down logs rebuild test typecheck backup preflight

preflight:
	node scripts/preflight.mjs

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

rebuild:
	docker compose build --no-cache app sandbox
	docker compose up -d

test:
	NODE_ENV=test npm test

typecheck:
	npx tsc --noEmit

backup:
	docker compose run --rm app node dist/backup.js
