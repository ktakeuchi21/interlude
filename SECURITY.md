# Security

This app is designed for one private owner. Public source is not a public hosted learning account.

Production authorization relies on a trusted Sites dispatcher and a persisted owner identity. A deployment on another host must implement verified authentication and strip client-supplied identity headers before exposing the app. The loopback development identity is not a production login system.

Credentials belong in server-side secret management. Learning exports, database files, generated media, owner-specific publications and private operational evidence must remain outside this repository. The public-source check catches selected common leaks; it is not proof that arbitrary future changes contain no sensitive data.

If GitHub offers private vulnerability reporting for this repository, use its Security tab for a report. Otherwise open only a minimal issue requesting a private contact channel, without exploit details, credentials, private data or sensitive logs. There is no guaranteed response SLA for this personal project.
