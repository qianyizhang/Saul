.PHONY: build check test lint format app run clean design-preview configuration-preview surface-preview
build:
	./scripts/swift.sh build --product EZ
test:
	./scripts/swift.sh run EZChecks
	bash scripts/state-checks.sh
lint:
	xcrun swift-format lint --strict --recursive Sources Tests scripts/icon.swift Package.swift
	bash -n scripts/swift.sh scripts/build-app.sh
	bash -n integrations/raycast/ez.sh
	bash -n scripts/state-checks.sh scripts/preview.sh
	xcrun swift-format lint --strict scripts/design-preview.swift scripts/configuration-preview.swift scripts/surface-preview.swift
	plutil -lint Resources/Info.plist
format:
	xcrun swift-format format --in-place --recursive Sources Tests scripts/icon.swift Package.swift
	xcrun swift-format format --in-place scripts/design-preview.swift scripts/configuration-preview.swift scripts/surface-preview.swift
check: lint build test
app:
	./scripts/build-app.sh
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
