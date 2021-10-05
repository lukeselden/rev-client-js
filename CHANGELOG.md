## 0.7.0

### Features
* Added video report API wrapper (`rev.video.report`)
* Added `throwHttpErrors` options to `RevClient.request()` to control if http error codes are treated as errors
* Video Search option `onScrollExpired` deprecated in favor of `onError`
* `rev.user.details` now accepts a `type` parameter, replacing `rev.user.getByUsername` and `rev.user.getByEmail`
* Added `rev.user.exists` helper to check if user exists

### Breaking Changes
* `AbortError` no longer exported *(intended as node.js-only polyfill)*
* Some typescript types re-arranged.

### Bugfixes
* some minor typescript type fixes

### Other changes
* refactor search request wrappers

## 0.6.0
Initial public release