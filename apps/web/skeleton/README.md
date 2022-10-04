# Skeleton App

## Requirements

There should probably be a better way to test this in the future, but for now 
we have been simulating different "devices" by using Firefox's 
[Container Tabs](https://addons.mozilla.org/en-US/firefox/addon/multi-account-containers/) 
to separate localStorage instances (the back-end database that Frida is currently
using). You will also need Firefox if you don't already have it. 

Once this extension is added to Firefox, you can open a new container tab by 
holding down the `+` button when opening a new tab or going to `File` > `New 
Container Tab`. By default there are four containers, so you can effectively 
simulate five separate devices without changing container settings (the fifth 
would be in a non-container tab, which also has separate storage from any of 
the containers). You can also re-configure/add new containers to fit your 
needs.

In the remainder of these instructions, a "device" refers to a Frida-client
instance with isolated storage (e.g., a contained browser tab).

## Notes

The app is not-entirely reactive, so if you expect something to appear and it
is not, try just refreshing the page.

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

On a new, unregistered device, paste the value of the `pubkey` field of the 
device you wish to link with into the "public key to link with" field on the
currently-unregistered device. Then click `New Linked Device`. A pop-up 
should appear on the device associated with the pasted pubkey asking if a new
LINKED member should be authenticated. Press `OK`. Refresh both devices and 
navigate to the `Settings` tab on the newly-linked device. Both devices should 
now have the same `top name` and `devices` value (an array with two fields, one 
for each of the linked devices).

### Adding a contact

A contact-relationship can be established between disjoint sets of devices.
E.g. one device in the set of linked devices with top name "a" can add the one
of the devices in the set of linked devices with top name "b" as a contact if 
there are no shared devices between those two sets. This property is not 
entirely enforced by the library (although it should be in the future) so for
now users should try to abide by it as best they can to avoid weird behavior.

#### Set up

Create two sets of linked devices with two distinct top names, e.g. "a" and "b".
Each linked set can have any number of devices.

#### Request contact

On one of "a"'s devices, navigate to the `Friends` tab and paste one of "b"'s
public keys into the "device public key field". Click `Add Friend`.

#### Accept contact

On the "b" device associated with the pasted public key, a pop-up should appear
asking if new contact "a" should be added. Press `OK`. After refreshing the 
`Friends` tab on all devices you should see the appropriate top name in the 
"Friends" field of each device.

### Adding/modifying data

TODO

### Sharing/unsharing data

TODO

### Removing contacts

TODO

### Deleting devices

TODO

