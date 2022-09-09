/*
 **********
 **********
 ** Core **
 **********
 **********
 */

import * as sc from "./serverComm/socketIO.js";
import * as c from "./crypto/libSodium.js";
import * as db from "./db/localStorage.js";

/* Local variables */

const SLASH = "/";
const DATA  = "__data";
const GROUP = "__group";
const GROUP_KEY_PREFIX = DATA + SLASH + GROUP + SLASH;
const LINKED = "__linked";
const PUBKEY   = "pubkey";
const PRIVKEY  = "privkey";

// valid message types
const REQ_LINK      = "requestLink";
const LINK          = "link";
const DELETE_SELF   = "deleteSelf";
const DELETE_GROUP  = "deleteGroup";
const UPDATE_LINKED = "updateLinked";

export {GROUP_KEY_PREFIX as groupPrefix};

// default auth/unauth functions do nothing
let onAuth = () => {};
let onUnauth = () => {};

// default callback
let defaultValidateCallback = (payload) => {
  console.log("validating payload...");
  console.log(payload)
};
let validateCallback = defaultValidateCallback;

function makeGroup(fieldNames) {
  fieldNames = fieldNames.split(' ');
  let numFields = fieldNames.length;
  function constructor() {
    for (let i = 0; i < numFields; i++) {
      this[fieldNames[i]] = arguments[i];
    }
  }
  return constructor;
}

/* doubly-linked tree, supports cycles */
const Key = makeGroup("name parents");
const Group = makeGroup("name parents children");

/*
 *********************
 * Server Connection *
 *********************
 */

/*
 * Initializes client-server connection
 *
 * ip: string
 * port: string
 * config: object
 *   onAuth: func
 *   onUnauth: func
 *   validateCallback: func
 */
export function init(ip, port, config) {
  sc.init(ip, port);
  if (config.onAuth) {
    onAuth = config.onAuth;
  }
  if (config.onUnauth) {
    onUnauth = config.onUnauth;
  }
  if (config.validateCallback) {
    validateCallback = config.validateCallback;
  }
}

/*
 * Connects the device to the server, e.g. when a client adds a new
 *   device or when a previously-added device comes back online
 *
 * pubkey: string
 */
export function connectDevice(pubkey = null) {
  if (pubkey !== null) {
    sc.connect(pubkey);
  } else {
    sc.connect(getPubkey());
  }
}

/*
 * Simulates offline devices
 */
export function disconnectDevice() {
  sc.disconnect(getPubkey());
}

/*
 **********************
 * Message Processing *
 **********************
 */

/*
 * Called like: sendMessage(resolveIDs(id), payload)
 * See example in deleteAllLinkedDevices()
 *
 * dstPubkeys: list of strings
 * payload: object
 *
 * TODO better to take in the current device's pub/priv-keys as arguments? 
 */
export function sendMessage(dstPubkeys, payload) {
  let batch = new Array();
  let srcPubkey = getPubkey();
  let srcPrivkey = getPrivkey();

  dstPubkeys.forEach(dstPubkey => {
    // encrypt payload separately for each destination 
    let { ciphertext: encPayload, nonce: nonce } = c.signAndEncrypt(
      dstPubkey,
      srcPrivkey,
      toString(payload)
    );
    batch.push({
      dstPubkey: dstPubkey,
      encPayload: encPayload,
      nonce: nonce,
    });
  });

  let msg = {
    srcPubkey: srcPubkey,
    batch: batch,
  };

  // send message to server
  sc.sendMessage(msg);
}

/*
 * Decrypts, validates, and demultiplexes the received message
 *
 * msg: encrypted string
 *
 * TODO consider: expose ordered or unordered message reception?
 *   E.g. ordered may be simpler to program against but maybe 
 *   real-time apps would benefit from an unordered API (perhaps
 *   make this composable?)
 */
