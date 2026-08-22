import { LINKS } from '../components/ui/AboutModal.jsx'

// Builds the GitHub release URL for a specific app version
export function releaseUrlFor(version) {
  return `${LINKS.github}/releases/tag/v${version}`
}
