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
  // electron-updater tags its errors with a stable `code` (e.g.
  // ERR_UPDATER_LATEST_VERSION_NOT_FOUND). Prefer these over fragile message
  // substring matching; fall back to message text for wrapped/rethrown errors.
  const updaterCode = String(error?.code || '').toUpperCase()

  const is404 = statusCode === 404 || (lower.includes('404') && lower.includes('not found'))

  // No release published for this channel yet. In v6 this surfaces as one of:
  //  - ERR_UPDATER_LATEST_VERSION_NOT_FOUND: GitHub /releases/latest 404s. This
  //    is EXPECTED when the repo has only prereleases (GitHub excludes them from
  //    "latest"), or before any stable release exists. The message reads
  //    "please ensure a production release exists".
  //  - ERR_UPDATER_NO_PUBLISHED_VERSIONS: the atom feed had no usable release.
  //  - ERR_UPDATER_CHANNEL_FILE_NOT_FOUND: the channel manifest (latest.yml /
  //    nightly.yml) is missing from the resolved release.
  // None of these mean something is broken — they mean "nothing to update to on
  // this channel", so we present a calm, non-retryable notice.
  const NO_RELEASE_CODES = new Set([
    'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
    'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
    'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  ])
  const mentionsManifest =
    lower.includes('latest.yml') ||
    lower.includes('nightly.yml') ||
    lower.includes('beta.yml') ||
    lower.includes('channel file') ||
    lower.includes('no published versions') ||
    lower.includes('production release exists') ||
    lower.includes('unable to find latest version') ||
    lower.includes('missing update metadata')
  const mentionsDownloadAsset =
    lower.includes('/releases/download/') ||
    lower.includes('missing release artifact')

  if (
    NO_RELEASE_CODES.has(updaterCode) ||
    ((is404 || lower.includes('cannot find') || lower.includes('no published')) &&
      mentionsManifest &&
      !mentionsDownloadAsset)
  ) {
    return {
      code: 'UPDATE_NO_RELEASE_ON_CHANNEL',
      retryable: false,
      userMessage: NO_RELEASE_ON_CHANNEL_MESSAGE,
      technicalMessage,
    }
  }

  // Release exists but its installer files are not uploaded yet.
  if (mentionsDownloadAsset && is404) {
    return {
      code: 'UPDATE_PACKAGE_NOT_READY',
      retryable: true,
      userMessage: PACKAGE_NOT_READY_MESSAGE,
      technicalMessage,
    }
  }

  if (
    ['ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(updaterCode) ||
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
