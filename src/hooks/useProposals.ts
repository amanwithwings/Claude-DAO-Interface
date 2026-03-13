import { useEffect, useState } from 'react'
import { useBlockNumber } from 'wagmi'
import {
  createPublicClient,
  http,
  custom,
  parseAbiItem,
  decodeEventLog,
  toEventHash,
  type PublicClient,
} from 'viem'
import { arbitrum } from 'wagmi/chains'
import {
  CORE_GOVERNOR,
  TREASURY_GOVERNOR,
  GOVERNANCE_START_BLOCK,
} from '../config/contracts'
import { parseTitle } from '../utils'

export interface Proposal {
  proposalId: bigint
  proposer: `0x${string}`
  title: string
  description: string
  startBlock: bigint
  endBlock: bigint
  governor: 'core' | 'treasury'
  governorAddress: `0x${string}`
}

const PROPOSAL_CREATED = parseAbiItem(
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
)

// keccak256 of the ProposalCreated event signature
const PROPOSAL_CREATED_TOPIC = toEventHash(PROPOSAL_CREATED)

// ~40 days of blocks at Arbitrum's ~250ms block time
const RECENT_BLOCKS = 14_000_000n

type ProposalCreatedLog = {
  args: {
    proposalId: bigint
    proposer: `0x${string}`
    description: string
    startBlock: bigint
    endBlock: bigint
  }
}

// ---------------------------------------------------------------------------
// Arbiscan API — for historical proposals (settled, > 40 days old)
// ---------------------------------------------------------------------------

type ArbiscanRawLog = {
  address: string
  topics: string[]
  data: string
  blockNumber: string
}

