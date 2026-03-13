/**
 * One-time script to fetch all Security Council election candidates
 * (contenders + votes for nominee phase, nominees + weights for member phase)
 * and write them to src/data/candidates.json.
 *
 * Run with:
 *   VITE_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/<key> node scripts/fetchCandidates.mjs
 *
 * Re-run after each election cycle to add new results.
 * The app uses this static data for historical elections so it never needs
 * to scan millions of L2 blocks at runtime.
 */

import { createPublicClient, http, parseAbiItem } from 'viem'
import { arbitrum } from 'viem/chains'
import { writeFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

const RPC_URL = process.env.VITE_RPC_URL
if (!RPC_URL) {
  console.error('Set VITE_RPC_URL env var before running this script.')
  process.exit(1)
}

const NOMINEE_ELECTION_GOVERNOR = '0x8a1cDA8dee421cD06023470608605934c16A05a0'
const MEMBER_ELECTION_GOVERNOR  = '0x467923B9AE90BDB36BA88eCA11604D45F13b712C'

// L2 block when SC election contracts were deployed (~late 2023)
const ELECTIONS_START_BLOCK = 150_000_000n
const RECENT_BLOCKS = 5_000_000n
const CHUNK = 50_000n

const CONTENDER_ADDED = parseAbiItem(
  'event ContenderAdded(uint256 indexed proposalId, address indexed contender)',
)
const NOMINEE_ELECTION_ABI = [
  { name: 'nominees',        type: 'function', stateMutability: 'view', inputs: [{ name: 'proposalId', type: 'uint256' }], outputs: [{ type: 'address[]' }] },
  { name: 'votesReceived',   type: 'function', stateMutability: 'view', inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'contender', type: 'address' }], outputs: [{ type: 'uint256' }] },
]
const MEMBER_ELECTION_ABI = [
  { name: 'topNominees',     type: 'function', stateMutability: 'view', inputs: [{ name: 'proposalId', type: 'uint256' }], outputs: [{ type: 'address[]' }] },
  { name: 'weightReceived',  type: 'function', stateMutability: 'view', inputs: [{ name: 'proposalId', type: 'uint256' }, { name: 'nominee', type: 'address' }], outputs: [{ type: 'uint256' }] },
]

const client = createPublicClient({ chain: arbitrum, transport: http(RPC_URL) })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchLogs(address, event, fromBlock, toBlock) {
  const chunks = []
  for (let f = fromBlock; f <= toBlock; f += CHUNK + 1n)
    chunks.push({ from: f, to: f + CHUNK > toBlock ? toBlock : f + CHUNK })

  console.log(`  Scanning ${chunks.length} chunks (L2 ${fromBlock}→${toBlock})…`)

  const all = []
  for (let i = 0; i < chunks.length; i += 20) {
    process.stdout.write(`\r  batch ${Math.floor(i / 20) + 1}/${Math.ceil(chunks.length / 20)}   `)
    const results = await Promise.all(
      chunks.slice(i, i + 20).map(({ from, to }) =>
        client.getLogs({ address, event, fromBlock: from, toBlock: to }),
      ),
    )
    all.push(...results.flat())
  }
  console.log()
  return all
}

async function readContract(address, abi, functionName, args) {
  return client.readContract({ address, abi, functionName, args })
}

// ---------------------------------------------------------------------------
// Nominee-phase: ContenderAdded events + votesReceived per contender
// ---------------------------------------------------------------------------

async function fetchNomineePhaseCandidates(proposalId, fromBlock, toBlock) {
  console.log(`  Nominee proposal ${proposalId.toString().slice(0, 12)}…`)

  const logs = await fetchLogs(
    NOMINEE_ELECTION_GOVERNOR,
    CONTENDER_ADDED,
    fromBlock,
    toBlock,
  )

  // Filter events for this specific proposal
  const addrs = [
    ...new Set(
      logs
        .filter((l) => l.args.proposalId === proposalId)
        .map((l) => l.args.contender),
    ),
  ]

  if (addrs.length === 0) {
    console.log('  No contenders found.')
    return []
  }

  console.log(`  Found ${addrs.length} contenders. Fetching votes…`)

  // Get who crossed the threshold
  const nomineeAddrs = await readContract(
    NOMINEE_ELECTION_GOVERNOR,
    NOMINEE_ELECTION_ABI,
    'nominees',
    [proposalId],
  ).catch(() => [])

  const nomineeSet = new Set(nomineeAddrs.map((a) => a.toLowerCase()))

  // Fetch votesReceived in parallel batches of 20
  const votes = []
  for (let i = 0; i < addrs.length; i += 20) {
    const batch = addrs.slice(i, i + 20)
    const results = await Promise.all(
      batch.map((addr) =>
        readContract(NOMINEE_ELECTION_GOVERNOR, NOMINEE_ELECTION_ABI, 'votesReceived', [proposalId, addr])
          .catch(() => 0n),
      ),
    )
    votes.push(...results)
  }

  return addrs.map((addr, i) => ({
    address: addr,
    votes: votes[i].toString(),
    isNominee: nomineeSet.has(addr.toLowerCase()),
    isExcluded: false,
  })).sort((a, b) => (BigInt(b.votes) > BigInt(a.votes) ? 1 : -1))
}

// ---------------------------------------------------------------------------
// Member-phase: topNominees() + weightReceived per nominee
// ---------------------------------------------------------------------------

