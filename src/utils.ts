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

/** Format a Unix timestamp (seconds) as a short date like "Mar 15, 2026". */
export function fmtDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

/** Extract a human-readable title from a proposal description.
 *  Scans heading lines; skips empty headings and short AIP-number-only labels.
 */
export function parseTitle(description: string): string {
  const headings: string[] = []
  for (const line of description.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('#')) continue
    const text = trimmed.replace(/^#+\s*/, '').trim()
    if (text) headings.push(text)
    if (headings.length >= 2) break
  }
  if (headings.length === 0) return 'Untitled Proposal'
  // If the first heading is a short label like "AIP 4", prefer the second
  if (headings.length >= 2 && headings[0].length < 20) return headings[1]
  return headings[0]
}
