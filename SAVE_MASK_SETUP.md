# Save masks with email and password

The studio now has **Save mask**, directly below **Selfie**. Guests see registration with an option to sign in. The current editable mask waits on the device while they register, confirm their email, or sign in. After login, users can rename the mask or keep its current name before saving. Users who are already signed in get the same naming choice.

## Connect your Supabase project

1. Open Supabase **SQL Editor**. Run `supabase/migrations/202610290001_saved_masks.sql` once. This adds the individual-mask collection table and access rules. It does not change or migrate any older `mask_libraries` shelf data.
2. Under **Authentication → Sign In / Providers → Email**, enable email sign-in. Keep email confirmation enabled if you want verified email addresses. After registration, users confirm through the email and return to sign in; their waiting mask remains on the original browser. Opening the confirmation link in that same browser can resume the save directly.
3. Under **Authentication → URL Configuration**, add the final ClayPlay URL and your local development URL (for example `http://127.0.0.1:5174/`) to Redirect URLs. Set Site URL to the published app URL. A confirmation opened on another device cannot access an unsaved mask left on the original device; sign in on the original device to finish its waiting save.
4. Set these public environment settings in `.env.local` for development and in your hosting dashboard for production:

   ```env
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
   ```

5. Restart the local server, or rebuild and redeploy manually. Configure Supabase SMTP for public email delivery and review its sending limits before inviting users.

## Using the collection

Click **Save mask**, register or sign in, then choose a name and **Save mask**, or choose **Keep current name**. Wait for **Saved to your collection**. Choose **More → My collection** to open it later. A saved mask retains editable sculpt fields, exact geometry, paint, surface finish, size and position. Opening it adds a studio mask and keeps current studio masks intact; the studio can hold eight open masks at a time. Click Save again to update the opened mask. Undo history is not saved. Selfies and camera frames are never included.

Saving is explicit; edits made after a save need another click on Save. A waiting save is a snapshot from when Save was clicked. It survives refresh in IndexedDB, bound to the intended email/account, and retries from **Save waiting mask** after network errors. There is one waiting save per browser origin; finish or explicitly discard it before saving another mask. Clearing browser site data removes an unsent waiting copy. Passwords are passed directly to Supabase Auth and are never put in the waiting-save database.

The collection is private through owner checks in the database. Accounts are cleared from the collection view on sign-out. If another device updates the same mask, the old revision cannot overwrite it: **Save as a new copy** preserves both. Repeating a request after a lost network response does not create another mask.

## Validation

`npm test` checks serialization, editability and the pending-save/authentication model. `npm run build` checks production bundling. `tests/maskCollection.browser.cjs` runs isolated browser checks using simulated Supabase responses; it never registers a real user or sends email. Set `PLAYWRIGHT_MODULE` to a Playwright installation when needed, and `PLAYWRIGHT_CHANNEL` to an installed browser such as `msedge`.

The pgTAP checks in `supabase/tests/saved_masks.sql` can be run in a local Supabase instance using `supabase test db`, after migrations are applied. They cover anonymous denial, owner isolation, stale-revision rejection and request replay. They roll back their fixtures. A live project is still needed to verify actual email delivery, its provider settings, and deployed database policies.

Official references: [email/password authentication](https://supabase.com/docs/guides/auth/passwords), [email confirmation](https://supabase.com/docs/reference/javascript/auth-signup), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).