export function onMessage(msg) {
  console.log("seqID: " + msg.seqID);
  let curPrivkey = getPrivkey();
  if (curPrivkey !== null) {
    let payload = fromString(
      c.decryptAndVerify(
        msg.encPayload,
        msg.nonce,
        msg.srcPubkey,
        curPrivkey
      )
    );

    // validate via callback
    validate(payload);

    //let func = demuxDict[payload.msgType];
    //func(payload);

    switch (payload.msgType) {
      case REQ_LINK:
        processRequestLink(payload.newDeviceName, payload.newDevicePubkey);
        break;
      case LINK:
        processLink(payload.linkedGroup, payload.existingDevices);
        break;
      case DELETE_SELF:
        deleteDevice();
        break;
      case DELETE_GROUP:
        processDelete(payload.groupID);
        break;
      case UPDATE_LINKED:
        processUpdateLinked(payload.linkedGroup, payload.newDevicePubkey, payload.newDeviceName);
        break;
      default: 
        console.log("ERROR UNKNOWN msgType: " + payload.msgType);
    }
  }
}

//const demuxDict = {
//  REQ_LINK: processRequestLink,
//  LINK: processLink,
//  DELETE_SELF: deleteDevice,
//  DELETE_GROUP: processDelete,
//  UPDATE_LINKED: processUpdateLinked,
//};

/*
 * Sets the callback function with which to perform message validation
 *   for this application
 *
 * newValidateCallback: function
 *
 * TODO validate newValidateCallback to ensure it only takes one argument
 *   (the payload)
 */
export function setValidateCallback(callback) {
  validateCallback = callback;
}

/*
 * Validates a message via the validateCallback, which can either be:
 * 1. defined by the application (through setValidateCallback()), or
 * 2. the default callback (defaultValidateCallback)
 *
 * payload: decrypted string
 */
function validate(payload) {
  validateCallback(payload);
}

/*
 * Resolves the ID(s) passed in to a list of one or more public keys
 *
 * ids: list
 */
export function resolveIDs(ids) {
  let pubkeys = [];
  ids.forEach((id) => {
    let groupValue = getGroup(id);
    if (groupValue !== null) {
      if (isKey(groupValue)) {
        pubkeys.push(id);
      } else {
        pubkeys = pubkeys.concat(resolveIDs(groupValue.children));
      }
    }
  });
  return pubkeys;
}

/*
 * Helper function for determining if resolveIDs has hit it's base case or not
 */
function isKey(value) {
  if (value.children) {
    return false;
  }
  return true;
}

/*
 ************
 * Creation *
 ************
 */

/*
 * Initializes a new device with a keypair and adds the public key to the
 *   server
 *
 * deviceName: string (human-readable name; optional)
 */
function initDevice(parents, deviceName = null) {
  let deviceKeys = c.generateKeypair();
  setPubkey(deviceKeys.pubkey);
  setPrivkey(deviceKeys.privkey);
  sc.addDevice(deviceKeys.pubkey);
  connectDevice(deviceKeys.pubkey);
  createKey(deviceKeys.pubkey, deviceName, parents);
  return deviceKeys.pubkey;
}

/*
 * Initializes device and its linked group
 *
 * linkedName: string (human-readable name; for contacts)
 * deviceName: string (human-readable name; optional)
 */
export function createDevice(linkedName = null, deviceName = null) {
  // enforce that linkedName exists; deviceName is not necessary
  if (linkedName === null) {
    linkedName = crypto.randomUUID();
  }
  let pubkey = initDevice([LINKED], deviceName);
  createGroup(LINKED, linkedName, [], [pubkey]);
  onAuth();
  return pubkey;
}

/*
 * Initializes device without a linked group, and requests linked
 *   group information from the supplied public key
 *
 * dstPubkey: string (hex-formatted)
 * deviceName: string (human-readable; optional)
 */
export function createLinkedDevice(dstPubkey, deviceName = null) {
  if (dstPubkey !== null) {
    let pubkey = initDevice([], deviceName);
    // construct message that asks dstPubkey's corresponding device to
    // link this device
    let payload = {
      msgType: REQ_LINK,
      newDevicePubkey: pubkey,
      newDeviceName: deviceName,
    };
    sendMessage([dstPubkey], payload);
    return pubkey;
  }
}

/*
 * Creates a new group for the requesting device, adds the new group ID to the 
 *   current device's linked group, and send the requesting device the list of 
 *   and group information of any existing devices (including the current one)
 *
 * newDeviceName: string (human-readable name; optional)
 * newDevicePubkey: string (hex-formatted)
 * 
 * TODO send other data from this device
 *   - contacts?
 *   - app data?
 */
