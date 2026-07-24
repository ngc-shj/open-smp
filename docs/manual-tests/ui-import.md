# Manual Test: UI HR import (C12)

E2E automation is deferred (SC8); this script is the manual verification path
for the `/import` page against the seeded docker-compose stack.

## Pre-conditions

- `docker compose up -d --build` completed; seed service exited 0.
- CSV header row for all fixtures below: `employee_id,email,name,status,left_at`.

## Steps

1. http://localhost:3000/login → login with `demo` / `admin@demo.example` / `demo-admin-password`.
2. Open `/import` from the nav bar.
3. Happy path: create a local file `hr-happy.csv`:

   ```csv
   employee_id,email,name,status,left_at
   emp-100,taro.yamada@corp.example,Taro Yamada,active,
   emp-101,hanako.suzuki@corp.example,Hanako Suzuki,active,
   ```

   Choose the file → Upload. Verify `2 imported, 0 skipped` renders, no
   errors/warnings tables shown.
4. Click "Run matching". Verify a "Matching…" indicator appears, then
   "Matching completed." with a link to `/accounts`. Follow the link and
   confirm the page loads.
5. Error CSV: create `hr-errors.csv`:

   ```csv
   employee_id,email,name,status,left_at
   emp-200,bad.status@corp.example,Bad Status,休職,
   emp-201,,Missing Email,active,
   ```

   Upload it. Verify the errors table renders row-numbered messages (row 2:
   `unknown status "休職"`; row 3: `email is required`), and `skipped`
   reflects the error count.
6. Non-UTF-8 file: save a copy of `hr-happy.csv` re-encoded as Shift_JIS
   (e.g. `iconv -f UTF-8 -t SHIFT_JIS hr-happy.csv -o hr-sjis.csv`). Upload
   it. Verify the friendly message "This file is not UTF-8 encoded..." is
   shown, with the raw string `file must be UTF-8 encoded` visible in
   smaller print underneath.
7. Oversized file: create a file larger than 10MB (e.g.
   `yes "emp,x@example.com,X,active," | head -c 11000000 > hr-huge.csv`
   with a header line prepended). Upload it. Verify a rejection message is
   shown referencing the 10MB limit, with the raw string
   `file exceeds 10MB limit` visible in smaller print.
8. Unauthenticated access: log out (or open a private browsing window) and
   navigate directly to `/import`. The page shell renders (client component,
   no server-side guard), but attempting an upload or "Run matching" must
   redirect to `/login` once the underlying API call returns 401.

## Expected result

All steps pass; no browser console errors on `/import`.

## Run log

| Date | Operator | Result |
|------|----------|--------|
|      |          |        |
