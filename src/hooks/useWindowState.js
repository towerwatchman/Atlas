import { useState, useCallback } from 'react'

export function useWindowState() {
  const [isMaximized, setIsMaximized] = useState(false)
  const [version, setVersion] = useState('0.0.0')

  const handleWindowStateChanged = useCallback((state) => {
    setIsMaximized(state === 'maximized')
  }, [])

  const loadVersion = useCallback(() => {
    window.electronAPI.getVersion().then((v) => setVersion(v))
  }, [])

  return {
    isMaximized,
    version,
    setVersion,
    handleWindowStateChanged,
    loadVersion,
  }
}
