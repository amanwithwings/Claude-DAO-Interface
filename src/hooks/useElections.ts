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
  startBlock: bigint
  endBlock: bigint
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
            startBlock,
            endBlock,
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

function assignElectionIndex(nominees: Election[], members: Omit<Election, 'electionIndex'>[]): Election[] {
  const sortedNominees = [...nominees].sort((a, b) => Number(a.startBlock - b.startBlock))

  return members.map((m) => {
    const filtered = sortedNominees.filter((n) => n.startBlock <= m.startBlock)
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

        // Assign electionIndex to live nominee proposals
        const maxStaticIndex = STATIC_ELECTIONS
          .filter((e) => e.phase === 'nominee')
          .reduce((max, e) => Math.max(max, e.electionIndex), -1)

        const sortedLiveNominees = [...nomineeRaw].sort((a, b) => Number(a.startBlock - b.startBlock))
        const liveNominees: Election[] = sortedLiveNominees.map((n, i) => ({
          ...n,
          electionIndex: maxStaticIndex + 1 + i,
        }))

        const allNominees = [...STATIC_ELECTIONS.filter((e) => e.phase === 'nominee'), ...liveNominees]
        const liveMembers = assignElectionIndex(allNominees, memberRaw)

        // Deduplicate by proposalId+phase — nominee and member elections
        // share the same proposalId, so proposalId alone is not unique.
        const seen = new Set<string>()
        const merged: Election[] = []
        for (const e of [...liveNominees, ...liveMembers, ...STATIC_ELECTIONS]) {
          const key = `${e.proposalId}_${e.phase}`
          if (!seen.has(key)) {
            seen.add(key)
            merged.push(e)
          }
        }
        merged.sort((a, b) => Number(b.startBlock - a.startBlock))
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
