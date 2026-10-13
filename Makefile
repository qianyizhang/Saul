.PHONY: build check test lint format app run clean
build:
	./scripts/swift.sh build --product EZ
test:
	./scripts/swift.sh run EZChecks
lint:
	xcrun swift-format lint --strict --recursive Sources Tests scripts/icon.swift Package.swift
	bash -n scripts/swift.sh scripts/build-app.sh
	plutil -lint Resources/Info.plist
format:
	xcrun swift-format format --in-place --recursive Sources Tests scripts/icon.swift Package.swift
check: lint build test
app:
	./scripts/build-app.sh
run: app
	open dist/EZ.app
clean:
	./scripts/swift.sh package clean
