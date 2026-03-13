import { parseAbi } from 'viem'

export const CORE_GOVERNOR = '0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9' as const
export const TREASURY_GOVERNOR = '0x789fC99093B09aD01C34DC7251D0C89ce743e5a4' as const
export const ARB_TOKEN = '0x912CE59144191C1204E64559FE8253a0e49E6548' as const

// Approximate block when ARB governance went live (March 2023)
export const GOVERNANCE_START_BLOCK = 75_000_000n

export const GOVERNOR_ABI = parseAbi([
  'function state(uint256 proposalId) view returns (uint8)',
  'function proposalSnapshot(uint256 proposalId) view returns (uint256)',
  'function proposalDeadline(uint256 proposalId) view returns (uint256)',
  'function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)',
  'function getVotes(address account, uint256 blockNumber) view returns (uint256)',
  'function hasVoted(uint256 proposalId, address account) view returns (bool)',
  'function quorum(uint256 blockNumber) view returns (uint256)',
  'function castVote(uint256 proposalId, uint8 support) returns (uint256)',
  'function castVoteWithReason(uint256 proposalId, uint8 support, string calldata reason) returns (uint256)',
  'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)',
])

export const ARB_TOKEN_ABI = parseAbi([
  'function delegate(address delegatee)',
  'function delegates(address account) view returns (address)',
  'function balanceOf(address account) view returns (uint256)',
])

export const PROPOSAL_STATES = [
  'Pending',
  'Active',
  'Canceled',
  'Defeated',
  'Succeeded',
  'Queued',
  'Expired',
  'Executed',
] as const

export type ProposalStateName = (typeof PROPOSAL_STATES)[number]

export const STATE_STYLES: Record<ProposalStateName, string> = {
  Active: 'bg-green-100 text-green-800',
  Pending: 'bg-yellow-100 text-yellow-800',
  Succeeded: 'bg-blue-100 text-blue-800',
  Queued: 'bg-purple-100 text-purple-800',
  Executed: 'bg-gray-100 text-gray-700',
  Defeated: 'bg-red-100 text-red-800',
  Canceled: 'bg-gray-100 text-gray-500',
  Expired: 'bg-gray-100 text-gray-500',
}
