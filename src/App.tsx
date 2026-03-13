import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import Home from './pages/Home'
import ProposalDetail from './pages/ProposalDetail'
import Elections from './pages/Elections'
import ElectionDetail from './pages/ElectionDetail'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '/proposal/:governor/:proposalId', element: <ProposalDetail /> },
  { path: '/elections', element: <Elections /> },
  { path: '/elections/:phase/:proposalId', element: <ElectionDetail /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