async function fetchFromArbiscan(
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ProposalCreatedLog[]> {
  const apiKey = (import.meta.env.VITE_ARBISCAN_API_KEY as string | undefined) ?? ''
  const url = new URL('https://api.arbiscan.io/api')
  url.searchParams.set('module', 'logs')
  url.searchParams.set('action', 'getLogs')
  url.searchParams.set('address', address)
  url.searchParams.set('topic0', PROPOSAL_CREATED_TOPIC)
  url.searchParams.set('fromBlock', fromBlock.toString())
  url.searchParams.set('toBlock', toBlock.toString())
  url.searchParams.set('page', '1')
  url.searchParams.set('offset', '1000') // ArbitrumDAO has well under 1000 proposals
  if (apiKey) url.searchParams.set('apikey', apiKey)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Arbiscan HTTP ${res.status}`)

  const json = (await res.json()) as { status: string; message: string; result: ArbiscanRawLog[] | string }

  // status "0" with message "No records found" is valid empty result
  if (json.status === '0') {
    if (typeof json.result === 'string' && json.result.toLowerCase().includes('no records')) {
      return []
    }
    throw new Error(`Arbiscan error: ${json.message}`)
  }
  if (!Array.isArray(json.result)) return []

  return (json.result as ArbiscanRawLog[]).flatMap((raw) => {
    try {
      const decoded = decodeEventLog({
        abi: [PROPOSAL_CREATED],
        data: raw.data as `0x${string}`,
        topics: raw.topics as [`0x${string}`, ...`0x${string}`[]],
      })
      return [{ args: decoded.args as ProposalCreatedLog['args'] }]
    } catch {
      return []
    }
  })
}

// ---------------------------------------------------------------------------
// RPC getLogs — for recent proposals (active / just-settled, < 40 days)
// ---------------------------------------------------------------------------

function buildClients(): PublicClient[] {
  const clients: PublicClient[] = []
  if (typeof window !== 'undefined' && window.ethereum) {
    clients.push(createPublicClient({ chain: arbitrum, transport: custom(window.ethereum) }))
  }
  const customRpc = import.meta.env.VITE_RPC_URL as string | undefined
  if (customRpc) {
    clients.push(createPublicClient({ chain: arbitrum, transport: http(customRpc) }))
  }
  clients.push(
    createPublicClient({ chain: arbitrum, transport: http('https://arbitrum.llamarpc.com') }),
    createPublicClient({ chain: arbitrum, transport: http('https://arbitrum-one.publicnode.com') }),
  )
  return clients
}

async function fetchFromRpc(
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ProposalCreatedLog[]> {
  const clients = buildClients()
  let lastError: unknown

  for (const client of clients) {
    try {
      // Try full range first; chunk if rejected
      let logs
      try {
        logs = await client.getLogs({ address, event: PROPOSAL_CREATED, fromBlock, toBlock })
      } catch {
        // Chunk into 2M-block slices, 20 concurrent
        const CHUNK = 2_000_000n
        const chunks: Array<{ from: bigint; to: bigint }> = []
        for (let f = fromBlock; f <= toBlock; f += CHUNK + 1n) {
          chunks.push({ from: f, to: f + CHUNK > toBlock ? toBlock : f + CHUNK })
        }
        const all: (typeof logs) = []
        for (let i = 0; i < chunks.length; i += 20) {
          const results = await Promise.all(
            chunks.slice(i, i + 20).map(({ from, to }) =>
              client.getLogs({ address, event: PROPOSAL_CREATED, fromBlock: from, toBlock: to }),
            ),
          )
          all!.push(...results.flat())
        }
        logs = all
      }
      return logs as unknown as ProposalCreatedLog[]
    } catch (e) {
      lastError = e
    }
  }

  throw lastError ?? new Error('All RPC endpoints failed')
}

// ---------------------------------------------------------------------------
// Merge helpers
// ---------------------------------------------------------------------------

function parse(
  logs: ProposalCreatedLog[],
  governor: 'core' | 'treasury',
  governorAddress: `0x${string}`,
): Proposal[] {
  return logs
    .filter((l) => l.args.proposalId !== undefined)
    .map((l) => ({
      proposalId: l.args.proposalId,
      proposer: l.args.proposer,
      title: parseTitle(l.args.description ?? ''),
      description: l.args.description ?? '',
      startBlock: l.args.startBlock,
      endBlock: l.args.endBlock,
      governor,
      governorAddress,
    }))
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: currentBlock } = useBlockNumber()

  useEffect(() => {
    if (!currentBlock) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const toBlock = currentBlock!
        // Split: Arbiscan handles settled history; RPC handles the active window
        const recentFrom =
          toBlock > GOVERNANCE_START_BLOCK + RECENT_BLOCKS
            ? toBlock - RECENT_BLOCKS
            : GOVERNANCE_START_BLOCK

        // Fetch historical (Arbiscan) and recent (RPC) in parallel for each governor
        const [coreHist, treasuryHist, coreRecent, treasuryRecent] = await Promise.all([
          recentFrom > GOVERNANCE_START_BLOCK
            ? fetchFromArbiscan(CORE_GOVERNOR, GOVERNANCE_START_BLOCK, recentFrom - 1n)
            : Promise.resolve([]),
          recentFrom > GOVERNANCE_START_BLOCK
            ? fetchFromArbiscan(TREASURY_GOVERNOR, GOVERNANCE_START_BLOCK, recentFrom - 1n)
            : Promise.resolve([]),
          fetchFromRpc(CORE_GOVERNOR, recentFrom, toBlock),
          fetchFromRpc(TREASURY_GOVERNOR, recentFrom, toBlock),
        ])

        if (cancelled) return

        // Merge + dedup by proposalId (Arbiscan and RPC windows shouldn't overlap,
        // but being safe avoids any duplicate if a proposal falls on the boundary)
        const seen = new Set<bigint>()
        const all: Proposal[] = []
        for (const p of [
          ...parse(coreHist, 'core', CORE_GOVERNOR),
          ...parse(coreRecent, 'core', CORE_GOVERNOR),
          ...parse(treasuryHist, 'treasury', TREASURY_GOVERNOR),
          ...parse(treasuryRecent, 'treasury', TREASURY_GOVERNOR),
        ]) {
          if (!seen.has(p.proposalId)) {
            seen.add(p.proposalId)
            all.push(p)
          }
        }

        all.sort((a, b) => Number(b.startBlock - a.startBlock))
        setProposals(all)
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Failed to load proposals')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [currentBlock])

  return { proposals, loading, error }
}
