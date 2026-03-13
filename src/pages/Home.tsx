import { useState } from 'react'
import Navbar from '../components/Navbar'
import ProposalCard from '../components/ProposalCard'
import { useProposals } from '../hooks/useProposals'

type Filter = 'all' | 'core' | 'treasury'

export default function Home() {
  const [filter, setFilter] = useState<Filter>('all')
  const { proposals, loading, error, limitedHistory } = useProposals()

  const filtered =
    filter === 'all' ? proposals : proposals.filter((p) => p.governor === filter)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Governance Proposals</h1>
          <p className="text-gray-500 text-sm mt-1">
            ArbitrumDAO on-chain governance — vote with your ARB tokens
          </p>
        </div>

        {limitedHistory && (
          <div className="mb-4 text-sm bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3 text-yellow-800">
            Your RPC limits log history. Showing recent proposals only. Configure a custom RPC
            (e.g. Alchemy) in <code className="font-mono">src/config/wagmi.ts</code> for full
            history.
          </div>
        )}

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

        {loading && (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-3" />
                <div className="h-3 bg-gray-200 rounded w-1/4 mb-3" />
                <div className="h-1.5 bg-gray-200 rounded w-full" />
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            <strong>Failed to load proposals:</strong> {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            No proposals found.
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-3">
            {filtered.map((p) => (
              <ProposalCard key={`${p.governor}-${p.proposalId}`} proposal={p} />
            ))}
          </div>
        )}
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
