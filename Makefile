.PHONY: build check test lint format app run clean design-preview
build:
	./scripts/swift.sh build --product EZ
test:
	./scripts/swift.sh run EZChecks
lint:
	xcrun swift-format lint --strict --recursive Sources Tests scripts/icon.swift Package.swift
	bash -n scripts/swift.sh scripts/build-app.sh
	bash -n scripts/design-preview.sh
	xcrun swift-format lint --strict scripts/design-preview.swift
	plutil -lint Resources/Info.plist
format:
	xcrun swift-format format --in-place --recursive Sources Tests scripts/icon.swift Package.swift
	xcrun swift-format format --in-place scripts/design-preview.swift
check: lint build test
app:
	./scripts/build-app.sh
run: app
	open dist/EZ.app
clean:
	./scripts/swift.sh package clean
design-preview:
	bash scripts/design-preview.sh
