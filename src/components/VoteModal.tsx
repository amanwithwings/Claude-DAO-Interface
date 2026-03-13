import { useState } from 'react'
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useBlockNumber,
} from 'wagmi'
import { GOVERNOR_ABI } from '../config/contracts'
import { formatARB } from '../utils'
import type { Proposal } from '../hooks/useProposals'

interface Props {
  proposal: Proposal
  onClose: () => void
  onVoted: () => void
}

const SUPPORT_LABELS = ['Against', 'For', 'Abstain'] as const
const SUPPORT_STYLES = [
  'border-red-400 bg-red-50 text-red-700 hover:bg-red-100',
  'border-green-400 bg-green-50 text-green-700 hover:bg-green-100',
  'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100',
] as const
const SUPPORT_SELECTED = [
  'border-red-600 bg-red-600 text-white',
  'border-green-600 bg-green-600 text-white',
  'border-gray-500 bg-gray-500 text-white',
] as const

export default function VoteModal({ proposal, onClose, onVoted }: Props) {
  const { address } = useAccount()
  const [support, setSupport] = useState<0 | 1 | 2 | null>(null)
  const [reason, setReason] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [txError, setTxError] = useState<string | null>(null)

  const { data: blockNumber } = useBlockNumber()
  const { data: votingPower } = useReadContract({
    address: proposal.governorAddress,
    abi: GOVERNOR_ABI,
    functionName: 'getVotes',
    args: [address!, proposal.startBlock],
    query: { enabled: !!address && proposal.startBlock > 0n },
  })

  const { writeContractAsync, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const handleVote = async () => {
    if (support === null) return
    setTxError(null)
    try {
      const hash = await writeContractAsync(
        reason.trim()
          ? {
              address: proposal.governorAddress,
              abi: GOVERNOR_ABI,
              functionName: 'castVoteWithReason',
              args: [proposal.proposalId, support, reason.trim()],
            }
          : {
              address: proposal.governorAddress,
              abi: GOVERNOR_ABI,
              functionName: 'castVote',
              args: [proposal.proposalId, support],
            },
      )
      setTxHash(hash)
    } catch (e) {
      setTxError(e instanceof Error ? e.message : 'Transaction failed')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Cast Vote</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-gray-500 mb-5 line-clamp-2">{proposal.title}</p>

        {isSuccess ? (
          <div className="text-center py-4">
            <div className="text-green-600 text-3xl mb-2">✓</div>
            <p className="text-gray-700 font-medium">
              Vote cast: <strong>{support !== null ? SUPPORT_LABELS[support] : ''}</strong>
            </p>
            <button
              onClick={() => { onVoted(); onClose() }}
              className="mt-4 px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {votingPower !== undefined && (
              <p className="text-sm text-gray-500 mb-3">
                Your voting power: <span className="font-semibold text-gray-700">{formatARB(votingPower)} ARB</span>
              </p>
            )}

            <div className="grid grid-cols-3 gap-2 mb-4">
              {([0, 1, 2] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSupport(s)}
                  className={`py-2 rounded-lg border-2 text-sm font-medium transition-colors ${
                    support === s ? SUPPORT_SELECTED[s] : SUPPORT_STYLES[s]
                  }`}
                >
                  {SUPPORT_LABELS[s]}
                </button>
              ))}
            </div>

            <textarea
              placeholder="Reason (optional)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400 mb-3"
            />

            {txError && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 mb-3">{txError}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleVote}
                disabled={support === null || isPending || isConfirming}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isPending
                  ? 'Confirm in wallet…'
                  : isConfirming
                  ? 'Confirming…'
                  : 'Submit Vote'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
