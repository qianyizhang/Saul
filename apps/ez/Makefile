.PHONY: build check check-scripts test-tooling test test-core test-state test-services test-ui test-install lint lint-swift lint-shell lint-workflows format tools app run install signing-setup clean design-preview configuration-preview surface-preview credentials-app credentials-install
build:
	./scripts/swift.sh build --product EZ
test:
	bash scripts/check.sh all $(CHECK_ARGS)
test-core:
	bash scripts/check.sh core $(CHECK_ARGS)
test-state:
	bash scripts/check.sh state $(CHECK_ARGS)
test-services:
	bash scripts/check.sh services $(CHECK_ARGS)
test-ui:
	bash scripts/check.sh ui $(CHECK_ARGS)
test-tooling:
	bash Tests/Tooling/check-swift-build.sh
test-install:
	bash scripts/check-install.sh
	bash scripts/check-credential-install.sh
lint: lint-swift lint-shell lint-workflows
	plutil -lint Resources/Info.plist
lint-swift:
	xcrun swift-format lint --strict --recursive ../../native/credentials/Sources ../../native/credentials/Package.swift
	xcrun swift-format lint --strict --recursive Sources Tests scripts Package.swift
	@test -x .build/tools/swiftlint || { echo 'Run make tools first.' >&2; exit 1; }
	.build/tools/swiftlint lint --strict --quiet --no-cache --disable-sourcekit
lint-shell:
	@test -x .build/tools/shellcheck || { echo 'Run make tools first.' >&2; exit 1; }
	@for script in scripts/*.sh scripts/lib/*.sh Tests/Tooling/*.sh integrations/raycast/*.sh ../../scripts/*.sh; do bash -n "$$script" || exit; done
	.build/tools/shellcheck scripts/*.sh scripts/lib/*.sh Tests/Tooling/*.sh integrations/raycast/*.sh ../../scripts/*.sh
lint-workflows:
	@test -x .build/tools/actionlint || { echo 'Run make tools first.' >&2; exit 1; }
	.build/tools/actionlint -shellcheck "$$(pwd)/.build/tools/shellcheck" ../../.github/workflows/*.yml
format:
	xcrun swift-format format --in-place --recursive Sources Tests scripts Package.swift
	xcrun swift-format format --in-place --recursive ../../native/credentials/Sources ../../native/credentials/Package.swift
check: lint build test test-install test-tooling check-scripts
	bash scripts/check-credentials.sh
	./scripts/swift.sh run CredentialOwnerChecks
check-scripts: build
	bash scripts/check.sh scripts
tools:
	bash scripts/bootstrap-tools.sh
app:
	./scripts/build-app.sh
signing-setup:
	bash scripts/configure-signing.sh
credentials-app:
	bash scripts/build-credentials.sh
credentials-install:
	bash scripts/install-credentials.sh
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
