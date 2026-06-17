import { useState, useCallback } from 'react'
import { formatPercent, sanitizePercentText } from '../utils/formatPercent.js'

const PACKAGE_NOT_READY_CODE = 'UPDATE_PACKAGE_NOT_READY'

export function useAppUpdate(setDbUpdateStatus) {
  const [appUpdateNotice, setAppUpdateNotice] = useState({
    visible: false,
    status: '',
    version: '',
    text: '',
    percent: null,
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
          text: sanitizePercentText(`Atlas ${status.version} is available.`),
          percent: null,
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
          percent,
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
          text: sanitizePercentText(`Atlas ${status.version} is ready to install.`),
          percent: null,
        })
      } else if (status.status === 'error') {
        setAppUpdateActionBusy(false)
        console.error('Update error:', status.error)
        setAppUpdateNotice({
          visible: true,
          status: status.code === PACKAGE_NOT_READY_CODE ? 'package_not_ready' : 'error',
          code: status.code || '',
          version: '',
          text: sanitizePercentText(status.error || 'Update failed.'),
          percent: null,
        })
      }
    },
    [setDbUpdateStatus]
  )

  const handleAppUpdateAction = useCallback(async () => {
    if (appUpdateActionBusy) return
    try {
      setAppUpdateActionBusy(true)
      if (
        appUpdateNotice.status === 'error' ||
        appUpdateNotice.status === 'package_not_ready' ||
        appUpdateNotice.status === 'not-available'
      ) {
        setAppUpdateNotice((notice) => ({
          ...notice,
          status: 'checking',
          code: '',
          text: 'Checking for updates...',
          percent: null,
        }))
        const result = await window.electronAPI.checkAppUpdate()
        if (!result?.success) {
          if (result?.code === PACKAGE_NOT_READY_CODE) {
            setAppUpdateNotice({
              visible: true,
              status: 'package_not_ready',
              code: result.code,
              version: '',
              text: sanitizePercentText(result.error || 'Update package is not ready yet. Please try again in a few minutes.'),
              percent: null,
            })
            return
          }
          throw new Error(result?.error || 'Failed to check for updates')
        }
        return
      }

      if (appUpdateNotice.status === 'downloaded') {
        const result = await window.electronAPI.installAppUpdate()
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to update Atlas')
        }
        return
      }

      if (appUpdateNotice.status === 'available') {
        const result = await window.electronAPI.downloadAppUpdate()
        if (!result?.success) {
          if (result?.code === PACKAGE_NOT_READY_CODE) {
            setAppUpdateNotice({
              visible: true,
              status: 'package_not_ready',
              code: result.code,
              version: '',
              text: sanitizePercentText(result.error || 'Update package is not ready yet. Please try again in a few minutes.'),
              percent: null,
            })
            return
          }
          throw new Error(result?.error || 'Failed to update Atlas')
        }
        setAppUpdateNotice((notice) => ({
          ...notice,
          status: 'downloading',
          code: '',
          percent: null,
          text: notice.version
            ? `Downloading Atlas ${notice.version}...`
            : 'Downloading update...',
        }))
      }
    } catch (error) {
      console.error('App update action failed:', error)
      setAppUpdateNotice({
        visible: true,
        status: 'error',
        code: '',
        version: '',
        text: sanitizePercentText(error.message || 'App update failed.'),
        percent: null,
      })
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
