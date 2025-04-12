// Mock implementation of async_hooks for browser environment
export const createHook = () => ({
  enable: () => {},
  disable: () => {},
})

export const executionAsyncId = () => 1
export const triggerAsyncId = () => 0
export const AsyncLocalStorage = class {
  disable() {}
  getStore() {
    return null
  }
  run(store: any, callback: () => any) {
    return callback()
  }
  exit(callback: () => any) {
    return callback()
  }
  enterWith() {}
}
