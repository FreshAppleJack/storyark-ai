## Data boundary

- `domain/` contains pure normalization for preferences, character input and planning. `mappers.ts` converts server DTOs and write payloads. Time is supplied by callers; converters do not access React, storage or the network.
- The API modules own URLs, HTTP methods and wire formats. They return frontend values (except the existing graph DTO) and reject on request/conversion failure. Axios already unwraps `response.data`; its second generic describes that actual return value.
- DTOs describe the server contract, not complete runtime schema validation. IDs are required; legacy JSON fields tolerate invalid input and normalize to safe defaults.
- Context owns optimistic state and one shared chapter queue. Content saves, lock changes and chapter deletion use that queue; volume deletion drains its known chapters first. API functions must not create independent queues.
- Context writes report `true`/`false`; book/volume/chapter creation returns an ID or `null`. Read failures return `null`, distinct from successful empty results. Character creation returns a boolean. Nickname failure restores its prior snapshot; other existing optimistic updates remain local on failure.
- Preference setters update local state/storage immediately and sync remotely on a best-effort basis. Login success means authentication succeeded, independently of initial settings/book loading. A created book ID confirms creation even if the subsequent list refresh fails.
- Existing fire-and-forget UI mutations may ignore the new boolean result. Their completion must not be treated as proof of persistence; comprehensive mutation feedback/rollback and state ownership are separate work.
- `POST /books` must return the created book object with its generated ID. Deploy the matching `BookController` change with this frontend.
