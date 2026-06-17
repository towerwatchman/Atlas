import { useState, useCallback } from 'react'
import { formatPercent } from '../utils/formatPercent.js'

export function useAppUpdate(setDbUpdateStatus) {
  const [appUpdateNotice, setAppUpdateNotice] = useState({
    visible: false,
    status: '',
    version: '',
    text: '',
  })
  const [appUpdateActionBusy, setAppUpdateActionBusy] = useState(false)

  const handleUpdateStatus = useCallback(
    (status) => {
      console.log('Update status:', status)
      if (status.status === 'available') {
        setAppUpdateActionBusy(false)
        setAppUpdateNotice({
          visible: true,
          status: 'available',
          version: status.version || '',
          text: `Atlas ${status.version} is available.`,
        })
      } else if (status.status === 'downloading') {
        const percent = Number(status.percent || 0)
        const displayPercent = formatPercent(percent)
        setAppUpdateActionBusy(true)
        setDbUpdateStatus({
          text: `Downloading update: ${displayPercent}`,
          progress: percent,
          total: 100,
        })
        setAppUpdateNotice((notice) => ({
          ...notice,
          visible: true,
          status: 'downloading',
          text: status.percent !== undefined && status.percent !== null
            ? `Downloading Atlas update: ${displayPercent}`
            : 'Downloading Atlas update...',
        }))
      } else if (status.status === 'downloaded') {
        setAppUpdateActionBusy(false)
        setAppUpdateNotice({
          visible: true,
          status: 'downloaded',
          version: status.version || '',
          text: `Atlas ${status.version} is ready to install.`,
        })
      } else if (status.status === 'error') {
        setAppUpdateActionBusy(false)
        console.error('Update error:', status.error)
        setAppUpdateNotice((notice) => ({
          ...notice,
          visible: notice.visible,
          text: status.error || 'Update failed.',
        }))
      }
    },
    [setDbUpdateStatus]
  )

  const handleAppUpdateAction = useCallback(async () => {
    if (appUpdateActionBusy) return
    try {
      setAppUpdateActionBusy(true)
      if (
        appUpdateNotice.status === 'available' ||
        appUpdateNotice.status === 'downloaded'
      ) {
        const result = await window.electronAPI.downloadAndInstallAppUpdate()
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to update Atlas')
        }
        if (appUpdateNotice.status === 'available') {
          setAppUpdateNotice((notice) => ({
            ...notice,
            status: 'downloading',
            text: notice.version
              ? `Downloading Atlas ${notice.version}...`
              : 'Downloading update...',
          }))
        }
      }
    } catch (error) {
      console.error('App update action failed:', error)
      setAppUpdateNotice((notice) => ({
        ...notice,
        text: error.message || 'App update failed.',
      }))
    } finally {
      setAppUpdateActionBusy(false)
    }
  }, [appUpdateActionBusy, appUpdateNotice.status])

  return {
    appUpdateNotice,
    setAppUpdateNotice,
    appUpdateActionBusy,
    handleUpdateStatus,
    handleAppUpdateAction,
  }
}
