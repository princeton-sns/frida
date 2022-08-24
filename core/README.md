# Tentative Core API

| Function Name | Description |
| --- | --- |
| send_message([ids], payload) | Encrypts the payload separately for each id in ids, constructs a batched message with all payloads, and sends batched message to server. |
| on_message(message) | TODO |
| resolve_ids() | TODO |
| set_validate_callback() | TODO |

## Things the Core library *understands*

IDs: public keys (maybe not?)

Payload: 

- **sends**: data before encrypting

- **receipts**: data after decrypting

Message:

- **sends** encrypted payload(s) with associated destination id(s)

- **receipts** encrypted payload with source id

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
