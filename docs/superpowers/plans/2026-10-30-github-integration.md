# GitHub PR Integration Implementation Plan

Approved design: GitHub.com PAT connections with explicit owner/repository lists join Azure DevOps in the existing list, profiles, notifications and tray. No dependencies, OAuth, enterprise, discovery, merging or comment authoring.

### Task 1: Typed integrations and migration

Replace azDoIntegrations with a discriminated integrations union. Migrate both legacy Azure formats preserving IDs, encryption, profiles, acknowledgements, atomic writes and recovery. Extend settings tests before implementing. Add provider identity to PR keys.

### Task 2: GitHub service and coordination

Use fetch, API 2026-03-10, 30sec timeout, serial requests, pagination, ETags, rate-limit backoff, stale-response guards. Map open PRs, reviewers, verified teams, checks and merge conflicts. Preserve healthy repositories on failure. Generalize the manager and update startup, IPC, tray and profiling. Test mocked API behavior and provider routing.

### Task 3: Settings and review actions

Offer a provider choice on Add Integration, provider-specific settings with masked PAT, repositories, 180sec default refresh and smart approval enabled. Validation makes reads only and ignores stale results. Approve current displayed commits, never self-authored/already-approved PRs, preserve partial bulk successes, space writes by >=1sec. Dismiss only own active decisive reviews with reason 'Review reset via PullRequest-Manager.'. Show missing reviewers/checks as unavailable. Keep Azure deep links.

### Task 4: Verification

Update fixtures, docs and offline mixed-provider Electron smoke test. Run npm run build, npm run lint and npm test, then independent review and targeted fixes. Never perform live GitHub writes in tests.

## Review focus

Credential secrecy and encrypted migration; wrong-connection actions; changed commits; optional access failures shown as success; stale validation/refresh after selection, edits or removal.

## Completed validation

Implemented and reviewed. `npm run build`, `npm run lint`, and `npm test` pass (167 tests plus the Electron smoke run). Review regressions cover stale-account action routing and shared-PAT request scheduling/cooldowns. The offline smoke covers mixed-provider PRs and GitHub settings; native keyboard steps explicitly focus the test window. No live GitHub account or review writes were exercised.
