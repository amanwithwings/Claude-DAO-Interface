import { useReadContract, useBlockNumber } from 'wagmi'
import { Link } from 'react-router-dom'
import { NOMINEE_ELECTION_ABI, MEMBER_ELECTION_ABI } from '../config/contracts'
import { blocksToTime } from '../utils'
import ProposalStateBadge from './ProposalStateBadge'
import type { Election } from '../hooks/useElections'

interface Props {
  election: Election
}

export default function ElectionCard({ election }: Props) {
  const { data: currentBlock } = useBlockNumber()

  const governorAbi = election.phase === 'nominee' ? NOMINEE_ELECTION_ABI : MEMBER_ELECTION_ABI

  const { data: stateIndex } = useReadContract({
    address: election.governorAddress,
    abi: governorAbi,
    functionName: 'state',
    args: [election.proposalId],
  })

  // Nominee count (nominee phase) or topNominees length (member phase)
  const { data: nomineeCount } = useReadContract({
    address: election.governorAddress,
    abi: governorAbi,
    functionName: election.phase === 'nominee' ? 'nomineeCount' : 'topNominees',
    args: [election.proposalId],
    query: { enabled: election.phase === 'nominee' },
  })
  const { data: topNominees } = useReadContract({
    address: election.governorAddress,
    abi: governorAbi,
    functionName: 'topNominees',
    args: [election.proposalId],
    query: { enabled: election.phase === 'member' },
  })

  const blocksLeft = currentBlock ? Number(election.endBlock - currentBlock) : null
  const isActive = stateIndex === 1
  const isPending = stateIndex === 0

  const candidateCount =
    election.phase === 'nominee'
      ? nomineeCount !== undefined ? Number(nomineeCount) : null
      : topNominees !== undefined ? (topNominees as `0x${string}`[]).length : null

  const detailPath = `/elections/${election.phase}/${election.proposalId.toString()}`

  return (
    <Link
      to={detailPath}
      className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
    >
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
          {isActive && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 animate-pulse">
              Live
            </span>
          )}
        </div>

        {blocksLeft !== null && (
          <span className="text-xs text-gray-400 shrink-0">
            {blocksLeft > 0 ? blocksToTime(blocksLeft) : 'Ended'}
          </span>
        )}
      </div>

      <h3 className="font-medium text-gray-900 text-sm leading-snug mb-3">
        {election.title || (election.phase === 'nominee' ? 'Nominee Election' : 'Member Election')}
      </h3>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs text-gray-500">
          {candidateCount !== null && (
            <span>
              {election.phase === 'nominee' ? `${candidateCount} nominee${candidateCount !== 1 ? 's' : ''}` : `${candidateCount} nominee${candidateCount !== 1 ? 's' : ''}`}
            </span>
          )}
          {(isActive || isPending) && (
            <span className="text-blue-600 font-medium">View & Vote →</span>
          )}
          {!isActive && !isPending && (
            <span className="text-gray-400">View results →</span>
          )}
        </div>
      </div>
    </Link>
  )
}
