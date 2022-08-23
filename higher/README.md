# Tentative Higher-Level API

Goals:

- App developers use higher-level API to interact with core API
- Most of the higher-level API will be sufficient for most applications
- App developers can extend/add to the higher-level API for application-specific things

Examples:

- Device management (overlaps with sharing primitives) ~> intra-user sharing
  - Authentication
  - Adding devices
  - Deleting devices
- Data primitives (interacting with local data store)
  - Create
  - Read
  - Update
  - Delete (+ clearing local data store when delete device)
- Sharing primitives ~> inter-user sharing
  - Groups?
  - Friends/contacts?

## Notes

Where does sequence number checking/history fit in? Core?
