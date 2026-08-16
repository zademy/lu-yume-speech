# Triage labels

Canonical role names from the `triage` skill map 1:1 to GitHub label strings. Every triaged issue carries exactly one **category** role and one **state** role.

## Category roles

| Role | Meaning |
| --- | --- |
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |

## State roles

| Role | Meaning |
| --- | --- |
| `needs-triage` | Maintainer needs to evaluate |
| `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | Needs human implementation |
| `wontfix` | Will not be actioned |

State machine: unlabeled → `needs-triage` → (`needs-info` ⇄ `needs-triage` when reporter replies) → `ready-for-agent` | `ready-for-human` | `wontfix`. Maintainer can override at any point.
