'use strict'

const PACKAGE_NOT_READY_MESSAGE =
  'Update package is not ready yet. The release exists, but the downloadable update files have not finished building/uploading. Please try again in a few minutes.'

const NO_RELEASE_ON_CHANNEL_MESSAGE =
  'No update is published on this channel yet. You are on the latest available build for this branch.'

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

  const is404 = statusCode === 404 || (lower.includes('404') && lower.includes('not found'))
  // A 404 (or "cannot find") on the CHANNEL MANIFEST (latest.yml / nightly.yml
  // / beta.yml) means no release has been published on that channel yet. This
  // is a normal, expected state — most commonly right after switching to a
  // channel that has no build, or on the very first nightly. It must NOT be
  // reported as "package not ready" (which implies a release exists but its
  // binaries are still uploading) and must NOT be a scary generic failure.
  const mentionsManifest =
    lower.includes('latest.yml') ||
    lower.includes('nightly.yml') ||
    lower.includes('beta.yml') ||
    lower.includes('missing update metadata')
  // A 404 on a DOWNLOAD asset means the release exists but the installer files
  // are not uploaded yet — this is the true "package not ready" case.
  const mentionsDownloadAsset =
    lower.includes('/releases/download/') ||
    lower.includes('missing release artifact')

  if ((is404 || lower.includes('cannot find')) && mentionsManifest && !mentionsDownloadAsset) {
    return {
      code: 'UPDATE_NO_RELEASE_ON_CHANNEL',
      retryable: false,
      userMessage: NO_RELEASE_ON_CHANNEL_MESSAGE,
      technicalMessage,
    }
  }

  if (mentionsDownloadAsset && is404) {
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
  NO_RELEASE_ON_CHANNEL_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  GENERIC_UPDATE_ERROR_MESSAGE,
}
