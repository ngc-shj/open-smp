# Manual Test: UI SaaS app registration (C13)

E2E automation is deferred (SC8); this script is the manual verification path
for the `/apps` page against the seeded docker-compose stack. Live sync with
real Google Workspace credentials remains `blocked-deferred` (VE1);
registration itself is `verifiable-local` since `POST /api/saas-apps`
encrypts and stores without contacting Google.

## Pre-conditions

- `docker compose up -d --build` completed; seed service exited 0.
- A dummy but well-formed service-account JSON, e.g.:

  ```json
  {"client_email": "dummy@example.iam.gserviceaccount.com", "private_key": "-----BEGIN PRIVATE KEY-----\ndummy\n-----END PRIVATE KEY-----\n"}
  ```

## Steps

1. http://localhost:3000/login → login with `demo` / `admin@demo.example` / `demo-admin-password`.
2. Open `/apps` from the nav bar. Note the current list contents (may be
   empty on a fresh seed).
3. Fill the form: Display name `Test Workspace`, paste the dummy service
   account JSON above into the textarea, Admin email
   `admin@corp.example`, leave Customer ID blank. Click Register.
4. Verify: response is `201`, the new app appears in the list
   (`Test Workspace` / `google-workspace`), and the service-account JSON
   textarea is empty immediately after success (along with the other
   fields).
5. Malformed JSON: paste truncated/invalid JSON (e.g. `{"client_email":`)
   into the textarea and click Register. Open the browser devtools Network
   tab first. Verify an inline validation error appears and **no** request
   to `/api/saas-apps` is made (confirm via the Network tab — this is the
   load-bearing check for this step).
6. Missing required field: paste `{"client_email": "x@example.com"}` (no
   `private_key`) and click Register. Verify the same inline validation
   error path fires with no network request.
7. Duplicate registration: repeat step 3 with the same well-formed JSON
   and the same display name/admin email. Verify the response is `409` and
   the message "This app is already registered for your tenant" is shown.
8. Credentials never rendered: throughout steps 3–7, inspect the rendered
   DOM/React state (devtools) and confirm the pasted private key text never
   appears anywhere outside the textarea while it is being typed — no error
   message, console log, or `localStorage`/`sessionStorage` entry contains
   it. Confirm the console is free of any request body or error message
   containing credential material.

## Expected result

All steps pass; no browser console errors on `/apps`; no credential value
ever appears in an error message, console log, or storage.

## Run log

| Date | Operator | Result |
|------|----------|--------|
|      |          |        |
