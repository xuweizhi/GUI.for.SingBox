APP_NAME ?= GUI.for.SingBox
GO ?= go
PNPM ?= pnpm
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
GO_LDFLAGS ?= -s -w -X guiforcores/bridge.AppVersion=$(VERSION)

.PHONY: install frontend build test clean

install:
	cd frontend && $(PNPM) install --frozen-lockfile

frontend:
	cd frontend && VITE_APP_VERSION=$(VERSION) $(PNPM) build

build: frontend
	mkdir -p build/bin
	$(GO) build -trimpath -ldflags="$(GO_LDFLAGS)" -o build/bin/$(APP_NAME) .

test: frontend
	$(GO) test ./...
	cd frontend && $(PNPM) test
	./scripts/test-headless-systemd-service.sh
	./scripts/test-rebuild-restart-headless.sh

clean:
	$(GO) clean
