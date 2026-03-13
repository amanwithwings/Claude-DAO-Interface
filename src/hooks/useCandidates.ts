/**
 * Fetches candidates (contenders/nominees) for a Security Council election proposal,
 * along with their individual vote/weight counts.
 *
 * Nominee phase:  candidates are "contenders" → fetched via ContenderAdded events.
 *                 Each gets votesReceived(proposalId, address).
 *
 * Member phase:   candidates are "nominees" → fetched from topNominees(proposalId) view.
 *                 Each gets weightReceived(proposalId, address).
 */

import { useEffect, useState } from 'react'
import { createPublicClient, http, custom, parseAbiItem } from 'viem'
import { arbitrum } from 'wagmi/chains'
import { useReadContract } from 'wagmi'
import {
  NOMINEE_ELECTION_GOVERNOR,
  MEMBER_ELECTION_GOVERNOR,
  NOMINEE_ELECTION_ABI,
  MEMBER_ELECTION_ABI,
} from '../config/contracts'
import { shortAddr } from '../utils'
import staticCandidates from '../data/candidates.json'

type StaticCandidate = { address: string; votes: string; isNominee: boolean; isExcluded: boolean }
const STATIC: Record<string, StaticCandidate[]> = staticCandidates.candidates as Record<string, StaticCandidate[]>

export interface Candidate {
  address: `0x${string}`
  label: string
  votes: bigint          // raw ARB wei votes/weight
  isNominee: boolean     // for nominee phase: did they cross the threshold?
  isExcluded: boolean    // for nominee phase: vetoed by nominee vetter?
}

// ContenderAdded event
const CONTENDER_ADDED = parseAbiItem(
  'event ContenderAdded(uint256 indexed proposalId, address indexed contender)',
)

