/**
 * Fetches candidates (contenders/nominees) for a Security Council election proposal.
 *
 * IMPORTANT: Arbitrum governance uses L1 Ethereum block numbers as proposal
 * startBlock/endBlock params. ContenderAdded events are emitted at L2 Arbitrum
 * block numbers. Always use `emittedBlock` (L2) for getLogs ranges, never
 * startBlock/endBlock from the Election object.
 *
 * Nominee phase:  candidates via ContenderAdded events (search from emittedBlock).
 *                 Per-candidate votes from votesReceived(proposalId, address).
 *
 * Member phase:   candidates via topNominees(proposalId) view.
 *                 Per-candidate weight from weightReceived(proposalId, address).
 */

import { useEffect, useState } from 'react'
import { createPublicClient, http, custom, parseAbiItem } from 'viem'
import { arbitrum } from 'wagmi/chains'
import { useReadContract, useBlockNumber } from 'wagmi'
import {
  NOMINEE_ELECTION_GOVERNOR,
  MEMBER_ELECTION_GOVERNOR,
  NOMINEE_ELECTION_ABI,
  MEMBER_ELECTION_ABI,
  ELECTIONS_START_BLOCK,
} from '../config/contracts'
import { shortAddr } from '../utils'

export interface Candidate {
  address: `0x${string}`
  txHash: `0x${string}` | null  // tx hash of ContenderAdded registration event
  label: string
  votes: bigint          // raw ARB wei votes/weight
  isNominee: boolean     // for nominee phase: crossed threshold?
  isExcluded: boolean
}

const CONTENDER_ADDED = parseAbiItem(
  'event ContenderAdded(uint256 indexed proposalId, address indexed contender)',
)

// 10M L2 blocks ≈ 28 days — enough to cover any election nomination period
const CONTENDER_SEARCH_WINDOW = 10_000_000n
const CHUNK = 100_000n

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
// Nominee-phase candidates (ContenderAdded events + per-address votesReceived)
// ---------------------------------------------------------------------------

export function useNomineePhaseCandidates(
  proposalId: bigint,
  /** L2 Arbitrum block where the ProposalCreated event was emitted */
  emittedBlock: bigint,
) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: currentBlock } = useBlockNumber()

  // nominees() gives addresses that crossed the threshold
  const { data: nomineeAddrs } = useReadContract({
    address: NOMINEE_ELECTION_GOVERNOR,
    abi: NOMINEE_ELECTION_ABI,
    functionName: 'nominees',
    args: [proposalId],
  })

  useEffect(() => {
    if (!currentBlock) return

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchCandidates() {
      try {
        // Determine L2 block range for ContenderAdded event search.
        // If emittedBlock is known (>0), search from there.
        // If not (old static data without emittedBlock), use recent window.
        const fromBlock = emittedBlock > 0n
          ? emittedBlock
          : currentBlock! > ELECTIONS_START_BLOCK
          ? currentBlock! - CONTENDER_SEARCH_WINDOW
          : ELECTIONS_START_BLOCK
        const toBlock = emittedBlock > 0n
          ? emittedBlock + CONTENDER_SEARCH_WINDOW
          : currentBlock!

        // Chunk the getLogs query
        const chunks: { from: bigint; to: bigint }[] = []
        for (let f = fromBlock; f <= toBlock; f += CHUNK + 1n)
          chunks.push({ from: f, to: f + CHUNK > toBlock ? toBlock : f + CHUNK })

        let logs: { args: { contender?: `0x${string}` }; transactionHash: `0x${string}` | null }[] = []
        for (let i = 0; i < chunks.length; i += 10) {
          const results = await withFallback((c) =>
            Promise.all(
              chunks.slice(i, i + 10).map(({ from, to }) =>
                c.getLogs({
                  address: NOMINEE_ELECTION_GOVERNOR,
                  event: CONTENDER_ADDED,
                  args: { proposalId },
                  fromBlock: from,
                  toBlock: to,
                }),
              ),
            ),
          )
          logs = [...logs, ...results.flat()]
        }

        // Deduplicate by address; record the first registration tx hash per address
        const addrToTx = new Map<`0x${string}`, `0x${string}` | null>()
        for (const log of logs) {
          const addr = log.args.contender as `0x${string}`
          if (addr && !addrToTx.has(addr)) addrToTx.set(addr, log.transactionHash)
        }
        const addrs = [...addrToTx.keys()]

        if (cancelled) return

        if (addrs.length === 0) {
          setCandidates([])
          setLoading(false)
          return
        }

        // Fetch votes per contender
        const voteResults = await withFallback((c) =>
          Promise.all(
            addrs.map((addr) =>
              c.readContract({
                address: NOMINEE_ELECTION_GOVERNOR,
                abi: NOMINEE_ELECTION_ABI,
                functionName: 'votesReceived',
                args: [proposalId, addr],
              }).catch(() => 0n as bigint),
            ),
          ),
        )

        if (cancelled) return

        const nomineeSet = new Set((nomineeAddrs ?? []).map((a: string) => a.toLowerCase()))

        const result: Candidate[] = addrs.map((addr, i) => ({
          address: addr,
          txHash: addrToTx.get(addr) ?? null,
          label: shortAddr(addr),
          votes: (voteResults[i] as bigint) ?? 0n,
          isNominee: nomineeSet.has(addr.toLowerCase()),
          isExcluded: false,
        }))

        result.sort((a, b) => (b.votes > a.votes ? 1 : b.votes < a.votes ? -1 : 0))
        setCandidates(result)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load contenders')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchCandidates()
    return () => { cancelled = true }
  }, [proposalId, emittedBlock, currentBlock, nomineeAddrs])

  return { candidates, loading, error }
}

// ---------------------------------------------------------------------------
// Member-phase candidates (topNominees() view + per-address weightReceived)
// ---------------------------------------------------------------------------

export function useMemberPhaseCandidates(proposalId: bigint) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { data: nomineeAddrs, isError } = useReadContract({
    address: MEMBER_ELECTION_GOVERNOR,
    abi: MEMBER_ELECTION_ABI,
    functionName: 'topNominees',
    args: [proposalId],
  })

  useEffect(() => {
    if (isError) {
      setError('Failed to load nominees')
      setLoading(false)
      return
    }
    if (!nomineeAddrs) return

    let cancelled = false
    setLoading(true)

    async function fetchWeights() {
      try {
        const addrs = nomineeAddrs as `0x${string}`[]

        const weightResults = await withFallback((c) =>
          Promise.all(
            addrs.map((addr) =>
              c.readContract({
                address: MEMBER_ELECTION_GOVERNOR,
                abi: MEMBER_ELECTION_ABI,
                functionName: 'weightReceived',
                args: [proposalId, addr],
              }).catch(() => 0n as bigint),
            ),
          ),
        )

        if (cancelled) return

        const result: Candidate[] = addrs.map((addr, i) => ({
          address: addr,
          txHash: null,
          label: shortAddr(addr),
          votes: (weightResults[i] as bigint) ?? 0n,
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

    fetchWeights()
    return () => { cancelled = true }
  }, [nomineeAddrs, isError, proposalId])

  return { candidates, loading, error }
}
