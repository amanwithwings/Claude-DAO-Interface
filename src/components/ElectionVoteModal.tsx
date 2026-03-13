/**
 * Voting modal for Security Council elections.
 *
 * Both nominee-phase and member-phase use:
 *   castVoteWithReasonAndParams(proposalId, 1, reason, params)
 * where params = abi.encode(address candidate, uint256 votes)
 *
 * Voters can split their voting power across multiple candidates by
 * calling castVoteWithReasonAndParams multiple times (one per candidate).
 * votesUsed(proposalId, account) tracks how much they've used so far.
 */

import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { encodeAbiParameters, parseAbiParameters } from 'viem'
import {
  NOMINEE_ELECTION_GOVERNOR,
  MEMBER_ELECTION_GOVERNOR,
  NOMINEE_ELECTION_ABI,
  MEMBER_ELECTION_ABI,
} from '../config/contracts'
import { formatARB, shortAddr } from '../utils'
import type { Candidate } from '../hooks/useCandidates'

interface Props {
  proposalId: bigint
  phase: 'nominee' | 'member'
  snapshotBlock: bigint
  candidates: Candidate[]
  onClose: () => void
}

export default function ElectionVoteModal({ proposalId, phase, snapshotBlock, candidates, onClose }: Props) {
  const { address } = useAccount()

  const governorAddress = phase === 'nominee' ? NOMINEE_ELECTION_GOVERNOR : MEMBER_ELECTION_GOVERNOR
  const governorAbi = phase === 'nominee' ? NOMINEE_ELECTION_ABI : MEMBER_ELECTION_ABI

  // User's available voting power at snapshot
  const { data: votingPower } = useReadContract({
    address: governorAddress,
    abi: governorAbi,
    functionName: 'getVotes',
    args: [address!, snapshotBlock],
    query: { enabled: !!address },
  })

  // How many votes the user has already used in this proposal
  const { data: usedVotes, refetch: refetchUsed } = useReadContract({
    address: governorAddress,
    abi: governorAbi,
    functionName: 'votesUsed',
    args: [proposalId, address!],
    query: { enabled: !!address },
  })

  const availableVotes = (votingPower ?? 0n) - (usedVotes ?? 0n)

  const [selected, setSelected] = useState<`0x${string}` | null>(null)
  const [voteInput, setVoteInput] = useState('')
  const [reason, setReason] = useState('')

  const { writeContract, data: txHash, isPending, error: writeError, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  function handleSelectCandidate(addr: `0x${string}`) {
    setSelected(addr)
    reset()
    // Default: use all remaining votes for this candidate
    if (availableVotes > 0n) {
      const readable = (Number(availableVotes) / 1e18).toFixed(2)
      setVoteInput(readable)
    }
  }

  function handleSubmit() {
    if (!selected || !voteInput) return
    const votesWei = BigInt(Math.floor(parseFloat(voteInput) * 1e18))
    if (votesWei <= 0n || votesWei > availableVotes) return

    const params = encodeAbiParameters(
      parseAbiParameters('address, uint256'),
      [selected, votesWei],
    )

    writeContract({
      address: governorAddress,
      abi: governorAbi,
      functionName: 'castVoteWithReasonAndParams',
      args: [proposalId, 1, reason, params],
    })
  }

  if (isSuccess) {
    refetchUsed()
  }

  const hasVotingPower = (votingPower ?? 0n) > 0n
  const hasRemainingVotes = availableVotes > 0n

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {phase === 'nominee' ? 'Vote for a Contender' : 'Vote for Nominees'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {phase === 'nominee'
                  ? 'Vote for a contender to help them reach the nomination threshold.'
                  : 'Allocate your voting power across nominees. Top 6 by weight are elected.'}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-3 shrink-0">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Voting power display */}
          <div className="bg-gray-50 rounded-lg px-4 py-3 mb-5 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Total voting power</span>
              <span className="font-medium">{formatARB(votingPower ?? 0n)} ARB</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-gray-500">Already used</span>
              <span className="text-orange-600 font-medium">{formatARB(usedVotes ?? 0n)} ARB</span>
            </div>
            <div className="flex justify-between mt-1 border-t border-gray-200 pt-1">
              <span className="text-gray-700 font-medium">Remaining</span>
              <span className={`font-bold ${hasRemainingVotes ? 'text-green-700' : 'text-gray-400'}`}>
                {formatARB(availableVotes)} ARB
              </span>
            </div>
          </div>

          {!hasVotingPower && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800 mb-4">
              You had no voting power at the snapshot block for this election.
            </div>
          )}

          {hasVotingPower && !hasRemainingVotes && !isSuccess && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 mb-4">
              You have used all your voting power for this election.
            </div>
          )}

          {/* Candidate list */}
          {hasVotingPower && hasRemainingVotes && (
            <div className="space-y-2 mb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                {phase === 'nominee' ? 'Contenders' : 'Nominees'} — select one to vote
              </p>
              {candidates.map((c) => (
                <button
                  key={c.address}
                  onClick={() => handleSelectCandidate(c.address)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                    selected === c.address
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-mono text-gray-800">{shortAddr(c.address)}</span>
                      {c.isNominee && (
                        <span className="ml-2 text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">
                          ✓ Nominee
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{formatARB(c.votes)} ARB</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 font-mono">{c.address}</p>
                </button>
              ))}
            </div>
          )}

          {/* Vote amount + reason (shown when candidate selected) */}
          {selected && hasRemainingVotes && !isSuccess && (
            <div className="space-y-3 mb-4">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Votes to allocate (ARB)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={voteInput}
                    onChange={(e) => setVoteInput(e.target.value)}
                    min="0"
                    step="1"
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                    placeholder="0"
                  />
                  <button
                    onClick={() => setVoteInput((Number(availableVotes) / 1e18).toFixed(2))}
                    className="text-xs text-blue-600 border border-blue-200 px-3 py-2 rounded-lg hover:bg-blue-50"
                  >
                    Max
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  You can vote multiple times, splitting power across candidates.
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Reason (optional)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400"
                  placeholder="Why are you voting for this candidate?"
                />
              </div>
            </div>
          )}

          {/* Error */}
          {writeError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
              {writeError.message.split('\n')[0]}
            </div>
          )}

          {/* Success */}
          {isSuccess && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center mb-4">
              <div className="text-2xl mb-1">✓</div>
              <p className="text-sm font-medium text-green-800">Vote submitted!</p>
              <p className="text-xs text-green-600 mt-1">
                You can vote again to allocate remaining power to other candidates.
              </p>
            </div>
          )}

          {/* Submit button */}
          {selected && hasRemainingVotes && (
            <button
              onClick={handleSubmit}
              disabled={isPending || isConfirming || !voteInput || parseFloat(voteInput) <= 0}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white py-2.5 rounded-lg font-medium text-sm transition-colors"
            >
              {isPending || isConfirming ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  {isConfirming ? 'Confirming…' : 'Submitting…'}
                </span>
              ) : (
                `Vote for ${shortAddr(selected)}`
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
