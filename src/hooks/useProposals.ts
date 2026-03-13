import { useEffect, useState } from 'react'
import { usePublicClient, useBlockNumber } from 'wagmi'
import { parseAbiItem } from 'viem'
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

// Minimal typed shape for a decoded ProposalCreated log
type ProposalCreatedLog = {
  args: {
    proposalId: bigint
    proposer: `0x${string}`
    description: string
    startBlock: bigint
    endBlock: bigint
  }
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

  const client = usePublicClient()
  const { data: currentBlock } = useBlockNumber()

  useEffect(() => {
    if (!client || !currentBlock) return

    let cancelled = false

    // Fetch logs for one address, chunking into `chunkSize`-block slices if needed.
    async function fetchAddress(
      address: `0x${string}`,
      fromBlock: bigint,
      toBlock: bigint,
    ): Promise<ProposalCreatedLog[]> {
      // Try the full range first (works on wallet RPC or permissive nodes).
      try {
        const logs = await client!.getLogs({
          address,
          event: PROPOSAL_CREATED,
          fromBlock,
          toBlock: 'latest',
        })
        return logs as unknown as ProposalCreatedLog[]
      } catch {
        // Fall back to chunked requests (handles strict block-range limits).
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
              client!.getLogs({
                address,
                event: PROPOSAL_CREATED,
                fromBlock: from,
                toBlock: to,
              }),
            ),
          )
          all.push(...(results.flat() as unknown as ProposalCreatedLog[]))
        }
        return all
      }
    }

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
  }, [client, currentBlock])

  return { proposals, loading, error }
}
