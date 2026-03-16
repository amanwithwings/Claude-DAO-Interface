import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useReadContract, useAccount } from 'wagmi'
import Navbar from '../components/Navbar'
import ProposalStateBadge from '../components/ProposalStateBadge'
import ElectionVoteModal from '../components/ElectionVoteModal'
import {
  NOMINEE_ELECTION_GOVERNOR,
  MEMBER_ELECTION_GOVERNOR,
  NOMINEE_ELECTION_ABI,
  MEMBER_ELECTION_ABI,
} from '../config/contracts'
import { formatARB, l1BlockToTime, shortAddr } from '../utils'
import { useNomineePhaseCandidates, useMemberPhaseCandidates } from '../hooks/useCandidates'
import { useElections } from '../hooks/useElections'

export default function ElectionDetail() {
  const { phase, proposalId: proposalIdStr } = useParams<{ phase: string; proposalId: string }>()
  const [showVote, setShowVote] = useState(false)
  const { address: userAddress, isConnected } = useAccount()

  const proposalId = BigInt(proposalIdStr ?? '0')
  const isNomineePhase = phase === 'nominee'
  const governorAddress = isNomineePhase ? NOMINEE_ELECTION_GOVERNOR : MEMBER_ELECTION_GOVERNOR
  const governorAbi = isNomineePhase ? NOMINEE_ELECTION_ABI : MEMBER_ELECTION_ABI

  // Find the election in our list for startBlock (needed for event fetching)
  const { elections } = useElections()
  const election = elections.find(
    (e) => e.proposalId === proposalId && e.phase === (isNomineePhase ? 'nominee' : 'member'),
  )

  const { data: stateIndex } = useReadContract({
    address: governorAddress,
    abi: governorAbi,
    functionName: 'state',
    args: [proposalId],
  })

  const { data: snapshotBlock } = useReadContract({
    address: governorAddress,
    abi: governorAbi,
    functionName: 'proposalSnapshot',
    args: [proposalId],
  })

  const { data: deadline } = useReadContract({
    address: governorAddress,
    abi: governorAbi,
    functionName: 'proposalDeadline',
    args: [proposalId],
  })

  const { data: hasVoted } = useReadContract({
    address: governorAddress,
    abi: governorAbi,
    functionName: 'hasVoted',
    args: [proposalId, userAddress!],
    query: { enabled: !!userAddress },
  })

  const { data: votesUsed } = useReadContract({
    address: governorAddress,
    abi: governorAbi,
    functionName: 'votesUsed',
    args: [proposalId, userAddress!],
    query: { enabled: !!userAddress },
  })

  // Member-phase only: fullWeightVotingDeadline
  const { data: fullWeightDeadline } = useReadContract({
    address: MEMBER_ELECTION_GOVERNOR,
    abi: MEMBER_ELECTION_ABI,
    functionName: 'fullWeightVotingDeadline',
    args: [proposalId],
    query: { enabled: !isNomineePhase },
  })

  // Candidate data
  const nomineeCandidates = useNomineePhaseCandidates(
    proposalId,
    election?.emittedBlock ?? 0n,  // L2 block — correct range for getLogs
  )
  const memberCandidates = useMemberPhaseCandidates(proposalId)
  const { candidates, loading: candidatesLoading, error: candidatesError } =
    isNomineePhase ? nomineeCandidates : memberCandidates

  // deadline is an L1 Ethereum block number — use wall-clock math, not L2 block subtraction.
  // During contender submission (Pending/state=0), proposalDeadline() returns 0 because the
  // voting window hasn't been configured yet. Drive display from state, not deadline alone.
  const timeDisplay =
    stateIndex === undefined ? null
    : stateIndex > 1 ? 'Ended'
    : stateIndex === 1 && deadline ? l1BlockToTime(deadline)
    : null  // Pending: voting not open yet, no deadline to show
  const isActive = stateIndex === 1
  // fullWeightDeadline is also an L1 block — compare via wall-clock
  const fullWeightTimeDisplay = !isNomineePhase && fullWeightDeadline !== undefined
    ? l1BlockToTime(fullWeightDeadline)
    : null
  const isFullWeight = fullWeightTimeDisplay !== null && fullWeightTimeDisplay !== 'Ended'

  const totalVotes = candidates.reduce((sum, c) => sum + c.votes, 0n)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Back link */}
        <Link to="/elections" className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1 mb-5">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Elections
        </Link>

        {/* Header */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  isNomineePhase ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                }`}
              >
                {isNomineePhase ? 'Nominee Phase' : 'Member Election Phase'}
              </span>
              <ProposalStateBadge stateIndex={stateIndex} />
              {isActive && !isNomineePhase && (
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    isFullWeight ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                  }`}
                >
                  {isFullWeight ? '⚡ Full weight period' : '↓ Reduced weight period'}
                </span>
              )}
            </div>
            {timeDisplay !== null && (
              <span className="text-sm text-gray-400 shrink-0">{timeDisplay}</span>
            )}
          </div>

          <h1 className="text-xl font-bold text-gray-900 mb-1">
            {election?.title || (isNomineePhase ? 'Nominee Election' : 'Member Election')}
          </h1>

          <div className="text-xs text-gray-400 font-mono mt-2">
            Proposal ID: {proposalIdStr}
          </div>

          {!isNomineePhase && (
            <p className="text-sm text-gray-500 mt-3">
              ARB holders vote to elect the top 6 nominees into the Security Council. Votes
              {fullWeightTimeDisplay !== null
                ? isFullWeight
                  ? ` carry full weight for ${fullWeightTimeDisplay}.`
                  : ' now carry reduced weight (linear decay to 0).'
                : ' carry full weight early and decrease over time.'}
              {' '}You can split your voting power across multiple nominees.
            </p>
          )}

          {isNomineePhase && (
            <p className="text-sm text-gray-500 mt-3">
              ARB holders vote to push contenders past the nomination threshold (0.2% of total
              votable tokens). Contenders who reach the threshold become nominees and advance to
              the member election phase.
            </p>
          )}
        </div>

        {/* Your vote status */}
        {isConnected && userAddress && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex items-center justify-between gap-4">
            <div className="text-sm">
              {hasVoted ? (
                <span className="text-gray-600">
                  You have used{' '}
                  <strong>{formatARB(votesUsed ?? 0n)} ARB</strong> in this election.{' '}
                  {isActive && 'You can still allocate remaining voting power.'}
                </span>
              ) : (
                <span className="text-gray-500">You have not voted in this election yet.</span>
              )}
            </div>
            {isActive && (
              <button
                onClick={() => setShowVote(true)}
                className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2 rounded-lg font-medium transition-colors"
              >
                Vote
              </button>
            )}
          </div>
        )}

        {!isConnected && isActive && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
            Connect your wallet to vote in this election.
          </div>
        )}

        {/* Candidates */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">
            {isNomineePhase ? 'Contenders' : 'Nominees'}
            {candidates.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">({candidates.length})</span>
            )}
          </h2>
          {!isNomineePhase && (
            <p className="text-xs text-gray-500 mb-4">
              Top 6 by vote weight will be elected to the Security Council.
            </p>
          )}
          {isNomineePhase && (
            <p className="text-xs text-gray-500 mb-4">
              Contenders with ✓ Nominee badge have crossed the threshold and will advance.
            </p>
          )}

          {candidatesLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-400 py-4">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Loading candidates…
            </div>
          )}

          {candidatesError && (
            <div className="text-sm text-red-600 py-4">{candidatesError}</div>
          )}

          {!candidatesLoading && !candidatesError && candidates.length === 0 && (
            <div className="text-sm text-gray-400 py-4">
              {isNomineePhase
                ? 'No contenders have registered yet.'
                : 'Nominees not yet available — this phase may not have started.'}
            </div>
          )}

          {candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.map((c, i) => {
                const pct = totalVotes > 0n ? Number((c.votes * 10000n) / totalVotes) / 100 : 0
                const isTop6 = !isNomineePhase && i < 6
                return (
                  <div
                    key={c.address}
                    className={`rounded-lg border px-4 py-3 ${
                      isTop6
                        ? 'border-blue-200 bg-blue-50'
                        : 'border-gray-100 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-gray-400 shrink-0 w-5 text-right">
                          {i + 1}.
                        </span>
                        <a
                          href={
                            isNomineePhase && c.txHash
                              ? `https://arbiscan.io/tx/${c.txHash}`
                              : `https://arbiscan.io/address/${c.address}`
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-sm text-gray-800 hover:text-blue-600 truncate"
                          title={isNomineePhase && c.txHash ? `Registration tx: ${c.txHash}` : c.address}
                        >
                          {shortAddr(c.address)}
                        </a>
                        {c.isNominee && isNomineePhase && (
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full shrink-0">
                            ✓ Nominee
                          </span>
                        )}
                        {isTop6 && !isNomineePhase && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full shrink-0">
                            🏆 Elected
                          </span>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-medium text-gray-800">{formatARB(c.votes)} ARB</div>
                        <div className="text-xs text-gray-400">{pct.toFixed(1)}%</div>
                      </div>
                    </div>
                    {/* Vote bar */}
                    {totalVotes > 0n && (
                      <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${isTop6 ? 'bg-blue-500' : 'bg-gray-400'}`}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    )}
                    {/* Registration tx or full address */}
                    <div className="mt-1.5 flex items-center gap-2">
                      {isNomineePhase && c.txHash ? (
                        <a
                          href={`https://arbiscan.io/tx/${c.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-mono text-gray-400 hover:text-blue-500 break-all"
                        >
                          {c.txHash}
                        </a>
                      ) : (
                        <a
                          href={`https://arbiscan.io/address/${c.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-mono text-gray-400 hover:text-blue-500 break-all"
                        >
                          {c.address}
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {showVote && snapshotBlock !== undefined && (
        <ElectionVoteModal
          proposalId={proposalId}
          phase={isNomineePhase ? 'nominee' : 'member'}
          snapshotBlock={snapshotBlock}
          candidates={candidates}
          onClose={() => setShowVote(false)}
        />
      )}
    </div>
  )
}
