'use strict'

const PACKAGE_NOT_READY_MESSAGE =
  'Update package is not ready yet. The release exists, but the downloadable update files have not finished building/uploading. Please try again in a few minutes.'

const NETWORK_ERROR_MESSAGE =
  'Could not check for updates. Please check your internet connection and try again.'

const GENERIC_UPDATE_ERROR_MESSAGE =
  'Could not check for updates right now. Please try again later.'

function getErrorText(error) {
  return [
    error?.message,
    error?.stack,
    error?.url,
    error?.requestUrl,
    error?.response?.url,
    error?.response?.status,
    error?.statusCode,
    error?.code,
  ]
    .filter((value) => value !== undefined && value !== null)
    .map(String)
    .join('\n')
}

function normalizeUpdateError(error) {
  const technicalMessage = getErrorText(error) || String(error || '')
  const lower = technicalMessage.toLowerCase()
  const statusCode = Number(error?.statusCode || error?.status || error?.response?.status || 0)

  if (
    statusCode === 404 ||
    lower.includes('latest.yml') ||
    lower.includes('cannot find latest.yml') ||
    (lower.includes('/releases/download/') && lower.includes('404')) ||
    lower.includes('missing release artifact') ||
    lower.includes('missing update metadata')
  ) {
    return {
      code: 'UPDATE_PACKAGE_NOT_READY',
      retryable: true,
      userMessage: PACKAGE_NOT_READY_MESSAGE,
      technicalMessage,
    }
  }

  if (
    ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(String(error?.code || '')) ||
    lower.includes('net::') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('getaddrinfo') ||
    lower.includes('connect econn')
  ) {
    return {
      code: 'UPDATE_NETWORK_ERROR',
      retryable: true,
      userMessage: NETWORK_ERROR_MESSAGE,
      technicalMessage,
    }
  }

  return {
    code: 'UPDATE_CHECK_FAILED',
    retryable: true,
    userMessage: GENERIC_UPDATE_ERROR_MESSAGE,
    technicalMessage,
  }
}

module.exports = {
  normalizeUpdateError,
  PACKAGE_NOT_READY_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  GENERIC_UPDATE_ERROR_MESSAGE,
}
