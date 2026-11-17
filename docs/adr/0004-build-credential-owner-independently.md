# Build the signed credential owner independently of EZ

The shared signed owner was built inside EZ and linked its lookup and history
target, including the SQLite schema bundle. Build it from
[`native/credentials`](../../native/credentials/Package.swift) with separate
client, native values and owner targets. EZ retains native access to shared
history and settings; the owner reads public connection definitions and keeps
credentials and authenticated provider operations private. This keeps the signing
boundary independent of the apps without adding another process or moving
storage behind RPC. The [credential contract](../../contracts/credentials.md)
owns installed identities and behavior.
