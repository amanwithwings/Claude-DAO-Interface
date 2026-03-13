import { useState } from 'react'
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { ARB_TOKEN, ARB_TOKEN_ABI } from '../config/contracts'
import { shortAddr } from '../utils'

interface Props {
  onClose: () => void
}

export default function DelegateModal({ onClose }: Props) {
  const { address, isConnected } = useAccount()
  const [delegateTo, setDelegateTo] = useState('')
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [txError, setTxError] = useState<string | null>(null)

  const { data: currentDelegate } = useReadContract({
    address: ARB_TOKEN,
    abi: ARB_TOKEN_ABI,
    functionName: 'delegates',
    args: [address!],
    query: { enabled: !!address },
  })

  const { writeContractAsync, isPending } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash })

  const handleDelegate = async () => {
    if (!delegateTo.startsWith('0x') || delegateTo.length !== 42) {
      setTxError('Enter a valid Ethereum address')
      return
    }
    setTxError(null)
    try {
      const hash = await writeContractAsync({
        address: ARB_TOKEN,
        abi: ARB_TOKEN_ABI,
        functionName: 'delegate',
        args: [delegateTo as `0x${string}`],
      })
      setTxHash(hash)
    } catch (e) {
      setTxError(e instanceof Error ? e.message : 'Transaction failed')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Delegate Voting Power</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        {!isConnected ? (
          <p className="text-gray-500">Connect your wallet to delegate.</p>
        ) : isSuccess ? (
          <div className="text-center py-4">
            <div className="text-green-600 text-3xl mb-2">✓</div>
            <p className="text-gray-700 font-medium">Delegation successful!</p>
            <p className="text-sm text-gray-500 mt-1">
              Delegated to {shortAddr(delegateTo)}
            </p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-gray-100 rounded-lg text-sm hover:bg-gray-200"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {currentDelegate && (
              <p className="text-sm text-gray-500 mb-4">
                Current delegate:{' '}
                <span className="font-mono text-gray-700">{shortAddr(currentDelegate)}</span>
                {currentDelegate.toLowerCase() === address?.toLowerCase() && (
                  <span className="ml-1 text-blue-600">(self)</span>
                )}
              </p>
            )}

            <div className="space-y-3">
              <input
                type="text"
                placeholder="0x... delegate address"
                value={delegateTo}
                onChange={(e) => setDelegateTo(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
              <button
                onClick={() => setDelegateTo(address!)}
                className="text-sm text-blue-600 hover:underline"
              >
                Delegate to myself
              </button>
            </div>

            {txError && (
              <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{txError}</p>
            )}

            <div className="flex gap-2 mt-5">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelegate}
                disabled={isPending || isConfirming}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {isPending
                  ? 'Confirm in wallet…'
                  : isConfirming
                  ? 'Confirming…'
                  : 'Delegate'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
