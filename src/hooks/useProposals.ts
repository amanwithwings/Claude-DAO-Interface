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

export function useProposals() {
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limitedHistory, setLimitedHistory] = useState(false)

  const client = usePublicClient()
  const { data: currentBlock } = useBlockNumber()

  useEffect(() => {
    if (!client || !currentBlock) return

    let cancelled = false

    async function fetchLogs(fromBlock: bigint) {
      const [coreLogs, treasuryLogs] = await Promise.all([
        client!.getLogs({
          address: CORE_GOVERNOR,
          event: PROPOSAL_CREATED,
          fromBlock,
          toBlock: 'latest',
        }),
        client!.getLogs({
          address: TREASURY_GOVERNOR,
          event: PROPOSAL_CREATED,
          fromBlock,
          toBlock: 'latest',
        }),
      ])

      const parse = (
        logs: typeof coreLogs,
        governor: 'core' | 'treasury',
        address: `0x${string}`,
      ): Proposal[] =>
        logs
          .filter((l) => l.args.proposalId !== undefined)
          .map((l) => ({
            proposalId: l.args.proposalId!,
            proposer: l.args.proposer!,
            title: parseTitle(l.args.description ?? ''),
            description: l.args.description ?? '',
            startBlock: l.args.startBlock!,
            endBlock: l.args.endBlock!,
            governor,
            governorAddress: address,
          }))

      return [
        ...parse(coreLogs, 'core', CORE_GOVERNOR),
        ...parse(treasuryLogs, 'treasury', TREASURY_GOVERNOR),
      ].sort((a, b) => Number(b.startBlock - a.startBlock))
    }

    async function load() {
      try {
        setLoading(true)
        setError(null)
        let results: Proposal[]

        try {
          results = await fetchLogs(GOVERNANCE_START_BLOCK)
        } catch {
          // RPC may limit range; fall back to recent ~500K blocks (~1.4 days)
          const fallbackFrom =
            currentBlock! > 500_000n ? currentBlock! - 500_000n : 0n
          results = await fetchLogs(fallbackFrom)
          if (!cancelled) setLimitedHistory(true)
        }

        if (!cancelled) setProposals(results)
      } catch (e) {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : 'Failed to load proposals',
          )
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [client, currentBlock])

  return { proposals, loading, error, limitedHistory }
}
