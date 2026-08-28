# Security policy

## Reporting a vulnerability

Please do not open a public issue for vulnerabilities involving credentials,
browser sessions, payment flows or personal household data. Use GitHub's private
security advisory flow for this repository.

Include the affected version, reproduction steps and expected impact. Do not
include real payment credentials, cookies, addresses or voucher identifiers.

## Current safety boundary

Version 0.1 reads local configuration and produces plans. It does not complete
checkout or payment. Any future adapter that changes an external cart or order
must require explicit user approval and keep credentials outside the repository.