function processRequestLink(newDeviceName, newDevicePubkey) {
  if (confirm(`Authenticate new device?\n\tName: ${newDeviceName}\n\tPubkey: ${newDevicePubkey}`)) {
    // get all existing device groups to send to new device
    let existingDevices = [];
    // FIXME only goes one level, discounts other tree structures
    // want to somehow rebuild the exact structure regardless of what it is
    let children = getChildren(LINKED);
    children.forEach((childID) => {
      existingDevices.push({
        ID: childID,
        group: getGroup(childID),
      });
    });

    // create key for new device
    createKey(newDevicePubkey, newDeviceName, [LINKED]);

    // get devices whose linked group needs to be updated too (removing 
    // current device from that list so don't duplicate this group)
    let pubkey = getPubkey();
    let oldLinkedPubkeys = resolveIDs([LINKED]).filter((x) => x != pubkey);

    // add new device to linked group
    let updatedGroup = addChild(LINKED, newDevicePubkey);

    // update existing devices linked groups
    let payloadToExisting = {
      msgType: UPDATE_LINKED,
      linkedGroup: updatedGroup,
      newDevicePubkey: newDevicePubkey,
      newDeviceName: newDeviceName,
    };
    sendMessage(oldLinkedPubkeys, payloadToExisting);

    let payloadToNew = {
      msgType: LINK,
      linkedGroup: updatedGroup,
      existingDevices: existingDevices,
    };
    sendMessage([newDevicePubkey], payloadToNew);
  }
}

/*
 * Updates linked group info and and group info for all devices that are children
 *   of the linked group
 *
 * linkedGroup: object
 * existingDevices: list
 *
 * TODO also process any other data sent from the device being linked with
 */
function processLink(linkedGroup, existingDevices) {
  setGroup(LINKED, linkedGroup);
  existingDevices.forEach(({ ID, group }) => {
    setGroup(ID, group);
  });
  addParent(getPubkey(), LINKED);
  onAuth();
}

/*
 * Updates linked group info and adds new device group when a new device was 
 *   successfully linked with another device in linked group
 *
 * linkedGroup: object
 * newDeviceName: string (human-readable name; optional)
 * newDevicePubkey: string (hex-formatted)
 */
function processUpdateLinked(linkedGroup, newDevicePubkey, newDeviceName) {
  // create key for new device
  createKey(newDevicePubkey, newDeviceName, [LINKED]);
  // add new device to linked group
  addChild(LINKED, newDevicePubkey);
}

/*
 ************
 * Updating *
 ************
 */

/*
 ************
 * Deletion *
 ************
 */

/*
 * Deletes the current device's data and removes it's public key from 
 *   the server
 *
 * TODO validate that this message is coming from a known device
 */
export function deleteDevice() {
  let pubkey = getPubkey();
  // get all groupIDs that point to this key
  let parents = getParents(pubkey);
  let payload = {
    msgType: DELETE_GROUP,
    groupID: pubkey,
  };
  sendMessage(resolveIDs(parents), payload);
  sc.removeDevice(pubkey);
  sc.disconnect(pubkey);
  db.clear();
  onUnauth();
}

/*
 * Deletes the device pointed to by the public key
 */
export function deleteLinkedDevice(pubkey) {
  let payload = {
    msgType: DELETE_SELF,
  };
  sendMessage([pubkey], payload);
}

/*
 * Deletes all devices that are children of this device's linked group
 */
export function deleteAllLinkedDevices() {
  let payload = {
    msgType: DELETE_SELF,
  };
  sendMessage(resolveIDs([LINKED]), payload);
}

function processDelete(groupID) {
  // unlink pubkey group from parents
  let parents = getParents(groupID);
  parents.forEach((parentID) => {
    removeChild(parentID, groupID);
  });
  // delete pubkey group
  removeGroup(groupID);
}

/*
 ************
 * Grouping *
 ************
 */

/*
 * Wrapper function for assigning a group ID to a group object consisting
 *   of a name and children list
 *
 * ID: string (unique)
 * name: string (human-readable name; optional)
 * children: list of names (groupIDs or public keys)
 */
function createGroup(ID, name, parents, children) {
  let newGroup = new Group(name, parents, children);
  setGroup(ID, newGroup);
}

/*
 * Wrapper function for assigning a key ID to a key object consisting
 *   of a name
 *
 * ID: public key string (unique; hex-formatted)
 * name: string (human-readable name; optional)
 */
