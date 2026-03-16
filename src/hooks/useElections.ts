import { useEffect, useState } from 'react'
import { useBlockNumber } from 'wagmi'
import { createPublicClient, http, custom, parseAbiItem, type PublicClient } from 'viem'
import { arbitrum } from 'wagmi/chains'
import {
  NOMINEE_ELECTION_GOVERNOR,
  MEMBER_ELECTION_GOVERNOR,
  ELECTIONS_START_BLOCK,
} from '../config/contracts'
import { parseTitle } from '../utils'
import staticData from '../data/elections.json'

export interface Election {
  proposalId: bigint
  phase: 'nominee' | 'member'
  electionIndex: number
  governorAddress: `0x${string}`
  title: string
  description: string
  /** L1 Ethereum block — voting window start (as stored in Governor params). NOT for getLogs. */
  startBlock: bigint
  /** L1 Ethereum block — voting window end. NOT for getLogs. */
  endBlock: bigint
  /** L2 Arbitrum block where the ProposalCreated log was emitted. Use this for getLogs ranges. */
  emittedBlock: bigint
}

const PROPOSAL_CREATED = parseAbiItem(
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
)

const CHUNK = 50_000n
const RECENT_BLOCKS = 5_000_000n

// ---------------------------------------------------------------------------
// Static historical elections bundled with the app
// ---------------------------------------------------------------------------

const STATIC_CUTOFF = BigInt(staticData.cutoffBlock)

type StaticElection = {
  proposalId: string; phase: string; electionIndex: number; governorAddress: string
  title: string; description: string; startBlock: string; endBlock: string
  emittedBlock?: string
}

const STATIC_ELECTIONS: Election[] = (staticData.elections as StaticElection[]).map((e) => ({
  proposalId: BigInt(e.proposalId),
  phase: e.phase as 'nominee' | 'member',
  electionIndex: e.electionIndex,
  governorAddress: e.governorAddress as `0x${string}`,
  title: e.title,
  description: e.description,
  startBlock: BigInt(e.startBlock),
  endBlock: BigInt(e.endBlock),
  emittedBlock: e.emittedBlock ? BigInt(e.emittedBlock) : 0n,
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

async function fetchElectionLogs(
  address: `0x${string}`,
  phase: 'nominee' | 'member',
  fromBlock: bigint,
  toBlock: bigint,
): Promise<Omit<Election, 'electionIndex'>[]> {
  const clients = buildClients()
  let lastError: unknown

  for (const client of clients) {
    try {
      const chunks: { from: bigint; to: bigint }[] = []
      for (let f = fromBlock; f <= toBlock; f += CHUNK + 1n)
        chunks.push({ from: f, to: f + CHUNK > toBlock ? toBlock : f + CHUNK })

      const all: Omit<Election, 'electionIndex'>[] = []
      for (let i = 0; i < chunks.length; i += 20) {
        const results = await Promise.all(
          chunks.slice(i, i + 20).map(({ from, to }) =>
            client.getLogs({ address, event: PROPOSAL_CREATED, fromBlock: from, toBlock: to }),
          ),
        )
        for (const log of results.flat()) {
          const { proposalId, description, startBlock, endBlock } = log.args as {
            proposalId: bigint; description: string; startBlock: bigint; endBlock: bigint
          }
          if (proposalId === undefined) continue
          all.push({
            proposalId,
            phase,
            governorAddress: address,
            title: parseTitle(description ?? ''),
            description: description ?? '',
            startBlock,                  // L1 block — voting window param
            endBlock,                    // L1 block — voting window param
            emittedBlock: log.blockNumber ?? 0n,  // L2 block — actual log location
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
// Dedup key: proposalId + phase (same proposalId can appear in both governors)
// ---------------------------------------------------------------------------
function electionKey(e: Pick<Election, 'proposalId' | 'phase'>) {
  return `${e.proposalId.toString()}-${e.phase}`
}

function assignElectionIndex(nominees: Election[], members: Omit<Election, 'electionIndex'>[]): Election[] {
  // Sort by emittedBlock (L2), falling back to startBlock (L1) if emittedBlock missing
  const sortedNominees = [...nominees].sort((a, b) => {
    const aBlock = a.emittedBlock > 0n ? a.emittedBlock : a.startBlock
    const bBlock = b.emittedBlock > 0n ? b.emittedBlock : b.startBlock
    return Number(aBlock - bBlock)
  })

  return members.map((m) => {
    const mBlock = m.emittedBlock > 0n ? m.emittedBlock : m.startBlock
    const filtered = sortedNominees.filter((n) => {
      const nBlock = n.emittedBlock > 0n ? n.emittedBlock : n.startBlock
      return nBlock <= mBlock
    })
    const match = filtered[filtered.length - 1]
    return { ...m, electionIndex: match?.electionIndex ?? 0 }
  })
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useElections() {
  const [elections, setElections] = useState<Election[]>(STATIC_ELECTIONS)
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
            : currentBlock! > ELECTIONS_START_BLOCK + RECENT_BLOCKS
            ? currentBlock! - RECENT_BLOCKS
            : ELECTIONS_START_BLOCK

        const [nomineeRaw, memberRaw] = await Promise.all([
          fetchElectionLogs(NOMINEE_ELECTION_GOVERNOR, 'nominee', liveFrom, currentBlock!),
          fetchElectionLogs(MEMBER_ELECTION_GOVERNOR, 'member', liveFrom, currentBlock!),
        ])

        if (cancelled) return

        // Assign electionIndex to live nominee proposals (continue from static max)
        const maxStaticIndex = STATIC_ELECTIONS
          .filter((e) => e.phase === 'nominee')
          .reduce((max, e) => Math.max(max, e.electionIndex), -1)

        const sortedLiveNominees = [...nomineeRaw].sort((a, b) =>
          Number((a.emittedBlock ?? a.startBlock) - (b.emittedBlock ?? b.startBlock))
        )
        const liveNominees: Election[] = sortedLiveNominees.map((n, i) => ({
          ...n,
          electionIndex: maxStaticIndex + 1 + i,
        }))

        const allNominees = [...STATIC_ELECTIONS.filter((e) => e.phase === 'nominee'), ...liveNominees]
        const liveMembers = assignElectionIndex(allNominees, memberRaw)

        // Deduplicate by (proposalId + phase) — same proposalId can appear in both governors
        const seen = new Set<string>()
        const merged: Election[] = []
        for (const e of [...liveNominees, ...liveMembers, ...STATIC_ELECTIONS]) {
          const key = electionKey(e)
          if (!seen.has(key)) {
            seen.add(key)
            merged.push(e)
          }
        }

        // Sort by electionIndex desc, nominee before member within same index
        merged.sort((a, b) => {
          if (b.electionIndex !== a.electionIndex) return b.electionIndex - a.electionIndex
          // nominee phase first (so it appears on the left in the 2-column grid)
          return a.phase === 'nominee' ? -1 : 1
        })
        setElections(merged)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to fetch live elections')
      } finally {
        if (!cancelled) setRefreshing(false)
      }
    }

    fetchLive()
    return () => { cancelled = true }
  }, [currentBlock])

  return { elections, refreshing, error }
}
