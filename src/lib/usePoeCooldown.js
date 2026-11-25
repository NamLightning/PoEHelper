import { useEffect, useState } from 'react'
import { currentPoeDeadline, subscribePoeCooldown } from './poeCooldown.js'

export default function usePoeCooldown() {
  const [deadline, setDeadline] = useState(currentPoeDeadline)
  const [now, setNow] = useState(Date.now)
  useEffect(() => subscribePoeCooldown(() => { setDeadline(currentPoeDeadline()); setNow(Date.now()) }), [])
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000))
  useEffect(() => {
    if (!remaining) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [deadline, remaining > 0])
  return remaining
}
