import { useReadContract, useBlockNumber } from 'wagmi'
import { GOVERNOR_ABI, NOMINEE_ELECTION_GOVERNOR, MEMBER_ELECTION_GOVERNOR } from '../config/contracts'
import { blocksToTime } from '../utils'
import ProposalStateBadge from './ProposalStateBadge'
import VoteBar from './VoteBar'
import type { Election } from '../hooks/useElections'

interface Props {
  election: Election
}

export default function ElectionCard({ election }: Props) {
  const { data: currentBlock } = useBlockNumber()

  const { data: stateIndex } = useReadContract({
    address: election.governorAddress,
    abi: GOVERNOR_ABI,
    functionName: 'state',
    args: [election.proposalId],
  })

  const { data: votes } = useReadContract({
    address: election.governorAddress,
    abi: GOVERNOR_ABI,
    functionName: 'proposalVotes',
    args: [election.proposalId],
  })

  const blocksLeft = currentBlock ? Number(election.endBlock - currentBlock) : null
  const isActive = stateIndex === 1

  const arbiscanBase =
    election.governorAddress.toLowerCase() === NOMINEE_ELECTION_GOVERNOR.toLowerCase()
      ? `https://arbiscan.io/address/${NOMINEE_ELECTION_GOVERNOR}#writeContract`
      : `https://arbiscan.io/address/${MEMBER_ELECTION_GOVERNOR}#writeContract`

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
              election.phase === 'nominee'
                ? 'bg-purple-100 text-purple-700'
                : 'bg-blue-100 text-blue-700'
            }`}
          >
            {election.phase === 'nominee' ? 'Nominee Phase' : 'Member Election'}
          </span>
          <ProposalStateBadge stateIndex={stateIndex} />
        </div>

        {blocksLeft !== null && (
          <span className="text-xs text-gray-400 shrink-0">
            {blocksToTime(blocksLeft)}
          </span>
        )}
      </div>

      <h3 className="font-medium text-gray-900 text-sm leading-snug mb-3">
        {election.title || (election.phase === 'nominee' ? 'Nominee Election' : 'Member Election')}
      </h3>

      {votes && (
        <div className="mb-3">
          <VoteBar
            forVotes={votes[1]}
            againstVotes={votes[0]}
            abstainVotes={votes[2]}
            compact
          />
        </div>
      )}

      {isActive && (
        <a
          href={arbiscanBase}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
        >
          Vote on Arbiscan
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </div>
  )
}
