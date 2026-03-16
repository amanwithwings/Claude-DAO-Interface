import Navbar from '../components/Navbar'
import ElectionCard from '../components/ElectionCard'
import { useElections } from '../hooks/useElections'

export default function Elections() {
  const { elections, refreshing, error } = useElections()

  // Group by electionIndex, sorted descending (newest first)
  const grouped = elections.reduce<Map<number, typeof elections>>((map, e) => {
    const group = map.get(e.electionIndex) ?? []
    group.push(e)
    map.set(e.electionIndex, group)
    return map
  }, new Map())

  const sortedKeys = [...grouped.keys()].sort((a, b) => b - a)

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar />

      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Security Council Elections</h1>
            <p className="text-gray-500 text-sm mt-1">
              Elections for the 12-member Security Council — held every 6 months, 6 seats per cohort
            </p>
          </div>
          {refreshing && (
            <span className="text-xs text-gray-400 mt-1 flex items-center gap-1.5">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Checking for active elections…
            </span>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm mb-4">
            <strong>Live update failed:</strong> {error}
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-blue-800 text-sm mb-6 space-y-1">
          <p>
            <strong>Election #5 timeline:</strong>{' '}
            Contender submissions open <strong>Mar 15 – Mar 22, 2026 (12:00 UTC)</strong>.
            Nominee voting opens <strong>Mar 22</strong> — wallet voting will be enabled then.{' '}
            <a
              href="https://forum.arbitrum.foundation/t/march-2026-security-council-election-contender-submission/30654"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Forum post →
            </a>
          </p>
          <p className="text-blue-700">
            Nominee phase: push contenders past the 0.2% ARB threshold.
            Member phase: allocate your voting power across nominees to elect 6 Security Council seats.
          </p>
        </div>

        {elections.length === 0 && !refreshing && (
          <div className="text-center py-16 text-gray-400">
            <p>No election data loaded.</p>
            <p className="text-xs mt-2">
              Run{' '}
              <code className="bg-gray-100 px-1 rounded">node scripts/fetchElections.mjs</code>{' '}
              to backfill historical elections.
            </p>
          </div>
        )}

        <div className="space-y-8">
          {sortedKeys.map((idx) => {
            const group = grouped.get(idx)!
            const nominee = group.find((e) => e.phase === 'nominee')
            const member = group.find((e) => e.phase === 'member')

            return (
              <div key={idx}>
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                  Election #{idx + 1}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {nominee && <ElectionCard election={nominee} />}
                  {member && <ElectionCard election={member} />}
                </div>
              </div>
            )
          })}
        </div>
      </main>

      <footer className="max-w-5xl mx-auto px-4 py-8 text-center text-xs text-gray-400">
        Data sourced entirely on-chain from Arbitrum One (Chain ID 42161).
        <br />
        Nominee Election Governor:{' '}
        <a
          href="https://arbiscan.io/address/0x8a1cDA8dee421cD06023470608605934c16A05a0"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          0x8a1c…05a0
        </a>{' '}
        · Member Election Governor:{' '}
        <a
          href="https://arbiscan.io/address/0x467923B9AE90BDB36BA88eCA11604D45F13b712C"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          0x4679…712C
        </a>
      </footer>
    </div>
  )
}
