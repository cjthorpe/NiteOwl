import '@testing-library/jest-dom';

// Provide a real in-memory localStorage when the runtime stub is incomplete
// (e.g. when vitest is started with --localstorage-file pointing nowhere)
if (typeof localStorage === 'undefined' || typeof localStorage.getItem !== 'function') {
  const store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        Object.keys(store).forEach((k) => delete store[k]);
      },
      get length() {
        return Object.keys(store).length;
      },
      key: (index: number) => Object.keys(store)[index] ?? null,
    },
    writable: true,
  });
} else {
  // Patch missing methods if only some are absent
  const proto = Object.getPrototypeOf(localStorage) as Record<string, unknown>;
  const store: Record<string, string> = {};
  if (typeof localStorage.clear !== 'function') {
    proto['clear'] = () => {
      Object.keys(store).forEach((k) => delete store[k]);
    };
  }
  if (typeof localStorage.removeItem !== 'function') {
    proto['removeItem'] = (key: string) => {
      delete store[key];
    };
  }
}
