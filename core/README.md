# Tentative Core API

## External

| Function Name | Description |
| --- | --- |
| init(ip, port) | Initializes client connection with server. |
| connectDevice(pubkey?) | Connects client to server. |
| disconnectDevice() | Disconnects client from server. |
| sendMessage([pubkeys], payload) | Encrypts the payload separately for each id in ids, constructs a batched message with all payloads, and sends batched message to server. |
| onMessage(msg) | Decrypts, validates, and processes the received message. |
| resolveIDs(ids) | Converts a list of IDs to a list of public keys. |
| setValidateCallback(callback) | Sets the callback function to use during payload validation. |
| createDevice(linkedName, deviceName) | Initializes current device (independently) and sends the new public key to the server. |
| createLinkedDevice(dstPubkey, deviceName) | Initializes current device (as a part of an existing "linked" group) and sends the new public key to the server. Requests group information from the device specified by `dstPubkey`. |
| deleteDevice() | Deletes data stored on current device, removes devices from "linked" group (updating all other "linked" group members), and removes this device's public key from the server. |
| deleteAllLinkedDevices() | Deletes data stored on all "linked" devices and removes all public keys that pertain to that group from the server. |
| getPubkey() | Helper function for application to retrieve the current device's public key. |

## Internal

| Function Name | Description |
| --- | --- |
| validate(payload) |  |
| createGroup(ID, name, type, members) |  |
| addGroupMember(groupID, memberID) |  |
| initDevice(deviceID, deviceName) |  |
| processRequestLink(newDeviceID, newDeviceName, newDevicePubkey) |  |
| processLink(linkedGroup, existingDevices) |  |
| getPrivkey() |  |
| setPubkey(pubkey) |  |
| setPrivkey(privkey) |  |
| getGroupKey(groupID) |  |
| getGroup(groupID) |  |
| setGroup(groupID, groupValue) |  |

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
