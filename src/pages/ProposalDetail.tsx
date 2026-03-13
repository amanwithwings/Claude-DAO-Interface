import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  useReadContracts,
  useBlockNumber,
  useAccount,
  useReadContract,
} from 'wagmi'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import { CORE_GOVERNOR, TREASURY_GOVERNOR, GOVERNOR_ABI } from '../config/contracts'
import { useProposals } from '../hooks/useProposals'
import Navbar from '../components/Navbar'
import ProposalStateBadge from '../components/ProposalStateBadge'
import VoteBar from '../components/VoteBar'
import VoteModal from '../components/VoteModal'
import { blocksToTime, shortAddr } from '../utils'

const SUPPORT_LABELS = ['Against', 'For', 'Abstain'] as const

export default function ProposalDetail() {
  const { governor, proposalId: proposalIdStr } = useParams<{
    governor: string
    proposalId: string
  }>()
  const [showVoteModal, setShowVoteModal] = useState(false)
  const [voteRefresh, setVoteRefresh] = useState(0)

  const { address, isConnected } = useAccount()
  const { data: blockNumber } = useBlockNumber()
  const { proposals, refreshing: loading } = useProposals()

  const proposalId = BigInt(proposalIdStr ?? '0')
  const governorAddress =
    governor === 'core' ? CORE_GOVERNOR : TREASURY_GOVERNOR

  const proposal = proposals.find(
    (p) => p.proposalId === proposalId && p.governor === governor,
  )

  const { data, refetch } = useReadContracts({
    contracts: [
      {
        address: governorAddress,
        abi: GOVERNOR_ABI,
        functionName: 'state',
        args: [proposalId],
      },
      {
        address: governorAddress,
        abi: GOVERNOR_ABI,
        functionName: 'proposalVotes',
        args: [proposalId],
      },
      {
        address: governorAddress,
        abi: GOVERNOR_ABI,
        functionName: 'proposalSnapshot',
        args: [proposalId],
      },
      {
        address: governorAddress,
        abi: GOVERNOR_ABI,
        functionName: 'proposalDeadline',
        args: [proposalId],
      },
    ],
    // Re-fetch when voteRefresh changes
    query: { gcTime: voteRefresh },
  })

  const stateIndex = data?.[0].result as number | undefined
  const votes = data?.[1].result as readonly [bigint, bigint, bigint] | undefined
  const snapshotBlock = data?.[2].result as bigint | undefined
  const deadlineBlock = data?.[3].result as bigint | undefined

  const { data: quorum } = useReadContract({
    address: governorAddress,
    abi: GOVERNOR_ABI,
    functionName: 'quorum',
    args: [snapshotBlock!],
    query: { enabled: !!snapshotBlock },
  })

  const { data: hasVoted } = useReadContract({
    address: governorAddress,
    abi: GOVERNOR_ABI,
    functionName: 'hasVoted',
    args: [proposalId, address!],
    query: { enabled: !!address, gcTime: voteRefresh },
  })

  const { data: votingPower } = useReadContract({
    address: governorAddress,
    abi: GOVERNOR_ABI,
    functionName: 'getVotes',
    args: [address!, snapshotBlock!],
    query: { enabled: !!address && !!snapshotBlock },
  })

  const blocksLeft =
    blockNumber && deadlineBlock && deadlineBlock > blockNumber
      ? Number(deadlineBlock - blockNumber)
      : 0

  const isActive = stateIndex === 1
  const canVote = isActive && isConnected && !hasVoted && votingPower !== undefined && votingPower > 0n

  if (loading && !proposal) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-5xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-6 bg-gray-200 rounded w-2/3" />
            <div className="h-4 bg-gray-200 rounded w-1/4" />
            <div className="h-32 bg-gray-200 rounded" />
          </div>
        </main>
      </div>
    )
  }

  if (!proposal) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Navbar />
        <main className="max-w-5xl mx-auto px-4 py-8">
          <Link to="/" className="text-blue-600 hover:underline text-sm">← Back to proposals</Link>
          <p className="mt-4 text-gray-500">Proposal not found.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/" className="text-blue-600 hover:underline text-sm">← Back to proposals</Link>

        <div className="mt-4 bg-white rounded-xl border border-gray-200 p-6">
          {/* Header */}
          <div className="flex items-start gap-3 mb-2">
            <span
              className={`mt-1 text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${
                proposal.governor === 'core'
                  ? 'bg-blue-50 text-blue-700'
                  : 'bg-purple-50 text-purple-700'
              }`}
            >
              {proposal.governor === 'core' ? 'Core' : 'Treasury'}
            </span>
            <h1 className="text-xl font-bold text-gray-900">{proposal.title}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-5 text-sm text-gray-500">
            <ProposalStateBadge stateIndex={stateIndex} />
            {isActive && blocksLeft > 0 && (
              <span>{blocksToTime(blocksLeft)} remaining</span>
            )}
            {deadlineBlock !== undefined && (
              <span>Deadline block: {deadlineBlock.toString()}</span>
            )}
            <span>
              Proposer:{' '}
              <a
                href={`https://arbiscan.io/address/${proposal.proposer}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:underline text-gray-700"
              >
                {shortAddr(proposal.proposer)}
              </a>
            </span>
          </div>

          {/* Vote counts */}
          {votes ? (
            <div className="mb-6">
              <VoteBar
                againstVotes={votes[0]}
                forVotes={votes[1]}
                abstainVotes={votes[2]}
                quorum={quorum}
              />
            </div>
          ) : (
            <div className="h-20 bg-gray-50 rounded-lg animate-pulse mb-6" />
          )}

          {/* Voting action */}
          <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
            {!isConnected ? (
              <p className="text-sm text-gray-500">Connect your wallet to vote on this proposal.</p>
            ) : hasVoted ? (
              <p className="text-sm text-gray-600">
                ✓ You have already voted on this proposal.
              </p>
            ) : !isActive ? (
              <p className="text-sm text-gray-500">Voting is not active for this proposal.</p>
            ) : votingPower !== undefined && votingPower === 0n ? (
              <p className="text-sm text-gray-500">
                You have no voting power for this proposal (snapshot block:{' '}
                {snapshotBlock?.toString()}). You may need to delegate your ARB tokens before the
                snapshot.
              </p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-gray-600">
                  You can vote on this proposal.
                </p>
                <button
                  onClick={() => setShowVoteModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                >
                  Vote
                </button>
              </div>
            )}
          </div>

          {/* Full description */}
          <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
              {proposal.description}
            </ReactMarkdown>
          </div>
        </div>
      </main>

      {showVoteModal && (
        <VoteModal
          proposal={proposal}
          onClose={() => setShowVoteModal(false)}
          onVoted={() => {
            setVoteRefresh((n) => n + 1)
            refetch()
          }}
        />
      )}
    </div>
  )
}
