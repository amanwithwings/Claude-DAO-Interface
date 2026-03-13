import { useState } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import VotingPowerBadge from './VotingPowerBadge'
import DelegateModal from './DelegateModal'
import { shortAddr } from '../utils'

export default function Navbar() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const [showDelegate, setShowDelegate] = useState(false)

  return (
    <>
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg text-blue-600">ArbitrumDAO</span>
            <span className="text-gray-400 hidden sm:inline">Voting</span>
          </div>

          <div className="flex items-center gap-2">
            {isConnected && (
              <>
                <VotingPowerBadge />
                <button
                  onClick={() => setShowDelegate(true)}
                  className="text-sm text-gray-600 hover:text-blue-600 px-2 py-1 rounded border border-gray-200 hover:border-blue-300 transition-colors"
                >
                  Delegate
                </button>
              </>
            )}

            {isConnected ? (
              <button
                onClick={() => disconnect()}
                className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1.5 rounded-md transition-colors font-mono"
              >
                {shortAddr(address!)}
              </button>
            ) : (
              <button
                onClick={() => connect({ connector: injected() })}
                className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md transition-colors font-medium"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>

      {showDelegate && <DelegateModal onClose={() => setShowDelegate(false)} />}
    </>
  )
}
