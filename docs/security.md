# LitterSpot security model

## 1. Trust model

Node is the security boundary for application data. The browser, Python inference service, assignment provider, request bodies, query strings, and uploaded files are untrusted inputs.

## 2. Authentication and sessions

- Users sign in with Firebase Authentication email and password.
- The browser sends the Firebase ID token as `Authorization: Bearer <token>`.
- Node verifies the token with Firebase Admin for every protected `/api` request.
- Node resolves the token to an active `userAccounts` record and an active role profile.
- Site deactivation and inactive accounts fail before business operations.
- The client derives its application area from `/api/me`; it does not choose its own role.

## 3. Authorization by module

### Site and spatial administration

- Superadmin routes require the `superadmin` role.
- Supervisor account creation and updates require Root authority.
- Site Map drafts, structural publication, Camera Creation, Camera movement, and Camera removal require Root authority through the primary product routes.
- Superadmin Site View is implemented through separate Site-scoped read endpoints and does not impersonate a Supervisor.

The mounted generic `/api/sites`, `/api/zones`, and `/api/cameras` compatibility routes are an exception. They are only Supervisor-gated, accept mutation methods, and their unfiltered reads are not constrained to the authenticated Site. They are used by current frontend adapters for list data but must not be treated as the security boundary for structural administration.

### Camera monitoring and AI

- Monitoring configuration and control require an active Supervisor.
- Monitoring sample mutation also requires the current lease token.
- Development scenes require an enabled environment flag; production scene access additionally requires Root authority.
- FastAPI accepts an internal shared token when configured.

### Alert and evidence management

- Alert reads and mutations require an active Site Supervisor.
- Media authorization checks Site ownership and role-specific relationship before returning metadata or bytes.
- Cleaner Camera Evidence is limited to the Cleaner assigned to the Work Order.

### Cleaner and Work operations

- Cleaner self-service routes require the Cleaner role and active linked profile.
- A Cleaner may access only their own Work and permitted Site projection.
- Supervisor Work mutations require current revisions, reasons, and idempotency keys where specified.

### Orchestration and operational intelligence

- Supervisor Orchestrator controls require an active Site Supervisor.
- Internal Orchestrator routes require `X-Orchestrator-Token` and `X-Orchestrator-Worker-ID`.
- Node supplies and revalidates allowed assignment pairs. Provider output cannot bypass eligibility.
- Root authority is required for Site audit-event reads.

## 4. Tenant isolation

- Tenant-owned records carry `siteId`.
- Node derives Site identity from the authenticated account, not from arbitrary request input.
- Detail services verify both document existence and Site ownership and return 404 for cross-Site access.
- Superadmin cross-Site access uses dedicated services that require an explicit selected Site.
- Cursor signatures bind pagination cursors to their resource and filters.

## 5. Firestore client rules

The browser uses Firestore only for permitted real-time notification reads. Firestore rules require the signed-in recipient and Site filters. Business writes are denied to clients. Node uses Firebase Admin after application-level authorization.

## 6. Input and upload controls

- Express JSON bodies are limited to 1 MiB.
- Zod schemas reject unknown or invalid fields on business routes.
- Image signatures and declared MIME types must agree.
- FastAPI accepts JPEG, PNG, or WebP up to 10 MiB.
- Video signatures, duration, dimensions, and maximum bytes are validated before use.
- Uploaded original filenames are bounded and never used directly as storage paths.
- Media storage keys use generated identifiers.

## 7. HTTP controls

- Helmet sets defensive response headers.
- CORS accepts configured browser origins and clients without an Origin header.
- Rate limiting is applied by process namespace and actor or address.
- Unknown routes return 404 with a request ID.
- Zod, upload, upstream AI, Firestore quota, and internal failures have separate safe responses.
- Stack traces and raw exceptions are not returned to clients.

## 8. Secrets and credentials

- Service-account JSON, `.env`, `.env.local`, tokens, and local diagnostics are excluded from Git.
- `EXPECTED_FIREBASE_PROJECT_ID` must match the configured and credential project before cloud startup.
- Emulator and cloud hosts cannot be mixed.
- Production reset, bootstrap, and seed commands are rejected by database safety guards.
- Read-only production inspection still requires an exact project and database match.

## 9. Media and provider privacy

- Media is served through authenticated Node routes, not a public static directory.
- Structured provider-bridge output is disabled by default, stored only on the local filesystem when enabled, capped, and excluded from product APIs.
- System pages expose structured safe explanations rather than hidden or raw provider reasoning.

## 10. Known security boundary

Local media and in-process rate limits assume one trusted backend host. The repository does not implement shared media authorization or distributed rate limiting across multiple Node instances.

Generic location compatibility routes do not provide the Root and tenant isolation guarantees of the primary Site Map, Camera Creation, and Superadmin services. This is part of the current implementation and should be considered when exposing the Node API beyond its trusted local host.