async function fetchMemberPhaseCandidates(proposalId) {
  console.log(`  Member proposal ${proposalId.toString().slice(0, 12)}…`)

  const addrs = await readContract(
    MEMBER_ELECTION_GOVERNOR,
    MEMBER_ELECTION_ABI,
    'topNominees',
    [proposalId],
  ).catch(() => [])

  if (addrs.length === 0) {
    console.log('  No nominees found.')
    return []
  }

  console.log(`  Found ${addrs.length} nominees. Fetching weights…`)

  const weights = await Promise.all(
    addrs.map((addr) =>
      readContract(MEMBER_ELECTION_GOVERNOR, MEMBER_ELECTION_ABI, 'weightReceived', [proposalId, addr])
        .catch(() => 0n),
    ),
  )

  return addrs.map((addr, i) => ({
    address: addr,
    votes: weights[i].toString(),
    isNominee: true,
    isExcluded: false,
  })).sort((a, b) => (BigInt(b.votes) > BigInt(a.votes) ? 1 : -1))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('Fetching current L2 block…')
  const currentBlock = await client.getBlockNumber()
  const cutoffBlock = currentBlock - RECENT_BLOCKS
  console.log(`Current: ${currentBlock}, cutoff: ${cutoffBlock}`)

  // Load elections to know which proposalIds to process
  const electionsPath = resolve(__dirname, '../src/data/elections.json')
  if (!existsSync(electionsPath)) {
    console.error('src/data/elections.json not found. Run fetchElections.mjs first.')
    process.exit(1)
  }
  const electionsData = JSON.parse(
    (await import('fs')).readFileSync(electionsPath, 'utf8'),
  )

  const nominees = electionsData.elections.filter((e) => e.phase === 'nominee')
  const members  = electionsData.elections.filter((e) => e.phase === 'member')

  const out = {}

  // --- Nominee phase ---
  // Scan the full L2 historical range once for ALL ContenderAdded events,
  // then distribute per proposalId. Much faster than one scan per proposal.
  console.log('\n=== Nominee phase ===')
  console.log(`Scanning L2 blocks ${ELECTIONS_START_BLOCK}→${cutoffBlock} for ContenderAdded events…`)

  const allContenderLogs = await fetchLogs(
    NOMINEE_ELECTION_GOVERNOR,
    CONTENDER_ADDED,
    ELECTIONS_START_BLOCK,
    cutoffBlock,
  )
  console.log(`Found ${allContenderLogs.length} ContenderAdded events total.`)

  // Group by proposalId
  const contendersByProposal = new Map()
  for (const log of allContenderLogs) {
    const pid = log.args.proposalId
    if (!contendersByProposal.has(pid)) contendersByProposal.set(pid, [])
    contendersByProposal.get(pid).push(log.args.contender)
  }

  for (const election of nominees) {
    const pid = BigInt(election.proposalId)
    const addrs = [...new Set(contendersByProposal.get(pid) ?? [])]
    console.log(`\nElection ${election.electionIndex} nominee (${addrs.length} contenders):`)

    if (addrs.length === 0) {
      out[`${election.proposalId}_nominee`] = []
      continue
    }

    const nomineeAddrs = await readContract(
      NOMINEE_ELECTION_GOVERNOR,
      NOMINEE_ELECTION_ABI,
      'nominees',
      [pid],
    ).catch(() => [])

    const nomineeSet = new Set(nomineeAddrs.map((a) => a.toLowerCase()))

    const votes = []
    for (let i = 0; i < addrs.length; i += 20) {
      const results = await Promise.all(
        addrs.slice(i, i + 20).map((addr) =>
          readContract(NOMINEE_ELECTION_GOVERNOR, NOMINEE_ELECTION_ABI, 'votesReceived', [pid, addr])
            .catch(() => 0n),
        ),
      )
      votes.push(...results)
    }

    const key = `${election.proposalId}_nominee`
    out[key] = addrs.map((addr, i) => ({
      address: addr,
      votes: votes[i].toString(),
      isNominee: nomineeSet.has(addr.toLowerCase()),
      isExcluded: false,
    })).sort((a, b) => (BigInt(b.votes) > BigInt(a.votes) ? 1 : -1))

    console.log(`  Stored ${out[key].length} contenders.`)
  }

  // --- Member phase ---
  console.log('\n=== Member phase ===')
  for (const election of members) {
    const pid = BigInt(election.proposalId)
    console.log(`\nElection ${election.electionIndex} member:`)

    const addrs = await readContract(
      MEMBER_ELECTION_GOVERNOR,
      MEMBER_ELECTION_ABI,
      'topNominees',
      [pid],
    ).catch(() => [])

    if (addrs.length === 0) {
      console.log('  No nominees found.')
      out[`${election.proposalId}_member`] = []
      continue
    }

    const weights = await Promise.all(
      addrs.map((addr) =>
        readContract(MEMBER_ELECTION_GOVERNOR, MEMBER_ELECTION_ABI, 'weightReceived', [pid, addr])
          .catch(() => 0n),
      ),
    )

    const key = `${election.proposalId}_member`
    out[key] = addrs.map((addr, i) => ({
      address: addr,
      votes: weights[i].toString(),
      isNominee: true,
      isExcluded: false,
    })).sort((a, b) => (BigInt(b.votes) > BigInt(a.votes) ? 1 : -1))

    console.log(`  Stored ${out[key].length} nominees.`)
  }

  // Write output
  const result = { cutoffBlock: cutoffBlock.toString(), candidates: out }
  const outPath = resolve(__dirname, '../src/data/candidates.json')
  writeFileSync(outPath, JSON.stringify(result, null, 2))

  const total = Object.values(out).reduce((s, a) => s + a.length, 0)
  console.log(`\nWrote ${total} candidates across ${Object.keys(out).length} proposals to src/data/candidates.json`)
}

main().catch((e) => { console.error(e); process.exit(1) })
