import { useEffect, useState } from 'react'
import { useBlockNumber } from 'wagmi'
import { createPublicClient, http, custom, parseAbiItem, type PublicClient } from 'viem'
import { arbitrum } from 'wagmi/chains'
import { CORE_GOVERNOR, TREASURY_GOVERNOR, GOVERNANCE_START_BLOCK } from '../config/contracts'
import { parseTitle } from '../utils'
import staticData from '../data/proposals.json'

export interface Proposal {
  proposalId: bigint
  proposer: `0x${string}`
  title: string
  description: string
  startBlock: bigint
  endBlock: bigint
  /** Unix seconds — when voting opens. Stored by fetchProposals.mjs via getBlock(startBlock). */
  startTimestamp: number | null
  /** Unix seconds — when voting closes. Stored by fetchProposals.mjs via getBlock(endBlock). */
  endTimestamp: number | null
  governor: 'core' | 'treasury'
  governorAddress: `0x${string}`
}

const PROPOSAL_CREATED = parseAbiItem(
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
)

// Max blocks per eth_getLogs call respected by all providers
const CHUNK = 50_000n
// Live window: last ~2 weeks on Arbitrum (~250ms/block)
const RECENT_BLOCKS = 5_000_000n

// ---------------------------------------------------------------------------
// Static historical proposals bundled with the app
// ---------------------------------------------------------------------------

const STATIC_CUTOFF = BigInt(staticData.cutoffBlock)

type StaticProposal = {
  proposalId: string; proposer: string; title: string; description: string
  startBlock: string; endBlock: string; governor: string; governorAddress: string
  startTimestamp?: number | null; endTimestamp?: number | null
}

const STATIC_PROPOSALS: Proposal[] = (staticData.proposals as StaticProposal[]).map((p) => ({
  proposalId: BigInt(p.proposalId),
  proposer: p.proposer as `0x${string}`,
  title: p.title,
  description: p.description,
  startBlock: BigInt(p.startBlock),
  endBlock: BigInt(p.endBlock),
  startTimestamp: p.startTimestamp ?? null,
  endTimestamp: p.endTimestamp ?? null,
  governor: p.governor as 'core' | 'treasury',
  governorAddress: p.governorAddress as `0x${string}`,
}))

// ---------------------------------------------------------------------------
// RPC — only used for the recent live window
// ---------------------------------------------------------------------------

function buildClients(): PublicClient[] {
  const clients: PublicClient[] = []
  const rpcUrl = import.meta.env.VITE_RPC_URL as string | undefined
  if (rpcUrl) clients.push(createPublicClient({ chain: arbitrum, transport: http(rpcUrl) }))
  if (typeof window !== 'undefined' && window.ethereum)
    clients.push(createPublicClient({ chain: arbitrum, transport: custom(window.ethereum) }))
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
): Promise<Proposal[]> {
  const clients = buildClients()
  let lastError: unknown

  for (const client of clients) {
    try {
      const chunks: { from: bigint; to: bigint }[] = []
      for (let f = fromBlock; f <= toBlock; f += CHUNK + 1n)
        chunks.push({ from: f, to: f + CHUNK > toBlock ? toBlock : f + CHUNK })

      const all: Proposal[] = []
      for (let i = 0; i < chunks.length; i += 20) {
        const results = await Promise.all(
          chunks.slice(i, i + 20).map(({ from, to }) =>
            client.getLogs({ address, event: PROPOSAL_CREATED, fromBlock: from, toBlock: to }),
          ),
        )
        for (const log of results.flat()) {
          const { proposalId, proposer, description, startBlock, endBlock } = log.args as {
            proposalId: bigint
            proposer: `0x${string}`
            description: string
            startBlock: bigint
            endBlock: bigint
          }
          if (proposalId === undefined) continue
          all.push({
            proposalId,
            proposer,
            title: parseTitle(description ?? ''),
            description: description ?? '',
            startBlock,
            endBlock,
            startTimestamp: null,
            endTimestamp: null,
            governor: address === CORE_GOVERNOR ? 'core' : 'treasury',
            governorAddress: address,
          })
        }
      }
      return all
    } catch (e) {
      lastError = e
    }
  }

  throw lastError ?? new Error('All RPC endpoints failed')
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useProposals() {
  // Static data renders immediately — no spinner needed for it
  const [proposals, setProposals] = useState<Proposal[]>(STATIC_PROPOSALS)
  const [refreshing, setRefreshing] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: currentBlock } = useBlockNumber()

  useEffect(() => {
    if (!currentBlock) return

    let cancelled = false

    async function fetchLive() {
      setRefreshing(true)
      setError(null)

      try {
        const liveFrom =
          STATIC_CUTOFF > 0n
            ? STATIC_CUTOFF + 1n
            : currentBlock! > GOVERNANCE_START_BLOCK + RECENT_BLOCKS
            ? currentBlock! - RECENT_BLOCKS
            : GOVERNANCE_START_BLOCK

        const [coreLive, treasuryLive] = await Promise.all([
          fetchLogs(CORE_GOVERNOR, liveFrom, currentBlock!),
          fetchLogs(TREASURY_GOVERNOR, liveFrom, currentBlock!),
        ])

        if (cancelled) return

        const seen = new Set<bigint>()
        const merged: Proposal[] = []
        for (const p of [...coreLive, ...treasuryLive, ...STATIC_PROPOSALS]) {
          if (!seen.has(p.proposalId)) {
            seen.add(p.proposalId)
            merged.push(p)
          }
        }
        merged.sort((a, b) => Number(b.startBlock - a.startBlock))
        setProposals(merged)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to fetch live proposals')
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    }

    fetchLive()
    return () => { cancelled = true }
  }, [currentBlock])

  return { proposals, refreshing, error }
}
