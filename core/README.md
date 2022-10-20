# Tentative Core API

## Groups data structure

KEY type

ID: {
  name: {string}
  parents: {string[]}
}

GROUP type

ID: {
  name: {string}
  parents: {string[]}
  children: {string[]}
}

PROS
- Children of GROUP type can be of different types (some KEY, some GROUP); we didn't have this before

CONS
- Cycles are possible (how much of a problem is this?)

two default groups so far:
- `linked`: describes "self" (e.g. default privacy; minimal group)
- `contacts`: describes "other"

all other groups are some combination of linked/contacts groups/subgroups

## Things the Core library *understands*

IDs: public keys (maybe not?)

Payload: 

- **sends**: data before encrypting

- **receives**: data after decrypting

Message:

- **sends** encrypted payload(s) with associated destination id(s)

- **receives** encrypted payload with source id

Validation: TODO

## Things the Core library *does*

Encrypts/decrypts

Sends/receives bytes

Validates received messages (access control)

(Maybe) Validates messages to be sent (access control -> can be bypassed by malicious client)

## Notes

How to express validation invariants/functions/properties/etc?

Also separate from socket.io interactions

Also separate from libsodium?
