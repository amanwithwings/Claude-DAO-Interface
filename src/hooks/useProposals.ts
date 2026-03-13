import { useEffect, useState } from 'react'
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
// RPC getLogs via Alchemy
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

async function fetchLogs(
  address: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ProposalCreatedLog[]> {
  const clients = buildClients()
  let lastError: unknown

  for (const client of clients) {
    try {
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

        const [coreLogs, treasuryLogs] = await Promise.all([
          fetchLogs(CORE_GOVERNOR, GOVERNANCE_START_BLOCK, toBlock),
          fetchLogs(TREASURY_GOVERNOR, GOVERNANCE_START_BLOCK, toBlock),
        ])

        if (cancelled) return

        const all: Proposal[] = [
          ...parse(coreLogs, 'core', CORE_GOVERNOR),
          ...parse(treasuryLogs, 'treasury', TREASURY_GOVERNOR),
        ]

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
