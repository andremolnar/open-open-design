# Privacy

This detached OpenDesign build does not send product analytics, session replay,
quality traces, crash reports, or safety/reliability telemetry to OpenDesign,
PostHog, Langfuse, or an analytics relay. This remains true if upstream
telemetry credentials are inherited from the environment or old sharing
preferences remain in local app configuration. No release feed is queried for
updates, and Home does not fetch hosted “What's New” or production offers.
The Test campaign preview contacts its configured service only when explicitly
opened with `cmsTestControls=1`.
The Message Center fetches messages only when you open it; it does not poll in
the background. Opening it can contact the configured account/message service.

Your projects, generated files, and BYOK keys remain on your machine. Local
diagnostic logs and crash dumps can still be produced; **Export Diagnostics**
creates a file for you to review and share explicitly. This build does not
automatically upload those diagnostics. An explicitly configured
`OD_WHATS_NEW_URL` can point to a document you control; without it the card
is absent.

This does not make the app offline-only: signing in to an account, using a
cloud model or configured API provider, publishing, opening an external link,
and other user-requested network features contact their respective services.
Installer attribution tokens and login marketing attribution are not forwarded
to the original download ledger or account analytics service.
Those services have their own data-handling policies. Do not confuse these
user-requested connections with automatic analytics. The app can retain local
installation IDs and historical sharing preferences for compatibility with
existing local configuration, but they do not enable telemetry transmission.

Previously sent telemetry cannot be recalled by changing this build. Contact
the original service operator if you need historical records deleted.
