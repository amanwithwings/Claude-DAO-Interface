import { formatARB } from '../utils'

interface Props {
  againstVotes: bigint
  forVotes: bigint
  abstainVotes: bigint
  quorum?: bigint
  compact?: boolean
}

export default function VoteBar({
  againstVotes,
  forVotes,
  abstainVotes,
  quorum,
  compact = false,
}: Props) {
  const total = againstVotes + forVotes + abstainVotes
  const pct = (v: bigint) => (total > 0n ? Number((v * 10000n) / total) / 100 : 0)

  const forPct = pct(forVotes)
  const againstPct = pct(againstVotes)
  const abstainPct = pct(abstainVotes)

  if (compact) {
    return (
      <div className="w-full h-1.5 rounded-full bg-gray-200 flex overflow-hidden">
        <div className="bg-green-500 h-full" style={{ width: `${forPct}%` }} />
        <div className="bg-red-500 h-full" style={{ width: `${againstPct}%` }} />
        <div className="bg-gray-400 h-full" style={{ width: `${abstainPct}%` }} />
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1 h-3 rounded-full overflow-hidden bg-gray-200">
        <div className="bg-green-500 h-full transition-all" style={{ width: `${forPct}%` }} />
        <div className="bg-red-500 h-full transition-all" style={{ width: `${againstPct}%` }} />
        <div className="bg-gray-400 h-full transition-all" style={{ width: `${abstainPct}%` }} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <span className="font-semibold text-green-700">For</span>
          <div className="text-gray-600">
            {formatARB(forVotes)} ARB <span className="text-gray-400">({forPct.toFixed(1)}%)</span>
          </div>
        </div>
        <div>
          <span className="font-semibold text-red-700">Against</span>
          <div className="text-gray-600">
            {formatARB(againstVotes)} ARB{' '}
            <span className="text-gray-400">({againstPct.toFixed(1)}%)</span>
          </div>
        </div>
        <div>
          <span className="font-semibold text-gray-500">Abstain</span>
          <div className="text-gray-600">
            {formatARB(abstainVotes)} ARB{' '}
            <span className="text-gray-400">({abstainPct.toFixed(1)}%)</span>
          </div>
        </div>
      </div>

      {quorum !== undefined && quorum > 0n && (
        <div className="mt-2">
          <div className="text-xs text-gray-500 mb-1">
            Quorum: {formatARB(forVotes + abstainVotes)} / {formatARB(quorum)} ARB
          </div>
          <div className="w-full h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="bg-blue-500 h-full transition-all"
              style={{
                width: `${Math.min(100, Number(((forVotes + abstainVotes) * 100n) / quorum))}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
