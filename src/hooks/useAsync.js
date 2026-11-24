/**
 * Load data with loading / error state.
 *
 *   const { data, loading, error, reload } = useAsync(() => getBookings(userId), [userId])
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export function useAsync(fn, deps = [], { enabled = true } = {}) {
  const [state, setState] = useState({ data: undefined, loading: enabled, error: null })
  const fnRef = useRef(fn)
  // Always call the latest version of fn (updated after every render).
  useEffect(() => {
    fnRef.current = fn
  })
  const callId = useRef(0)

  const run = useCallback(async () => {
    const id = ++callId.current
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await fnRef.current()
      if (id === callId.current) setState({ data, loading: false, error: null })
      return data
    } catch (error) {
      if (id === callId.current) setState((s) => ({ ...s, loading: false, error }))
      return undefined
    }
  }, [])

  useEffect(() => {
    if (enabled) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])

  const setData = useCallback((updater) => {
    setState((s) => ({ ...s, data: typeof updater === 'function' ? updater(s.data) : updater }))
  }, [])

  return { ...state, reload: run, setData }
}

/** Run an action (save, cancel...) with a busy flag and error capture. */
export function useAction(fn) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const fnRef = useRef(fn)
  useEffect(() => {
    fnRef.current = fn
  })
  const run = useCallback(async (...args) => {
    setBusy(true)
    setError(null)
    try {
      return await fnRef.current(...args)
    } catch (e) {
      setError(e)
      throw e
    } finally {
      setBusy(false)
    }
  }, [])
  return { run, busy, error, setError }
}
