import '../styles/app.css'
import PullRequestsOverview from '../pages/pull-requests/pull-requests'
import { initializeIpcUpdateListener } from '../services/pull-request.service'

export default function App() {
  initializeIpcUpdateListener()

  return <PullRequestsOverview />
}
