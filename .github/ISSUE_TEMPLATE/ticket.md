---
name: Ticket
about: One unit of work, one branch, one pull request into dev
title: "T<n>: "
labels: enhancement
---

**Ticket:** T<n> · **Milestone:** M1 · **Depends on:** T<n> (#<issue>)

## Intent
As a <role>, I want <action>, so that <benefit>.

## Acceptance
- 

## Done when
- [ ] <a check a test or a command can prove>

## How to work it
- Branch `feat/tb-<n>-<slug>` from `dev`; pull request into `dev` with `Closes #<this issue>`.
- Every commit ends with a `Refs: #<this issue>` footer.
