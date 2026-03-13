import { Link } from 'react-router-dom'
import { useReadContracts, useBlockNumber } from 'wagmi'
import { GOVERNOR_ABI } from '../config/contracts'
import type { Proposal } from '../hooks/useProposals'
import ProposalStateBadge from './ProposalStateBadge'
import VoteBar from './VoteBar'
import { blocksToTime } from '../utils'

interface Props {
  proposal: Proposal
}

export default function ProposalCard({ proposal }: Props) {
  const { data: blockNumber } = useBlockNumber()

  const { data } = useReadContracts({
    contracts: [
      {
        address: proposal.governorAddress,
        abi: GOVERNOR_ABI,
        functionName: 'state',
        args: [proposal.proposalId],
      },
      {
        address: proposal.governorAddress,
        abi: GOVERNOR_ABI,
        functionName: 'proposalVotes',
        args: [proposal.proposalId],
      },
    ],
  })

  const stateIndex = data?.[0].result as number | undefined
  const votes = data?.[1].result as readonly [bigint, bigint, bigint] | undefined

  const blocksLeft =
    blockNumber && proposal.endBlock > blockNumber
      ? Number(proposal.endBlock - blockNumber)
      : 0

  return (
    <Link
      to={`/proposal/${proposal.governor}/${proposal.proposalId.toString()}`}
      className="block bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="font-semibold text-gray-900 line-clamp-2 flex-1">{proposal.title}</h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              proposal.governor === 'core'
                ? 'bg-blue-50 text-blue-700'
                : 'bg-purple-50 text-purple-700'
            }`}
          >
            {proposal.governor === 'core' ? 'Core' : 'Treasury'}
          </span>
          <ProposalStateBadge stateIndex={stateIndex} />
        </div>
      </div>

      {stateIndex === 1 && blocksLeft > 0 && (
        <p className="text-xs text-gray-400 mb-2">{blocksToTime(blocksLeft)} remaining</p>
      )}

      {votes ? (
        <VoteBar
          againstVotes={votes[0]}
          forVotes={votes[1]}
          abstainVotes={votes[2]}
          compact
        />
      ) : (
        <div className="h-1.5 rounded-full bg-gray-100 animate-pulse" />
      )}
    </Link>
  )
}
