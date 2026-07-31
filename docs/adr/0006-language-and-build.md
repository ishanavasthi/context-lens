# ADR-0006: TypeScript throughout, npm workspaces, Vite with CRXJS for the extension

Context: the extension and the API share an event contract, and a mismatch between them is the
most likely integration failure in the project.
Decision: TypeScript everywhere with a shared `packages/shared` module that both sides import, so
a contract change breaks the build rather than production. npm workspaces for the monorepo. Vite
with the CRXJS plugin for the MV3 build.
Alternatives considered: pnpm, rejected because neither pnpm nor corepack is present on the build
machine, so it would add an install step for anyone cloning the repo. Plain webpack for the
extension, rejected because CRXJS handles MV3 manifest generation and HMR that would otherwise be
hand rolled.
Consequences: committed to one language across both runtimes, and to CRXJS tracking Chrome's
manifest changes on our behalf.
Revisit when: the workspace exceeds roughly ten packages, or CRXJS falls behind a Chrome release.
