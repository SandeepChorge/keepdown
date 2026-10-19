// A tiny message bus so the data and sync modules can announce changes without importing the UI.
//
// Events in use:
//   dirty (delay)        a note changed and should upload after `delay` ms
//   status               sync state changed (connected, saving, offline, errors)
//   list                 the note list needs a refresh
//   notes                the set of notes changed after a sync
//   active-replaced      the open note was updated from another device
//   storage              browser storage started or stopped working
//   toast (msg, opts)    show a short message

const handlers = new Map();

export function on(name, fn) {
  if (!handlers.has(name)) handlers.set(name, []);
  handlers.get(name).push(fn);
}

export function emit(name, ...args) {
  for (const fn of handlers.get(name) || []) fn(...args);
}
