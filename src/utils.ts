/** Format a wei amount as a human-readable ARB string (e.g. "1.23M") */
export function formatARB(wei: bigint): string {
  const n = Number(wei) / 1e18
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`
  return n.toFixed(2)
}

/** Shorten an Ethereum address: 0x1234...abcd */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

/**
 * Estimate time remaining given blocks left at Arbitrum's ~250ms block time.
 * Returns a string like "~3d 4h" or "Ended".
 */
export function blocksToTime(blocksLeft: number): string {
  if (blocksLeft <= 0) return 'Ended'
  const seconds = blocksLeft * 0.25
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `~${days}d ${hours}h`
  if (hours > 0) return `~${hours}h ${minutes}m`
  return `~${minutes}m`
}

/**
 * Estimate time remaining until an L1 Ethereum block deadline.
 * Uses genesis timestamp + 12s/block to convert without an L1 RPC call.
 * Returns a string like "~3d 4h", "~45m", or "Ended".
 */
const ETHEREUM_GENESIS_TS = 1438269988 // Unix seconds (Jul 30 2015)
const L1_BLOCK_TIME = 12 // seconds per block
export function l1BlockToTime(l1Deadline: bigint): string {
  const deadlineTs = ETHEREUM_GENESIS_TS + Number(l1Deadline) * L1_BLOCK_TIME
  const remaining = deadlineTs - Date.now() / 1000
  if (remaining <= 0) return 'Ended'
  const days = Math.floor(remaining / 86400)
  const hours = Math.floor((remaining % 86400) / 3600)
  const minutes = Math.floor((remaining % 3600) / 60)
  if (days > 0) return `~${days}d ${hours}h`
  if (hours > 0) return `~${hours}h ${minutes}m`
  return `~${minutes}m`
}

/** Extract a human-readable title from a proposal description.
 *  Convention: first line is "# AIP-X: Title" or just "# Title".
 */
export function parseTitle(description: string): string {
  const firstLine = description.split('\n')[0].trim()
  return firstLine.replace(/^#+\s*/, '') || 'Untitled Proposal'
}