function buildClients() {
  const clients: ReturnType<typeof createPublicClient>[] = []
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

async function withFallback<T>(fn: (c: ReturnType<typeof createPublicClient>) => Promise<T>): Promise<T> {
  const clients = buildClients()
  let last: unknown
  for (const c of clients) {
    try { return await fn(c) } catch (e) { last = e }
  }
  throw last ?? new Error('All RPC endpoints failed')
}

// ---------------------------------------------------------------------------
// Nominee-phase candidates (fetched via ContenderAdded events + reads per address)
// ---------------------------------------------------------------------------

export function useNomineePhaseCandidates(
  proposalId: bigint,
  startBlock: bigint,
  endBlock: bigint,
) {
  // Check static backfill first — avoids scanning millions of L2 blocks at runtime.
  // (The startBlock/endBlock in elections.json are L1 block numbers, not L2, so
  // passing them directly to getLogs would scan the wrong range.)
  const staticEntry = STATIC[`${proposalId.toString()}_nominee`]
  const hasStatic = staticEntry !== undefined && staticEntry.length > 0

  const [candidates, setCandidates] = useState<Candidate[]>(
    hasStatic
      ? staticEntry.map((c) => ({ ...c, address: c.address as `0x${string}`, votes: BigInt(c.votes), label: shortAddr(c.address as `0x${string}`) }))
      : [],
  )
  const [loading, setLoading] = useState(!hasStatic)
  const [error, setError] = useState<string | null>(null)

  // Get the full nominees list (those that crossed threshold) for badge
  const { data: nomineeAddrs } = useReadContract({
    address: NOMINEE_ELECTION_GOVERNOR,
    abi: NOMINEE_ELECTION_ABI,
    functionName: 'nominees',
    args: [proposalId],
    query: { enabled: !hasStatic },
  })

  useEffect(() => {
    if (hasStatic) return  // static data is sufficient

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetch() {
      try {
        // The startBlock/endBlock in elections.json are L1 block numbers, not L2.
        // Scan the full L2 history in 50k-block chunks to find ContenderAdded events.
        const ELECTIONS_START_L2 = 150_000_000n
        const CHUNK_SIZE = 50_000n
        const clients = buildClients()
        const client = clients[0]
        const currentBlock = await client.getBlockNumber()

        const chunks: { from: bigint; to: bigint }[] = []
        for (let f = ELECTIONS_START_L2; f <= currentBlock; f += CHUNK_SIZE + 1n)
          chunks.push({ from: f, to: f + CHUNK_SIZE > currentBlock ? currentBlock : f + CHUNK_SIZE })

        const allLogs: Awaited<ReturnType<typeof client.getLogs>> = []
        for (let i = 0; i < chunks.length; i += 20) {
          const results = await Promise.all(
            chunks.slice(i, i + 20).map(({ from, to }) =>
              client.getLogs({
                address: NOMINEE_ELECTION_GOVERNOR,
                event: CONTENDER_ADDED,
                args: { proposalId },
                fromBlock: from,
                toBlock: to,
              }).catch(() => [] as typeof allLogs),
            ),
          )
          allLogs.push(...results.flat())
          if (allLogs.length > 0 && i > 0) break // found events, stop early
        }
        const logs = allLogs

        const addrs = [...new Set(logs.map((l) => l.args.contender as `0x${string}`))]
        if (addrs.length === 0) {
          setCandidates([])
          setLoading(false)
          return
        }

        const voteResults = await Promise.all(
          addrs.map((addr) =>
            client.readContract({
              address: NOMINEE_ELECTION_GOVERNOR,
              abi: NOMINEE_ELECTION_ABI,
              functionName: 'votesReceived',
              args: [proposalId, addr],
            }).catch(() => 0n as bigint),
          ),
        )

        if (cancelled) return

        const nomineeSet = new Set((nomineeAddrs ?? []).map((a: string) => a.toLowerCase()))

        const result: Candidate[] = addrs.map((addr, i) => ({
          address: addr,
          label: shortAddr(addr),
          votes: voteResults[i] ?? 0n,
          isNominee: nomineeSet.has(addr.toLowerCase()),
          isExcluded: false,
        }))

        result.sort((a, b) => (b.votes > a.votes ? 1 : b.votes < a.votes ? -1 : 0))
        setCandidates(result)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load candidates')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch()
    return () => { cancelled = true }
  }, [proposalId, startBlock, endBlock, nomineeAddrs, hasStatic])

  return { candidates, loading, error }
}

// ---------------------------------------------------------------------------
// Member-phase candidates (fetched from topNominees() view)
// ---------------------------------------------------------------------------

export function useMemberPhaseCandidates(proposalId: bigint) {
  const staticEntry = STATIC[`${proposalId.toString()}_member`]
  const hasStatic = staticEntry !== undefined && staticEntry.length > 0

  const [candidates, setCandidates] = useState<Candidate[]>(
    hasStatic
      ? staticEntry.map((c) => ({ ...c, address: c.address as `0x${string}`, votes: BigInt(c.votes), label: shortAddr(c.address as `0x${string}`) }))
      : [],
  )
  const [loading, setLoading] = useState(!hasStatic)
  const [error, setError] = useState<string | null>(null)

  // topNominees gives addresses of nominees going into the member election
  const { data: nomineeAddrs, isError } = useReadContract({
    address: MEMBER_ELECTION_GOVERNOR,
    abi: MEMBER_ELECTION_ABI,
    functionName: 'topNominees',
    args: [proposalId],
    query: { enabled: !hasStatic },
  })

  useEffect(() => {
    if (hasStatic) return

    if (isError) {
      setError('Failed to load nominees')
      setLoading(false)
      return
    }
    if (!nomineeAddrs) return

    let cancelled = false
    setLoading(true)

    async function fetch() {
      try {
        const addrs = nomineeAddrs as `0x${string}`[]
        const clients = buildClients()
        const client = clients[0]

        const weightResults = await Promise.all(
          addrs.map((addr) =>
            client.readContract({
              address: MEMBER_ELECTION_GOVERNOR,
              abi: MEMBER_ELECTION_ABI,
              functionName: 'weightReceived',
              args: [proposalId, addr],
            }).catch(() => 0n as bigint),
          ),
        )

        if (cancelled) return

        const result: Candidate[] = addrs.map((addr, i) => ({
          address: addr,
          label: shortAddr(addr),
          votes: weightResults[i] ?? 0n,
          isNominee: true,
          isExcluded: false,
        }))

        result.sort((a, b) => (b.votes > a.votes ? 1 : b.votes < a.votes ? -1 : 0))
        setCandidates(result)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load candidates')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch()
    return () => { cancelled = true }
  }, [nomineeAddrs, isError, proposalId, hasStatic])

  return { candidates, loading, error }
}
