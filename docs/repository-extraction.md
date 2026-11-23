# Dedicated Dashboard repository extraction

This repository contains only the project formerly rooted at `dashboard-standalone/` in `NNNNNthe1st/sales_solutions`, frozen at `549f5ecd0fd9fe304fd372db4e7e3710061032e4` on `feature/averidi-dashboard`.

## History and ownership

All 270 commits affecting that directory were extracted in historical order. Original authors, committers, timestamps and commit messages are retained, with source repository, commit and path trailers added for traceability. Extracted commit IDs change because their root trees and ancestry exclude the parent application's unrelated content. Each of the 270 historical root trees matches its original Dashboard subtree exactly.

The extraction baseline tag is `extraction/source-549f5ec`, retained inside `docs/history/averidi-dashboard.bundle`. Its root tree is recorded in `repository-extraction.json`, together with the 130 source files and the original-to-extracted commit map. The published GitHub development branch uses a snapshot-import commit, while the bundle retains the original extracted ancestry. Later changes contain repository-specific documentation and independent CI configuration.

No website or Analyst source trees, runtime data, credentials, Git remotes or deployment configuration were transferred. Application source and Prisma migrations are byte-for-byte identical to the extraction baseline. Existing website and Analyst repositories, branches and servers were not modified.

## Verification

Run these commands from the repository root:

```bash
git fsck --full
node scripts/verify-repository-history.mjs --archive
node scripts/check-isolation.mjs
node --experimental-strip-types --test tests/source-isolation.test.ts
```

The history verifier checks the bundle checksum, independent Git root, all 130 baseline files and modes, all 270 historical trees and the source-to-extracted commit sequence. It restores the bundle only into a temporary bare repository, without executing archived application code or changing the working repository. The source verifier checks the Dashboard source/dependency boundary. These checks establish repository extraction integrity; application build and end-to-end acceptance remain separate requirements.

To work with the complete extracted Git ancestry directly, clone the bundle into a separate local directory:

```bash
git clone -b feature/independent-dashboard docs/history/averidi-dashboard.bundle ../dashboard-history
```

## Remaining application work

The extraction preserves the existing implementation; it does not complete the roadmap. In particular, worker code references `leaseToken`, `leaseExpiresAt`, `availableAt` and `lastError`, which are added by migration SQL but are absent from the source Prisma model. Customer upload/job creation, live metric display, broader legacy feature migration and payment-provider integration remain incomplete. Application CI must report these failures honestly rather than bypassing its checks.

## Remote publication

The private repository is `https://github.com/NNNNNthe1st/averidi-dashboard`. The application snapshot and complete history bundle are published on `feature/independent-dashboard`; the original `sales_solutions` branch is unchanged. A separate `repository-bootstrap` branch holds a one-time history-import workflow. GitHub refused to start that job because recent account payments failed or the spending limit must be increased. No billing changes were attempted. The direct repository API transfer does not depend on Actions, so the application and preserved history remain accessible despite that restriction. The import job has not restored the original ancestry as native GitHub branch commits; that distinction is intentional and explicit.
