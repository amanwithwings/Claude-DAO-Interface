import { PROPOSAL_STATES, STATE_STYLES, type ProposalStateName } from '../config/contracts'

interface Props {
  stateIndex: number | undefined
}

export default function ProposalStateBadge({ stateIndex }: Props) {
  if (stateIndex === undefined) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
        …
      </span>
    )
  }
  const name = (PROPOSAL_STATES[stateIndex] ?? 'Unknown') as ProposalStateName
  const style = STATE_STYLES[name] ?? 'bg-gray-100 text-gray-500'
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {name}
    </span>
  )
}
