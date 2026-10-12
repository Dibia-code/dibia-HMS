import { useCallback, useEffect, useRef, useState } from 'react'
import { dataBus } from '@/data/repository'

// Reactive read for the local-first store. Runs `queryFn` on mount and whenever
// `deps` change, and re-runs when the repository emits a 'change' (so lists
// reflect writes immediately). Returns { data, loading, error, reload }.
//
//   const { data: products, loading } = useLiveQuery(() => repo.list('products'), [repo])
export function useLiveQuery(queryFn, deps = [], { watch = true } = {}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const fnRef = useRef(queryFn)
  fnRef.current = queryFn

  const run = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fnRef.current()
      setData(result)
      setError(null)
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => {
    run()
  }, [run])

  useEffect(() => {
    if (!watch) return undefined
    const onChange = () => run()
    dataBus.addEventListener('change', onChange)
    return () => dataBus.removeEventListener('change', onChange)
  }, [run, watch])

  return { data, loading, error, reload: run }
}
