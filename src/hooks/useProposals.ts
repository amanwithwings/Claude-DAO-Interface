import { useEffect, useState } from 'react'
import { useBlockNumber } from 'wagmi'
import { createPublicClient, http, custom, parseAbiItem, type PublicClient } from 'viem'
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

type ProposalCreatedLog = {
  args: {
    proposalId: bigint
    proposer: `0x${string}`
    description: string
    startBlock: bigint
    endBlock: bigint
  }
}

/**
 * Build a prioritised list of viem clients for getLogs.
 *
 * Order of preference:
 *  1. window.ethereum (MetaMask / injected wallet) — uses the wallet's own
 *     Infura/Alchemy backend: no CORS, no auth, wide getLogs support.
 *  2. LlamaRPC — free, no key, CORS-enabled, generally permissive getLogs.
 *  3. PublicNode — free, no key, CORS-enabled, full archive.
 */
function buildClients(): PublicClient[] {
  const clients: PublicClient[] = []

  if (typeof window !== 'undefined' && window.ethereum) {
    clients.push(
      createPublicClient({ chain: arbitrum, transport: custom(window.ethereum) }),
    )
  }

  clients.push(
    createPublicClient({ chain: arbitrum, transport: http('https://arbitrum.llamarpc.com') }),
    createPublicClient({ chain: arbitrum, transport: http('https://arbitrum-one.publicnode.com') }),
  )

  return clients
}

/**
 * Try a single getLogs call on one client with a large range.
 * If the RPC rejects the range, retry with 2 M-block chunks (20 concurrent).
 */
async function fetchFromClient(
  client: PublicClient,
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ProposalCreatedLog[]> {
  // Wide-range attempt
  try {
    const logs = await client.getLogs({
      address,
      event: PROPOSAL_CREATED,
      fromBlock,
      toBlock,
    })
    return logs as unknown as ProposalCreatedLog[]
  } catch {
    /* fall through to chunked */
  }

  // Chunked fallback (2 M blocks, 20 parallel)
  const CHUNK = 2_000_000n
  const CONCURRENCY = 20
  const chunks: Array<{ from: bigint; to: bigint }> = []
  for (let f = fromBlock; f <= toBlock; f += CHUNK + 1n) {
    chunks.push({ from: f, to: f + CHUNK > toBlock ? toBlock : f + CHUNK })
  }

  const all: ProposalCreatedLog[] = []
  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      batch.map(({ from, to }) =>
        client.getLogs({ address, event: PROPOSAL_CREATED, fromBlock: from, toBlock: to }),
      ),
    )
    all.push(...(results.flat() as unknown as ProposalCreatedLog[]))
  }
  return all
}

/**
 * Try each client in order, returning the first successful result.
 * This gives us multi-RPC resilience without depending on any one provider.
 */
async function fetchAddress(
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ProposalCreatedLog[]> {
  const clients = buildClients()
  let lastError: unknown

  for (const client of clients) {
    try {
      return await fetchFromClient(client, address, fromBlock, toBlock)
    } catch (e) {
      lastError = e
    }
  }

  throw lastError ?? new Error('All RPC endpoints failed')
}

function parseLogs(
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

export function useProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // We use blockNumber only to trigger a re-fetch after the initial mount.
  const { data: currentBlock } = useBlockNumber()

  useEffect(() => {
    if (!currentBlock) return

    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      try {
        const toBlock = currentBlock!
        const [coreLogs, treasuryLogs] = await Promise.all([
          fetchAddress(CORE_GOVERNOR, GOVERNANCE_START_BLOCK, toBlock),
          fetchAddress(TREASURY_GOVERNOR, GOVERNANCE_START_BLOCK, toBlock),
        ])

        if (cancelled) return

        const all = [
          ...parseLogs(coreLogs, 'core', CORE_GOVERNOR),
          ...parseLogs(treasuryLogs, 'treasury', TREASURY_GOVERNOR),
        ].sort((a, b) => Number(b.startBlock - a.startBlock))

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
