# Skeleton App

## Requirements

There should probably be a better way to test this in the future, but for now 
we have been simulating different "devices" by using Firefox's 
[Container Tabs](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) 
to separate localStorage instances (the back-end database that Frida is currently
using). You will also need Firefox if you don't already have it. 

Once this extension is added to Firefox, you can open a new container tab by 
holding down the `+` button when opening a new tab or going to File > New 
Container Tab. By default there are four containers, so you can effectively 
simulate five separate devices without changing container settings (the fifth 
would be in a non-container tab, which also has separate storage from any of 
the containers). 

For the remainder of these instructions, any time a "device" is referenced, 
this actually refers to a Frida-client instance with isolated storage (e.g., 
a contained browser tab).

## Start the server

```sh
cd ./server
make
node index.js
```

## Start the client

```sh
cd ./client
make
npm run serve
```

## Interact with UI

Open client-address in browser (likely `http://localhost:8081/`).

### Register new device

Specify "top-level name" (any string will work) and click `New Device`.
Navigate to the `Settings` tab (top-left of page), where you will see a
`pubkey` field with this device's public key, and a `devices` field with 
all of the device public keys that are linked with the current device
(which should only be the current device at this point).

### Link new device with existing device

On a new, unregistered device, paste the value of the `pubkey` field on the 
device you wish to link with into the "public key to link with" field, then
click `New Linked Device`. A pop-up should appear on the device with the 
pasted pubkey, asking if a new LINKED member should be authenticated. Press `OK`.
Refresh both devices (and navigate to the `Settings` tab on the newly-linked
device). Both devices should now have the same `devices` fields with two fields,
one for each of the linked devices.
