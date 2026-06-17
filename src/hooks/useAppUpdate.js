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

  const getFooterActionState = useCallback((status) => {
    if (status === 'downloaded') return { label: 'Install and restart', canInstallUpdate: true }
    if (status === 'downloading') return { label: 'Downloading...', canInstallUpdate: false }
    if (status === 'checking') return { label: 'Checking...', canInstallUpdate: false }
    if (['error', 'package_not_ready', 'not-available'].includes(status)) {
      return { label: 'Check for updates', canInstallUpdate: false }
    }
    return { label: 'Download update', canInstallUpdate: false }
  }, [])

  const logFooterTransition = useCallback((previousStatus, nextStatus, source) => {
    const actionState = getFooterActionState(nextStatus)
    console.log(
      `update-state: ${previousStatus || 'idle'} -> ${nextStatus || 'idle'} via ${source}; ` +
      `footerAction=${actionState.label}; canInstallUpdate=${actionState.canInstallUpdate}`,
    )
  }, [getFooterActionState])

  const handleUpdateStatus = useCallback(
    (status) => {
      console.log('Update status:', status)
      if (status.status === 'available') {
        setAppUpdateActionBusy(false)
        setAppUpdateNotice((notice) => {
          logFooterTransition(notice.status, 'available', 'update-status')
          return {
          visible: true,
          status: 'available',
          version: status.version || '',
          text: sanitizePercentText(`Atlas ${status.version} is available.`),
          percent: null,
          }
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
        setAppUpdateNotice((notice) => {
          logFooterTransition(notice.status, 'downloading', 'update-status')
          return {
            ...notice,
            visible: true,
            status: 'downloading',
            version: status.version || notice.version || '',
            percent,
            text: status.version
              ? `Downloading Atlas ${status.version}: ${displayPercent}`
              : status.percent !== undefined && status.percent !== null
                ? `Downloading Atlas update: ${displayPercent}`
                : 'Downloading Atlas update...',
          }
        })
      } else if (status.status === 'downloaded') {
        setAppUpdateActionBusy(false)
        setDbUpdateStatus({ text: '', progress: 0, total: 0 })
        setAppUpdateNotice((notice) => {
          const version = status.version || notice.version || ''
          logFooterTransition(notice.status, 'downloaded', 'update-status')
          return {
            visible: true,
            status: 'downloaded',
            version,
            text: sanitizePercentText(`Atlas ${version || 'update'} is ready to install.`),
            percent: null,
          }
        })
      } else if (status.status === 'error') {
        setAppUpdateActionBusy(false)
        console.error('Update error:', status.error)
        setAppUpdateNotice((notice) => {
          const nextStatus = status.code === PACKAGE_NOT_READY_CODE ? 'package_not_ready' : 'error'
          logFooterTransition(notice.status, nextStatus, 'update-status')
          return {
            visible: true,
            status: nextStatus,
            code: status.code || '',
            version: '',
            text: sanitizePercentText(status.error || 'Update failed.'),
            percent: null,
          }
        })
      }
    },
    [logFooterTransition, setDbUpdateStatus]
  )

  const reconcileAppUpdateState = useCallback(async (source) => {
    const status = await window.electronAPI.getAppUpdateState?.()
    if (status?.status && status.status !== 'idle') {
      handleUpdateStatus(status)
      return status
    }
    return null
  }, [handleUpdateStatus])

  const handleAppUpdateAction = useCallback(async () => {
    if (appUpdateActionBusy) return
    try {
      setAppUpdateActionBusy(true)
      const latestStatus = await reconcileAppUpdateState('footer-action')
      const effectiveStatus = latestStatus?.status === 'downloaded'
        ? 'downloaded'
        : appUpdateNotice.status
      if (
        effectiveStatus === 'error' ||
        effectiveStatus === 'package_not_ready' ||
        effectiveStatus === 'not-available'
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

      if (effectiveStatus === 'downloaded') {
        const result = await window.electronAPI.installAppUpdate()
        if (!result?.success) {
          throw new Error(result?.error || 'Failed to update Atlas')
        }
        return
      }

      if (effectiveStatus === 'available') {
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
        await reconcileAppUpdateState('download-complete')
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
  }, [appUpdateActionBusy, appUpdateNotice.status, reconcileAppUpdateState])

  return {
    appUpdateNotice,
    setAppUpdateNotice,
    appUpdateActionBusy,
    handleUpdateStatus,
    handleAppUpdateAction,
  }
}
