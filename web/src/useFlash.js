export function useFlash() {
  const last = new Map()
  return {
    flashClass(code, value) {
      const prev = last.get(code)
      last.set(code, value)
      if (prev === undefined || value === prev) return ''
      return value > prev ? 'cell-flash-up' : 'cell-flash-down'
    },
  }
}
