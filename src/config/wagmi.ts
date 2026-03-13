import { createConfig, fallback, http, unstable_connector } from 'wagmi'
import { arbitrum } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

export const config = createConfig({
  chains: [arbitrum],
  connectors: [injected()],
  transports: {
    [arbitrum.id]: fallback([
      // 1. Use the wallet's own RPC when connected (bypasses CORS, wide getLogs range)
      unstable_connector(injected),
      // 2. PublicNode — free, CORS-enabled, full archive
      http('https://arbitrum-one.publicnode.com'),
      // 3. Ankr — free, CORS-enabled backup
      http('https://rpc.ankr.com/arbitrum'),
    ]),
  },
})
