import { useEffect, useState, useCallback } from 'react'
import { useBlockNumber } from 'wagmi'
import {
  createPublicClient,
  http,
  custom,
  parseAbiItem,
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

// Max blocks per eth_getLogs call (respected by Alchemy, PublicNode, etc.)
const CHUNK = 50_000n
// How many blocks to fetch per "page" (~1 month on Arbitrum at ~250ms/block)
const PAGE_WINDOW = 10_000_000n

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
// RPC client list — Alchemy first, wallet + public nodes as fallback
// ---------------------------------------------------------------------------

function buildClients(): PublicClient[] {
  const clients: PublicClient[] = []
  const rpcUrl = import.meta.env.VITE_RPC_URL as string | undefined
  if (rpcUrl) {
    clients.push(createPublicClient({ chain: arbitrum, transport: http(rpcUrl) }))
  }
  if (typeof window !== 'undefined' && window.ethereum) {
    clients.push(createPublicClient({ chain: arbitrum, transport: custom(window.ethereum) }))
  }
  clients.push(
    createPublicClient({ chain: arbitrum, transport: http('https://arbitrum.llamarpc.com') }),
    createPublicClient({ chain: arbitrum, transport: http('https://arbitrum-one.publicnode.com') }),
  )
  return clients
}

// ---------------------------------------------------------------------------
// Chunked getLogs — stays within the 50k-block limit every provider enforces
// ---------------------------------------------------------------------------

async function fetchLogs(
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ProposalCreatedLog[]> {
  const clients = buildClients()
  let lastError: unknown

  for (const client of clients) {
    try {
      const chunks: Array<{ from: bigint; to: bigint }> = []
      for (let f = fromBlock; f <= toBlock; f += CHUNK + 1n) {
        chunks.push({ from: f, to: f + CHUNK > toBlock ? toBlock : f + CHUNK })
      }

      const all: ProposalCreatedLog[] = []
      for (let i = 0; i < chunks.length; i += 20) {
        const results = await Promise.all(
          chunks.slice(i, i + 20).map(({ from, to }) =>
            client.getLogs({ address, event: PROPOSAL_CREATED, fromBlock: from, toBlock: to }),
          ),
        )
        all.push(...(results.flat() as unknown as ProposalCreatedLog[]))
      }
      return all
    } catch (e) {
      lastError = e
    }
  }

  throw lastError ?? new Error('All RPC endpoints failed')
}

// ---------------------------------------------------------------------------
// Helpers
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

async function fetchPage(fromBlock: bigint, toBlock: bigint): Promise<Proposal[]> {
  const [coreLogs, treasuryLogs] = await Promise.all([
    fetchLogs(CORE_GOVERNOR, fromBlock, toBlock),
    fetchLogs(TREASURY_GOVERNOR, fromBlock, toBlock),
  ])
  return [
    ...parse(coreLogs, 'core', CORE_GOVERNOR),
    ...parse(treasuryLogs, 'treasury', TREASURY_GOVERNOR),
  ]
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oldestBlock, setOldestBlock] = useState<bigint | null>(null)

  const { data: currentBlock } = useBlockNumber()

  useEffect(() => {
    if (!currentBlock) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const toBlock = currentBlock!
        const fromBlock =
          toBlock > GOVERNANCE_START_BLOCK + PAGE_WINDOW
            ? toBlock - PAGE_WINDOW
            : GOVERNANCE_START_BLOCK

        const fetched = await fetchPage(fromBlock, toBlock)
        if (cancelled) return

        fetched.sort((a, b) => Number(b.startBlock - a.startBlock))
        setProposals(fetched)
        setOldestBlock(fromBlock)
        setHasMore(fromBlock > GOVERNANCE_START_BLOCK)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load proposals')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [currentBlock])

  const loadMore = useCallback(async () => {
    if (!oldestBlock || loadingMore || oldestBlock <= GOVERNANCE_START_BLOCK) return

    setLoadingMore(true)
    setError(null)

    try {
      const toBlock = oldestBlock - 1n
      const fromBlock =
        toBlock > GOVERNANCE_START_BLOCK + PAGE_WINDOW
          ? toBlock - PAGE_WINDOW
          : GOVERNANCE_START_BLOCK

      const fetched = await fetchPage(fromBlock, toBlock)

      setProposals((prev) => {
        const seen = new Set(prev.map((p) => p.proposalId))
        const merged = [...prev, ...fetched.filter((p) => !seen.has(p.proposalId))]
        merged.sort((a, b) => Number(b.startBlock - a.startBlock))
        return merged
      })
      setOldestBlock(fromBlock)
      setHasMore(fromBlock > GOVERNANCE_START_BLOCK)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load older proposals')
    } finally {
      setLoadingMore(false)
    }
  }, [oldestBlock, loadingMore])

  return { proposals, loading, loadingMore, hasMore, error, loadMore }
}