function createKey(ID, name, parents) {
  let newKey = new Key(name, parents);
  setGroup(ID, newKey);
}

/*
 * Gets childrens list of group with groupID
 *
 * groupID: string (unique)
 */
function getChildren(groupID) {
  let group = getGroup(groupID);
  if (group !== null) {
    return group.children;
  }
  return [];
}

/*
 * Adds an additional child (ID or pubkey) to an existing group's children list
 *
 * groupID: string (unique)
 * childID: string (unique)
 */
function addChild(groupID, childID) {
  return updateChildren(groupID, childID, (childID, newChildren) => {
    newChildren.push(childID);
    return newChildren;
  });
}

/*
 * Removes a child (ID or pubkey) from an existing group's children list
 *
 * groupID: string (unique)
 * childID: string (unique)
 */
function removeChild(groupID, childID) {
  return updateChildren(groupID, childID, (childID, newChildren) => {
    let idx = newChildren.indexOf(childID);
    if (idx !== -1) newChildren.splice(idx, 1);
    return newChildren;
  });
}

/*
 * Helper function for updating existing group's children list
 *
 * groupID: string (unique)
 * childID: string (unique)
 * callback: function
 */
function updateChildren(groupID, childID, callback) {
  let oldGroupValue = getGroup(groupID);
  let newChildren = callback(childID, oldGroupValue.children);
  let newGroupValue = { ...oldGroupValue, children: newChildren };
  setGroup(groupID, newGroupValue);
  return newGroupValue;
}

/*
 * Gets parents list of group with groupID
 *
 * groupID: string (unique)
 */
function getParents(groupID) {
  let group = getGroup(groupID);
  if (group !== null) {
    return group.parents;
  }
  return [];
}

/*
 * Adds an additional parent (ID) to an existing group's parents list
 *
 * groupID: string (unique)
 * parentID: string (unique)
 */
function addParent(groupID, parentID) {
  return updateParents(groupID, parentID, (parentID, newParents) => {
    newParents.push(parentID);
    return newParents;
  });
}

/*
 * Removes a parent (ID or pubkey) from an existing group's parents list
 *
 * groupID: string (unique)
 * parentID: string (unique)
 */
//function removeParent(groupID, parentID) {
//  return updateParents(groupID, parentID, (parentID, newParents) => {
//    let idx = newParents.indexOf(parentID);
//    if (idx !== -1) newParents.splice(idx, 1);
//    return newParents;
//  });
//}

/*
 * Helper function for updating existing group's parents list
 *
 * groupID: string (unique)
 * parentID: string (unique)
 * callback: function
 */
function updateParents(groupID, parentID, callback) {
  let oldGroupValue = getGroup(groupID);
  let newParents = callback(parentID, oldGroupValue.parents);
  let newGroupValue = { ...oldGroupValue, parents: newParents };
  setGroup(groupID, newGroupValue);
  return newGroupValue;
}

/*
 * Gets full-length groupKey
 *
 * groupID: unique string
 */
function getGroupKey(groupID) {
  return GROUP_KEY_PREFIX + groupID + SLASH;
}

/*
 * Group getter
 */
function getGroup(groupID) {
  return db.get(getGroupKey(groupID));
}

/*
 * Group setter
 */
function setGroup(groupID, groupValue) {
  db.set(getGroupKey(groupID), groupValue);
}

/*
 * Group remover
 */
function removeGroup(groupID) {
  db.remove(getGroupKey(groupID));
}

/*
 * linkedGroup getter
 */
export function getLinkedDevices() {
  return resolveIDs([LINKED]);
}

/*
 ***************
 * Key Helpers *
 ***************
 */

/*
 * Pubkey getter
 */
export function getPubkey() {
  return db.get(PUBKEY);
}

/*
 * Pubkey setter
 */
function setPubkey(pubkey) {
  db.set(PUBKEY, pubkey);
}

/*
 * Privkey getter
 */
function getPrivkey() {
  return db.get(PRIVKEY);
}

/*
 * Privkey setter
 */
function setPrivkey(privkey) {
  db.set(PRIVKEY, privkey);
}

/*
 ****************
 * JSON Helpers *
 ****************
 *
 * TODO put back in db module? were moved here in case client application 
 *   needed direct access to these functions
 */
export function toString(obj) {
  return JSON.stringify(obj);
}

export function fromString(str) {
  return JSON.parse(str);
}
