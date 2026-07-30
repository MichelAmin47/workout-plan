# shared

Empty for now. Future home for code shared between `workout-app` and `voeding-app`, both of which read/write the same Supabase project:

- A shared Supabase client factory (currently duplicated as `workout-app/src/supabase.js`; `voeding-app` will need the same client setup).
- Generated TypeScript types for the shared Supabase schema, once `voeding-app` needs typed table access.

Not wired into either app's build yet — this is repo prep only.
