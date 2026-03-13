import { useAccount, useReadContract, useBlockNumber } from 'wagmi'
import { CORE_GOVERNOR, GOVERNOR_ABI } from '../config/contracts'
import { formatARB } from '../utils'

export default function VotingPowerBadge() {
  const { address, isConnected } = useAccount()
  const { data: blockNumber } = useBlockNumber()

  const { data: votes } = useReadContract({
    address: CORE_GOVERNOR,
    abi: GOVERNOR_ABI,
    functionName: 'getVotes',
    args: [address!, blockNumber! > 1n ? blockNumber! - 1n : 0n],
    query: { enabled: isConnected && !!address && !!blockNumber },
  })

  if (!isConnected || votes === undefined) return null

  return (
    <span className="text-sm text-gray-600 bg-gray-100 px-2 py-1 rounded-md">
      {formatARB(votes)} ARB
    </span>
  )
}
