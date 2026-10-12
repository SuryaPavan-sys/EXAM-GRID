// What the admin is looking at right now (page, room, session), so the assistant can
// understand "this room". Pages call setScreenContext(); the chat reads getScreenContext().
let current = {};
const listeners = new Set();

export function setScreenContext(ctx) {
  current = ctx || {};
  listeners.forEach((fn) => fn(current));
}
export const getScreenContext = () => current;
export function onScreenContext(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
