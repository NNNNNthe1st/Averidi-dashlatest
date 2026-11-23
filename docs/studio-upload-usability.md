# Studio upload and creation flow

Studio opens on **Upload data**, including workspaces with saved dashboards.
Its three persistent actions are Upload data, Create a dashboard and View
dashboard. Selection is recorded in `?section=data|create|view`; browser back,
forward and reload respect it. Existing `?create=1` and `?view=<id>` links work.
Loading or refreshing saved views no longer changes the selected section.
My Dashboards and Data management also link directly to Upload data.

The sales dashboard renderer, approved HTML, stylesheet and chart layout are
unchanged. Studio omits the old customization controls for the fixed Sales
presentation because those controls do not change that presentation. Other
dashboard templates retain their customization tools.

## Corrected behavior

- A newly registered upload destination is retained before file transfer starts.
  A network failure can be retried without registering another empty dataset.
- A failed transfer retains the selected file, its preview and the error message.
  Completing an attempt no longer starts an automatic recheck that clears errors.
- File selection is retained across Studio section changes. The selected filename
  remains explicit even if the browser recreates the native file input.
- Processing locks the upload form until a terminal processing state. Completion
  selects the new ready dataset and explains the next action.
- New uploads reset destination/import mode after success; changing the destination
  resets append/synchronization choices and record identity.
- Dataset changes reset draft field meanings, calculation rules and units.
- Data preview, registration, rule/field saves, analysis, generation and view saves
  use Dashboard's authenticated transport. Expired sessions can renew, but writes
  are never replayed automatically. XHR upload failures share the same renewal.
- Viewers cannot upload, calculate or generate dashboards through these controls.
- Old completed analysis jobs no longer open their historical dashboard on mount.
  Only a creation job explicitly requested by this mounted workflow opens results.
- The generation test command references the replacement approved-design test,
  rather than the removed legacy map test.

## Verification

- TypeScript and production webpack build passed on Node 22.23.4.
- 33 focused tests passed: authenticated transport, approved Sales design,
  upload validation and dashboard generation.
- Isolated browser QA rendered the actual Studio and DatasetAnalysis components
  with fixture API/XHR responses and a stubbed saved-dashboard renderer. Verified
  default upload visibility despite existing dashboards; automatic preview; failed
  transfer retention; retry with one dataset registration and two transfers;
  processing completion; chosen dataset retention; no historical-job redirect;
  explicit creation completion; read-only controls; section persistence on reload.
- Browser fixtures are separate from the application and do not access the user's
  Codespace, database or production. The real backend upload worker was not rerun
  in this UI change; existing upload validation tests were run.

Scope: Studio, its workspace/data entry points and their authenticated requests.
This is not a verification of every page in the application.
