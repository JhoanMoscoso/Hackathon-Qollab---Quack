// Small promise helpers. Pure, no DOM.

/**
 * Race `promise` against a timer. Resolves `{ timedOut: false, value }` if the promise settles first
 * (a rejection propagates), or `{ timedOut: true }` after `ms`. The original promise is never
 * cancelled: it keeps running and the caller may still await it later.
 */
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  const settled = Promise.resolve(promise).then((value) => ({ timedOut: false, value }));
  return Promise.race([settled, timeout]).finally(() => clearTimeout(timer));
}
