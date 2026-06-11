package bridge

import (
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type eventEnvelope struct {
	Name string `json:"name"`
	Data []any  `json:"data"`
}

type eventHub struct {
	mu             sync.RWMutex
	listeners      map[string]map[int]func(...any)
	subscribers    map[int]chan eventEnvelope
	nextListenerID int
	nextSubID      int
}

func newEventHub() *eventHub {
	return &eventHub{
		listeners:   make(map[string]map[int]func(...any)),
		subscribers: make(map[int]chan eventEnvelope),
	}
}

func (h *eventHub) on(name string, cb func(...any)) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.nextListenerID++
	if h.listeners[name] == nil {
		h.listeners[name] = make(map[int]func(...any))
	}
	h.listeners[name][h.nextListenerID] = cb
}

func (h *eventHub) off(name string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	delete(h.listeners, name)
}

func (h *eventHub) emit(name string, data ...any) {
	h.dispatch(name, data...)
	h.broadcast(eventEnvelope{Name: name, Data: data})
}

func (h *eventHub) emitLocal(name string, data ...any) {
	h.dispatch(name, data...)
}

func (h *eventHub) dispatch(name string, data ...any) {
	h.mu.RLock()
	callbackMap := h.listeners[name]
	callbacks := make([]func(...any), 0, len(callbackMap))
	for _, cb := range callbackMap {
		callbacks = append(callbacks, cb)
	}
	h.mu.RUnlock()

	for _, cb := range callbacks {
		cb(data...)
	}
}

func (h *eventHub) broadcast(evt eventEnvelope) {
	h.mu.RLock()
	subscribers := make([]chan eventEnvelope, 0, len(h.subscribers))
	for _, ch := range h.subscribers {
		subscribers = append(subscribers, ch)
	}
	h.mu.RUnlock()

	for _, ch := range subscribers {
		select {
		case ch <- evt:
		default:
		}
	}
}

func (h *eventHub) subscribe() (<-chan eventEnvelope, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.nextSubID++
	id := h.nextSubID
	ch := make(chan eventEnvelope, 128)
	h.subscribers[id] = ch

	return ch, func() {
		h.mu.Lock()
		defer h.mu.Unlock()

		delete(h.subscribers, id)
	}
}

func (a *App) IsHeadless() bool {
	return a.Headless != nil
}

func (a *App) EventsOn(name string, cb func(...any)) {
	if a.IsHeadless() {
		a.Headless.Hub.on(name, cb)
		return
	}
	runtime.EventsOn(a.Ctx, name, cb)
}

func (a *App) EventsOff(name string) {
	if a.IsHeadless() {
		a.Headless.Hub.off(name)
		return
	}
	runtime.EventsOff(a.Ctx, name)
}

func (a *App) EventsEmit(name string, data ...any) {
	if a.IsHeadless() {
		a.Headless.Hub.emit(name, data...)
		return
	}
	runtime.EventsEmit(a.Ctx, name, data...)
}

func (a *App) ClientEventsEmit(name string, data ...any) {
	if a.IsHeadless() {
		a.Headless.Hub.emitLocal(name, data...)
		return
	}
	runtime.EventsEmit(a.Ctx, name, data...)
}

func (a *App) RequestHeadlessShutdown() {
	if !a.IsHeadless() {
		return
	}
	a.Headless.shutdownOnce.Do(func() {
		close(a.Headless.shutdown)
	})
}
