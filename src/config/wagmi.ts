import { createConfig, fallback, http, unstable_connector } from 'wagmi'
import { arbitrum } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

const rpcUrl = import.meta.env.VITE_RPC_URL

export const config = createConfig({
  chains: [arbitrum],
  connectors: [injected()],
  transports: {
    [arbitrum.id]: fallback([
      unstable_connector(injected),
      ...(rpcUrl ? [http(rpcUrl)] : []),
      http('https://arbitrum.llamarpc.com'),
      http('https://arbitrum-one.publicnode.com'),
    ]),
  },
})
