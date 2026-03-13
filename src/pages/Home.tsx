import { useState } from 'react'
import Navbar from '../components/Navbar'
import ProposalCard from '../components/ProposalCard'
import { useProposals } from '../hooks/useProposals'

type Filter = 'all' | 'core' | 'treasury'

export default function Home() {
  const [filter, setFilter] = useState<Filter>('all')
  const { proposals, refreshing, error } = useProposals()

  const filtered =
    filter === 'all' ? proposals : proposals.filter((p) => p.governor === filter)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Governance Proposals</h1>
            <p className="text-gray-500 text-sm mt-1">
              ArbitrumDAO on-chain governance — vote with your ARB tokens
            </p>
          </div>
          {refreshing && (
            <span className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Checking for new proposals…
            </span>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-5 bg-gray-100 rounded-lg p-1 w-fit">
          {(['all', 'core', 'treasury'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-colors ${
                filter === f
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'core' ? 'Core (Constitutional)' : f === 'treasury' ? 'Treasury' : 'All'}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm mb-4">
            <strong>Live update failed:</strong> {error}
          </div>
        )}

        {filtered.length === 0 && !refreshing && (
          <div className="text-center py-16 text-gray-400">
            No proposals found.
          </div>
        )}

        <div className="space-y-3">
          {filtered.map((p) => (
            <ProposalCard key={`${p.governor}-${p.proposalId}`} proposal={p} />
          ))}
        </div>
      </main>

      <footer className="max-w-5xl mx-auto px-4 py-8 text-center text-xs text-gray-400">
        Data sourced entirely on-chain from Arbitrum One (Chain ID 42161).
        <br />
        Core Governor:{' '}
        <a
          href="https://arbiscan.io/address/0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9#writeContract"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          0xf07D…5B9
        </a>{' '}
        · Treasury Governor:{' '}
        <a
          href="https://arbiscan.io/address/0x789fC99093B09aD01C34DC7251D0C89ce743e5a4#writeContract"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          0x789f…5a4
        </a>
      </footer>
    </div>
  )
}
