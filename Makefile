# The gate a pre-commit hook runs: lint, then build and tests
# (`npm test` runs tsc before the tests).
.PHONY: check
check:
	npx --no-install biome lint src test
	npm test
