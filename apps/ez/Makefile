.PHONY: build check check-scripts test test-core test-state test-services test-install lint lint-swift lint-shell lint-workflows format tools app run install signing-setup clean design-preview configuration-preview surface-preview
build:
	./scripts/swift.sh build --product EZ
test:
	bash scripts/test.sh $(CHECK_ARGS)
test-core:
	./scripts/swift.sh run EZChecks $(CHECK_ARGS)
test-state:
	bash scripts/state-checks.sh $(CHECK_ARGS)
test-services:
	bash scripts/check-services.sh $(CHECK_ARGS)
test-install:
	bash scripts/check-install.sh
lint: lint-swift lint-shell lint-workflows
	plutil -lint Resources/Info.plist
lint-swift:
	xcrun swift-format lint --strict --recursive Sources Tests scripts Package.swift
	@test -x .build/tools/swiftlint || { echo 'Run make tools first.' >&2; exit 1; }
	.build/tools/swiftlint lint --strict --quiet --no-cache --disable-sourcekit
lint-shell:
	@test -x .build/tools/shellcheck || { echo 'Run make tools first.' >&2; exit 1; }
	@for script in scripts/*.sh integrations/raycast/*.sh ../../scripts/*.sh; do bash -n "$$script" || exit; done
	.build/tools/shellcheck scripts/*.sh integrations/raycast/*.sh ../../scripts/*.sh
lint-workflows:
	@test -x .build/tools/actionlint || { echo 'Run make tools first.' >&2; exit 1; }
	.build/tools/actionlint -shellcheck "$$(pwd)/.build/tools/shellcheck" ../../.github/workflows/*.yml
format:
	xcrun swift-format format --in-place --recursive Sources Tests scripts Package.swift
check: lint build test test-install check-scripts
check-scripts: build
	bash scripts/check-swift-scripts.sh
tools:
	bash scripts/bootstrap-tools.sh
app:
	./scripts/build-app.sh
signing-setup:
	bash scripts/configure-signing.sh
install:
	bash scripts/install-app.sh
run: app
	open dist/EZ.app
clean:
	./scripts/swift.sh package clean
design-preview:
	bash scripts/preview.sh design

configuration-preview:
	bash scripts/preview.sh configuration

surface-preview:
	bash scripts/preview.sh surface
